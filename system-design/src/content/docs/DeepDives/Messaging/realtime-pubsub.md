# Real-Time Pub/Sub — Deep Dive

> **Type:** Core concept
> **Tags:** `[pubsub]` `[fan-out]` `[realtime]` `[messaging]` `[decoupling]`
> **Where it shows up:** [fb-live-comments](../../HLD/fb-live-comments.md), [slack](../../HLD/slack.md), [whatsapp](../../HLD/whatsapp.md), [gaming-leaderboard](../../HLD/gaming-leaderboard.md), [notification-system](../../HLD/notification-system.md)

---

## Mental model

**Publish/Subscribe** is a messaging pattern where **publishers** send messages to a **topic/channel** without knowing who (if anyone) is listening, and **subscribers** register interest in a topic and receive every message published to it. The publisher and subscribers are fully **decoupled** — they don't know about each other, don't need to be online at the same time (depending on the system), and any number of subscribers can receive the same message.

The defining difference from a [message queue](queues-vs-streams.md): a queue delivers each message to **exactly one** consumer (work distribution); pub/sub **broadcasts** each message to **every** subscriber (fan-out). When the requirement is "one event, many recipients, in real time" — a live comment appearing on thousands of screens, a chat message reaching every device in a room, a price update pushed to all watchers — pub/sub is the pattern.

## Internals

```
                  ┌──────────── Topic: "room:42" ────────────┐
Publisher ──────► │                                          │
(new message)     │   broadcast to all current subscribers   │
                  └──┬──────────────┬──────────────┬─────────┘
                     ▼              ▼              ▼
                Subscriber A   Subscriber B   Subscriber C
                (Alice's web)  (Bob's phone)  (Carol's tab)
```

- **Publish** to a topic; the broker **fans out** a copy to every active subscription on that topic.
- Subscriptions can be **topic-based** (subscribe to `room:42`) or **content/pattern-based** (subscribe to `room:*` or messages matching a filter).
- **Delivery durability** varies sharply by system (the key design axis):
  - **Ephemeral / fire-and-forget** (Redis Pub/Sub) — messages go *only* to subscribers connected **right now**; an offline or just-connecting subscriber **misses** them. No storage, lowest latency.
  - **Durable / retained** (Kafka, durable topics, Redis Streams) — messages are stored; subscribers (consumer groups) read at their own offset and can catch up after downtime. At-least-once delivery.

That ephemeral-vs-durable choice is the heart of any pub/sub design answer.

## The real-time delivery problem (where it gets hard)

Pub/sub for *real-time* user-facing features (chat, live comments, presence) combines a broker with **persistent client connections** ([WebSockets/SSE](../Networking/realtime-websockets-sse.md)) — and that's where the scaling challenge lives:

- Millions of clients hold long-lived connections spread across many **gateway/connection servers**.
- A published message must reach the *specific gateways* holding the *target subscribers'* connections — but a subscriber could be on **any** gateway.
- **Solution: a pub/sub backplane.** Gateways subscribe to the relevant topics on a shared broker ([Redis](../Caching/redis.md) Pub/Sub, or Kafka). When a message is published, the broker fans it out to every gateway with interested connections, and each gateway pushes to its local clients.
- **Presence/routing** — track which user/connection is on which gateway (or use topic subscriptions to avoid needing exact routing).

This **broker + connection-gateway + backplane** design *is* the [Slack](../../HLD/slack.md)/[live-comments](../../HLD/fb-live-comments.md) real-time architecture. See [realtime-websockets-sse](../Networking/realtime-websockets-sse.md) for the connection-tier details.

## Pub/Sub vs related patterns

- **vs Message queue** — queue = one consumer per message (work sharing); pub/sub = all subscribers get every message (broadcast). See [queues-vs-streams](queues-vs-streams.md).
- **vs Event stream (Kafka)** — Kafka *is* durable pub/sub with retention + replay + consumer groups; "real-time pub/sub" often means the **low-latency, possibly-ephemeral** flavor (Redis Pub/Sub, MQTT) for live fan-out, where replay isn't needed and latency is paramount. Kafka when you need durability/replay; Redis Pub/Sub when you need the lowest-latency live broadcast and can tolerate missed messages for offline clients.
- **vs Direct push** — without pub/sub you'd have the publisher track and message each recipient; pub/sub offloads fan-out and decoupling to the broker.

## Tradeoffs & decisions

- **Ephemeral vs durable** — fire-and-forget (lowest latency, offline subscribers miss messages) vs retained (catch-up/replay, more storage and latency). Pick by whether missing a message is acceptable.
- **Latency vs delivery guarantee** — real-time broadcast favors speed; guaranteed delivery favors acks/persistence and adds overhead.
- **Decoupling vs delivery accountability** — publishers not knowing subscribers is great for flexibility, but means the publisher gets no per-recipient confirmation; if you need "was it delivered?", you need acks/tracking on top.
- **Fan-out cost** — broadcasting to millions of subscribers is expensive; a [hot topic](../Caching/redis.md) (a celebrity's channel) concentrates load — handle with sharded topics / gateway-level fan-out.

## When to use / when not

**Use pub/sub when:** one event must reach **many** recipients in **real time** — live chat/comments, presence, collaborative cursors, live dashboards/prices, in-app notifications, and as the **backplane** behind WebSocket fan-out. Also for decoupled event broadcasting between services (one event, several reacting systems).

**Reach for something else when:**
- Work should go to **exactly one** worker → message [queue](queues-vs-streams.md), not pub/sub.
- You need **durable, replayable, ordered** event history for many independent consumers → [Kafka](kafka.md) (which is durable pub/sub, but heavier).
- You need **guaranteed, acknowledged** delivery to a known recipient → a queue with acks / a durable stream, not ephemeral pub/sub.
- Updates are infrequent and a client can just **poll** → don't build a pub/sub + connection tier for a dashboard that refreshes every 30s ([realtime transports](../Networking/realtime-websockets-sse.md)).

## Common interview follow-ups

- *"How does a live comment reach everyone watching?"* → publish to the stream's topic; a pub/sub backplane fans it out to all gateways holding viewers' WebSocket connections; each pushes to its local clients.
- *"Subscriber was offline — does it get the message?"* → ephemeral pub/sub: no (fire-and-forget); durable (Kafka/Streams): yes, catches up by offset. Choose per requirement.
- *"Pub/sub vs a message queue?"* → broadcast to all subscribers vs deliver to one consumer.
- *"How do you fan out to millions across many servers?"* → broker backplane (Redis/Kafka) + connection-gateway tier + presence/topic routing.
- *"Redis Pub/Sub or Kafka?"* → lowest-latency live broadcast, lossy for offline → Redis; durable, replayable, ordered, multi-consumer → Kafka.

## Gotchas

- **Assuming delivery guarantees from ephemeral pub/sub** — Redis Pub/Sub drops messages for disconnected subscribers; use Streams/Kafka if you can't lose them.
- **Ignoring the fan-out/routing problem** — "use pub/sub" without explaining how a message finds connections spread across gateways is incomplete; you need a backplane + presence.
- **Hot topics** — a massively-subscribed channel concentrates fan-out load on one broker shard; shard the topic or fan out hierarchically.
- **Using pub/sub for one-consumer work** — broadcasting work that should be processed once causes duplicate processing; use a queue.
- **No backpressure** — a slow subscriber on a high-rate topic falls behind; buffer/drop policy or disconnect-and-resync.
- **Forgetting offline catch-up** — real-time clients reconnect after network blips; design resume-from-last-seen (durable topic / message IDs).

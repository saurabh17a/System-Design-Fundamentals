---
title: Real-Time — WebSockets, SSE, Polling
---

# Real-Time Transports: Polling vs SSE vs WebSockets — Deep Dive

> **Type:** Core concept
> **Tags:** `[networking]` `[realtime]` `[websockets]` `[sse]` `[push]`
> **Where it shows up:** [whatsapp](../../HLD/whatsapp.md), [fb-live-comments](../../HLD/fb-live-comments.md), [slack](../../HLD/slack.md), [google-docs](../../HLD/google-docs.md), [gaming-leaderboard](../../HLD/gaming-leaderboard.md), [online-auction](../../HLD/online-auction.md)

---

## Mental model

HTTP is request/response: the **client** asks, the **server** answers. Real-time features (chat, live comments, presence, notifications, collaborative editing, live prices) need the **server to push data to the client when something happens** — the opposite direction. The four techniques below are escalating answers to "how does the server tell the client about new data?", trading complexity for immediacy and bidirectionality.

The interview skill is picking the *least* complex option that meets the latency and directionality requirement: don't reach for WebSockets if periodic polling or one-way SSE suffices.

## The options

### 1. Short polling

The client asks "anything new?" on a fixed interval (every N seconds).

- **Pros:** trivially simple; plain HTTP; stateless; works everywhere.
- **Cons:** wasteful (most polls return nothing); latency bounded by the interval; scales badly (many clients × frequent polls = load even when idle).
- **Use when:** updates are infrequent and seconds of delay are fine (a dashboard refreshing every 30s, a [price-tracker](../../HLD/price-tracker.md) checked periodically).

### 2. Long polling

The client makes a request; the server **holds it open** until there's data (or a timeout), then responds; the client immediately re-requests.

- **Pros:** near-real-time without persistent protocols; works over standard HTTP/proxies/firewalls; a solid fallback when WebSockets aren't available.
- **Cons:** still per-message request overhead; holding many open requests ties up server connections; reconnection churn.
- **Use when:** you need low-latency push but want HTTP compatibility/simplicity, or as a WebSocket fallback.

### 3. Server-Sent Events (SSE)

A single long-lived HTTP connection over which the **server streams events to the client** (`text/event-stream`). **One-directional: server → client only.**

- **Pros:** simple (built on HTTP, native `EventSource` in browsers), **auto-reconnect and event IDs built in** (resume from last event), efficient for a stream of server updates.
- **Cons:** **server-to-client only** (client still uses normal HTTP requests to send); text-only; historically limited concurrent connections per domain over HTTP/1.1 (fine over HTTP/2).
- **Use when:** the server pushes a stream and the client rarely needs to send — live feeds, notifications, [fb-live-comments](../../HLD/fb-live-comments.md), live scores, progress updates, streaming LLM tokens.

### 4. WebSockets

A single TCP connection, upgraded from HTTP, that stays open for **full-duplex** (both directions, anytime) low-latency messaging.

- **Pros:** true **bidirectional**, lowest latency, low per-message overhead once established; ideal for interactive, chatty, two-way apps.
- **Cons:** **stateful** — every connection pins a client to a server, which complicates load balancing, scaling, and deploys; not plain HTTP (needs WS-aware infra, can be blocked by some proxies); you implement your own reconnect/heartbeat/auth; more operational weight.
- **Use when:** clients and server both send frequently and latency matters — chat ([whatsapp](../../HLD/whatsapp.md), [slack](../../HLD/slack.md)), collaborative editing ([google-docs](../../HLD/google-docs.md)), multiplayer, live bidding ([online-auction](../../HLD/online-auction.md)).

## Quick comparison

| | Short poll | Long poll | SSE | WebSocket |
|---|---|---|---|---|
| Direction | C→S (pull) | C→S (pull) | **S→C** | **bi-directional** |
| Latency | interval-bound | low | low | lowest |
| Connection | none held | held per req | 1 long-lived | 1 long-lived |
| Transport | HTTP | HTTP | HTTP | TCP (WS) |
| Reconnect | n/a | manual | **built-in** | manual |
| Server state | stateless | light | per-conn | **per-conn (sticky)** |
| Best for | rare updates | push w/ HTTP compat | server streams | interactive 2-way |

## Scaling the stateful options (the hard part)

SSE and especially WebSockets keep **millions of long-lived connections** open, which breaks the usual stateless-server model. The patterns interviewers want:

- **Connection servers / gateway tier:** a fleet whose only job is holding connections; business logic lives behind it. Scale this tier independently.
- **A pub/sub backplane:** when an event is produced, fan it out to the right connections — but a user's connection might be on *any* gateway node. Use a **pub/sub layer** ([Redis](../Caching/redis.md) pub/sub, or [Kafka](../Messaging/kafka.md)) so any node can publish and the node holding the target connection delivers it.
- **Presence & routing:** track which user is connected to which gateway (a presence store) so you can route a message to the right node.
- **Load balancing:** WebSockets need **sticky** routing (the connection lives on one server) and **connection draining** on deploy; L4 or WS-aware L7 [load balancers](load-balancers.md).
- **Heartbeats/timeouts:** detect dead connections (a client that vanished without closing) and reclaim resources.

This fan-out + presence + sticky-connection design *is* the [whatsapp](../../HLD/whatsapp.md)/[slack](../../HLD/slack.md) real-time answer.

## Tradeoffs & decisions

- **Immediacy vs simplicity** — polling is trivial but laggy/wasteful; WebSockets are instant but operationally heavy.
- **Directionality** — one-way server push (SSE) vs two-way (WebSocket). Don't pay for bidirectional if you only push.
- **Stateless vs stateful** — polling/long-poll keep servers stateless and easy to scale; SSE/WS pin connections and need a pub/sub backplane + presence.
- **Infra compatibility** — HTTP-based options traverse proxies/firewalls cleanly; WebSockets sometimes don't and need a fallback.

## Common interview follow-ups

- *"Polling, SSE, or WebSockets here?"* → pick by directionality + latency: rare updates → poll; one-way stream → SSE; interactive two-way → WebSocket.
- *"How do you scale millions of WebSocket connections?"* → dedicated connection-gateway tier + pub/sub backplane (Redis/Kafka) + presence routing + sticky LB + heartbeats.
- *"How does a message reach the right user if connections are spread across nodes?"* → presence store maps user→node; publish via pub/sub; the owning node delivers.
- *"What happens on disconnect / how do you not lose messages?"* → SSE event IDs to resume; for WS, sequence numbers + server-side buffering/acks; reconnect with last-seen offset.
- *"WebSockets and load balancers?"* → sticky/affinity routing + connection draining on deploy.

## Gotchas

- **Reaching for WebSockets by default** — if it's one-way push, SSE is simpler and gives reconnect/resume for free.
- **Forgetting the fan-out problem** — "use WebSockets" without explaining how a message finds a connection on another node is an incomplete answer.
- **Stateful connections vs stateless scaling** — long-lived connections complicate deploys (every restart drops connections); plan draining + reconnect.
- **No heartbeat** — half-open connections leak server resources; clients think they're connected but aren't.
- **Short-polling at scale** — thousands of clients polling every second is a self-inflicted DDoS; back off or switch transports.
- **Ignoring auth on long-lived connections** — tokens expire mid-connection; design re-auth/renewal.

# WhatsApp / Messenger — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[realtime]` `[websocket]` `[e2e-encryption]` `[mobile]`
> **Companies that ask this:** Meta, Apple, Telegram, Discord, Slack, Microsoft

---

## Beginner's Guide

### What's this in plain English?

You send "hi" to a friend on WhatsApp. They get it in a fraction of a second. Multiply that by 2 billion users and 100 billion messages a day. The system has to: keep millions of phones constantly "connected"; route messages instantly when both are online; queue them when offline; show typing/online/read indicators; encrypt everything end-to-end.

### Why solve it?

- **Real world**: WhatsApp, Telegram, Signal, Messenger.
- **Teaches**: real-time at scale, websockets/long-lived TCP, presence, end-to-end encryption (E2EE), mobile networking quirks.
- **Interview**: defining "real-time messaging" question.

### Vocabulary

- **Long-lived connection** — TCP/WebSocket open continuously between phone and server.
- **Presence** — online/offline/typing status; expensive at scale.
- **E2EE** — only sender and recipient can decrypt; server can't read.
- **Push notification** — fallback when app is backgrounded (APNs / FCM).
- **Group chat** — fan-out: send once → many recipients.
- **Read receipt** — "delivered", "read" indicators.

### High-level architecture

```
Phone A ←→ Connection Server ←→ Message Bus ←→ Connection Server ←→ Phone B
              (sticky)                                  (sticky)
                  ↓
              Storage (offline messages, history)
                  ↓
              Push (APNs/FCM) for offline recipients
```

Components:
1. **Connection server**: each phone holds a long-lived connection to one server.
2. **Routing**: server-to-server message bus (Kafka or custom).
3. **Storage**: short-term store-and-forward for offline recipients; chat history.
4. **Push**: when phone is offline/backgrounded, OS-level push wakes them up.
5. **E2EE**: sender encrypts with recipient's public key; server only sees ciphertext.

Group chat: server fans out to each member; for large groups, fan-out is the bottleneck.

### How to read this doc

- **Beginner**: focus on the connection model + offline delivery.
- **Interview**: cross-questions on E2EE, presence at scale, group chat fan-out.

---

## 0. How to use this doc in an interview

WhatsApp is the canonical **real-time messaging** question. Tests:
1. **Connection management** — millions of long-lived TCP connections.
2. **Message storage** — order guarantees, retention.
3. **Presence** — online/offline at scale.
4. **E2E encryption** — Signal Protocol; out-of-band keys; PFS.
5. **Group fan-out** — 256-member group sends one message → 256 deliveries.
6. **Offline delivery** — recipient offline; queue; deliver on reconnect.

Trap: not splitting **connection plane** (sticky, stateful) from **storage plane** (durable, sharded).

---

## 1. Problem Statement

A messaging app:
- 1:1 and group chat.
- Text, media (image, video, voice).
- Real-time delivery (< 200ms intra-region).
- Read receipts.
- Offline queueing; deliver on reconnect.
- E2E encryption.
- Presence (online/offline, last-seen).

Scale: 2 B users, 100 B messages/day.

---

## 2. Clarifying Questions

### Scope
- [ ] 1:1 only or groups too?
- [ ] Group size cap? (WhatsApp: 1024 currently.)
- [ ] Media only via cloud, or P2P?
- [ ] Voice/video calls in scope? (Out of scope for the chat question.)
- [ ] Multi-device support per user?
- [ ] E2E encryption — required or simplification?

### Scale
- [ ] DAU?
- [ ] Avg msgs/user/day?
- [ ] Avg group size?
- [ ] % time spent online?

### Non-functional
- [ ] Delivery latency target?
- [ ] Message retention? (We don't store delivered messages on servers in WhatsApp's model.)
- [ ] Offline buffer max?

> **For this doc:** 2B users, 1B DAU, 1:1 + groups (cap 1024), text + media URLs, multi-device per user (1 phone + N web/desktop), E2E enabled (Signal Protocol), no voice/video, sub-200ms intra-region delivery, 30-day server-side queue for undelivered messages.

---

## 3. Functional Requirements

**P0:**
1. Send/receive 1:1 messages.
2. Group chat: fan-out one send to all members.
3. Online presence + last seen.
4. Read receipts (delivered, read).
5. Offline queue; deliver on reconnect.
6. Multi-device: same account on multiple devices.
7. E2E encryption.
8. Media via separate uploader; share URL in message.

**P1:**
9. Reactions, replies, threads.
10. Typing indicators.
11. Message edit / delete.
12. Search local message history.

**P2:**
13. Voice/video calls.
14. Status / Stories.
15. Payments.

---

## 4. Non-Functional Requirements

| Dim | Target | Why |
|---|---|---|
| Availability | 99.99% | Core comm; outage = trust loss |
| Send-to-deliver P99 | < 500 ms | User-visible latency |
| Throughput | 1M+ messages/sec peak | Holiday spikes |
| Durability | Until delivered + 30 days for undelivered | Server keeps until confirmed delivered |
| E2E security | Signal Protocol — perfect forward secrecy | Industry standard |

---

## 5. Capacity Estimation

```
DAU                   = 1B
Msgs / DAU / day      = 30
Total / day           = 30B → 350k/s avg, ~3M/s peak
Avg msg size          = 100 bytes encrypted
Total bandwidth       = 3M × 100 = 300 MB/s ingress at peak
                        with media: dominated by media uploads (separate path)

Connections:
Concurrent online     ≈ 200M (20% of DAU online)
WS per server         ≈ 100k (modest)
Connection servers    = 200M / 100k = 2,000 servers
```

---

## 6. API

```
# Connection
WS /v1/connect    (long-lived; auth via JWT or session token)
  → server pushes new messages
  → client sends ACKs, presence, typing

# REST (out-of-band)
POST   /v1/messages    body: { recipient, ciphertext, msg_id }
GET    /v1/keys/{user_id}/devices    -> public key bundles
POST   /v1/media/upload                -> S3 URL
```

Message payload:
```
{
  msg_id:   uuid,
  sender:   user_id,
  recipient: user_id or group_id,
  ciphertext: bytes,    # E2E; server can't read
  timestamp: ms,
  type: text | image | etc.
}
```

---

## 7. Data Model

### Messages (Cassandra-like)
- `messages(user_id, timestamp DESC, msg_id, ciphertext, status)` — partitioned by recipient user_id, clustered by time.
- Stored only until delivered + ACKed; then deleted (WhatsApp model).
- Alternatively: keep for 30 days for undelivered; durable history if user permits.

### User devices (Postgres)
- `users(user_id, phone)`
- `devices(device_id, user_id, public_key_bundle, last_seen)`

### Connection state (Redis / in-memory)
- `presence:{user_id}` → `online|offline|last_seen_ts`
- `connection:{user_id}:{device_id}` → `connection_server_id`

---

## 8. Architecture

```
                     ┌──────────────────────────────┐
                     │   Mobile / Web / Desktop     │
                     └────────────────┬─────────────┘
                                      │ TLS + WebSocket
                                      ▼
                     ┌──────────────────────────────┐
                     │   Connection Servers (N)     │
                     │  - 100k WS per node          │
                     │  - sticky to user_id+device  │
                     │  - reads: pull pending msgs  │
                     │  - writes: forward to msg svc│
                     └──────────────┬───────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
       ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐
       │ Message Svc  │    │ Presence Svc │    │  Group Svc       │
       │ - persist    │    │ - online map │    │ - membership     │
       │ - dispatch   │    │ - last seen  │    │ - fan-out target │
       └──────┬───────┘    └──────────────┘    └──────────────────┘
              │
              ▼
       ┌──────────────────────┐
       │   Message Store      │
       │  (Cassandra)         │
       │  per-user inbox      │
       └──────────────────────┘
              │
              ▼
       ┌──────────────────────┐
       │   Routing             │
       │ - look up recipient's │
       │   connection server   │
       │ - push via internal   │
       │   RPC                 │
       └──────────────────────┘
```

### Send path (1:1)
```
1. Sender device → its connection server (over WS).
2. Connection server → Message Svc (gRPC).
3. Message Svc:
   - persist to recipient's inbox in Cassandra.
   - look up recipient's connection (via Redis presence).
   - if online: push to recipient's connection server → device.
   - if offline: leaves in inbox; recipient pulls on reconnect.
4. Sender gets ACK (server-side delivered).
5. When recipient ACKs: emit "delivered" + (later) "read" receipt back.
```

### Group send
```
1. Sender → connection server → Group Svc.
2. Group Svc fetches member list (cached; 1024 max).
3. Fan-out: for each member, write to their inbox + push to their connection.
4. Sender encrypts to *each* member's pubkey (Signal sender keys for groups).
```

---

## 9. Component Deep-Dives

### 9.1 Connection Servers
- Stateful. WS connections sticky to a server (LB uses session affinity).
- 100k WS/node; on M5.large-class, modest CPU; bottleneck is RAM.
- Heartbeats every 30s; idle conns reaped.
- On disconnect: presence flips to offline; pending messages stay in inbox.

### 9.2 Message Svc
- Stateless; horizontally scaled.
- Persist + dispatch. 
- Idempotent: same `msg_id` arriving twice = same outcome (use msg_id as primary key in inbox).

### 9.3 Presence Svc
- Hot path: every connect/disconnect updates presence.
- Storage: Redis (cluster). Each user has one entry.
- Subscribers: only contacts (your friends see your presence; not strangers).
- Pub/sub on per-user channel for "presence changed" → contacts get push.

### 9.4 Group Svc
- Membership in DB (Postgres or Cassandra).
- Cache hot groups in Redis.
- Fan-out is the work — one send → 1024 deliveries.

### 9.5 Multi-device
- Account → multiple devices (phone + 4 web).
- Phone is "primary"; can authenticate web devices.
- Each device has its own keypair.
- E2E: messages encrypted per-device. Sender encrypts the message N times (one per recipient device).
- Trade-off: bandwidth multiplication; mitigated by Signal "double ratchet" for keys.

---

## 10. Hard Sub-Problems

### 10.1 Maintaining millions of WS connections

- **Server sizing:** 100k WS/server with modest CPU; mostly idle; RAM is the bottleneck.
- **Health:** heartbeat every 30s; 3 missed = disconnect; client reconnects.
- **Sticky routing:** consistent hash of `user_id` decides connection server (or user's last server, cached).
- **Failover:** server dies → clients reconnect to a different server; presence svc updates.

### 10.2 Ordering guarantees

- Messages in a single conversation must arrive in order.
- Implementation: server assigns monotonic `seq_no` per `(sender, recipient_or_group)` pair.
- Client buffers out-of-order receives until predecessor arrives; if missing, requests resend.

### 10.3 Group fan-out at scale

- Average group: 10 members. Easy.
- Power-user group: 1024 members. 1024 deliveries per send.
- One viral message in a 1024-group = 1024 push notifications.
- Bottleneck: presence lookups + inbox writes.
- Optimization: batched inbox writes (one CQL multi-write); parallel pushes.

### 10.4 Offline delivery

- Recipient offline: write to inbox in Cassandra.
- TTL 30 days on undelivered messages.
- On reconnect: connection server pulls inbox; pushes to client.
- Client ACKs; server deletes.

### 10.5 E2E encryption (Signal Protocol)

- Each user has long-term identity key + ephemeral pre-keys.
- Sender encrypts with recipient's pubkey + own ephemeral.
- "Double ratchet" rotates keys per message (perfect forward secrecy).
- Server stores ciphertext blindly; can't read.
- Group: sender keys protocol — one symmetric key per group, distributed via 1:1 channels.

---

## 11. Bottlenecks & Scaling

| Load | Breaks | Fix |
|---|---|---|
| 10× | Single Redis presence cluster | Shard presence by user_id |
| 100× | Cassandra writes for big groups | Batch + per-region writes |
| 1000× | WS connection count | Add servers (linear) |
| Cross-region | Message routing across regions | Per-region inbox; cross-region forwarder |

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| WS over polling | Low latency, less overhead | Complex connection management |
| Server doesn't read messages (E2E) | Privacy | No server-side search, ML, anti-abuse on content |
| 30-day undelivered queue | Resilience to long offline | Storage cost |
| Per-recipient inbox in Cassandra | Predictable read perf | Multiple writes per group send |
| Sticky connection routing | Stateful; routing simpler | Failover requires reconnect |

---

## 13. Cross-Questions ≥ 15

### 13.1 Why WebSocket and not long polling?
- WS: full duplex, lower overhead, sub-100 ms push.
- Long polling: HTTP overhead per cycle (~few KB headers); higher latency; lots of zombie requests.
- WS is the modern answer; trade is connection state.

### 13.2 Why store messages in Cassandra vs Postgres?
- Volume: 100B/day → Cassandra's tunable consistency + horizontal scale fits.
- Access pattern is point insert + range scan by user — Cassandra's strength.
- Postgres would shard fine but Cassandra's operational tooling (multi-DC) is more mature for this access pattern.

### 13.3 Why per-user inbox vs per-conversation inbox?
- Per-user: one read query gets all pending messages → simpler client.
- Per-conversation: would need fan-out to per-conversation queues; client would query N convos.
- Per-user wins for the offline-delivery use case.

### 13.4 How does presence scale?
- 200M concurrent presences. Redis cluster sharded by user.
- Updates: at most one per device per 30s heartbeat.
- Reads: only by user's contacts. Cached client-side; refresh on view.

### 13.5 Why not use cloud push (APNs/FCM) for everything?
- Cloud push has latency (1-10s) + unreliability + rate limits.
- For active foreground apps, WS gives sub-100ms.
- Cloud push used for **wake-up** when app is backgrounded.

### 13.6 Why E2E (Signal Protocol)?
- Privacy by default; even server compromise doesn't reveal content.
- Cost: server can't help with search / abuse / ML.
- WhatsApp's product decision; competitors vary.

### 13.7 What if a user is on phone + web simultaneously?
- Each device has its own keypair.
- Sender encrypts N times (once per recipient device).
- All devices receive each message; client decrypts with its private key.
- Bandwidth cost: linear in device count (typically 1-3).

### 13.8 How to handle a user joining a 1024-member group mid-stream?
- New member sees messages from join time forward.
- Doesn't see history (E2E ratchet doesn't allow back-decryption).
- Some products allow message history sharing on opt-in (re-encrypt for new member); WhatsApp doesn't.

### 13.9 What happens during a network partition?
- Client disconnects; reconnects when back.
- Server side: presence flips offline; messages queued in inbox.
- On reconnect: catch up from last seen seq_no.

### 13.10 Why sticky routing for connections?
- All of a user's pending state (heartbeats, queued sends) on one server.
- Routing is simpler: presence map → server.
- Failover: server dies, client reconnects, gets new server.

### 13.11 How do you guarantee "delivered" receipt accuracy?
- Recipient's client ACKs after writing to local DB (not just receiving).
- Server marks delivered when ACK arrives.
- Sender sees "delivered" badge.
- "Read" requires client to mark message read in UI → ACK back.

### 13.12 What about media (images, videos)?
- Separate path: client uploads to S3-class store, gets URL.
- Encrypted at upload (client-side AES with random key).
- Message contains URL + key (encrypted to recipient).
- Receiver downloads from URL; decrypts.

### 13.13 What's the failure mode if connection server dies mid-send?
- Sender retries with same `msg_id`.
- Duplicate detected at server (idempotent).
- No double delivery.

### 13.14 How are messages ordered in a group?
- Server assigns `seq_no` per group on each message.
- Members see consistent order (server is single source of truth for that group).
- For decentralized ordering: vector clocks or CRDTs (more complex).

### 13.15 How would you add typing indicators?
- Out-of-band: separate WS channel/topic.
- Lossy: don't store; just propagate.
- Per-conversation; subscribed only when conversation open.

### 13.16 What about anti-abuse / spam?
- Hard with E2E (server can't see content).
- Signals: rate, group size (mass forward), reports.
- Forward limits (WhatsApp: max 5 forwards) — enforced client-side.
- Account banning based on metadata (fanout, reports).

### 13.17 Cross-region delivery?
- Per-region inbox.
- Sender in region A → recipient in region B: route via Message Svc; cross-region forward to recipient's home region.
- Adds ~150ms cross-region hop.

### 13.18 How would you reduce bandwidth for media?
- Compression (already done on encrypted blobs is moot — encrypt after compress).
- Server-side resizing not possible with E2E.
- Client uploads multiple resolutions; recipient picks.

---

## 14. Common Follow-Ups

### 14.1 Add voice/video calls
SFU architecture (Selective Forwarding Unit). E2E for audio streams. Out-of-scope here.

### 14.2 Add Status / Stories
24-hour ephemeral content. Different storage, different access pattern.

### 14.3 Add message edit/delete
Append edit event; client renders the latest. Delete is tombstone.

---

## 15. Cheat-Sheet Recap

1. **Connection plane:** WS, sticky routing, 100k/server.
2. **Storage plane:** per-user inbox in Cassandra.
3. **Presence:** Redis, sharded by user.
4. **E2E:** Signal protocol; server stores ciphertext blindly.
5. **Group fan-out:** server-side; one msg → N inbox writes.
6. **Multi-device:** per-device keys; sender encrypts N times.
7. **Offline:** 30-day inbox queue.

---

## Appendix A: Numbers

```
WhatsApp DAU            ~ 2 B
Msg/day                ~ 100 B
Concurrent online      ~ 200 M
WS / connection server  ~ 100 k
Group cap              1024 (was 256)
Avg msg size           ~ 100 bytes encrypted
```

## Appendix B: Compared to Telegram/Signal/Discord

```
                 WhatsApp        Signal           Telegram        Discord
E2E              all chats       all chats        opt-in          none
Cloud sync       no (P2P-ish)    no               yes             yes
Multi-device     phone primary   phone primary    fully indep.    fully indep.
Group cap        1024            1000             200,000         500
Voice/video      yes             yes              yes             yes
```

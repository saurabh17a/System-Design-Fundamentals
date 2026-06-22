# Slack / Discord — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[realtime]` `[channels]` `[fan-out]` `[search]`
> **Companies that ask this:** Slack, Discord, Microsoft Teams, Atlassian

---

## Beginner's Guide

### What's this in plain English?

Slack: like WhatsApp but for work, with **channels** (group rooms) and **threads** (sub-conversations). Everything's persistent and searchable. Hundreds of people in a channel see a message instantly. The system: handle real-time delivery to many subscribers, persist all messages, full-text search across millions of historical messages.

### Why solve it?

- **Real world**: Slack, Discord, Microsoft Teams.
- **Teaches**: real-time fan-out, channel-level pub-sub, durable message storage, search at scale.

### Vocabulary

- **Channel** — group room; broadcast scope.
- **Thread** — replies attached to a parent message.
- **DM** — direct message (1-to-1).
- **Mention / @user** — tagged user gets notified.
- **Workspace** — tenant; isolation boundary.
- **Search** — full-text + filters across history.

### High-level architecture

```
User → WebSocket Gateway → [Channel Service] → fan-out to subscribers
                                ↓
                          Message Store (durable, partitioned)
                                ↓
                          Search Index (Elasticsearch)
```

Components:
1. **Connection layer**: WebSocket per user; sticky to gateway.
2. **Channel service**: routes messages to all subscribers of the channel.
3. **Message store**: every message persisted with timestamp; partition by channel.
4. **Search**: indexed asynchronously.
5. **Notification fallback**: mobile push when offline.

Channel fan-out is the key complexity: a popular channel with 5000 members → one message → 5000 deliveries.

### How to read this doc

- **Beginner**: focus on channel pub-sub vs DM 1-to-1.
- **Interview**: cross-questions on huge channels, search at scale, multi-workspace isolation.

---

## 0. How to use this doc

Slack/Discord extends the WhatsApp model with **channels (multi-user)** and **threads**. Unlike WhatsApp, messages are server-stored, searchable, and history is durable. Tests:
1. Channel fan-out (many subscribers per channel).
2. Threading.
3. Search across messages.
4. Presence at scale.

---

## 1. Problem Statement

A team chat app:
- Workspaces with channels (public + private).
- Direct messages.
- Threaded replies.
- Reactions, mentions, file uploads.
- Search across messages.
- Presence.
- Real-time delivery.

---

## 2. Clarifying Questions

- [ ] Workspace size — small team or 100k member orgs?
- [ ] DM + group DM in scope?
- [ ] Voice/video calls?
- [ ] File uploads?
- [ ] E2E or server-readable (for search)?

> **Assume:** large orgs (up to 100k members), public + private channels + DMs, no voice, file uploads via S3, server-readable for search.

---

## 3. Functional Requirements

**P0:**
1. Send/receive in channels.
2. Subscribe to channels (visible in left rail).
3. Threading: reply in thread.
4. Mentions notify recipient.
5. Search across all messages.
6. Reactions.
7. File uploads.
8. Presence (online/away/offline).

**P1:**
9. Pinned messages.
10. Bookmarks.
11. Read state per channel (unread count).
12. Workflow integrations.

**P2:**
13. Voice/video.
14. Bots / apps.
15. Compliance exports.

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.99% |
| Send-to-deliver | < 500 ms |
| Search latency | < 500 ms |
| Throughput | 200k messages/sec peak |
| History retention | unlimited (paid); 90 days (free) |

---

## 5. Capacity Estimation

```
DAU per workspace: avg 1000; max 100k
Active workspaces: 1M
Messages/DAU/day: 100
Total messages/day: 100B (mostly DMs + small channels)
Peak msg/sec: 200k
File uploads/day: 1B
```

---

## 6. API

```
WS /v1/connect               (per-user subscription)
POST /v1/messages            body: {channel_id, text, thread_ts?}
POST /v1/channels/{id}/join
GET  /v1/channels/{id}/messages?from=&to=
GET  /v1/search?q=
POST /v1/files/upload         -> S3 URL
```

Message: `{id, channel_id, user_id, text, ts, thread_ts?, reactions, files[]}`.

---

## 7. Data Model

### Messages (Cassandra, partitioned by channel_id)
- `(channel_id, ts, message_id, user_id, text, thread_ts, reactions, files)`

### Channels (Postgres)
- Channel metadata.

### Channel members (Postgres / Cassandra by user_id)
- `(user_id, channel_id, last_read_ts)`

### Search index (Elasticsearch)
- Full-text per message.

---

## 8. Architecture

```
              Clients
                │ WS
                ▼
          Connection Servers (per-user sticky)
                │
         ┌──────┴──────────────┐
         ▼                     ▼
  Message Service         Channel Service
   - persist                - membership
   - fan-out via            - search routing
     channel topic
         │
         ▼
   Kafka per-channel topic
         │
         ▼
   Connection servers subscribed to topics they
   have viewers for; push to clients.

   Search → Elasticsearch
   Files → S3
```

---

## 9. Component Deep-Dives

### 9.1 Channel fan-out
- Per-channel Kafka topic.
- Connection servers subscribe to topic for active channels among their connected clients.
- Trade-off: many topics; manage with topic-per-tenant clustering.

### 9.2 Threading
- Reply has `thread_ts` parent ts.
- Storage: same partition (channel); query "fetch thread" by parent ts.

### 9.3 Search
- Async index to Elasticsearch.
- Per-tenant index; queries scoped by workspace + permissions.

### 9.4 Presence
- Same as WhatsApp: Redis with online state.
- Subscriber notified of contacts' presence changes.

### 9.5 Read state
- Per-user-per-channel `last_read_ts`.
- Unread count = messages with ts > last_read_ts.

---

## 10. Cross-Questions ≥ 12

### 10.1 vs WhatsApp?
- Slack: channels (broadcast), durable history, server-readable for search.
- WhatsApp: 1:1 + small groups, server-blind (E2E), no search.

### 10.2 Why per-channel Kafka topic?
- Fan-out scoped per channel.
- Channel busy → its topic partitions scale independently.

### 10.3 Threading storage?
- Same channel partition; messages sorted by ts.
- Threads queryable by parent ts (secondary).

### 10.4 100k-member channel?
- Fan-out goes to all 100k WS connections.
- Connection servers subscribe to topic; push to local clients.
- Storage: every member has the message in their inbox? No — channel storage is shared; per-user "unread count" tracks position.

### 10.5 Search authorization?
- Index includes channel_id + visibility.
- Query filters on user's accessible channels.

### 10.6 File upload flow?
- Client requests presigned S3 URL; uploads directly.
- Message contains URL; server-side virus scan async.

### 10.7 Channel mute / notification settings?
- Per-user-per-channel preference.
- Routing layer applies before push.

### 10.8 Workspace partitioning?
- Each workspace = isolated tenant.
- Cassandra: namespace by workspace_id in partition keys.

### 10.9 What if you join a channel mid-day?
- Member added; visible in your sidebar.
- No backfill push; you see history when you scroll.

### 10.10 How are read receipts handled?
- Click → update last_read_ts.
- For per-message read tracking: out-of-band events.

### 10.11 Cross-region?
- Per-region workspace residency.
- Cross-region for distributed teams: replication of channels.

### 10.12 Mentions delivery?
- Parser at message ingest extracts @mentions.
- Notification fired (push + in-app).

---

## 11. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| Server-readable | Search, integrations | E2E privacy |
| Per-channel topic | Clean fan-out | Many topics to manage |
| Async index | Fast send | Search lag (~few sec) |
| Sticky WS routing | State management | Failover requires reconnect |

---

## 12. Cheat-Sheet

1. **Channels = Kafka topics**; connection servers subscribe per active channel.
2. **Cassandra** for channel-partitioned message storage.
3. **Elasticsearch** for full-text search async.
4. **S3** for files; presigned uploads.
5. **Threading**: parent_ts pointer.
6. **Per-user last_read_ts** for unread counts.
7. **Server-readable** (vs WhatsApp E2E) enables search & integrations.

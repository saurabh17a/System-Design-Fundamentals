# FB / YouTube Live Comments — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[realtime]` `[fan-out]` `[ranking]` `[sampling]`
> **Companies that ask this:** Meta, YouTube, Twitch, Twitter Spaces

---

## Beginner's Guide

### What's this in plain English?

A celebrity goes live. 10 million viewers tune in. Comments pour in at 100k/sec. Each viewer sees a few new comments per second on their screen. The system: ingest the firehose, fan out to viewers in near-real time, rank/sample comments so noise gets filtered.

### Why solve it?

- **Real world**: FB Live, YouTube Live, Twitch chat, Twitter Spaces.
- **Teaches**: massive fan-out, sampling/ranking on the fly, websockets at scale, hot keys (one stream).

### Vocabulary

- **Stream** — the live broadcast.
- **Comment ingest** — write rate; can be 100k/sec.
- **Fan-out** — each comment to many viewers.
- **Sampling** — show only a representative subset (no human can read 100/sec).
- **Ranking** — top comments by engagement, recency.

### High-level architecture

```
Comment writers → Comment Ingest API → Kafka → Sampler/Ranker → Distribution Layer
                                                                       ↓
                                                                 Viewers (WebSocket)
```

Components:
1. **Ingest API** — accepts comments, validates, dedupes.
2. **Sampler** — picks ~5/sec from 100k/sec to actually show.
3. **Ranker** — scores comments by engagement, author, etc.
4. **Distribution** — websocket per viewer; per-stream pub/sub.
5. **Storage** — short-term for the live; archival after.

Sampling is the secret. You can't show every comment; show ones likely to engage viewers.

### How to read this doc

- **Beginner**: focus on the sampling concept.
- **Interview**: cross-questions on celebrity scale, abuse filtering, late-arriving comments.

---

## 0. How to use this doc in an interview

Live comments stress the **fan-out + real-time + ranking-on-the-fly** combination. Tests:
1. **Fan-out at celebrity scale** — one stream, 10M concurrent viewers receive each comment.
2. **Backpressure / sampling** — when chat is firehose, you can't show every comment.
3. **Ranking** — pin author/mods, suppress spam, surface popular.
4. **Push delivery** — SSE vs WebSocket vs long polling.

Trap: assuming naive broadcast scales. At 10M viewers × 100 comments/sec = 1B push events/sec. Fan-out architecture dominates.

---

## 1. Problem Statement

For a live video stream:
- Viewers post comments in real time.
- Other viewers see comments instantly (sub-second).
- Stream may have 1 to 10M+ concurrent viewers.
- Author / mods / verified are surfaced; spam / abuse hidden.

---

## 2. Clarifying Questions

- [ ] Single global stream or per-region copies?
- [ ] Comment retention — store forever or live only?
- [ ] Replies / threading?
- [ ] Reactions (heart, like) separately?
- [ ] Anti-abuse: how aggressive?
- [ ] Author moderation tools?

> **Assume:** global; comments stored 30 days; flat (no replies); reactions separate; aggressive anti-abuse; mod tools.

---

## 3. Functional Requirements

**P0:**
1. Post comment.
2. Stream comments to all viewers, ranked.
3. Per-stream chat (one stream, one room).
4. Spam filtering pre-publish.
5. Mod actions (delete, ban).

**P1:**
6. Pin author/mod comments.
7. Reactions (separate channel).
8. Sampling for whales (only top-K shown).

**P2:**
9. Replies.
10. Multi-language translation.
11. Donation / superchat.

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Availability | 99.99% |
| End-to-end latency | < 1 s comment → all viewers |
| Throughput | 100k comments/sec peak (one mega-stream) |
| Fan-out | 10M concurrent viewers → 1T push events/day on a viral stream |

---

## 5. Capacity Estimation

```
Mega stream: 10M viewers.
Comments/sec: depends on stream; can spike to 10k/s or more.
Fan-out: 10M viewers × 1k comments/min = 10B msg/min = 170M/sec push events.
Reality: we don't show every comment to every viewer (sampling).
After sampling: ~100 comments/sec to each viewer.
Total: 10M × 100 = 1B push events/sec system-wide (still huge; sharded).
```

---

## 6. API

```
WS /v1/streams/{stream_id}/comments  (subscribe)
POST /v1/streams/{stream_id}/comments    body: { text }
DELETE /v1/comments/{id}                 (mod)
```

Server pushes batched comments every ~100 ms.

---

## 7. Data Model

### Comments (Cassandra, partitioned by stream_id, clustered by ts)
- `(stream_id, ts, comment_id, user_id, text, score, status)`

### Membership / connection state (Redis)
- `stream:{id}:viewers` — set of connected device IDs.
- `viewer:{device}:server` — which connection server holds this viewer.

---

## 8. Architecture

```
                ┌──────────────────────────┐
                │   Viewers (web / app)    │
                └────────────┬─────────────┘
                             │ WS or SSE
                             ▼
                ┌──────────────────────────┐
                │ Connection Servers       │
                │  - 100k WS/server        │
                │  - subscribed to stream  │
                └────────────┬─────────────┘
                             │ pub/sub
                             ▼
                ┌──────────────────────────┐
                │  Stream Bus              │
                │  (Kafka/Redis pubsub)    │
                │  topic: stream-{id}      │
                └────────────┬─────────────┘
                             ▲
                             │
                ┌──────────────────────────┐
                │  Comment Ingest          │
                │  - moderation            │
                │  - ranking               │
                │  - sampling              │
                │  - persist               │
                └────────────┬─────────────┘
                             ▲
                             │
                ┌──────────────────────────┐
                │  Posters (mobile/web)    │
                └──────────────────────────┘
```

### Send path
```
1. Client posts.
2. Ingest svc: spam check, slow-mode rate-limit, persist to Cassandra.
3. Ranker assigns score (author > mod > verified > popular > rest).
4. If passes sample threshold: publish to stream bus.
5. Connection servers subscribed to that stream's topic receive; fan out to their connected viewers.
6. Viewer's client receives.
```

---

## 9. Component Deep-Dives

### 9.1 Ingest + sampling
- 10k comments/sec on a mega stream is too many to display.
- Reservoir-sample top K (~100/sec) by score.
- Always include author, mods, verified, hi-engagement.

### 9.2 Connection server fan-out
- Subscribed to per-stream Kafka topic.
- One subscription per server per stream they hold viewers for.
- For each msg from topic: push to all viewers of that stream connected here.
- 100k viewers × 100 msg/sec = 10M outbound writes/sec per server. Tight; split by hot streams.

### 9.3 Mod actions
- Delete: write tombstone; connection servers receive tombstone msg; clients hide.
- Ban: API; ingest svc rejects future from that user.

---

## 10. Hard Sub-Problems

### 10.1 Fan-out at celebrity scale
- Without sharding: single Kafka partition per stream → bottleneck.
- Solution: per-stream topic with multiple partitions; connection servers subscribed to all partitions for that stream.
- Hot stream: more partitions; servers parallel-subscribe.

### 10.2 Sampling correctness
- Author/mod/superchat: ALWAYS shown.
- Verified / large-following: high score.
- Random user: low score; sampled.
- Score recomputed every burst; reservoir sampling for fairness.

### 10.3 Late join replay
- Viewer joins mid-stream: fetch last N seconds of comments via REST.
- Then subscribe to live stream.

---

## 11. Bottlenecks

| Load | Breaks | Fix |
|---|---|---|
| 10× viewers | Fan-out per server | Add servers; partition stream topic |
| 100× streams | Kafka topic count | Multi-cluster; per-tenant Kafka |
| Spam wave | Ingest bottleneck | Pre-LB rate limit per IP |

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| Sampling at scale | Manageable client load | Some comments not shown |
| Per-stream Kafka topic | Clean fan-out | Many topics to manage |
| WS push | Low latency | Connection state |
| Eventual consistency on mod | Fast mod actions | Brief window where deleted comment visible |

---

## 13. Cross-Questions ≥ 12

### 13.1 Why sample comments?
At 10k/sec, viewers can't read 10k/sec. Sampling preserves UX; otherwise chat is a meaningless blur.

### 13.2 Why per-stream Kafka topic?
Isolated; enables per-stream partition scaling. Trade: many topics. Acceptable.

### 13.3 Why not just store and let clients pull?
Polling at 10M concurrent viewers = 10M QPS minimum. Push is mandatory.

### 13.4 How is a deleted comment hidden after-the-fact?
Tombstone published to topic. Connection servers replay tombstone to viewers; clients hide.

### 13.5 What about replays?
After stream ends, all comments persisted. VOD viewers fetch in time-ordered chunks; client plays at video-time pace.

### 13.6 What about super-chats / paid prominence?
Ingest gives them top score → always shown. Stored in Cassandra with `is_superchat` flag.

### 13.7 How do you handle abusive content?
- Pre-publish: profanity filter, spam classifier (ML).
- Post-publish: user reports → fast removal.
- Mass abuse: IP/user rate-limit + temporary ban.

### 13.8 What's the max viewers per server?
~100k WS connections per modest server (RAM-bound). Go/Erlang shine here.

### 13.9 Why SSE over WS in some implementations?
SSE is HTTP-friendly (proxies, CDN), simpler. WS allows client-to-server push (typing). For comments: SSE is enough for receive; WS is symmetric.

### 13.10 How to scale across regions?
- Per-region cluster.
- Cross-region: forward to all regions (Kafka mirror).
- Latency: ~150ms cross-region; acceptable for most viewers.

### 13.11 What's the failure mode if Kafka partition is lagging?
Connection servers fall behind on push; viewers see delayed comments. Auto-recover by catching up; alert on lag > 5s.

### 13.12 How to enforce slow mode (1 comment/min/user)?
Rate limit at ingest svc per `(user, stream)`; reject excess with 429.

---

## 14. Follow-Ups

### 14.1 Reactions (hearts, likes)
Separate per-stream counter (Redis HyperLogLog or sharded counter). Pushed at lower frequency.

### 14.2 Replies / threads
Add `reply_to_id` to comments; client renders thread.

### 14.3 Translation
Per-locale translation pre-fanout. Cost: N× the fan-out; cache common translations.

---

## 15. Cheat-Sheet

1. **Per-stream Kafka topic** for fan-out.
2. **Connection servers** subscribe; push to viewers.
3. **Sampling** on hot streams; never show all.
4. **Author/mod/verified always shown.**
5. **Tombstones** for mod deletes.
6. **WS/SSE** for sub-second push.

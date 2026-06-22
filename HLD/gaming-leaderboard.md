# Real-time Gaming Leaderboard — High-Level Design

> **Difficulty:** Medium → Hard
> **Tags:** `[hld]` `[realtime]` `[redis-zset]` `[sharding]` `[time-windows]`
> **Companies that ask this:** Riot, Blizzard, Roblox, Epic, mobile game studios

---

## Beginner's Guide

### What's this in plain English?

A multiplayer game has 100 million players. After every match, scores update. The game shows: "Top 100 worldwide", "your rank in your country", "your friends' rankings". Updates need to feel real-time. The system: sorted score data with fast top-K queries and fast rank lookups.

### Why solve it?

- **Real world**: gaming leaderboards (Fortnite, League), Strava segments, ad networks.
- **Teaches**: Redis sorted sets (ZSET), sharding, time-windowed leaderboards (daily/weekly/all-time), percentile ranks.

### Vocabulary

- **Top-K** — top 100 (or whatever) sorted by score.
- **Rank** — position of a specific user.
- **Sorted Set / ZSET** — Redis data structure: member with score, kept sorted.
- **Time window** — daily / weekly / all-time leaderboards.
- **Sharding** — split leaderboard across machines (by region, by score range).

### High-level architecture

```
Match end → Score update API → Redis ZSET (per leaderboard scope)
                                        ↓
                               Top-K + Rank queries
```

Components:
1. **Score ingest** — batched writes to ZSETs.
2. **ZSET per scope** — global, country, region, daily, weekly.
3. **Top-K query** — `ZREVRANGE 0 99` — instant top 100.
4. **Rank query** — `ZREVRANK key user` — O(log N).
5. **Sharding** — for huge games, partition by user ID; merge top-K across shards.

### How to read this doc

- **Beginner**: focus on Redis ZSET semantics.
- **Interview**: sharding strategies, percentile rank, anti-cheat.

---

## 0. How to use this doc in an interview

Tests **Redis ZSET sharding + time windows + percentile rank**. Tests:
1. Top-K queries (top 100 globally, top 10 in country).
2. "What's my rank?" for any player.
3. Time windows (daily, weekly, all-time).
4. Hot leaderboards (popular game).

---

## 1. Problem Statement

A real-time leaderboard:
- Players earn scores in a game.
- Top-K leaderboard updates in real time.
- Per-region, per-time-window.
- Millions of players; thousands of QPS reads.

---

## 2. Clarifying Questions

- [ ] Single global leaderboard or per-region?
- [ ] Time windows? (daily, weekly, all-time)
- [ ] Score semantics — increment or replace?
- [ ] How many players?

> **Assume:** per-region + global; daily + weekly + all-time; cumulative (increment); 100M players.

---

## 3. Functional Requirements

**P0:**
1. Submit score (increment for player).
2. Get top-K leaderboard (global, regional, friends).
3. Get player's rank.
4. Multiple time windows.

**P1:**
5. Friends-only leaderboard.
6. Tier-based (bronze, silver, gold).

**P2:**
7. Personalized (relative to friends).

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.99% |
| Score update P99 | < 100 ms |
| Top-K read | < 50 ms |
| Throughput | 100k score updates/sec |

---

## 5. Capacity Estimation

```
Players: 100M
Scores/sec: 100k peak
Top-K reads/sec: 1M peak (everyone refreshes leaderboard)
Memory for ZSET: 100M players × ~50 bytes = 5 GB per leaderboard
Times # of windows × regions ~ 100 GB
```

---

## 6. API

```
POST /v1/scores       body: {player_id, score, region}
GET  /v1/leaderboard?window=daily&region=us&top=100
GET  /v1/players/{id}/rank?window=daily&region=us
```

---

## 7. Data Model

### Redis ZSETs (one per leaderboard)
- Key: `lb:{window}:{region}` — score = total score, member = player_id.
- For "all players score": one ZSET.
- For "top 100": ZRANGE.
- For "rank of player X": ZRANK.

### Sharding (by player_id range or hash)
- Single ZSET caps at memory of one Redis instance.
- 100M entries × 50 bytes = 5 GB → fits in one Redis but contention high.
- Shard by player_id hash → N ZSETs per leaderboard.
- Top-K via merge across shards.

### Persistence (Postgres / Cassandra)
- Append-only score events (audit, recovery).

---

## 8. Architecture

```
              ┌──────────────────────┐
              │  Game Servers        │
              └──────────┬───────────┘
                         │ score events
                         ▼
                ┌────────────────────┐
                │  Score Ingest      │
                │  - persist event   │
                │  - update Redis    │
                └────────┬───────────┘
                         │
                ┌────────▼───────────┐
                │  Redis (sharded)   │
                │  ZSET per          │
                │  (window, region)  │
                └────────┬───────────┘
                         │
                ┌────────▼───────────┐
                │  Read API          │
                │  - merge shards    │
                │  - cache top-K     │
                └────────────────────┘

                ┌────────────────────┐
                │  Window Roller     │  (cron: roll daily/weekly)
                └────────────────────┘
```

---

## 9. Component Deep-Dives

### 9.1 Score ingest
- Score event → Cassandra append (audit).
- ZINCRBY on Redis ZSET (atomic).
- For multiple windows: increment all relevant ZSETs (daily, weekly, all-time).

### 9.2 Top-K read
- ZREVRANGE WITHSCORES → top K.
- For sharded: ZREVRANGE on each shard; merge top K of each → final top K.
- Cache top K in app for ~1 sec.

### 9.3 Player rank
- ZREVRANK on the player's shard gives shard-local rank.
- For global rank with sharded ZSETs: harder; need sum of "players ahead in any shard."
- Approximation: per-shard rank summed.
- Exact: Z-score-based comparison across shards (expensive).

### 9.4 Window rolling
- Daily: at midnight, copy current daily ZSET to "yesterday-daily" archive; clear daily.
- Weekly: similar.
- All-time: never reset.

---

## 10. Hard Sub-Problems

### 10.1 Sharding for huge leaderboards
- 100M players × multiple windows → can't fit in one Redis.
- Shard by player_id hash; N ZSETs.
- Top-K: ZREVRANGE first K from each shard; merge.

### 10.2 Exact rank across shards
- Hard if sharded.
- Approach: count of players with score > my_score across all shards.
- Sum over shards = exact rank.
- Cost: O(shards) ZCOUNT calls.

### 10.3 Hot leaderboards
- One viral game → high read QPS on its leaderboard.
- Cache top K in app server memory.
- Refresh every ~1 sec.

### 10.4 Score updates ordering
- Not strict global order needed.
- ZINCRBY is atomic; race-safe.

---

## 11. Cross-Questions ≥ 12

### 11.1 Why Redis ZSET?
- Built-in sorted set with rank operations.
- O(log N) insert; O(log N + K) range query.
- Sub-ms.

### 11.2 Why shard?
- Single Redis caps at ~10s of GB memory practically.
- Single shard QPS limited; sharding linearly scales reads/writes.

### 11.3 What's the cost of cross-shard top-K merge?
- Each shard returns its top K.
- Merge K × N sorted lists → top K. O(K × N log N).
- For K=100, N=10 shards: trivial.

### 11.4 What about ties?
- Default ZSET: lexicographic on member ID.
- Use composite score (e.g. `score - small_ts/1e9`) for tiebreak by recency.

### 11.5 How is "friends leaderboard" done?
- Pull friends list (N entries).
- For each: ZSCORE to get their score.
- Sort.
- Cost: N round-trips; pipelined → fast.

### 11.6 How does window roll work?
- At window boundary, schedule a "freeze" job.
- Snapshot current ZSET to archive key.
- Clear the live ZSET.
- Cost: one ZUNIONSTORE-like operation.

### 11.7 What if Redis crashes?
- Replicated.
- Persistence: AOF or RDB snapshots.
- Audit log in Cassandra: can rebuild ZSET if Redis lost.

### 11.8 How does cross-region merge happen?
- Per-region ZSETs.
- Global ZSET = union of regions periodically.
- Or query API merges on demand.

### 11.9 What about cheating / score validation?
- Validate at ingest: max possible score per game session.
- Anomaly detection.
- Anti-cheat is its own system.

### 11.10 How are tier promotions / demotions handled?
- Periodic batch: read top X% → promote to next tier.
- Tier represented as separate ZSET.

### 11.11 What's the failure mode under burst (game goes viral)?
- Score writes still work.
- Top-K reads cached; staleness 1 sec.
- Redis CPU might spike; alert + scale shards.

### 11.12 How is cold startup (new player) handled?
- New player: ZADD with score 0.
- They appear at bottom of leaderboard.

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| Redis ZSET | Sub-ms; built-in rank | Memory cost |
| Sharded | Scales | Cross-shard merge complexity |
| Cassandra audit | Recovery | Storage |
| Cached top-K | Fast reads | Slight staleness |

---

## 13. Cheat-Sheet

1. **Redis ZSET** per leaderboard.
2. **Sharded** by player_id hash for scale.
3. **Score updates**: ZINCRBY (atomic) + audit log.
4. **Top-K**: ZREVRANGE per shard + merge.
5. **Rank**: ZREVRANK (per shard) or cross-shard ZCOUNT.
6. **Window rolling**: snapshot at boundary.
7. **Cache top-K** in app for hot reads.

# YouTube Top-K (Trending Videos) — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[streaming]` `[top-k]` `[probabilistic]` `[count-min-sketch]`
> **Companies that ask this:** Google, Meta, TikTok, Twitter, Spotify

---

## Beginner's Guide

### What's this in plain English?

YouTube has billions of views per day across billions of videos. "What are today's top 10 trending videos?" The naive answer (count every view, sort by count) doesn't scale — you'd be sorting billions of entries.

The trick: **approximate** the answer using probabilistic data structures (Count-Min Sketch, heavy-hitters algorithms). Tiny memory, mostly correct.

### Why solve it?

- **Real world**: trending videos, hot tags, frequent search queries, top advertisers.
- **Teaches**: streaming algorithms, approximate vs exact, Count-Min Sketch, heavy hitters.

### Vocabulary

- **Top-K** — find the K most frequent items.
- **Streaming** — items arrive in a flow; can't store them all.
- **Count-Min Sketch** — probabilistic counter; small memory, slight overestimate.
- **Heavy hitters** — items with frequency above a threshold.
- **Approximate** — close-enough answers in exchange for huge memory savings.

### High-level architecture

```
Click stream → Kafka → Stream processors → Sketch + heap (per shard)
                                                ↓
                                       Periodic merge → Top-K
```

Components:
1. **Click events** — streamed in.
2. **Per-shard** count-min sketch + small heap of "most frequent so far."
3. **Aggregator** — merges shards' top-K into global top-K periodically.

Memory: instead of `O(unique_videos)`, we use `O(K * num_shards)`. Works because most videos have very few views; only the popular ones matter.

### How to read this doc

- **Beginner**: focus on the count-min sketch concept.
- **Interview**: cross-questions on accuracy, late events, memory budget.

---

## 0. How to use this doc in an interview

Tests **streaming top-K + approximate counting**. Tests:
1. Why simple "count + sort" fails at scale.
2. Count-min sketch for memory-bounded counting.
3. Min-heap of size K for tracking top.
4. Multiple time windows (last hour, day, week).

---

## 1. Problem Statement

Display the top-K trending videos in real time:
- Counts views per video, per time window (last hour / day / week).
- Real-time updates (lag <1 min).
- Memory-bounded (can't track every one of 10B videos exactly).

---

## 2. Clarifying Questions

- [ ] How big is K? (Top 10? 100? 1000?)
- [ ] Time windows?
- [ ] Per-region or global?
- [ ] Approximate OK or exact required?

> **Assume:** K=1000; windows = last 1 hr, 24 hr, 7 days; per-region; approximate (top-K with high precision).

---

## 3. Functional Requirements

**P0:**
1. Ingest view events.
2. Maintain top-K per window.
3. Real-time API: `GET /top-k?window=1h`.
4. Per-region top-K.

**P1:**
5. Trending categories.
6. Personalized trending.

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.99% |
| Top-K refresh lag | < 1 min |
| Throughput | 1M view events/sec peak |
| Memory | Bounded — count-min sketch + heap |

---

## 5. Capacity Estimation

```
Videos: 10B total
Active videos (viewed in last hour): ~10M
Views/sec: 1M
Per-region (5 regions): 200k/sec each
Exact count of all 10B videos: not feasible in memory
```

---

## 6. API

```
POST /v1/views    body: {video_id, user_id, ts, region}
GET  /v1/trending?window=1h&region=us  -> [video_ids...]
```

---

## 7. Architecture

```
              ┌──────────────┐
              │ View events  │
              └──────┬───────┘
                     │
                     ▼
              ┌──────────────┐
              │ Kafka         │
              └──────┬───────┘
                     │
                     ▼
              ┌──────────────────────┐
              │ Stream Processor     │
              │ - per-window state   │
              │ - count-min sketch   │
              │ - top-K min-heap     │
              └──────┬───────────────┘
                     │
                     ▼
              ┌──────────────┐
              │  Redis cache │ (per region per window: top-K list)
              └──────────────┘
                     │
                     ▼
              ┌──────────────┐
              │  Trending API │
              └──────────────┘
```

---

## 8. Algorithm: Top-K with Count-Min Sketch + Min-Heap

```
For each video event:
  1. Increment count in CMS for that video_id.
  2. Estimate this video's count from CMS.
  3. If count > min in heap of size K:
       - Add to heap.
       - Pop min if size > K.

Top-K = current heap contents.
```

### Count-Min Sketch (CMS)
- 2D array of counters: depth (d) × width (w).
- d hash functions; each maps video_id → bucket.
- Increment all d buckets.
- Estimate = min over d buckets.
- Memory: ~MB for billions of items with high precision.

### Min-Heap of size K
- Stores current top-K.
- Replace min with new candidate if count exceeds.
- Memory: K × 24 bytes ≈ 24 KB for K=1000.

### Why combine?
- CMS gives count without storing every video_id.
- Heap gives top-K efficiently.
- Together: O(K + sketch size) memory; one pass.

---

## 9. Component Deep-Dives

### 9.1 Multiple windows
- Need separate state per window (1h, 24h, 7d).
- Sliding window: maintain N sub-windows; add/remove at boundaries.
- E.g. 1-hour window = 6 × 10-min sub-windows. Add new; drop oldest.

### 9.2 Per-region
- Independent stream processor per region.
- Top-K stored per region.

### 9.3 Stream processor (Flink)
- Stateful: holds CMS + heap per region per window.
- Checkpointed for restart.
- Output: top-K snapshot every 30 sec to Redis.

### 9.4 Redis cache
- Key = `top:{window}:{region}` → list of (video_id, count).
- TTL = 1 min (refreshed by stream).
- API reads here.

---

## 10. Hard Sub-Problems

### 10.1 Heavy hitters
- Count-min sketch may underestimate items just above K threshold.
- Mitigation: keep candidates with count near min separately ("approximate top-K").

### 10.2 Sliding window with eviction
- For sliding 1-hour: when sub-window expires, decrement counts.
- CMS doesn't support negative; use multiple CMS (one per sub-window) and sum.

### 10.3 Hot keys
- Most-viewed video gets 100k events/sec.
- Sub-key partition: video_id → 4 shards; each shard has its own CMS+heap; merge.

### 10.4 Cross-region trending (global top-K)
- Merge per-region top-K into global at API layer.
- Note: top-1000 in each region may not yield top-1000 globally; pull top-2000 each then merge.

---

## 11. Cross-Questions ≥ 12

### 11.1 Why Count-Min Sketch and not exact hashmap?
- 10M active videos × 8 bytes counter = 80 MB. Doable but per-window × per-region = 80 MB × 3 × 5 = 1.2 GB.
- For exact, fine. For 100M actives or richer aggregation, CMS scales better.
- For interview: discuss both; CMS for the impressive answer.

### 11.2 Why min-heap of size K?
- Insertion + pop-min in O(log K).
- Always reflects current top-K.

### 11.3 Why per-region instead of global?
- Hot global key would saturate single processor.
- Per-region partitions load and matches user locality.
- Global = merge.

### 11.4 How fresh is data?
- Stream → CMS+heap → Redis snapshot every 30s.
- API serves from Redis: lag = 0-30s.

### 11.5 What about late events?
- CMS doesn't handle late ingest perfectly (bucket overcounted by then).
- Acceptable for trending; small error bar.
- For exact (billing): use the ad-aggregator pattern.

### 11.6 How does sliding window decrement work?
- Ring buffer of N sub-window CMS's.
- Total = sum(all sub CMS).
- Old sub CMS discarded; total drops accordingly.
- Memory: N × CMS size.

### 11.7 What if top-K should be personalized?
- Personalization is a different problem (re-rank globally trending by user prefs).
- Top-K via CMS gives candidates; ML re-rank.

### 11.8 Why not Redis sorted set for top-K?
- For 10M actives, ZADD per event = 10M QPS. Doable but heavy.
- Stream processor approach pre-aggregates; Redis only stores top-K result.

### 11.9 What about CMS hash collisions?
- d hash functions; min over d buckets reduces overestimation probability.
- Larger d = lower error; bigger memory.

### 11.10 Cross-region merging accuracy?
- Top-1000 per region may miss items that are #500 in 3 regions but #1500 nowhere.
- Pull more per region for safer merge (top-3000 per region, merge to top-1000).

### 11.11 How is failover handled?
- Flink checkpointed state; restore on restart.
- Brief gap (~30s) during recovery.

### 11.12 How does the API endpoint handle high QPS?
- Reads Redis (sub-ms).
- Trending is read-heavy globally; scale Redis for QPS.

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| CMS approximate count | Memory efficient | Some error in counts |
| Sliding window via sub-windows | Flexible window | Memory N× |
| Per-region | Latency, scale | Cross-region merge cost |
| 30-sec snapshots | Fast API | Slight staleness |

---

## 13. Cheat-Sheet

1. **Count-Min Sketch + min-heap** for memory-bounded top-K.
2. **Per-region** stream processors.
3. **Sliding window** via sub-window arrays.
4. **Redis** for fast API reads.
5. **30-sec snapshot** lag.
6. **Hot videos**: sub-key partition + merge.

---

## Appendix: CMS sizing

```
Item count: N = 10M active videos
Error: ε = 0.1% relative
Confidence: δ = 99.9%

w = e/ε = 2.7 / 0.001 = 2700 buckets
d = ln(1/δ) = ln(1000) = 7 hash functions

Memory: 2700 × 7 × 4 bytes = 75 KB per CMS.
```

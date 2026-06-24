# Twitter Trends / Trending Topics — High-Level Design

> **Difficulty:** Medium → Hard
> **Tags:** `[hld]` `[stream-processing]` `[top-k]` `[count-min-sketch]` `[windowing]` `[approximation]`
> **Prep time:** ~12 min skim, ~35 min deep read
> **Companies that ask this:** Twitter/X, Meta, TikTok, Google (Hot Trends), any large social/news platform

---

## Beginner's Guide

### What's this in plain English?

Twitter shows a "Trending" list — the hashtags/topics spiking *right now*, often per region. Out of **billions** of tweets a day, the system must continuously surface the **top ~10–50** most-surging terms over a recent window (e.g. last hour), and refresh it every minute or two. It's a **top-K over a high-velocity stream**.

### Why solve it?

- **Real world**: Twitter Trends, Google Hot Trends, TikTok trending, Reddit r/popular.
- **Teaches**: **stream processing**, **windowing**, **top-K / heavy-hitters**, and **approximation** (count-min sketch) — you can't exactly count billions of items per minute in memory.

### Vocabulary

- **Top-K** — the K most frequent items in a stream.
- **Heavy hitters** — items appearing far more than average (the trends).
- **Window** — the recent time range we count over (e.g. sliding 1 hour).
- **Count-Min Sketch (CMS)** — a probabilistic structure for approximate counts in tiny memory.
- **Trending ≠ most frequent** — it's about *velocity/surge*, not all-time volume.

### High-level architecture

```
Tweets → Kafka (terms/hashtags) → Stream processors (windowed counts per region)
                                          │
                                  approximate counts (CMS) + heavy-hitter heaps
                                          │
                                   Top-K per region → Redis → API → clients
```

The whole design is a streaming aggregation pipeline producing a small, frequently-refreshed top-K list.

### How to read this doc

- **Beginner**: focus on the stream → window → top-K flow.
- **Interview**: cross-questions on approximation, sliding windows, "trending vs frequent," spam.

---

## 0. How to use this doc in an interview

This tests **stream processing + approximate top-K**. The two traps: (1) trying to **exactly** count every term (impossible in memory at this rate — you must approximate with **count-min sketch** + a heap), and (2) confusing **most frequent** with **trending** (trending = a *surge* relative to baseline). Strong answers discuss windowing, the accuracy/memory trade-off, per-region trends, and spam resistance. Related: [youtube-top-k](youtube-top-k.md) (same top-K core), [big-data-processing](../DeepDives/BigData/big-data-processing.md).

---

## 1. Problem Statement

Continuously compute and serve the top trending topics/hashtags:
- Ingest a high-volume tweet stream; extract terms/hashtags.
- Maintain counts over a **recent sliding window**.
- Surface top-K **trending** (surging) terms, **per region** + global.
- Refresh every ~1–2 minutes; low read latency.
- Resist spam/manipulation.

---

## 2. Clarifying Questions

- [ ] Trending = raw frequency or **surge vs baseline**? (assume surge)
- [ ] Window length + refresh cadence? (assume sliding ~1h, refresh ~1 min)
- [ ] Per-region / personalized, or global only? (assume per-region + global)
- [ ] K size? (assume top 10–50)
- [ ] Exact or approximate counts acceptable? (assume approximate)
- [ ] Volume?

> **Assume:** surge-based, sliding 1h window refreshed each minute, per-region + global, top-50, approximation OK.

---

## 3. Functional Requirements

**P0:**
1. Ingest tweets; extract hashtags/terms (tokenize, normalize).
2. Count term frequency over a recent sliding window.
3. Compute top-K **trending** (surge) terms per region + global.
4. Serve the current trends list with low latency.

**P1:**
5. Personalized trends (by follows/interests).
6. Spam/bot filtering; deduplicate near-identical content.
7. Multiple window sizes (15m / 1h / 24h).

**P2:**
8. Trend detail (sample tweets, volume graph).

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Ingest throughput | 100k–1M tweets/sec peak |
| Read latency | < 100 ms (serve cached list) |
| Freshness | trends ≤ ~2 min stale |
| Availability | 99.9%+ |
| Accuracy | approximate OK (top-K need not be exact) |

---

## 5. Capacity Estimation

```
Tweets:        500M/day      ≈ 6k/sec avg, ~100k–1M/sec peak (events)
Terms/tweet:   ~3 hashtags/terms counted → ~1.5B term-events/day
Distinct terms/hour:  tens of millions  → CANNOT keep exact per-term counters cheaply
Output:        top-50 × (regions ~10² ) → tiny (KB) → trivially cacheable
Reads:         100M+/day for the trends panel → served from Redis/CDN
```

**Bottleneck:** counting tens of millions of distinct terms per window at 1M events/sec in bounded memory. → **approximate counting (count-min sketch) + a top-K heap**, not exact maps.

---

## 6. API

```
GET /trends?region=US&window=1h        -> [{term, rank, volume, surge}]   (served from cache)
GET /trends/{term}                      -> detail (sample tweets, volume over time)   (P2)
(internal) tweet stream → Kafka topic "terms"
```

Trends are read far more than they change → serve a precomputed list from [Redis](../DeepDives/Caching/redis.md)/CDN, refreshed by the pipeline.

---

## 7. Data Model

- **Stream:** [Kafka](../DeepDives/Messaging/kafka.md) topic of term-events, partitioned (by term or region) for parallel processing.
- **Working state (in stream processors):** per-region **count-min sketch** for approximate term counts + a **min-heap of size K** tracking current heavy hitters, plus a **baseline** (historical average) per term for surge computation.
- **Output:** `trends:{region}:{window}` → ranked list in Redis (small, overwritten each refresh).
- **Baselines:** rolling historical averages per term (e.g. in a key-value store) to compute surge = current_rate / baseline_rate.

---

## 8. Architecture

```
   Tweets ──► Ingest/API ──► Kafka topic "terms" (partitioned)
                                      │
                       ┌──────────────┼──────────────┐
                       ▼              ▼              ▼
                 Stream proc     Stream proc     Stream proc   (Flink/Kafka Streams)
                 - tokenize/normalize, filter spam
                 - windowed counts via Count-Min Sketch (per region)
                 - maintain top-K heap; compute surge vs baseline
                       └──────────────┬──────────────┘
                                      ▼
                          Aggregator → top-K per region/global
                                      ▼
                              Redis (trends:{region})
                                      ▼
                          API  ──►  CDN/clients
```

Pipeline: ingest → Kafka → windowed approximate counting in stream processors → aggregate to top-K per region → publish to Redis → serve.

---

## 9. Component Deep-Dives

### 9.1 Term extraction & normalization
Tokenize tweets, extract hashtags/entities, lowercase, strip noise, merge variants (`#WorldCup` ≈ `#worldcup`). Drop stop words. Garbage in → garbage trends.

### 9.2 Approximate counting — Count-Min Sketch
Exact per-term counters for tens of millions of distinct terms don't fit in memory at this rate. **Count-Min Sketch**: a small 2D array + `d` hash functions; increment `d` cells per term, estimate a term's count as the **min** of its cells. Tiny fixed memory, slight over-count (never under-counts — collisions only inflate). Combine with a **heap of size K** to track the current top terms cheaply. This is the heart of the design — see [big-data-processing](../DeepDives/BigData/big-data-processing.md), and [bloom-filters](../DeepDives/Distribution/bloom-filters.md) for the sibling probabilistic structure.

### 9.3 Windowing (the sliding recent window)
Counts must reflect **recent** activity, not all time. Use **sliding/tumbling windows** (e.g. sum of recent 1-min tumbling buckets to approximate a 1h sliding window). Old buckets expire so stale terms fall off. Handle **late/out-of-order events** with event-time + watermarks. See [big-data-processing](../DeepDives/BigData/big-data-processing.md).

### 9.4 Trending vs frequent (surge detection)
"the" is frequent but never trends. Trending = **surge**: current rate ≫ the term's **baseline** (historical average for this time/region). Score by rate-of-change / z-score, not raw count. Maintain rolling baselines per term. This distinction is the most common interview probe.

### 9.5 Per-region + global
Partition/aggregate counts per region (geo from user/locale); compute top-K per region; global = aggregate across regions. Personalization (P1) blends user interests.

### 9.6 Serving
The output is tiny (top-50 × regions). Precompute each refresh, store in Redis, serve via API/CDN. Reads never touch the pipeline.

---

## 10. Hard Sub-Problems

### 10.1 Counting at 1M events/sec in bounded memory
Count-Min Sketch + top-K heap per region; approximate but memory-bounded and fast. Exact counting is infeasible — state this explicitly.

### 10.2 Sliding window without unbounded memory
Bucketed counts (per-minute tumbling) summed into the window; expire old buckets. Avoids storing every event.

### 10.3 Spam / manipulation resistance
Bots can pump a hashtag to fake-trend. Defenses: dedup near-identical tweets, count **unique users** (not raw tweets) per term (HyperLogLog for distinct counts), down-weight new/low-reputation accounts, rate-limit, anomaly detection on suspiciously coordinated spikes.

### 10.4 Hot partition (a mega-viral hashtag)
One term dominates a Kafka partition. Mitigate by partitioning on `hash(term)` to spread terms, and pre-aggregating in the producer/processor before the heap.

### 10.5 Freshness vs cost
Refresh cadence trades freshness for compute; ~1 min is usually enough and keeps the pipeline cheap.

---

## 11. Cross-Questions

### 11.1 Why approximate (Count-Min Sketch) instead of exact counts?
Tens of millions of distinct terms × 1M events/sec won't fit exact counters in memory; CMS gives bounded memory with small, bounded over-count — fine for top-K.

### 11.2 Trending vs most-frequent — what's the difference?
Frequent = high absolute count (often stop-words/evergreen). Trending = **surge** relative to baseline; score by rate-of-change, not raw volume.

### 11.3 Why a sliding window?
Trends are about *now*; without windowing, all-time-popular terms dominate forever. Old buckets expire so the list reflects recent activity.

### 11.4 How do you stop bots from faking a trend?
Count distinct *users* (HyperLogLog), dedup content, weight by account reputation, anomaly-detect coordinated spikes, rate-limit.

### 11.5 Batch or stream?
Stream — trends must be near-real-time (≤ ~2 min). A batch job is too stale. (Could pair with a batch layer for accurate baselines — [Lambda](../DeepDives/BigData/big-data-processing.md).)

### 11.6 Why Kafka in the middle?
Decouples ingest from processing, absorbs spikes, lets multiple consumers (trends, analytics, search) read the same stream, and gives replay. See [kafka](../DeepDives/Messaging/kafka.md).

### 11.7 How is it served so fast?
Output is tiny and precomputed; serve the ranked list from Redis/CDN — reads never hit the pipeline.

### 11.8 How do per-region trends work?
Geo-tag events; partition/aggregate counts per region; top-K per region; global aggregates across.

### 11.9 What about exact-once / double counting?
At-least-once stream delivery may double-count slightly; acceptable for approximate trends. Idempotent dedup of tweet ids reduces it.

### 11.10 How would you add multiple windows (15m/1h/24h)?
Maintain bucketed counts at fine granularity; sum different numbers of buckets for each window from the same buckets.

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| Count-Min Sketch | Bounded memory, fast | Approximate (slight over-count) |
| Sliding window (buckets) | Recency, bounded memory | Window-boundary fuzziness |
| Surge vs raw count | Real "trending" | More state (baselines) |
| Approximate counting | Scales to 1M/sec | Not exact (fine for top-K) |
| Precomputed + cached serving | <100ms reads | Up to ~1 min stale |

---

## 13. Cheat-Sheet

1. **Stream**: tweets → Kafka → stream processors → top-K → Redis → serve.
2. **Approximate counts** with **Count-Min Sketch** + a **size-K heap** (exact is infeasible).
3. **Sliding window** via expiring time buckets — trends are about *now*.
4. **Trending = surge** vs baseline, not raw frequency.
5. **Per-region + global**; partition by term/region.
6. **Spam resistance**: count distinct users (HLL), dedup, reputation weighting.
7. **Serve** a tiny precomputed list from cache/CDN; reads never touch the pipeline.
8. Same top-K core as [youtube-top-k](youtube-top-k.md); built on [stream processing](../DeepDives/BigData/big-data-processing.md).

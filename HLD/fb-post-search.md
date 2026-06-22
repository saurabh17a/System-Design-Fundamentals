# FB / Twitter Post Search — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[search]` `[inverted-index]` `[realtime-ingest]` `[ranking]`
> **Companies that ask this:** Meta, Twitter/X, LinkedIn, Reddit, Pinterest

---

## Beginner's Guide

### What's this in plain English?

You search "world cup" on Twitter. Within seconds, you see relevant tweets — including ones posted moments ago. The system: index every tweet within seconds of it being posted, search across billions of tweets, and rank results by social signals (likes, retweets, your network).

### Why solve it?

- **Real world**: Twitter search, FB post search, LinkedIn updates search.
- **Teaches**: inverted indexes, real-time ingest, ranking with social signals.

### Vocabulary

- **Inverted index** — `word → list of post IDs`. Lets us find posts matching a query fast.
- **Tokenization** — split text into words/tokens.
- **Real-time ingest** — index a post within seconds of writing.
- **Ranking signals** — likes, retweets, freshness, your graph.

### High-level architecture

```
Post → Indexer → Inverted Index Shards → Search Service → Ranker → Result
                        ↑                       ↑
                   (real-time)            (per-user signals)
```

Components:
1. **Tokenizer** — turn post text into searchable tokens.
2. **Inverted index** — sharded; each shard owns a subset of vocabulary or post IDs.
3. **Search** — fan out query to shards; merge results.
4. **Ranker** — scores results by relevance + signals + freshness.

Real-time vs traditional Google search: Twitter posts are indexed within ~5s; Google can take hours.

### How to read this doc

- **Beginner**: focus on the inverted index concept.
- **Interview**: cross-questions on ranking, real-time vs batch, sharding strategy.

---

## 0. How to use this doc in an interview

Tests **inverted index + real-time ingest + social signals + ranking**. Trap: confusing this with a generic web search (Google) — social search has different ranking signals (graph, freshness, engagement) and much higher write rate.

---

## 1. Problem Statement

Search posts in a social network:
- Real-time index (new post searchable within seconds).
- Free-text + filters (author, date, hashtag, engagement).
- Personalized ranking (your friends > strangers).
- Trending searches.

---

## 2. Clarifying Questions

- [ ] Posts only or comments / replies too?
- [ ] Photo / video search (visual)?
- [ ] Time range filters?
- [ ] Real-time freshness target?
- [ ] Personalization weight?

> **Assume:** posts only, no visual search, time filters yes, < 10s freshness, heavy personalization.

---

## 3. Functional Requirements

**P0:**
1. Free-text search.
2. Filters: author, date range, hashtag.
3. Real-time ingest (<10s post → searchable).
4. Personalized ranking.
5. Pagination.

**P1:**
6. Trending searches.
7. Type-ahead.
8. "People also searched."

**P2:**
9. Image / video.
10. Multi-language with translation.

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.99% |
| Search P99 | < 500 ms |
| Index freshness | < 10 s |
| Throughput | 100k searches/sec, 50k posts/sec |

---

## 5. Capacity Estimation

```
Posts: 50 B total; 1B/day new
Searches: ~500M/day = 6k/sec sustained
Index size: avg post ~200 bytes text + metadata; 50B × 250 bytes = 12 TB raw
With inverted index expansion (~2-3x): 30-50 TB
```

---

## 6. API

```
GET /v1/search?q=&filters=&cursor=&user_id=
  -> {results: [...], next_cursor}
```

---

## 7. Data Model

### Inverted index (Elasticsearch / Lucene-based shards)
- Term → list of (post_id, position, score).
- Sharded by post_id range or hash.

### Posts (Cassandra; system of record)
- `(post_id, author_id, ts, text, metadata)`

### Social graph (separate svc)
- `follows(user_id, followee_id)` — for personalization

---

## 8. Architecture

```
              ┌──────────────────────┐
              │   Posters             │
              └──────────┬───────────┘
                         │ post created
                         ▼
                ┌────────────────┐
                │  Post Service  │ (persist to Cassandra)
                └────┬───────────┘
                     │
                     ▼
                ┌────────────────┐
                │  Index Pipeline │ (Kafka)
                │  - tokenize    │
                │  - emit terms  │
                └────┬───────────┘
                     ▼
                ┌────────────────────┐
                │   ElasticSearch    │
                │   shards (M)       │
                └────────────────────┘
                     ▲
                     │
                ┌────────────────┐
                │  Search Svc    │
                │  - query plan  │
                │  - personalize │
                │  - rerank      │
                └────────┬───────┘
                         ▲
                         │
                ┌────────────────┐
                │   Searchers    │
                └────────────────┘
```

### Search flow
```
1. User submits query.
2. Search Svc fans out to all ES shards.
3. Each shard returns top K candidates.
4. Aggregator merges; total top K (e.g. 1000).
5. Re-ranker applies personalization (friends, engagement).
6. Top 20 returned to user; cursor for paging.
```

---

## 9. Component Deep-Dives

### 9.1 Real-time index ingest
- New post → Kafka.
- Indexer consumes; writes to ES shard owning that post_id.
- ES near-real-time refresh: searchable within ~1 sec.

### 9.2 Sharding
- 50B posts → many ES shards (~100 shards × 50 GB each).
- Shard by post_id hash (uniform load).
- Search fans out to all shards (scatter-gather).

### 9.3 Personalized re-ranking
- Top K from ES = candidate set (1000).
- Re-ranker fetches:
  - Author affiliation (friends, followed accounts).
  - Engagement signals.
- ML model scores; sort top 20.

### 9.4 Trending
- Aggregate query log (sliding window).
- Top-K queries with sudden spike → trending.

---

## 10. Hard Sub-Problems

### 10.1 Real-time freshness vs index efficiency
- ES near-real-time: ~1 sec. Trade-off via refresh interval.
- Posts can also be indexed directly without batching for super-fresh.

### 10.2 Scatter-gather latency
- 100 shards × ~10ms each → ~50ms p99.
- Aggregator merges; total ~80ms.

### 10.3 Hot-author posts
- Celebrity tweet: queried by millions.
- Cache top-K results for popular queries.

### 10.4 Personalization at query time
- Re-ranking 1000 candidates with ML at query time = expensive.
- Cache user features in memory; lightweight model.
- ~50ms target for re-rank.

---

## 11. Cross-Questions ≥ 12

### 11.1 Why ES vs Lucene-on-Postgres?
- ES is Lucene + scaling.
- Postgres full-text is not horizontally scalable to 12 TB.
- ES handles cross-shard queries natively.

### 11.2 How is shard count chosen?
- Target shard size: 50 GB; 12 TB / 50 GB = 240 shards.
- Plus replicas for read scaling.

### 11.3 How fast is "fresh"?
- ES NRT refresh = 1 sec by default.
- Tune to 100 ms for super-fresh use case (cost: more index churn).

### 11.4 What signals personalize?
- Friend graph: friends' posts boosted.
- Engagement history: similar posts you liked.
- Recency.
- Author authority.

### 11.5 How is search query cached?
- Top-K for popular queries in Redis.
- Personalized re-rank not cached (per-user).
- Cache key = (query, hour bucket).

### 11.6 What about typos?
- ES has fuzzy matching (edit distance).
- Auto-correct suggested in UI.

### 11.7 How is "trending" computed?
- Sliding 1-hour window of queries.
- Top-K with weighted recency.

### 11.8 What about pagination?
- Cursor-based: encode last-result rank + post_id.
- Stable across queries (results don't shift).

### 11.9 How are deleted posts handled?
- Soft delete: tombstone row.
- Index update: remove or mark.
- Search filters out tombstones.

### 11.10 What about hashtag exact match?
- Tokenizer treats # as word boundary.
- Special index for hashtags (faster than full-text).

### 11.11 How do you handle privacy (private accounts)?
- Index includes visibility flag.
- Filter at query time: "only public OR posts from accounts I follow."

### 11.12 What's the failure mode if ES shard is down?
- Replica serves.
- If both gone: scatter-gather returns partial results; degrade gracefully.

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| ES for index | Mature, scales | Operational complexity |
| Per-post-id sharding | Even load | Query fan-out to all shards |
| Re-rank top K not full | Latency | Slight ranking imperfection |
| Tombstones over hard delete | Recoverable | Index bloat |

---

## 13. Cheat-Sheet

1. **Inverted index** (Elasticsearch).
2. **Sharded by post_id hash** for write balance.
3. **Scatter-gather** search across shards.
4. **Re-rank top K** with personalization.
5. **Real-time** via Kafka → ES NRT refresh.
6. **Trending** = sliding-window query log.

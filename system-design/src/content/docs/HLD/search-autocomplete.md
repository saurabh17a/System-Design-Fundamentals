# Search Autocomplete (Typeahead) — High-Level Design

> **Difficulty:** Medium → Hard
> **Tags:** `[hld]` `[typeahead]` `[trie]` `[ranking]` `[low-latency]`
> **Companies that ask this:** Google, Meta, Amazon, every search company

---

## Beginner's Guide

### What's this in plain English?

You type "ban" into Google and instantly see "banana, bank, bandana, ..." dropdown. Each keystroke triggers another fetch. The system: serve the top 10 completions for any prefix, in <100ms, for billions of queries per day, with current trends (e.g., "earth..." should suggest "earthquake" if one just happened).

### Why solve it?

- **Real world**: Google, Amazon search, IDE autocomplete.
- **Teaches**: trie-based prefix lookup, ranking by popularity, real-time updates, low-latency design.

### Vocabulary

- **Prefix** — the partial query so far ("ban").
- **Trie** — tree where each node is a character; paths spell words.
- **Top-K per prefix** — the K most popular completions starting with the prefix.
- **Cold start** — adding a new completion (e.g., a brand name).

### High-level architecture

```
User types → API → Aggregation Service → Trie (with top-K per node) → Response
                                              ↑
                                  Real-time queries feed → re-rank
```

Components:
1. **Trie** — built offline from query logs; each node stores top-K under its subtree.
2. **Server fleet** — caches trie in memory; replies in <50ms.
3. **Real-time updates** — newer queries weighted higher; periodic rebuild.
4. **Sharding** — by first char, by region.

Optimization: precompute top-K per node so query is just a tree walk + return.

### How to read this doc

- **Beginner**: focus on the trie + top-K-per-node trick.
- **Interview**: cross-questions on real-time updates, ranking, multilingual.

---

## 0. How to use this doc

Tests **trie sharding + ranking + real-time updates**. The bar:
1. Sub-100ms response.
2. Top-K suggestions ranked by popularity.
3. Real-time learning from user clicks.
4. Personalization (optional).

---

## 1. Problem Statement

Autocomplete suggestions as user types:
- Show top-K matching prefixes.
- Personalized + global popularity.
- Update with new searches as they come.
- Multi-language.

---

## 2. Clarifying Questions

- [ ] Sub-100ms target?
- [ ] Personalized?
- [ ] Languages?
- [ ] Real-time updates?
- [ ] Top K = ?

> **Assume:** sub-100ms, personalized, multi-language, real-time updates within minutes, K=10.

---

## 3. Functional Requirements

**P0:**
1. Given prefix → top-10 suggestions ranked by popularity.
2. Real-time popularity updates (newer terms surface).
3. Multi-language.

**P1:**
4. Personalization based on user history.
5. Spellcheck ("Did you mean").

**P2:**
6. Voice query.

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.99% |
| P99 latency | < 100 ms |
| QPS | 1M+ |
| Update lag | < 5 min from popular new query |

---

## 5. Capacity Estimation

```
Unique queries: 10B
Avg query length: 20 chars
Trie node count: ~1B (with shared prefixes)
QPS: 1M peak
Updates: 100M queries/day → ranker update
```

---

## 6. API

```
GET /v1/typeahead?q=<prefix>&user_id=&lang=
  -> [{suggestion, score}, ...]
```

---

## 7. Data Model

### Trie (sharded)
- Per-language trie.
- Each leaf: `(query_string, popularity, last_seen)`.
- For top-K: pre-compute top-K at each internal node (cache).

### Popularity log (Cassandra)
- `(query, ts, user_id, region)` — query events.

### Personalization (Redis per user)
- User's recent queries; boost on autocomplete.

---

## 8. Architecture

```
              Clients (typing)
                 │ debounced 100 ms
                 ▼
           API Gateway (rate-limited per user)
                 │
                 ▼
           Typeahead Service (in-memory trie shards)
                 │
                 ▼
           Returns top-K
                 │
                 ▼
           Search log (Kafka)
                 │
       ┌─────────┴──────────┐
       ▼                    ▼
   Aggregator (Spark)   Trie Updater (Flink)
       │                    │
       ▼                    ▼
   Popularity DB     Push updated top-K to typeahead nodes
       │                    │
       └────────────────────┘

   Personalization → Redis per user (recently queried)
```

---

## 9. Component Deep-Dives

### 9.1 Trie sharding
- 1B nodes won't fit in one process.
- Shard by first 1-2 chars: A-trie, B-trie, ... ZA-trie.
- Each shard ~10M nodes; fits in RAM (~10 GB).
- Each typeahead node holds a subset.

### 9.2 Top-K precomputation
At each internal node, store top-K suggestions for prefixes ending here.
Updated when popularity changes.

### 9.3 Real-time updates
- Search query → Kafka.
- Flink job aggregates per-query popularity in 1-min windows.
- Updates trie node popularity → cascades to ancestor top-K.

### 9.4 Personalization
- User's recent queries cached in Redis.
- At query time: merge global top-K with user's matching past queries.
- Re-rank.

### 9.5 Latency budget
```
Network RTT     ~30 ms
Server           ~10 ms (trie lookup)
Network back    ~30 ms
Total          ~70 ms p99
```

---

## 10. Hard Sub-Problems

### 10.1 Updating popularity without locking trie
- Top-K at each node = approximate.
- Updated periodically (every minute).
- Reads see slightly stale top-K; OK.

### 10.2 Handling typos
- Edit-distance trie traversal (Levenshtein automaton).
- Or BK-tree.
- 1-char insertion / deletion / substitution allowed.

### 10.3 Multi-region
- Each region has full trie replica (memory cheap).
- Updates flow per-region asynchronously.

### 10.4 Scaling QPS
- Each trie shard handles ~100k QPS.
- 10 shards × replicas = 1M+ QPS.

---

## 11. Cross-Questions ≥ 12

### 11.1 Why trie vs ES?
ES handles autocomplete, but at our QPS scale + simplicity, in-memory trie wins on latency.

### 11.2 Why per-language?
Different alphabets; no benefit to merging.

### 11.3 Top-K at internal nodes?
Avoids DFS at query time. Pre-computed.

### 11.4 What if a popular query suddenly emerges (event)?
Updater within ~1 min surfaces it.
For breaking events, special "live trends" override.

### 11.5 What about offensive queries?
Filter list; suppress regardless of popularity.

### 11.6 Personalization at scale?
Per-user cache (Redis); not per-user trie (too expensive).
Re-rank top-N globally with user signals.

### 11.7 What's QPS per node?
~100k. Linear scale via more nodes per shard.

### 11.8 Update from log to in-memory trie?
Pull periodically; deltas only.

### 11.9 What if user types 1 char ("a")?
Returns top-K starting with "a" — millions of matches; precomputed.

### 11.10 Predictive vs corrective?
Predictive: complete what user is typing.
Corrective: "Did you mean X?" (after submission).
Different services.

### 11.11 Mobile latency?
Tighter network; debounce client-side ~100 ms.

### 11.12 Testing latency?
Synthetic queries from monitor; alert if p99 > 100 ms.

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| In-memory trie | Sub-ms lookup | Memory cost |
| Pre-computed top-K | Speed | Stale top-K |
| Per-language | Clean | Cross-language search lost |
| Personalization layer | UX | Complexity |

---

## 13. Cheat-Sheet

1. **Sharded trie** by first 1-2 chars; per-language.
2. **Top-K precomputed** at each internal node.
3. **Real-time updates** via Kafka + Flink.
4. **Personalization** via Redis-cached recent queries (re-rank).
5. **Sub-100ms** budget; trie lookup ~10ms.

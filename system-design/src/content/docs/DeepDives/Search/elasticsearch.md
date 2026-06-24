# Elasticsearch — Deep Dive

> **Type:** Core technology
> **Tags:** `[search]` `[inverted-index]` `[full-text]` `[relevance]`
> **Where it shows up:** [fb-post-search](../../HLD/fb-post-search.md), [search-autocomplete](../../HLD/search-autocomplete.md), [yelp](../../HLD/yelp.md), [reddit](../../HLD/reddit.md), [linkedin](../../HLD/linkedin.md), and any "make X searchable" prompt

---

## Mental model

Elasticsearch (built on Apache Lucene) is a **distributed full-text search and analytics engine**. Its reason to exist is one data structure — the **inverted index** — which flips the question a database answers. A database asks "given this row, what are its fields?"; a search engine asks "given this **word**, which documents contain it?" That inversion is what makes `"find every document mentioning 'distributed systems', ranked by relevance"` fast, where a SQL `LIKE '%distributed systems%'` would scan every row and ignore relevance entirely.

The interview trigger is clear: when the requirement is **full-text search, fuzzy/typo-tolerant matching, relevance ranking, autocomplete, or faceted search/aggregations over large text**, you reach for a search engine — and you keep your [system of record](../Databases/sql-relational.md) elsewhere, syncing into Elasticsearch.

## Internals

### The inverted index

For each **term**, store a **posting list** of the documents (and positions) containing it:

```
Docs:  1:"distributed cache design"  2:"cache design patterns"  3:"distributed systems"

Inverted index (term → docs):
  distributed → [1, 3]
  cache       → [1, 2]
  design      → [1, 2]
  systems     → [3]
  patterns    → [2]

Query "distributed cache" → intersect [1,3] ∩ [1,2] = [1]
```

Lookups become set operations on small sorted lists — fast regardless of corpus size. Positions enable **phrase** queries ("cache design" as a phrase, not just both words somewhere).

### Analysis (tokenization) — why search "just works"

Before indexing, text runs through an **analyzer**: tokenize into terms, lowercase, remove stop words, and **stem** ("running" → "run", "caches" → "cache"). The *same* analyzer runs on queries, so "Running Caches" matches a document containing "ran a cache." This normalization is what makes search feel smart — and a mismatch between index-time and query-time analyzers is a classic "why doesn't it match?" bug. Add-ons: synonyms, n-grams/edge-grams for **autocomplete** ([search-autocomplete](../../HLD/search-autocomplete.md)), and fuzzy matching (edit distance) for typo tolerance.

### Relevance scoring

Results are **ranked**, not just filtered. The default is **BM25** (an improved TF-IDF): a term matters more if it's frequent in the document (term frequency) but rare across the corpus (inverse document frequency), with length normalization. You can boost fields (title > body), recency, or popularity. "Ranked by relevance" vs a DB's "matching rows in arbitrary order" is the headline difference.

### Distribution: shards & replicas

- An **index** is split into **shards** (each a self-contained Lucene index) → horizontal scale and parallel query. Shard count is fixed at creation (reindex to change), so plan it.
- Each shard has **replicas** for availability and read throughput.
- A query **scatters** to all shards, each returns its top-K, and the coordinator **gathers/merges** them → global top-K (scatter-gather; see [sharding](../Distribution/sharding-partitioning.md)). Aggregations (facets, counts) work the same way.
- **Near-real-time:** indexed documents become searchable after a short **refresh** (≈1s), not instantly — Elasticsearch is NRT, not transactional.

## Tradeoffs & decisions

- **Search power vs source-of-truth duties** — superb at ranked full-text/analytics; **not** your primary store. It's NRT, eventually consistent, and lacks real transactions. Keep the SoT in a DB and **sync** into Elasticsearch (dual-write, or better, CDC/[Kafka](../Messaging/kafka.md) → indexer).
- **Index-time cost vs query speed** — analysis and indexing are work done up front so queries are fast; write/reindex throughput and storage are the cost.
- **Shard count** — too few caps parallelism/scale; too many adds overhead and merges; fixed at creation, so size for growth.
- **Freshness vs throughput** — the refresh interval trades search latency for indexing efficiency.

## When to use / when not

**Use Elasticsearch for:**
- **Full-text search** with relevance ranking, fuzzy/typo tolerance, phrase/proximity, synonyms.
- **Autocomplete / type-ahead** (edge n-grams), faceted/filtered search ([yelp](../../HLD/yelp.md)), and **log/metrics analytics** (the "ELK" stack) with aggregations.
- Search over large text corpora where `LIKE`/`ILIKE` would table-scan and can't rank.

**Don't use it as:**
- A **primary database** — no real transactions, eventually consistent, NRT; you can lose the "source of truth" guarantees.
- A **key-value/cache** — use [Redis](../Caching/redis.md).
- The answer when a simple DB index suffices — exact-match lookups and structured filters don't need a search engine; don't add one for `WHERE status = 'active'`.

## Common interview follow-ups

- *"Why not search the database with `LIKE`?"* → full table scan, no relevance ranking, no stemming/fuzzy; inverted index + BM25 solves all three.
- *"How do you keep Elasticsearch in sync with the DB?"* → it's a secondary index; stream changes via CDC/[Kafka](../Messaging/kafka.md) (or dual-write with care) into an indexer; accept eventual consistency.
- *"How does autocomplete work?"* → edge n-gram analyzer at index time so prefixes match; or a completion suggester. ([search-autocomplete](../../HLD/search-autocomplete.md))
- *"How does it scale / serve a query across shards?"* → shards for parallelism + replicas for read scale; scatter-gather merges per-shard top-K.
- *"How do you rank results?"* → BM25 relevance, plus boosts for field/recency/popularity tuned to the product.

## Gotchas

- **Using it as the system of record** — NRT + eventual consistency + no transactions means you can lose data integrity; it's a secondary index.
- **Index-time vs query-time analyzer mismatch** — different analyzers → queries silently fail to match; keep them aligned.
- **Picking the wrong shard count** — it's fixed at index creation; too few or too many both hurt, and changing it means a reindex.
- **Deep pagination (`from`+`size`)** — scatter-gather makes deep offsets very expensive; use `search_after`/scroll for deep results.
- **Reinventing search you don't need** — for exact-match/structured filters a DB index is simpler; reserve Elasticsearch for true text/relevance needs.
- **Unbounded aggregations / huge queries** — costly scatter-gather can hammer the cluster; bound them.

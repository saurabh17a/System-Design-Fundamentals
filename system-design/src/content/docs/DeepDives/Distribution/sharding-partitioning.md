---
title: Sharding & Partitioning
---

# Sharding & Partitioning — Deep Dive

> **Type:** Core concept
> **Tags:** `[scalability]` `[partitioning]` `[sharding]` `[distributed-data]`
> **Where it shows up:** [twitter-news-feed](../../HLD/twitter-news-feed.md), [url-shortener](../../HLD/url-shortener.md), [ticketmaster](../../HLD/ticketmaster.md), [whatsapp](../../HLD/whatsapp.md), and any "the data won't fit on one machine" moment

---

## Mental model

When one database can no longer hold the data or serve the write load — even after vertical scaling and read replicas — you **split the data across multiple machines**. Each machine (shard) owns a subset of the data and handles reads/writes for that subset. **Partitioning** is the general term for splitting a dataset; **sharding** usually means partitioning across separate database servers for scale.

The defining tradeoff to state up front: **sharding buys write throughput and storage by sacrificing the things that need all the data in one place** — cross-shard joins, multi-shard transactions, and global secondary indexes. The whole game is choosing a **partition key** that keeps related data together and spreads load evenly, so most queries hit one shard.

Order of escalation in an interview: vertical scale → read replicas (read scale) → **shard** (write/storage scale). Don't jump to sharding first; it's the expensive, irreversible-ish step.

## Partitioning strategies

### Range partitioning

Split by key ranges: `A–F` → shard 1, `G–M` → shard 2, etc. (or by time: this month → shard A).

- **Pros:** efficient **range scans** (adjacent keys are together); easy to reason about.
- **Cons:** **hot spots** — uneven key distribution sends most traffic to one shard (everyone whose name starts with 'S', or all writes landing in "today's" time shard). Time-range partitioning especially concentrates all writes on the newest shard.

### Hash partitioning

`shard = hash(key) % N` (or via [consistent hashing](consistent-hashing.md)).

- **Pros:** **even distribution** — a good hash spreads load uniformly; no natural hot spot.
- **Cons:** **range scans are gone** (adjacent keys scatter); resharding with naive `% N` remaps almost everything (which is exactly why [consistent hashing](consistent-hashing.md) exists).

### Directory / lookup-based

A **lookup service** maps key → shard explicitly (a partition map). Maximum flexibility: place shards deliberately, move ranges, rebalance without a formula.

- **Pros:** full control over placement; rebalance by editing the map; can mix strategies.
- **Cons:** the directory is an extra hop and a potential **single point of failure / bottleneck** — it must be highly available (cache it, replicate it).

Many large systems use directory-based sharding precisely because they need control over rebalancing, not a fixed modulo.

## Choosing the partition key — the whole ballgame

A good partition key:

1. **Spreads load evenly** (high cardinality, no skew) — avoid keys where a few values dominate.
2. **Co-locates data accessed together** so common queries hit **one shard** (e.g. shard by `user_id` so a user's data is on one shard).
3. **Matches the dominant access pattern** — you optimize for the query you run most.

The tension: co-locating for query locality can create skew (a celebrity user's partition is huge and hot), while spreading perfectly can scatter related data. **Composite keys** and **bucketing** (e.g. `(user_id, month)`) balance the two.

## The hard parts

### Hot spots / celebrity problem

Even with a decent key, a single value can dominate — a celebrity with 100M followers, a viral URL, a "today" time bucket. Mitigations: **sub-partition** the hot key (`celebrity_id#0..N`), **replicate** the hot data for reads, **cache** it ([caching-strategies](../Caching/caching-strategies.md)), or special-case it.

### Cross-shard queries & transactions

- A query needing data from many shards becomes **scatter-gather**: hit all shards, merge results. Slow, and bounded by the slowest shard.
- **Multi-shard transactions** need distributed transactions (two-phase commit — slow, blocking, fragile) or, more commonly, the **saga pattern** (a sequence of local transactions with compensating actions on failure). Most sharded systems **design to avoid cross-shard transactions** by keeping transactional data in one shard.
- **Global secondary indexes** (querying by a non-partition-key field) require either a scatter-gather or a separately-maintained index table.

### Resharding / rebalancing

Adding shards as you grow means **moving data**. Naive hash (`% N`) remaps almost everything → use [consistent hashing](consistent-hashing.md) (moves ~`1/N`) or a directory (move ranges deliberately). A common trick: **over-partition up front** into many logical partitions (e.g. 1024) and map many logical partitions per physical node; growing = reassign logical partitions to new nodes without rehashing keys.

## Tradeoffs & decisions

- **Write scale vs query power** — more shards scale writes/storage but break joins/transactions/range scans.
- **Even load vs locality** — hash spreads load but scatters related data; range/directory co-locate but risk hot spots.
- **Formula vs directory** — modulo/consistent-hash is simple and stateless; a directory is flexible but adds a HA dependency.
- **Sharding vs not** — it's operationally heavy and hard to undo; exhaust vertical scaling + replicas + caching first.

## When to use / when not

**Shard when:** the working set or write throughput genuinely exceeds one machine (+ replicas + cache), and the access pattern has a natural partition key that keeps most queries single-shard.

**Don't shard when:** vertical scaling, read replicas, or caching still has headroom; or when your queries are inherently cross-cutting (lots of joins/aggregations across all data) — sharding will hurt more than help. Premature sharding is a classic over-engineering trap.

## Common interview follow-ups

- *"What's your shard/partition key and why?"* → the highest-leverage question: justify even distribution + locality + access-pattern fit.
- *"What about a hot/celebrity key?"* → sub-partition / replicate / cache the hot value.
- *"How do you handle a query across shards?"* → scatter-gather + merge; or maintain a denormalized table keyed for that query; or avoid it by design.
- *"How do you add capacity later?"* → consistent hashing or a directory + over-partitioning, to move minimal data.
- *"Cross-shard transaction?"* → avoid by co-locating; else saga (preferred) or 2PC (with its blocking/availability cost).

## Gotchas

- **Picking a low-cardinality or skewed key** (status, country, "today") → permanent hot shard.
- **Sharding too early** — huge operational cost before you've used cheaper levers.
- **Forgetting cross-shard joins/transactions exist** — answers that shard the data but still assume joins/global transactions are incomplete.
- **Naive `% N` resharding** — looks fine until you add a node and have to move nearly all the data.
- **The directory as an unguarded SPOF** — it must be replicated/cached or it becomes the bottleneck you sharded to avoid.
- **Monotonic keys** (auto-increment id, timestamp) as the partition key → all new writes pile onto one shard.

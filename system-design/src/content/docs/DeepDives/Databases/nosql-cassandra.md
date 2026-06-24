---
title: NoSQL & Cassandra
---

# NoSQL & Cassandra — Deep Dive

> **Type:** Core technology
> **Tags:** `[database]` `[nosql]` `[wide-column]` `[tunable-consistency]` `[write-scale]`
> **Where it shows up:** [twitter-news-feed](../../HLD/twitter-news-feed.md), [metrics-monitoring](../../HLD/metrics-monitoring.md), [distributed-logging](../../HLD/distributed-logging.md), [gaming-leaderboard](../../HLD/gaming-leaderboard.md), [strava](../../HLD/strava.md)

---

## Mental model

"NoSQL" isn't one thing — it's a family of databases that **drop some relational guarantees (joins, multi-row ACID, fixed schema) in exchange for horizontal write scale, flexible data shapes, and availability.** The four shapes: **key-value** (Redis, DynamoDB), **document** (MongoDB), **wide-column** (Cassandra, HBase, Bigtable), and **graph** (Neo4j).

The unifying idea, and the one to lead with in an interview: **NoSQL makes you design the schema around your queries, not your data.** In relational you model entities and join at read time; in NoSQL you store data pre-shaped for each access pattern (often duplicated across tables). You give up ad-hoc querying to get predictable, scalable performance.

**Cassandra** is the canonical wide-column store and the best one to know cold, because it crisply demonstrates the NoSQL tradeoffs: masterless, linearly write-scalable, tunably consistent, AP-leaning.

## Internals (Cassandra)

### Data model: partition key + clustering key

A Cassandra table's primary key has two parts:

- **Partition key** — decides *which node* stores the row (hashed onto the ring). All rows with the same partition key live together on the same node(s). This is your unit of distribution and your unit of single-query locality.
- **Clustering key** — decides the *sort order within a partition*. Lets you do efficient range scans inside a partition (e.g. a user's events ordered by time).

```sql
-- Model for the query "get a user's recent posts, newest first"
CREATE TABLE posts_by_user (
  user_id   uuid,
  created   timestamp,
  post_id   uuid,
  body      text,
  PRIMARY KEY ((user_id), created)      -- partition=user_id, cluster=created
) WITH CLUSTERING ORDER BY (created DESC);

-- Efficient: single partition, pre-sorted
SELECT * FROM posts_by_user WHERE user_id = ? LIMIT 20;
```

You design **one table per query**. Want posts by hashtag too? You make a second table `posts_by_tag` and write to both. Denormalization and duplication are *the design*, not a smell.

### Ring & partitioning

Cassandra is **masterless** — every node is equal, no single primary. Data is spread across nodes via [consistent hashing](../Distribution/consistent-hashing.md) (the token ring) with virtual nodes. Any node can take any request and act as the **coordinator**, forwarding to the replicas. There's no leader to fail, which is why Cassandra stays available through node loss.

Nodes track each other's state via a **gossip** protocol (periodic peer-to-peer state exchange) — that's how membership and failure detection work without a central coordinator.

### Write path (why writes are so fast)

A write is: append to the **commit log** (durability) → update an in-memory **memtable** → ack. The memtable is later flushed to an immutable **SSTable** on disk. Reads merge the memtable + relevant SSTables; **compaction** periodically merges SSTables and drops tombstones. This is an **LSM-tree** engine — write-optimized, sequential I/O, no in-place updates. See [storage-engines-lsm-vs-btree](storage-engines-lsm-vs-btree.md). Deletes write a **tombstone** (a marker), not an immediate removal — which creates its own gotchas.

### Tunable consistency

This is Cassandra's signature feature. With **replication factor N**, you choose **per query** how many replicas must respond:

- Write **consistency level** W, read consistency level R.
- If **`W + R > N`**, a read is guaranteed to see the latest write (the read and write replica sets overlap). This is the [quorum](../Coordination/cap-and-consistency-models.md) argument.
- `ONE` (fast, weak), `QUORUM` (⌈(N+1)/2⌉ — balanced, strong if used for both R and W), `ALL` (strongest, least available), plus `LOCAL_QUORUM` for multi-datacenter.

So Cassandra lets you **dial consistency vs latency/availability on each operation** — strong for the read that matters, eventual for the one that doesn't. Conflicts between replicas resolve by **last-write-wins** (timestamp), with **read-repair** and **anti-entropy** repairs reconciling divergence in the background.

## Tradeoffs & decisions

- **Write scale & availability vs query flexibility** — masterless + LSM gives huge write throughput and no single point of failure, but no joins, limited ad-hoc queries, and you must know your access patterns up front.
- **Tunable consistency** — per-query `R`/`W` lets you pick your point on the [CAP](../Coordination/cap-and-consistency-models.md) spectrum, but `QUORUM` everywhere costs latency; `ONE` risks stale reads.
- **Denormalization cost** — one-table-per-query means writes fan out to many tables and you own keeping them consistent (no foreign keys).
- **No multi-row transactions** (lightweight transactions exist via Paxos but are slow — use sparingly).

## When to use / when not

**Use Cassandra / wide-column when:**
- **Write-heavy at scale** — time series, metrics, event logs, sensor data, activity feeds, messaging history ([metrics-monitoring](../../HLD/metrics-monitoring.md), [distributed-logging](../../HLD/distributed-logging.md)).
- Access patterns are **known and key-based** (lookups and range scans within a partition), not ad-hoc.
- You need **high availability / no single point of failure** and horizontal scale across regions.

**Reach for relational ([sql-relational](sql-relational.md)) when:**
- You need **multi-row transactions / strong consistency** (money, inventory).
- You need **joins and ad-hoc queries** / reporting.
- Write volume fits one primary (+ read replicas) — don't pay NoSQL's modeling tax for moderate scale.

## Common interview follow-ups

- *"How do you model X in Cassandra?"* → start from the query; choose partition key for distribution + locality, clustering key for sort/range; make a table per access pattern.
- *"How do you avoid hot partitions?"* → choose a high-cardinality partition key; for time series, **bucket** the key (e.g. `(sensor_id, day)`) so one partition doesn't grow unbounded or get all the writes.
- *"Strong or eventual consistency here?"* → set `R`/`W` per query; `QUORUM`+`QUORUM` for read-your-writes, `ONE` for fire-and-forget.
- *"SQL or NoSQL for this system?"* → transactions + flexible queries → SQL; write-scale + known key access → Cassandra.
- *"What happens on a node failure?"* → masterless, so reads/writes continue at the chosen consistency level using surviving replicas; the node re-syncs via hinted handoff/repair when back.

## Gotchas

- **Designing relationally then "porting"** — modeling entities and expecting joins fails; model per query.
- **Hot/unbounded partitions** — a low-cardinality or ever-growing partition key (e.g. partition by `country`, or by `sensor_id` with no time bucket) overloads one node. Bucket and choose keys carefully.
- **Tombstone buildup** — heavy deletes (or TTL'd data) leave tombstones that slow reads until compaction; querying a partition full of tombstones can time out.
- **`ALLOW FILTERING`** — Cassandra will let you run a non-key query by scanning everything; it's a trap for production. If you need it, your data model is wrong for that query.
- **Assuming strong consistency by default** — default reads can be stale; you must opt into `QUORUM`/`W+R>N`.
- **Last-write-wins clock skew** — concurrent writes resolved by timestamp can silently drop data if clocks are skewed.

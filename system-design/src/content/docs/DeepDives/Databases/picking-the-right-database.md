# Picking the Right Database — Deep Dive

> **Type:** Core concept
> **Tags:** `[database]` `[decision-guide]` `[sql]` `[nosql]` `[trade-offs]`
> **Where it shows up:** The data-model step of *every* HLD answer — [twitter-news-feed](../../HLD/twitter-news-feed.md), [payment-system](../../HLD/payment-system.md), [uber](../../HLD/uber.md), [ticketmaster](../../HLD/ticketmaster.md)

---

## Mental model

There is no "best database" — only the best fit for **your access pattern, scale, and consistency needs.** The interview skill is not knowing every database; it's **driving from requirements to a justified choice** and naming what you traded away. The decision is dominated by a few questions: *What's the read/write ratio? What's the data shape? Do I need transactions? What queries will I run? How big does it get?*

The default should be a **relational database** — start there and justify *moving off* it, not the reverse. Most products never outgrow a well-tuned [Postgres/MySQL](sql-relational.md) with read replicas and a cache. Reach for specialized stores when a specific requirement forces it.

## The database families

| Family | Shape | Strengths | Use for | Examples |
|---|---|---|---|---|
| **Relational (SQL)** | tables, fixed schema | ACID transactions, joins, ad-hoc queries | structured data, correctness, relationships | Postgres, MySQL |
| **Key-Value** | key → value | fastest lookups, simple, scalable | cache, sessions, counters | [Redis](../Caching/redis.md), DynamoDB |
| **Document** | JSON-ish docs | flexible schema, nested data | content, catalogs, varied records | MongoDB |
| **Wide-Column** | partitioned rows | massive write scale, tunable consistency | time series, events, feeds | [Cassandra](nosql-cassandra.md), Bigtable |
| **Graph** | nodes + edges | relationship traversal | social graphs, recommendations, fraud | Neo4j |
| **Search** | inverted index | full-text, relevance ranking | search, autocomplete | [Elasticsearch](../Search/elasticsearch.md) |
| **Time-Series** | time-indexed | high-ingest, time-range, downsampling | metrics, IoT, monitoring | InfluxDB, Timescale |
| **Blob/Object** | key → bytes | cheap, durable, huge objects | media, files, backups | [S3](object-blob-storage.md) |

## The decision questions (in order)

1. **Is the data structured with important relationships, and do I need multi-row transactions?** → **Relational.** Money, inventory, bookings, anything where a partial update is a bug. Don't overthink it.
2. **Is it a simple key → value lookup at high speed/scale?** → **Key-value** (Redis for hot/ephemeral; DynamoDB for durable at scale).
3. **Is it write-heavy at huge scale with known, key-based access (no joins)?** → **Wide-column** (Cassandra) — time series, event logs, activity feeds.
4. **Are records document-shaped with a flexible/evolving schema?** → **Document** (MongoDB) — but note modern SQL has rich JSON support, so "flexible schema" alone isn't a reason to leave relational.
5. **Is the core operation traversing relationships (friends-of-friends, paths)?** → **Graph.** Doing this with recursive SQL joins is painful.
6. **Is it full-text search with relevance/fuzzy matching?** → **Search engine** as a secondary index, not your system of record.
7. **Is it append-mostly metrics over time?** → **Time-series.**
8. **Are these large binary blobs?** → **Object storage**, with the metadata in a real DB.

Often the answer is **polyglot persistence** — multiple stores, each for what it's best at: Postgres for users/orders, Redis for sessions/cache, Cassandra for the activity feed, Elasticsearch for search, S3 for media. Saying this (and why) is a strong signal.

## SQL vs NoSQL — frame it correctly

The most common version of this question. Decide on the *real* axes, not hype:

- **Transactions & strong consistency across rows?** → SQL. NoSQL typically offers single-item atomicity and eventual/tunable consistency.
- **Ad-hoc queries, joins, aggregations you can't predict?** → SQL. NoSQL makes you model around known queries.
- **Write throughput / storage beyond one machine, with simple key access?** → NoSQL (built to scale horizontally; SQL needs [sharding](../Distribution/sharding-partitioning.md), which sacrifices cross-shard joins/transactions anyway).
- **Schema flexibility?** → a minor factor; both can do it now.

The honest nuance: **relational scales further than candidates think** (vertical scaling + read replicas + caching), and **NoSQL isn't "faster," it's differently-shaped** — you trade query power and multi-row transactions for horizontal write scale. NewSQL (Spanner, CockroachDB) blurs the line: SQL + horizontal scale + strong consistency, at operational/latency cost.

## Tradeoffs & decisions

- **Consistency vs scale** — strong multi-row consistency (SQL/NewSQL) vs horizontal write scale (NoSQL).
- **Query flexibility vs performance predictability** — SQL's ad-hoc joins vs NoSQL's "model for the query, get predictable latency."
- **One store vs polyglot** — operational simplicity (fewer systems) vs best-fit-per-workload (more to run and keep consistent).
- **Familiar/default vs specialized** — a known relational DB you can operate vs a specialized store you must learn and run.

## Common interview follow-ups

- *"SQL or NoSQL for this, and why?"* → answer from transactions + query shape + write scale; name what you give up.
- *"Why not just one database for everything?"* → polyglot lets each workload use the right tool; the cost is operational complexity and cross-store consistency.
- *"This is read-heavy — what changes?"* → relational + read replicas + [cache](../Caching/caching-strategies.md); the DB family may not need to change at all.
- *"It's write-heavy at huge scale."* → wide-column (Cassandra) for its [LSM](storage-engines-lsm-vs-btree.md) write path + horizontal scale, accepting no joins.
- *"You picked X — what are its weaknesses here?"* → always have the downside ready (e.g. Cassandra: no ad-hoc queries; Mongo: weaker multi-doc transactions historically).

## Gotchas

- **Defaulting to NoSQL for "scale"** without a number forcing it — premature and costs you transactions/queries you'll miss.
- **"NoSQL is faster"** — it's not inherently faster; it's a different trade-off. Wrong access pattern on NoSQL is *slower*.
- **Ignoring access patterns for NoSQL** — modeling relationally then expecting joins fails; model per query.
- **Search engine / cache as system of record** — Elasticsearch and Redis are secondary stores; keep the SoT in a durable DB.
- **Blobs in the database** — bytes go in [object storage](object-blob-storage.md); the row holds the URL.
- **Naming a database without trade-offs** — "use Cassandra" with no *why* and no downside is the hollow answer interviewers penalize.

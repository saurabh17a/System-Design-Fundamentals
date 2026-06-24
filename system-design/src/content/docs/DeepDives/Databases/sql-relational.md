# SQL & Relational Databases — Deep Dive

> **Type:** Core technology
> **Tags:** `[database]` `[acid]` `[transactions]` `[indexing]` `[sql]`
> **Where it shows up:** Nearly every HLD answer's storage layer — [ticketmaster](../../HLD/ticketmaster.md), [payment-system](../../HLD/payment-system.md), [online-auction](../../HLD/online-auction.md), [url-shortener](../../HLD/url-shortener.md)

---

## Mental model

A relational database stores data as **tables of rows with a fixed schema**, related by keys, and lets you query them declaratively with SQL while the engine guarantees **ACID** transactions. You say *what* you want; the query planner decides *how*.

The reason it's the default choice — and the reason interviewers expect you to justify *moving away* from it rather than justify using it — is that it gives you two things that are genuinely hard to build yourself: **multi-row transactions with strong consistency**, and **flexible ad-hoc queries with indexes and joins**. Reach for relational when your data is structured, relationships matter, and correctness under concurrency matters (money, inventory, bookings).

## Internals

### ACID — what each letter actually buys you

- **Atomicity** — a transaction is all-or-nothing. Implemented via a write-ahead log (WAL): changes are journaled before being applied, so a crash mid-transaction rolls back cleanly.
- **Consistency** — a committed transaction leaves the DB in a valid state (constraints, foreign keys, uniqueness hold). This is *your* invariants being enforced, not the same word as in CAP/"eventual consistency."
- **Isolation** — concurrent transactions don't corrupt each other; the **isolation level** decides how much they can see of each other (below).
- **Durability** — once committed, it survives a crash. Again the WAL: commit means "the log is `fsync`'d to disk."

> Watch the vocabulary trap: the **C in ACID** (constraints valid) is *not* the **C in CAP** (consistency across replicas). Interviewers probe whether you conflate them. See [cap-and-consistency-models](../Coordination/cap-and-consistency-models.md).

### Isolation levels and the anomalies they prevent

Stronger isolation = fewer anomalies = more locking/contention. Know the ladder:

| Level | Dirty read | Non-repeatable read | Phantom read |
|---|---|---|---|
| Read Uncommitted | possible | possible | possible |
| Read Committed | prevented | possible | possible |
| Repeatable Read | prevented | prevented | possible* |
| Serializable | prevented | prevented | prevented |

- **Dirty read** — you read another transaction's uncommitted change (which may roll back).
- **Non-repeatable read** — you read a row twice in one transaction and get different values (someone committed an update between).
- **Phantom read** — you re-run a range query and new rows appear (someone inserted matching rows).

\* Postgres's "Repeatable Read" is snapshot isolation and actually blocks phantoms too; MySQL/InnoDB uses gap locks. Defaults differ: **Postgres = Read Committed, MySQL/InnoDB = Repeatable Read.** Mentioning the default mismatch signals real experience.

Engines implement this with **locking** and/or **MVCC** (Multi-Version Concurrency Control): readers see a consistent snapshot without blocking writers, because each row keeps versions. MVCC is why "readers don't block writers" in Postgres/InnoDB.

### Indexing — the B-tree

Without an index, a query scans every row (`O(n)`). An index is a sorted structure that turns lookups into `O(log n)`.

- The default index is a **B-tree** (a wide, shallow, balanced tree kept sorted by key). It serves **point lookups** (`=`), **range scans** (`<`, `>`, `BETWEEN`), **prefix matches** (`LIKE 'abc%'`), and **`ORDER BY`** on the indexed column — because the data is already in sorted order.
- A **composite index** `(a, b, c)` follows the **leftmost-prefix rule**: it helps queries filtering on `a`, `a,b`, or `a,b,c` — but **not** a query filtering only on `b`. Column order matters.
- A **covering index** includes all columns a query needs, so the engine answers from the index alone without touching the table ("index-only scan").
- Indexes cost **write amplification and storage** — every insert/update maintains every index on the table. Don't index blindly.

For *why* B-trees and not LSM-trees here, and which databases choose which, see [storage-engines-lsm-vs-btree](storage-engines-lsm-vs-btree.md).

```sql
-- Composite index supports the WHERE + ORDER BY in one structure
CREATE INDEX idx_orders_user_created ON orders (user_id, created_at DESC);

-- Uses the index: filters on leftmost column, ordered by the next
SELECT * FROM orders WHERE user_id = 42 ORDER BY created_at DESC LIMIT 20;

-- Read the plan instead of guessing
EXPLAIN ANALYZE
SELECT * FROM orders WHERE user_id = 42 ORDER BY created_at DESC LIMIT 20;
```

### The query planner

SQL is declarative; the **planner/optimizer** picks the execution strategy — which index, join order, join algorithm (nested-loop vs hash vs merge), and whether to scan. It relies on **table statistics** (row counts, value distributions). Stale stats → bad plans → mysterious slow queries. `EXPLAIN ANALYZE` shows the chosen plan and where time actually goes; reading it is a real skill worth claiming.

### Normalization vs denormalization

- **Normalize** to eliminate redundancy: each fact lives in one place, updates touch one row, no update anomalies. The cost is **joins** at read time.
- **Denormalize** to avoid expensive joins on hot read paths: duplicate data so a read hits one table. The cost is **write complexity and consistency risk** (keep the copies in sync). Common in read-heavy systems and a stepping stone toward NoSQL ([nosql-cassandra](nosql-cassandra.md)).

## Tradeoffs & decisions

- **Strong consistency vs write scalability** — a single primary gives you easy transactions but caps write throughput at one machine. Scaling writes means [sharding](../Distribution/sharding-partitioning.md), which sacrifices cross-shard transactions and joins.
- **Read scaling via replicas** — add read replicas for read-heavy load, but [replication](../Distribution/replication.md) is usually async → **replica lag** → reads-your-own-writes anomalies. Route critical reads to the primary.
- **Schema rigidity vs safety** — fixed schema catches bad data and documents intent, but migrations on huge tables are operationally painful (locking, backfills).
- **Joins vs denormalization** — normalized correctness vs denormalized read speed.

## When to use / when not

**Use a relational DB when:**
- You need **multi-row/multi-table transactions** and strong consistency — money, inventory, bookings, anything where a partial update is a bug ([payment-system](../../HLD/payment-system.md), [ticketmaster](../../HLD/ticketmaster.md)).
- Relationships and **ad-hoc queries / reporting** matter (joins, aggregations, filters you didn't anticipate).
- Data is structured and the schema is reasonably stable. **This is the right default; start here and justify moving off it.**

**Reach for something else when:**
- **Write volume exceeds one primary** and the access pattern is simple key-based → [Cassandra / NoSQL](nosql-cassandra.md).
- **Schema is highly variable** or document-shaped → document store.
- **Full-text / relevance search** → [Elasticsearch](../Search/elasticsearch.md), not `LIKE '%term%'`.
- **Huge blobs** (images, video) → [object storage](object-blob-storage.md) with a URL in the row.

## Common interview follow-ups

- *"How do you scale reads?"* → read replicas; cache hot reads ([Redis](../Caching/redis.md)); call out replica lag and how you route consistency-critical reads to the primary.
- *"How do you scale writes?"* → vertical first (cheap, buys a lot); then functional partitioning; then [sharding](../Distribution/sharding-partitioning.md) by a key, accepting loss of cross-shard transactions.
- *"This query is slow — what do you do?"* → `EXPLAIN ANALYZE`, find the missing/unused index or bad join, check stats, add a covering/composite index, consider denormalizing the hot path.
- *"SQL vs NoSQL for this?"* → frame it as transactions + flexible queries (SQL) vs write-scale + simple access patterns (NoSQL); decide from the access pattern, not hype.
- *"How do you prevent two users booking the same seat?"* → a transaction with a uniqueness constraint or `SELECT … FOR UPDATE` row lock; optimistic locking with a version column as the alternative.

## Gotchas

- **Confusing ACID-consistency with CAP-consistency** — different concepts; don't blur them.
- **Assuming an index is used** — the leftmost-prefix rule, a function on the column (`WHERE lower(email)=…`), or a type mismatch can silently disable an index. Read the plan.
- **Over-indexing** — every index taxes every write; unused indexes are pure cost.
- **`OFFSET` pagination on deep pages** is `O(offset)` — it scans and discards. Use **keyset/cursor pagination** (`WHERE id < last_seen ORDER BY id LIMIT n`).
- **Forgetting replica lag** — "we'll just add read replicas" without addressing read-your-writes is an incomplete answer.
- **`SELECT *`** pulls unneeded columns and defeats covering indexes; select what you need.
- **Long-running transactions** hold locks / MVCC versions and bloat the DB; keep transactions short.

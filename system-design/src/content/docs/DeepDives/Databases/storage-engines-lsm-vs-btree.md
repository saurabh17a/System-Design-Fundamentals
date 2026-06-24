---
title: "Storage Engines: LSM vs B-Tree"
---

# Storage Engines: LSM-Tree vs B-Tree — Deep Dive

> **Type:** Core concept
> **Tags:** `[storage-engine]` `[lsm-tree]` `[b-tree]` `[write-amplification]`
> **Where it shows up:** Explains *why* [Cassandra](nosql-cassandra.md) vs [Postgres/MySQL](sql-relational.md) behave differently; a common "why is this DB write-optimized?" follow-up

---

## Mental model

Underneath every database is a **storage engine** — the code that actually puts bytes on disk and reads them back. Two designs dominate, and they sit at opposite ends of the **read-vs-write** tradeoff:

- **B-tree** — update data **in place** in a sorted on-disk tree. **Read-optimized.** Powers most relational DBs (Postgres, MySQL/InnoDB) and many key-value stores.
- **LSM-tree** (Log-Structured Merge-tree) — never update in place; **append** writes to memory, flush sorted batches to disk, merge later. **Write-optimized.** Powers [Cassandra](nosql-cassandra.md), RocksDB, LevelDB, HBase, ScyllaDB.

Knowing this distinction lets you answer the *why* behind database choices: "Cassandra handles huge write volume because it's LSM-based — sequential appends, no in-place updates" is a depth signal interviewers notice.

## B-tree

A balanced, sorted tree of fixed-size **pages** (typically 4–16 KB), kept on disk:

- Wide and shallow (high fan-out), so a lookup is a few page reads — `O(log n)`. Great for **point lookups and range scans** because data stays sorted in place.
- Writes **modify pages in place**: find the page, update it, write it back. A crash mid-write is handled by a **write-ahead log (WAL)** so updates are atomic/durable. This is the indexing structure described in [sql-relational](sql-relational.md).
- **Read behavior:** excellent — predictable, one path to the data.
- **Write behavior:** a small update can require rewriting a whole page (and splitting/merging pages), and writes are **random** across the disk → more expensive under heavy write load. **Write amplification** comes from page rewrites + WAL.

## LSM-tree

Optimize for writes by **never seeking to update**:

1. A write goes to an in-memory sorted structure (**memtable**) and an append-only **commit log** (durability). The ack is fast — just an append.
2. When the memtable fills, it's flushed to disk as an immutable, sorted **SSTable** (Sorted String Table). SSTables are never modified.
3. Over time many SSTables accumulate; a background **compaction** merges them, discarding overwritten values and **tombstones** (deletion markers).

```
write → memtable (RAM, sorted) + commit log (append)
            │ flush when full
            ▼
        SSTable_3   SSTable_2   SSTable_1   (immutable, sorted, on disk)
            └──────────┴───── compaction ──┴──→ merged SSTable
```

- **Write behavior:** excellent — sequential appends, no random in-place writes, high throughput. This is why LSM stores absorb massive write rates.
- **Read behavior:** a key may live in the memtable or any SSTable, so a read may check several. Mitigated by **bloom filters** (skip SSTables that definitely lack the key — see [bloom-filter](../../MachineCoding/Go/bloom-filter.md)) and per-SSTable sparse indexes. Still, reads can be costlier than a B-tree, and **compaction** consumes background I/O/CPU (and causes its own write amplification, just deferred and sequential).
- **Deletes** write a tombstone; space is reclaimed only at compaction — the source of Cassandra's tombstone gotchas.

## Comparison

| | B-tree | LSM-tree |
|---|---|---|
| Update style | in place | append + merge |
| Optimized for | **reads** | **writes** |
| Write pattern | random | **sequential** |
| Read pattern | one path, predictable | may check memtable + several SSTables |
| Write amplification | page rewrites + WAL | compaction (deferred, sequential) |
| Space | can fragment | tombstones until compaction |
| Used by | Postgres, MySQL/InnoDB | Cassandra, RocksDB, LevelDB, HBase |
| Range scans | excellent | good (SSTables sorted) |

Neither is universally better — it's the read/write balance. Modern engines blur the line (B-trees with log-structured tricks; LSM with read optimizations), and some databases let you pick (MySQL with MyRocks).

## Tradeoffs & decisions

- **Read latency vs write throughput** — the core axis. Choose the engine matching your workload's dominant direction.
- **Predictable reads vs cheap writes** — B-tree gives steady read latency; LSM trades some read cost (and compaction background load) for fast, sequential writes.
- **Space & compaction** — LSM needs headroom and background compaction capacity; B-trees can fragment and need their WAL.
- **Write amplification location** — B-tree: at write time (page rewrites). LSM: deferred to compaction (but sequential, often cheaper overall under write-heavy load).

## When each fits

- **B-tree / relational** — read-heavy or balanced workloads, strong consistency, transactions, ad-hoc queries: OLTP apps, anything you'd put in [Postgres/MySQL](sql-relational.md).
- **LSM** — write-heavy, append-mostly, high-ingest: time series, metrics, event logs, messaging history, [Cassandra](nosql-cassandra.md)-style workloads ([metrics-monitoring](../../HLD/metrics-monitoring.md), [distributed-logging](../../HLD/distributed-logging.md)).

## Common interview follow-ups

- *"Why is Cassandra so good at writes?"* → LSM engine: writes are sequential appends to a memtable + commit log, no random in-place updates; compaction happens in the background.
- *"What's the downside of LSM for reads?"* → a key may span memtable + multiple SSTables; bloom filters + sparse indexes mitigate, but reads and compaction add overhead.
- *"Why do relational DBs use B-trees?"* → predictable `O(log n)` reads and range scans with in-place updates fit transactional, read-heavy, query-rich workloads.
- *"What is write amplification?"* → one logical write causing extra physical writes — B-tree via page rewrites/WAL; LSM via compaction.

## Gotchas

- **Assuming one engine is strictly better** — it's a read/write tradeoff; match it to the workload.
- **Forgetting compaction cost** — LSM background compaction competes for I/O/CPU; under-provisioning it causes read/space blowups and latency spikes.
- **LSM tombstones** — heavy deletes/TTLs leave tombstones that slow reads until compaction (the Cassandra trap).
- **B-tree under write-heavy load** — random in-place writes and page splits become a bottleneck; that's the signal to consider LSM.
- **Ignoring bloom filters** — they're what keeps LSM reads viable by skipping SSTables that can't contain the key.

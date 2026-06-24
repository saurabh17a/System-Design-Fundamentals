# Replication — Deep Dive

> **Type:** Core concept
> **Tags:** `[replication]` `[availability]` `[consistency]` `[fault-tolerance]`
> **Where it shows up:** Every durable, available datastore — [payment-system](../../HLD/payment-system.md), [whatsapp](../../HLD/whatsapp.md), [distributed-cache](../../HLD/distributed-cache.md), and any "what if a node dies?" follow-up

---

## Mental model

Replication is **keeping copies of the same data on multiple machines.** You do it for three reasons: **high availability** (a replica takes over when one dies), **read scalability** (spread reads across copies), and **lower latency / locality** (a replica near the user). It is distinct from [sharding](sharding-partitioning.md): sharding splits *different* data across machines (scale writes/storage); replication copies the *same* data (availability + read scale). Real systems do both — shard, then replicate each shard.

The entire subject reduces to one question: **when a write happens, how and when do the copies agree?** Sync vs async, one leader vs many vs none — every replication model is an answer, and each sits at a different point on the [consistency-vs-availability](../Coordination/cap-and-consistency-models.md) spectrum.

## Topologies

### Leader–follower (primary–replica) — the common default

One **leader** accepts all writes; **followers** replicate the leader's change stream and serve reads.

- **Reads scale** by adding followers; writes are capped at one leader.
- **Failover:** if the leader dies, a follower is promoted (manually or automatically). The window during election is brief unavailability for writes.
- This is the standard for relational DBs (Postgres/MySQL) and many others. See read-scaling notes in [sql-relational](../Databases/sql-relational.md).

### Multi-leader

Multiple leaders accept writes (often one per region) and replicate to each other.

- **Pros:** write availability/locality across regions; survives a leader loss without promotion.
- **Cons:** **write conflicts** — two leaders accept conflicting writes to the same row. You must resolve them (last-write-wins, version vectors, CRDTs, app-level merge). Conflict resolution is the whole difficulty; only choose multi-leader when you can tolerate/merge conflicts.

### Leaderless (Dynamo-style / quorum)

No leader — clients (or a coordinator) write to **several replicas directly** and read from several. [Cassandra](../Databases/nosql-cassandra.md) and DynamoDB work this way.

- Uses **quorums:** with N replicas, require W acks on write and R responses on read. If **`W + R > N`**, read and write sets overlap → a read sees the latest write.
- **Pros:** no single point of failure, highly available, tunable per query.
- **Cons:** you handle conflict resolution and read-repair; "latest" depends on clocks/versioning.

## Synchronous vs asynchronous — the core knob

- **Synchronous:** the leader waits for the replica(s) to confirm before acking the client. **No data loss** on leader failure (the replica has it), but **higher write latency** and reduced availability (a slow/down replica blocks writes).
- **Asynchronous:** the leader acks immediately and ships changes to replicas in the background. **Fast and available**, but a leader can ack a write then die before it propagates → **that write is lost**, and replicas serve **stale** reads until they catch up.
- **Semi-synchronous** (the pragmatic middle): wait for **one** replica synchronously, the rest async. Bounds data loss to the case where two specific nodes fail together, without waiting for everyone.

Most systems default to async (or semi-sync) for performance and accept a bounded loss/staleness window. Saying "we'll replicate synchronously to all replicas" without acknowledging the latency/availability cost is a red flag.

## Replication lag and its anomalies

Async replication means followers trail the leader by some **lag**. That lag produces user-visible anomalies — name them and their fixes:

- **Read-your-own-writes violation:** you update your profile, then a read hits a lagging replica and shows the old value. Fix: route a user's reads to the leader (or a known up-to-date replica) for a short window after their write.
- **Monotonic reads violation:** successive reads hit replicas with different lag → you see time go *backwards*. Fix: pin a user's session to one replica.
- **Replica lag under load** can grow without bound; monitor it and shed read traffic / catch up before it becomes stale-data incidents.

These are the [client-centric consistency guarantees](../Coordination/cap-and-consistency-models.md) in action.

## Failover — the operationally tricky part

Promoting a new leader sounds simple and is full of traps:

- **Detecting failure** (vs a slow node / network blip) without false positives.
- **Choosing the most up-to-date follower** to promote (minimize lost writes).
- **Lost writes:** async writes not yet replicated are gone — sometimes irreversibly (e.g. they conflict with new state on the old leader's return).
- **Split-brain:** the old leader comes back thinking it's still leader → **two leaders**, diverging data. Prevented with fencing tokens / a coordination service ([ZooKeeper/etcd](../Coordination/zookeeper-etcd.md)) so only one node can hold leadership.

## Tradeoffs & decisions

- **Durability vs latency** — sync (no loss, slow) vs async (fast, bounded loss). The fundamental dial.
- **Consistency vs availability** — strong reads (read from leader / quorum) vs available, fast, possibly-stale reads (any replica).
- **Topology** — single-leader (simple, write bottleneck), multi-leader (write availability, conflicts), leaderless (no SPOF, you own conflicts).
- **Replication factor** — more replicas = more durability + read capacity, but more write fan-out and storage; N=3 is the common baseline.

## When to use / which model

- **You always replicate something** for durability/availability — the question is the model.
- **Single-leader** for most transactional systems: simple, strong-ish, read replicas for scale.
- **Multi-leader** for multi-region write availability when you can resolve conflicts.
- **Leaderless/quorum** for max availability + tunable consistency at scale ([Cassandra](../Databases/nosql-cassandra.md)).

## Common interview follow-ups

- *"What happens when the leader dies?"* → failover: detect, promote the most-caught-up follower, fence the old one; note any async writes in flight may be lost.
- *"How do you scale reads?"* → read replicas; then address replica lag (read-your-writes routing).
- *"Sync or async replication?"* → state the loss/latency tradeoff and pick semi-sync as the pragmatic middle for important data.
- *"User sees stale data after their own update — why?"* → replica lag; route their reads to leader/up-to-date replica briefly.
- *"How do you prevent split-brain?"* → leader election via a coordination service + fencing tokens; only one writer at a time.
- *"Replication vs sharding?"* → copies of the same data (availability/read scale) vs splitting different data (write/storage scale); use both.

## Gotchas

- **Calling async replication lossless** — an acked write can vanish if the leader dies before propagation.
- **Ignoring replica lag** — "just add read replicas" without read-your-writes handling ships stale-data bugs.
- **Split-brain after failover** — without fencing, the recovered old leader corrupts data.
- **Multi-leader without a conflict strategy** — concurrent conflicting writes silently lose data under last-write-wins.
- **Promoting a lagging follower** — picks the replica missing the most recent writes; choose the most up-to-date one.
- **Confusing replication with backups** — replicas faithfully copy a bad write/delete too; you still need point-in-time backups.

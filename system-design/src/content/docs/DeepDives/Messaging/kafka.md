# Kafka — Deep Dive

> **Type:** Core technology
> **Tags:** `[messaging]` `[event-streaming]` `[append-only-log]` `[partitioning]`
> **Where it shows up:** [message-queue](../../HLD/message-queue.md), [twitter-news-feed](../../HLD/twitter-news-feed.md), [ad-click-aggregator](../../HLD/ad-click-aggregator.md), [metrics-monitoring](../../HLD/metrics-monitoring.md), [distributed-logging](../../HLD/distributed-logging.md), [notification-system](../../HLD/notification-system.md)

---

## Mental model

Kafka is a **distributed, replicated, append-only log**. Producers append records to the end; consumers read forward at their own pace, tracking their position with an **offset**. That's the whole idea — everything else is a consequence.

This is the key distinction interviewers want you to articulate: a traditional message queue (RabbitMQ, SQS) **deletes a message once it's consumed**. Kafka **retains** records for a configured time/size regardless of who read them, and lets *many independent consumers* read the same data at different positions, even re-reading the past ("replay"). Kafka is a *log*, not a mailbox.

Reach for Kafka when you need **high-throughput, durable, replayable event streaming** with multiple independent consumers — pipelines, event sourcing, decoupling services, stream processing, log/metrics ingestion.

## Internals

### Topics, partitions, offsets

- A **topic** is a named stream of records, split into **partitions**.
- A **partition** is the actual append-only log file on disk. It is the unit of parallelism, ordering, and replication.
- Each record in a partition has a monotonically increasing **offset**. Consumers commit "I've processed up to offset N."

```
Topic "clicks", 3 partitions:

P0: [0][1][2][3][4]→            ┐
P1: [0][1][2]→                  ├─ each partition is an ordered, immutable log
P2: [0][1][2][3][4][5][6]→      ┘
        ▲ producers append here          consumers read forward, track offset
```

**Ordering guarantee:** Kafka guarantees order **within a partition only**, never across partitions. This is the single most important constraint in any Kafka design answer.

- The **partition key** decides which partition a record lands in (`hash(key) % numPartitions`). All records with the same key → same partition → ordered relative to each other. Pick the key to match your ordering requirement (e.g. key by `userId` so one user's events stay ordered).
- No key → round-robin across partitions for balance, but you lose per-entity ordering.

### Consumer groups

- Consumers join a **consumer group**. Kafka assigns each partition to **exactly one consumer** in the group → parallelism with no double-processing inside a group.
- **Max useful parallelism = partition count.** 10 partitions ⇒ at most 10 active consumers in a group; an 11th sits idle. This is why partition count is a capacity-planning decision you make up front (over-partition modestly; you can add partitions but it reshuffles key→partition mapping).
- **Different groups are independent** — the analytics group and the billing group each read the full topic at their own offsets. This is how one stream feeds many systems.
- **Rebalancing:** when a consumer joins/leaves/dies, partitions are reassigned. Rebalances briefly pause consumption — frequent rebalances (flaky consumers, long processing pauses past `max.poll.interval`) are a classic production problem.

### Replication, leaders, and ISR

Each partition is replicated to `replication.factor` brokers:

- One replica is the **leader** (handles all reads/writes for that partition); the rest are **followers** that pull copies.
- The **ISR (in-sync replicas)** is the set of replicas currently caught up to the leader.
- **`acks`** controls the producer's durability/latency tradeoff — the knob interviewers love:
  - `acks=0` — fire and forget. Fastest, can lose data.
  - `acks=1` — leader has it. Loses data if the leader dies before a follower copies.
  - `acks=all` (+ `min.insync.replicas=2`) — all in-sync replicas have it. Durable; survives a broker loss. **The default for anything that matters.**
- If a leader dies, a follower in the ISR is promoted. With `acks=all` + `min.insync.replicas≥2`, an acked write survives this failover.

### Storage & retention

- Records are appended to segment files and served via the OS page cache and **zero-copy** (`sendfile`) — Kafka achieves huge throughput largely by *not* doing clever things: sequential disk writes + page cache + zero-copy.
- **Retention** is by **time** (`retention.ms`, e.g. 7 days) or **size** (`retention.bytes`) — data is deleted when it ages out, *whether or not it was consumed*.
- **Log compaction** is the alternative: keep only the latest record per key (great for changelogs / "current state of each entity"). Retention vs compaction is a per-topic choice.

### Coordination

Brokers coordinate cluster metadata, leader election, and membership. Historically this used **ZooKeeper**; modern Kafka uses **KRaft** (a built-in Raft quorum) and drops the ZooKeeper dependency. In an interview, knowing "Kafka needs a consensus layer for metadata/leader election, formerly ZooKeeper, now KRaft" is enough. See [zookeeper-etcd](../Coordination/zookeeper-etcd.md) and [consensus-raft-paxos](../Coordination/consensus-raft-paxos.md).

## Delivery semantics

Be precise here — it's a frequent follow-up:

- **At-most-once:** commit the offset *before* processing. Crash after commit ⇒ message skipped. No duplicates, possible loss.
- **At-least-once:** process *then* commit. Crash after processing, before commit ⇒ reprocessed on restart. No loss, **possible duplicates**. This is the practical default.
- **Exactly-once (EOS):** Kafka supports it within Kafka via **idempotent producers** (dedup by producer id + sequence number) and **transactions** (atomically write to multiple partitions + commit offsets). True end-to-end exactly-once *including external side effects* still requires **idempotent consumers** — design your processing to be safe to repeat (upserts, dedup keys). The strong, honest answer: *"at-least-once delivery + idempotent consumers"* gets you effectively-once without heroics.

## Tradeoffs & decisions

- **Ordering vs parallelism** — order is per-partition, parallelism is per-partition. Keying for order concentrates a hot entity onto one partition (and one consumer). You trade one for the other; pick the key deliberately.
- **Throughput vs latency vs durability** — `acks`, `batch.size`, `linger.ms`, compression. Batching boosts throughput at the cost of latency.
- **Partition count** — too few caps parallelism; too many adds metadata/rebalance overhead and end-to-end latency. Plan for peak consumer parallelism plus headroom.
- **Retention vs compaction** — a time-bounded event stream vs a compacted "latest value per key" changelog.

## When to use / when not

**Use Kafka for:**
- High-volume event pipelines, log/metrics/clickstream ingestion ([ad-click-aggregator](../../HLD/ad-click-aggregator.md), [metrics-monitoring](../../HLD/metrics-monitoring.md)).
- Decoupling producers from many independent consumers (fan-out to several systems).
- Event sourcing / CDC / stream processing; anything needing **replay**.
- A durable buffer that absorbs bursts and smooths backpressure.

**Reach for a queue instead when** ([queues-vs-streams](queues-vs-streams.md)):
- You want **per-message** routing, priorities, delayed delivery, or dead-letter ergonomics → RabbitMQ/SQS fit better.
- You have a simple task queue with modest volume and don't need replay or a partitioned log.
- You need a few messages/sec and Kafka's operational weight (brokers, partitions, a consensus layer) isn't justified.

## Common interview follow-ups

- *"How do you guarantee ordering?"* → per-partition only; key by the entity whose order matters; accept the hot-partition tradeoff.
- *"How do you avoid losing messages?"* → `acks=all` + `min.insync.replicas≥2` + `replication.factor=3`; process-then-commit (at-least-once).
- *"How do you avoid double-processing?"* → idempotent consumers (dedup key / upsert), or Kafka transactions for in-Kafka exactly-once.
- *"How do you scale consumers?"* → add partitions and consumers up to partition count; beyond that, you're adding partitions.
- *"What if a consumer falls behind?"* → monitor **consumer lag** (latest offset − committed offset). Mitigate by adding consumers/partitions, speeding processing, or scaling out. Retention must exceed worst-case lag or you lose un-read data.
- *"Kafka vs Redis Streams / RabbitMQ?"* → log + replay + huge throughput vs lighter-weight delivery; see [queues-vs-streams](queues-vs-streams.md).

## Gotchas

- **Cross-partition ordering does not exist.** Designs that assume global order across a topic are wrong.
- **Adding partitions changes `hash(key) % n`** → existing keys remap to different partitions, breaking ordering for in-flight keys. Plan partition count ahead.
- **Consumer lag silently growing** is the classic incident — if lag exceeds retention, data is deleted before it's read.
- **Rebalance storms** from slow consumers (processing longer than `max.poll.interval.ms`) get them kicked from the group, triggering more rebalances.
- **`acks=1` feels fine until a broker dies** — then you discover the data loss. Match `acks` to the durability you actually claimed.
- **Exactly-once is bounded** — Kafka's EOS covers Kafka-to-Kafka; external side effects still need idempotent handling.

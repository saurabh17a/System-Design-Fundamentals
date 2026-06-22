# Distributed Message Queue (Kafka) — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[messaging]` `[partitioning]` `[replication]` `[durability]`
> **Companies that ask this:** Confluent, Meta, Uber, every infra-leaning interview

---

## Beginner's Guide

### What's this in plain English?

A messaging system between services. Service A wants to tell Service B "user signed up" without depending on B being available right now. A puts a message on a queue; B reads it later, even if A has gone away. Kafka does this at huge scale: durable, replicated, partitioned, supports many consumers.

### Why solve it?

- **Real world**: Kafka, Pulsar, AWS Kinesis, Google Pub/Sub.
- **Teaches**: partitioned logs, replication, consumer groups, ordering, durability.

### Vocabulary

- **Topic** — a named stream of messages.
- **Partition** — topic split into N parallel logs (each ordered).
- **Producer** — writes messages.
- **Consumer** — reads.
- **Consumer group** — multiple consumers sharing the work; each partition handled by one consumer in the group.
- **Offset** — position in a partition; consumers track where they are.
- **Replication factor** — N copies for durability.

### High-level architecture

```
Producer → Topic (partitioned) → Replica brokers (leader + followers)
                                              ↓
                                  Consumer group: split partitions
```

Components:
1. **Topics → partitions** — producer picks partition (by key hash for ordering).
2. **Replication** — leader takes writes; replicates to followers; failover if leader dies.
3. **Consumer groups** — N consumers; each gets a subset of partitions.
4. **Durability** — fsync to disk before ack.
5. **Retention** — configurable; some keep messages forever (event sourcing).

Ordering: per-partition only. Cross-partition order isn't guaranteed.

### How to read this doc

- **Beginner**: focus on partitions + consumer groups.
- **Interview**: cross-questions on replication, exactly-once semantics, ordering, schema evolution.

---

## 0. How to use this doc in an interview

Tests **partitioned log + replication + consumer groups + ordering**. Trap: assuming "queue" = FIFO with single consumer; modern message queues (Kafka, Pulsar) are partitioned logs with consumer groups.

---

## 1. Problem Statement

A distributed message queue:
- Producers write messages to topics.
- Consumers read from topics.
- Ordered per partition; multiple partitions for scale.
- Replicated for durability.
- Replay-able (consumers can rewind).
- Scales to millions of messages/sec.

---

## 2. Clarifying Questions

- [ ] Pub/sub or queue (queue = each msg to one consumer; pub/sub = all)?
- [ ] Order requirements?
- [ ] At-least-once or exactly-once?
- [ ] Retention?
- [ ] Multi-region?

> **Assume:** Kafka-like (partitioned log; pub/sub via consumer groups); per-partition order; at-least-once default + exactly-once option; 7-day retention; multi-region replication.

---

## 3. Functional Requirements

**P0:**
1. Create topics with N partitions.
2. Producer: write to topic (key → partition).
3. Consumer: subscribe; consume in order per partition.
4. Consumer groups (multiple consumers; partition reassignment).
5. Replication for durability.
6. Retention: time-based or size-based.
7. Replay: rewind consumer offset.

**P1:**
8. Exactly-once via transactions.
9. Schema registry.
10. Dead-letter topics.

**P2:**
11. Compaction (key-based retention).
12. Multi-region active-active.
13. KSQL / streaming.

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.99% |
| Throughput | 1M+ msg/sec per cluster |
| Latency | < 10 ms producer ack |
| Durability | RF 3; survive 1 broker loss |
| Retention | 7 days default |

---

## 5. Capacity Estimation

```
1M msg/sec × 1 KB avg = 1 GB/sec
Daily volume: 86 TB
With RF 3: 250 TB/day
Per broker: 16 TB usable → 16 brokers minimum
With headroom + partition diversity: 30+ brokers
```

---

## 6. API

```
PRODUCE topic, key, value           (sync ack: leader durable + ISR replicated)
CONSUME group_id, topic, offset?     -> stream of messages
COMMIT offset
ADMIN: create_topic(name, partitions, rf)
```

---

## 7. Data Model

### Topic
- N partitions; each partition = ordered log.
- RF = replication factor (typically 3).

### Partition
- Append-only log on disk.
- Each message: (offset, key, value, ts).
- Segments: log split into 1 GB files; old segments deleted on retention.

### Broker
- Hosts replicas of many partitions.
- Each partition has 1 leader + N-1 followers (ISR = In-Sync Replicas).

### Controller
- One broker designated controller (via ZK or KRaft consensus).
- Handles partition leader election, broker join/leave.

---

## 8. Architecture

```
              ┌──────────────────────┐
              │  Producers           │
              └──────────┬───────────┘
                         │ partition by hash(key)
                         ▼
                ┌────────────────────┐
                │  Brokers (cluster) │
                │  - leader writes    │
                │  - replicate to ISR │
                │  - flush to disk    │
                └─────┬─────┬────────┘
                      │     │
                      ▼     ▼
                  Disk segments per partition

                ┌────────────────────┐
                │  Controller        │ (KRaft / ZK)
                │  - partition assign│
                │  - leader election │
                └────────────────────┘

              ┌──────────────────────┐
              │  Consumers (groups)  │
              │  - assigned partition│
              │  - committed offset  │
              └──────────────────────┘
```

---

## 9. Component Deep-Dives

### 9.1 Producer
- Hashes key → partition.
- Sends to leader broker.
- `acks` config:
  - 0: fire-and-forget (fastest, lossy)
  - 1: leader ack (default)
  - all: all ISR ack (most durable)

### 9.2 Broker
- Append message to leader's log file.
- Replicate to followers.
- Acknowledge per `acks` config.

### 9.3 Consumer group
- Multiple consumer processes.
- Partitions assigned to consumers.
- Each consumer reads its assigned partitions.
- Rebalance on consumer join/leave.

### 9.4 Offset commit
- Consumer commits "I've processed up to offset X."
- Stored in special `__consumer_offsets` topic (Kafka itself).
- On consumer restart: resumes from committed offset.

### 9.5 Replication (ISR)
- Leader maintains ISR (followers up to date).
- If a follower lags too long: removed from ISR.
- On leader failure: new leader from ISR.

### 9.6 Retention
- Time-based: delete segments older than 7 days.
- Size-based: delete oldest if topic > X bytes.
- Compaction: keep latest message per key (for changelog topics).

---

## 10. Hard Sub-Problems

### 10.1 Ordering vs scaling
- Per-partition order strict.
- Cross-partition: no order.
- Producer's job: pick partition key wisely (e.g. user_id) so events for one user stay ordered.

### 10.2 Consumer group rebalance
- Adding/removing consumer triggers reassignment.
- Pause briefly during rebalance.
- Cooperative rebalancing minimizes pause.

### 10.3 Exactly-once
- Producer: idempotent (sequence numbers).
- Consumer: commit offset only after processing.
- Transactions: atomic write across multiple partitions + offset commit.

### 10.4 Cross-region replication
- MirrorMaker / Confluent Replicator.
- Async (lag = network round trip).
- Active-active: each region has own primary; conflict on same key partition.

### 10.5 Backpressure
- Slow consumer falls behind.
- Producer can't slow down.
- Mitigation: alert on lag; consumer group autoscale.

---

## 11. Cross-Questions ≥ 12

### 11.1 Why partition the log?
- Single log → single producer/consumer.
- Partition → parallelism.
- Trade: cross-partition ordering lost.

### 11.2 Why append-only log file?
- Sequential writes are blazing fast (rotational HDD: 100 MB/s; SSD: GB/s).
- Disk is cheap; keep more.

### 11.3 Why ISR (In-Sync Replicas)?
- Replicas that are caught up (within threshold).
- Producer waits for ISR ack; not all replicas (some may be offline).
- On leader fail: only ISR can become new leader (durable).

### 11.4 Why consumer offsets stored in topic itself?
- Avoids external state store.
- Replicated, durable, scalable.
- Eats storage but trivial vs message volume.

### 11.5 What's compaction?
- For changelog topics: keep latest message per key.
- Useful for state replay (e.g. user state).
- Periodic background job.

### 11.6 What if broker dies?
- Controller detects via ZK heartbeat.
- For each partition where broker was leader: promote ISR follower to leader.
- Partition unavailable for ~seconds during failover.

### 11.7 What if controller dies?
- New controller elected via ZK / KRaft.
- Brief "no leader" period.

### 11.8 Why not have single-leader for whole cluster?
- Doesn't scale.
- Per-partition leadership distributes load.

### 11.9 What's KRaft (vs ZooKeeper)?
- KRaft: Kafka's built-in Raft for metadata.
- Replaces ZooKeeper dependency.
- Modern Kafka uses KRaft.

### 11.10 How does exactly-once work?
- Idempotent producer: per-producer sequence number; broker dedups.
- Transactions: producer in transaction commits multiple writes atomically.
- Consumer commits offset in same transaction.

### 11.11 How are large messages handled?
- Default max ~1 MB.
- Larger: store in S3, reference in message.

### 11.12 What about ordering across topics?
- Not guaranteed.
- App-level: use single topic with partition key for related events.

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| Partitioned log | Parallelism | Cross-partition order |
| Append-only | Sequential write speed | Updates require compaction |
| ISR-based ack | Durability + speed | Some replication lag |
| Pull (consumer-driven) | Backpressure built-in | Constant polling |

---

## 13. Cheat-Sheet

1. **Topics → Partitions** (each = ordered log).
2. **Producers** hash key → partition.
3. **Consumers** in group; partition assignment.
4. **Replication** with ISR.
5. **Append-only log files**; segments + retention.
6. **Controller** for cluster metadata (KRaft / ZK).
7. **Exactly-once** via idempotent producer + transactions.

---
title: Queues vs Event Streams
---

# Message Queues vs Event Streams — Deep Dive

> **Type:** Core concept
> **Tags:** `[messaging]` `[queue]` `[streaming]` `[async]` `[decoupling]`
> **Where it shows up:** [notification-system](../../HLD/notification-system.md), [job-scheduler](../../HLD/job-scheduler.md), [payment-system](../../HLD/payment-system.md), [web-crawler](../../HLD/web-crawler.md), [message-queue](../../HLD/message-queue.md)

---

## Mental model

Both queues and streams let services communicate **asynchronously** — a producer hands off work/events without waiting for the consumer — which buys you **decoupling**, **load leveling** (absorb bursts), and **resilience** (the broker buffers when consumers are down). But they're built on opposite metaphors:

- **Message queue** (RabbitMQ, Amazon SQS) — a **mailbox**. A message is delivered to a consumer, **acknowledged, and then deleted.** Work is consumed *once* and gone. Think: a to-do list where finished items are crossed off.
- **Event stream / log** (Apache [Kafka](kafka.md), Kinesis, Redis Streams) — an **append-only log**. Events are **retained** for a window regardless of who read them; many independent consumers read at their own **offset** and can **replay** the past. Think: a ledger everyone can read from any point.

The interview skill is choosing correctly: "do I have **tasks to be done once** (queue) or **events many systems care about and may replay** (stream)?" Picking the wrong one is a common design smell.

## Message queues

A producer puts a message on a queue; one of N **competing consumers** takes it, processes it, and **acks** (so it's removed). Unacked messages are redelivered (at-least-once).

- **Strengths:**
  - **Competing consumers / work distribution** — add consumers to drain a backlog faster; each message goes to exactly one worker.
  - **Per-message control** — priorities, **delayed/scheduled delivery**, TTLs, **dead-letter queues** (DLQ) for messages that keep failing.
  - **Flexible routing** — RabbitMQ exchanges (direct/topic/fanout) route messages by rules.
  - Simple mental model for **task/job processing**.
- **Weaknesses:**
  - **No replay** — once acked and deleted, it's gone; a new consumer can't read history.
  - **Ordering** is limited (parallel competing consumers reorder work; strict order needs a single consumer or special FIFO modes).
  - One stream of work can't easily feed many independent subsystems each at their own pace.

**Reach for a queue when:** you have **tasks/jobs** to execute once — send emails ([notification-system](../../HLD/notification-system.md)), process a payment step, run a scheduled job ([job-scheduler](../../HLD/job-scheduler.md)), crawl a URL ([web-crawler](../../HLD/web-crawler.md)) — and you want easy scaling of workers, retries, DLQs, and priorities.

## Event streams

A producer appends events to a partitioned, **retained** log; **consumer groups** read independently by offset and can rewind. (Full internals in [Kafka](kafka.md).)

- **Strengths:**
  - **Replay & time travel** — reprocess history (fix a bug, build a new view, backfill a new consumer).
  - **Many independent consumers** — analytics, billing, search-indexing each read the *same* events at their own offset (fan-out to multiple systems).
  - **Ordering within a partition** and **massive throughput** (sequential log, [LSM](../Databases/storage-engines-lsm-vs-btree.md)-like append).
  - Foundation for **event sourcing, CDC, and stream processing**.
- **Weaknesses:**
  - **No per-message delete/ack semantics** — you don't remove a single event; you advance an offset. Priorities/selective ack/per-message delay aren't native.
  - **Heavier to operate** — partitions, [consensus for metadata](../Coordination/zookeeper-etcd.md), capacity planning.
  - Consumers must manage offsets and **idempotency** (at-least-once → possible reprocessing).

**Reach for a stream when:** the same **events** matter to **multiple consumers**, you need **replay**, **ordering**, or **high-volume** ingestion — clickstreams ([ad-click-aggregator](../../HLD/ad-click-aggregator.md)), metrics/logs ([metrics-monitoring](../../HLD/metrics-monitoring.md), [distributed-logging](../../HLD/distributed-logging.md)), activity feeds, event sourcing.

## Comparison

| | Message Queue | Event Stream |
|---|---|---|
| Metaphor | mailbox (delete on ack) | append-only log (retained) |
| Consumption | one consumer per message | many independent groups |
| After processing | message deleted | event stays (offset advances) |
| Replay | no | **yes** |
| Ordering | limited | per-partition |
| Per-message priority/delay/DLQ | **yes** | not native |
| Throughput | high | **very high** |
| Best for | task/job processing | event distribution, analytics, sourcing |
| Examples | RabbitMQ, SQS | Kafka, Kinesis, Redis Streams |

## Delivery semantics (applies to both)

- **At-most-once** (ack before processing) — no dupes, possible loss.
- **At-least-once** (process then ack/commit) — no loss, **possible duplicates** → make consumers **idempotent** (dedup keys, upserts). The practical default for both.
- **Exactly-once** — bounded and hard; Kafka offers in-cluster transactions, but end-to-end you still design idempotent consumers. See [Kafka delivery semantics](kafka.md).

## Tradeoffs & decisions

- **Consume-once vs retain-and-replay** — the defining choice; tasks vs events.
- **Per-message ergonomics vs fan-out/replay** — queues give priorities/DLQ/delay; streams give replay/multi-consumer/throughput.
- **Simplicity vs power** — SQS/RabbitMQ are lighter to run than Kafka; don't deploy Kafka for a modest task queue.
- **Ordering needs** — strict global order is hard in both; per-partition order (stream, keyed) or single-consumer (queue) are the realistic options.

## Common interview follow-ups

- *"Queue or stream here?"* → tasks done once → queue; events many systems consume / need replay → stream.
- *"Why not just use Kafka for everything?"* → operational weight, and it lacks native per-message priority/delay/DLQ; a job queue is simpler and fitter for task processing.
- *"How do you handle a poison message?"* → queue: retry + **DLQ** after N failures; stream: skip/park the offset and route the bad event aside (you can't delete it).
- *"How do you avoid double-processing on retry?"* → at-least-once + **idempotent** consumers (dedup keys/upserts).
- *"Multiple teams need the same events."* → stream with independent consumer groups, not a queue (a queue's message goes to only one consumer).
- *"Smooth out a traffic spike to a slow downstream?"* → either, as a buffer; pick by whether you also need replay/fan-out.

## Gotchas

- **Using a queue when consumers need replay or fan-out** — once acked, the message is gone; a queue can't feed many independent subsystems or reprocess history.
- **Using a stream for a simple task queue** — you take on partitions/offsets/idempotency and lose native priorities/DLQ/delay for no benefit.
- **Assuming exactly-once for free** — both are at-least-once in practice; design idempotency.
- **Expecting global ordering** — neither gives cheap total order; key for per-partition order or use a single consumer.
- **No DLQ / poison-message plan** — one bad message can stall or infinitely retry; queues need a DLQ, streams need a skip/park strategy.
- **Ignoring consumer lag / retention** — in streams, if consumers fall behind past retention, unread events are deleted ([Kafka](kafka.md)).

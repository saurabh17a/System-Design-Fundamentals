# Asynchronous Processing — Deep Dive

> **Type:** Core concept
> **Tags:** `[async]` `[queues]` `[decoupling]` `[background-jobs]` `[idempotency]`
> **Where it shows up:** [notification-system](../../HLD/notification-system.md), [job-scheduler](../../HLD/job-scheduler.md), [payment-system](../../HLD/payment-system.md), [youtube](../../HLD/youtube.md), [web-crawler](../../HLD/web-crawler.md)

---

## Mental model

Synchronous processing means the caller **waits** for the work to finish before getting a response. Asynchronous processing means the system **accepts the work, returns immediately, and does it in the background.** The shift is from "do it now while you wait" to "I've got it — I'll handle it and tell you when it's done."

The interview reflex: when a request triggers work that is **slow, can fail and be retried, or doesn't need to block the user**, move it off the request path. Uploading a video? Accept it, return "processing," and transcode in the background. Placing an order? Confirm it, then handle email/inventory/analytics asynchronously. This is how you keep user-facing latency low and absorb load spikes. The mechanism is almost always a [queue or stream](queues-vs-streams.md) plus workers.

## Why go async — what it buys you

- **Lower user-facing latency** — return as soon as the work is *accepted*, not *completed*. The video uploads in seconds; transcoding (minutes) happens behind the scenes.
- **Load leveling / smoothing spikes** — a burst of requests piles into the queue; workers drain it at a steady rate instead of overwhelming downstream systems. The queue is a shock absorber.
- **Decoupling** — producer and consumer don't need to be up at the same time or scale together; the broker buffers between them. One service publishing an event doesn't care who consumes it.
- **Resilience** — if a worker/downstream is down, work waits in the queue and is processed on recovery, rather than being lost or failing the user ([resiliency](../Resiliency/designing-for-resiliency.md)).
- **Independent scaling** — scale workers to the backlog without touching the API tier.

## The basic architecture

```
Client → API (validate, enqueue, return 202 Accepted) 
                       │
                       ▼
                 ┌───────────┐
                 │   Queue    │  (buffer; absorbs bursts, survives worker downtime)
                 └─────┬─────┘
                       │  pull
            ┌──────────┼──────────┐
            ▼          ▼          ▼
        Worker     Worker     Worker      (scale horizontally to the backlog)
            │          │          │
            ▼          ▼          ▼
        downstream (DB, email provider, transcoder, ...)
```

The API does the minimum synchronously (validate, persist a record, enqueue) and returns a **handle** (job id / `202 Accepted`). The client learns the result by **polling** a status endpoint, a **webhook/callback**, or a **push** ([SSE/WebSocket](../Networking/realtime-websockets-sse.md)).

## What you must get right (the hard parts)

Async introduces failure modes that synchronous code doesn't have. These are exactly the follow-ups interviewers ask:

- **Idempotency** — queues deliver **at-least-once**, so a message *will* occasionally be processed twice (worker crashes after doing the work, before ack → redelivery). Make processing **idempotent**: dedup on a key, use upserts, check "already done." Without this, you double-charge / double-send. The single most important async correctness property.
- **Retries with backoff + jitter** — transient failures (downstream blip) should retry, but cap attempts and back off exponentially with jitter so you don't hammer a recovering dependency (a retry storm).
- **Dead-letter queue (DLQ)** — a "poison" message that keeps failing must be parked after N attempts so it doesn't block the queue or retry forever. Alert on DLQ growth.
- **Ordering** — most queues don't guarantee strict order across parallel workers. If order matters (process a user's events in sequence), key/partition by the entity ([Kafka partitions](kafka.md)) or use a single consumer — accepting the throughput cost.
- **Exactly-once is a myth (mostly)** — the practical target is **at-least-once delivery + idempotent consumers** = effectively-once. See [queues-vs-streams](queues-vs-streams.md).
- **Visibility / status** — the user needs to know what happened; design the status/callback mechanism, and handle the "what if it never completes?" case (timeout, DLQ, alert).

## Queue vs stream for the transport

The buffer is either a **message queue** (work consumed once then deleted — RabbitMQ/SQS) or an **event stream** (retained, replayable, multi-consumer — [Kafka](kafka.md)). Choose by whether it's **tasks done once** (queue) or **events many systems care about / need replay** (stream). Full comparison in [queues-vs-streams](queues-vs-streams.md). For request/response that just needs to be *deferred*, a queue is the simpler default.

## Tradeoffs & decisions

- **Latency vs immediacy of result** — fast acceptance, but the user gets the *result* later and must be told (poll/callback/push). Some flows genuinely need a synchronous answer (a login, a balance check) — don't async those.
- **Decoupling/resilience vs complexity & eventual consistency** — you add a broker, workers, status tracking, idempotency, DLQs, and the system becomes **eventually consistent** (the result isn't there the instant the API returns). More moving parts to operate and reason about.
- **Throughput vs ordering** — parallel workers scale but reorder; strict order costs parallelism.
- **At-least-once simplicity vs exactly-once cost** — lean on idempotency rather than chasing true exactly-once.

## When to use / when not

**Go async when:** the work is slow (media processing, report generation, bulk sends), can be retried, fans out to multiple consumers, must survive downstream outages, or just doesn't need to block the user (emails, analytics, audit logs, cache warming).

**Stay synchronous when:** the caller genuinely needs the result to proceed (authentication, a payment authorization the user is waiting on, reading data to render *this* page), or the work is fast and simple enough that a queue adds complexity for no benefit. Don't async a 5ms DB read.

## Common interview follow-ups

- *"How do you keep the upload/checkout fast?"* → accept + enqueue + return immediately; do the heavy work in background workers; notify on completion.
- *"What if a job is processed twice?"* → idempotent consumers (dedup key / upsert) — at-least-once delivery makes duplicates inevitable.
- *"What about a job that keeps failing?"* → retry with backoff + jitter, then dead-letter after N attempts and alert.
- *"How does the client get the result?"* → poll a status endpoint, a webhook/callback, or push via SSE/WebSocket.
- *"How do you handle a spike?"* → the queue absorbs it; workers drain at a steady rate (load leveling); autoscale workers on backlog.
- *"Queue or stream?"* → tasks-once → queue; events for many consumers / replay → stream.

## Gotchas

- **Non-idempotent consumers** — the classic async bug; at-least-once delivery double-processes and you double-charge/double-send.
- **Unbounded retries / no DLQ** — a poison message retries forever or blocks the queue; cap and dead-letter.
- **Retry storms** — synchronized, uncapped retries DoS a recovering downstream; backoff + jitter (+ [circuit breaker](../Resiliency/circuit-breakers.md)).
- **Assuming ordering** — parallel workers reorder; key/partition or single-consume if order matters.
- **No status/visibility** — accepting work then leaving the client blind; design polling/callback and a "never completed" path.
- **Async-ing things that need a sync answer** — forcing a queue between a user and a result they're waiting on adds latency and complexity.
- **Forgetting eventual consistency** — the result isn't present the moment the API returns; downstream reads must tolerate the gap.

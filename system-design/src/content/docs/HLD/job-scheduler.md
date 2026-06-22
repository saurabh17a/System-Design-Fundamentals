# Distributed Job Scheduler — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[distributed-systems]` `[exactly-once]` `[leader-election]` `[cron]`
> **Companies that ask this:** Google, Meta, Airbnb, every infra team

---

## Beginner's Guide

### What's this in plain English?

Linux's `cron` runs scheduled tasks at fixed times. Now imagine doing this across 1000s of servers with **failure handling** — if a worker crashes mid-job, another picks up. If two workers grab the same job, only one runs. Plus: dependencies (job B runs only if A succeeds), retries, observability.

### Why solve it?

- **Real world**: Airbnb's Airflow, Netflix's Conductor, Google's internal schedulers.
- **Teaches**: distributed locks, leader election, exactly-once execution, dependency graphs.

### Vocabulary

- **Job** — a task to run; one-off or recurring.
- **Cron** — recurring schedule (`0 9 * * 1-5` = weekdays at 9am).
- **Worker** — process that runs jobs.
- **Lease / Lock** — claim on a job so others don't take it.
- **Idempotency** — running a job twice has same effect as once.
- **DAG** — directed acyclic graph of jobs with dependencies.

### High-level architecture

```
Schedule store (jobs + cron) → Scheduler (decide what's due) → Job queue
                                                                    ↓
                                                              Workers grab + lease + run
                                                                    ↓
                                                              Status update + retries
```

Components:
1. **Job store** — definitions + schedules.
2. **Scheduler** — leader-elected service; emits "job X is due" events.
3. **Queue** — durable; survives crashes.
4. **Workers** — pull, lease (so duplicates can't take the same job), run, ack.
5. **Status / observability** — success/fail history, alerting.

Exactly-once is hard. Most systems are at-least-once with idempotent jobs.

### How to read this doc

- **Beginner**: focus on the queue + lease model.
- **Interview**: cross-questions on exactly-once vs idempotent, DAGs, multi-tenant.

---

## 0. How to use this doc in an interview

Tests **distributed scheduling, exactly-once execution, and failure handling**. Tests:
1. Cron-like (recurring) + one-off jobs.
2. Exactly-once even under failure.
3. Coordinated leader for scheduling decisions.
4. Worker pool execution.

---

## 1. Problem Statement

A distributed scheduler:
- Define jobs (cron expressions or one-off).
- Trigger at scheduled time.
- Execute on worker pool.
- Handle failures (retry, alert).
- Ensure exactly-once where required.
- Multi-tenant.

---

## 2. Clarifying Questions

- [ ] Job size (sec, min, hr)?
- [ ] Latency tolerance (job triggered at exact second or close)?
- [ ] Cron + one-off + delayed?
- [ ] Idempotent jobs guaranteed by user, or system enforces exactly-once?
- [ ] Workflow / DAG support?

> **Assume:** jobs run from 100ms to 1hr; trigger latency < 5s; cron + one-off + delayed; user-marked idempotency for exactly-once mode; no DAG (out of scope, see workflow svc).

---

## 3. Functional Requirements

**P0:**
1. Define job with schedule (cron, time, delay).
2. Trigger at scheduled time.
3. Dispatch to worker.
4. Track execution status.
5. Retry on failure (configurable).
6. Catch-up: missed jobs (if scheduler down) are run when service recovers.

**P1:**
7. Exactly-once mode for billing-critical jobs.
8. Job dependencies / chains.
9. Per-tenant rate limits.
10. Timeout per job.

**P2:**
11. DAG / workflow.
12. Resource pinning (e.g. GPU).

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.99% |
| Trigger latency | < 5 s p99 |
| Throughput | 100k jobs/min |
| Exactly-once | for marked jobs |

---

## 5. Capacity Estimation

```
Active scheduled jobs: 10M
Triggers/min average: 100k
Triggers/sec peak: 10k (cron alignment, e.g. midnight)
Worker pool: 10k workers; each runs many concurrent
```

---

## 6. API

```
POST /v1/jobs   body: {name, schedule, target, payload, retry_policy, idempotency_key?}
                                                       -> job_id
GET  /v1/jobs/{id}                                     -> definition
GET  /v1/jobs/{id}/runs                                -> recent runs
DELETE /v1/jobs/{id}
```

---

## 7. Data Model

### Jobs (Postgres)
- `(job_id, owner, schedule, target, payload, retry_policy, idempotency_key, next_run_at, status)`

### Runs (Cassandra)
- `(job_id, ts, run_id, status, attempts, output)` — partitioned by job_id.

### Schedule index (in-memory + DB)
- Sorted by next_run_at; quick "what runs in the next 60s?"

---

## 8. Architecture

```
                ┌──────────────────────┐
                │   API                │
                └────────┬─────────────┘
                         │
                ┌────────▼──────────────┐
                │ Scheduler (leader)    │
                │ - tick every second   │
                │ - find due jobs       │
                │ - emit to queue       │
                └────────┬──────────────┘
                         │
                ┌────────▼──────────┐
                │  Job Queue (Kafka)│
                │  topic: due-jobs  │
                └────────┬──────────┘
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
        ┌──────────┐         ┌──────────┐
        │ Worker   │   ...   │ Worker   │
        │ pool     │         │ pool     │
        │ (executes│         │          │
        │  jobs)   │         │          │
        └────┬─────┘         └────┬─────┘
             │                    │
             └─────────┬──────────┘
                       ▼
               ┌────────────────┐
               │ Run results    │
               │ (Cassandra)    │
               └────────────────┘
```

### Scheduler is leader-elected
- One scheduler at a time picks due jobs.
- Multiple stand-by; leader election via etcd / ZooKeeper.

---

## 9. Component Deep-Dives

### 9.1 Scheduler
- Tick every 1 sec.
- Query DB: `WHERE next_run_at <= now`.
- For each: emit message to Kafka.
- Update next_run_at for cron jobs.

### 9.2 Worker
- Pull from queue.
- Execute (HTTP call, function invocation, container).
- Report result (success/fail).
- Retry on failure per policy.

### 9.3 Exactly-once
- Idempotency key passed to job target.
- Worker dedups: same idempotency → same outcome.
- Or: job marked completed in DB only after successful target ack.
- Trade: at-least-once is the default; exactly-once requires user cooperation.

### 9.4 Catch-up
- After scheduler outage: jobs that should have run during outage detected (next_run_at < now - 60s).
- Run them or skip per policy ("catch_up = true|false").

### 9.5 Retry policy
- Linear, exponential, custom.
- Max retries.
- Dead-letter on final failure.

---

## 10. Hard Sub-Problems

### 10.1 Single scheduler bottleneck
- Single leader picks jobs; could become bottleneck.
- Partition by job hash: 16 schedulers, each owns 1/16 of jobs. Each is leader of its partition.
- Failover handled per-partition.

### 10.2 Exactly-once execution
- Worker crashes after running but before ack: job status uncertain.
- Mitigation: idempotency at job target.
- Dual-write: both worker logs run + DB confirms; reconcile.

### 10.3 Time skew
- Worker clocks may drift.
- Trust scheduler's time; pass to job.
- Use UTC throughout.

### 10.4 Stragglers
- A job running for hours.
- Timeout configurable; SIGTERM/SIGKILL on exceed.

---

## 11. Cross-Questions ≥ 12

### 11.1 Why leader election?
- Avoid double-trigger (two schedulers picking same job).
- Single source of truth per partition.

### 11.2 Why partition the scheduler?
- 10M jobs in one scheduler is heavy.
- Partition by job_id hash; each partition has its own leader.

### 11.3 Why Kafka between scheduler and worker?
- Durable queue.
- Replay on worker failure.
- Decouples ingestion rate from execution rate.

### 11.4 How is "missed" job detected?
- Scheduler's catch-up sweep on startup.
- Jobs with `next_run_at < now - threshold` flagged.
- Run or skip per config.

### 11.5 What if a worker crashes mid-execution?
- Run state = "running" in DB.
- Watchdog: if heartbeat lost > 60s → mark failed.
- Retry per policy.

### 11.6 How is exactly-once vs at-least-once chosen?
- User declares per job.
- Default at-least-once (cheaper).
- Exactly-once: idempotency_key + watchdog.

### 11.7 What about job priorities?
- Multiple Kafka topics by priority.
- Workers consume from high before low.

### 11.8 What about long-running jobs?
- Workers heartbeat regularly to extend lease.
- Lease expires → re-scheduled.

### 11.9 How is Cron parsed?
- Standard cron lib (`cronexpr`).
- Validate at job creation.

### 11.10 What about timezones?
- Stored in UTC; user supplies tz.
- Cron next-run computed in user's tz.

### 11.11 How do you scale to millions of cron jobs?
- Partition by job_id.
- Per-partition scheduler scales horizontally.
- DB sharded similarly.

### 11.12 What's the failure mode if scheduler is partitioned from DB?
- Existing jobs continue (in-memory state).
- New picks halt; backlog grows.
- Recovery: reload from DB; catch-up missed.

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| Leader-elected scheduler | Avoid double-trigger | Single point of bottleneck per partition |
| Kafka queue | Decoupling, replay | Complexity |
| At-least-once default | Simple | User must ensure idempotency |
| Catch-up sweep | Resilience | Possible re-run on outage |

---

## 13. Cheat-Sheet

1. **Leader-elected scheduler** per partition.
2. **Tick query** for due jobs; emit to Kafka.
3. **Worker pool** consumes; reports back.
4. **At-least-once** by default; **exactly-once** via idempotency_key.
5. **Catch-up** on scheduler restart.
6. **Watchdog** for crashed workers.
7. **Partition by job_id** for horizontal scale.

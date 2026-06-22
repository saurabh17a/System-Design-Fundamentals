# Distributed Lock Service (etcd / ZooKeeper) — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[consensus]` `[raft]` `[fencing]` `[lease]`
> **Companies that ask this:** Google, Meta, every infra team

---

## Beginner's Guide

### What's this in plain English?

A "distributed lock" is a way for many machines to agree: "only one of us is allowed to do X right now." Real-world example: only one machine should run the daily cleanup job. They all want to. They need a referee — that's the distributed lock service. ZooKeeper and etcd are the famous ones; both use Raft consensus to never give the same lock to two machines, even with network partitions.

### Why solve it?

- **Real world**: ZooKeeper, etcd, Consul; used inside Kafka, Kubernetes, Hadoop.
- **Teaches**: consensus algorithms (Raft / Paxos), leases, fencing tokens, split-brain prevention.

### Vocabulary

- **Lock / Lease** — a claim with a timeout, so a dead client doesn't hold forever.
- **Consensus** — algorithm where N nodes agree on a single value despite failures.
- **Raft** — modern, easier-to-explain consensus algorithm.
- **Fencing token** — monotonically increasing number issued with each lock; receivers reject stale tokens.
- **Split brain** — two nodes both think they hold the lock — bad.

### High-level architecture

```
Clients → Lock API → 3-5 server cluster running Raft (one leader, others followers)
                                ↓
                          Replicated log of operations
```

Components:
1. **Cluster of 3-5 nodes** — Raft consensus.
2. **API** — `acquire(key, ttl)`, `release(key)`, `extend(key)`.
3. **Lease** — auto-released on TTL expiry if client dies.
4. **Fencing token** — included with lock; receivers (e.g., a database) check token monotonicity.

The "client paused for GC" failure mode is real — fencing tokens defeat it.

### How to read this doc

- **Beginner**: focus on lease + fencing token concepts.
- **Interview**: cross-questions on Raft basics, split-brain, performance vs Redis Redlock.

---

## 0. How to use this doc

Tests **distributed consensus + lease semantics + fencing tokens**. Trap: not addressing client-side failure (lock holder dies / pauses).

---

## 1. Problem Statement

A distributed lock service:
- Multi-process clients acquire mutually-exclusive locks.
- Lock has lease (auto-released on holder death).
- Survives lock-server failures.
- Clients can renew lease.
- Fencing tokens prevent stale-holder writes.

Used for: leader election, exclusive resource access, distributed cron coordination.

---

## 2. Clarifying Questions

- [ ] Liveness vs safety priority?
- [ ] Lease duration?
- [ ] Multi-region?
- [ ] Hierarchical locks (path-based)?
- [ ] Notifications on release?

> **Assume:** safety > liveness (CP); 30 s default lease; single region; hierarchical (path-based like ZK); notifications via watch.

---

## 3. Functional Requirements

**P0:**
1. Acquire(key, lease) — atomic; only one holder.
2. Release(key, holder).
3. Renew(key, holder, lease) — extend.
4. Try-acquire (non-blocking).
5. Watch(key) — notification on change.
6. Auto-release on lease expiry.
7. Fencing token (monotonic per lock).

**P1:**
8. Hierarchical paths (`/services/x/leader`).
9. Quorum reads.

**P2:**
10. Multi-region replication.

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.99% (CP system: writes block during partition) |
| Latency P99 | < 50 ms acquire |
| Throughput | 10k ops/sec per cluster |
| Safety | Strong; no two holders simultaneously |
| Members | 3-5 nodes (Raft quorum) |

---

## 5. Architecture

```
                 Clients (apps)
                     │
                     ▼
              ┌──────────────────┐
              │ Lock Server      │  (3-5 nodes, Raft consensus)
              │  - Leader        │
              │  - Followers     │
              └──────┬───────────┘
                     │
                     ▼
            Replicated state machine:
            keys[path] = {holder, lease_end_ts, fencing_token}

            Writes go through Raft log; replicated to majority.
            Reads either:
              - linearizable (route to leader)
              - quorum reads
              - eventual (read from any follower)
```

---

## 6. API

```
ACQUIRE(key, client_id, lease_ms)
    -> {success, fencing_token, lease_end_ts}
RELEASE(key, client_id, fencing_token)
    -> bool
RENEW(key, client_id, fencing_token, lease_ms)
    -> {success, new_lease_end}
TRY_ACQUIRE(key, client_id, lease_ms)
    -> immediate response
WATCH(key) -> stream of updates
```

---

## 7. Component Deep-Dives

### 7.1 Raft consensus
- 3 or 5 nodes.
- Leader handles all writes.
- Each write replicated to majority before ack.
- On leader failure: election among followers.

### 7.2 State machine
```
state = {
  "/path/to/lock": {
     holder_id: "client-42",
     fencing_token: 17,
     lease_end_ts: 1716200000,
  }
}
```

### 7.3 Acquire flow
- Client sends ACQUIRE.
- Leader checks state machine.
- If free or expired: append "acquire(key, client, lease, token)" to log.
- Replicate to majority.
- On commit: update state machine; respond.

### 7.4 Lease + fencing
- Lease = automatic release.
- Fencing token = monotonic counter per lock.
- Holder uses token in subsequent writes (e.g. to DB).
- DB checks: only accept token >= last_seen_token.
- Prevents "stale holder" race (holder paused; lease expired; new holder; old wakes up).

### 7.5 Watch
- Client subscribes to key.
- On state change: notification pushed.
- Used for "wait for lock" without polling.

---

## 8. Cross-Questions ≥ 15

### 8.1 Why Raft?
- Strongly consistent.
- Mature, simpler than Paxos.
- ZooKeeper uses ZAB (similar); etcd uses Raft.

### 8.2 What if leader dies?
- Election: ~150-300 ms (election timeout).
- New leader from followers.
- Pending acquires retried by clients.

### 8.3 Why fencing tokens?
The lock server can't prevent a paused client from writing to a resource after lease expiry.
Fencing token: monotonic. Resource (DB) checks "is this token recent enough?". Stale tokens rejected.

### 8.4 What's CAP here?
CP (consistency + partition tolerance). Availability sacrificed during partition (no leader).

### 8.5 How is "client died" detected?
Lease expiry. Periodic renewal required; missed renewal = release.

### 8.6 What if network partition?
Minority partition → no writes (no quorum).
Majority partition → continues.
Lock holders in minority lose ability to renew → lease expires → caller's resource sees stale token.

### 8.7 Fairness?
Acquire requests can be queued FIFO via watch.
Clients waiting via WATCH; first awoken wins.

### 8.8 Hierarchical paths?
Like ZK: `/services/x/leader`.
Watches set on parent; recursive.

### 8.9 Read scaling?
Quorum reads = 2 round trips (verify with majority).
Eventual reads from any follower = stale possible.
For lock service: usually want strict; eat the latency.

### 8.10 Why limit cluster to 5 nodes?
Raft commit requires majority ack. 5 nodes → 3-node quorum.
More nodes = more replication overhead; not better fault tolerance.

### 8.11 What's the TPS limit?
Single Raft leader sequential writes. ~10k/sec on modest hardware.
Bigger TPS requires sharding (multiple Raft groups).

### 8.12 What if I need 100k locks?
Sharded: many Raft groups; lock key hashes to one.
Each group has its own leader.

### 8.13 vs Redis SETNX?
Redis: simple; no consensus → can lose data on failover.
Lock service: stronger guarantees but slower.
Use Redis for "best effort" (cache invalidation); use this for "must not double-acquire."

### 8.14 What about cluster reconfiguration?
Special log entry adds/removes node.
Replicated; new config takes effect after commit.

### 8.15 What about multi-region?
Cross-region Raft: high latency (cross-region quorum).
Better: per-region cluster + global service discovery.

---

## 9. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| Raft (CP) | Strong consistency | Availability during partition |
| 3-5 nodes | Fast quorum | Limited TPS |
| Lease + fencing | Safety against stale holder | Resource has to check tokens |
| Linearizable reads | Strong guarantees | Higher latency |

---

## 10. Cheat-Sheet

1. **Raft cluster** (3-5 nodes).
2. **Acquire** = log entry → majority replicate → state machine update.
3. **Lease** for auto-release.
4. **Fencing token** prevents stale holder.
5. **Watches** for wait-for-lock.
6. **Hierarchical** path-based namespace (ZK-like).
7. **Sharded** for higher throughput.

---
title: ZooKeeper & etcd
---

# ZooKeeper & etcd — Deep Dive

> **Type:** Core technology
> **Tags:** `[coordination]` `[consensus]` `[leader-election]` `[locks]` `[service-discovery]`
> **Where it shows up:** [distributed-lock-service](../../HLD/distributed-lock-service.md), the coordination layer behind [Kafka](../Messaging/kafka.md), and any "how do you do leader election / locks / config?" follow-up

---

## Mental model

ZooKeeper and etcd are **coordination services** — small, strongly-consistent, highly-available key-value stores that package [consensus](consensus-raft-paxos.md) behind a simple API so *you don't have to implement Raft/Paxos yourself.* You hand them the handful of decisions that must be consistent across your whole cluster — **who's the leader, who holds this lock, what's the current config, which nodes are alive** — and they guarantee every client sees the same answer.

The key framing for an interview: these are the **control plane**, not the data plane. You store *metadata and coordination state* (kilobytes, low write rate), never your application's bulk data. When an answer needs "elect a leader," "acquire a distributed lock," "register/discover services," or "store cluster config consistently," the clean answer is "use a coordination service like ZooKeeper or etcd" rather than hand-rolling consensus.

## Internals

### Strongly consistent, replicated via consensus

- A small cluster (3 or 5 nodes — odd, for majority quorum) replicates all state via a consensus protocol: **ZAB** (ZooKeeper Atomic Broadcast) for ZooKeeper, **Raft** for etcd.
- Writes go through the leader and require a **majority** to commit → **linearizable writes**. Reads are consistent (etcd offers linearizable reads; ZooKeeper reads are fast-but-possibly-slightly-stale unless you `sync`).
- Because it's consensus-backed, it's **CP** under [CAP](cap-and-consistency-models.md): a minority partition stops serving writes rather than diverge.

### The primitives

- **ZooKeeper** exposes a filesystem-like tree of **znodes**. Two features make coordination possible:
  - **Ephemeral nodes** — a znode tied to a client session; it **disappears automatically when the client disconnects**. This is the magic behind locks, leader election, and liveness (a dead node's ephemeral node vanishes → others notice).
  - **Watches** — a client subscribes to a znode and gets **notified on change**, so it reacts without polling.
- **etcd** exposes a flat key-value store with:
  - **Leases** — keys with a TTL that must be renewed (heartbeat); expire if the client dies (the ephemeral-node equivalent).
  - **Watch** — stream of changes on a key/prefix.
  - **Compare-and-swap (txn)** — atomic conditional writes, the basis for locks.

### How the classic recipes work

- **Leader election:** every candidate creates an ephemeral *sequential* node; the lowest sequence number is the leader; others watch the node just below them. Leader dies → its ephemeral node vanishes → the next one is promoted. No split-brain because the store is linearizable.
- **Distributed lock:** acquire by creating an ephemeral node / a key via compare-and-swap; release by deleting it or letting the lease/session expire. Crucially, **a crashed lock-holder's lock auto-releases** (ephemeral/lease), avoiding deadlock — the property a naive Redis lock struggles with (see the Redlock caveat in [Redis](../Caching/redis.md) and [distributed-lock-service](../../HLD/distributed-lock-service.md)).
- **Service discovery:** services register (ephemeral key); clients watch the prefix to get a live list of healthy instances.
- **Config management:** store config in a key; watchers get pushed updates instantly.

### Fencing tokens

A subtle but interview-worthy point: a lock alone isn't enough if a client pauses (GC) past its lease, loses the lock, then resumes and acts. The fix is a **fencing token** — a monotonically increasing number handed out with each lock grant; downstream resources reject operations carrying an old token. Both ZooKeeper (zxid/version) and etcd (revision) provide monotonic numbers for this.

## Tradeoffs & decisions

- **Consistency vs throughput** — linearizable writes cost a majority round trip; great for low-rate critical state, **wrong for high-volume data**.
- **Strong guarantees vs another system to run** — you get correct coordination, but you operate a 3–5 node consensus cluster (and its failure modes).
- **ZooKeeper vs etcd** — ZooKeeper: mature, JVM, ZAB, znode/watch model, long used by Kafka/Hadoop/HBase. etcd: Go, Raft, simple gRPC KV + leases, the backbone of Kubernetes. Functionally overlapping; pick by ecosystem.
- **CP under partition** — the minority halts; your app must tolerate "coordination temporarily unavailable."

## When to use / when not

**Use a coordination service for:** leader election, distributed locks/leases, cluster membership & liveness, service discovery, and consistent configuration — the small, critical, must-agree state.

**Do NOT use it for:** application data, caches, queues, high-write-rate state. It's a low-throughput, strongly-consistent control plane. Routing bulk data through it will fall over. Also avoid adding one if you don't actually need cross-node agreement — it's real operational weight.

## Common interview follow-ups

- *"How do you do leader election?"* → ephemeral sequential nodes / leased keys in ZooKeeper/etcd; lowest sequence wins; watch your predecessor; auto-failover when the holder dies.
- *"Distributed lock that's safe if the holder crashes?"* → ephemeral node / lease auto-releases on disconnect; add a **fencing token** to defend against paused-then-resumed holders.
- *"Why not just use Redis for locks?"* → Redis locks (Redlock) are contested and can be unsafe under failover; a consensus-backed service gives linearizable, auto-releasing locks. Use Redis locks only when occasional incorrectness is acceptable.
- *"ZooKeeper vs etcd?"* → same role; ZAB/JVM vs Raft/Go; etcd powers Kubernetes, ZooKeeper powers the Hadoop/Kafka world.
- *"What does Kafka use it for?"* → historically ZooKeeper for metadata/controller election; modern Kafka uses built-in KRaft (Raft). ([Kafka](../Messaging/kafka.md))

## Gotchas

- **Storing application data in it** — it's for coordination metadata; high write volume will overwhelm a consensus cluster.
- **Lock without a fencing token** — a GC-paused client can act after losing its lock; downstream must reject stale tokens.
- **Assuming reads are always linearizable** — ZooKeeper reads can be slightly stale without `sync`; know your store's read semantics.
- **Even-sized / too-large clusters** — use 3 or 5; even sizes waste a node, large clusters slow writes.
- **Ignoring session/lease expiry tuning** — too short → false failovers on a GC pause; too long → slow detection of real failures.
- **Treating it as always-available** — it's CP; a quorum loss makes coordination unavailable, and your app must degrade gracefully.

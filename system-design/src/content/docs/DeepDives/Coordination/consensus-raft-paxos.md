---
title: "Consensus: Raft & Paxos"
---

# Consensus: Raft & Paxos — Deep Dive

> **Type:** Core concept
> **Tags:** `[consensus]` `[raft]` `[paxos]` `[leader-election]` `[distributed-systems]`
> **Where it shows up:** [distributed-lock-service](../../HLD/distributed-lock-service.md), the metadata layer of [Kafka](../Messaging/kafka.md)/databases, [zookeeper-etcd](zookeeper-etcd.md), and any "how do nodes agree?" follow-up

---

## Mental model

Consensus is how a group of machines **agree on a single value (or an ordered sequence of values) even when some of them fail or messages are lost.** That sounds abstract, but it's the foundation under leader election, distributed locks, configuration management, and replicated logs. Whenever a distributed system needs **one source of truth** about "who is the leader," "what's the current config," or "what order did these operations happen in," consensus is the machinery underneath.

The interview-level goal is not to implement Paxos — it's to know **what consensus gives you, what it costs, and when you need it**: you need it for the small amount of *critical, must-be-consistent* metadata (leadership, locks, membership), and you explicitly *avoid* running your high-volume data through it because it's expensive.

## Why consensus is hard

With multiple nodes and an unreliable network, naive agreement breaks:

- A node can't tell "crashed" from "slow" from "network-partitioned."
- Two nodes can each think they're the leader (**split-brain**) and accept conflicting decisions.
- Messages arrive out of order, duplicate, or vanish.

Consensus algorithms guarantee **safety** (never two conflicting decisions) and, when a majority can communicate, **liveness** (eventually decide). The price: you need a **majority quorum** to make progress.

## The quorum / majority idea

Consensus protocols require agreement from a **majority** (⌊N/2⌋+1) of nodes:

- 3 nodes tolerate 1 failure (majority = 2); 5 nodes tolerate 2 (majority = 3).
- **Any two majorities overlap** in at least one node — that overlap is what prevents two conflicting decisions, because at least one node "remembers" the earlier one.
- This is why consensus clusters are **small and odd-sized** (3 or 5). Even numbers waste a node (4 still only tolerates 1 failure but needs 3 for majority); large clusters slow every decision (more nodes to coordinate).
- A minority partition **cannot make progress** — it can't form a majority. That's the CP choice in [CAP](cap-and-consistency-models.md): on partition, the side without quorum stops serving writes to preserve consistency.

## Raft (the one to know well)

Raft was designed to be **understandable** (vs Paxos's notorious opacity) and is what etcd, Consul, CockroachDB, TiKV, and modern Kafka (KRaft) use. Three pieces:

### Leader election

- Nodes are **follower**, **candidate**, or **leader**. Time is divided into **terms**.
- A follower that hears nothing from a leader within a randomized **election timeout** becomes a candidate, increments the term, and requests votes.
- A candidate that gets a **majority** of votes becomes leader. Randomized timeouts make split votes rare; ties just trigger a new term.
- One leader per term — the majority rule guarantees no two leaders in the same term.

### Log replication

- All client writes go to the **leader**, which appends to its log and replicates entries to followers.
- An entry is **committed** once a **majority** has stored it; the leader then applies it and tells followers. Committed entries are durable across leader failures (a new leader must have them, by the majority-overlap argument).
- This produces a **replicated, consistent, ordered log** — exactly what you need to build a replicated state machine (every node applies the same operations in the same order → same state).

### Safety

Raft restricts elections so a candidate **missing committed entries can't win** (voters reject less-up-to-date logs). This is what keeps the log consistent through failovers.

## Paxos (know the shape, not the proof)

Paxos is the original (Lamport) consensus algorithm — provably correct, famously hard to understand and implement. Single-decree Paxos agrees on **one** value via roles (proposers, acceptors, learners) and a two-phase **prepare/promise → accept/accepted** protocol; a proposal needs a **majority** of acceptors. **Multi-Paxos** optimizes the repeated case by electing a stable leader (so you skip the prepare phase most of the time) — converging on the same practical shape as Raft. Used (in variants) by Google Chubby, Spanner, and others.

**Interview takeaway:** Raft and Multi-Paxos solve the same problem with the same majority-quorum core; Raft is the one you can actually explain. Don't get dragged into Paxos internals — say "Paxos is the classic, Raft is the understandable modern equivalent; both need a majority and elect a leader to replicate an ordered log."

## Tradeoffs & decisions

- **Consistency vs throughput** — every decision needs a majority round trip, so consensus is *slow* relative to local writes. Run only critical metadata through it, not bulk data.
- **Cluster size** — more nodes = more fault tolerance but slower decisions; 3 or 5 is the sweet spot. Odd sizes avoid wasted nodes.
- **CP under partition** — the minority side stops; you trade availability for never having split-brain.
- **Build vs use** — you almost never implement consensus; you use [ZooKeeper/etcd](zookeeper-etcd.md), which package it behind a simple API.

## When to use / when not

**You need consensus for:** leader election, distributed locks/leases, cluster membership, configuration, and any small "single source of truth" that must survive failures consistently — usually via [ZooKeeper/etcd](zookeeper-etcd.md).

**You do NOT route through consensus:** high-volume application data, caches, feeds, analytics. It's too slow and doesn't scale that way — use [replication](../Distribution/replication.md)/[quorum stores](../Databases/nosql-cassandra.md) for data; reserve consensus for the control plane.

## Common interview follow-ups

- *"How do you elect a leader / prevent split-brain?"* → Raft election with randomized timeouts + majority votes; one leader per term; minority partitions can't win.
- *"How many nodes and why odd?"* → 3 or 5; majority-overlap prevents conflicting decisions; odd sizes don't waste a node.
- *"Raft vs Paxos?"* → same majority-quorum + leader + replicated-log core; Raft is understandable, Paxos is the classic. 
- *"Why not run everything through Raft?"* → every write costs a majority round trip; it's a control-plane tool, not a data-plane one.
- *"What happens during a network partition?"* → the majority side keeps operating; the minority side halts (CP); on heal, the minority catches up.

## Gotchas

- **Using consensus for high-throughput data** — it doesn't scale that way; it's for small critical state.
- **Even-sized clusters** — 4 nodes tolerate the same 1 failure as 3 but need a bigger majority; use odd sizes.
- **Assuming the leader is always current** — clients must talk to the *current* leader; a stale leader (deposed during a partition) must step down (lease/term checks).
- **Ignoring the minority-partition stall** — apps must handle "no quorum → unavailable" rather than assume always-writable.
- **Confusing consensus with quorum replication** — Dynamo-style `W+R>N` gives tunable consistency for data; consensus gives a single agreed ordered log for control state. Related, not the same.

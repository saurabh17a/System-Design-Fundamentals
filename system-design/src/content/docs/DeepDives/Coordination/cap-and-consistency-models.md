---
title: CAP & Consistency Models
---

# CAP Theorem & Consistency Models — Deep Dive

> **Type:** Core concept
> **Tags:** `[cap]` `[consistency]` `[availability]` `[distributed-systems]`
> **Where it shows up:** Every distributed-storage decision — [distributed-cache](../../HLD/distributed-cache.md), [payment-system](../../HLD/payment-system.md), [gaming-leaderboard](../../HLD/gaming-leaderboard.md), and any "what database?" follow-up

---

## Mental model

The moment your data lives on more than one machine, two of those machines can lose contact (a **network partition**). When that happens you face an unavoidable choice: **keep serving requests but risk returning stale/divergent data (availability), or refuse requests to protect correctness (consistency).** CAP is just the formalization of that choice. It's not a property you pick once for a database; it's a tradeoff you make per-operation, under failure.

The interview value of CAP isn't reciting it — it's using it to *justify a storage decision*: "this path touches money, so under a partition I choose consistency and accept rejecting writes; this path is a feed, so I choose availability and accept staleness."

## CAP, stated precisely

For a single piece of data replicated across nodes:

- **C — Consistency** (here meaning *linearizability*): every read sees the most recent write, as if there were one copy.
- **A — Availability:** every request to a non-failing node gets a (non-error) response.
- **P — Partition tolerance:** the system keeps working despite dropped/delayed messages between nodes.

The real theorem: **when a partition happens (P), you must choose C or A.** You cannot have both *during* a partition.

The popular phrasing "pick 2 of 3" is misleading. In any distributed system **partitions will happen**, so P is not optional — you don't get to "choose CA." The honest framing is: **when partitioned, are you CP or AP?**

- **CP** (consistency over availability): on partition, refuse/block operations that can't be made safely consistent. Example posture: a system that rejects writes to a side it can't confirm. *Money, inventory, bookings.*
- **AP** (availability over consistency): on partition, keep answering from whatever replica you can reach and **reconcile later** (eventual consistency). *Feeds, caches, presence, likes.*

When there's **no** partition (the normal case), you get both C and A — CAP only forces the choice during failure.

## PACELC — the part CAP leaves out

CAP only talks about the partitioned case. **PACELC** completes it:

> **If Partitioned, choose Availability or Consistency; Else (normal operation), choose Latency or Consistency.**

This matters because even with no partition, **synchronous replication for strong consistency costs latency** (you wait for replicas to acknowledge). So a system is described as e.g. **PA/EL** (Cassandra — available + low-latency, eventually consistent) or **PC/EC** (a strongly-consistent store — consistent in both modes, at a latency cost). PACELC is the more useful lens in practice because the "else" case is where your system spends 99.9% of its time.

## The consistency spectrum

"Consistency" is not binary. From strongest (most expensive) to weakest (cheapest, most available):

| Model | Guarantee | Cost / use |
|---|---|---|
| **Linearizable (strong)** | Reads always see the latest committed write; system behaves like one copy | Needs consensus/quorum; highest latency. Locks, leader election, balances. |
| **Sequential** | All nodes see operations in the *same* order (not necessarily real-time latest) | Slightly cheaper than linearizable. |
| **Causal** | Operations that are causally related are seen in order by everyone; unrelated ops can differ | Good middle ground — comments after a post, replies after a message. |
| **Eventual** | If writes stop, all replicas *eventually* converge; meanwhile reads may be stale or out of order | Cheapest, most available. Feeds, view counts, DNS, caches. |

### Client-centric guarantees (often what you actually need)

Eventual consistency is too weak to *feel* right on its own. These session guarantees patch the worst surprises:

- **Read-your-own-writes** — after *you* write, *you* see it (even if others don't yet). Critical UX: you post a comment and it appears for you. Often implemented by routing your reads to the primary or pinning your session to an up-to-date replica.
- **Monotonic reads** — you never see time go backwards (a value you saw won't "disappear" on a later read hitting a laggy replica).
- **Monotonic writes** — your writes apply in the order you issued them.

In interviews, "eventually consistent **with read-your-writes**" is frequently the right, nuanced answer — full linearizability is overkill for most read paths.

## How systems achieve strong consistency

Strong consistency across replicas requires agreement — a **quorum** or **consensus** protocol:

- **Quorum reads/writes:** with N replicas, if `W + R > N`, a read quorum overlaps a write quorum, so reads see the latest write. Tunable: `W=N,R=1` (fast reads, slow/fragile writes) vs `W=1,R=N` (opposite) vs `W=R=⌈(N+1)/2⌉` (balanced). Cassandra exposes exactly this knob ([nosql-cassandra](../Databases/nosql-cassandra.md)).
- **Consensus** (Raft/Paxos) for a single agreed value/log — leader election, config, locks. See [consensus-raft-paxos](consensus-raft-paxos.md).

Availability + convergence (AP) is achieved with async [replication](../Distribution/replication.md), conflict resolution (last-write-wins, version vectors, CRDTs), and read-repair/anti-entropy.

## Applying it — the move interviewers want

Decide **per data path**, not per system:

- **Payments / inventory / seat booking** → CP / strong. A double-spend or double-booking is unacceptable; rejecting a request under partition is fine. ([payment-system](../../HLD/payment-system.md), [ticketmaster](../../HLD/ticketmaster.md))
- **Social feed / likes / view counts / presence** → AP / eventual. Staleness for a second is invisible; downtime is not. ([twitter-news-feed](../../HLD/twitter-news-feed.md))
- **User-facing reads of their own data** → eventual + **read-your-writes** (route to primary or sticky replica).
- **Leaderboard** → usually eventual is fine; exact ranking can lag slightly. ([gaming-leaderboard](../../HLD/gaming-leaderboard.md))

## Common interview follow-ups

- *"Is this system CP or AP?"* → answer per-path, and say what happens *during a partition* specifically.
- *"You said eventually consistent — what does the user actually experience?"* → name the anomaly (stale read, read-your-writes violation) and the mitigation.
- *"Why not just make everything strongly consistent?"* → latency (PACELC's E) and reduced availability; most paths don't need it.
- *"How do replicas agree?"* → quorum (`W+R>N`) or consensus; explain the overlap argument.
- *"What's the difference between ACID consistency and CAP consistency?"* → ACID-C = your constraints hold within a transaction; CAP-C = replicas agree on latest value. Different concepts. ([sql-relational](../Databases/sql-relational.md))

## Gotchas

- **"Pick 2 of 3" / "we chose CA."** Partitions aren't optional in a distributed system — the choice is CP vs AP under partition.
- **Treating consistency as binary.** Name the model (linearizable / causal / eventual / read-your-writes), don't just say "consistent."
- **Conflating CAP-C with ACID-C.** Common trap; keep them separate.
- **Forgetting PACELC.** Strong consistency costs latency even when nothing is broken — that's the cost you pay 99.9% of the time.
- **Claiming strong consistency "for free"** while using async replication — async replication is eventual by definition.
- **One global consistency choice for the whole system.** Real designs mix: strong for money, eventual for feeds.

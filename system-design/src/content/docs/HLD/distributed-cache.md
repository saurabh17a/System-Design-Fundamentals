# Distributed Cache (Redis-like) — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[caching]` `[consistent-hashing]` `[replication]` `[low-latency]`
> **Companies that ask this:** Meta, Google, Amazon, Twitter, Uber, every Big Tech infra round

---

## Beginner's Guide

### What's this in plain English?

A cache is a small fast store sitting between your app and your slow database. Redis is the most famous example. The HLD problem: **how do you build it so it spans many servers, doesn't lose data when one machine dies, and stays super fast (under 1ms)?**

### Why solve it?

- **Real world**: Redis, Memcached, Hazelcast, AWS ElastiCache.
- **Teaches**: consistent hashing, replication, fault tolerance, low-latency design.
- **Interview**: bedrock infra question.

### Vocabulary

- **Cache** — fast in-memory KV store.
- **Shard / Partition** — split keys across many nodes.
- **Consistent hashing** — algorithm to map keys → nodes that **doesn't shuffle everything** when nodes are added/removed.
- **Replica** — secondary copy for fault tolerance and read scaling.
- **TTL** — time-to-live; entry expires after.
- **Eviction** — drop entries when full (LRU/LFU).
- **Hot key** — one super-popular key swamping its node.

### High-level architecture

```
Client → Smart Client (knows ring) → [Node A] [Node B] [Node C] ...
                                          replicated to followers
```

Components:
1. **Sharding** — keys distributed across N nodes via consistent hashing. Adding a new node only re-routes a small slice, not everything.
2. **Replication** — each shard has one primary + 1-2 replicas. Failover when primary dies.
3. **Client** — knows the ring; computes which node holds a key; fast direct connection.
4. **Eviction** — each node runs LRU when memory fills.

### How to read this doc

- **Beginner**: section on consistent hashing is critical.
- **Interview**: cross-questions on replication, hot keys, write paths.

---

## 0. How to use this doc in an interview

Distributed cache is the **canonical infra-design** question. Tests:
1. **Consistent hashing** — explain virtual nodes, ring, why mod is wrong.
2. **Replication strategy** — primary-replica vs gossip-based; failure handling.
3. **Eviction policy** — LRU vs LFU vs TinyLFU; per-shard or global.
4. **Hot keys** — viral key blowing one shard.
5. **Consistency vs availability** — CAP trade choice and why.

Trap: skipping consistent hashing details. The interviewer always drills here.

---

## 1. Problem Statement

A distributed in-memory key-value store, used as a cache layer in front of a slower system of record (DB). Operations:
- `GET key` → value (or miss).
- `SET key value [TTL]` → ack.
- `DEL key`.
- Atomic compound ops (`INCR`, `LPUSH`, etc.).
- Pub/sub (optional).

Targets sub-millisecond P99 latency, millions of QPS, persistence optional.

---

## 2. Clarifying Questions

### Scope
- [ ] Pure cache (lossy on failure) or persistence required?
- [ ] Single data center or multi-region?
- [ ] Strict consistency or eventual?
- [ ] Multi-tenant (one cluster many users) or dedicated?
- [ ] Data structures: just KV, or rich types (lists, hashes, sorted sets)?
- [ ] Pub/sub in scope?

### Scale
- [ ] Read QPS, write QPS targets?
- [ ] Total dataset size?
- [ ] Average value size?
- [ ] Hot-key concentration (e.g. one key 1% of QPS)?

### Non-functional
- [ ] Latency target — sub-ms?
- [ ] Availability — does the cache need to be up if DB is down (fail-open) or down (fail-closed)?

> **For this doc:** in-memory KV with optional persistence (AOF), single region active, eventual consistency on replicas, multi-tenant via namespaces, rich types, no pub/sub (designed-for), 10M reads / 1M writes peak QPS, 100 GB working set, sub-ms P99.

---

## 3. Functional Requirements

**P0:**
1. KV with optional TTL.
2. Sharded across N nodes; client routes to right shard.
3. Replication for HA; primary failover.
4. LRU eviction under memory pressure.
5. Atomic compound ops on a single key.
6. Stats: hit rate, memory usage, evictions per shard.

**P1:**
7. Multi-key transactions on same shard.
8. Persistence (AOF append-only file).
9. Pipelining (batch many ops in one round trip).

**P2:**
10. Cross-region replication.
11. Cluster resize without downtime.
12. Pub/sub.

---

## 4. Non-Functional Requirements

| Dim | Target | Why |
|---|---|---|
| Availability | 99.99% | Cache outage cascades to DB; the DB can't survive 10× load |
| Latency P99 | < 1 ms intra-DC | Caller's SLA depends on this |
| Throughput | 10M+ reads, 1M+ writes per cluster | Sized for a top-tier service |
| Consistency | Eventual on replica | Strong is too expensive on the hot path |
| Durability | None for pure cache; AOF every-second for persistence | Cache is rebuildable |

---

## 5. Capacity Estimation

```
Total working set     = 100 GB
Per node memory       = 32 GB usable (after overhead)
Number of shards      = ceil(100 / 32) × replication 2 = 7 primaries × 2 = 14 nodes minimum
With headroom         = 20 nodes (10 primary, 10 replica)
Read QPS / shard      = 10M / 10 = 1M QPS / shard (Redis can do this for simple ops)
Write QPS / shard     = 100k QPS / shard (with replication factor 2: 200k effective writes)
Network               = 10M reads × 100 bytes avg = 1 GB/s (10 Gbps NIC suffices)
```

---

## 6. API

```
Client SDK:
  cluster.Get("user:42")             -> bytes, err
  cluster.Set("user:42", data, ttl)
  cluster.Del("user:42")
  cluster.Incr("counter:visits")
  cluster.HGet("session:abc", "ip")
  cluster.MGet("k1", "k2", "k3")     -> may fan out to multiple shards
```

Wire protocol: simple binary or RESP (Redis protocol). Reuse existing tooling.

---

## 7. Data Model

### Per-node
- In-memory hash table (`map<string, value>`).
- LRU linked list.
- TTL heap or expiry list.
- AOF buffer (if persistence enabled).

### Cluster
- **Consistent-hashing ring** with virtual nodes.
- Each physical node owns 256 vnodes on the ring.
- Key → hash → ring position → owning vnode → owning physical node.

---

## 8. Architecture

```
                ┌─────────────────────┐
                │     Clients         │
                │  (with SDK)         │
                └──────────┬──────────┘
                           │ direct TCP to right shard
                           │ (SDK knows cluster topology)
                           ▼
              ┌──────────────────────────────┐
              │     Cluster topology svc     │
              │  - consistent-hash ring       │
              │  - membership / heartbeats    │
              │  - failover decisions         │
              └──────────────────────────────┘
                           │
              ─────────────┼─────────────
              │            │            │
              ▼            ▼            ▼
        ┌────────┐    ┌────────┐    ┌────────┐
        │Shard 1 │    │Shard 2 │  …  │Shard N │
        │primary │    │primary │    │primary │
        │  + replica│ │  + replica│ │  + replica│
        └────────┘    └────────┘    └────────┘
              │            │            │
              ▼            ▼            ▼
        ┌────────────────────────────────┐
        │     AOF persistence (per shard)│
        └────────────────────────────────┘
```

### Read path (cached value)
```
1. Client SDK hashes key → ring → shard ID.
2. SDK has shard's primary IP cached (refreshed every N seconds from topology svc).
3. TCP send GET → primary responds in <1 ms.
4. Client returns to caller.
```

### Write path
```
1. SDK → primary.
2. Primary writes to memory + AOF buffer.
3. Primary returns ACK.
4. Async: primary forwards to replica.
5. Async: AOF flushed to disk every 1s.
```

---

## 9. Component Deep-Dives

### 9.1 Consistent hashing
- Ring of `2^32` positions.
- Each physical node has 256 virtual nodes hashed onto ring.
- Key → hash(key) → walk ring clockwise → first vnode owns it.
- Adding/removing a node moves only `K/N` keys (where K = total keys, N = nodes), not all keys.
- Compare to mod hashing: `hash(key) % N` — adding one node remaps almost every key.

### 9.2 Replication (primary-replica)
- Each shard: 1 primary + N replicas.
- Async streaming: primary appends each write to a log; replica tails.
- Failover: topology svc detects primary failure (heartbeat timeout); promotes replica.
- Trade-off: async = higher throughput; window of data loss ≤ replication lag (ms).

### 9.3 Eviction
- Per-shard memory cap.
- LRU: maintain doubly-linked list ordered by access; evict tail.
- Sampled LRU (Redis): pick K random keys; evict the LRU among them. Saves bookkeeping.
- TinyLFU: better hit rates; significant code complexity.

### 9.4 TTL expiration
- Lazy: check TTL on GET; delete if expired.
- Active: background sweeper samples keys with TTL; deletes expired.
- Combination: lazy is fast path; active prevents memory bloat from keys never read again.

### 9.5 Hot-key handling
- One viral key → one shard's CPU pegged.
- Detect at SDK: track per-key QPS; flag hotspots.
- Mitigations:
  - Client-side L1 cache (small in-process LRU). Most hot keys cached in client → skip server.
  - Replicate hot keys: write to all replicas; clients pick random.
  - Sharded counters: split a hot counter into N sub-counters; aggregate at read time.

---

## 10. Hard Sub-Problems

### 10.1 Cluster resize without downtime

Adding a node:
1. Topology svc adds new vnodes for the new node.
2. New owners compute "what keys do I now own that were on the old owner?"
3. Background migration: pull keys from old owner.
4. During migration: reads served by old owner (still has keys); new writes go to new owner.
5. After migration complete: new owner is sole owner.

Removing a node: reverse.

### 10.2 Failover safety
- Async replication has a data loss window.
- For critical data: make replication semi-sync (wait for at least one replica to ack before responding to client). Adds ~1ms latency.
- For pure cache: data loss is acceptable; clients refetch from DB on miss.

### 10.3 Multi-key operations across shards
- Single-key atomic ops are easy.
- Multi-key (e.g. transaction) across shards = distributed transaction = expensive.
- Workaround: hash tag in key (`user:{42}:profile` and `user:{42}:settings` → same shard). Application-level key design.
- Don't support cross-shard transactions; document it.

---

## 11. Bottlenecks

| Load | Breaks | Fix |
|---|---|---|
| 10× | One shard gets hot key | L1 client cache, hot-key replication |
| 100× | Topology svc overload (membership flapping) | Gossip protocol; eventual consistency on topology |
| 1000× | Cross-region latency | Per-region clusters; eventual consistency cross-region |

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| Async replication | Sub-ms write latency | Data loss window on failover |
| Eventual consistency replicas | Higher read throughput | Stale reads possible |
| Consistent hashing | Smooth resize | Slight imbalance vs perfect partitioning |
| Single-shard transactions only | Simplicity, performance | Cross-shard atomicity must be solved by app |
| LRU per shard | Simple | No global view of "hottest keys" |

---

## 13. Cross-Questions ≥ 15

### 13.1 Why consistent hashing and not modulo?
- Modulo: adding one node remaps ≥ N-1/N of keys. Catastrophic on resize.
- Consistent hashing: adding one node remaps 1/N of keys.
- Trade: slight imbalance (fixed via vnodes).

### 13.2 Why virtual nodes?
- Pure consistent hashing: a node failure dumps all its load on the next clockwise node.
- Vnodes: 256 vnodes per physical → load redistributes across many neighbors.
- Bonus: heterogeneous nodes (high-spec node gets 512 vnodes; low-spec gets 128).

### 13.3 Why async replication vs sync?
- Sync: every write waits for replica ack → 2× latency.
- Async: primary acks immediately; replica catches up.
- For a cache, the marginal data loss on failover is acceptable; the latency win is huge.

### 13.4 Why per-shard memory limit and not global?
- Per-shard: simple; each node enforces its own cap.
- Global: requires cross-shard coordination on every write. Untenable.
- Trade: hot shard hits limit while cold shard is empty. Mitigated by good key distribution.

### 13.5 Why LRU and not LFU?
- LRU is cheaper (one DLL move per access).
- LFU needs frequency tracking (hash → count) + decay.
- For most caches, recency is a strong proxy for utility.
- TinyLFU is strictly better but ~3× more code.

### 13.6 Why client SDK does the routing instead of a proxy?
- Direct TCP from client to shard = sub-ms latency.
- Proxy adds a network hop = 2× latency.
- SDK fetches topology occasionally; cached locally.
- Cost: every language needs an SDK.

### 13.7 Why no pub/sub in core?
- Pub/sub is fan-out: one publish to N subscribers. Hard to scale on shard owners.
- Real Redis has pub/sub; for high-fan-out, use Kafka instead.
- Out of scope for the "cache" question.

### 13.8 What's the failure mode if topology svc is down?
- SDK uses cached topology; new clients can't bootstrap.
- Routing continues; failover detection halts.
- Not catastrophic short-term; topology svc is HA itself (Raft cluster).

### 13.9 What if a shard's AOF disk is full?
- Writes fail (or queue + dropped on overflow).
- Operator alert; provision more disk.
- For pure cache (no AOF): not relevant.

### 13.10 How would you handle very large values (1 GB)?
- Don't. Caches are for small frequent values.
- Reject at SDK with config-driven max value size (default 1 MB).
- Caller stores big blobs in S3; cache stores their metadata.

### 13.11 How is dataset partitioning decided?
- By key hash → uniform distribution.
- Hot-key risk: one popular key is one shard's load.
- Application can use hash tags for co-location: `user:{id}:*` keys all hash on `id`.

### 13.12 What about strict consistency?
- Quorum reads/writes (Raft): every op contacts quorum.
- Latency: 2-3× single-node.
- Used for control-plane state (topology); not data.

### 13.13 How do you debug a hot shard?
- Per-key sampling on slow path; emit `top-N keys by QPS` periodically.
- Surface in dashboard.
- Add L1 client cache or hot-key replication.

### 13.14 How does failover work exactly?
- Topology svc heartbeats every 5s.
- 3 missed → mark primary suspect.
- After grace period → promote replica.
- Quorum decision among topology svc nodes (Raft).

### 13.15 Cross-region setup?
- Independent cluster per region.
- Async cross-region replication for DR.
- Apps must understand: cross-region reads see stale data; writes go to local primary.

### 13.16 What about multi-tenancy?
- Namespace prefix on keys (`tenant_id:key`).
- Per-tenant rate limiting at SDK or proxy.
- Per-tenant eviction policy via tagged keys.

### 13.17 What's the difference between Redis Cluster and Memcached?
- Memcached: no replication, no persistence, simpler.
- Redis Cluster: rich data structures, replication, persistence, scripting (Lua).
- Choose based on need: KV-only → Memcached; structured → Redis.

### 13.18 Why is the topology service centralized (not per-shard)?
- Membership decisions need consensus.
- Per-shard would need cross-shard coordination on every membership change.
- Centralized → use Raft for HA; small fleet (3-5 nodes).

---

## 14. Common Follow-Ups

### 14.1 Add cross-region replication
Per-region clusters; async replication via Kafka or built-in cross-region streaming. Apps must accept eventual consistency.

### 14.2 Add pub/sub
Out-of-band: Kafka or NATS. Cache stores key state; pub/sub channel notifies of changes.

### 14.3 Cluster resize without downtime
Online migration: new node joins, claims vnodes, pulls keys in background, swaps live.

---

## 15. Cheat-Sheet Recap

1. **Consistent hashing with vnodes** for partitioning.
2. **Async primary→replica** for HA + write speed.
3. **Sub-ms P99** via client direct connection.
4. **LRU eviction per shard** with sampled approximation.
5. **Hot keys** mitigated by L1 client cache + replication.
6. **No cross-shard transactions** (use hash tags for co-location).
7. **Topology svc is Raft-based** for membership.

---

## Appendix A: Numbers

```
Single Redis node throughput: ~100k ops/s (simple), ~1M with pipelining
Memory per node: 32 GB usable (with 50% headroom for fragmentation)
Vnodes per physical node: 256
Replication factor: 2-3 typical
Failover detection: 5-15 s
LRU access overhead: ~50 ns per op
```

## Appendix B: Comparison

```
                    Redis Cluster     Memcached         Hazelcast
Data structures     rich              KV only           rich
Replication         primary-replica   none              partition replicas
Persistence         AOF, RDB          none              optional
Consistency         eventual          —                 eventual
Pub/sub             yes               no                yes
Throughput          ~100k/s/node      ~200k/s/node      ~50k/s/node
```

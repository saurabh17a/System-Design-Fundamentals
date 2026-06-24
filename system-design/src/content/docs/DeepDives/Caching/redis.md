# Redis — Deep Dive

> **Type:** Core technology
> **Tags:** `[cache]` `[in-memory]` `[data-structures]` `[single-threaded]`
> **Where it shows up:** [distributed-cache](../../HLD/distributed-cache.md), [gaming-leaderboard](../../HLD/gaming-leaderboard.md), [rate-limiter](../../HLD/rate-limiter.md), [search-autocomplete](../../HLD/search-autocomplete.md), [notification-system](../../HLD/notification-system.md)

---

## Mental model

Redis is a **single-threaded, in-memory data-structure server**. The two words that matter most are *data-structure* and *in-memory*.

It is not "a key-value cache that happens to be fast." It is a server that holds your data structures — strings, hashes, sorted sets, streams — **in RAM**, and exposes atomic operations on them over the network. The speed (sub-millisecond, ~100k+ ops/sec per core) is a consequence of data living in memory and commands running one-at-a-time with no lock contention.

In an interview, reach for Redis when you need **shared, low-latency, structured state** that's too hot for a database: a cache, a counter, a leaderboard, a rate-limiter bucket, a session store, a dedup set, a queue.

## Internals

### Single-threaded command execution

A single thread executes commands from a queue, one at a time, to completion. This is the most important fact about Redis and it explains almost everything:

- **Every command is atomic** by definition — there's no interleaving, so no locks are needed for a single command. `INCR`, `LPUSH`, `ZADD` are race-free without any coordination from you.
- **There are no data races**, but there *is* head-of-line blocking. One slow command (`KEYS *` on millions of keys, a big `ZRANGE`, a Lua script with a loop) stalls *everyone*. This is the #1 production footgun.
- Modern Redis (6+) uses extra threads for *I/O* (reading/writing sockets) and background tasks, but **command logic is still serialized**. Don't let "Redis is multi-threaded now" confuse the model.

### Core data structures (and what each is *for*)

| Structure | Backing | Reach for it when… | Key commands |
|---|---|---|---|
| **String** | bytes / int | counters, cached blobs, flags | `SET GET INCR SETEX` |
| **Hash** | hashtable / ziplist | an object with fields (user profile) | `HSET HGET HGETALL` |
| **List** | quicklist | queue / stack / recent-items | `LPUSH RPOP LRANGE` |
| **Set** | hashtable / intset | uniqueness, dedup, tags | `SADD SISMEMBER SINTER` |
| **Sorted Set (ZSet)** | skiplist + hash | leaderboards, rate limiters, priority/time ordering | `ZADD ZRANGE ZRANGEBYSCORE` |
| **Stream** | radix tree | append-only log, consumer groups | `XADD XREADGROUP XACK` |
| **HyperLogLog** | string | approximate unique counts, tiny memory | `PFADD PFCOUNT` |
| **Bitmap / Bitfield** | string | per-user flags at scale (DAU) | `SETBIT BITCOUNT` |
| **Geo** | zset | radius queries | `GEOADD GEOSEARCH` |

The **sorted set** is the interview workhorse — it gives you O(log n) inserts and O(log n + k) range reads with arbitrary scores. A leaderboard is a one-liner; a sliding-window rate limiter is a ZSet of timestamps.

```bash
# Leaderboard: top 3 players by score
ZADD board 1500 alice 1800 bob 1200 carol
ZREVRANGE board 0 2 WITHSCORES      # bob 1800, alice 1500, carol 1200
ZREVRANK board alice                # alice's 0-based rank → 1
```

### Persistence: RDB vs AOF

Redis is in-memory, but it can survive restarts via two mechanisms — know the tradeoff cold:

- **RDB (snapshot):** fork the process and dump a point-in-time binary of the whole dataset to disk every N seconds / M writes. Compact, fast restart, great for backups. **You lose everything since the last snapshot on a crash.**
- **AOF (append-only file):** log every write command to a file; replay on restart. Configurable `fsync` policy: `always` (durable, slow), `everysec` (default — lose ≤1s), `no` (OS decides). Larger files, slower restart, but **near-zero data loss**.
- **Both together** is the common production choice: AOF for durability, RDB for fast restarts/backups.

The interview point: **Redis is not a database of record by default.** If losing the last second of writes is unacceptable and you can't reconstruct from a source of truth, Redis alone is the wrong call (or you need AOF `always` + replication and accept the cost).

### Replication & high availability

- **Async leader-replica:** one primary takes writes, replicas get a copy. Replication is **asynchronous** → replicas can lag, and a primary can ack a write then die before it propagates → **silent write loss**. There is no synchronous-by-default mode.
- **Sentinel:** monitors primaries, does automatic failover (promotes a replica) and tells clients the new primary. HA without sharding.
- **Redis Cluster:** shards data across nodes by hashing the key into one of **16384 hash slots**; each slot lives on one primary (+replicas). Gives horizontal scale *and* HA. Caveat: **multi-key ops must touch keys in the same slot** — use `{hashtags}` to co-locate (`user:{42}:profile`, `user:{42}:sessions` hash to the same slot).

### Eviction & expiry

Redis is bounded by RAM. Set `maxmemory` and an eviction policy for what happens when full:

- `noeviction` — reject writes (safe for a database-of-record use; dangerous for a cache that's supposed to absorb load).
- `allkeys-lru` / `allkeys-lfu` — evict least-recently / least-frequently used across all keys. **The right default for a pure cache.**
- `volatile-lru` / `volatile-ttl` — only evict keys that have a TTL set.

Expiry is **lazy + sampled**: a key past its TTL is removed when accessed, and a background job samples and expires a fraction periodically. So an expired key can briefly still occupy memory — relevant when reasoning about memory headroom.

## Tradeoffs & decisions

- **Memory is the budget.** Everything lives in RAM, so dataset size is your cost and your ceiling. Estimate `keys × (key + value + overhead)`; Redis per-key overhead is real (tens of bytes). Bitmaps/HLL exist precisely to shrink huge-cardinality problems.
- **Durability vs latency vs throughput** — the AOF fsync knob. `everysec` is the sane middle.
- **Consistency vs availability** — async replication means failover can lose recent writes (AP-leaning). Don't promise linearizability across a failover.
- **One big instance vs Cluster** — a single instance is simpler and often enough (one core does a lot at in-memory speed). Move to Cluster when dataset > one node's RAM or write throughput saturates one core.

## When to use / when not

**Use Redis for:**
- Cache in front of a slower store (cache-aside) — see [caching-strategies](caching-strategies.md).
- Counters, rate limiting, leaderboards, sessions, dedup sets, ephemeral presence.
- A lightweight queue/stream (Streams) when you don't want Kafka's weight.
- Pub/sub fan-out for real-time features (with the caveat that classic pub/sub is fire-and-forget — use Streams for durability).

**Reach for something else when:**
- **Data doesn't fit in RAM** → it's a database problem; use a disk-based store and cache the hot subset.
- **You need a durable source of truth with strong consistency** → a real database. Redis can lose recent writes on failover.
- **You need a serious event log / replay / high-throughput streaming** → [Kafka](../Messaging/kafka.md), not Redis Streams.
- **Rich queries / secondary indexes / joins** → Redis is a data-structure server, not a query engine.

## Common interview follow-ups

- *"How do you keep the cache and DB consistent?"* → cache-aside with TTL; invalidate on write; accept a small staleness window. The hard cases (write-through, dual-write races) are in [caching-strategies](caching-strategies.md).
- *"A few keys get 90% of the traffic — what happens?"* → **hot keys** overload one shard/core. Mitigate with client-side/local caching of those keys, key replication/splitting (`key#1..key#N`), or a read-through replica fan-out.
- *"How would you build a sliding-window rate limiter?"* → ZSet keyed per user; `ZADD now`, `ZREMRANGEBYSCORE` to drop old timestamps, `ZCARD` to count, all in one Lua script for atomicity. (See [rate-limiter](../../HLD/rate-limiter.md).)
- *"Distributed lock?"* → `SET key token NX PX <ttl>` for a single instance; **Redlock** across instances — but call out that Redlock is contested and a real lock service ([ZooKeeper/etcd](../Coordination/zookeeper-etcd.md)) is safer when correctness matters. See [distributed-lock-service](../../HLD/distributed-lock-service.md).
- *"How do you scale writes?"* → Redis Cluster (hash slots). Explain co-location with hashtags for multi-key ops.

## Gotchas

- **`KEYS *` in production** scans the whole keyspace on the single thread and freezes the server. Use `SCAN` (cursor-based, incremental).
- **Big values / big collections** — a 50 MB value or a `ZRANGE 0 -1` on a million-element set blocks everyone. Keep values small; paginate range reads.
- **Unbounded growth** — forgetting TTLs turns a "cache" into an OOM. Every cache key should expire.
- **Fire-and-forget pub/sub** — a subscriber that's offline misses messages entirely. Use Streams + consumer groups for at-least-once delivery.
- **Async replication ⇒ failover can lose acked writes.** Never describe a Redis failover as lossless.
- **Lua scripts / `MULTI`-`EXEC`** are atomic but run on the one thread — a loop in a script is a global stall.

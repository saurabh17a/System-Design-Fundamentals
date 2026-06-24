# Caching Strategies — Deep Dive

> **Type:** Core concept
> **Tags:** `[cache]` `[consistency]` `[performance]` `[invalidation]`
> **Where it shows up:** [distributed-cache](../../HLD/distributed-cache.md), [news-aggregator](../../HLD/news-aggregator.md), [twitter-news-feed](../../HLD/twitter-news-feed.md), and the read path of nearly every HLD answer

---

## Mental model

A cache is a small, fast copy of data that's expensive to fetch from the source of truth. The entire discipline of caching is one tension: **a copy can be stale.** Every strategy is a different answer to two questions — *who populates the cache* and *who keeps it correct when the underlying data changes*. There's a famous half-joke that the two hard problems in computer science are cache invalidation and naming things; the invalidation half is what interviewers actually test.

In an HLD answer, caching is usually the first lever you pull for read-heavy load. The skill is naming the **read pattern**, the **write pattern**, the **eviction/TTL policy**, and the **staleness you're accepting** — not just "we'll add a cache." Redis is the usual implementation; see [Redis](redis.md).

## Read patterns

### Cache-aside (lazy loading) — the default

The application is in charge. On read: check cache → hit returns; **miss** → read DB, populate cache, return.

```
read(key):
  v = cache.get(key)
  if v is None:               # miss
      v = db.get(key)
      cache.set(key, v, ttl)  # populate for next time
  return v
```

- **Pros:** only requested data is cached (memory efficient); cache failure is survivable (you just hit the DB); simple.
- **Cons:** every miss is 3 hops (cache, DB, cache); first request per key is always slow ("cold" cache); risk of stale data until TTL/invalidation.

### Read-through

Same flow, but the **cache library/layer** fetches from the DB on a miss, not your app. The app only talks to the cache. Cleaner app code; the loading logic lives in the caching layer. Functionally close to cache-aside — the difference is *who owns the miss logic*.

## Write patterns

### Write-through

Write to **cache and DB synchronously** on every write. Cache is always fresh; reads after a write are consistent.

- **Pros:** no stale data; read-after-write is correct.
- **Cons:** every write pays cache + DB latency; caches data that may never be read (wasteful unless paired with cache-aside reads).

### Write-back (write-behind)

Write to **cache immediately, flush to DB asynchronously** (batched). Lowest write latency, absorbs write bursts.

- **Pros:** fast writes; batching reduces DB load.
- **Cons:** **data loss window** — if the cache dies before flushing, those writes are gone. Only acceptable when the data tolerates loss or the cache is durable/replicated.

### Write-around

Write straight to the DB and **don't** populate the cache; let reads fill it lazily (cache-aside on read). Good when written data is rarely read soon after (avoids polluting the cache with write-only data). Cost: a read right after a write is a guaranteed miss.

**The common production combo:** cache-aside reads + write-through (or write-around) + TTL as a safety net.

## Invalidation — keeping copies correct

When the underlying data changes, the cached copy must be fixed. Options, roughly in order of strength:

- **TTL (expiry):** every entry expires after N seconds; staleness is bounded by the TTL. Simplest, no coordination, **always have one as a backstop** even alongside explicit invalidation. The cost is staleness up to the TTL and a miss when it expires.
- **Explicit invalidation / delete-on-write:** on a DB write, delete (or update) the cache key. Fresher, but introduces races (below) and couples writers to the cache.
- **Write-through update:** the write path keeps the cache correct by construction.
- **Event-driven invalidation:** the DB emits a change event (CDC / [Kafka](../Messaging/kafka.md)) and a consumer invalidates affected keys. Decoupled and scalable for large fan-out, at the cost of a pipeline and eventual-consistency lag.

> **The classic race:** with "update DB, then delete cache," two concurrent requests can interleave so a *stale* value gets re-cached after the delete. The widely-used mitigation is **cache-aside + delete (not update) the key on write + a TTL backstop**, accepting a small staleness window. "Make the cache strongly consistent with the DB" is usually the wrong goal — bound the staleness instead. ([cap-and-consistency-models](../Coordination/cap-and-consistency-models.md))

## The failure modes interviewers probe

- **Thundering herd / cache stampede:** a popular key expires and thousands of concurrent requests all miss and hit the DB at once. Mitigate with: a **lock/single-flight** (one request recomputes, others wait), **stale-while-revalidate** (serve the old value while one request refreshes), or **jittered TTLs** so keys don't expire in lockstep.
- **Hot key:** one key gets a disproportionate share of traffic and overloads its shard/node. Mitigate with **local (in-process) caching** of that key, **key replication/splitting** (`key#1..key#N`), or a read-replica fan-out. ([Redis hot-key notes](redis.md))
- **Cache penetration:** requests for keys that **don't exist** always miss and hammer the DB (e.g. an attacker probing random ids). Mitigate by caching the **negative result** (with a short TTL) or a **[bloom filter](../../MachineCoding/Go/bloom-filter.md)** in front to reject definitely-absent keys.
- **Cold start:** an empty cache after deploy/restart sends all traffic to the DB. Mitigate by **warming** critical keys on startup.

## Where to cache (the layers)

Client / browser → **CDN** ([cdn](cdn.md)) → load balancer / reverse proxy → **application/distributed cache** (Redis/Memcached) → **DB internal cache** (buffer pool). Each layer trades a different staleness/scope. Caching at the edge (CDN) is cheapest per request but coarsest; the distributed cache is the workhorse for dynamic data.

## Tradeoffs & decisions

- **Freshness vs latency/cost** — shorter TTL = fresher but more misses; write-through = fresh but slower writes.
- **Memory vs hit rate** — cache more (higher hit rate, more RAM) vs cache only hot data (lazy/cache-aside).
- **Consistency vs availability** — explicit invalidation is fresher but couples systems and races; TTL is looser but robust.
- **Eviction policy** — LRU (default for general caches), LFU (better when popularity is stable), TTL-based (time-bounded data). See [Redis eviction](redis.md).

## When to use / when not

**Cache when:** reads ≫ writes; the same data is read repeatedly; the source is slow/expensive; some staleness is acceptable.

**Don't cache (or be careful) when:** data must be exactly current (balances mid-transaction — read from source); data is written far more than read; or the key space is so uniform there are no hot items (low hit rate = pure overhead).

## Common interview follow-ups

- *"How do you keep cache and DB consistent?"* → cache-aside + delete-on-write + TTL backstop; bound staleness, don't chase strong consistency.
- *"A hot key is melting one node — fix it."* → local cache + key splitting/replication.
- *"A popular key just expired and the DB is on fire — why and fix?"* → stampede; single-flight lock / stale-while-revalidate / jittered TTL.
- *"Requests for missing keys are hitting the DB."* → negative caching or a bloom filter.
- *"Write-through vs write-back?"* → freshness vs write latency + the write-back loss window.

## Gotchas

- **No TTL = a memory leak and unbounded staleness.** Always set one, even with explicit invalidation.
- **Updating (vs deleting) the cache on write** invites the stale-repopulation race; prefer delete + lazy refill.
- **Synchronized TTLs** cause mass simultaneous expiry → stampede. Add jitter.
- **Caching write-heavy data** wastes memory on entries that are overwritten before they're read.
- **Treating the cache as a database of record** — most caches can drop data on eviction/restart; the DB is the source of truth.
- **Ignoring the cold-cache failure mode** — "just add a cache" without warming/fallback can make a restart an outage.

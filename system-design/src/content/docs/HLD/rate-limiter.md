# Distributed Rate Limiter — High-Level Design

> **Difficulty:** Medium → Hard
> **Tags:** `[hld]` `[infrastructure]` `[algorithms]` `[distributed-state]` `[low-latency]`
> **Prep time:** ~10 min skim, ~30 min deep read
> **Companies that ask this:** Stripe, Cloudflare, AWS, Google, Uber, Atlassian, Shopify

---

## Beginner's Guide

### What's this in plain English?

You run an API. One client calls it 1000 times per second. Other clients can't get through. You need to **limit** each client to a fair share — say, 100 requests per second per API key. The system that enforces that is a **rate limiter**.

The HLD twist: do it across **many servers**, with shared state, fast (sub-millisecond), and don't make all your traffic go through one bottleneck.

### Why solve it?

- **Real world**: GitHub API limits, Stripe rate limits, AWS quotas, every public API.
- **Teaches**: the trade-offs between algorithms (token bucket vs sliding window), distributed state (Redis vs local), exact-vs-approximate counting.
- **Interview**: tests algorithm + distributed systems together.

### Vocabulary

- **Rate limit** — max ops per time window per key.
- **Token bucket** — bucket holds N tokens, refills at R/sec, each call costs 1.
- **Sliding window** — count requests in the past X seconds; drop oldest as time advances.
- **Fixed window** — count per minute boundary (problematic at boundaries).
- **Local** — limiter runs on each server with no shared state (fast, less accurate).
- **Centralized** — limiter checks a shared store (Redis) every request (accurate, more latency).

### High-level architecture

```
Client → API Gateway → Rate Limiter Middleware → Service
                              ↓ checks
                          Redis (counters)
```

The limiter:
1. Extracts a key (API key, user ID, IP).
2. Checks/decrements the bucket in Redis.
3. Allow or reject (HTTP 429).

Hot keys (one user with huge traffic) are still a problem — even Redis becomes a bottleneck. Mitigations: local counters with periodic sync; sharded keys; tiered limits.

### How to read this doc

- **Beginner**: focus on token bucket algorithm and Redis-based design.
- **Interview**: cross-questions on algorithm choice, hot key handling, accuracy vs speed.

---

## 0. How to use this doc in an interview

A rate limiter is the **algorithms-meet-distributed-systems** question. Interviewers grade two layers:

- **Layer 1: pick the right algorithm** — token bucket vs leaky bucket vs fixed window vs sliding window (log / counter). Get this wrong and everything downstream is wrong.
- **Layer 2: make it distributed correctly** — single-instance limiters are easy; coordinating limits across N gateways without melting Redis is the real interview.

Common traps:
- Picking fixed window without realizing the **boundary problem** (2× burst at the second tick).
- Picking sliding window log without realizing the **memory cost** (one entry per request — kills under high QPS).
- Using a single Redis instance as a hot-key for the whole world.
- Forgetting that rate limiting is on the **request path**: it adds latency to every API call. Sub-millisecond budget.

The cross-questions section is dense — drilldown on algorithm choice is the most common follow-up.

---

## 1. Problem Statement

Build a service that, given an incoming request and a key (user ID / API key / IP), decides:
- **Allow** — request proceeds.
- **Deny** — return 429 Too Many Requests with `Retry-After`.

The service must:
- Enforce **per-key limits** like "100 requests / minute" or "1000 / hour".
- Operate at internet scale (millions of keys, hundreds of thousands of QPS).
- Add minimal latency to the request path (~< 5 ms P99).
- Coordinate across N gateway instances so the limit is enforced **globally**, not per-instance.
- Tolerate Redis / coordinator failure without taking down the gateway.

Examples of who uses this:
- **Stripe / public APIs** — protect against abuse, ensure fair usage.
- **Login endpoints** — slow down credential stuffing.
- **CDN / edge** — protect origin from DDoS.
- **Internal services** — protect databases from runaway clients.

---

## 2. Clarifying Questions to Ask the Interviewer

### Scope
- [ ] Is the limiter a **library embedded in the gateway**, a **sidecar**, or a **standalone service** (own RPC)?
- [ ] Per-IP, per-user, per-API-key, per-endpoint, or all of the above?
- [ ] Do we support **multiple tiers** of limits (free / pro / enterprise)?
- [ ] Do we support **multiple windows** simultaneously (e.g. "100/sec AND 1000/min")?
- [ ] What's the **action on deny** — 429, drop, queue, degrade?

### Scale
- [ ] How many keys (cardinality of `key`)?
- [ ] Peak request QPS through the limiter?
- [ ] Geographic distribution? Single region or global?
- [ ] What's the **read:write ratio** of limit-checks vs limit-config-changes?

### Non-functional
- [ ] Latency budget added by the limiter? (P50, P99)
- [ ] What's worse: **letting too many requests through** (false-allow) or **denying legitimate ones** (false-deny)?
- [ ] **Soft fail** (allow on coordinator outage) or **hard fail** (deny on outage)?
- [ ] How fresh must the count be? Is "approximately 100/min" OK, or strictly?

### Domain
- [ ] What window granularity? (per-second, per-minute, per-hour, per-day?)
- [ ] Are bursts OK? (token bucket allows bursts; leaky bucket doesn't)
- [ ] Is there a **cost-per-request** dimension (e.g. "this endpoint costs 5 tokens, that one costs 1")?

> **For this doc** we'll assume: standalone service used as a library + Redis backend, per-(api-key, endpoint) limits, multiple tiers, multiple windows allowed, 429 on deny, ~1M keys active, 200k peak QPS through limiter, P99 < 5 ms added latency, **soft fail** (allow on Redis outage to preserve availability — risk of overspend is acceptable for this product).

---

## 3. Functional Requirements

**Must-have (P0):**
1. `Allow(key, action) -> (allowed bool, retry_after duration)` API.
2. Configurable limits per key + per action (endpoint).
3. Multiple algorithms supported (token bucket default; sliding window for strict counting).
4. Limit changes propagate without service restart.
5. Atomic check-and-decrement across all gateway instances.
6. Sub-5ms P99 added latency to the request path.

**Should-have (P1):**
7. Multiple concurrent limits per key ("100/sec AND 1000/min AND 10000/hour").
8. Cost-weighted requests ("this endpoint costs 10").
9. Per-tier defaults (free=100/min, pro=10000/min, enterprise=∞).
10. Quota dashboards: how much of their limit is each user using right now?
11. Graceful degradation if the backing store is unhealthy.

**Nice-to-have (P2 — out of scope):**
12. Adaptive / dynamic limits (auto-scale limits based on overall system health).
13. Distributed token issuance (true exact global counting via consensus).
14. Per-IP and behavioral abuse detection (separate concern — anomaly detection).

---

## 4. Non-Functional Requirements

| Dimension | Target | Justification |
|---|---|---|
| Availability | 99.99% | Limiter is on the critical path of every request — outage = entire gateway outage if hard-fail; acceptable degradation if soft-fail. |
| Latency added P50 | < 1 ms | Must be invisible to caller. |
| Latency added P99 | < 5 ms | Caller's own SLA budget is small. |
| Throughput | 200k QPS sustained, 500k peak | Sized for a mid-tier API gateway. |
| Consistency | Eventual within ~1s globally | Strict global counting is too expensive — see §13.4. |
| Accuracy | "Within 5% of stated limit" under normal ops | Some over/under is tolerable. |
| Configuration latency | < 30 s for a limit change to take effect | Operational responsiveness. |

---

## 5. Capacity Estimation

### Cardinality

```
Active keys (last 1 hour)         = 1M
Limits per key (multiple windows) = ~3
Total active "buckets"            = 3M
Bytes per bucket (counter + ts)   = ~40 bytes
Total memory                      = 3M × 40 ≈ 120 MB
```

Trivial — fits in a single Redis instance comfortably; cluster of N for HA + sharding.

### QPS

```
Peak request QPS               = 500k
Per request: ~1 limiter call (sometimes more if multi-window)
Limiter calls / sec            = ~1.5M (assuming 3 windows checked per request)
```

That's a lot. A single Redis instance does ~100k ops/sec; 1.5M / 100k = 15 shards minimum.

### Latency budget

```
Total budget:        5 ms  (P99 added)
- Local pre-check:   0.1 ms
- Redis round-trip:  1–3 ms (same DC)
- Lua eval:          0.1–0.5 ms
- Local post:        0.1 ms
- Headroom:          ~1 ms
```

**This is tight.** Cross-region Redis would blow the budget. Limiter must be **co-located** with Redis (same DC, ideally same AZ).

### Counter writes per second

```
Limiter calls / sec      = 1.5M
Each call writes:         increment counter, possibly add to a sorted set
Redis ops / sec           = ~3M (read + write per check)
Redis ops / shard         = 3M / 15 = 200k/sec — tight; use 30 shards for headroom
```

### What's the bottleneck?

**Redis throughput on hot keys.** A single hot key (e.g. one customer hammering one endpoint) cannot exceed one Redis shard's throughput (~100k ops/s per key with single-threaded Redis per slot). For ultra-hot keys we need **per-instance pre-aggregation** (see §10.3).

---

## 6. API Design

### Limiter call (between gateway and limiter)

If the limiter is **embedded as a library**:
```go
// pseudocode
allowed, retryAfter, err := limiter.Allow(ctx, key, action, cost)
```

If standalone with **gRPC**:
```protobuf
service RateLimiter {
  rpc Check(CheckRequest) returns (CheckResponse);
}
message CheckRequest {
  string key       = 1;   // e.g. "api_key:abc123"
  string action    = 2;   // e.g. "POST /v1/orders"
  uint32 cost      = 3;   // default 1; weighted endpoints set higher
  uint64 ts_ms     = 4;   // client-supplied for clock skew handling
}
message CheckResponse {
  bool   allowed       = 1;
  uint32 retry_after_ms = 2;
  uint64 remaining     = 3;  // tokens left in current window
  uint64 limit         = 4;  // configured limit
  uint64 reset_at_ms   = 5;  // next refill / window roll
}
```

### Why expose `remaining` and `limit` to the caller?

So the gateway can return RFC 6585 headers:
```
X-RateLimit-Limit:     1000
X-RateLimit-Remaining: 47
X-RateLimit-Reset:     1716200000
Retry-After:           23
```

Clients use these to back off proactively, reducing 429s.

### Why client-supplied `ts_ms`?

Clock skew across gateway instances breaks sliding-window correctness if the limiter relies on its own clock per call. By having the *gateway* timestamp at request entry, all subsequent checks for that request use a consistent time. Drift between gateway clocks is bounded by NTP (~few ms typical, < 100 ms worst case).

### Configuration API

```
PUT  /v1/limits/{tier}/{action}    body: { window: "1m", limit: 100, algorithm: "token_bucket" }
GET  /v1/limits/{tier}/{action}
DELETE /v1/limits/{tier}/{action}

# Per-key overrides
PUT  /v1/limits/keys/{key}/{action}   body: { window: "1m", limit: 500 }
```

Limit configuration is held in:
- Source of truth: Postgres or DynamoDB.
- Cached: in-memory on each limiter instance, refreshed every 30s + invalidated on change via pub/sub.

---

## 7. Algorithms — the Core of the Question

Five algorithms. Know all five cold. The choice of which to implement is the most consequential design decision.

### 7.1 Fixed Window Counter

**Idea:** Bucket time into fixed windows (e.g. 1 minute). Counter per (key, window). Increment on each request. Deny when counter > limit.

```
Window: [00:00 - 00:59]   counter = 50
Window: [01:00 - 01:59]   counter = 0   (reset at boundary)
```

**Pros:**
- Trivial implementation (1 atomic counter per key).
- O(1) memory per key.
- Most efficient algorithm.

**Cons — the boundary problem:**
- A user can make `limit` requests at 00:59.999 and another `limit` at 01:00.000 — that's **2× the limit** in a 2 ms span.
- Result: bursts double the configured rate at window edges.

**When to use:** when burst tolerance is fine and you want minimum overhead — e.g. coarse-grained per-day quotas where the boundary spike is irrelevant.

### 7.2 Sliding Window Log

**Idea:** Store every request's timestamp in a sorted set per key. On check, drop entries older than `now - window`, count remaining, allow if < limit.

```
key=user_42 → [t1, t2, t3, t4, t5, t6]    (sorted timestamps)
On request at t7:
  - drop entries < (t7 - 60s)
  - if len ≥ limit → deny
  - else add t7, allow
```

**Pros:**
- **Exact**: enforces `limit` requests in any sliding `window` interval. No boundary problem.
- Easy to reason about.

**Cons:**
- **Memory**: O(limit) per key. At limit=10000/min × 1M keys, that's 10B timestamps stored — billions of entries. Catastrophic.
- Each request requires a sort-set add + count + cleanup — multiple Redis ops.

**When to use:** small limits with very strict counting (e.g. login attempts: 5/hour — keep 5 timestamps and you're done).

### 7.3 Sliding Window Counter (Approximate)

**Idea:** Combine fixed window + weighted look-back. For each key, store the count for the current window AND the previous window. Approximate the sliding window count as:

```
sliding_count = current_window_count + previous_window_count × (1 - position_in_current_window)
```

```
At time 00:30 (50% into current minute):
  curr_count = 30   (requests in [00:00, 00:30])
  prev_count = 80   (requests in [-1:00, 00:00])
  sliding   = 30 + 80 × 0.5 = 70
```

**Pros:**
- O(1) memory per key (just two counters).
- O(1) compute.
- **Approximate but bounded**: error is ≤ position-weighted prev_count, typically within a few percent.
- No boundary problem (smoothly weighted).

**Cons:**
- Approximate, not exact.
- Slightly tricky to reason about edge cases (DST, key first-seen, etc.).

**When to use:** **the default for general-purpose API rate limiting.** Best memory/accuracy trade-off.

### 7.4 Token Bucket

**Idea:** Each key has a "bucket" that holds up to `capacity` tokens. Tokens are added at a steady rate (`refill_rate` per second) up to `capacity`. Each request consumes `cost` tokens. If insufficient tokens → deny.

```
capacity = 100
refill   = 10/s         (one token every 100 ms)
On request:
  tokens += (now - last_update) × refill_rate
  tokens = min(tokens, capacity)
  if tokens >= cost:
    tokens -= cost
    allow
  else:
    deny, retry_after = (cost - tokens) / refill_rate
```

**Pros:**
- **Burst tolerant**: a saved-up bucket can absorb a burst of `capacity` requests instantly.
- O(1) memory (counter + last_update_ts).
- Steady refill is intuitive ("you get 10/sec on average, can burst to 100").
- Easy to implement in Redis with a single Lua script (atomic).

**Cons:**
- The burst tolerance is itself a feature — but it can also feel "loose" if your goal is a smooth steady stream.

**When to use:** **the default for user-facing quotas** (Stripe, Twilio use this). Good UX (allows occasional bursts), good math, atomic in Redis.

### 7.5 Leaky Bucket

**Idea:** Imagine a bucket with a hole leaking at a fixed rate. Requests fill the bucket; if the bucket overflows, the request is dropped. Effectively enforces a smooth, max output rate.

```
capacity = 100        (queue size)
leak_rate = 10/s      (output rate)
On request:
  drain bucket: bucket = max(0, bucket - leak_rate × elapsed)
  if bucket + cost <= capacity:
    bucket += cost
    queue request for processing at output rate
  else:
    deny
```

**Pros:**
- **Output rate is exactly fixed.** Smooths bursty traffic into a steady stream — useful for protecting downstreams that hate spikes.
- Memory O(1).

**Cons:**
- Doesn't allow bursts — opposite of token bucket. Even if the bucket is empty, you can't "use saved-up" capacity.
- Queue semantics imply you actually queue requests — most rate limiters drop instead, which is functionally equivalent to token bucket without bursting.

**When to use:** when downstream **must** see a smooth flow regardless of input shape — e.g. shaping outbound webhook deliveries to a partner with a hard rate cap.

### 7.6 Comparison Table

| Algorithm | Memory/key | Compute | Burst-friendly | Exact | Boundary problem | Atomic in Redis |
|---|---|---|---|---|---|---|
| Fixed Window | O(1) | O(1) | ✓ (worst case 2×) | ✗ approximate | **Yes** — biggest problem | Trivial (`INCR`) |
| Sliding Log | O(limit) | O(log n) | depends | ✓ exact | No | Doable, expensive |
| Sliding Counter | O(1) | O(1) | weighted | ✗ approximate | No | Trivial (2 counters) |
| Token Bucket | O(1) | O(1) | ✓ (configurable) | ✓ within bucket | No | Lua script |
| Leaky Bucket | O(1) | O(1) | ✗ | ✓ shaped | No | Lua script |

### 7.7 Default choice for this design: **Token Bucket** for user-facing limits, **Sliding Window Counter** for short bursty windows (per-second / per-minute).

Reasoning:
- Token bucket gives the best UX (bursts allowed, refill predictable).
- Sliding window counter for sub-minute windows where bursts are usually abuse, not legitimate.
- Both are O(1) memory and atomic-implementable in Redis.

---

## 8. High-Level Architecture

```
                ┌──────────────────────────────────────────┐
                │           Clients / Internet             │
                └────────────────────┬─────────────────────┘
                                     │
                                     ▼
                ┌──────────────────────────────────────────┐
                │           API Gateway (N×)               │
                │  - terminate TLS                          │
                │  - auth                                   │
                │  - call limiter                           │
                │  - if allowed: forward to backend         │
                │  - if denied:  return 429 + headers       │
                │                                           │
                │  ┌─────────────────────────────────────┐  │
                │  │   Embedded Limiter Library          │  │
                │  │  - in-process L1 cache              │  │
                │  │  - Redis client pool                │  │
                │  │  - circuit breaker                  │  │
                │  └─────────────┬───────────────────────┘  │
                └────────────────┼─────────────────────────┘
                                 │
                                 ▼  (Redis protocol over TCP)
              ┌──────────────────────────────────────────────┐
              │          Redis Cluster (N shards)             │
              │  shard k = hash(key) % N                      │
              │  - Lua scripts for atomic check-and-update    │
              │  - 1+1 replication per shard                  │
              │  - Co-located with gateway in same AZ         │
              └──────────────────────────────────────────────┘
                                 ▲
                                 │ async config push (pub/sub)
                                 │
              ┌──────────────────┴──────────────────────────┐
              │      Limit Configuration Service             │
              │  - source of truth in Postgres               │
              │  - admin API for ops                         │
              │  - publishes diffs on change                 │
              │  - per-tier defaults + per-key overrides     │
              └──────────────────────────────────────────────┘
                                 │
                                 │ async metrics
                                 ▼
              ┌──────────────────────────────────────────────┐
              │   Observability                              │
              │  - per-key denial rate (Prometheus)          │
              │  - per-key remaining (gauge for dashboards)  │
              │  - hot-key detection (top-N)                 │
              └──────────────────────────────────────────────┘
```

### Hot-path walk-through (request arrives at gateway)

```
1. Gateway receives request.
2. Auth resolves the API key → tier (free / pro / enterprise).
3. Gateway calls limiter.Allow(api_key, route, cost=1):
   a. Limiter resolves limits for (tier, route) from in-memory config cache.
   b. For each window (e.g. "100/sec", "1000/min"):
      - Compute Redis shard = hash(api_key + window).
      - EVAL Lua script atomically:
          tokens     = max(0, stored_tokens + (now - last_ts) × refill_rate)
          tokens     = min(tokens, capacity)
          if tokens >= cost:
              tokens -= cost
              SET stored_tokens = tokens, last_ts = now
              return (allowed=1, remaining=tokens, retry_after=0)
          else:
              return (allowed=0, remaining=tokens, retry_after=(cost-tokens)/refill_rate)
   c. If any window denies: return (denied, max retry_after across windows).
   d. If all allow: return (allowed, min remaining).
4. Gateway:
   - if denied: return 429 with X-RateLimit-* + Retry-After.
   - if allowed: forward to backend, attach X-RateLimit-* in response.
```

Every step latency-counted: typical P50 ~0.5 ms, P99 < 5 ms (Redis RTT in same AZ).

---

## 9. Component Deep-Dives

### 9.1 Embedded Limiter Library

- **Why embed instead of standalone service?** Latency. A standalone service adds another hop (~0.5–2 ms RTT) on every request. At 500k QPS, that's a lot of RPC. Embedding pushes the call to a Redis-talking library.
- **Library responsibilities:**
  - In-memory limit-config cache (refreshed every 30s + on pub/sub).
  - Redis client pool (one persistent conn per shard).
  - Per-key local pre-check ("we already denied this key 100 ms ago, deny without round-trip").
  - Circuit breaker on Redis (fail-open or fail-closed per config).
- **Failure mode:** circuit breaker trips → fallback to **local-only** rate limiting (per-instance, no cross-instance coordination). Worst-case overshoot is N× limit during the outage (N = gateway instance count). Acceptable for soft-fail products.

### 9.2 Redis Cluster

- **Why Redis?** Sub-millisecond ops, atomic Lua, pub/sub for invalidation, cluster mode for horizontal scaling.
- **Topology:**
  - Cluster mode with sharding by hash slot. ~30 shards for headroom.
  - Each shard: 1 primary + 1 replica, multi-AZ.
  - Persistence: AOF every-second mode. We don't need every-write durability — losing the last second of counter state is fine (worst case: a few extra requests slip through).
- **Sharding key:** `hash(api_key + window_name)` — co-locates a single key's windows on the same shard but spreads keys across shards.
- **Lua scripts:** atomic check-and-update is the **only correct way** to do counter math in Redis. Without Lua, two clients can race: read counter → both think they have capacity → both decrement → over-allow.

### 9.3 Limit Configuration Service

- **Source of truth:** Postgres (low write QPS, transactional updates).
- **Distribution:** changes published to Redis pub/sub channel `limits:changed`.
- **Subscribers:** every limiter library instance.
- **Convergence:** on receipt, instance refreshes config from Postgres (via cache layer for QPS protection). Convergence < 1 second.
- **Default config baked into library:** if config service is unreachable on startup, library uses last-known config (cached on disk) or a conservative default (per-tier defaults). Never "no limits" — that's worse than denying.

### 9.4 Observability

- **Prometheus metrics per limiter call:**
  - `rate_limiter_allow_total{tier, route, decision}` — request rate.
  - `rate_limiter_redis_latency_seconds{shard}` — histogram, alarm on tail.
  - `rate_limiter_breaker_state{}` — gauge.
  - `rate_limiter_local_fallback_total` — counts when Redis was unavailable.
- **Top-N hot keys:** sample 1% of denied requests, dump to a "hot keys" Redis sorted set (decay over time). Dashboard surfaces "users currently being throttled" — useful for support ("why is my customer hitting the limit").

---

## 10. Deep-Dives on the Hardest Sub-Problems

### 10.1 Atomicity — Lua script for token bucket

Without atomic check-and-update, two requests race and both succeed when only one should. Redis Lua scripts run atomically (single-threaded execution). The canonical token-bucket script:

```lua
-- KEYS[1] = the bucket key
-- ARGV[1] = capacity, ARGV[2] = refill_rate (tokens/ms)
-- ARGV[3] = now_ms, ARGV[4] = cost

local capacity = tonumber(ARGV[1])
local rate     = tonumber(ARGV[2])
local now      = tonumber(ARGV[3])
local cost     = tonumber(ARGV[4])

local data = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts     = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  ts = now
end

-- refill
local elapsed = math.max(0, now - ts)
tokens = math.min(capacity, tokens + elapsed * rate)
ts = now

local allowed
local retry_after
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
  retry_after = 0
else
  allowed = 0
  retry_after = math.ceil((cost - tokens) / rate)
end

redis.call('HMSET', KEYS[1], 'tokens', tokens, 'ts', ts)
redis.call('PEXPIRE', KEYS[1], capacity / rate * 2)  -- TTL = 2× full-refill time

return { allowed, math.floor(tokens), retry_after }
```

Key points:
- Uses `HMSET` not `SET` — keeps tokens and timestamp in one hash (one allocation).
- TTL based on bucket dynamics — long-idle buckets are evicted, saving memory.
- All math in the script — no client-server round-trip for refill.

### 10.2 Distributed counting — when Redis itself is the bottleneck

Single hot key (one customer hammering one endpoint) cannot exceed ~100k ops/s on one Redis shard. If that's not enough:

#### Approach A: Pre-aggregation per limiter instance

Each gateway instance maintains a **local counter** for hot keys. Every N ms (e.g. 100 ms), it batch-flushes deltas to Redis.

```
Per instance:
  local_counter[key] += 1   on every request
  every 100 ms:
     send DELTA to Redis: HINCRBY key tokens -delta
     get back authoritative tokens; reset local
```

Allows ~1000× more local QPS per shard. **Trade-off**: limit enforcement is now 100 ms eventually consistent — instances can independently overshoot for up to one flush window.

For a 1000/sec limit and 10 instances flushing every 100ms, worst case overshoot is `10 instances × (1000/sec × 100ms) = 1000` requests in a 100ms span. That's 10× the per-second limit momentarily — bad.

Mitigation: **hierarchical limits**. Each instance holds a *local quota* of `total_limit / N_instances`. They check locally without Redis. Periodically rebalance: instances with idle quota release to Redis, hot instances pull more. Limit "leaks" slightly but never overshoots significantly.

#### Approach B: Probabilistic limiting

Sample requests; only ~1 in K hits Redis. K chosen so the expected error is acceptable. Reduces Redis QPS by K× at cost of accuracy.

#### Approach C: Sharded counter

Split the limit into N sub-counters (e.g. 8 sub-buckets per key). On request, hash to a sub-bucket, increment. Aggregate periodically. Distributes hot-key load N-way. Cost: `total_limit = sum(sub_limits)` is approximate.

#### Chosen approach: hybrid

- **Default:** direct Redis check (atomic Lua).
- **Hot-key escalation:** when a key's QPS > shard-throughput threshold, switch to **hierarchical local quota** automatically, controlled by a flag in the config service.
- Admin can preconfigure hierarchical mode for known whales.

### 10.3 Redis failure handling

#### Fail-open vs fail-closed

- **Fail-open:** if Redis can't be reached, allow the request. Risk: limits not enforced during incident → potential abuse / over-spend.
- **Fail-closed:** deny on Redis error. Risk: every customer 429s during a Redis incident. Effective availability drops to Redis's availability.

For most products, **fail-open** is correct — the limiter exists to protect against abuse, but the cost of denying legitimate users during an incident is higher than the cost of letting some abuse through. For highly abuse-prone surfaces (login, signup), **fail-closed**.

The library exposes this as config: `failure_mode = open | closed` per (tier, action).

#### Circuit breaker

Library tracks Redis health: failed calls, latency. If failure rate > 5% over 30s, open the circuit and fall back to local-only limiting for 60 seconds, then probe.

Pattern:
- Closed (healthy): every call goes to Redis.
- Open (unhealthy): calls bypass Redis, use local-only fallback.
- Half-open (probing): ~1% of calls go to Redis to test health; if N consecutive succeed, close circuit.

### 10.4 Clock skew

If two gateway instances disagree on time, refill calculations diverge. NTP keeps clocks within ~few ms typically. We never use `time.Now()` *in* Redis — only the client's timestamp passed in. This means all instances see the same wall clock for a given Lua call.

For very strict windows, we'd timestamp at the limiter library entry (single moment per request) and pass through. For rolling buckets, ~few ms skew is in the noise.

### 10.5 Thundering herd on cache miss

Pattern: gateway just started. None of its in-memory limit-config caches are populated. First wave of requests all hit the config DB simultaneously.

Solution: at library startup, preload all configs from Postgres before serving. ~100ms startup delay is fine. After first load, refresh in background.

For the limiter's Redis check, there's no thundering herd — every key is independent.

---

## 11. Bottlenecks & Scaling

| Load level | What breaks | Symptom | Fix |
|---|---|---|---|
| 1× (now) | — | Healthy | — |
| 10× | Single Redis shard for a hot key | Latency spike on one shard, P99 > 10ms | Add per-instance local pre-aggregation for top-N hot keys |
| 100× | Redis network bandwidth on cluster | Saturated 10 Gbps NIC | Add more shards (hash redistribution) or use unix-domain sockets if local |
| 1000× | Postgres limit config | Config lookups dominate | Add read replicas; cache TTL reduced changes propagation latency |
| Cross-region | Cross-region Redis blows latency budget | P99 > 50ms in remote regions | **Regional Redis clusters** with eventually-consistent global quotas (per-region quota carved from global) |

### Cross-region quota distribution

Global limits ("user X is allowed 1M/day across all regions") are hard. Two approaches:

- **Static carve-out**: divide global limit across regions by historical traffic (e.g. US gets 60%, EU 30%, AS 10%). Cheap, but fairness suffers if traffic shifts.
- **Coordinator with leases**: each region requests a "lease" of K requests from a global coordinator. Region uses the lease locally; renews when 80% used. Coordinator is on Aurora/Spanner with strong consistency. Adds ~100ms cross-region latency to lease renewal — but only every K requests, so amortized cost is low.

We pick **leases for global limits**, **per-region for everything else**.

---

## 12. Trade-offs Summary

| Decision | Gained | Gave up | Why right |
|---|---|---|---|
| Embedded library, not standalone service | One fewer hop, ~1ms latency saved | Library is in N processes — harder to upgrade | Latency budget is tight; library coupling is acceptable |
| Token bucket as default | Burst-friendly UX, atomic in Redis, O(1) | Approximate by ~capacity over instantaneous rate | UX wins; the approximation is tolerable |
| Sliding window counter for sub-minute | O(1) memory, no boundary problem | Approximate (~few percent error) | Still bounded; trade exact for memory |
| Soft-fail (fail-open) on Redis outage | Service stays up during incidents | Possible over-spend during outage | Outages are rare; over-spend is recoverable |
| Per-region Redis | Sub-ms latency budget | Global limits are eventually consistent | Cross-region sync is too expensive on hot path |
| Lua scripts | Atomic, no race conditions | Ties us to Redis (vs Memcached or in-house) | Atomicity is non-negotiable |

---

## 13. Cross-Questions ("Why X and not Y") — ≥ 15

### 13.1 Why token bucket and not fixed window?

Two reasons:

1. **Fixed window has the boundary problem.** A user can fire `limit` requests at the end of one window and `limit` more at the start of the next — instantaneous rate is 2× the configured limit. For burst-sensitive backends (e.g. databases), that's the difference between healthy and overloaded.

2. **Token bucket controls bursts deliberately.** Capacity = how big a burst is allowed; refill rate = sustained rate. Two parameters give explicit control. Fixed window has only one (`limit`), and the burst behavior is an emergent accident.

When fixed window is fine: **coarse quotas where burst doesn't matter** (e.g. "100k API calls per day" — at this granularity, the 24-hour boundary spike is irrelevant).

### 13.2 Why sliding window counter and not sliding window log?

Memory. Sliding window log stores every request timestamp:
- 10000 req/min limit × 1M active users × 8 bytes/timestamp = 80 GB of timestamps.
- That's per minute of retained history.

Sliding window counter stores 2 integers per (key, window): 16 bytes × 1M × 3 windows = 48 MB. Three orders of magnitude smaller.

When sliding window log is correct: **small fixed limits where you need exact counting** — e.g. login attempts (5/hour, store 5 timestamps per user). Memory cost is negligible at small limits.

### 13.3 Why Redis and not Memcached / etcd / Cassandra?

- **Memcached:** no Lua / no atomic compound operations. You'd need CAS loops, which fail under contention. Rejected.
- **etcd / ZooKeeper:** strong consistency via Raft is great for config, terrible for hot-path. ~10–50ms write latency, throughput cap of a few k/sec per cluster. Wrong tool.
- **Cassandra:** great for time-series writes, poor at low-latency single-key counter math. Lightweight transactions exist (Paxos-based) but cost ~100ms.
- **Redis:** sub-ms ops, single-threaded per slot (atomic), Lua, pub/sub, mature client libraries. Right tool.

Alternative considered: **DynamoDB with conditional writes**. Works at AWS scale but ~5–10ms latency per call, 5–10× cost per op. Defensible if you want a managed service and your latency budget is looser.

### 13.4 Why eventual consistency on global limits and not strict?

Strict global counting requires coordination on every request. Options:

- **Single global Redis:** sub-ms only if all gateway instances are co-located with it. Cross-region adds 80–150ms RTT — unacceptable.
- **Distributed consensus (Raft):** ~10ms write minimum, throughput cap.
- **Coordinator with leases:** sub-ms local, periodic global reconciliation.

Strict accuracy costs 10–100× the latency. For most products, "approximately the configured limit" is what users expect — **a 10% over/under is invisible to humans**. Only rarely does strict matter (financial, regulatory).

### 13.5 Why fail-open and not fail-closed?

For an API gateway protecting paid services:
- **Fail-open**: during a Redis incident, some users may briefly overspend. Recoverable: charge them later if needed; rare incident.
- **Fail-closed**: during a Redis incident, every legitimate user gets 429. Hard customer pain.

The probability-weighted cost of fail-closed (every-customer pain × incident duration) is much higher than fail-open (some over-spend × incident duration).

When fail-closed is correct: **abuse-critical surfaces** — login, signup, password reset. There, denying one legitimate retry is much better than letting an attacker finish a credential-stuffing wave. We configure these endpoints fail-closed by exception.

### 13.6 Why per-region Redis and not a single global cluster?

Latency budget is 5ms P99. Cross-region RTT alone is 80–150ms. A global Redis blows the budget by 20×.

Per-region clusters: every check stays local, ~1ms RTT. Trade-off: the limit is now per-region instead of truly global. Mitigated by:
- Carving global limits across regions in proportion to traffic.
- Lease-based reconciliation for premium customers who paid for global limits.

### 13.7 Why expose `Retry-After` to clients?

Clients without `Retry-After` retry blindly — exponential backoff helps but is conservative. With `Retry-After`, the client knows precisely when capacity becomes available. Reduces:
- Wasted retries (less load on us during throttled periods).
- Customer pain (faster recovery for them).
- 429 churn rate (we get fewer 429 attempts → fewer Redis ops).

Cost: revealing internal state. Acceptable; this is non-secret info.

### 13.8 Why Lua scripts and not WATCH/MULTI/EXEC transactions?

`WATCH/MULTI/EXEC` provides optimistic concurrency: if the watched key changes between WATCH and EXEC, the transaction aborts and the client retries. Under contention, retry rate spikes. For a hot key, throughput collapses.

Lua scripts are pessimistic: the script runs atomically on the server, no retry needed. Throughput is bounded only by the script's runtime, not by contention.

Cost: Lua scripts don't compose with transactions cleanly. For our use case (single-key atomic), Lua is the right primitive.

### 13.9 Why client-supplied timestamp instead of Redis time?

Three reasons:
1. **Determinism**: in a check-N-windows-for-one-request flow, all checks should use the same `now`.
2. **Skew bound**: NTP-synced gateway clocks drift ≤ few ms. Redis's internal clock has its own drift. Trusting one source (the gateway's clock) keeps math consistent.
3. **Testability**: passing `now` as a parameter lets us deterministically test refill/decay logic.

Risk: malicious client supplying a bogus timestamp. We don't expose the limiter directly to clients — it's gateway-internal. The gateway timestamps at request entry, before user input ever touches the limiter.

### 13.10 What if a user's traffic is bursty and we use leaky bucket — won't they be unhappy?

Yes — that's precisely why we use **token bucket** for user-facing limits. Leaky bucket is for shaping (downstream protection); token bucket is for quotas (user-facing).

If a downstream backend can only handle 100 RPS and you allow 1000 RPS through the limiter, the backend dies. Use leaky bucket on the *output* side (between limiter-allowed traffic and the backend), or just match the limiter's `refill_rate` to the backend's capacity.

### 13.11 How would you handle cost-weighted requests (some endpoints are 10×)?

The token bucket already supports this — `cost` is a parameter. For the API:

```
limiter.Allow(key, action, cost = endpoint_weight[action])
```

Endpoint weights live in the config service (operations defined a static cost per endpoint). Heavy endpoints (e.g. complex DB queries) take 10 tokens; cheap ones take 1.

This is how Stripe / GitHub / AWS communicate "complexity" to users.

### 13.12 Why TTL on Redis keys? Doesn't that break the algorithm?

Without TTL, idle buckets accumulate forever — every key ever seen stays in memory. With 1B unique keys ever, that's terabytes of stored state.

TTL = `2 × time-to-fully-refill`. After this duration of idleness, the bucket's state is effectively "full anyway" — losing it doesn't change correctness (key starts as "full bucket" by default).

Algorithm preservation: when the key is missing, we treat as `tokens = capacity`. That's only wrong if a previously-active key is reset to full mid-burst. The TTL ensures this only happens for inactive keys.

### 13.13 What if my system needs both tier-based AND custom-key limits?

Two layers:
- **Default per-tier**: free=100/min, pro=10000/min, enterprise=∞. Stored in config.
- **Per-key override**: any key can have a custom limit override. Stored as `(key, action) → limit` row in config.

Lookup order: check override → fall back to tier default. Caching: both layers cached in-memory; override cache is small (few thousand customers with custom plans).

Why bother with overrides? Sales deals. Enterprise customers negotiate custom limits; we honor them per key without code changes.

### 13.14 What's the difference between rate limiting and throttling?

Often used interchangeably; the precise distinction:

- **Rate limiting:** binary decision per request. Allow or deny.
- **Throttling:** smoothly slow down — delay, queue, or reduce QoS.

A token bucket *can* throttle (queue up to capacity, drain at refill_rate) or rate-limit (drop overflow). Pick based on caller behavior:
- Synchronous APIs (browser, CLI): rate limit (drop), let client retry.
- Asynchronous workers (background jobs): throttle (queue), to keep work moving.

We rate-limit at the API gateway. Throttling is a separate concern (job queues, leaky bucket for outbound flow control).

### 13.15 Why not use a sliding window log when limits are very small (e.g. 5/hour)?

You should — and we do. The library picks the algorithm based on `limit × window_count`:

```
if limit × active_keys < THRESHOLD:
    use sliding window log  (exact)
else:
    use sliding window counter or token bucket  (approximate, O(1))
```

For login (5/hour), `5 × 1M = 5M` timestamps stored. At 16 bytes each, that's 80 MB. Cheap. Use the exact algorithm. For "10000/min API limit × 1M users", `10B` entries — never. Use approximate.

### 13.16 What if I want to allow occasional bursts but enforce strict average?

That's literally token bucket: capacity = max burst allowed, refill_rate = strict average over time. Tune the two parameters independently.

If you want **no bursts and strict average**: leaky bucket with capacity = 1.

If you want **strict over a long window but burst-friendly short term**: hierarchical limits — token bucket short-term + sliding window counter long-term, both must allow.

### 13.17 How do you communicate limits to clients?

Three signals:
1. **HTTP headers** on every response: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
2. **429 response** with body explaining what was hit + `Retry-After`.
3. **Documentation**: published per-tier limits, per-endpoint costs, examples of how to back off.

Customer dashboards also show real-time usage so they can self-monitor.

### 13.18 What's the failure mode if the config service is down at startup?

Library uses (in order):
1. Last cached config on local disk (from previous successful refresh).
2. If no cache: hardcoded conservative defaults (per-tier).
3. Logs WARN, surfaces metric.

Never starts with "no limits". A misconfigured limiter is preferable to no limiter — abuse vulnerability is unbounded.

If config service comes back: pub/sub triggers refresh. Convergence within 30s.

---

## 14. Common Follow-Ups

### 14.1 Now do "1000 requests per minute, but max 10 per second"

Two simultaneous limits — both must allow. Limiter library checks both, returns AND. Implementation: separate Redis keys, two Lua eval calls (or one combined script). Adds ~1 RTT per extra window — within budget for 2-3 windows; consider local pre-check beyond that.

### 14.2 Now add per-IP limits to defend against signup abuse

Add a parallel limit check on `ip_address`. Auth happens after IP limit — so we limit even unauthenticated traffic. Trade-off: NAT'd offices look like one IP. Mitigation: combine `ip + user_agent_fingerprint` as the key; or whitelist enterprise IPs.

### 14.3 Now make limits adaptive (auto-scale based on overall system health)

Adaptive concurrency: monitor backend latency. If P99 latency rises, dynamically reduce limits across the board. Implements TCP-Vegas-style backpressure at the API layer.

Architecture: a controller service samples backend health, publishes a "global capacity multiplier" to Redis (`capacity_multiplier=0.7`). Limiter library multiplies all limits by this. Out-of-band of normal config flow.

This is what Netflix's "concurrency-limits" library does. Strong play if asked.

### 14.4 Now charge customers based on usage instead of denying

Usage-based pricing: count usage but never deny. Replace the limiter's "deny" action with "count" — increment a billable-usage counter that flows to billing.

Architecturally simpler (no atomic check; just async increment), but be careful: if you don't enforce a hard ceiling, a runaway script can rack up huge bills. Solution: hybrid — soft ceiling (warn at X) + hard ceiling (deny at 10X) + billable counter.

### 14.5 What if a customer disputes the count?

Audit log: log every limit decision with `(timestamp, key, action, allowed, remaining, limit)` to a separate event stream (Kafka → S3). 90-day retention. Customer support pulls audit log on dispute.

Cost: ~100 bytes per limit check × 1M QPS = 100 MB/s of logs. Aggregate / sample if prohibitive.

---

## 15. Cheat-Sheet Recap

1. **Problem:** Per-key allow/deny on the request path; sub-5ms added latency.
2. **Default algorithm:** Token bucket for user-facing quotas; sliding window counter for sub-minute.
3. **Storage:** Redis cluster, 30 shards, per-region. Lua for atomic check-and-update.
4. **Architecture:** Embedded library in gateway → Redis. Config from Postgres + pub/sub.
5. **Failure mode:** Soft-fail (allow) by default; abuse-critical endpoints fail-closed.
6. **Hot-key handling:** Per-instance local pre-aggregation, hierarchical quotas.
7. **Cross-region:** Per-region Redis; lease-based global limits for premium tiers.
8. **Biggest trade-off:** Approximate counting for O(1) memory.
9. **Breaks at 100×:** Hot Redis shard for one whale → escalate to hierarchical local quotas.
10. **Observability:** Per-key denial rate, top-N hot keys, breaker state.

---

## Appendix A: Algorithm decision tree

```
Need exact counting at small scale?           → Sliding Window Log
Need a smooth output rate (shape downstream)? → Leaky Bucket
Need bursts allowed with sustained avg?       → Token Bucket    (default)
Need sub-minute approximate?                  → Sliding Window Counter
Don't care about boundary problem?            → Fixed Window
```

## Appendix B: Stripe / GitHub / AWS published limits (for reference)

```
Stripe:    100 read / 100 write per second per account, burst handled
GitHub:    5000 / hour authenticated, 60 / hour unauthenticated
AWS:       per-service, per-region; many use token bucket with cost weights
Twilio:    1 / sec per number for SMS, dynamic for voice
```

## Appendix C: Common library / product references

```
Stripe's rate-limiter:   token bucket on Redis
GitHub's:                  fixed window on Memcached/Redis
Cloudflare's:             approximate sliding window at edge
Envoy:                    local + global rate limiting (gRPC service)
Kong:                     plugin model, multiple algorithms
Linkerd / Istio:          adaptive concurrency + token bucket
```

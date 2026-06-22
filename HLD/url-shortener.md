# URL Shortener (TinyURL / bit.ly) — High-Level Design

> **Difficulty:** Medium
> **Tags:** `[hld]` `[read-heavy]` `[kv-store]` `[caching]` `[id-generation]`
> **Prep time:** ~10 min skim, ~30 min deep read
> **Companies that ask this:** Meta, Google, Amazon, Microsoft, Atlassian, Uber, Airbnb, Twitter

---

## Beginner's Guide

### What's this in plain English?

You've used bit.ly. Paste in a long URL, get back something short like `bit.ly/abc123`. Anyone clicking the short URL gets redirected to the original. That's it. Behind the scenes: store a mapping `short → long`, and serve **billions** of redirects.

### Why solve it?

- **Real world**: bit.ly, TinyURL, t.co, every social media platform's link shortener.
- **Teaches**: read-heavy systems, ID generation, caching, simple but scalable design.
- **The canonical first system design question.** Easier than Twitter; harder than it looks.

### Vocabulary

- **Long URL** — the original, e.g., `https://example.com/very/long/...`.
- **Short URL** — the alias, e.g., `bit.ly/abc123`.
- **Slug / shortcode** — the unique part, `abc123`.
- **Read-heavy** — many more reads (clicks) than writes (creations) — typically 100:1.
- **Base62** — encoding using `[a-zA-Z0-9]`, gives us short alphanumeric IDs.
- **Counter** — a globally unique increasing number; encode in base62 → shortcode.

### High-level architecture

```
Client → Load Balancer → API Server → Cache (Redis) → DB (KV-store)
                                            ↓
                                  (analytics: clicks per slug)
```

Two main APIs:
- `POST /shorten` (write, rare) → generate a unique slug → save mapping → return.
- `GET /:slug` (read, common) → look up long URL → 302 redirect.

For writes: a **counter service** issues unique IDs; we encode in base62 to get the slug. Or hash the URL with a quick collision check.

For reads: the cache (Redis) handles 99% of traffic. Hot URLs live there; the DB is the source of truth.

For scale: shard the DB by slug. Add a CDN for redirects. Add analytics via async logs.

### How to read this doc

- **Beginner**: read sections 1–4 (problem, requirements, capacity, API). Skim deep dives.
- **Interview prep**: read all of it, especially cross-questions on base62 vs hashing, and "why not just use a UUID."

---

## 0. How to use this doc in an interview

URL Shortener is the **canonical** system design warm-up. It looks easy and is therefore where interviewers test depth. The traps:

1. Jumping to "use a hashmap" without estimating scale.
2. Using MD5/SHA without thinking about collisions.
3. Forgetting that the redirect path is the hot path — 99% of traffic is reads, not writes.
4. Not noticing that this is the easiest place in the world to demonstrate a CDN.

If you walk through capacity → ID generation → caching → sharding → analytics with clean reasoning, you're done in 35 minutes and the interviewer pivots to a follow-up (multi-region, custom domains, etc.). The cross-questions section below is where the real points live.

---

## 1. Problem Statement

Build a service that:
- Takes a long URL and returns a short URL (e.g. `https://bit.ly/3xY7q2P`).
- When the short URL is hit, redirects (HTTP 301/302) the user to the original long URL.
- Operates at internet scale (hundreds of millions of new short URLs per month, billions of redirects per day).
- Optionally supports custom aliases, expiration, and click analytics.

The service is **read-heavy** (redirects ≫ creations), **latency-sensitive** on reads (a redirect adds latency to whatever the user clicked), and **availability-critical** (every dead short URL is a broken link in someone's tweet).

---

## 2. Clarifying Questions to Ask the Interviewer

### Scope
- [ ] Is this a public service (anyone can shorten) or internal (Slack/Notion link shortener)?
- [ ] Do we support **custom aliases** (`bit.ly/my-team-doc`) or only system-generated codes?
- [ ] Expiration / TTL on links?
- [ ] **Analytics**: do we count clicks, store referrer, geolocate?
- [ ] **Link previews** (Open Graph fetching) in scope?
- [ ] User accounts / auth, or anonymous shortening?
- [ ] Are we serving the redirect from our own domain only, or supporting **custom domains** for paid users?
- [ ] Are we handling **abuse** (malware/phishing detection, link blacklists)?

### Scale
- [ ] How many new short URLs per month?
- [ ] Read:write ratio? (typical answer: 100:1 to 1000:1)
- [ ] Geographic distribution? Single region or global?
- [ ] How long do links live? Forever, or eventually purged?

### Non-functional
- [ ] Redirect latency target? (P99 — 100ms? 50ms?)
- [ ] Availability SLA? (99.9% costs ~$X, 99.99% costs ~$10X)
- [ ] Can a freshly-created short URL be unavailable for a few seconds (eventual consistency on writes), or must it be readable immediately?
- [ ] Compliance — GDPR right-to-erasure, data residency?

### Edge cases up-front
- [ ] What if the same long URL is shortened twice — same short code or different ones?
- [ ] What if a custom alias is already taken — error or auto-suffix?
- [ ] How short is "short"? 6 chars? 7? 10?

> **For this doc** we'll assume: public service, custom aliases supported, optional TTL, click counting (no per-click row), no link preview, single global service, ~10:1 read:write at small scale escalating to ~100:1 at scale, eventual consistency on writes is acceptable (~5 seconds), 99.99% availability target on reads, 99.9% on writes.

---

## 3. Functional Requirements

**Must-have (P0):**
1. `POST /shorten` accepts a long URL, returns a short URL (e.g. `https://sho.rt/abc1234`).
2. `GET /:code` returns HTTP 301 or 302 redirect to the original long URL.
3. Short codes must be unique (no collisions).
4. Short URLs are persistent (no random expiration unless TTL was set).
5. Same long URL submitted by different users **may** produce different short codes (creator-scoped).

**Should-have (P1):**
6. Optional `custom_alias` field on shorten — if free, used as the code.
7. Optional `expires_at` field — after which the redirect 410s (Gone).
8. Click counter (approximate, eventually consistent).
9. Idempotency: a `(creator, long_url)` retry within N seconds returns the same code.

**Nice-to-have (P2 — out of scope here, asked as follow-up):**
10. Per-click analytics (timestamp, country, user agent, referrer).
11. Link preview / OG fetching.
12. Custom domains.
13. Abuse / phishing detection.
14. Bulk shorten API.

---

## 4. Non-Functional Requirements

| Dimension | Target | Justification |
|---|---|---|
| Availability (read) | 99.99% | A dead redirect breaks every shared link; every minute of outage breaks the internet's trust in the service. |
| Availability (write) | 99.9% | Write outages are mostly invisible — clients can retry; reads cannot. |
| Latency P50 (redirect) | < 20 ms server-side | Redirects sit in the user's perceived load time of *another* page; they pay our latency twice. |
| Latency P99 (redirect) | < 100 ms | Hard ceiling — beyond this, perceived as broken. |
| Latency P50 (shorten) | < 100 ms | Async UI; users tolerate more here. |
| Throughput | 100k peak QPS reads, 1k peak QPS writes (see §5) | Sized for a realistic mid-tier link shortener. |
| Consistency (write) | Eventual within 5s globally | Acceptable: a freshly-created link can take seconds to be visible across regions. |
| Consistency (read) | Strong within a region | Every redirect must hit a consistent answer in the same region. |
| Durability | 11 nines (S3 / Aurora-class) | A lost row is a permanently broken link. |

---

## 5. Capacity Estimation (Back-of-Envelope)

> **Always do this on the whiteboard. Always show your math.**

### Writes (new short URLs)

```
Assume 100M new short URLs / month
                = 100 * 10^6 / (30 * 86400)
                ≈ 38.6 / sec     (average)
Peak = 10× average (real-world spikiness, marketing campaigns, etc.)
                ≈ 400 writes/sec peak
```

### Reads (redirects)

```
Read:write ratio        = 100:1 (mature shortener; viral campaigns push higher)
Avg reads/sec           = 100 × 38.6 ≈ 3,860/sec
Peak                    = 10× average ≈ 40,000/sec   (≈ 40k QPS peak)
```

> If the interviewer says "Twitter scale", multiply by 10 and re-derive — we'd be at ~400k QPS.

### Storage

```
Per row:
   short_code           ~ 8 bytes
   long_url             ~ 200 bytes (avg; 95th percentile higher)
   creator_id           ~ 16 bytes
   created_at           ~ 8 bytes
   expires_at           ~ 8 bytes
   click_count          ~ 8 bytes
   metadata flags       ~ 8 bytes
   row overhead         ~ 50 bytes (Postgres heap + indexes share)
Total                   ≈ 300 bytes/row

Annual rows             = 100M × 12 = 1.2B / year
Annual storage          ≈ 1.2B × 300 bytes ≈ 360 GB / year (logical)
With indexes (×2)       ≈ 720 GB
With 3× replication     ≈ 2.2 TB / year
Over 5 years            ≈ 11 TB
```

This is **trivial** — fits in a single beefy DB. Storage is *not* the bottleneck.

### Bandwidth

```
Each redirect:
   incoming HTTP req    ~ 0.5 KB
   response             ~ 0.5 KB (just headers — 301 + Location)
Total per redirect      ~ 1 KB

Read bandwidth (peak)   = 40k QPS × 1 KB ≈ 40 MB/s
Write bandwidth (peak)  = 400 QPS × 1 KB ≈ 0.4 MB/s
```

Trivial. Network is *not* the bottleneck.

### Cache Sizing (80/20 — Pareto)

```
80% of traffic hits 20% of URLs.
Active URLs (last 90 days) ≈ 300M
Hot 20% ≈ 60M URLs × 300 bytes ≈ 18 GB
```

A single 32 GB Redis instance covers the working set comfortably. Two instances (replicated) for HA.

### What is the bottleneck?

**Redirect latency at the read path.** 40k QPS is moderate, but every read must:
1. Look up `short_code → long_url` in O(1)
2. Increment a click counter (cheaply, async)
3. Issue a redirect

The bottleneck is the **path's tail latency** — DB stragglers, GC pauses, cold cache nodes. Hence: aggressive caching, multi-tier, async counter increment.

---

## 6. API Design

### REST API

```
POST   /v1/shorten
       Headers:  Authorization: Bearer <token>           (if auth scoped)
                 Idempotency-Key: <uuid>                 (for safe retry)
                 Content-Type: application/json
       Body:     {
                   "long_url":     "https://example.com/very/long/path?q=...",
                   "custom_alias": "my-link",            // optional
                   "expires_at":   "2026-12-31T23:59Z",  // optional, ISO 8601
                   "creator_id":   "user_42"             // implicit from auth
                 }
       Returns:  201 Created
                 {
                   "short_code":  "abc1234",
                   "short_url":   "https://sho.rt/abc1234",
                   "long_url":    "https://example.com/...",
                   "expires_at":  "2026-12-31T23:59Z"
                 }
       Errors:
         400 — invalid URL, malformed body
         401 — missing/bad auth
         409 — custom_alias already taken
         410 — long URL on blocklist (phishing, etc.)
         429 — rate limit exceeded

GET    /:code
       (NOT under /v1 — bare path, served from short domain)
       Returns:  301 Moved Permanently         (or 302 Found — see §13)
                 Location: <long_url>
                 Cache-Control: private, max-age=300
       Errors:
         404 — code does not exist
         410 — code expired
         451 — blocked for legal reasons

GET    /v1/links/:code
       (read API for owners — not a redirect)
       Returns:  200 + { code, long_url, created_at, expires_at, click_count, ... }

DELETE /v1/links/:code
       (owner can soft-delete)
       Returns:  204 No Content
```

### Why REST and not gRPC / GraphQL?

- The redirect path **must be HTTP** because browsers do the work. gRPC isn't an option for that endpoint.
- The shorten/CRUD APIs *could* be gRPC for internal callers, but exposing REST is cheaper for public + 3rd-party use.
- GraphQL is overkill — there are 4 fields. The flexibility GraphQL buys is wasted here.

### Idempotency

Writes carry `Idempotency-Key`. Server stores `(key, response, ttl=24h)` in Redis. Retries within 24h with the same key return the cached response — same `short_code`, no duplicate row, no extra counter increment.

This matters because clients **will** retry. Without idempotency, a network blip during shorten gives the user two different short codes for the same link.

### Pagination (for `GET /v1/users/:id/links`)

Cursor-based: `?cursor=<opaque base64 of (created_at, id)>&limit=50`. Why not offset?

- Offset breaks under inserts/deletes — same `?offset=100` returns different rows over time.
- Offset is O(N) at the DB — `OFFSET 1000000` reads 1M rows it then throws away.
- Cursor is O(log N) on `created_at DESC` index.

### Rate Limiting

- Anonymous: 10 shortens / minute / IP.
- Authenticated free tier: 100 / minute / user.
- Paid: 10k / minute / user.
- Read endpoint (`GET /:code`): no per-IP limit — would break sharing; instead, edge-level abuse heuristics.

---

## 7. Data Model

### SQL or NoSQL?

We pick **SQL (Postgres / Aurora)** as the system of record. Reasoning:

- Access pattern is **point lookup by primary key** (`short_code`). Both SQL and NoSQL are fine on this axis.
- We need **uniqueness enforcement** on `short_code` — a unique index on PK. Both can do this, but SQL gives stronger guarantees (no eventual consistency window where two writers both succeed).
- Custom alias claims need **transactional check-then-insert**: "if `my-link` is free, claim it, else 409". This is cleaner with `INSERT ... ON CONFLICT DO NOTHING` than with NoSQL conditional puts (which exist — DynamoDB's `ConditionExpression` — but compose worse with secondary mutations).
- Owner queries (`SELECT * FROM links WHERE creator_id = ?`) want a secondary index. Postgres handles fine.
- We never need ad-hoc joins. SQL's JOIN power is unused — but its other guarantees pay rent.
- At our scale (11 TB over 5 years), Postgres with a few read replicas plus a sharding layer for the next 10× growth is comfortable. We don't need DynamoDB-class scale yet.

> If the interviewer pushes "but Twitter is using DynamoDB!" — fine. The decision flips when **write QPS reaches 100k+ sustained**, when **single-row size is unpredictable**, or when **multi-region active-active with last-write-wins is needed**. None of those are true here.

### Tables

#### `links`

| Column | Type | Index | Note |
|---|---|---|---|
| short_code | VARCHAR(16) | PRIMARY KEY | The unique 7–10 char code |
| long_url | TEXT | — | Up to 2048 chars; longer is rare and we reject |
| creator_id | UUID | INDEX (creator_id, created_at DESC) | Owner queries |
| created_at | TIMESTAMP | (in composite above) | |
| expires_at | TIMESTAMP NULL | INDEX (expires_at) WHERE NOT NULL | Sweep job |
| is_custom | BOOLEAN | — | True if user picked the alias |
| click_count | BIGINT | — | Approximate, async-incremented |
| status | SMALLINT | — | active / blocked / deleted |
| metadata | JSONB | — | Misc — referrer policy, redirect type, etc. |

**Why these indexes?**
- PK on `short_code`: every redirect is a PK lookup — cardinal hot path.
- `(creator_id, created_at DESC)`: the only secondary access pattern; covers "list a user's links, newest first".
- Partial index on `expires_at WHERE NOT NULL`: 95% of links never expire; skip them in the sweeper.
- **No** index on `long_url`: we never query by long URL except for idempotency, which we cache in Redis.

**Why JSONB and not extra columns?**
- Metadata fields proliferate over time (allow_robots, custom_redirect_type, ...). JSONB lets us add fields without migrations. The fields we *query on* still get their own typed column.

#### `idempotency_keys` (Redis, TTL 24h — not a DB table)

```
key:   idem:{creator_id}:{idempotency_key}
val:   { "short_code": "...", "status": 201 }
ttl:   86400
```

#### `click_events` (only if analytics enabled — out of scope for base design)

Lives in a column store (ClickHouse / BigQuery / Redshift) — see §14.1.

### Sharding strategy

At our base scale (~400 writes/s, 1.2B rows over 10 years), a single Postgres primary handles writes; reads scale via read replicas + Redis. We don't need to shard yet.

**When to shard:** when write QPS exceeds the primary's CPU ceiling (typically ~50k writes/s for a beefy box). At that point:

- Shard key: `short_code` (hashed). Why not `creator_id`? Reads are by `short_code` — if we sharded by `creator_id`, every redirect would need a creator-id lookup first. Wrong.
- Strategy: consistent hashing with virtual nodes (256 vnodes per physical), so cluster resize moves only `1/N` of data.
- Cross-shard queries (owner's links) go through a fan-out at the API tier, capped at K shards via `creator_id → vnode` precomputation.

---

## 8. High-Level Architecture

```
                     ┌────────────────────────────────────┐
                     │            Clients                 │
                     │   (browser, mobile, 3rd-party)     │
                     └──────────────────┬─────────────────┘
                                        │ HTTPS
                                        ▼
                     ┌────────────────────────────────────┐
                     │              CDN                   │
                     │   (Cloudflare / CloudFront / Fastly)
                     │   - serves redirects from edge     │
                     │   - caches  GET /:code  ~5min      │
                     └──────────────────┬─────────────────┘
                            cache miss  │
                                        ▼
                     ┌────────────────────────────────────┐
                     │          L7 Load Balancer          │
                     │      (AWS ALB / Envoy / NGINX)     │
                     │   path-based: /:code → read pool   │
                     │                /v1/* → write pool  │
                     └──────────┬─────────────────┬───────┘
                                │                 │
                  read traffic  ▼                 ▼  write traffic
        ┌───────────────────────────┐   ┌───────────────────────┐
        │     Redirect Service      │   │   Shorten Service     │
        │   (stateless, autoscale)  │   │ (stateless, autoscale)│
        │   - cache lookup          │   │ - validate URL        │
        │   - DB fallback           │   │ - generate code       │
        │   - emit click event      │   │ - claim custom alias  │
        │   - 301/302 response      │   │ - persist             │
        └────┬─────────────┬────────┘   └────────┬──────────────┘
             │             │                     │
             ▼             ▼                     ▼
        ┌─────────┐  ┌──────────┐         ┌────────────┐
        │  Redis  │  │  Kafka   │         │ ID Gen Svc │
        │  Cache  │  │ (clicks) │         │ (Snowflake │
        │         │  │          │         │  / Counter)│
        └────┬────┘  └────┬─────┘         └─────┬──────┘
             │            │                     │
             │            ▼                     │
             │    ┌──────────────┐              │
             │    │  Click       │              │
             │    │  Aggregator  │              │
             │    │  (Flink /    │              │
             │    │   batch job) │              │
             │    └──────┬───────┘              │
             │           │                      │
             ▼           ▼                      ▼
        ┌──────────────────────────────────────────────┐
        │           Postgres / Aurora (primary)        │
        │           writes here, reads from replicas   │
        └────────────────────┬─────────────────────────┘
                             │ async streaming replication
                             ▼
        ┌──────────────────────────────────────────────┐
        │              Read Replicas                   │
        │     (per-region, lag < 100 ms typical)       │
        └──────────────────────────────────────────────┘
```

### Hot path (redirect): walk-through

```
1. User clicks https://sho.rt/abc1234
2. DNS → CDN edge POP (≤10 ms)
3. CDN checks edge cache for "abc1234" (≤5 ms typical)
   → HIT  : returns 301 with Location header.  P50 ≈ 15 ms total. END.
   → MISS : forward to origin LB.
4. LB routes to nearest Redirect Service instance.
5. Redirect Service:
     a. Redis GET "url:abc1234"
        → HIT : retrieve long_url, async-emit click to Kafka, return 301. ≈ 20–30 ms.
        → MISS: continue.
     b. Postgres read replica:
          SELECT long_url, status, expires_at FROM links WHERE short_code = 'abc1234'
        - validate status, check expires_at
        - populate Redis with TTL ~30 min
        - emit click to Kafka
        - return 301. ≈ 30–50 ms.
6. CDN may cache the 301 for the configured Cache-Control window (5 min default).
```

### Cold path (shorten): walk-through

```
1. Client POSTs JSON to /v1/shorten with idempotency key.
2. LB → Shorten Service.
3. Shorten Service:
     a. Check Redis idem:{creator}:{key}. HIT → return cached response.
     b. Validate long_url (well-formed, scheme allow-list, length, blocklist).
     c. Resolve short code:
        - if custom_alias: try INSERT ... ON CONFLICT DO NOTHING.
          on conflict → 409.
        - else: ID Gen Service returns next ID; encode base62 → 7-char code.
     d. INSERT into links (transactional, on PK collision retry with new ID — should be near-zero with counter).
     e. Cache (short_code → long_url) in Redis with long TTL.
     f. Cache idempotency response.
     g. Return 201.
```

---

## 9. Component Deep-Dives

### 9.1 CDN (edge cache)

- **Responsibility:** Serve hot `GET /:code` redirects from POPs, never reaching origin.
- **Tech:** Cloudflare / CloudFront / Fastly. Tier-1 — pick one and let edge caching do the heavy lifting.
- **Key behaviors:**
  - Honor `Cache-Control: max-age=300` from origin (5-minute window — short enough to honor deletes, long enough to absorb 99% of redundant requests).
  - Cache the `301` response itself, including the `Location` header.
  - Stale-while-revalidate: serve stale on origin error to keep links live during incidents.
- **Failure mode:** CDN outage forces all traffic to origin. Origin is provisioned for ~10× normal to absorb this — expensive but bounded.
- **Capacity:** CDN POPs are effectively unlimited.

### 9.2 Load Balancer

- **Responsibility:** Path-route to read vs write fleet.
- **Tech:** AWS ALB or self-managed Envoy. ALB is fine.
- **Key behaviors:**
  - Path rule: `/v1/*` → write fleet; `/*` (matching short-code regex) → read fleet.
  - Health checks every 5s; eject unhealthy in 30s.
  - HTTP/2 to backends; HTTPS termination at LB.
- **Failure mode:** LB is regional and itself HA-managed (AZs).

### 9.3 Redirect Service (read path)

- **Responsibility:** Fastest possible 301.
- **Tech:** Go or Rust — both give ~10–50µs of overhead on a tight handler. Java/Python add 5–20× overhead but are fine if your team owns them.
- **Behavior:**
  - Stateless. Autoscale on request rate.
  - In-process LRU L1 cache (~10k entries) — absorbs hot keys before Redis.
  - Redis L2 cache.
  - Postgres replica fallback.
  - **Click emission is fire-and-forget to Kafka** — never blocks the redirect.
- **Capacity:** ~30k–100k QPS per modern instance. We'll run ~5 instances in a region for headroom.
- **Failure mode:** if Redis is down, fall through to DB. if DB is down, serve cached entries from L1, return 503 for misses (better than blocking).

### 9.4 Shorten Service (write path)

- **Responsibility:** Validate, generate, persist.
- **Tech:** Go / Java / whatever the team uses.
- **Behavior:**
  - Calls ID Gen Service — never generates IDs locally.
  - Validates against URL blocklist (Google Safe Browsing, internal phishing list).
  - Writes to Postgres primary.
  - Populates Redis.
- **Capacity:** ~1k peak QPS — comfortable for a small fleet.
- **Failure mode:** if Postgres is down, **fail the write** with 503. Don't queue and dread later — clients can retry idempotently.

### 9.5 ID Generation Service

- **Responsibility:** Hand out unique numeric IDs that get encoded base62 → short code.
- **Approaches** (compared in §10.1).
- **Tech (chosen):** **Counter with batch allocation** — a single source-of-truth counter (DynamoDB / Postgres atomic counter / ZooKeeper sequencer) that hands out batches of 1000 IDs at a time to each Shorten Service instance. Within a batch the instance increments locally.
- **Capacity:** A batch fetch every ~1000 writes. At 400 writes/s peak, ~0.4 batch fetches/sec — a single counter handles this trivially.
- **Failure mode:** If counter service is down, instances fall back to their already-allocated batch. If a batch is lost (instance crash), the gap is forever — acceptable; 1000 wasted IDs out of 62^7 = 3.5T possibilities.

### 9.6 Cache (Redis)

- **Responsibility:** Hot-set lookup table.
- **Tech:** Redis (managed: ElastiCache / MemoryDB).
- **Topology:** Cluster mode with N shards, replicated 1+1.
- **Key shape:**
  ```
  url:{short_code} → {long_url, status, expires_at}    TTL: 30 min
  idem:{creator}:{idempotency_key} → {response_body}    TTL: 24h
  rate:{creator|ip}                → counter            TTL: 60s
  ```
- **Eviction:** allkeys-lru — under memory pressure, drop coldest.
- **Failure mode:** If Redis cluster is unhealthy, fall through to DB. DB is sized for some headroom but not full traffic — degraded, not dead.

### 9.7 Kafka (click event bus)

- **Responsibility:** Decouple redirect from analytics.
- **Tech:** Kafka / Kinesis / Pulsar — pick your tribe.
- **Topic:** `clicks` — partitioned by short_code (so a hot code's clicks land on one partition for the aggregator's benefit).
- **Producer:** Redirect Service, async, fire-and-forget. If broker is down: drop the event, increment a metric. Counts are eventually-consistent anyway.
- **Consumer:** Click Aggregator (next).

### 9.8 Click Aggregator

- **Responsibility:** Increment click counters with bounded latency, write to DB.
- **Tech:** Flink / Spark Streaming, or a simple Kafka Streams batcher.
- **Behavior:**
  - Read clicks from `clicks` topic.
  - Tumbling window (e.g. 60s).
  - Per-code count → atomic `UPDATE links SET click_count = click_count + N WHERE short_code = ?` per minute.
  - For large-scale analytics, also write per-event into ClickHouse / Druid.
- **Trade-off:** Counters are ~1 minute stale. Acceptable.

### 9.9 Postgres (system of record)

- **Topology:** 1 primary + 2–3 read replicas per region. Multi-AZ for primary failover.
- **Write QPS:** ~400 peak. Trivial.
- **Read QPS:** ~40k peak — but ~99% absorbed by CDN + Redis. Replicas see ~400 read QPS at most.
- **When to shard:** see §7. Not now.

---

## 10. Deep-Dives on the Hardest Sub-Problems

### 10.1 Short Code Generation — the canonical drilldown

This is the question every URL-shortener interview drills into. Have a strong answer.

#### Approach A: Counter + base62 encode

How:
- Maintain a global atomic counter.
- On shorten, fetch counter value `n`, encode `n` in base62 (chars `0-9A-Za-z`).
- 7-char base62 = `62^7 ≈ 3.5 × 10^12` ≈ 3.5 trillion codes — enough for 27 years at 100M/month.

Pros:
- **Zero collisions by construction** — every counter value maps to one code.
- Predictable code length (start at counter = 62^6 ≈ 56B if you want 7 chars from day one; or accept growing length and live with shorter codes early).
- O(1) generation, no retries.
- Cheap to scale: batch-allocate counter ranges.

Cons:
- Counter is enumerable: `abc1234` and `abc1235` are sequential. Reveals issuance rate to attackers + competitors. **Mitigation:** XOR with a fixed secret, or interleave with random bits — see "non-sequential counter" below.
- Centralized counter is a write hotspot — **mitigated** by batch allocation per instance.
- Cannot give the **same** short code for the same long URL submitted twice — but we said §3 P0(5) we don't need that.

#### Approach B: Hash(long_url) — first 7 base62 chars of MD5/SHA

How:
- `hash = sha256(long_url + creator_id)`
- Take first ~42 bits, base62 encode → 7 chars.

Pros:
- No central state, no counter.
- Same long URL by same user → same code (free idempotency).

Cons:
- **Collisions are guaranteed at scale** — birthday bound: at `2^21 ≈ 2M` URLs we expect collisions on 7-char codes. We'd need to detect and retry on collision (read-before-write — defeats stateless purpose).
- Can't honor "same long URL → different code per user" (some products want this).
- Truncation of a cryptographic hash gives uniformly random output, but we lose the cryptographic property — fine for ID generation, not fine for security tokens.
- Hash output has no ordering, so DB inserts are random — kills B-tree insert locality.

#### Approach C: Random (CSPRNG)

How:
- Generate 7 random base62 chars.
- INSERT; on PK collision, retry.

Pros:
- No central state.
- Non-enumerable.

Cons:
- At scale, collision probability rises. At 50% of address space full, 50% of inserts collide. We'd need to monitor and grow the code length.
- Wastes 1 round-trip on each collision retry.
- Hot pages problem: random PKs scatter writes across all heap pages — destroys cache locality on the Postgres primary.

#### Approach D: UUID v7 → base62 truncation

UUID v7 is time-ordered random — great for DB locality. But truncating it loses the ordering. Combining the time prefix with a random suffix gets you ~10–13 chars, longer than competitors. Useful for *internal* IDs, less ideal for the public short code.

#### Comparison

| Approach | Collisions | Locality | Centralization | Length | Enumerable |
|---|---|---|---|---|---|
| Counter + base62 | None | Good (sequential) | Centralized counter | Min 7 | Yes (mitigatable) |
| Hash truncation | Birthday bound | Bad | None | 7 | No |
| Random (CSPRNG) | Probabilistic | Bad | None | 7 | No |
| UUID v7 truncate | Birthday bound | Good (prefix) | None | 10+ | Partial |

#### Chosen approach (this design): **Counter + base62 with non-sequential mapping**

We use a counter *internally* but apply a **bijective shuffle** so adjacent counter values do not produce adjacent short codes:

```
encoded_id = (counter * P) mod (62^7)         where P is coprime with 62^7
short_code = base62(encoded_id, padded to 7)
```

A multiplicative hash with a coprime constant is bijective — every counter value maps to exactly one encoded_id and back. Result: **zero collisions, non-enumerable, O(1).**

The counter itself is partitioned: each Shorten Service instance preallocates a range of 1000 IDs from a central sequencer (Postgres `nextval()` on a sequence, or DynamoDB atomic counter). Instances burn through their range locally; no per-write contention.

#### What about custom aliases?

Custom aliases live in the same `short_code` PK space. To prevent collision with system-generated codes:

- System codes are always exactly 7 chars.
- Custom aliases are required to be ≥ 4 chars and use a separator (`-`, `_`) — system codes never contain those. The two namespaces don't overlap.
- Alternative: keep them in the same table but tag with `is_custom=true`; rely on PK uniqueness. Simpler — and we use this.

### 10.2 Caching strategy

Multi-tier:

**L1 — In-process LRU on Redirect Service (~10k entries, ~3 MB).**
- Catches truly hot keys (hot tweets, viral campaigns).
- TTL 60s — tolerable staleness; cheap memory.
- Hit rate at peak: ~30%.

**L2 — Redis cluster.**
- 32 GB instance per shard, replicated, ~6 shards total.
- Holds the 80/20 hot set (~18 GB).
- TTL 30 min on positive entries.
- TTL 5 min on **negative entries** (`url:{code} → ∅`) to defend against cache penetration (see §13.6).
- Hit rate on L1 miss: ~95%.

**L3 — Postgres read replica.**
- Final fallback.
- Sees ~5% of L2 misses → ~5% × 5% × peak = ~0.25% × 40k QPS = 100 QPS. Trivial.

**Cache write strategy: write-through.** When a new short URL is created, populate L2 immediately. Don't let the first reader pay the cold-cache cost — they'd hit DB right after the write commits.

**Cache invalidation:** On link delete or expire, publish to a Redis channel; Redirect Service instances drop the key from L1 on receipt. L2 is invalidated by the deleter itself (just `DEL`).

### 10.3 Click counting at scale

Naive: `UPDATE links SET click_count = click_count + 1 WHERE short_code = ?` per click.

This kills you:
- Every redirect now requires a write — primary CPU melts.
- Hot keys serialize on the same row.
- At 40k QPS, ~40k UPDATEs/sec to a single primary — over capacity for moderate hardware.

Better: **fire click events to Kafka, aggregate in 1-minute windows, do batched UPDATEs.**

```
40k clicks/s → Kafka (no row contention; partitioning)
   → Click Aggregator: keyBy(short_code), windowed sum (1 min)
   → emit "code=abc1234, +N clicks" per minute per active code
   → batched UPDATE links SET click_count = click_count + N WHERE short_code = ?

Result:
   ~1M unique active codes per hour at peak
   ~16k UPDATEs/min ≈ 270 UPDATEs/sec  (down from 40,000)
   Each UPDATE batches ~150 clicks
```

Counter is **eventually consistent within ~60 seconds.** Acceptable for a click count.

For per-event analytics (timestamps, geo, referrer), don't update Postgres — write events to ClickHouse / BigQuery directly from the Aggregator. Postgres holds `click_count` only.

---

## 11. Bottlenecks & How They Break Under Scale

| Load × | What breaks first | Symptom | Fix |
|---|---|---|---|
| 1× (now) | — | Healthy | Run as-is |
| 10× | Single Postgres primary — write QPS 4k | Replication lag spikes, primary CPU > 80% | Vertical scale primary. Keep counter centralized (it's batched). |
| 100× | Cache hot keys (one viral link → hammers one Redis shard) | One Redis shard CPU pegged | Add per-instance L1 LRU with stale-while-revalidate; introduce request coalescing (singleflight) on misses. |
| 1000× | Postgres primary regardless | Writes serializing, replication lag minutes | Shard Postgres by `hash(short_code)` with consistent hashing. Move counter to per-shard sequencer. |
| Multi-region | Cross-region read latency (200ms) | P99 redirects exceed SLA in remote regions | Multi-region: replicate writes async, serve reads from local replica. Accept eventual consistency on freshly-created codes (~5s). |

**Metrics to watch:**
- P99 redirect latency (target < 100 ms)
- Cache hit rate at L1 and L2 (target L2 > 90%)
- Postgres primary write IOPS (alert at 70% of capacity)
- Replication lag (alert > 1s)
- Kafka consumer lag (alert > 60s — counter staleness ceiling)
- Idempotency key Redis memory growth (alert: cardinality)

---

## 12. Trade-offs Summary

| Decision | Gained | Gave up | Why right |
|---|---|---|---|
| SQL (Postgres) over NoSQL | Strong PK uniqueness, transactional alias claim, mature tooling | Horizontal scale ceiling without sharding | Fits our scale; sharding deferred to load that requires it |
| Counter+base62 with shuffle | Zero collisions, O(1), short codes | Centralized counter dependency | Batched allocation removes contention |
| 301 (default) | Browser caches the redirect — lighter origin load | Click counts lose freshness from cached browser hits | Acceptable if click count is approximate; otherwise use 302 (see §13.5) |
| Async click events via Kafka | Redirect path stays fast (~ms), DB load constant | Click counts ~60s stale | Click counts are not used for billing or auth — staleness is fine |
| In-process L1 + Redis L2 | ~99.5% redirect cache hit rate | Memory + invalidation complexity | Pareto applies hard; investment pays off |
| Eventual consistency cross-region | Multi-region read latency | Freshly-created code may 404 remotely for ~5s | Acceptable: client UX shows the new link locally first |
| No per-event row in Postgres | Postgres write QPS doesn't scale with reads | Per-event analytics must go elsewhere (ClickHouse) | OLAP and OLTP have different optima |

---

## 13. Cross-Questions ("Why X and not Y")

> The interviewer's job is to drill. These are the most common drill targets — answer each as if it's the deciding question.

### 13.1 Why base62 and not base64?

base64 uses `+`, `/`, and `=`. The first two are legal in URLs only when percent-encoded — which makes the short URL longer than its raw form, defeating the point. The third is padding which we don't need. URL-safe base64 (`-_` substitutions) avoids the percent-encoding issue but uses 64 chars; we don't need those extra 2 chars (`62^7 = 3.5T` is already plenty), and `-` and `_` are visually fragile in handwriting / SMS, where they can be mistaken for whitespace or omitted. base62 sticks to alphanumerics that survive every text channel.

When base32 (case-insensitive, 32 chars from `0-9A-Z` minus visually-confusing ones) is preferable: when the short link will be **typed by humans**, the case-insensitivity prevents `aBc1234` vs `abc1234` ambiguity. But base32 codes are ~17% longer (`32^x = 62^7` → `x ≈ 8.4`). For our case, the codes are clicked, not typed — we accept case sensitivity.

### 13.2 Why not just MD5(long_url)[:7] for the short code?

Three problems:

1. **Collision math kills you.** `2^42 ≈ 4 × 10^12` possible 7-char base62 codes. Birthday bound: collision is expected at `√(2^42) ≈ 2 × 10^6` URLs — we hit that in one month. Now every shorten requires a read-before-write to detect collision, and on collision you append a salt and retry, which is just a worse counter.

2. **Collapses different users / different intents.** Same URL submitted twice produces the same short code, even if user A wanted a tracked link and user B wanted a different one. Strips the per-creator dimension.

3. **No DB locality.** Hash output is uniformly random — every insert lands on a random heap page, defeating B-tree insert clustering, doubling write IOPS.

Hashing for IDs is fine for *internal* IDs (they're typically longer). For 7-char public codes, it's wrong.

### 13.3 Why 301 and not 302 — or vice versa?

| Code | Browser behavior | CDN behavior | Click counting |
|---|---|---|---|
| 301 (Moved Permanently) | Caches the redirect, may not re-request | Cacheable indefinitely (we cap with Cache-Control) | Subsequent clicks bypass our server — we miss them |
| 302 (Found) | Re-requests every time | Not cached by default | We see every click |
| 307/308 | Like 302/301 but preserve method | — | — |

If click counting must be exact (analytics product, paid tier), we use **302**. Default tier uses **301** — clicks become approximate, but origin load drops dramatically (CDN serves ~95% of repeat clicks without touching us).

A common compromise: use 302 with a short `Cache-Control: private, max-age=0`. The `private` keeps CDN out of it; `max-age=0` keeps browsers from caching. This costs origin load but preserves count fidelity.

### 13.4 Why centralize the counter — isn't that a single point of failure?

It's centralized in *contract* (one source of truth), distributed in *load*: the counter hands out batches of 1000 IDs at a time. Each Shorten Service instance pulls a batch on startup and on exhaustion. Per-write contention on the central counter is `1/1000` of write QPS — at peak 400 writes/s, that's 0.4 fetches/sec on the counter. A single Postgres `nextval()` call.

For redundancy: the counter itself is just an atomic value in a managed DB (Aurora / DynamoDB). Both run multi-AZ with sub-second failover. If we still worry, we partition the counter space (e.g. 16 counter shards, instance picks one); that gives 16-way parallelism but introduces gaps in numbering — fine, since we shuffle anyway.

If the central counter is *briefly* unavailable, instances finish their preallocated batch and stall after that. They don't return wrong IDs — just 503. Acceptable.

### 13.5 What if Redis goes down — does the service fall over?

No — designed degraded modes:

1. **Redirect path:** L1 (in-process) absorbs the truly hot keys regardless of Redis. On L1 miss, fall through to Postgres replica. Replica QPS rises from ~400 to ~40k — replicas are sized 2–3× safety margin, so this is uncomfortable but survivable for the duration of a Redis incident. If we can't survive even that, add a per-instance disk-backed cache (e.g. local SSD with RocksDB) as L1.5.

2. **Idempotency:** Without Redis, idempotency degrades to "best effort" — duplicate writes are possible if the client retries. Acceptable; shorteners aren't doing financial transactions.

3. **Rate limiting:** Without Redis, rate-limit counters reset. Switch to per-instance local counters (less accurate, still effective). Or fail-open temporarily — we accept some abuse over service outage.

The architecture deliberately makes Redis a *performance* dependency, not a *correctness* dependency.

### 13.6 How do you defend against cache penetration (someone scanning random codes)?

A scanner hammering `/aaaa1`, `/aaaa2`, `/aaaa3`, ... never finds a code → never populates cache → every miss hits the DB. Without defense, scanners DOS the DB.

Defenses:
- **Negative caching:** cache `404`s in Redis with a short TTL (e.g. 5 min) — `url:{code} → ∅`. Subsequent lookups for the same dead code return 404 from cache.
- **Bloom filter:** keep an in-memory Bloom filter of all valid `short_code`s on each Redirect Service instance. Bloom returns "definitely no" for random scans; only on positive hit do we check Redis/DB. False positive rate ~1% means 99% of scanner traffic is killed in O(1) on the edge.
- **Edge rate-limit per IP**: scanners reveal themselves through traffic shape — block at CDN.

We use all three: edge limits as the first line, Bloom in-process as the second, negative caching as the third.

### 13.7 How do you handle the same long URL being shortened twice — do you dedupe?

By default, **no**. Two reasons:
1. Different creators want different codes for the same URL — user A's tracking pixel ≠ user B's.
2. Even within a single creator, different campaigns may want different codes for the same URL.

But idempotent retry of the *same request* (same `Idempotency-Key`) returns the same code — that's a different question (network resilience, not dedup).

If a product wants single-code-per-(creator, URL): add a unique index on `(creator_id, long_url)` and use `INSERT ... ON CONFLICT DO NOTHING RETURNING short_code`. Trade-off: now every shorten does a write that may turn into a read of an existing row, doubling the write path's complexity and locking. Better to keep dedup as a separate optional read-side feature.

### 13.8 Why eventual consistency for click counts?

Strong consistency would require either:
1. Synchronous DB write per click — kills the redirect latency budget.
2. Synchronous Redis INCR per click — better, but the Redis hotkey problem strikes for viral links: a single counter taking 40k INCRs/s is a hot Redis key, and Redis is single-threaded per key.

Eventual consistency via Kafka aggregation gives:
- Constant DB write load.
- Easy parallelism (partition by short_code).
- Acceptable staleness window (~60s) — click counts aren't a billing input.

If a customer demands real-time counts, we expose a separate API that reads from a Redis HyperLogLog (approximate) or a per-code Redis counter populated by the aggregator. They get realtime-ish, not exact.

### 13.9 Why not use a single distributed system (DynamoDB / Cassandra) instead of Postgres + Redis + Kafka?

DynamoDB alone could handle the lookup. But:

- We lose the **transactional alias claim** (DynamoDB has conditional writes, but composing them with secondary changes is harder than one Postgres transaction).
- We lose the **flexible secondary indexes** (DynamoDB GSIs are ⊥ for ad-hoc queries).
- We **don't lose Redis** — DynamoDB at 100k+ read QPS costs more than Redis-fronted Postgres.
- We **don't lose Kafka** — analytics still wants OLAP, not OLTP.

We'd trade two well-understood components (Postgres, Redis) for one black-box managed system that's harder to debug. That's not a win at our scale. At Twitter/Meta scale (10× ours, multi-region active-active), DynamoDB-class storage starts winning. **Right tool for the right scale.**

### 13.10 How would you handle GDPR right-to-erasure?

A user deletes their account. We must:
1. Hard-delete `links` rows for that creator.
2. Invalidate Redis entries for those codes (publish to invalidation channel; DEL from L2).
3. Tombstone in Kafka click stream so Aggregator drops in-flight events.
4. Remove from any downstream analytics stores (ClickHouse, etc.) — this is the hard part; column stores are designed for append.
5. Honor a 30-day "right to be forgotten" SLA (regulatory).

The redirects for the user's links break — return 410 Gone instead of 404. Distinguishing "deleted" from "never existed" is meaningful for clients.

Backups complicate things: a 30-day hot backup may still hold the row for restore. We document this in the data-retention policy. Backups beyond the SLA are rotated out naturally.

### 13.11 What if a user submits a malicious URL (phishing, malware)?

Three layers of defense:
1. **Pre-shorten check:** call Google Safe Browsing API on the long URL. If flagged, reject 410.
2. **Asynchronous re-check:** every link is re-checked against the blocklist daily; transition `status=blocked` on positive.
3. **Blocked redirect behavior:** instead of 301, return a warning page or a 451.

The first check costs us a network call per shorten. At 400 writes/s peak, it's ~400 calls/s to Safe Browsing — within their free tier. Cache the result (long_url → safe?) for 1 hour to absorb retries.

### 13.12 Why no JWT auth on the redirect endpoint?

The redirect must be **publicly accessible** — that's the whole product. Auth on the redirect would break sharing. We auth only the management APIs (shorten, list, delete) where the user owns the data.

If the *product* requires gated short links (paywalled, member-only), that's a separate feature: the shorten step records a required scope, and the redirect path bounces unauthenticated users to a login page. Rare for a generic shortener; common for enterprise.

### 13.13 What's the failure mode when the central counter exhausts a batch and the central service is unreachable?

Each instance keeps a small reserve (e.g. always pre-allocate the *next* batch when ≤ 10% of current batch remains). So we have a buffer of ~100 IDs even if central counter goes down at the worst moment.

Beyond that buffer, instances return 503 with `Retry-After`. Clients retry; idempotency ensures no double-issuance once central recovers.

Alternative: instances fall back to **random codes** during outage, with INSERT ... ON CONFLICT retry. Trade-off: collision risk and broken sequence-shuffle property. We avoid this and prefer 503; counter outage is rare and short.

### 13.14 Why cursor pagination for owner queries instead of OFFSET?

Three reasons:

1. **Stability**: a user inserts a new link between page 1 and page 2 of your `OFFSET`-paginated list, and now an old link shifts down a slot — the user sees a duplicate row when paginating. Cursor (last seen `created_at, id`) is monotonic and stable.

2. **Performance**: `OFFSET 100000` reads 100k rows the DB then discards. Cursor is `WHERE (created_at, id) < (?, ?)` — index-driven, O(log n).

3. **Security**: opaque cursors prevent users guessing `?offset=10000000` to enumerate.

We base64-encode `(created_at, id)` into the cursor, sign it with a server secret to prevent tampering.

### 13.15 How would you rate-limit without Redis?

Local in-process token buckets per IP/user, sized for the desired rate. Trade-offs:
- **Pro:** No Redis dependency. No cross-process coordination.
- **Con:** Each instance has its own bucket — a user can get N× the limit if they hit N instances. Sticky sessions partially solve this; perfect solutions require global state (Redis or similar).

At the LB tier (NGINX `limit_req` / Envoy local rate limit) we get free per-IP basic limiting. For per-user (auth'd), we use Redis. Combined: edge-level coarse limiting + Redis-backed fine-grained — graceful degradation if Redis is sad.

### 13.16 Why not write idempotency keys to the DB instead of Redis?

DB is durable; Redis is volatile. Reasons we use Redis:

- **Volume**: idempotency keys arrive at write QPS — adding them as DB rows doubles write load.
- **TTL**: Redis TTLs are first-class; in DB, you'd need a sweeper job.
- **Latency**: Redis lookup is sub-millisecond; DB is 5-20ms.
- **Loss tolerance**: losing an idempotency record means at worst a duplicate row. We have a unique constraint (`creator_id`, `idempotency_key`) on the `links` table that catches duplicates within the same instance — Redis is the fast path, DB the safety net.

A **belt-and-suspenders** version: Redis for fast path, plus a unique constraint on `(creator_id, idempotency_key)` in `links` (with a partial index `WHERE idempotency_key IS NOT NULL`). Best of both.

### 13.17 What happens to the cache when a link is deleted?

Three things must invalidate:
1. **Redis L2**: the deleter does `DEL url:{code}` synchronously.
2. **L1 (in-process)** on every Redirect Service instance: published to a Redis pub/sub channel (`invalidate`); subscribers drop the key. Worst-case staleness = pubsub latency (~10-100ms) + L1 TTL.
3. **CDN edge cache**: hardest. CDN-level purge APIs exist (Fastly is fast; Cloudflare slower). Until purge propagates (~30s typical), the link still 301s. We accept this — soft delete with a `Cache-Control: no-cache` flip would be tighter but costs purge complexity. For most products, ~30s is acceptable for a delete to fully propagate.

Hard-deleted-but-still-cached links is *the* gotcha of CDN-fronted services. If exact-deletion-time-globally is mandatory: switch off CDN caching for the redirect (cost: 10× origin load).

### 13.18 Why is the API path `/v1/shorten` but the redirect path `/:code` (no version, no prefix)?

Two reasons:

1. **Length**: every char in the short URL is product cost. `https://sho.rt/v1/shorten/abc1234` is hostile to users. Bare `/abc1234` is the shortest possible.
2. **Versioning**: management APIs evolve (add fields, change semantics). The redirect path is **frozen by contract** — every short link in the wild assumes `https://sho.rt/<code>` works forever. Versioning the redirect path would break already-shared links.

Short link domain is often a separate domain from the API (`sho.rt` vs `api.sho.rt`) — keeps the short path clean and cleanly routed at DNS/LB.

---

## 14. Common Follow-Ups

### 14.1 Now add per-click analytics

Components added:

```
Redirect Service → Kafka(`clicks` topic, partitioned by short_code)
                       │
                       ▼
                 Click Aggregator (Flink)  ──────► Postgres (counter only)
                       │
                       ▼
                 ClickHouse (per-event)
                       │
                       ▼
                 Dashboard / Reporting API
```

Each click event:
```
{
  short_code, timestamp, ip_country, ua_family, referrer_domain,
  device_type, region, ts_minute_bucket
}
```

We do **not** store the raw IP in ClickHouse — strip to country at Redirect Service time (GDPR + storage). User-agent is parsed to family (Chrome / Safari / etc.), full UA dropped after parsing.

Querying: ClickHouse is columnar, optimized for `SELECT count(*) GROUP BY day FROM clicks WHERE short_code = ?`. Sub-second on billions of rows.

### 14.2 Now make it multi-region

Approaches:

**A. Active-active with eventual consistency.** Each region has a primary; writes replicate async. Reads always local. Conflict resolution: we have unique PKs (short_codes), and the counter is partitioned per region (region prefix in encoded ID), so collisions are impossible. Stale reads possible: a code created in Region A is invisible in Region B for ~5s. Acceptable; clients UX shows the local creation immediately.

**B. Active-passive with global writes.** All writes go to one region; reads local everywhere. Write latency from far regions is bad (~150ms × ~4 hops = ~600ms+). Used for systems where consistency >> latency. Not us.

We pick **(A) active-active**. Trade-off accepted: ~5s eventual consistency on writes globally; reads always local.

Counter partitioning: each region's counter range is `region_id << 50 | local_counter`. After base62 + shuffle, codes from different regions are indistinguishable. No coordination needed.

### 14.3 Now support custom domains

User says "I want my short links to be `acme.io/<code>` not `sho.rt/<code>`."

- Customer maps their domain (CNAME `acme.io` → `cname.sho.rt`).
- We provision TLS certs via ACME / Let's Encrypt (multi-tenant SAN / per-tenant — depends on volume).
- LB routes by `Host` header to the right tenant's link space.
- Tenant ID is derived from the `Host` header; lookup becomes `(tenant_id, short_code) → long_url`.
- Schema change: `short_code` is no longer globally unique — `(tenant_id, short_code)` is. Composite PK.

Most complex follow-up. A real product spends weeks on TLS automation alone.

### 14.4 What if shortener is part of a chat product (Slack-style auto-shorten)?

- Internal-only; auth is service-to-service.
- Per-workspace tenant — same shape as custom domains.
- Burst traffic when a long message is posted (bot pasted 1000 links).
- Requires bulk-shorten API: `POST /v1/shorten/batch` with up to 1000 URLs in a single request. Server batches the counter fetch and a single multi-row INSERT.

### 14.5 What if abuse spikes (1M shortens/sec from a botnet)?

- Edge rate-limit (Cloudflare) drops IPs over baseline.
- Captcha gates anonymous shorten.
- Auth required for sustained shortening (no anonymous over N/min).
- Per-account behavioral signals: a new account shortening 1000 phishing links → flag and throttle.
- Asynchronous abuse review — soft-quarantine suspicious links; show warning interstitial on redirect.

---

## 15. Cheat-Sheet Recap

1. **Problem:** Shorten long URLs; redirect short → long at internet scale. Read-heavy (~100:1).
2. **Scale:** 100M new/month, 40k peak QPS reads, 400 peak QPS writes.
3. **Hot path:** CDN → LB → Redirect Service → Redis → Postgres replica.
4. **Storage:** Postgres (Aurora) sharded by `short_code` when needed. ~360 GB/yr logical.
5. **Cache:** L1 in-process (10k LRU) + Redis (32GB ×N shards). ~99.5% combined hit rate.
6. **Consistency:** Strong intra-region; eventual cross-region (~5s); click counts ~60s stale.
7. **ID generation:** Counter + base62 with multiplicative shuffle for non-enumerability. Batched preallocation per instance.
8. **Biggest trade-off:** 301 (CDN-friendly, exact click count lost) vs 302 (every click counted). Default 301.
9. **Breaks at 100×:** Redis hot keys for viral links → mitigate with L1 + singleflight on misses.
10. **With more time:** Custom domains, link previews, abuse detection, fine-grained analytics.

---

## Appendix A: Numbers Cheat Sheet

```
62^7 ≈ 3.5 × 10^12 (≈ 27 years of issuance at 100M/month)
Birthday collision bound for 7-char base62: ≈ 1.9 × 10^6 random codes (start of trouble)

Postgres single primary: ~50k writes/s on commodity, ~200k reads/s
Redis single instance: ~100k ops/s (GET/SET), ~1M with pipelining
Kafka single broker: ~1M msg/s
CDN POP: effectively unlimited

Network RTT same DC: 0.5 ms
Network RTT cross-region: 80–150 ms
SSD random read: ~150 µs
RAM access: ~100 ns
```

## Appendix B: Failure-mode quick reference

```
CDN down          → 10× origin load, sized to absorb
Redis down        → fall through to DB; replicas absorb 5–10× normal QPS
Kafka down        → click events dropped; counts under-report
Postgres replica  → other replicas take over
Postgres primary  → multi-AZ failover ~30 s; writes 503 during
ID Gen counter    → instances burn batched IDs; 503 when buffer empty
```

## Appendix C: Things asked but rarely time for

- A/B testing redirects (percentage rollout to alternate URLs)
- Branded interstitials before redirect (compliance use case)
- Programmable redirects (rule-based by user-agent / country / time)
- Vanity reservations (auction high-value codes)
- API for partner platforms (ad networks need bulk APIs with SLA)
- IPv6 considerations (mostly: don't break)
- Compliance: SOC2, HIPAA-ready (data segregation, audit logs)

# [System Name] — High-Level Design

> **Difficulty:** [Easy / Medium / Hard]
> **Tags:** `[hld]` `[read-heavy or write-heavy]` `[domain-tag]` `[scaling-pattern]`
> **Prep time:** ~[N] min skim, ~[N] min deep read
> **Companies that ask this:** [Meta, Google, Amazon, Uber, ...]

---

## 0. How to use this doc in an interview

The first 5 minutes of any HLD interview are **scoping**. Don't dive into boxes-and-arrows. Walk the interviewer through:
1. Restate the problem in your own words.
2. Ask the **clarifying questions** below to narrow scope.
3. Lock down functional + non-functional requirements.
4. Do capacity estimation on the back of an envelope.
5. *Then* draw the high-level diagram.

Senior interviewers grade on **how you reason through trade-offs**, not memorized diagrams. The cross-questions section in this doc is where most of the points are won.

---

## 1. Problem Statement

[One paragraph. State what the system does in plain English, who its users are, and why it exists. Avoid implementation details here — those come later.]

Example shape: "Design a system that lets users [primary action]. The system should support [scale indicator] and prioritize [latency/availability/consistency]."

---

## 2. Clarifying Questions to Ask the Interviewer

Always ask these before starting. The answers shape everything downstream. **Do not assume.**

### Scope
- [ ] What's in scope vs out of scope? (e.g. is analytics in scope?)
- [ ] Are we designing the user-facing product or just a backend service?
- [ ] Mobile, web, both?

### Scale
- [ ] How many DAU / MAU?
- [ ] Read:write ratio?
- [ ] Peak QPS?
- [ ] Geographic distribution? (single region vs global)

### Functional
- [ ] [Domain-specific question 1]
- [ ] [Domain-specific question 2]
- [ ] [Domain-specific question 3]

### Non-functional
- [ ] Latency target? (P50, P99)
- [ ] Availability SLA? (99.9%? 99.99%?)
- [ ] Consistency requirement? (strong / eventual / read-your-writes)
- [ ] Durability — can we lose data on a single failure?

### Constraints
- [ ] Budget / hardware constraint?
- [ ] Existing tech stack to integrate with?
- [ ] Compliance? (GDPR, HIPAA, PCI)

> **Tip:** If the interviewer says "you decide" — pick the realistic answer for the company you're interviewing at and **state your assumption out loud**.

---

## 3. Functional Requirements

**Must-have (P0):**
1. [Capability 1]
2. [Capability 2]
3. [Capability 3]

**Should-have (P1):**
1. [Capability 4]
2. [Capability 5]

**Nice-to-have (P2 — out of scope for this design unless time permits):**
1. [Capability 6]
2. [Capability 7]

> Articulate explicitly what's NOT in scope. Saying "we're not designing X" prevents the interviewer from drilling there and saves time.

---

## 4. Non-Functional Requirements

| Dimension | Target | Justification |
|---|---|---|
| Availability | [99.9% / 99.99%] | [Why this number — user impact of outage] |
| Latency P99 | [Nms read, Nms write] | [User perception threshold for this domain] |
| Throughput | [N QPS sustained, N QPS peak] | [Derived from capacity estimation] |
| Consistency | [Strong / Eventual / Read-your-writes] | [Trade-off vs availability per CAP] |
| Durability | [N nines] | [Cost of data loss for this domain] |
| Scalability | [Horizontal — to N×] | [Expected growth curve] |
| Security | [Auth, encryption-at-rest, in-transit] | [Threat model] |

---

## 5. Capacity Estimation (Back-of-Envelope)

> **Show your math.** Interviewers want to see you reason, not pull a number out of the air.

### Users & Traffic
```
DAU                    = X million
Avg actions per user/d = Y
Total actions/day      = X * Y = Z
Peak factor            = 3x (typical)
Peak QPS               = (Z / 86400) * 3 = ___ QPS
```

### Read:Write Split
```
Reads             = R% of total
Writes            = W% of total
Read QPS (peak)   = ___
Write QPS (peak)  = ___
```

### Storage (per year)
```
Records/day       = ___
Bytes/record      = ___
Daily storage     = ___ GB
Annual storage    = ___ TB
With replication  = ___ TB (3x for 3 replicas)
With indexes/overhead = +30%
```

### Bandwidth
```
Read bandwidth    = read QPS * avg response size = ___ MB/s
Write bandwidth   = write QPS * avg request size = ___ MB/s
```

### Cache Sizing (80/20 rule)
```
80% of traffic hits 20% of data
Hot set size      = 0.20 * total_data = ___ GB
```

### Memory & Compute
```
Servers per ___ QPS based on assumed throughput per server.
```

> **Sanity check:** If your numbers don't make sense (e.g. you need 100k servers to serve 1M users), redo the math out loud — interviewer will catch you anyway.

---

## 6. API Design

### Public REST API (or gRPC if real-time)

```
POST   /v1/[resource]
       Headers: Authorization: Bearer <token>, Idempotency-Key: <uuid>
       Body:    { ... }
       Returns: 201 Created + { id, ... }
       Errors:  400 (validation), 401 (auth), 409 (idempotency conflict), 429 (rate limit)

GET    /v1/[resource]/{id}
       Returns: 200 + { ... } | 304 Not Modified (with ETag)
       Errors:  404, 401

PUT    /v1/[resource]/{id}
       Body:    { ... }
       Returns: 200 + { ... } | 412 (precondition failed)

DELETE /v1/[resource]/{id}
       Returns: 204 No Content
```

**Why REST and not GraphQL/gRPC?** [Justify based on use case — REST for public APIs and CDN cacheability, gRPC for internal service-to-service, GraphQL when clients need flexible field selection.]

**Idempotency:** Writes carry an `Idempotency-Key` header. Server stores `(key, response)` for 24h so retries return the original response without double-applying.

**Pagination:** Cursor-based (`?cursor=<opaque>&limit=50`), not offset-based. Why? Offset breaks under inserts/deletes during paging; cursor is stable.

**Versioning:** URL versioning (`/v1/`). Why not header-based? Easier to debug in browser, easier to route at the edge.

---

## 7. Data Model

### Choice: SQL vs NoSQL — Why [chosen one]

[State the choice. Reason from the access pattern, not "NoSQL is webscale". Concrete factors:
- Query shape: do we need JOINs / ad-hoc filtering?
- Transactions: do we need multi-row ACID?
- Schema stability: does it evolve quickly?
- Scale: read QPS, write QPS, total size
- Consistency: strong vs eventual]

### Tables / Collections

#### `[table_name]`
| Column | Type | Index | Note |
|---|---|---|---|
| id | UUID | PK | v7 (time-ordered) for hot-shard avoidance |
| user_id | UUID | secondary | FK to users |
| ... | ... | ... | ... |

**Why these indexes?**
- `(user_id, created_at DESC)` covers the timeline query — most-frequent access path.
- No index on `email` because we never query by email in the hot path.

**Sharding key:** `user_id`. Why? [Co-locates a user's data; queries hit one shard.]
**Sharding strategy:** Consistent hashing with virtual nodes (256 vnodes per physical). Why? Cluster resize moves only `1/N` of data.

---

## 8. High-Level Architecture

```
                      ┌─────────────────────────────┐
                      │           Clients           │
                      │  (web, mobile, third-party) │
                      └──────────────┬──────────────┘
                                     │ HTTPS
                                     ▼
                      ┌─────────────────────────────┐
                      │            CDN              │
                      │   (CloudFront / Cloudflare) │
                      └──────────────┬──────────────┘
                                     │
                                     ▼
                      ┌─────────────────────────────┐
                      │       Load Balancer         │
                      │     (L7, AWS ALB / Envoy)   │
                      └──────────────┬──────────────┘
                                     │
                ┌────────────────────┼────────────────────┐
                ▼                    ▼                    ▼
        ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
        │   API GW /   │    │  API GW /    │    │  API GW /    │
        │  App Server  │    │  App Server  │    │  App Server  │
        └──────┬───────┘    └──────┬───────┘    └──────┬───────┘
               │                   │                   │
               └─────────┬─────────┴─────────┬─────────┘
                         ▼                   ▼
                  ┌────────────┐      ┌────────────┐
                  │   Cache    │      │ Async Job  │
                  │  (Redis)   │      │ Queue (SQS)│
                  └─────┬──────┘      └─────┬──────┘
                        │                   │
                        ▼                   ▼
                  ┌────────────────────────────────┐
                  │     Primary DB (sharded)       │
                  │   (Postgres / Cassandra)       │
                  └─────────────┬──────────────────┘
                                │ async replication
                                ▼
                  ┌────────────────────────────────┐
                  │     Read replicas / DR         │
                  └────────────────────────────────┘
```

> Replace this with the system-specific diagram. Always label data flow direction with arrows.

---

## 9. Component Deep-Dives

### 9.1 [Component A]
- **Responsibility:** [What it does]
- **Tech choice:** [Specific technology + why]
- **Scaling:** [How it scales — vertical, horizontal, sharded by what]
- **Failure mode:** [What happens when it dies — failover, fallback, degradation]
- **Capacity:** [Sized for ___ QPS / ___ GB]

### 9.2 [Component B]
- **Responsibility:**
- **Tech choice:**
- **Scaling:**
- **Failure mode:**
- **Capacity:**

[... one section per major component]

---

## 10. Deep-Dives on the Hardest Sub-Problems

### 10.1 [Hard problem 1 — e.g. short-code generation]

**Approach options:**

| Approach | How | Pros | Cons | When to use |
|---|---|---|---|---|
| A | ... | ... | ... | ... |
| B | ... | ... | ... | ... |
| C | ... | ... | ... | ... |

**Chosen approach:** [X], because [reason tied to requirements].

**Detailed mechanics:**
[Pseudo-code or careful prose explaining exactly how the chosen approach works, including edge cases.]

### 10.2 [Hard problem 2]

[same shape]

---

## 11. Bottlenecks & How They Break Under Scale

| Load level | What breaks first | Fix |
|---|---|---|
| 10× current | DB CPU on hot shard | Add read replicas, vertical scale shard |
| 100× | Single-region DB latency | Multi-region replicas, geo-routing |
| 1000× | Cache fan-out, hot keys | Add L1 in-process cache, request coalescing |

For each: name the metric you'd watch (P99 DB latency, cache hit rate, queue depth) and the alert threshold.

---

## 12. Trade-offs Summary

| Decision | What we gained | What we gave up | Why it's the right call |
|---|---|---|---|
| Eventual consistency for X | Higher availability, lower latency | Stale reads possible for ~Nms | [Domain reason] |
| NoSQL for Y | Horizontal scale, schema flexibility | No JOINs, weaker transactional model | [Domain reason] |
| Async fan-out for Z | Smooth write throughput | Read latency on first access | [Domain reason] |

---

## 13. Cross-Questions ("Why X and not Y") — ≥ 15

The interviewer's job is to drill. These are the most common drilldowns for this question type. Each answer is 5–15 lines because shallow answers fail.

### 13.1 Why [chosen tech] and not [alternative]?
[5–15 line answer covering: what the alternative is, why it sounds appealing, what specifically goes wrong, when the alternative is actually right.]

### 13.2 Why [chosen approach] and not [alternative]?
[answer]

### 13.3 …

[Repeat for ≥ 15 cross-questions. Patterns to cover:
- SQL vs NoSQL choice
- Sync vs async
- Push vs pull
- Cache strategy (write-through, write-back, write-around)
- Sharding key choice
- Replication strategy
- CAP trade-off taken
- Why this many replicas / shards
- Why this consistency model
- How you'd handle hot keys
- How you'd handle a thundering herd
- How you'd handle a cache stampede after a cold start
- How you'd handle a region outage
- Backpressure strategy
- Why this cache eviction policy
- Why this rate limiter
- Schema evolution / migration plan
- Why these indexes
- Why these specific timeouts / retries
]

---

## 14. Common Follow-Up Scenarios

The interviewer often pivots after you finish the base design. Be ready for:

### 14.1 "Now add [analytics / reporting / monitoring]"
[Show how the design changes — typically: tap the write path with Kafka/Kinesis, route to OLAP store (Redshift/BigQuery/ClickHouse), surface in dashboard.]

### 14.2 "Now make it multi-region"
[Show: read-local/write-global vs active-active, conflict resolution (LWW vs CRDTs vs application logic), what increases latency, what new failure modes appear.]

### 14.3 "Now handle GDPR / right to be forgotten"
[Show: tombstone vs hard delete, propagation across replicas/caches/backups/derived stores, audit trail.]

### 14.4 "What if [primary use case] grew 100×?"
[Walk through bottleneck table; show what you'd change.]

---

## 15. Cheat-Sheet Recap (final-minute summary)

> If you only have 60 seconds left, recite this:

1. **Problem:** [One sentence]
2. **Scale:** [Peak QPS, total storage]
3. **Hot path:** [Component flow in 5 nouns]
4. **Storage choice:** [DB] sharded by [key]
5. **Cache:** [Strategy + tier]
6. **Consistency:** [Model + why]
7. **Hardest sub-problem solved:** [Approach]
8. **Biggest trade-off:** [Decision + cost]
9. **What breaks at 10×:** [Component + fix]
10. **What I'd add with more time:** [Capability]

---

## Appendix A: Numbers worth memorizing

```
1 KB  = 10^3 B          1 ms   = 10^-3 s
1 MB  = 10^6 B          1 µs   = 10^-6 s
1 GB  = 10^9 B          L1 cache    ~0.5 ns
1 TB  = 10^12 B         L2 cache    ~7 ns
1 PB  = 10^15 B         RAM access  ~100 ns
                        SSD read    ~150 µs
86400 s/day             HDD seek    ~10 ms
~3M s/month (rough)     Network RTT same DC  ~0.5 ms
~30M s/year (rough)     Network RTT cross-region ~150 ms
                        Disk seq read 1MB    ~25 ms (HDD), ~1 ms (SSD)
1 server ~= 1000–10000 QPS depending on workload
```

## Appendix B: Common QPS-to-server math

```
~10k QPS per modern server at moderate CPU work
~100k QPS per Redis instance for simple GET/SET
~50k writes/s per Postgres primary on commodity hardware
~1M+ msg/s per Kafka broker
```

# How to Approach a System Design Problem

> **Type:** Guide
> **Read this:** before attempting any [HLD problem](../HLD/twitter-news-feed.md) — it's the framework every page on this site follows.

---

## Why you need a framework

The fastest way to fail a system design interview is to start drawing boxes. Without a method you'll forget to scope, your numbers won't drive anything, and you'll rabbit-hole on one component while ignoring the system. A framework gives you a **repeatable order of operations** so you cover what matters and stay in control of the conversation. The seven steps below are the spine of every HLD page on this site.

> **Time budget (45-min interview):** Requirements ~5 min · Estimation ~5 min · API + Data model ~7 min · High-level design ~10 min · Deep dives ~13 min · Bottlenecks/wrap-up ~5 min. Don't spend 20 minutes on requirements.

## Step 1 — Clarify requirements (functional)

Never design the problem you *assume*; design the one you *confirm*. Ask what the system must do and pin down scope:

- What are the **core features**? Drive the interviewer to a small P0 set — you can't design everything.
- Who are the **users** and what are the main **flows**?
- What's explicitly **out of scope**? (Say it out loud — it shows judgment.)

Write the P0 features down. Example (URL shortener): "shorten a URL," "redirect a short URL," "custom aliases (P1)," "analytics (P2)." This is the [functional requirements](01-what-is-system-design.md) list.

## Step 2 — Define non-functional requirements (the architecture drivers)

This is where the design is actually decided. Nail down:

- **Scale** — how many users, requests/sec, reads vs writes ratio, data volume?
- **Latency** — how fast must each operation feel? (e.g. redirect < 100ms)
- **Availability** — 99.9%? 99.99%? What's the cost of downtime?
- **Consistency** — does every read need the latest write, or is staleness OK? (Per-feature — see [CAP](../DeepDives/Coordination/cap-and-consistency-models.md).)
- **Durability** — can we ever lose data?

State the **read/write ratio** explicitly — it's the single most design-shaping number. A 100:1 read-heavy system screams caching and read replicas; a write-heavy one screams [LSM stores](../DeepDives/Databases/storage-engines-lsm-vs-btree.md) and sharding.

## Step 3 — Estimate scale (back-of-the-envelope)

Numbers must **drive decisions**, not decorate the whiteboard. Estimate:

- **QPS** — daily active users × actions/user ÷ 86,400, then × a peak factor (2–10×).
- **Storage** — items/day × size/item × retention; project for years.
- **Bandwidth** — QPS × payload size.
- **Memory** — what fits in cache? (working set for the hit rate you want)

Then **let the numbers decide**: "5 TB/year and 100k writes/sec → one database won't hold it → we shard." Round aggressively; the interviewer wants the reasoning and the order of magnitude, not arithmetic precision.

```
Useful constants:  1 day ≈ 86,400 s ≈ 10^5 s
                   1M writes/day ≈ 12/s   |   1B/day ≈ 12k/s
                   peak ≈ 2–10× average
```

## Step 4 — Design the API (the contract)

Define the interface between client and system before internals — it forces clarity on *what* the system offers and surfaces data needs. A few endpoints, with the key parameters:

```
POST /urls            {long_url, custom_alias?}  -> {short_url}
GET  /{short_code}                               -> 302 redirect
```

Pick a style deliberately — REST / gRPC / GraphQL — per the caller (see [api-design](../DeepDives/Networking/api-design-rest-grpc-graphql.md)). Mention pagination, auth, and **idempotency** for writes where it matters.

## Step 5 — Design the data model

What entities, what relationships, and — critically — **which database type and why**:

- Entities, keys, and access patterns (you model around the queries, especially for NoSQL).
- **SQL vs NoSQL** justified by the access pattern, not habit (see [picking-the-right-database](../DeepDives/Databases/picking-the-right-database.md)).
- The **partition/shard key** if sharded — the highest-leverage choice ([sharding](../DeepDives/Distribution/sharding-partitioning.md)).

## Step 6 — Draw the high-level architecture

*Now* draw boxes. Sketch the request flow through the components, justifying each:

```
Client → LB → App servers → Cache → DB
                   │
                   └→ Queue → Workers → (async work, e.g. analytics)
```

Walk the **main flows** end to end (the write path and the read path). Add a [load balancer](../DeepDives/Networking/load-balancers.md), [cache](../DeepDives/Caching/caching-strategies.md), [queue](../DeepDives/Messaging/queues-vs-streams.md) only where a requirement justifies it. Keep app servers **stateless** so they scale horizontally.

## Step 7 — Identify bottlenecks and deep-dive

A senior signal: proactively find what breaks first and address it. Common ones and their levers:

- **Single DB can't handle reads** → read replicas + cache.
- **Single DB can't handle writes/storage** → shard.
- **Hot key / celebrity** → replicate/split the hot key, local cache.
- **Single points of failure** → redundancy, failover ([resiliency](../DeepDives/Resiliency/designing-for-resiliency.md)).
- **Slow synchronous work** → make it async via a queue.

Then go **deep on the 1–2 hardest sub-problems** — the ones unique to *this* problem (fan-out for a feed, consistency for a booking, ranking for search). Depth here is what separates strong candidates.

## The order matters

```
Requirements → NFRs → Estimation → API → Data model → High-level → Deep-dive bottlenecks
   (what)       (how well)  (numbers)  (contract)  (storage)   (boxes)     (the hard parts)
```

Each step feeds the next: requirements bound scope, NFRs + estimates decide the architecture, the architecture reveals bottlenecks, and the deep-dives prove you can handle them. Skipping ahead (boxes before numbers) is the classic mistake.

## Anti-patterns to avoid

- **Jumping to architecture** before scoping/estimating — you'll design the wrong system.
- **Numbers as decoration** — if your estimate didn't change a decision, you wasted the step.
- **Over-engineering** — microservices/Kafka/sharding for a problem that fits one box. Justify complexity with a number.
- **Rabbit-holing** — 20 minutes on the API while the core data flow is undefined. Manage the clock.
- **Naming tech without trade-offs** — "I'll use Cassandra" without *why* and *what you gave up* is hollow.
- **Going silent** — think out loud; it's a collaborative discussion, not an exam you submit at the end.
- **Ignoring failure** — "what if this server dies?" should be answered before they ask.

## How to use this site

Every [HLD problem](../HLD/uber.md) here is structured on exactly this framework (Problem → Clarifying Qs → Functional → Non-functional → Estimation → API → Data Model → Architecture → Deep-dives → Cross-questions → Trade-offs). Read [what-makes-a-good-system](03-what-makes-a-good-system.md) next to internalize the NFRs that drive step 2.

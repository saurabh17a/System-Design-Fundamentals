# What Is System Design?

> **Type:** Guide
> **Read this:** first — it frames every [HLD problem](../HLD/url-shortener.md) and [Deep Dive](../DeepDives/Caching/redis.md) on this site.

---

## The one-sentence definition

System design is **deciding how to arrange servers, databases, caches, queues, and networks so that a software product meets its requirements at scale** — and being able to defend each decision against the alternatives.

Coding interviews ask "can you make one machine do the right thing?" System design asks "can you make **thousands** of machines do the right thing **together**, when some of them are slow, some are dead, and a few million users show up at once?" The skill is not memorizing architectures — it's **reasoning about trade-offs under constraints**.

## Why it exists: the problems of scale

A single server with a single database is the right answer for a surprising number of products. System design becomes necessary when one or more of these breaks:

- **Too much traffic** for one machine → you need multiple servers behind a [load balancer](../DeepDives/Networking/load-balancers.md).
- **Too much data** for one database → you need [replication](../DeepDives/Distribution/replication.md) and [sharding](../DeepDives/Distribution/sharding-partitioning.md).
- **Too slow** for users → you need [caching](../DeepDives/Caching/caching-strategies.md) and [CDNs](../DeepDives/Caching/cdn.md).
- **Things fail** (they always do at scale) → you need [redundancy and resiliency](../DeepDives/Resiliency/designing-for-resiliency.md).
- **Work takes too long to do synchronously** → you need [queues and async processing](../DeepDives/Messaging/asynchronous-processing.md).

Every component on this site exists to solve one of those five pressures. When you learn a technology, anchor it to the pressure it relieves.

## Functional vs non-functional requirements

The single most important distinction in the whole discipline:

- **Functional requirements** — *what the system does.* "Users can post a tweet." "A short URL redirects to the original." These define correctness.
- **Non-functional requirements (NFRs)** — *how well it does it.* Scale, latency, availability, consistency, durability, cost. These define the **architecture**.

Here's the insight beginners miss: **the functional requirements of Twitter and a toy Twitter clone are nearly identical** (post, follow, see a feed). It's the *non-functional* requirements — 200M users, sub-300ms feeds, 99.99% uptime — that force fan-out services, Redis timelines, and the celebrity-problem handling. **NFRs are where the design lives.** See [what-makes-a-good-system](03-what-makes-a-good-system.md).

## The vocabulary of trade-offs

System design has no "correct" answers, only **trade-offs you can justify**. The recurring axes:

- **Latency vs throughput** — fast per request vs many requests per second.
- **Consistency vs availability** — every read sees the latest write vs the system always answers (see [CAP](../DeepDives/Coordination/cap-and-consistency-models.md)).
- **Strong vs eventual consistency** — correctness now vs converge-soon-and-cheaper.
- **Read-optimized vs write-optimized** — e.g. [B-tree vs LSM](../DeepDives/Databases/storage-engines-lsm-vs-btree.md).
- **Normalization vs denormalization** — no duplication (joins) vs fast reads (duplication).
- **Simplicity vs scalability** — don't pay for scale you don't have yet.

A strong answer sounds like *"I'll use X, which gives us A at the cost of B; I'm accepting B because this path is read-heavy / latency-sensitive / can tolerate staleness."* A weak answer just names technologies.

## What a system design interview is actually testing

It's a proxy for "can we trust you to make architectural decisions on our team?" Interviewers look for:

1. **Requirements first** — do you scope before you build, or jump to drawing boxes?
2. **Structured thinking** — do you have a method, or wander? (See [how-to-approach](02-how-to-approach.md).)
3. **Justified trade-offs** — can you say *why* X over Y, and what you gave up?
4. **Scale awareness** — do your numbers drive your design (estimation), or are they decoration?
5. **Identifying bottlenecks** — do you find the part that breaks first and address it?
6. **Communication** — can you lead the discussion and respond to push-back without getting defensive?

Notice what's *not* on the list: knowing the "right" architecture, or memorizing how Twitter really works. There isn't one right architecture; there's the one you can defend for the requirements you scoped.

## How the pieces fit together

A mental map of the layers you'll compose:

```
Client → DNS → CDN → Load Balancer → App servers (stateless)
                                          │
            ┌─────────────────────────────┼───────────────────────────┐
            ▼                              ▼                            ▼
        Cache (Redis)               Databases (SQL/NoSQL)         Message queue / stream
                                    (replicated, sharded)         (async work, events)
            ▲                              ▲                            │
            └────────── object storage (blobs) ◄──────────── workers ◄─┘
```

Requests flow left to right; the architecture is about *which* of these you need, *how many*, and *how they coordinate when things go wrong.* The rest of this site fills in each box. Start with [how to approach a design](02-how-to-approach.md).

## Common misconceptions

- **"There's a correct answer to memorize."** No — there are defensible answers for given requirements. Memorized architectures collapse under follow-up questions.
- **"Use every cool technology."** Over-engineering is a red flag. The best answer is the *simplest* one that meets the NFRs; add complexity only when a number forces it.
- **"Start by drawing boxes."** Start by **scoping requirements and estimating scale** — they decide what boxes you even need.
- **"Bigger is better."** Vertical scaling, a single well-chosen database, and a cache solve more than candidates think. Reach for distributed complexity when justified, not by reflex.

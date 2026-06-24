# Deep Dives — Core Technologies & Concepts Section

**Date:** 2026-06-24
**Status:** Approved

## Goal

Add a new top-level **"Deep Dives"** section to the system-design knowledge base:
~20 interview-grade reference pages on the core technologies and distributed-systems
concepts that HLD answers lean on (Kafka, Redis, SQL, consensus, sharding, etc.).
These are *reference* pages ("know your tools"), distinct from the existing HLD
*problem* pages ("design X").

## Locked decisions

- **Section name:** "Deep Dives" (top-level, alongside Foundations / LLD / Machine Coding / HLD).
- **Placement:** sidebar tier `4` — immediately after HLD (it's the reference layer HLD relies on).
- **Depth:** interview-grade deep (modeled on the existing `url-shortener.md` long-form pages),
  not cheat-sheet.
- **Examples:** native to each technology — `redis-cli`, SQL, Kafka config/CLI, ASCII
  diagrams. Language-agnostic; no forced Go/Python client code.
- **No content scraping.** All pages are original prose written from scratch. The
  request to fetch HelloInterview premium/paywalled content was declined (paywall
  circumvention + copyright); this section replaces that idea with owned content.
- **No duplication.** Rate limiting and bloom filters already exist (HLD / Machine
  Coding) — cross-link, do not re-document.

## Format

Docs derive their sidebar label from the filename via `src/lib/docs.ts`
(`prettifyLabel`). For most pages that is fine and **no frontmatter is needed**
(consistent with the rest of the site). But a few filenames prettify into awkward
labels (e.g. `api-design-rest-grpc-graphql` → "Api Design Rest Grpc Graphql",
`cap-and-consistency-models` → "Cap And Consistency Models"). For those pages we
add a minimal `title:` frontmatter (the content schema already supports optional
`title`/`description`) to give a clean sidebar label, e.g.:

```
---
title: API Design (REST · gRPC · GraphQL)
---
```

Pages getting an explicit `title`: `cap-and-consistency-models`,
`api-design-rest-grpc-graphql`, `realtime-websockets-sse`,
`storage-engines-lsm-vs-btree`, `queues-vs-streams`, `consensus-raft-paxos`,
`zookeeper-etcd`. The rest rely on the derived label.

Each page opens with an `# H1` and an adapted blockquote header — the HLD
"Companies that ask this" line does not fit a tech reference, so we use:

```
# Redis — Deep Dive

> **Type:** Core technology
> **Tags:** `[cache]` `[in-memory]` `[data-structures]`
> **Where it shows up:** distributed-cache, gaming-leaderboard, rate-limiter

---
```

Internal cross-links use relative `.md` paths (e.g. `[distributed-cache](../../HLD/distributed-cache.md)`),
consistent with the rest of the site and the `rewriteMdLinks` rehype plugin.

### Per-page content spine

Every page follows the same arc, scaled to the topic:

1. **Mental model** — the one-paragraph "what it really is" framing.
2. **Internals** — how it works under the hood (the part interviewers probe).
3. **Tradeoffs & decisions** — the knobs and what choosing each costs.
4. **When to use / when not** — and what to reach for instead.
5. **Common interview follow-ups** — the questions that come after "we'll use X."
6. **Gotchas** — failure modes and footguns.

Cross-links to the relevant HLD problem pages appear inline so the section
reinforces the existing knowledge base.

## Curriculum (20 pages, grouped into sidebar subsections)

Directory: `src/content/docs/DeepDives/<Group>/<page>.md`

| Group (folder) | Pages |
|---|---|
| **Databases** (`Databases/`) | `sql-relational` · `nosql-cassandra` · `storage-engines-lsm-vs-btree` · `object-blob-storage` |
| **Caching** (`Caching/`) | `redis` · `caching-strategies` · `cdn` |
| **Messaging** (`Messaging/`) | `kafka` · `queues-vs-streams` |
| **Coordination** (`Coordination/`) | `cap-and-consistency-models` · `consensus-raft-paxos` · `zookeeper-etcd` |
| **Distribution** (`Distribution/`) | `consistent-hashing` · `sharding-partitioning` · `replication` |
| **Search** (`Search/`) | `elasticsearch` |
| **Networking** (`Networking/`) | `load-balancers` · `dns` · `api-design-rest-grpc-graphql` · `realtime-websockets-sse` |

### Per-page scope notes

- **sql-relational** — ACID, transactions, isolation levels (read-committed →
  serializable, anomalies each prevents), B-tree indexing & query planning,
  normalization vs denormalization, when relational wins.
- **nosql-cassandra** — wide-column model, partition vs clustering keys, tunable
  consistency (R+W>N), gossip/ring, write path (commit log → memtable → SSTable).
- **storage-engines-lsm-vs-btree** — LSM (write-optimized, compaction) vs B-tree
  (read-optimized); which databases use which and why.
- **object-blob-storage** — S3 object model, when blob storage beats a DB,
  presigned URLs, durability/consistency model.
- **redis** — data structures, RDB vs AOF persistence, eviction policies,
  replication & Redis Cluster, single-threaded model, hot keys, when *not* to use.
- **caching-strategies** — cache-aside / read-through / write-through / write-back,
  invalidation, TTL, thundering herd, cache stampede, hot-key mitigation.
- **cdn** — edge caching, cache keys, push vs pull, invalidation, TLS termination.
- **kafka** — the log abstraction, partitions & ordering, consumer groups & offsets,
  replication/ISR, delivery semantics (at-least/at-most/exactly-once), retention,
  backpressure.
- **queues-vs-streams** — RabbitMQ/SQS (queue, competing consumers, ack) vs Kafka
  (log, replayable); delivery semantics; choosing between them.
- **cap-and-consistency-models** — CAP precisely stated, PACELC, linearizable →
  sequential → causal → eventual, read-your-writes / monotonic reads.
- **consensus-raft-paxos** — why consensus, leader election, log replication, quorum,
  Raft vs (Multi-)Paxos at a usable level.
- **zookeeper-etcd** — coordination primitives (config, leader election, distributed
  locks, service discovery), znodes/leases, when you actually need one.
- **consistent-hashing** — the ring, virtual nodes, rebalancing on add/remove,
  bounded-load variant; where it's used (caches, Cassandra, Dynamo).
- **sharding-partitioning** — range vs hash vs directory, hot spots, resharding,
  cross-shard joins/transactions.
- **replication** — leader-follower, multi-leader, leaderless/quorum, sync vs async,
  read replicas, replication lag, failover.
- **elasticsearch** — inverted index, analyzers/tokenization, shards & replicas,
  relevance scoring, when search engine beats `LIKE`.
- **load-balancers** — L4 vs L7, algorithms (RR, least-conn, hashing), health checks,
  sticky sessions, LB as SPOF and how to avoid it.
- **dns** — resolution flow, records, TTL, geo/latency-based routing, DNS in scaling
  & failover.
- **api-design-rest-grpc-graphql** — REST vs gRPC vs GraphQL tradeoffs, when each,
  versioning, pagination, idempotency.
- **realtime-websockets-sse** — long-polling vs SSE vs WebSockets, connection
  management at scale, when each fits.

## Sidebar wiring (`src/lib/docs.ts`)

Two kinds of edits, no logic changes:

1. `DIR_LABELS` — add:
   `deepdives: 'Deep Dives'`, `databases: 'Databases'`, `caching: 'Caching'`,
   `messaging: 'Messaging'`, `coordination: 'Coordination'`, `distribution: 'Distribution'`,
   `search: 'Search'`, `networking: 'Networking'`.
2. `ORDER` — add `deepdives: 4` (top-level tier, after HLD's `3`) and ordering keys
   for the subgroups so they render in the curriculum order above
   (databases, caching, messaging, coordination, distribution, search, networking).
3. `ACRONYMS` — `sql`, `dns`, `http`, `cdn` already present. Add any new ones that
   appear in filenames (e.g. `lsm`, `btree` are not acronyms; `rest`, `grpc`,
   `graphql`, `sse` render fine via prettifyLabel — verify, add only if needed).

## Rollout — 3 waves, review gate after Wave 1

- **Wave 1 (explicit asks + 2 anchors):** `sql-relational`, `redis`, `kafka`,
  `cap-and-consistency-models`, `consistent-hashing`.
  **→ User reviews format/depth before Wave 2.**
- **Wave 2:** `caching-strategies`, `cdn`, `nosql-cassandra`, `sharding-partitioning`,
  `replication`, `load-balancers`, `dns`, `api-design-rest-grpc-graphql`,
  `realtime-websockets-sse`.
- **Wave 3:** `consensus-raft-paxos`, `zookeeper-etcd`, `elasticsearch`,
  `storage-engines-lsm-vs-btree`, `object-blob-storage`, `queues-vs-streams`.

## Success criteria

- New "Deep Dives" section appears in the sidebar after HLD, with the 7 subgroups
  in curriculum order.
- `npm run build` (Astro) succeeds with no broken internal links.
- Wave 1 pages render correctly (dark/light code themes, cross-links resolve to
  HLD pages) and match the agreed format.
- Each page follows the 6-part content spine with native examples.

## Out of scope

- Scraping or reproducing any third-party (e.g. HelloInterview) content.
- Go/Python client-code tracks for these topics (native examples only).
- Re-documenting rate limiting and bloom filters (cross-link existing pages).

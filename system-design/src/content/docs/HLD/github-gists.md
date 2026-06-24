# GitHub Gists / Pastebin — High-Level Design

> **Difficulty:** Easy → Medium
> **Tags:** `[hld]` `[read-heavy]` `[blob-storage]` `[id-generation]` `[caching]` `[cdn]`
> **Prep time:** ~10 min skim, ~30 min deep read
> **Companies that ask this:** GitHub, Atlassian, Amazon, and as a warm-up at most infra interviews

---

## Beginner's Guide

### What's this in plain English?

You paste a snippet of code or text, hit "create," and get a short URL like `gist.example.com/aZ4x9`. Anyone with that link sees your snippet (with syntax highlighting). That's a **Gist** (GitHub) or **Pastebin**. The system stores blobs of text and serves them back fast by a short id.

### Why solve it?

- **Real world**: GitHub Gists, Pastebin, JSFiddle, hastebin.
- **Teaches**: short **ID generation**, **read-heavy** design, **blob storage** vs DB, caching/CDN, expiration. It's a close cousin of the [URL shortener](url-shortener.md) — the canonical warm-up.

### Vocabulary

- **Gist / paste** — a stored text blob, possibly multi-file.
- **Slug / id** — the short code in the URL.
- **Visibility** — public (listed/searchable) vs secret/unlisted (link-only) vs private (auth-only).
- **TTL** — optional expiry ("burn after a day").

### High-level architecture

```
Create:  Client → API → store metadata (DB) + content (blob store) → return short id
Read:    Client → CDN → API → cache → blob store + metadata → render (highlight)
```

Reads dwarf writes (one create, many views), so the whole design optimizes the read path with caching and a CDN.

### How to read this doc

- **Beginner**: focus on id generation + read path.
- **Interview**: cross-questions on id collisions, blob-vs-DB storage, secret gists, expiry.

---

## 0. How to use this doc in an interview

This is a **warm-up** that rewards clean fundamentals: short-id generation without collisions, **separating metadata (DB) from content (blob storage)**, and a read-optimized path (cache + CDN). The trap is over-engineering — it's read-heavy and largely static; don't reach for Kafka and sharding before justifying them with numbers. Show you can scope, estimate, and pick boring-correct technology.

---

## 1. Problem Statement

Let users create text/code snippets and retrieve them by a short URL:
- Create a gist (one or more files of text).
- Retrieve and render it (syntax highlighting) by id.
- Visibility: public / secret (unlisted) / private.
- Optional expiration.
- (P1) Edit, version history, comments, list-my-gists.

---

## 2. Clarifying Questions

- [ ] Max content size? (assume ~10 MB/gist, multi-file)
- [ ] Public listing/search, or link-only? (assume both visibilities)
- [ ] Editable/versioned, or immutable? (assume immutable for v1, versioning P1)
- [ ] Expiry/TTL? (assume optional)
- [ ] Auth required to create? (assume anonymous allowed + logged-in)
- [ ] Read:write ratio + scale?

> **Assume:** immutable snippets, 3 visibilities, optional TTL, anon + auth create, very read-heavy.

---

## 3. Functional Requirements

**P0:**
1. Create a gist → returns a short, unique id/URL.
2. Read a gist by id (raw + rendered/highlighted).
3. Visibility: public, secret (link-only), private (owner-only).
4. Optional TTL.

**P1:**
5. Edit + version history.
6. List a user's gists; public discovery/search.
7. Comments / stars.

**P2:**
8. Forking; embeds; diff between versions.

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Availability | 99.9%+ (read path especially) |
| Read latency | < 100 ms (cached/CDN) |
| Write latency | < 300 ms |
| Read:write | ~100:1 (read-heavy) |
| Durability | High — don't lose snippets |
| Consistency | Read-your-writes on create; eventual elsewhere is fine |

---

## 5. Capacity Estimation

```
New gists:        10M/day      ≈ 115/sec  (peak ~1k/sec)
Reads:            1B/day       ≈ 12k/sec  (peak ~50k/sec)  → 100:1 read-heavy
Avg gist size:    ~10 KB (most small; cap large ones)
Storage/day:      10M × 10 KB  = 100 GB/day  → ~36 TB/year
Metadata/gist:    ~200 bytes   → ~2 GB/day metadata
```

**Bottleneck:** read throughput on hot gists, and total content storage growth. → cache + CDN for reads; blob storage for content.

---

## 6. API

```
POST /gists            {files:[{name,content}], visibility, ttl?}   -> {id, url}
GET  /gists/{id}                                                    -> {files, meta}  (or 302 to raw)
GET  /gists/{id}/raw/{file}                                         -> text/plain
GET  /users/{u}/gists  ?cursor=                                     -> public gists (paginated)
PUT  /gists/{id}       {files}            (P1: new version, auth)
DELETE /gists/{id}                         (auth, owner)
```

Cursor (keyset) pagination for listings; `Idempotency-Key` optional on create.

---

## 7. Data Model

### Metadata — relational (Postgres)
```
gists(id PK, owner_id?, visibility, created_at, expires_at?, content_ref, current_version)
gist_files(gist_id, file_name, content_ref, language, size)
versions(gist_id, version, content_ref, created_at)     -- P1
```

### Content — object/blob storage (S3)
- The actual text lives in [object storage](../DeepDives/Databases/object-blob-storage.md) under a key (`content_ref`), **not** in the DB. The DB row holds the pointer. Keeps the DB small/fast; storage is cheap and durable.
- Small snippets *could* live inline in the DB, but blob storage is the clean, scalable default and what interviewers expect for "store the content."

### Why split metadata (SQL) and content (blob)?
- Metadata is small, queried/filtered (by owner, visibility, time) → relational fits.
- Content is large, immutable, served whole → [blob storage](../DeepDives/Databases/object-blob-storage.md) + [CDN](../DeepDives/Caching/cdn.md). See [picking-the-right-database](../DeepDives/Databases/picking-the-right-database.md).

---

## 8. Architecture

```
                         ┌─────────┐
            Create ──────►│   API   │
                          │ - id gen│
                          │ - meta→DB
                          │ - blob→S3
                          └────┬────┘
                               │
              ┌────────────────┼───────────────┐
              ▼                ▼                ▼
        ┌──────────┐    ┌────────────┐   ┌──────────┐
        │ Postgres │    │  S3 (blobs)│   │  Redis   │
        │ (metadata)│   │  content   │   │  cache   │
        └──────────┘    └────────────┘   └──────────┘

   Read ── CDN ── API ── Redis (hit?) ── S3 + Postgres ── render/highlight
```

- **Create:** validate → generate id → write blob to S3 → write metadata to DB → return URL.
- **Read:** CDN first (public, immutable content is highly cacheable) → API → Redis cache → S3/DB on miss → syntax-highlight (server or client) → cache.

---

## 9. Component Deep-Dives

### 9.1 ID generation (the core sub-problem)
Need short, unique, hard-to-guess ids. Options:
- **Random base62 (e.g. 8 chars)** — 62⁸ ≈ 2×10¹⁴ space; generate, check-and-insert (rely on DB unique constraint to catch the rare collision and retry). Simple; ids unguessable (good for secret gists). **Recommended.**
- **Counter + base62 encode** — a global/sharded counter encoded to base62; no collisions, but **sequential ids are guessable/enumerable** → bad for secret gists. Need a [unique id service](../DeepDives/Distribution/sharding-partitioning.md) (e.g. Snowflake/ranged allocation) to avoid a single bottleneck.
- **Hash of content** — dedups identical pastes, but identical content → same id leaks/links unrelated users; usually avoid.

Trade-off: random (unguessable, tiny collision-retry cost) vs counter (no collisions, but enumerable). For gists with secret visibility, **random wins.**

### 9.2 Read path / caching
- Content is **immutable** → ideal for aggressive caching. Public gists: cache at the [CDN](../DeepDives/Caching/cdn.md) with long TTL (immutable, so no invalidation needed). Hot gists: [Redis](../DeepDives/Caching/redis.md) in front of S3/DB.
- Secret/private gists: don't cache at shared CDN edges as public; mark `private`/`no-store` or cache per-auth. See [caching-strategies](../DeepDives/Caching/caching-strategies.md).

### 9.3 Visibility & access control
- **Public:** listed, indexable, CDN-cached.
- **Secret/unlisted:** unguessable id is the "security" (link-only); not listed/searchable.
- **Private:** auth check on every read; not cached publicly.

### 9.4 Expiry / TTL
- Store `expires_at`; a read past it returns 404. A background job (or object-store lifecycle rule) reclaims expired blobs. Lazy delete on read is fine too.

### 9.5 Syntax highlighting
- Detect language; highlight. Do it **server-side once and cache** the rendered HTML, or **client-side** (ship raw + a JS highlighter) to keep servers stateless and offload work. Client-side scales better.

---

## 10. Hard Sub-Problems

### 10.1 Avoiding id collisions at scale
- Random base62 + DB unique constraint + retry-on-conflict. At 10M/day the collision rate in a 62⁸ space is negligible; the constraint guarantees correctness even so.

### 10.2 Hot gist (a viral paste)
- One gist gets millions of views → [hot key](../DeepDives/Caching/redis.md). CDN absorbs most; Redis + local caching for the rest. Immutability makes this easy (no invalidation).

### 10.3 Large pastes
- Cap size; stream large content to/from S3 (don't buffer 10 MB in app memory); use [presigned URLs](../DeepDives/Databases/object-blob-storage.md) for direct upload/download to offload bandwidth.

### 10.4 Abuse (malware, spam, illegal content)
- Rate-limit creates ([rate-limiter](rate-limiter.md)); scan/flag content; report + takedown pipeline. Anonymous create needs abuse controls.

---

## 11. Cross-Questions

### 11.1 Why blob storage for content, not the DB?
Content is large and immutable; blobs in the DB bloat it and kill its cache. DB holds metadata + an S3 pointer.

### 11.2 Random ids vs sequential counter?
Random = unguessable (needed for secret gists) at the cost of rare collision-retries; counter = no collisions but enumerable (leaks secret gists) and needs a distributed id service.

### 11.3 Why is this so read-optimized?
~100:1 read:write, and content is immutable → CDN + cache serve almost everything; the origin sees a trickle.

### 11.4 SQL or NoSQL for metadata?
Modest volume, relational queries (by owner/visibility/time) → Postgres is plenty. NoSQL only if scale demands; don't over-engineer.

### 11.5 How do secret gists stay secret?
Unguessable id (link-only), not listed/searchable, `no-store` at shared caches. True private = auth check per read.

### 11.6 How do you handle edits/versions? (P1)
Immutable blobs per version; metadata points at `current_version`; keep a `versions` table. Never mutate a blob — write a new one.

### 11.7 What about expiry?
`expires_at` + lazy 404 + background/lifecycle cleanup of blobs.

### 11.8 How do you prevent abuse?
Rate-limit creation, content scanning/flagging, takedown workflow, captchas for anon.

### 11.9 Why a CDN if you already cache in Redis?
CDN serves from the edge (near the user, lower latency) and offloads the origin entirely for public immutable content.

### 11.10 Multi-region?
Content in geo-replicated object storage + CDN; metadata DB with read replicas per region; writes to a primary region (read-your-writes via primary on create).

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| Blob storage for content | Cheap, durable, scalable; small DB | Extra hop; not queryable |
| Random base62 ids | Unguessable, simple | Rare collision retries |
| CDN + immutable content | Fast reads, origin offload | Stale only if you re-use ids (don't) |
| Client-side highlighting | Stateless servers, less CPU | Ships raw + JS to client |
| SQL metadata | Simple, queryable | Must shard if it ever gets huge |

---

## 13. Cheat-Sheet

1. **Metadata in Postgres, content in S3** (pointer in the row).
2. **Random base62 id** + DB unique constraint + retry (unguessable for secret gists).
3. **Read-heavy** → CDN (public, immutable) + Redis for hot gists.
4. **Visibility**: public (listed/cached), secret (unguessable link), private (auth per read).
5. **Immutable content** → trivial caching, versions = new blobs.
6. **Optional TTL** → `expires_at` + lazy 404 + lifecycle cleanup.
7. **Don't over-engineer** — it's a read-heavy, mostly-static store; cousin of the [URL shortener](url-shortener.md).

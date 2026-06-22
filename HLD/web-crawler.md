# Web Crawler — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[crawling]` `[politeness]` `[deduping]` `[distributed-queue]`
> **Companies that ask this:** Google, Meta, Bing, every search company, news aggregators

---

## Beginner's Guide

### What's this in plain English?

Google's search index has every page on the web. How does it know about every page? A **crawler** — a program that starts with some seed URLs, downloads them, finds all the links in them, downloads those, finds links in those, and so on. Forever. While being polite (don't hammer one server), efficient (don't re-crawl the same page), and respectful (obey robots.txt).

### Why solve it?

- **Real world**: Googlebot, Bingbot, news aggregators, security scanners.
- **Teaches**: BFS at scale, distributed queues, politeness, deduplication, content extraction.

### Vocabulary

- **Frontier** — the queue of URLs to crawl next.
- **Politeness** — limit requests per domain (typically 1 every few seconds).
- **robots.txt** — a file at site root that tells crawlers what they can/can't fetch.
- **Dedup** — don't fetch the same URL twice.
- **Freshness** — how often to re-crawl an existing page.
- **Crawl budget** — how many pages to fetch from one domain per cycle.

### High-level architecture

```
Seed URLs → URL Frontier (priority queue) → Fetcher pool → Parser → New URLs back to frontier
                                                ↓                ↓
                                         Content store     Dedup (Bloom filter)
```

Components:
1. **Frontier** — distributed priority queue; per-domain rate limit.
2. **Fetcher** — distributed workers; respects robots.txt.
3. **Parser** — extracts links + content.
4. **Dedup** — bloom filter for "have I seen this URL?"
5. **Storage** — content + metadata (last crawled, change frequency).

Politeness: per-domain queues with token-bucket pacing.

Freshness: page rank / change frequency drives recrawl priority.

### How to read this doc

- **Beginner**: focus on the BFS + politeness model.
- **Interview**: cross-questions on dedup at scale, freshness, JavaScript-heavy sites.

---

## 0. How to use this doc in an interview

Web crawler tests **distributed queues, dedup at scale, politeness, content extraction**. Trap: not handling robots.txt or rate limits per domain.

---

## 1. Problem Statement

A crawler that:
- Starts from seed URLs.
- Discovers more URLs by following links.
- Fetches content for each URL.
- Deduplicates (same URL or same content).
- Respects robots.txt and rate limits.
- Indexes content for downstream consumers (search engine, news aggregator).

---

## 2. Clarifying Questions

- [ ] How big is the target — 1B pages? 100B?
- [ ] Just HTML or also images / videos / PDFs?
- [ ] How fresh? (re-crawl frequency)
- [ ] Domain-restricted or open web?
- [ ] Crawl politeness — strict?

> **Assume:** 100B+ URLs (open web), HTML primary + media URLs only, 1-day to 30-day refresh per page importance, full politeness.

---

## 3. Functional Requirements

**P0:**
1. Fetch URL.
2. Parse → extract links.
3. Add new URLs to frontier.
4. Dedup at URL level + content level.
5. Honor robots.txt and rate limits.
6. Persist content for downstream.

**P1:**
7. Per-page priority (PageRank, domain authority).
8. Adaptive freshness (popular pages re-crawled more often).

**P2:**
9. JavaScript-rendered pages (headless browser).
10. Multimedia (images, videos).

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.9% |
| Throughput | 10k pages/sec sustained |
| Politeness | < 1 req/sec/host typical |
| Dedup | URL hash + content hash |
| Storage | 100B pages → ~50 TB compressed |

---

## 5. Capacity Estimation

```
Pages: 100B
Avg page size: 100 KB → 10 PB raw, ~3 PB compressed
Crawl rate: 10k/sec sustained
Frontier: 1B+ URLs queued
Hosts: 200M+
Politeness budget: 1 req/sec/host = 200M reqs/sec capacity total
                   (real bottleneck: bandwidth + storage)
```

---

## 6. API (internal)

```
ENQUEUE_URL(url, priority)
FETCH_BATCH() -> list of URLs ready (politeness honored)
STORE_PAGE(url, content_hash, content)
```

---

## 7. Data Model

### URL frontier (priority queue, distributed)
- Per-host queue: maintains crawl order.
- Per-host throttle.
- Backed by Kafka or Redis lists.

### URL dedup (Bloom filter + DB)
- Bloom filter: O(1) "have we seen this URL?" probabilistic.
- DB (Cassandra) for confirmed seen.

### Content dedup (SimHash on body)
- Same content from different URLs → coalesce.

### Pages store (S3 + metadata DB)
- S3: raw HTML.
- DB: URL → S3 key, hash, last_crawled, status.

---

## 8. Architecture

```
              ┌─────────────────────┐
              │   Seed URLs         │
              └──────────┬──────────┘
                         │
                ┌────────▼──────────────┐
                │   URL Frontier        │
                │   (per-host queues)   │
                │   + politeness        │
                │   + priority          │
                └────────┬──────────────┘
                         │
                ┌────────▼──────────────┐
                │ Fetcher Workers       │
                │ - DNS resolve         │
                │ - HTTP fetch          │
                │ - retry                │
                └────────┬──────────────┘
                         │
                ┌────────▼──────────────┐
                │ Parser                │
                │ - extract links       │
                │ - extract text        │
                │ - canonicalize URLs   │
                └────────┬──────────────┘
                         │
              ┌──────────┴────────────┐
              ▼                       ▼
        ┌──────────┐         ┌──────────────┐
        │ Dedup Svc│         │ Content Store │
        │ - bloom  │         │ (S3)         │
        │ - DB     │         └──────────────┘
        └──────────┘                
                         │
                ┌────────▼──────────┐
                │ Frontier (back)   │ ← new URLs
                └───────────────────┘

              ┌────────────────────────┐
              │ Indexer (downstream)   │ → search index
              └────────────────────────┘
```

---

## 9. Component Deep-Dives

### 9.1 URL Frontier
- Distributed priority queue.
- Per-host queues to enable rate limiting.
- "Mercator-style" priority: PageRank, freshness need.
- Backed by Kafka (with key=host) for ordering.

### 9.2 Fetcher
- HTTP client; respects robots.txt (cached per host).
- Per-host token bucket: 1 req/sec default.
- Retries on 5xx.
- Captures redirects.

### 9.3 Parser + canonicalizer
- HTML parse (libxml).
- Extract `<a href>`s.
- Canonicalize: resolve relative, strip fragments, lowercase domain.
- Filter: only HTTP(S); reject obvious traps.

### 9.4 URL dedup
- Hash URL → check Bloom filter.
- If "definitely no" → forward to fetch.
- If "maybe yes" → confirm in DB.
- After fetch: insert into DB; update Bloom.

### 9.5 Content dedup
- SimHash of body → if seen identical → don't store.
- Helpful for mirrors, syndicated content.

### 9.6 Politeness
- Per-host rate limit.
- robots.txt cached 24h per host.
- User-agent identifies as bot.

---

## 10. Hard Sub-Problems

### 10.1 URL frontier scaling
- 1B+ pending URLs.
- Sharded by host hash.
- Within host: priority queue (heap).

### 10.2 Crawl traps
- Infinite calendars (`/calendar/2099/01/01/...`).
- Detect: depth limit; pattern detection.

### 10.3 Bias toward seed sites
- Seed-heavy: BFS biased to popular.
- Mix in PageRank-weighted prioritization.

### 10.4 Refresh strategy
- Static page: re-crawl monthly.
- News site: hourly.
- Adaptive: monitor change frequency.

### 10.5 robots.txt at scale
- Cache per-host.
- Revalidate daily.
- Honor `Crawl-Delay`.

---

## 11. Cross-Questions ≥ 12

### 11.1 Why Bloom filter for URL dedup?
- 100B URLs × 30 bytes = 3 TB raw.
- Bloom: ~10 bits/key × 100B = 1.25 TB; held in distributed memory.
- False positive 1%; verify in DB.

### 11.2 Why per-host queues?
- Politeness requires per-host rate limit.
- Per-host queue serializes naturally.

### 11.3 Why Kafka for frontier?
- Durable + partitionable.
- Per-host = partition key → ordering preserved.
- Replay-able for failure recovery.

### 11.4 What about JS-heavy sites?
- Headless browser pool.
- 10x more expensive.
- Used selectively.

### 11.5 Why content dedup?
- Mirrors, syndication, AI-generated junk.
- Save storage + dedup index.

### 11.6 How is PageRank computed?
- Iterative computation over link graph.
- Offline; daily.
- Influences priority in frontier.

### 11.7 What about pages requiring login?
- Skip; index only public.

### 11.8 How is freshness adapted?
- Track change rate per page.
- Stable pages → less frequent.
- Frequently changed → daily.

### 11.9 How are duplicates by URL params handled?
- Canonical URL extracted from `<link rel=canonical>`.
- Strip tracking params (utm_, fbclid, etc.).

### 11.10 What about international / non-Latin sites?
- UTF-8 throughout.
- Per-language crawler instances if scaling.

### 11.11 Cross-region?
- Distributed crawlers per region.
- Frontier global; fetcher local to region.

### 11.12 What's the failure mode under host outage?
- Pages stay queued; retry with backoff.
- After N failures: mark host suspended; revisit later.

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| Bloom for dedup | Memory efficient | False positives |
| Per-host queue | Politeness | Scheduler complexity |
| Adaptive freshness | Optimal recrawl | Tracking overhead |
| Headless browser optional | Saves cost | Misses JS-only content |

---

## 13. Cheat-Sheet

1. **URL frontier** = sharded per-host priority queue (Kafka-backed).
2. **Fetcher** with per-host rate limit + robots.txt.
3. **Parser** extracts links + canonicalizes.
4. **Bloom filter** for URL dedup; DB confirms.
5. **SimHash** for content dedup.
6. **S3** for raw HTML; **DB** for URL metadata.
7. **Adaptive freshness** by change rate.

# News Aggregator (Google News / Apple News) — High-Level Design

> **Difficulty:** Medium → Hard
> **Tags:** `[hld]` `[crawling]` `[ranking]` `[deduping]` `[personalization]`
> **Companies that ask this:** Google, Apple, Flipboard, SmartNews

---

## Beginner's Guide

### What's this in plain English?

Google News. You open it; you see today's top stories, organized by topic ("Politics," "Tech," "Sports"). Multiple outlets covered the same news; the app **clusters** them together — "Apple announces iPhone 16 (12 sources)." It also personalizes — your feed differs from a stranger's.

### Why solve it?

- **Real world**: Google News, Apple News, Flipboard, SmartNews.
- **Teaches**: web crawling, article deduplication / clustering, ranking, personalization.

### Vocabulary

- **Source** — a news website (CNN, BBC).
- **Cluster** — multiple articles about the same story.
- **Topic / Tag** — sports, politics, tech.
- **Personalization** — ranking based on user interests.

### High-level architecture

```
Crawler → Article extractor → Cluster (LSH / embeddings) → Topic + ranking → Personalized feed
```

Components:
1. **Crawler** — fetches from news sites; respects robots.txt.
2. **Extractor** — pulls clean text from messy HTML.
3. **Clustering** — group articles about the same story (LSH on text embeddings).
4. **Topic classifier** — tag stories.
5. **Personalization** — per-user ranking; clicks feed back into model.

Clustering is the magic — turns 50 articles about iPhone 16 into one card.

### How to read this doc

- **Beginner**: focus on the crawl → cluster → rank pipeline.
- **Interview**: cross-questions on clustering algorithm, personalization, freshness.

---

## 0. How to use this doc in an interview

News Aggregator is **crawl + cluster + rank + personalize**. Tests:
1. Crawling at scale; politeness.
2. Article deduplication / clustering (same story across publishers).
3. Ranking (recency × popularity × personalization).
4. Per-user feeds.

---

## 1. Problem Statement

A news app:
- Aggregate from thousands of publishers.
- Group articles about same story.
- Rank by relevance + recency.
- Per-user personalization (topics user follows).
- Push notifications for breaking news.

---

## 2. Clarifying Questions

- [ ] Number of publishers?
- [ ] Languages?
- [ ] Push for breaking news?
- [ ] Personalization or default ranking?

> **Assume:** 100k publishers, multi-lang, breaking news push, full personalization.

---

## 3. Functional Requirements

**P0:**
1. Crawl publishers (RSS, sitemaps, scrape).
2. Extract article text + metadata.
3. Cluster duplicates (same story).
4. Rank for default feed.
5. Personalize per user.
6. Push notification on breaking story.

**P1:**
7. Topic following.
8. "Save for later".
9. Search.

**P2:**
10. Audio article reading.
11. Premium / paywall handling.

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.99% |
| Article freshness | < 5 min publisher → user |
| Feed load | < 500 ms |
| Push latency | < 2 min for breaking news |

---

## 5. Capacity Estimation

```
Articles ingested: 1M / day
Publishers: 100k (10 articles/day average)
Clusters: ~100k / day (10 articles per story)
DAU: 50M
Feed loads: 200M/day
```

---

## 6. API

```
GET /v1/feed                               -> personalized
GET /v1/topics/{topic}/feed
GET /v1/clusters/{id}                      -> all articles in cluster
POST /v1/topics/follow
```

---

## 7. Data Model

### Articles (Cassandra)
- `(article_id, publisher_id, ts, url, title, body_hash, cluster_id)`

### Clusters (Postgres or DocDB)
- `(cluster_id, canonical_title, topic_tags, article_count, top_publishers, popularity_score)`

### User feeds (Redis ZSET per user)
- Pre-computed from clusters; score = personalized_relevance × recency.

---

## 8. Architecture

```
              ┌──────────────────────┐
              │ RSS / Sitemaps / WB  │
              │   (publishers)       │
              └──────────┬───────────┘
                         │
                ┌────────▼─────────┐
                │   Crawler        │
                │  - politeness    │
                │  - RSS poll      │
                │  - extract HTML  │
                └────────┬─────────┘
                         │
                ┌────────▼─────────┐
                │ Article Extractor │
                │  (boilerpipe)    │
                └────────┬─────────┘
                         ▼
                ┌──────────────────┐
                │  Clustering Svc  │
                │  - SimHash / DBSCAN
                │  - assign cluster_id
                └────────┬─────────┘
                         ▼
                ┌──────────────────┐
                │  Ranker          │
                │  - popularity     │
                │  - velocity       │
                │  - topic tags     │
                └────────┬─────────┘
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
        ┌──────────┐         ┌──────────────┐
        │ Personal-│         │ Global Feed  │
        │ izer     │         │              │
        └────┬─────┘         └──────────────┘
             │
             ▼
        ┌──────────┐
        │ Redis    │
        │ user feeds│
        └──────────┘
```

---

## 9. Component Deep-Dives

### 9.1 Crawling
- RSS poll for known publishers (every 5-15 min).
- Sitemap-based discovery for new content.
- Scraping + HTML parsing for some publishers.
- Politeness: respect robots.txt, rate limit per publisher.

### 9.2 Article extraction
- Strip boilerplate (nav, ads, comments).
- Open source: boilerpipe / readability.js.
- Extract: title, body, author, date, image.

### 9.3 Clustering (de-duplication of same story)
- SimHash on body → 64-bit fingerprint.
- Articles with hamming distance < threshold → same cluster.
- Or DBSCAN on TF-IDF vectors.
- Streaming: each new article checks against last-N hour's articles.

### 9.4 Ranking signals
- Cluster popularity (how many publishers, how many shares/clicks).
- Recency (decay over hours).
- Topic affinity for user.
- Source authority (Reuters > random blog).

### 9.5 Per-user personalization
- Topics user followed → weight up.
- Past clicks → ML signal.
- Feed = ranked clusters; pre-computed per user.

### 9.6 Push notification for breaking news
- Velocity detection: cluster grows from 1 article to 20 in 10 min.
- Trigger broadcast push to subscribed users.

---

## 10. Hard Sub-Problems

### 10.1 Same story, different angle
- "Trump tweets X" — multiple publishers cover; some focus on policy, some on reaction.
- Clustering must handle: similar enough = same cluster.
- SimHash threshold tuned per-language.

### 10.2 Crawl politeness
- Each publisher rate-limited (e.g. 5 req/sec).
- Crawl scheduler ensures fairness.
- robots.txt strictly observed.

### 10.3 Late-breaking corrections
- Article updated by publisher → re-crawl; update cluster.
- Mark article as "updated"; show fresh content.

### 10.4 Spam / fake news
- Source reputation scoring.
- Flagged content not surfaced.

---

## 11. Cross-Questions ≥ 12

### 11.1 Why SimHash for clustering?
- Probabilistic; near-duplicates have small hamming distance.
- Fast lookup via LSH (locality-sensitive hashing).
- Compared to TF-IDF + cosine: SimHash is 10× faster per check.

### 11.2 Why Cassandra for articles?
- 1M articles/day.
- Append-only.
- Read by article_id (point lookup) or cluster (range).

### 11.3 How is feed personalized?
- Baseline: top global stories.
- Boost: topics user follows.
- Suppress: topics user has dismissed.
- ML re-ranks the top N candidates.

### 11.4 Why pre-compute user feed?
- 50M DAU × multiple loads/day = 200M/day.
- Recomputing per request = expensive ML calls.
- Pre-compute every 30 min; refresh on signals (user opens app).

### 11.5 How do you handle a story embargoed until 9 AM?
- Publishers tag publish time.
- Crawler ingests; clustering happens; but display to users gated by publish_time.

### 11.6 How is breaking news push triggered?
- Velocity = cluster article count growth rate.
- Triggers push when velocity > threshold and cluster impact > threshold.
- Limited to a few/day (push fatigue).

### 11.7 What's source authority?
- Hand-curated list of trusted sources.
- ML signals: bounce rate, spam reports, age, article quality.
- Boosts ranking weight.

### 11.8 Multi-language?
- Per-language clustering (don't mix English + Spanish).
- Per-language ranker.
- User's locale picks feed.

### 11.9 What about regional stories?
- Geo-tag clusters via location entity extraction.
- User location prioritized for "local news" tab.

### 11.10 How do publishers integrate?
- Self-serve RSS submission.
- Sitemap discovery.
- Crawl by default for known publishers.

### 11.11 What about paywalled content?
- Snippet shown; click goes to publisher.
- Don't claim to scrape full content.

### 11.12 How do you handle very high QPS (event like election)?
- Pre-cache ranked clusters globally.
- Per-user feed reads from pre-computed cache.
- ML re-ranking offline.

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| SimHash clustering | Fast | Approximate |
| Pre-computed feeds | Fast read | Stale signals (~30 min) |
| Per-publisher politeness | Fair, ToS-compliant | Slower discovery |
| Push for velocity-detected breaking | Engagement | Risk of false positives |

---

## 13. Cheat-Sheet

1. **Crawl** RSS / sitemaps; politeness.
2. **Extract** article body (boilerpipe).
3. **Cluster** with SimHash.
4. **Rank** by popularity × recency × source × topic.
5. **Personalize** via per-user pre-computed feed.
6. **Push breaking news** on velocity threshold.

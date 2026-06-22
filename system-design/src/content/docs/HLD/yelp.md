# Yelp / Google Maps Local — High-Level Design

> **Difficulty:** Medium → Hard
> **Tags:** `[hld]` `[geospatial]` `[search]` `[reviews]` `[autocomplete]`
> **Companies that ask this:** Google, Yelp, TripAdvisor, OpenTable, Foursquare

---

## Beginner's Guide

### What's this in plain English?

Yelp / Google Maps. You search "pizza near me" → see a list of places, sorted by distance + rating + open-status. Tap one, see reviews. Add your own review. Photos. The system: geo-search at scale + reviews + ranking.

### Why solve it?

- **Real world**: Yelp, Google Maps, TripAdvisor, OpenTable, Foursquare.
- **Teaches**: geospatial search, multi-attribute filtering, reviews, autocomplete for places.

### Vocabulary

- **Place / POI** — Point of Interest (restaurant, store, etc.).
- **Geohash / S2 / H3** — geo cells for indexing.
- **Multi-attribute search** — geo + category + rating + open-now.
- **Review** — text + rating, attached to a place.
- **Heatmap** — popular areas visualization.

### High-level architecture

```
Place DB ──→ Geo Index (S2 cells)
   ↓
Search API ──→ Filter by: category, rating, open, distance
   ↓
Result list ──→ Reviews loaded on demand
```

Components:
1. **Place DB** — name, location, hours, photos, attributes.
2. **Geo-index** — fast "places within X km of (lat, long)."
3. **Reviews** — separate store; aggregated to place stats.
4. **Search** — combines geo + filters + ranking.
5. **Autocomplete** — for place names + categories.

### How to read this doc

- **Beginner**: focus on geo + filter combination.
- **Interview**: ranking with reviews, freshness, abuse detection.

---

## 0. How to use this doc in an interview

Yelp is **geospatial search + reviews + ranking**. Tests:
1. Multi-attribute geo search ("pizza near me, 4★+, open now").
2. Inverted index for full-text + geo filter.
3. Review storage and aggregation.
4. Autocomplete (typeahead).

---

## 1. Problem Statement

A local business directory:
- Search businesses by name, category, location.
- View business details + reviews + photos.
- Write reviews; rate.
- Photos, hours, phone.
- "Near me" with filters.
- Autocomplete on search.

---

## 2. Clarifying Questions

- [ ] Photos in scope?
- [ ] Reservations / orders integrated?
- [ ] Recommendations / personalization?
- [ ] Real-time hours (open now)?
- [ ] Multi-language?

> **Assume:** photos yes, no reservations, basic recs, real-time hours, multi-language metadata.

---

## 3. Functional Requirements

**P0:**
1. Search businesses by name + category + location.
2. Filter by rating, distance, "open now", price.
3. Business details page.
4. Reviews — read + write + rate.
5. Photos — upload + view.
6. Autocomplete on search input.

**P1:**
7. Personalized recommendations.
8. "Tonight open" filter.
9. Review helpfulness votes.

**P2:**
10. Reservations (OpenTable-like).
11. Order ahead.
12. Loyalty rewards.

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.99% (read), 99.9% (write) |
| Search latency P99 | < 500 ms |
| Autocomplete | < 100 ms |
| Index freshness | New review visible < 1 min |

---

## 5. Capacity Estimation

```
Businesses: 100M globally
Reviews: 5B
Search QPS: 100k peak
Avg searches/user/day: 5
DAU: 50M
Review writes: 1k/sec peak
```

---

## 6. API

```
GET /v1/businesses/search?q=&lat=&lng=&filters=
GET /v1/businesses/{id}
POST /v1/businesses/{id}/reviews
GET /v1/autocomplete?prefix=&lat=&lng=
```

---

## 7. Data Model

### Businesses (Postgres + ElasticSearch)
- Postgres: source of truth (id, name, address, lat, lng, category, hours, phone).
- ElasticSearch: indexed for search + geo + filters.

### Reviews (Cassandra, partitioned by business_id)
- `(business_id, ts, review_id, user_id, rating, text, photos[], helpful_count)`

### Aggregates (Redis or DB)
- Per-business: avg rating, review count, top review snippet.
- Updated async on review insert.

### Autocomplete (Trie-based service)
- In-memory trie of business names + categories per geo region.

---

## 8. Architecture

```
              ┌──────────────────────┐
              │   Mobile / Web       │
              └──────────┬───────────┘
                         │
                ┌────────▼────────┐
                │  Gateway / LB    │
                └────────┬────────┘
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
  ┌──────────┐    ┌──────────────┐  ┌──────────┐
  │ Search   │    │ Autocomplete │  │ Reviews  │
  │ Svc      │    │ Svc          │  │ Svc      │
  └────┬─────┘    └──────┬───────┘  └─────┬────┘
       │                 │                 │
       ▼                 ▼                 ▼
  ┌──────────┐    ┌──────────┐      ┌──────────────┐
  │ Elastic  │    │ Trie+geo │      │ Cassandra    │
  │ Search   │    │ in mem   │      │              │
  └──────────┘    └──────────┘      └──────────────┘

              ┌──────────────────────┐
              │  Postgres (master)   │
              │  business catalog    │
              └──────────────────────┘
                         │
                         ▼
                  Kafka events
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
        Index updater         Aggregate updater
        (writes to ES)        (reviews → avg rating)
```

---

## 9. Component Deep-Dives

### 9.1 ElasticSearch search
- Index: business name, description, category, geo (geopoint), price, rating, hours.
- Query: composite — text match + geo distance + filters.
- ES handles geo natively (`geo_distance` filter).

### 9.2 Autocomplete
- Per-region trie loaded in memory.
- Prefix lookup → top 10 matches.
- Composite ranking: relevance + popularity + proximity.
- Refreshed nightly (new businesses); deltas applied real-time.

### 9.3 Review writes
- Write to Cassandra (durable).
- Emit event to Kafka.
- Aggregator consumes; recomputes business avg rating; pushes to ES (so search filter "4★+" stays current).

### 9.4 Photos
- Client uploads to S3 via presigned URL.
- Reference stored in review row.
- CDN serves.

---

## 10. Hard Sub-Problems

### 10.1 Geo + text search efficiency
- Bounding box first (geo), then text within results.
- ES's geo_distance + match query in one shot.
- Latency: ~100-300 ms for 1k results.

### 10.2 "Open now" filter
- Each business has hours per day.
- Filter computed at query time (current day + hour vs business hours).
- Cached for ~5 min.

### 10.3 Autocomplete personalization
- "Best mexican near me" autocompleted from user's history.
- Per-user trie? No — too expensive.
- Re-rank top trie matches with user features.

### 10.4 Spam reviews
- ML: detect fake patterns (account age, review burst, similar wording).
- Suspicious reviews shadow-banned (visible to author only).
- User trust score affects review weight in average.

---

## 11. Cross-Questions ≥ 12

### 11.1 Why ElasticSearch and not Postgres for search?
- Postgres has full-text + PostGIS but doesn't scale to 100M docs with 100k QPS.
- ES handles this routinely; geo + text + filter are first-class.
- Trade: another system to operate.

### 11.2 Why Postgres as system of record?
- Mature; ACID for business data; CRUD-friendly admin tools.
- ES is downstream search index — not authoritative.

### 11.3 How is search ranking decided?
- Text relevance + distance + business quality (rating × review count log) + business booster (paid).
- Trained / hand-tuned model.

### 11.4 How is autocomplete fast?
- In-memory trie per region.
- ~100M businesses globally; per-region tries (US, EU, etc.) — each ~10M nodes.
- 10k QPS handled by sharding.

### 11.5 How are reviews moderated?
- Pre-publish: profanity filter, ML for fake-detection.
- Post-publish: user reports; ops review.
- High-reputation user reviews weighted higher.

### 11.6 What about photos at scale?
- S3 + CDN; cheap and infinite.
- Multiple resolutions; client picks.
- Profanity / nudity ML scan.

### 11.7 How does "rating average" stay current?
- Streaming aggregate (Flink or simple consumer).
- New review → recompute avg → write back to ES.
- Lag: ~1 min.

### 11.8 What about international / multi-language?
- Multi-locale fields in ES.
- Search uses user's locale.
- Reviews stored in original language; auto-translate on display.

### 11.9 How is "trending" computed?
- Time-decayed view count + recent reviews.
- Refreshed hourly.

### 11.10 What about category hierarchy?
- Tree of categories (Food → Italian → Pizza).
- Query "Italian" matches "Pizza" via category subtree.
- Stored as ancestor list in ES.

### 11.11 How are duplicates detected?
- Same address + similar name + same phone = duplicate.
- Merged into one canonical entity.
- Detection job runs nightly.

### 11.12 What's the failure mode if ES is down?
- Search degrades; fallback to recent cache or "results unavailable" message.
- Catalog reads from Postgres still work.
- Reviews continue in Cassandra; backlog flushes when ES recovers.

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| ES as search index | Speed, geo+text combo | Eventual consistency vs DB |
| In-memory autocomplete trie | Sub-100ms | Memory cost |
| Cassandra for reviews | Volume scale | No JOINs |
| Postgres as catalog SOR | ACID, tooling | Limited scale |

---

## 13. Cheat-Sheet

1. **Postgres** for catalog (SOR).
2. **ElasticSearch** for search + filter + geo.
3. **Cassandra** for reviews (high-volume writes).
4. **In-memory trie** for autocomplete.
5. **Streaming aggregator** for rating averages.
6. **CDN** for photos.

---

## Appendix: Search query example

```
GET /yelp_businesses/_search
{
  "query": {
    "bool": {
      "must": [{ "match": { "name": "pizza" }}],
      "filter": [
        { "geo_distance": { "distance": "5km", "location": [37.77, -122.41] }},
        { "range": { "rating": { "gte": 4.0 }}}
      ]
    }
  },
  "sort": [{ "_score": "desc" }, { "_geo_distance": "asc" }]
}
```

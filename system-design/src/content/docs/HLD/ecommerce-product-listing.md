# e-Commerce Product Listing — High-Level Design

> **Difficulty:** Medium → Hard
> **Tags:** `[hld]` `[read-heavy]` `[search]` `[catalog]` `[caching]` `[inventory]`
> **Prep time:** ~12 min skim, ~35 min deep read
> **Companies that ask this:** Amazon, Flipkart, Shopify, eBay, Walmart, any commerce/marketplace team

---

## Beginner's Guide

### What's this in plain English?

You browse Amazon: a category page of products, filters on the left (brand, price, rating), sort options, a search box, and each product shows price + "in stock." Behind it: a **product catalog** that must be **searched, filtered, sorted, and rendered fast** for millions of shoppers, with **accurate price and stock**. This is the product **listing/discovery** layer (not checkout).

### Why solve it?

- **Real world**: every e-commerce/marketplace product grid and search.
- **Teaches**: **read-heavy catalog design**, **search + faceted filtering** ([Elasticsearch](../DeepDives/Search/elasticsearch.md)), **caching/CDN**, and the **catalog-vs-inventory consistency** split (price/stock must be fresher than descriptions).

### Vocabulary

- **Catalog** — the product data (title, description, images, attributes).
- **Facet** — a filterable attribute with counts (Brand: Sony (42), LG (30)).
- **Inventory** — stock level; changes fast, must be reasonably accurate.
- **SKU** — a specific purchasable variant (size/color).

### High-level architecture

```
Browse/Search → CDN → API → Search service (Elasticsearch: query+facets)
                                  │
                 product details ← cache (Redis) ← Catalog DB
                 price/stock      ← Inventory service (fresher path)
```

Catalog data is read-mostly and cacheable; price/stock is volatile and read on a fresher path.

### How to read this doc

- **Beginner**: focus on the search + cache read path.
- **Interview**: cross-questions on search-index sync, facets, stock accuracy, hot products.

---

## 0. How to use this doc in an interview

This tests **read-heavy design + search/faceting + a consistency split**. The key insights: (1) use a **search engine** ([Elasticsearch](../DeepDives/Search/elasticsearch.md)) for query + facets, with the system-of-record in a DB you **sync** into the index; (2) **separate the volatile price/stock path** from the cacheable catalog path (you can cache a product's description for hours, but not "in stock"); (3) it's massively read-heavy → CDN + cache. Traps: serving stale stock, treating the search index as the source of truth, and ignoring the index-sync lag.

---

## 1. Problem Statement

Power product discovery for a large catalog:
- Browse by category; search by keyword.
- Filter (facets: brand, price range, rating, attributes) and sort (price, rating, relevance, popularity).
- Show product cards with current price + availability.
- Product detail page.
- Fast, at scale, with accurate-enough price/stock.

(Out of scope: cart/checkout/payments, recommendations beyond listing.)

---

## 2. Clarifying Questions

- [ ] Catalog size + traffic? (assume 100M products, very read-heavy)
- [ ] Search + facets required? (assume yes — core)
- [ ] How fresh must price/stock be? (assume seconds for stock, near-real-time price)
- [ ] Marketplace (many sellers, same product) or single-seller? (assume marketplace)
- [ ] Personalization/ranking? (assume basic relevance + popularity; personalization P1)

> **Assume:** 100M products, search + faceted filter + sort, fresh-ish stock, marketplace, read-heavy.

---

## 3. Functional Requirements

**P0:**
1. Browse category listings (paginated).
2. Keyword search with relevance ranking.
3. Faceted filtering (brand, price, rating, attributes) + sort.
4. Product detail with current price + availability.

**P1:**
5. Personalized ranking; "popular"/"trending" sort.
6. Multiple sellers per product (buy-box).
7. Recently viewed / related items.

**P2:**
8. Real-time price experiments; localized pricing/currency.

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Read latency | < 200 ms for listing/search |
| Availability | 99.99% (revenue-critical browsing) |
| Read:write | very high (browse ≫ catalog updates) |
| Stock freshness | seconds (avoid selling out-of-stock) |
| Catalog freshness | minutes OK (descriptions/images) |
| Scale | 100M products, 100k+ search QPS peak |

---

## 5. Capacity Estimation

```
Products:        100M × ~5 KB metadata    ≈ 500 GB catalog (fits sharded DB + index)
Search/browse:   1B+ requests/day          ≈ 12k/sec avg, 100k+/sec peak (read-heavy)
Catalog writes:  ~1M updates/day           ≈ 12/sec (tiny vs reads)
Stock updates:   high during sales         (volatile; separate fast path)
Images:          100M × several            → object storage + CDN
```

**Bottleneck:** search/browse read QPS and keeping the search index fresh. → Elasticsearch + heavy caching/CDN; async index sync from the catalog DB.

---

## 6. API

```
GET /search?q=&category=&filters=&sort=&cursor=     -> {results[], facets[], next_cursor}
GET /products/{id}                                  -> {details, price, availability}
GET /categories/{id}/products?filters=&sort=        -> listing
```

`facets[]` returns each filter value + its result count (computed by the search engine). Cursor pagination; price/stock fetched/merged on the detail and card render.

---

## 7. Data Model

### Catalog — system of record (relational or document)
```
products(id, title, description, brand, category_id, attributes(json), seller_id, images[], created_at)
prices(product_id, seller_id, price, currency, updated_at)        -- volatile
inventory(sku_id, seller_id, stock, reserved, updated_at)         -- very volatile
```
Catalog metadata is read-mostly → relational or document store ([picking-the-right-database](../DeepDives/Databases/picking-the-right-database.md)); shard by product/category at 100M scale.

### Search index — Elasticsearch (secondary, not SoR)
- Denormalized product docs indexed for keyword search + **facet aggregations** + sort. Built/updated by **syncing** from the catalog DB (CDC/[Kafka](../DeepDives/Messaging/kafka.md) → indexer). It is **not** the source of truth — it's eventually consistent. See [elasticsearch](../DeepDives/Search/elasticsearch.md).

### Inventory/price — fresh path
- Stock/price change frequently; kept in a fast store (DB + [Redis](../DeepDives/Caching/redis.md)) and read on a **separate, fresher path** than catalog text.

---

## 8. Architecture

```
                              ┌──────── CDN (images, cacheable pages) ───────┐
                              ▼                                              │
   Client ──► API gateway ──► Search service ──► Elasticsearch (query+facets)
                   │                                   ▲
                   │                                   │ async index (CDC/Kafka)
                   ├──► Catalog service ──► Catalog DB ─┘
                   │          └──► Redis (hot product cache)
                   └──► Inventory/Price service ──► Inventory DB + Redis (fresh stock/price)
```

- **Search/browse:** API → Elasticsearch for matching ids + facets → hydrate product details from cache/catalog → merge **fresh** price/stock → return.
- **Catalog update:** write DB (SoR) → emit change event → indexer updates Elasticsearch (eventually consistent).
- **Stock/price update:** write to inventory/price store + invalidate/update Redis (fast path).

---

## 9. Component Deep-Dives

### 9.1 Search & faceting (Elasticsearch)
Keyword search with relevance ([BM25](../DeepDives/Search/elasticsearch.md)), **facet aggregations** (counts per filter value), filtering, and sort — all things a SQL `LIKE` can't do well. The catalog DB stays the SoR; the index is rebuilt/updated from it. Facet counts come from ES aggregations over the filtered result set.

### 9.2 Keeping the index in sync (the hard consistency point)
On catalog change: write DB → **CDC/[Kafka](../DeepDives/Messaging/kafka.md) → indexer → update ES**. This is **eventually consistent** — a new/edited product appears in search after a short lag. Accept it for descriptions; never make ES authoritative for price/stock.

### 9.3 The catalog-vs-inventory consistency split (key idea)
- **Catalog text/images:** change rarely → cache aggressively (Redis + CDN), minutes of staleness fine.
- **Price/stock:** change constantly → short/no cache, read on a fresh path, merged at render time. **Never cache "in stock" for an hour** — overselling is a real bug. This split is the design's signature.

### 9.4 Caching & CDN (read-heavy)
- Product images + largely-static detail fragments → [CDN](../DeepDives/Caching/cdn.md).
- Hot product details → [Redis](../DeepDives/Caching/redis.md) (cache-aside, short TTL; see [caching-strategies](../DeepDives/Caching/caching-strategies.md)).
- Search results for common queries can be briefly cached, but facet/sort combos explode the key space — cache the popular ones, jittered TTL.

### 9.5 Sharding the catalog
At 100M products, [shard](../DeepDives/Distribution/sharding-partitioning.md) the catalog DB (by product id / category). Reads mostly go through ES + cache anyway, so the DB is hit on cache miss and for writes.

### 9.6 Stock accuracy at sale time
During flash sales, stock changes per second. Read stock from the fresh store; show "low stock"/"out of stock" promptly. Final truth is enforced at checkout (reservation/transaction — out of scope here, but mention it so listings are "best-effort accurate").

---

## 10. Hard Sub-Problems

### 10.1 Search index freshness vs source of truth
ES is a secondary index synced via CDC/Kafka; it lags. SoR is the DB. New products/edits appear after sync lag — acceptable; just don't trust ES for money/stock.

### 10.2 Facet count accuracy at scale
Facet counts are aggregations over the filtered set — expensive on huge result sets. ES handles it, but cap/approximate for enormous categories; cache popular facet combos.

### 10.3 Hot product (a viral/sale item)
[Hot key](../DeepDives/Caching/redis.md): one product page hammered. CDN + Redis + local cache for the *catalog* part; the *stock* part still needs freshness → short TTL + read-through, accept slightly higher load on the inventory store for hot items.

### 10.4 Stale stock / overselling
Don't long-cache availability; read fresh; enforce true availability at checkout. Listings are "best-effort," checkout is authoritative.

### 10.5 Deep pagination / infinite scroll
Use cursor (search_after in ES), not deep `from`+`size` offsets which are expensive ([elasticsearch](../DeepDives/Search/elasticsearch.md)).

---

## 11. Cross-Questions

### 11.1 Why Elasticsearch and not the database for search?
Relevance ranking, fuzzy/typo, and **facet aggregations** are what a search engine does; SQL `LIKE` table-scans and can't rank or facet efficiently. DB stays SoR.

### 11.2 How do you keep the search index fresh?
CDC/Kafka stream of catalog changes → indexer → ES. Eventually consistent; lag acceptable for text.

### 11.3 Why separate price/stock from catalog?
Different freshness needs: descriptions cache for minutes; stock must be seconds-fresh to avoid overselling. Caching them the same way causes bugs.

### 11.4 How do you serve 100k search QPS?
ES cluster (shards + replicas) for query scale; CDN for images/static; Redis for hot product details; cache popular queries/facets.

### 11.5 SQL or NoSQL for the catalog?
Either works; product data is document-ish (varied attributes) → document store or relational with JSON. Shard at 100M scale. SoR regardless; ES is the query layer. ([picking-the-right-database](../DeepDives/Databases/picking-the-right-database.md))

### 11.6 What about a marketplace (many sellers, one product)?
Model product vs offers (seller-specific price/stock); compute the "buy box" (best offer); facet/sort across offers.

### 11.7 How fresh are facet counts?
As fresh as the index; computed per query by ES aggregation. Approximate/cap for giant categories.

### 11.8 How do you avoid overselling on the listing?
Listings are best-effort (fresh stock read, short TTL); the **authoritative** check + reservation happens at checkout (a transaction), not the listing page.

### 11.9 Personalized ranking (P1)?
Blend relevance + popularity + user signals; precompute features; re-rank top candidates per user. (Recommendation territory — see [recommendation-engine](recommendation-engine.md).)

### 11.10 Multi-region?
Geo-routed [CDN](../DeepDives/Caching/cdn.md) + ES clusters/replicas per region; catalog DB replicated; localized price/currency on the price path.

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| Elasticsearch for search/facets | Relevance, fuzzy, facets at scale | Eventual consistency; index sync to maintain |
| DB as SoR, ES as index | Correct source + powerful queries | Sync pipeline + lag |
| Split catalog vs stock caching | Fast browse + accurate stock | Two read paths, more complexity |
| Heavy CDN/Redis caching | Handles read-heavy load | Staleness on the cached (catalog) parts |
| Cursor pagination | Cheap deep scroll | Can't jump to arbitrary page N |

---

## 13. Cheat-Sheet

1. **Read-heavy** → CDN + Redis + Elasticsearch carry the load; DB hit on miss/writes.
2. **Search/facets/sort** in **Elasticsearch**; the **DB is the source of truth**, synced via CDC/Kafka (eventually consistent).
3. **Split paths**: cache catalog text/images aggressively; read **price/stock fresh** (short/no cache) — don't oversell.
4. **Shard** the catalog at 100M scale; model product vs seller-offers for marketplaces.
5. **Cursor pagination** (search_after), not deep offsets.
6. **Authoritative stock at checkout**; listings are best-effort fresh.
7. Personalization/ranking → [recommendation-engine](recommendation-engine.md); search internals → [elasticsearch](../DeepDives/Search/elasticsearch.md).

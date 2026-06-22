# Price Tracking Service (CamelCamelCamel) — High-Level Design

> **Difficulty:** Medium
> **Tags:** `[hld]` `[crawling]` `[time-series]` `[alerting]` `[scheduler]`
> **Companies that ask this:** Honey, CamelCamelCamel, Keepa, Honey clones, e-commerce competitors

---

## Beginner's Guide

### What's this in plain English?

CamelCamelCamel / Keepa. You want to know: "is this Amazon item cheap right now compared to its history?" The system: regularly fetches prices from Amazon (and elsewhere), stores history, lets users set alerts ("notify me if this drops below $50"), shows charts.

### Why solve it?

- **Real world**: Honey, CamelCamelCamel, Keepa, Slickdeals.
- **Teaches**: scheduled crawling, time-series storage, alerts, throttled scraping.

### Vocabulary

- **Crawl** — fetch a product page and extract price.
- **Schedule** — how often (popular items hourly, niche daily).
- **Time-series** — sequential price history.
- **Alert** — user rule ("price < X") triggers notification.

### High-level architecture

```
Scheduler → Crawl queue → Workers fetch + parse → Time-series DB
                                                       ↓
                                                Alert engine → Notifications
```

Components:
1. **Schedule** — per-item frequency, dynamic based on popularity.
2. **Crawl workers** — politeness per domain, IP rotation if needed.
3. **Time-series DB** — Prometheus-style or InfluxDB; (item, time) → price.
4. **Alerts** — per user, evaluated on each new price.
5. **Charts** — query time-series for visualization.

### How to read this doc

- **Beginner**: focus on the scheduled-crawl + time-series flow.
- **Interview**: cross-questions on bot detection, schedule optimization, alert latency.

---

## 0. How to use this doc in an interview

Tests **scheduled crawling + time-series + alerts**. Borrows patterns from web crawler + metrics monitoring.

---

## 1. Problem Statement

Track product prices over time:
- User adds product URL.
- System crawls every N hours.
- Stores price history.
- Alerts user when price drops to target.

---

## 2. Clarifying Questions

- [ ] Sites supported (Amazon only or many)?
- [ ] Crawl frequency?
- [ ] User-defined alerts?
- [ ] Historical view? (months / years).

> **Assume:** multi-site (Amazon, Walmart, eBay); crawl every 6 hr default; user-defined alerts; 2-year history.

---

## 3. Functional Requirements

**P0:**
1. Add product (URL, target price).
2. Crawl on schedule.
3. Store price + availability history.
4. Notify on price drop.
5. Show price chart.

**P1:**
6. Variant tracking (color, size).
7. Browser extension to add quickly.
8. Crowdsourced lowest-ever price.

**P2:**
9. Sales prediction.
10. Multi-currency.

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.9% |
| Crawl latency | < 1 hr behind real price |
| Notification | < 5 min after detected drop |
| Storage | 2 years history per product |

---

## 5. Capacity Estimation

```
Tracked products: 100M
Crawl rate: 100M / 6 hr = 4.6k crawls/sec
Price points: 100M × 4 / day × 730 days = 290B records
Avg record: 50 bytes → 14 TB total
```

---

## 6. API

```
POST /v1/products    body: {url, target_price}
GET  /v1/products/me                    -> tracked list + current
GET  /v1/products/{id}/history?range=
DELETE /v1/products/{id}
```

---

## 7. Data Model

### Products (Postgres)
- `(product_id, source_site, url, name, sku, latest_price, latest_check)`

### Price history (Cassandra / time-series)
- `(product_id, ts, price, availability)` — partitioned by product_id, clustered by ts.

### User alerts (Postgres)
- `(user_id, product_id, target_price, notified)`

---

## 8. Architecture

```
              ┌──────────────────────┐
              │   User                │
              └──────────┬───────────┘
                         │
                ┌────────▼─────────┐
                │  API             │
                └────────┬─────────┘
                         │
                ┌────────▼──────────┐
                │  Schedule Mgr     │  (cron-like)
                │  per-product job  │
                └────────┬──────────┘
                         │
                ┌────────▼──────────┐
                │  Crawler Workers  │
                │  - per-site       │
                │  - politeness     │
                │  - retry          │
                └────────┬──────────┘
                         │
                ┌────────▼──────────┐
                │  Price Diff Svc   │
                │  - new vs prev    │
                │  - alert eval     │
                └────────┬──────────┘
                         ▼
                ┌────────────────┐
                │ Notify Svc     │  email / push
                └────────────────┘

                ┌────────────────┐
                │ Cassandra      │  history
                └────────────────┘
                ┌────────────────┐
                │ Postgres       │  products + alerts
                └────────────────┘
```

---

## 9. Component Deep-Dives

### 9.1 Scheduler
- Distributed cron (see job-scheduler doc).
- Each product has a next_crawl_at timestamp.
- Workers pick due products.

### 9.2 Crawler
- Site-specific parsers (Amazon page DOM vs Walmart's).
- Headless browser if JS-required.
- Anti-bot evasion (rotating proxies, captchas).
- Politeness: rate per site (1 req/sec/proxy).

### 9.3 Diff + alert
- New price < target → alert eligible.
- Avoid spam: alert once per cycle (track `notified` flag).
- Notify via email / push.

### 9.4 Variant handling
- Same product, different SKUs.
- Track each as separate product in DB.

---

## 10. Hard Sub-Problems

### 10.1 Anti-bot
- Sites block aggressively.
- Rotating residential proxies.
- Headless browser with realistic fingerprint.
- Adaptive: more retries on failures.

### 10.2 Site changes
- Page layout changes → parser breaks.
- Auto-detect failures via test crawl.
- Maintain parser per site; update.

### 10.3 100M products at 4 crawls/day
- 4.6k crawls/sec = 1.4M/day.
- Sharded crawler workers; 100s of workers.

### 10.4 Stale price alerts
- Item out of stock → user wants to know.
- Track availability separately; alert on availability changes.

---

## 11. Cross-Questions ≥ 12

### 11.1 Why per-product schedule?
- Hot / popular products: crawl more often.
- Stale: crawl less often.
- Adaptive frequency.

### 11.2 How is bot detection avoided?
- Residential proxies (look like real users).
- Realistic browsing patterns (not 1000 hits in 1 sec).
- Captcha solvers (paid services) for sites that gate.

### 11.3 Why Cassandra for history?
- Append-heavy.
- Time-ordered scans by product.

### 11.4 Why Postgres for products + alerts?
- Small per-row.
- Transactional updates (user adds alert + product).

### 11.5 How are alerts scheduled?
- After every crawl that completes; check if any alert fires.
- Async processing.

### 11.6 How are "lowest ever" prices computed?
- Per-product min over history.
- Cached; recomputed on each new low.

### 11.7 How is variant tracking done?
- Each variant URL = separate product entry.
- Hierarchy: parent product → variants.

### 11.8 What about regional pricing?
- Per-region crawls (US site vs UK site).
- Stored as separate "products."

### 11.9 What's the failure mode if crawler is blocked?
- Retry with different proxy.
- Mark product as "couldn't fetch"; use last known.
- Alert engineering on persistent failures.

### 11.10 How is user notified?
- Email by default.
- Push if mobile app.
- One per drop (no spam).

### 11.11 What about subscription tier (paid faster crawls)?
- Per-product frequency configurable.
- Premium: 1-hour crawls.
- Free: 6-hour crawls.

### 11.12 What about ToS / legal?
- Many e-commerce sites disallow scraping.
- Mitigation: API access where available.
- Some product (Honey) acquired by retailers — "blessed" crawling.

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| Per-product schedule | Adaptive | Scheduler complexity |
| Headless browser | JS sites work | Slow, expensive |
| Email alerts | Reach all users | Email deliverability |
| Crawl every 6 hr default | Manageable load | Slight staleness |

---

## 13. Cheat-Sheet

1. **Distributed scheduler** triggers per-product crawls.
2. **Site-specific parsers** + headless browser.
3. **Postgres** for products + alerts; **Cassandra** for history.
4. **Diff svc** evaluates alerts post-crawl.
5. **Anti-bot**: residential proxies, realistic patterns.
6. **Adaptive frequency** by popularity.

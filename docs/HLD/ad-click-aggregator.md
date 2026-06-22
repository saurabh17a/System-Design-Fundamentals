# Ad Click Aggregator — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[streaming]` `[exactly-once]` `[late-events]` `[aggregation]`
> **Companies that ask this:** Google, Meta, Amazon, Snap, TikTok

---

## Beginner's Guide

### What's this in plain English?

You see a Facebook ad and click it. Facebook bills the advertiser for that click. Multiply: tens of billions of clicks per day, with bots, dupes, late events, network failures. The system: count clicks **correctly** for billing, in close-to-real-time so advertisers see fresh stats.

### Why solve it?

- **Real world**: Google Ads, Meta, Amazon Ads, Snap, TikTok ad platforms.
- **Teaches**: streaming aggregation, exactly-once vs at-least-once, late events, bot filtering.

### Vocabulary

- **Click event** — `(timestamp, ad_id, user_id, ip)`.
- **Aggregation** — count clicks per ad per minute / hour / day.
- **Exactly-once** — each click counted exactly once even with retries.
- **Late event** — click that arrives 10 minutes late (mobile, network glitch).
- **Bot filtering** — drop fake clicks (you don't bill advertisers for those).

### High-level architecture

```
Click → Click ingest API → Kafka → Stream processor (Flink/Spark) → Aggregates store
                                          ↓
                                    Bot detection
                                          ↓
                                  Per-ad time-bucket counters
```

Components:
1. **Ingest** — accept click; dedupe by event id.
2. **Streaming** — group by `(ad_id, time_bucket)` and count.
3. **Bot detection** — heuristics + ML; tag/drop suspicious clicks.
4. **Aggregates store** — time-series per ad; for dashboards + billing.
5. **Reconciliation** — late events corrected next day.

Two pipelines: real-time (eventually consistent) and batch (correct, slower) — Lambda architecture.

### How to read this doc

- **Beginner**: focus on streaming + dedup.
- **Interview**: cross-questions on exactly-once, late events, bot filtering.

---

## 0. How to use this doc in an interview

Tests **streaming aggregation + exactly-once + late events**. Trap: "just count clicks" — the hard part is correctness under bot/dupes/late events.

---

## 1. Problem Statement

Aggregate ad click events:
- Each click = (ad_id, user_id, ts, click_id).
- Per-ad metrics: clicks/min, /hour, /day; CTR (clicks/impressions).
- Real-time dashboard for advertisers (~1 min lag).
- Daily settlements.
- Resilient to dupes (network retries) and bots.

---

## 2. Clarifying Questions

- [ ] Real-time lag tolerance?
- [ ] Late events — how late?
- [ ] Bot / fraud filtering in scope?
- [ ] Multi-currency / billing in scope?
- [ ] Granularity (per ad, campaign, account)?

> **Assume:** ~1 min lag for dashboards; events up to 1 hour late counted; bot filtering yes; billing yes; per-ad granularity.

---

## 3. Functional Requirements

**P0:**
1. Ingest click events.
2. Aggregate counts in tumbling windows (1 min, 1 hr, 1 day).
3. Dedupe (exactly-once).
4. Filter bots.
5. Late events: re-aggregate up to 1 hr.
6. Real-time API for dashboard.
7. Daily settlement → billing.

**P1:**
8. Geographic breakdown.
9. Device breakdown.
10. Custom dimensions.

**P2:**
11. Audience segmentation.
12. Attribution (last-click, multi-touch).

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.99% |
| Aggregation lag | < 1 min p99 |
| Throughput | 1M events/sec peak |
| Exactly-once | for billing-relevant counts |
| Storage | retain raw events 30 days |

---

## 5. Capacity Estimation

```
Events/sec: 1M peak
Event size: ~500 bytes
Bandwidth: 500 MB/s
Daily volume: 1M × 86400 = 86B events/day; 43 TB/day raw
Aggregates: per-ad per-minute = 100k ads × 1440 min = 144M rows/day
```

---

## 6. API

```
POST /v1/events/click       body: {ad_id, user_id, ts, click_id, device, geo}
GET  /v1/ads/{id}/metrics?window=1m|1h|1d&from=&to=
```

---

## 7. Data Model

### Raw events (Kafka, 30-day retention)
- Partitioned by ad_id (so all clicks for an ad land on one partition).

### Aggregates
- Tumbling windows: per-minute, per-hour, per-day.
- Stored in time-series DB or columnar (ClickHouse / BigQuery).

### Dedup state
- Redis or RocksDB embedded in stream processor.
- Key = click_id; expires after 1 hr.

---

## 8. Architecture

```
              ┌──────────────────────┐
              │  Click endpoint      │
              │  (CDN edge)          │
              └──────────┬───────────┘
                         │
                ┌────────▼─────────┐
                │  Kafka           │
                │  topic: clicks   │
                └────────┬─────────┘
                         │
              ┌──────────┴────────────┐
              ▼                       ▼
        ┌──────────────┐      ┌──────────────┐
        │ Bot Filter   │      │ Audit / Raw  │
        │ - rules      │      │   Store       │
        └──────┬───────┘      │  (S3)         │
               │              └──────────────┘
               ▼
        ┌──────────────────┐
        │  Stream Processor │  Flink / KStreams
        │  - dedupe         │
        │  - tumbling agg   │
        │  - late events    │
        └──────────┬────────┘
                   │
                   ▼
        ┌──────────────────┐
        │  Aggregates DB   │
        │  (ClickHouse)    │
        └──────────┬───────┘
                   │
                   ▼
        ┌──────────────────┐
        │  Dashboard API   │
        └──────────────────┘
```

---

## 9. Component Deep-Dives

### 9.1 Ingest (CDN edge)
- Click endpoint at CDN POPs (low latency).
- Forwards to Kafka.
- Partitioned by ad_id → all clicks for one ad on same partition (ordering helpful).

### 9.2 Bot filter
- Rule-based: known bot UAs, rate limits per IP.
- ML signals async (separate pipeline).

### 9.3 Stream processor (Flink)
- KeyBy ad_id.
- Tumbling window (1 min).
- Dedup: keep set of click_ids; reject duplicates.
- Allow lateness 1 hour: window state retained 1 hour past close.
- Output: (ad_id, window, count).

### 9.4 Late events
- Watermark = max event time - 1 hr.
- Window closes only when watermark passes window end.
- Late events update existing window count.
- Downstream sees corrections.

### 9.5 Aggregates store (ClickHouse)
- Columnar; fast aggregate queries.
- Per-ad per-window rows.
- Real-time inserts; queries from dashboard.

### 9.6 Daily settlement
- End-of-day batch job: aggregate per-ad-per-day.
- Write to billing system.
- Reconciliation against raw S3 audit log.

---

## 10. Hard Sub-Problems

### 10.1 Exactly-once
- At-least-once Kafka + dedup in stream = exactly-once for billing.
- Kafka transactions + Flink checkpoints if more strict.

### 10.2 Late event handling
- Watermark allowance = 1 hr.
- Beyond 1 hr: events dropped or sent to side-stream for manual review.

### 10.3 Hot ad
- One viral ad → all clicks on one Kafka partition → bottleneck.
- Mitigation: sub-key by hash(ad_id, hash(user_id)%4) → 4 sub-partitions; merge at aggregation.

### 10.4 Reconciliation with raw events
- Compute aggregates daily from raw S3 backup.
- Compare with streaming output.
- Any divergence → alert + manual fix.

---

## 11. Cross-Questions ≥ 12

### 11.1 Why Kafka and not direct write to DB?
- Decoupling; backpressure absorber.
- Replay capability for reprocessing.
- Ordering per partition.

### 11.2 Why Flink and not Spark Streaming?
- Flink has stronger watermark + exactly-once support.
- True streaming (record-at-a-time) vs Spark micro-batch.
- Better for low-latency aggregation.

### 11.3 Why ClickHouse for aggregates?
- Columnar; aggregate queries (sum, group by) are fast.
- Time-series friendly.
- Alternatives: Druid, Pinot.

### 11.4 How is dedup state managed?
- RocksDB-backed in Flink operator.
- Key = click_id; TTL 1 hr.
- Memory bounded; spillover to disk.

### 11.5 How are bots filtered?
- Pre-stream: simple rules (UA, rate).
- ML async: signals fed back as periodic blacklist.
- Some filtering at CDN to reject pre-aggregation.

### 11.6 What if Kafka loses an event?
- Replicated; durable on broker.
- Events also dual-written to S3 for audit.
- Reconciliation catches gaps.

### 11.7 How is data retained?
- Raw events: 30 days in Kafka; 90 days in S3.
- Aggregates: forever (small).

### 11.8 What about multi-region?
- Per-region Kafka cluster.
- Aggregation also per-region.
- Cross-region merge in offline batch (daily).

### 11.9 How are multi-touch attribution windows handled?
- Separate pipeline.
- Joins click events with subsequent conversions in 7-30 day window.
- Spark/batch on raw S3.

### 11.10 How is CTR calculated?
- Need impressions + clicks.
- Both ingested similarly; aggregated separately; ratio computed at query time.

### 11.11 What's the failure mode if Flink job dies?
- Restart from checkpoint (last consistent state).
- Replay events from Kafka offset.
- Brief outage; aggregates resume.

### 11.12 How big is the dedup state?
- 1M events/sec × 3600 sec = 3.6B click_ids in 1 hr window.
- 16-byte UUID + overhead = ~100 GB state.
- Sharded across Flink workers.

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| 1-hour watermark | Late events counted | Aggregate not final until 1 hr |
| Stream + batch reconciliation | Eventual consistency, audit | Code in two places |
| Per-ad partitioning | Locality | Hot-ad imbalance |
| ClickHouse | Fast aggregates | Operational complexity |

---

## 13. Cheat-Sheet

1. **Ingest** at CDN edge → Kafka.
2. **Stream**: Flink keyed by ad_id; tumbling windows.
3. **Dedup**: click_id → exactly-once.
4. **Late events**: 1-hour watermark.
5. **Aggregates** in ClickHouse.
6. **Reconcile** with daily batch on S3 audit.
7. **Hot ads** → sub-key partitioning.

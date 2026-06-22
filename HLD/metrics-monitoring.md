# Metrics Monitoring (Prometheus / Datadog) — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[time-series]` `[pull-vs-push]` `[downsampling]` `[alerting]`
> **Companies that ask this:** Google, Datadog, Grafana, New Relic, Splunk

---

## Beginner's Guide

### What's this in plain English?

Your servers and apps emit numbers constantly: "CPU 67%", "404 errors: 3/sec", "p99 latency: 230ms". A monitoring system collects these, lets you graph them on dashboards, and alerts when something goes wrong ("CPU > 90% for 5 min → page on-call").

### Why solve it?

- **Real world**: Prometheus, Datadog, New Relic, Grafana, Splunk.
- **Teaches**: time-series storage, pull vs push collection, downsampling, alerting.

### Vocabulary

- **Metric** — a named number with tags (e.g., `http_requests_total{path="/api"}`).
- **Time series** — `(metric, tags) → list of (timestamp, value)`.
- **Pull (Prometheus)** — system scrapes targets every X sec.
- **Push (StatsD, OpenTelemetry)** — apps push to a collector.
- **Downsampling** — older data compressed (5min → 1hour aggregates).
- **Alert** — rule: "if metric > threshold for N minutes → notify."

### High-level architecture

```
Apps → emit metrics → Collectors → Time-series DB → Dashboards + Alert engine
                                          ↓
                                  Downsampling pipeline → Cold tier
```

Components:
1. **Collection** — pull or push.
2. **Time-series DB** — purpose-built (Prometheus TSDB, InfluxDB, Cortex).
3. **Downsampling** — keep recent data fine, older data coarse.
4. **Alerting** — rule evaluation + notification.
5. **Dashboards** — query time-series for visualization.

### How to read this doc

- **Beginner**: focus on push vs pull and time-series storage.
- **Interview**: cross-questions on cardinality, retention, alert noise.

---

## 0. How to use this doc in an interview

Metrics monitoring tests **time-series storage, ingest, query, alerting**. Tests:
1. Pull (Prometheus) vs push (StatsD).
2. TSDB design — labels, sharding.
3. Downsampling (raw → 1m → 1h → 1d).
4. Alerting (rule evaluation engine).

---

## 1. Problem Statement

A monitoring service:
- Ingest metrics from millions of sources (each emits ~1k metrics/sec).
- Time-series storage (label, timestamp, value).
- Query: range, aggregations, derivations.
- Alert rules: trigger on threshold breach.
- Dashboards.

---

## 2. Clarifying Questions

- [ ] Pull or push ingest?
- [ ] Cardinality (unique label combos)?
- [ ] Retention?
- [ ] Multi-tenant?
- [ ] Self-hosted or SaaS?

> **Assume:** push (HTTP); cardinality 100M unique series; retention 13 mo (downsampled); multi-tenant SaaS.

---

## 3. Functional Requirements

**P0:**
1. Ingest metrics (counter, gauge, histogram).
2. Time-series storage with labels.
3. Range query with aggregations.
4. Alert rules engine.
5. Dashboards (basic).

**P1:**
6. Auto-downsampling.
7. Long-term storage (cold tier).
8. Notification channels (email/Slack/PagerDuty).

**P2:**
9. Distributed tracing integration.
10. Log correlation.

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.99% (data plane), 99.9% (queries) |
| Ingest throughput | 10M samples/sec |
| Query P99 | < 1 s for last hour |
| Alert latency | < 1 min from breach to notify |
| Retention | 1 day raw, 13 mo downsampled |

---

## 5. Capacity Estimation

```
Sources: 1M
Metrics/source/min: 10k
Total samples/sec: 10M × 60 / 60 = 10M
Sample size: 16 bytes (compressed: ~1 byte typical)
Daily volume: 10M × 86400 × 16 = 14 TB raw → ~1 TB compressed
```

---

## 6. API

```
POST /v1/metrics                        body: [{name, labels, ts, value}, ...]
GET  /v1/query                          ?expr=&start=&end=&step=
                                        -> time series
POST /v1/alerts/rules                   body: { expr, threshold, ... }
GET  /v1/alerts                         -> firing alerts
```

Query language: PromQL-like.

---

## 7. Data Model

### Time series identity
- `{__name__: "http_requests_total", method: "GET", endpoint: "/api/v1/x", host: "h1"}`
- The label set is the identity. Each unique combo = unique time series.
- Each sample: (ts, value).

### TSDB shard
- Per-tenant, per-time-bucket (e.g. 2-hour blocks).
- Inverted index: label name+value → series ID.
- Compressed time + value blocks per series.

---

## 8. Architecture

```
                ┌──────────────────────┐
                │   Sources (apps)     │
                │   exporters          │
                └──────────┬───────────┘
                           │ HTTP push
                           ▼
                ┌──────────────────────┐
                │  Ingest Gateway      │
                │  - validate          │
                │  - assign tenant     │
                └──────────┬───────────┘
                           │
                ┌──────────▼───────────┐
                │  Distributor         │
                │  - hash by series ID │
                │  - send to ingester  │
                └──────────┬───────────┘
                           │
                  ┌────────┼────────┐
                  ▼        ▼        ▼
              ingester  ingester  ingester
              (in-mem)  (in-mem)  (in-mem)
                  │        │        │
                  └────┬───┴────────┘
                       ▼
                ┌──────────────────┐
                │  Block Storage   │
                │  (S3 / GCS)      │
                │  2-hour blocks   │
                └──────────────────┘
                       │
                ┌──────────────────┐
                │  Query Service   │
                │  - PromQL        │
                │  - merge in-mem  │
                │  + blocks        │
                └──────────────────┘

                ┌──────────────────┐
                │  Alert Engine    │
                │  - rules         │
                │  - evaluator     │
                └──────────────────┘
```

---

## 9. Component Deep-Dives

### 9.1 Ingest path
- Gateway authenticates tenant.
- Distributor hashes series → routes to ingester replicas (3 for HA).
- Ingester writes to in-memory chunks.
- Every 2 hours: flush as compressed blocks to S3.

### 9.2 Ingester
- In-memory time-series database.
- Per-series chunks (1024 samples each).
- WAL for durability before flush.
- ~1M series per ingester possible.

### 9.3 Block storage
- Immutable 2-hour blocks per tenant per series-shard.
- Index: per-block inverted index (label → series).
- TSDB format (Prometheus-style).

### 9.4 Query
- Plan query (parse PromQL).
- Fetch in-memory ingester data + relevant blocks from S3.
- Merge + execute aggregation.
- Cache common queries.

### 9.5 Alert engine
- Periodic evaluation (every 30s).
- Run alert rules; check threshold.
- Trigger notification on breach.
- De-duplicate (same alert active → silence).

### 9.6 Downsampling
- Raw 1d retention.
- Downsample to 1m at 1-day mark.
- Downsample 1m to 1h at 30 days.
- Storage: ~10x reduction per step.

---

## 10. Hard Sub-Problems

### 10.1 High cardinality
- Adding `user_id` label = explosion.
- Cardinality limits per tenant.
- Reject high-card metrics.

### 10.2 Hot tenant
- One tenant ingesting 1M samples/sec.
- Distributor hashes by series; spreads across many ingesters.
- Per-tenant rate limit if needed.

### 10.3 Out-of-order samples
- Samples from a host arriving late.
- Ingester accepts samples with timestamps within last N seconds; reject older.
- Late samples are rare; rejecting OK.

### 10.4 Query for long range (1 year)
- Read from many blocks.
- Use downsampled tier for ranges > 7 days.
- Caches.

---

## 11. Cross-Questions ≥ 12

### 11.1 Push vs pull?
- Pull (Prometheus): server scrapes endpoints; simpler discovery via service registry.
- Push (StatsD, OpenTelemetry): flexible, works behind firewalls.
- We chose push for SaaS multi-tenant; pull doesn't scale to 1M tenants.

### 11.2 Why label-based identity?
- Flexible querying without schema changes.
- Trade: high cardinality risk.

### 11.3 Why 2-hour blocks?
- Balance: smaller = more files (S3 list slow); larger = ingester memory grows.
- 2-hour is industry default (Prometheus).

### 11.4 Why per-series compression?
- Time-stamped values are highly compressible (delta encoding + Gorilla compression).
- 1 byte/sample typical; 16x reduction.

### 11.5 How is HA achieved?
- 3 ingester replicas per partition.
- Distributor sends to all 3.
- Query merges from any 2 of 3 (quorum).

### 11.6 Why downsampling?
- Storage cost: keep raw 1d, 1m for 30d, 1h for 13mo → 10x cheaper than raw 13mo.
- Queries on long range use coarser data.

### 11.7 What about tracing / logs?
- Different problem; different system.
- Common feature: correlate by trace_id/timestamp.

### 11.8 How are alerts deduplicated?
- Alert fires when condition true.
- Active alert tracked in state.
- Resolved when condition false.
- No re-fire while active.

### 11.9 What about flapping alerts?
- "For: 5 min" condition: condition must be true continuously for 5 min.
- Reduces flap.

### 11.10 How is multi-tenant isolated?
- Per-tenant quotas (samples/sec, cardinality).
- Per-tenant ingesters or namespaced.
- Per-tenant query rate limit.

### 11.11 What's the failure mode if ingester dies?
- Replicas serve writes / reads.
- Restart from WAL.
- Brief gap if all 3 down.

### 11.12 How is data deleted on tenant cancel?
- Tombstone all tenant blocks.
- Background GC removes from S3.
- Compliance: hard delete on request.

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| Push ingest | Multi-tenant SaaS | Discovery harder than pull |
| Label-based | Flexible | Cardinality explosion risk |
| 3-replica ingester | HA | 3x write cost |
| Downsampling | Storage savings | Loss of fine resolution at long range |
| In-mem + S3 | Speed + scale | Two systems |

---

## 13. Cheat-Sheet

1. **Push ingest** via HTTP.
2. **Distributor** hashes series → ingester replicas (3x).
3. **Ingesters** in-mem; flush 2-hour blocks to S3.
4. **Query** merges in-mem + S3 blocks.
5. **Alert engine** evaluates rules every 30s.
6. **Downsample** for cost (raw → 1m → 1h → 1d).
7. **Cardinality limits** per tenant.

---

## Appendix: Storage math

```
Samples/sec     = 10M
Bytes/sample    = 1 (compressed)
Daily storage   = 10M × 86400 × 1 = 864 GB raw, ~100 GB compressed
After downsample (after 1d → 1m): /60 reduction.
After 30d → 1h: /60 again.
13mo retention: 1 day raw + 30 days 1m + 12 months 1h
              ≈ 100 GB + 50 GB + 200 GB = 350 GB / tenant.
```

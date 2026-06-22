# Distributed Logging (Splunk / ELK / Loki) — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[ingest]` `[search]` `[time-series]` `[retention]`
> **Companies that ask this:** Splunk, Elastic, Datadog, Grafana, every infra team

---

## Beginner's Guide

### What's this in plain English?

Your company runs 10,000 servers. Each emits logs ("user X clicked Y", "DB query took 450ms", "ERROR: out of memory"). When something breaks at 3am, you need to **search those logs across all servers** in seconds — "show me every ERROR in the last hour." That's distributed logging.

### Why solve it?

- **Real world**: Splunk, ELK (Elastic), Datadog Logs, Grafana Loki, AWS CloudWatch Logs.
- **Teaches**: massive ingest (10M+ logs/sec), search at scale, retention tiering (hot/cold), schema-on-read.

### Vocabulary

- **Log** — a structured or text record from a process.
- **Ingest** — write logs into the system at high volume.
- **Index** — pre-built data structure for fast search.
- **Hot / Warm / Cold** — recent / medium-age / archived storage tiers.
- **TTL / Retention** — how long logs are kept (cost trade-off).

### High-level architecture

```
App servers → Log agent (Fluentd) → Kafka → Indexer workers → Search layer
                                                ↓
                                       Hot store (SSDs, last 7 days)
                                       Cold store (S3, 90 days+)
```

Components:
1. **Agents** on every host stream logs.
2. **Kafka** absorbs the spike; smooths bursts.
3. **Indexers** parse logs, write to Elasticsearch (or similar).
4. **Hot tier**: fast SSD; recent + frequently queried.
5. **Cold tier**: S3; cheap; queries are slow.

Search: full-text + structured filters + time-range. Result is sometimes truncated or sampled.

### How to read this doc

- **Beginner**: focus on ingest pipeline + tiered storage.
- **Interview**: cross-questions on schema flexibility, query performance, retention tiering.

---

## 0. How to use this doc in an interview

Distributed logging tests **high-volume ingest + searchable storage + retention tiering**. Tests:
1. Massive ingest (10M+ logs/sec).
2. Indexing for search.
3. Tiered storage (hot vs warm vs cold).
4. Per-tenant isolation.

Trap: confusing this with metrics monitoring (separate doc). Logs are unstructured text + fields; metrics are numeric + labels.

---

## 1. Problem Statement

A distributed logging service:
- Ingest log lines from millions of sources.
- Each log: timestamp, source, level, body, structured fields.
- Search by free-text or fields, time range.
- Tail (live).
- Multi-tenant.
- Retention 30-90 days hot; archive longer.

---

## 2. Clarifying Questions

- [ ] Structured (JSON) only or unstructured?
- [ ] Real-time tail required?
- [ ] Search latency target?
- [ ] Retention window + tiers?
- [ ] Compliance (PII redaction)?

> **Assume:** mixed; tail yes; search < 5s for last 24 hr; retention 30 d hot + 1 yr cold; PII redaction on configurable fields.

---

## 3. Functional Requirements

**P0:**
1. Push API for log ingestion.
2. Index (full-text + field).
3. Search by free-text + filters + time range.
4. Live tail (subscribe).
5. Multi-tenant isolation.
6. Retention tiers + auto-archive.

**P1:**
7. Alerts on patterns (regex match → notify).
8. Aggregations (count by level).
9. Saved searches.

**P2:**
10. Anomaly detection.
11. Trace integration.

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.99% (ingest), 99.9% (search) |
| Ingest | 10M lines/sec sustained |
| Search P99 (last 24h) | < 5 s |
| Tail latency | < 2 s ingest → tail |
| Storage | 30 d hot, 12 mo cold |

---

## 5. Capacity Estimation

```
Ingest: 10M lines/sec × 500 bytes = 5 GB/sec = 430 TB/day
30 days hot: 13 PB compressed (~5x compression typical)
1 year cold: 150 PB compressed
Index size: ~30% of raw (per-shard inverted index)
```

---

## 6. API

```
POST /v1/logs                  body: [{ts, source, level, msg, fields}, ...]
GET  /v1/search?q=&start=&end=&tenant=
WS   /v1/tail?filter=
```

---

## 7. Data Model

### Hot tier (Elasticsearch / OpenSearch)
- Per-tenant indices, time-bucketed (hourly).
- Inverted index for full-text + field index.

### Cold tier (S3 + index)
- Compressed Parquet/ORC blocks.
- Indexed via separate columnar index for query.

### Routing
- Per-tenant pipelines.
- Sharded by hash(tenant_id, ts).

---

## 8. Architecture

```
              ┌──────────────────────┐
              │    Sources           │
              │ (apps, agents)       │
              └──────────┬───────────┘
                         │ batched HTTP push
                         ▼
                ┌────────────────────┐
                │  Ingest Gateway    │
                │  - validate         │
                │  - route by tenant │
                │  - PII redact       │
                └────────┬───────────┘
                         │
                         ▼
                ┌────────────────────┐
                │  Kafka              │
                │  topic: logs        │
                └────┬───────────┬────┘
                     │           │
                     ▼           ▼
                ┌──────────┐  ┌──────────────┐
                │ Indexer  │  │ Tail Service │
                │ (writes  │  │ (subscribers)│
                │  to ES)  │  │              │
                └────┬─────┘  └──────────────┘
                     ▼
              ┌────────────────────┐
              │  Hot tier (ES)     │
              │  30 days           │
              └─────┬──────────────┘
                    │ rotated daily
                    ▼
              ┌────────────────────┐
              │  Cold tier (S3)    │
              │  Parquet blocks    │
              └────────────────────┘

              ┌────────────────────┐
              │  Search Service    │
              │  - hot: ES         │
              │  - cold: S3 scan   │
              │  - merge results   │
              └────────────────────┘
```

---

## 9. Component Deep-Dives

### 9.1 Ingest Gateway
- Auth via tenant token.
- Batched (1k lines per request typical).
- Validate schema; redact PII fields per config.
- Forward to Kafka with tenant + timestamp partition key.

### 9.2 Kafka
- Buffer for downstream backpressure.
- Replay-able.
- Partitioned by tenant for isolation.

### 9.3 Indexer
- Consumes Kafka; bulk-indexes to ES.
- Per-tenant index; daily rotation.
- Handles index creation, mapping.

### 9.4 Hot tier (ES)
- Sharded per-tenant per-day.
- Recent: 30 days kept hot for fast search.
- Memory cache for active queries.

### 9.5 Cold tier
- ES indices > 30 days exported to S3 as Parquet.
- Each day's logs = N Parquet files (sharded).
- Lightweight columnar index (sketch) for query routing.

### 9.6 Search Service
- Parse query.
- For hot range: query ES.
- For cold range: spin up Spark/Presto on S3.
- Merge results; paginate.

### 9.7 Tail Service
- Subscribe to filter.
- Reads Kafka (live tail) + recent ES.
- WS push to subscriber.

---

## 10. Hard Sub-Problems

### 10.1 Cardinality explosion
- Free-text indexing of high-cardinality fields.
- ES handles up to billions of unique tokens; beyond, query slow.
- Mitigation: schema hints (mark high-card fields as not_analyzed).

### 10.2 Tenant isolation
- Hot tenants don't crowd out smaller tenants.
- Per-tenant ES cluster (heavyweight) or namespaced indices with rate quotas.

### 10.3 Cold tier search latency
- Searching 1-yr range = scan many S3 files.
- Pre-filter with sketches (date range, tenant range).
- Parallelize via Spark.
- Trade: 5s hot → 60s cold.

### 10.4 Schema drift
- Logs from different sources have different fields.
- Dynamic mapping in ES (auto-detect).
- Cap mapping size to prevent runaway.

---

## 11. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| ES for hot | Fast full-text + field search | Cost per GB |
| S3 for cold | Cheap archival | Slower search |
| Kafka buffer | Backpressure absorption | Operational complexity |
| Per-tenant indices | Isolation | Many shards |
| Daily index rotation | Hot tier manageable | Index churn |

---

## 12. Cross-Questions ≥ 12

### 12.1 Why ES and not Splunk?
- ES: open source; horizontally scales.
- Splunk: proprietary; powerful but expensive.
- Most modern stacks: OpenSearch (Elasticsearch fork).

### 12.2 Why daily index rotation?
- 30-day retention → 30 indices.
- Drop oldest by deleting index (instant).
- Each index size manageable.

### 12.3 Why partition Kafka by tenant?
- Per-tenant ordering.
- Isolation: noisy tenant doesn't slow another's pipeline.

### 12.4 What about high-volume tenants?
- Sub-partition by tenant + hash(source).
- Per-tenant rate quotas at gateway.

### 12.5 How is search ranking done?
- Default: time-ordered (most recent first).
- Field match boosts.
- Fuzzy matching for free-text.

### 12.6 How is structured logging handled?
- JSON logs parsed; fields indexed individually.
- Plain-text logs: indexed as full-text.

### 12.7 What's PII redaction?
- Per-tenant config: regex patterns to redact.
- Run at ingest.
- Better at source (if app already redacts).

### 12.8 How is tail implemented?
- Read live Kafka stream + filter.
- Subscriber gets matching lines pushed.

### 12.9 What about log sampling?
- High-volume tenants may sample (1 in N).
- Configurable per source.

### 12.10 How are alerts evaluated?
- Streaming: query against live Kafka.
- E.g. "ERROR > 100 in last 5 min" → alert.
- Out of scope of base; separate alerting service.

### 12.11 What's the failure mode if ES shard is down?
- Replica serves.
- If both replicas: query fails for that shard.
- Search might return partial; surface degradation.

### 12.12 How is cost optimized?
- Compression (Lucene + LZ4).
- Cold tier cheaper.
- Tenant tier limits (free vs paid).

---

## 13. Cheat-Sheet

1. **Ingest Gateway** → Kafka → Indexer → ES (hot).
2. **Hot tier (ES)** for 30 days; sharded per-tenant.
3. **Cold tier (S3)** for archive; Parquet blocks.
4. **Search merges** hot + cold results.
5. **Tail Service** consumes Kafka live.
6. **Per-tenant** indices for isolation.
7. **Daily rotation** for hot tier management.

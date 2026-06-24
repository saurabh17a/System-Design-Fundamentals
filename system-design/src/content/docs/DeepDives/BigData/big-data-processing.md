# Introduction to Big Data — Deep Dive

> **Type:** Core concept
> **Tags:** `[big-data]` `[batch]` `[stream-processing]` `[mapreduce]` `[analytics]`
> **Where it shows up:** [ad-click-aggregator](../../HLD/ad-click-aggregator.md), [metrics-monitoring](../../HLD/metrics-monitoring.md), [youtube-top-k](../../HLD/youtube-top-k.md), [news-aggregator](../../HLD/news-aggregator.md), and any "compute analytics over a firehose of data" prompt

---

## Mental model

"Big data" means data too large or fast for a single machine to process in the time you have — so you **distribute the computation across a cluster** and bring the *code to the data* rather than the data to the code. The defining question shifts from "how do I store this row?" to "how do I run a computation over billions of rows / a never-ending stream, in parallel, and tolerate machines failing mid-job?"

In system design, big data shows up whenever you must **aggregate, transform, or analyze high-volume data**: counting ad clicks, computing trending topics, building recommendation features, aggregating metrics. The core decision is almost always **batch vs stream processing** — process a large bounded dataset periodically, or process an unbounded flow continuously as it arrives.

## The 3 (or more) V's

A quick framing vocabulary: **Volume** (too big for one machine), **Velocity** (arriving too fast to process one-at-a-time synchronously), **Variety** (structured, semi-structured, unstructured). The Vs are why normal databases/queries don't suffice and you reach for distributed processing.

## Batch processing

Process a **large, bounded dataset all at once**, usually on a schedule (hourly/daily).

- **MapReduce** — the foundational model: **Map** (transform each record into key-value pairs, in parallel across the cluster) → **Shuffle** (group all values by key, moving data across the network) → **Reduce** (aggregate the values for each key). Classic example: word count — map each word to `(word, 1)`, reduce by summing per word. The framework handles distribution, retries on node failure, and data locality.
- **Spark** — the modern successor: keeps intermediate data **in memory** (vs MapReduce writing to disk between stages), making iterative jobs (ML, multi-step pipelines) far faster, with a richer API (SQL, DataFrames, ML libs).
- **Strengths:** high throughput, processes enormous volumes efficiently, simple to reason about (bounded input → output), fault-tolerant (re-run failed tasks).
- **Weakness:** **latency** — results are only as fresh as the last batch (minutes to hours). You're always looking at the past.

**Use batch for:** daily reports, training datasets, large backfills, ETL into a warehouse, anything where hour-old results are fine.

## Stream processing

Process an **unbounded flow of events continuously**, as they arrive, producing results in near-real-time.

- Events flow through a stream ([Kafka](../Messaging/kafka.md)) into a stream processor (**Flink**, **Spark Streaming**, **Kafka Streams**) that maintains running state and emits results continuously.
- **Windowing** is central — since the stream never ends, you compute over **windows**: tumbling (fixed, non-overlapping 1-min buckets), sliding (overlapping), or session windows. "Clicks per minute," "trending in the last hour" are windowed aggregations.
- **Event time vs processing time** — events can arrive **late or out of order** (a mobile event delayed by a bad network). Processing by *event time* (when it happened) with **watermarks** (a heuristic for "we've probably seen all events up to time T") gives correct windowed results despite lateness — a subtle, interview-worthy point.
- **Strengths:** low latency (seconds), results reflect *now*.
- **Weaknesses:** harder — stateful, must handle late/out-of-order/duplicate events, exactly-once is tricky (lean on idempotency).

**Use stream for:** real-time dashboards, fraud/anomaly detection, live counts (ad clicks, [trending](../../HLD/youtube-top-k.md)), monitoring/alerting.

## Lambda and Kappa architectures

How systems combine (or avoid combining) the two — name-drop appropriately:

- **Lambda** — run **both** a batch layer (slow, accurate, reprocesses everything) and a speed/stream layer (fast, approximate, recent data), then **merge** them at query time. You get real-time *and* eventually-corrected accuracy — at the cost of maintaining **two codebases/pipelines** for the same logic (the main criticism).
- **Kappa** — **stream-only**: treat everything as a stream; to "reprocess," just replay the log (Kafka retention) through the same streaming code. One codebase; simpler; relies on a replayable log. Increasingly preferred when the stream processor is powerful enough.

## Where the data lives: lake vs warehouse

- **Data lake** — store **raw** data (any format) cheaply at scale, usually in [object storage](../Databases/object-blob-storage.md) (S3). Schema-on-read: structure is applied when you query. Flexible, cheap, the input to batch jobs.
- **Data warehouse** — store **structured, cleaned** data optimized for analytical queries (columnar storage, e.g. Redshift/BigQuery/Snowflake). Schema-on-write. Fast aggregations over huge tables.
- **OLTP vs OLAP** — your app's transactional DB (OLTP: many small reads/writes, row-oriented) is *not* where you run analytics (OLAP: few huge scans/aggregations, column-oriented). You **ETL/stream** data out of OLTP into a lake/warehouse so analytics doesn't crush production.

## Tradeoffs & decisions

- **Latency vs throughput/accuracy** — batch (high throughput, accurate, stale) vs stream (low latency, approximate, complex). The defining axis.
- **Lambda vs Kappa** — accuracy + real-time via two pipelines vs simplicity via stream-only + replay.
- **Lake vs warehouse** — cheap flexible raw storage vs fast structured analytics; many systems use both (lake → transform → warehouse).
- **Exactly-once cost** — true exactly-once in streaming is hard; design idempotent outputs / accept at-least-once + dedup.

## When to use / when not

**Reach for big-data processing when:** the dataset or event rate exceeds one machine and you need to **aggregate/transform/analyze** it — counting/trending at scale, building features, ETL, monitoring pipelines. Batch for periodic bounded jobs; stream for continuous near-real-time.

**Don't when:** the data fits comfortably in a database and a SQL `GROUP BY` answers the question — a distributed cluster is massive overkill for a million rows. Reserve it for genuine volume/velocity.

## Common interview follow-ups

- *"Batch or stream for this?"* → freshness requirement decides: hour-old fine → batch; need-it-now → stream.
- *"How do you count ad clicks / trending topics at scale?"* → stream into Kafka → windowed aggregation in a stream processor; batch layer for accurate reprocessing if using Lambda. ([ad-click-aggregator](../../HLD/ad-click-aggregator.md), [youtube-top-k](../../HLD/youtube-top-k.md))
- *"Events arrive late/out of order — how do you get correct windows?"* → event-time processing with watermarks; allowed-lateness handling.
- *"Lambda vs Kappa?"* → two pipelines (batch + speed) for accuracy+latency vs stream-only with replay for simplicity.
- *"Why not run analytics on the production DB?"* → OLTP isn't built for huge scans; ETL/stream into a warehouse/lake (OLAP) to protect production.

## Gotchas

- **Running analytics on the OLTP database** — big aggregations crush the production store; isolate analytics in a warehouse/lake.
- **Ignoring late/out-of-order events** in streaming → wrong windowed counts; use event time + watermarks.
- **Assuming exactly-once for free** — streaming is effectively at-least-once; make outputs idempotent.
- **Maintaining two pipelines (Lambda) carelessly** — batch and stream logic drift apart and disagree; Kappa avoids this when feasible.
- **Reaching for Spark/Hadoop on small data** — distributed overhead dwarfs the work; use a DB until volume forces a cluster.
- **Confusing a data lake with a warehouse** — raw/cheap/schema-on-read vs structured/fast/schema-on-write; many pipelines need both.

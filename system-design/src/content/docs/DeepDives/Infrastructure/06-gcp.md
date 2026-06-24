---
title: GCP
---

# GCP (Google Cloud Platform) — Deep Dive

> **Type:** Core technology
> **Tags:** `[infrastructure]` `[cloud]` `[gcp]`
> **Where it shows up:** The data/Kubernetes-strong cloud; concrete services for [cloud building blocks](03-cloud-building-blocks.md)

---

## Mental model

GCP is Google's cloud, distinguished by **Google's heritage in containers, data, and global networking**. Google invented Kubernetes and runs planet-scale data systems internally, and GCP exposes that lineage: best-in-class **GKE** (managed [Kubernetes](02-kubernetes.md)), unique data products (**Spanner**, **BigQuery**), and Google's private global network. It's a frequent pick for **data-heavy, analytics, ML, and container-native** workloads. Same building blocks as everywhere ([cloud building blocks](03-cloud-building-blocks.md)); here are GCP's names and standout services.

## Flagship services by category

- **Compute:** **Compute Engine** (VMs), **Cloud Functions** (serverless), **Cloud Run** (serverless containers — run any container, scale to zero; a favorite for its simplicity), **GKE** (managed [Kubernetes](02-kubernetes.md), the reference implementation).
- **Object storage:** **Cloud Storage** ([object store](../Databases/object-blob-storage.md)) with tiered classes.
- **Relational DB:** **Cloud SQL** (managed Postgres/MySQL/SQL Server), **AlloyDB** (Postgres-compatible, higher performance).
- **Globally-distributed SQL:** **Spanner** — the standout: a **horizontally-scalable, strongly-consistent, globally-distributed relational database** with SQL and external consistency (uses TrueTime synchronized clocks). The concrete example of "NewSQL" that breaks the usual scale-vs-consistency tradeoff ([CAP](../Coordination/cap-and-consistency-models.md), [picking-the-right-database](../Databases/picking-the-right-database.md)).
- **NoSQL:** **Bigtable** (wide-column, the [Cassandra](../Databases/nosql-cassandra.md)/HBase lineage — Google's original, for massive time-series/analytics), **Firestore** (document, real-time sync).
- **Analytics/Big Data:** **BigQuery** — serverless data warehouse for huge analytical queries; the marquee [big-data](../BigData/big-data-processing.md) service. **Dataflow** (managed stream/batch processing).
- **Cache:** **Memorystore** ([Redis](../Caching/redis.md)).
- **Messaging:** **Pub/Sub** — globally-scalable [pub/sub](../Messaging/realtime-pubsub.md)/[event stream](../Messaging/kafka.md), a single service covering both queue and stream needs.
- **Networking/edge:** **Cloud CDN** ([CDN](../Caching/cdn.md)), **Cloud DNS** ([DNS](../Networking/dns.md)), **Cloud Load Balancing** (a single global anycast [LB](../Networking/load-balancers.md) — one IP, global), **VPC**.
- **Identity/secrets:** **Cloud IAM**, **Secret Manager**.
- **Observability:** **Cloud Operations** (formerly Stackdriver — metrics/logs/traces; see [observability](07-observability.md)).

## What's distinctive

- **GKE** — the best managed Kubernetes, unsurprising given Google created K8s.
- **Spanner** — globally-distributed *and* strongly-consistent SQL; the textbook example that NewSQL can offer horizontal scale without giving up transactions/consistency.
- **BigQuery** — serverless, petabyte-scale analytics with no cluster to manage; a standout for data warehousing.
- **Global load balancing & network** — a single global anycast IP routing to the nearest healthy backend over Google's private backbone.
- **Cloud Run** — exceptionally simple container-to-serverless deploys.

## When you'd pick GCP

- **Data/analytics/ML-heavy** systems (BigQuery, Dataflow, Vertex AI), **container-native** teams (GKE/Cloud Run), or when you want **Spanner's** global-consistency-at-scale.
- When global load balancing and Google's network latency matter.

## Common interview follow-ups

- *"Globally-distributed, strongly-consistent relational DB?"* → **Spanner** — the answer that breaks the scale-vs-consistency tradeoff ([picking-the-right-database](../Databases/picking-the-right-database.md)).
- *"Petabyte analytical queries / data warehouse?"* → **BigQuery** ([big-data-processing](../BigData/big-data-processing.md)).
- *"Managed Kubernetes / simple serverless containers?"* → **GKE** / **Cloud Run**.
- *"Queue and stream?"* → **Pub/Sub** covers both ([queues-vs-streams](../Messaging/queues-vs-streams.md)).
- *"Wide-column at massive scale?"* → **Bigtable** ([Cassandra](../Databases/nosql-cassandra.md) lineage).

## Gotchas

- **Spanner cost** — powerful but expensive; use it when you genuinely need global strong consistency at scale, not as a default Postgres.
- **BigQuery pricing** — billed largely by data scanned per query; un-partitioned tables / `SELECT *` scan everything and rack up cost — partition/cluster tables and select columns.
- **Bigtable modeling** — wide-column row-key design like [Cassandra](../Databases/nosql-cassandra.md); a bad row key = hotspots.
- **Service renames** — Stackdriver → Cloud Operations; recognize the role.
- **Single-region / over-broad IAM** — multi-region for DR, least privilege always ([redundancy-and-recovery](../Resiliency/redundancy-and-recovery.md)).

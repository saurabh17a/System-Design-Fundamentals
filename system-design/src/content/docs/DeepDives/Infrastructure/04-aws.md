---
title: AWS
---

# AWS (Amazon Web Services) — Deep Dive

> **Type:** Core technology
> **Tags:** `[infrastructure]` `[cloud]` `[aws]`
> **Where it shows up:** The most common deployment target in interviews; concrete services for [cloud building blocks](03-cloud-building-blocks.md)

---

## Mental model

AWS is the **largest and oldest** major cloud — the broadest service catalog and the default vocabulary in most system design discussions. If you name one cloud's services in an interview, it's usually AWS. The mental model is the same as [cloud building blocks](03-cloud-building-blocks.md): pick the service by the *role* it plays in your design. This page maps the building blocks to AWS's flagship names and the few quirks worth knowing.

## Flagship services by category

- **Compute:** **EC2** (VMs), **Lambda** (serverless functions), **Fargate** (serverless containers), **EKS** (managed [Kubernetes](02-kubernetes.md)), **ECS** (AWS's own container orchestrator — simpler than EKS).
- **Object storage:** **S3** — the canonical [object store](../Databases/object-blob-storage.md); ~11 nines durability, the default answer for media/blobs/backups. Often the first AWS service mentioned in any design.
- **Relational DB:** **RDS** (managed Postgres/MySQL/etc.) and **Aurora** (AWS's cloud-native, higher-performance MySQL/Postgres-compatible engine with storage that auto-scales and replicates across AZs).
- **NoSQL:** **DynamoDB** — fully-managed key-value/wide-column ([NoSQL](../Databases/nosql-cassandra.md)) with single-digit-ms latency, on-demand scaling, and tunable consistency. The go-to for massive-scale key-based access.
- **Cache:** **ElastiCache** ([Redis](../Caching/redis.md)/Memcached).
- **Messaging:** **SQS** (managed [queue](../Messaging/queues-vs-streams.md)), **SNS** (pub/sub fan-out), **Kinesis** (managed [event stream](../Messaging/kafka.md)), **MSK** (managed Kafka).
- **Networking/edge:** **CloudFront** ([CDN](../Caching/cdn.md)), **Route 53** ([DNS](../Networking/dns.md) with health-checked, latency/geo routing), **ELB/ALB/NLB** ([load balancers](../Networking/load-balancers.md) — ALB is L7, NLB is L4), **VPC** (isolated virtual network).
- **Identity/secrets:** **IAM** (the granular access-control model everything flows through), **Secrets Manager**, **KMS** (encryption keys).
- **Observability:** **CloudWatch** (metrics/logs/alarms — see [observability](07-observability.md)), **X-Ray** (tracing).

## What's distinctive

- **Breadth & maturity** — the widest catalog and deepest ecosystem; if a capability exists in the cloud, AWS has it (often several ways).
- **S3 and DynamoDB** are category-defining and frequently referenced by name even by non-AWS users.
- **IAM is powerful but complex** — extremely granular policies; misconfiguration (public S3 buckets, over-broad roles) is a classic security incident (the **shared-responsibility** "your side").
- **Regions/AZs** — AWS pioneered the region + multiple-AZ model; multi-AZ for HA, multi-region for DR ([redundancy-and-recovery](../Resiliency/redundancy-and-recovery.md)).

## When you'd pick AWS

- Default when the org is already on AWS, when you want the broadest service selection, or when an interviewer expects AWS vocabulary.
- DynamoDB for serverless-scale key-value; S3 as the universal blob layer; Aurora when you want managed relational with cloud-native scaling.

## Common interview follow-ups

- *"Where do the uploaded files go?"* → **S3**, URL in the DB, served via **CloudFront** ([object storage](../Databases/object-blob-storage.md), [CDN](../Caching/cdn.md)).
- *"Managed database?"* → **RDS/Aurora** for relational, **DynamoDB** for key-value at scale.
- *"Queue vs stream on AWS?"* → **SQS** for task queues, **Kinesis/MSK** for replayable streams ([queues-vs-streams](../Messaging/queues-vs-streams.md)).
- *"L4 or L7 load balancer?"* → **NLB** (L4) vs **ALB** (L7).
- *"Serverless option?"* → **Lambda** (functions) or **Fargate** (containers); mind cold starts/limits.

## Gotchas

- **Public S3 buckets / loose IAM** — the most common AWS breach vector; least privilege, block public access.
- **Single-AZ deployments** — use multi-AZ for production HA.
- **DynamoDB modeling** — like [Cassandra](../Databases/nosql-cassandra.md), you model around access patterns and partition keys; a bad key = hot partitions, not a relational afterthought.
- **Egress/data-transfer cost** — cross-region and internet egress add up; CDN + locality reduce it.
- **`latest`/un-versioned everything** — pin versions; treat infra as reproducible.

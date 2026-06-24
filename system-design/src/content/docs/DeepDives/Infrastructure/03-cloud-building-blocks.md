---
title: Cloud Building Blocks
---

# Cloud Building Blocks (AWS · Azure · GCP) — Deep Dive

> **Type:** Core concept
> **Tags:** `[infrastructure]` `[cloud]` `[aws]` `[azure]` `[gcp]` `[managed-services]`
> **Where it shows up:** Every "how would you deploy this?" — maps the abstract components in your designs to real managed services

---

## Mental model

In a system design interview you draw boxes — load balancer, queue, object store, database, cache. **The cloud is where those boxes become real managed services you rent instead of run.** The skill isn't memorizing service names; it's knowing **which category of building block solves which problem**, and that all three big clouds offer the *same categories* under different names. Pick the building block by its role in your design; the vendor name is a detail.

The deeper point is **managed vs self-hosted**: the cloud's value is offloading undifferentiated heavy lifting (patching, replication, failover, scaling) to the provider so you focus on your product. A "managed database" means the provider handles backups, replication, and failover — you get [durability and availability](../../Methodology/03-what-makes-a-good-system.md) without operating it. The tradeoff is cost, less control, and lock-in.

## The building blocks (by category)

Every cloud-deployed system composes these. Match each to the concept it implements:

| Building block | What it is / concept | AWS | Azure | GCP |
|---|---|---|---|---|
| **Virtual machines** | rent compute by the hour | EC2 | Virtual Machines | Compute Engine |
| **Containers (managed K8s)** | run [containers](01-containers-docker.md) at scale ([K8s](02-kubernetes.md)) | EKS | AKS | GKE |
| **Serverless functions** | run code per-event, no servers | Lambda | Functions | Cloud Functions |
| **Serverless containers** | run a container, scale to zero | Fargate / App Runner | Container Apps | Cloud Run |
| **Object storage** | blobs/media ([object storage](../Databases/object-blob-storage.md)) | S3 | Blob Storage | Cloud Storage |
| **Block storage** | disks for VMs | EBS | Managed Disks | Persistent Disk |
| **Relational DB** | managed SQL ([SQL](../Databases/sql-relational.md)) | RDS / Aurora | Azure SQL / DB for PostgreSQL | Cloud SQL / AlloyDB |
| **Globally-distributed DB** | horizontally-scaled strong consistency | DynamoDB / Aurora | Cosmos DB | Spanner |
| **NoSQL / wide-column** | [Cassandra](../Databases/nosql-cassandra.md)-style | DynamoDB / Keyspaces | Cosmos DB | Bigtable / Firestore |
| **Cache** | in-memory ([Redis](../Caching/redis.md)) | ElastiCache | Cache for Redis | Memorystore |
| **Message queue** | task queues ([queues](../Messaging/queues-vs-streams.md)) | SQS | Service Bus / Queue Storage | Pub/Sub, Tasks |
| **Event stream** | log/streaming ([Kafka](../Messaging/kafka.md)) | Kinesis / MSK | Event Hubs | Pub/Sub / Managed Kafka |
| **CDN** | edge caching ([CDN](../Caching/cdn.md)) | CloudFront | Front Door / CDN | Cloud CDN |
| **DNS** | [DNS](../Networking/dns.md) + routing | Route 53 | Azure DNS / Traffic Manager | Cloud DNS |
| **Load balancer** | L4/L7 ([LB](../Networking/load-balancers.md)) | ELB/ALB/NLB | Load Balancer / App Gateway | Cloud Load Balancing |
| **Search** | full-text ([Elasticsearch](../Search/elasticsearch.md)) | OpenSearch | Cognitive Search | — / Elastic |
| **Secrets** | credential storage | Secrets Manager | Key Vault | Secret Manager |
| **Identity / access** | who-can-do-what (IAM) | IAM | Entra ID / RBAC | Cloud IAM |
| **Observability** | metrics/logs ([observability](07-observability.md)) | CloudWatch | Monitor | Cloud Operations |

The table is the interview cheat sheet: name the *block* you need; the column is just which cloud you're in.

## Cross-cutting cloud concepts

- **Regions & Availability Zones** — a **region** is a geographic area; it contains multiple **AZs** (isolated datacenters). Deploy across **multiple AZs** for high availability (survive a datacenter loss) and across **regions** for disaster recovery / global latency ([redundancy-and-recovery](../Resiliency/redundancy-and-recovery.md), [DNS geo-routing](../Networking/dns.md)).
- **Shared responsibility model** — the provider secures the *cloud* (hardware, hypervisor, managed-service internals); **you** secure what's *in* it (your data, access policies, app). Misconfiguration (a public S3 bucket) is *your* side.
- **IAM / least privilege** — every resource access is governed by identity policies; grant the minimum needed.
- **Managed vs self-hosted** — managed services (RDS, managed K8s) trade control and cost for offloaded ops; self-hosting on VMs gives control at the cost of you running everything.
- **Pay-as-you-go & elasticity** — rent capacity, scale up/down with demand, autoscale; cost becomes an [architectural dimension](../../Methodology/03-what-makes-a-good-system.md) (tier cold data to cheap storage, right-size, scale to zero with serverless).
- **Lock-in** — deeper use of proprietary managed services (DynamoDB, Spanner) increases switching cost; portable choices (containers, open protocols) reduce it. A real tradeoff to name.

## Tradeoffs & decisions

- **Managed vs self-hosted** — less ops + built-in HA/durability vs more control + no lock-in + sometimes lower cost.
- **Serverless vs containers vs VMs** — scale-to-zero + no infra mgmt (but cold starts, limits, cost at high volume) vs flexible long-running services ([K8s](02-kubernetes.md)) vs full control (VMs).
- **Multi-AZ vs multi-region** — AZ redundancy is cheap HA; multi-region is expensive DR/global latency. Match to your availability target.
- **Single-cloud vs multi-cloud** — multi-cloud avoids lock-in and broadens DR but multiplies complexity; most teams pick one and use it well.
- **Proprietary vs portable** — proprietary services are powerful and integrated but lock you in; portability (containers, Postgres, Kafka) hedges.

## When to use / what to reach for

- **Default to managed services** for databases, caches, queues, and object storage — running them yourself is undifferentiated work and the managed versions give HA/durability/backups for free.
- **Serverless** for spiky/event-driven workloads and glue; **managed containers/K8s** for steady services at scale; **VMs** when you need full control or specialized setups.
- **Multi-AZ always** for production; **multi-region** when the cost of an outage or global latency justifies it.

## Common interview follow-ups

- *"What would you use to deploy this?"* → name the building blocks (LB + container service + managed DB + cache + object storage + queue), then map to the chosen cloud's names.
- *"S3 / blob storage for what?"* → media and large blobs, URL in the DB; serve via CDN ([object storage](../Databases/object-blob-storage.md)).
- *"How do you make it highly available in the cloud?"* → multi-AZ deployment + managed DB with failover + autoscaling + multi-region for DR.
- *"Managed DB or run your own?"* → managed by default (offloads backups/replication/failover); self-host only for control/special needs.
- *"Serverless or containers here?"* → serverless for event-driven/spiky + scale-to-zero (watch cold starts/limits); containers for steady, complex, long-running services.
- *"How do you avoid lock-in?"* → favor portable building blocks (containers, open protocols) where it matters; accept lock-in where the managed service's value is high.

## Gotchas

- **Memorizing service names instead of categories** — interviewers want the *building block* and *why*, not trivia; the names differ per cloud (see the table).
- **Single-AZ production** — a datacenter blip takes you down; spread across AZs.
- **Public buckets / over-broad IAM** — the shared-responsibility trap; misconfiguration is your fault, not the cloud's.
- **Ignoring egress/data-transfer cost** — cross-region/cross-cloud data movement is a surprise bill; CDN and locality help.
- **Serverless for everything** — cold starts, execution limits, and per-invocation cost make it wrong for steady high-throughput or long-running work.
- **Deep proprietary lock-in without acknowledging it** — fine if intentional, a problem if accidental.

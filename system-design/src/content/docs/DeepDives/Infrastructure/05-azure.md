---
title: Azure
---

# Azure (Microsoft Azure) — Deep Dive

> **Type:** Core technology
> **Tags:** `[infrastructure]` `[cloud]` `[azure]`
> **Where it shows up:** The enterprise/Microsoft-ecosystem cloud; concrete services for [cloud building blocks](03-cloud-building-blocks.md)

---

## Mental model

Azure is Microsoft's cloud — the **default in enterprises and Microsoft-centric shops** (Windows, .NET, Active Directory, Office 365). Its biggest differentiator is **identity and hybrid**: deep integration with **Entra ID** (formerly Azure AD) and strong on-prem/cloud hybrid story, which is why large enterprises with existing Microsoft estates lean Azure. The building blocks are the same as everywhere ([cloud building blocks](03-cloud-building-blocks.md)); this maps them to Azure's names and quirks.

## Flagship services by category

- **Compute:** **Virtual Machines**, **Azure Functions** (serverless), **Container Apps** (serverless containers), **AKS** (managed [Kubernetes](02-kubernetes.md)), **App Service** (managed PaaS for web apps — popular for quick .NET/Node hosting).
- **Object storage:** **Blob Storage** ([object store](../Databases/object-blob-storage.md)) with hot/cool/archive tiers.
- **Relational DB:** **Azure SQL Database** (managed SQL Server) and **Azure Database for PostgreSQL/MySQL**.
- **Globally-distributed DB:** **Cosmos DB** — multi-model (key-value/document/column/graph), **globally distributed with multiple well-defined consistency levels** (from strong to eventual) and turnkey multi-region writes. Azure's signature data service.
- **Cache:** **Azure Cache for Redis** ([Redis](../Caching/redis.md)).
- **Messaging:** **Service Bus** (enterprise [queue](../Messaging/queues-vs-streams.md)/pub-sub with sessions, ordering, dead-lettering), **Queue Storage** (simple queue), **Event Hubs** (managed [event stream](../Messaging/kafka.md), Kafka-protocol compatible), **Event Grid** (event routing).
- **Networking/edge:** **Front Door** ([CDN](../Caching/cdn.md) + global L7 entry), **Azure DNS** + **Traffic Manager** ([DNS](../Networking/dns.md) routing), **Load Balancer** (L4) + **Application Gateway** (L7 [LB](../Networking/load-balancers.md)), **Virtual Network**.
- **Identity/secrets:** **Entra ID** (identity — the crown jewel), **RBAC**, **Key Vault** (secrets/keys).
- **Observability:** **Azure Monitor** + **Application Insights** ([observability](07-observability.md), tracing).

## What's distinctive

- **Identity-first & hybrid** — Entra ID and hybrid (Azure Arc, on-prem integration) make Azure the natural choice for enterprises already on Microsoft identity/AD.
- **Cosmos DB's tunable consistency** — exposes a clear five-level consistency spectrum (strong → bounded-staleness → session → consistent-prefix → eventual), a great concrete example of the [consistency models](../Coordination/cap-and-consistency-models.md) discussion.
- **App Service** — a mature PaaS that abstracts infra for web apps (no container/K8s needed for simple cases).
- **.NET / Windows first-class** — best home for Microsoft-stack workloads.

## When you'd pick Azure

- The org runs on Microsoft (AD/Entra, .NET, Office 365) or needs strong **hybrid** cloud/on-prem.
- You want Cosmos DB's globally-distributed multi-model store with explicit consistency knobs, or App Service's quick PaaS hosting.

## Common interview follow-ups

- *"Globally-distributed database with consistency control?"* → **Cosmos DB** (five consistency levels) — a clean tie-in to [CAP/consistency](../Coordination/cap-and-consistency-models.md).
- *"Where do blobs go?"* → **Blob Storage** + **Front Door**/CDN.
- *"Enterprise queue with ordering/dead-letter?"* → **Service Bus** ([queues-vs-streams](../Messaging/queues-vs-streams.md)).
- *"Kubernetes / quick web hosting?"* → **AKS** for orchestration, **App Service**/**Container Apps** for simpler PaaS.
- *"Identity?"* → **Entra ID** + RBAC — Azure's strength.

## Gotchas

- **Service sprawl/renames** — Azure renames things (Azure AD → Entra ID); know the current name but recognize the role.
- **Cosmos DB RU pricing** — throughput is provisioned in Request Units; under-provisioning throttles, over-provisioning is costly; model access patterns like any [NoSQL](../Databases/nosql-cassandra.md).
- **L4 vs L7** — **Load Balancer** (L4) vs **Application Gateway** (L7); pick by need ([load balancers](../Networking/load-balancers.md)).
- **Single-region defaults** — design multi-AZ/region for HA/DR ([redundancy-and-recovery](../Resiliency/redundancy-and-recovery.md)).
- **Over-broad RBAC** — least privilege still applies; the shared-responsibility "your side."

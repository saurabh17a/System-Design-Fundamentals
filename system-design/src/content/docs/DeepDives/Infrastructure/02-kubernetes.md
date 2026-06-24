---
title: Kubernetes
---

# Kubernetes — Deep Dive

> **Type:** Core technology
> **Tags:** `[infrastructure]` `[orchestration]` `[kubernetes]` `[scaling]` `[self-healing]`
> **Where it shows up:** The orchestration layer for [containerized](01-containers-docker.md) services at scale; pairs with [load balancers](../Networking/load-balancers.md), [resiliency](../Resiliency/designing-for-resiliency.md), [cloud platforms](03-cloud-building-blocks.md)

---

## Mental model

Once you have [containers](01-containers-docker.md), running a handful by hand is fine. But running **hundreds across many machines** — restarting crashed ones, scaling with load, rolling out new versions without downtime, networking them together, surviving node failures — is a full-time job. **Kubernetes (K8s) is the system that does that job for you.** It's a **container orchestrator**: you declare the *desired state* ("I want 5 replicas of this service"), and Kubernetes continuously works to make reality match.

The single most important concept is **declarative + reconciliation**: you don't tell K8s *how* ("start a container here"), you tell it *what* ("5 replicas should exist"), and a control loop constantly compares desired vs actual and fixes the difference. A pod dies → K8s notices the count dropped to 4 → it starts a new one. That reconciliation loop is the source of its self-healing, scaling, and rollout powers.

## Internals

### The core objects (the vocabulary)

- **Pod** — the smallest unit: one (or a few tightly-coupled) containers sharing a network/storage context. Pods are **ephemeral and disposable** — they get created, killed, and rescheduled; you never depend on a specific pod.
- **Deployment** — declares "N replicas of this pod template" and manages rollouts/rollbacks. The thing you usually create for a stateless service.
- **Service** — a **stable virtual IP + DNS name** that load-balances across the (ever-changing) set of pods behind it. Because pods come and go, you talk to the Service, not pods directly. Solves the "pods have no fixed address" problem.
- **Ingress** — routes external HTTP(S) traffic to Services (host/path rules, TLS) — the L7 entry point ([load balancers](../Networking/load-balancers.md)).
- **ConfigMap / Secret** — inject configuration and credentials into pods (config separate from image).
- **StatefulSet** — like a Deployment but for **stateful** pods that need stable identity and storage (databases); **PersistentVolumes** provide durable storage that outlives a pod.
- **Namespace** — logical partitioning of a cluster (teams/environments).

### Architecture: control plane + nodes

- **Control plane** — the brain. The **API server** (everything goes through it), **etcd** (the consistent key-value store holding all cluster state — see [zookeeper-etcd](../Coordination/zookeeper-etcd.md)), the **scheduler** (decides which node a new pod runs on), and **controllers** (the reconciliation loops).
- **Worker nodes** — run your pods. Each runs a **kubelet** (talks to the control plane, manages pods on that node) and a container runtime.
- **Desired state lives in etcd**; controllers watch it and reconcile. This is why etcd (and thus [consensus](../Coordination/consensus-raft-paxos.md)) is the backbone — the cluster's source of truth must be consistent and highly available.

### What you get "for free" from reconciliation

- **Self-healing** — crashed pods/failed nodes → workloads rescheduled automatically ([resiliency](../Resiliency/designing-for-resiliency.md)).
- **Horizontal scaling** — change replica count, or let the **Horizontal Pod Autoscaler** scale on CPU/custom metrics.
- **Rolling updates & rollbacks** — gradually replace old pods with new, with health gating; roll back on failure — zero-downtime deploys.
- **Service discovery & load balancing** — Services + cluster DNS.
- **Bin packing** — the scheduler places pods onto nodes efficiently within resource requests/limits.

### Health checks

K8s uses **liveness** (restart if unhealthy), **readiness** (don't send traffic until ready), and **startup** probes. These drive self-healing and safe rollouts — a pod failing readiness is pulled from its Service's pool, exactly like an LB health check.

## Tradeoffs & decisions

- **Power vs complexity** — K8s is enormously capable and enormously complex. It's the right tool for many services at scale; it's overkill for a single app or a small team (a managed PaaS or plain containers + a load balancer may serve better).
- **Managed vs self-hosted** — running your own control plane (etcd, upgrades, security) is hard; most teams use **managed K8s** (EKS/GKE/AKS) to offload it. See [cloud-building-blocks](03-cloud-building-blocks.md).
- **Stateless vs stateful** — K8s shines for stateless services (Deployments). Stateful workloads (databases) are possible (StatefulSets + PersistentVolumes) but harder; many teams keep databases on managed cloud services *outside* the cluster.
- **Resource requests/limits** — set them well or the scheduler bin-packs poorly and pods get OOM-killed or throttled.

## When to use / when not

**Use Kubernetes when:**
- You run **many containerized services** that need automated scaling, self-healing, rolling deploys, and service discovery across a fleet of machines.
- You have the operational maturity (or a managed offering) to run it, and the scale justifies the complexity.

**Don't reach for it when:**
- You have **one or a few simple apps** — a managed container service (Cloud Run, ECS, App Service) or even a VM + [load balancer](../Networking/load-balancers.md) is simpler and cheaper. "We'll use Kubernetes" for a small system is a classic over-engineering flag.
- Your team can't operate it and there's no managed option — the complexity becomes the risk.

## Common interview follow-ups

- *"What problem does Kubernetes solve?"* → running many containers across many machines: scheduling, scaling, self-healing, rollouts, networking — via declarative desired state + reconciliation.
- *"Pod vs container vs deployment vs service?"* → container runs in a pod (smallest unit, ephemeral); a Deployment manages N replica pods; a Service gives a stable address load-balancing across them.
- *"How does self-healing work?"* → controllers reconcile actual vs desired; a dead pod drops the count, so a replacement is scheduled; etcd holds desired state.
- *"How do zero-downtime deploys work?"* → rolling update replaces pods gradually, gated by readiness probes; roll back on failure.
- *"How do pods talk to each other if they're ephemeral?"* → through Services (stable virtual IP + DNS), never pod IPs directly.
- *"Do you need Kubernetes here?"* → only if the scale/number of services justifies the complexity; otherwise a managed container platform.
- *"Where does cluster state live?"* → etcd (consistent, consensus-backed); the API server is the single front door.

## Gotchas

- **Reaching for K8s on a small system** — the complexity dwarfs the benefit; use managed containers or a PaaS.
- **Treating pods as pets** — they're cattle; never rely on a pod's identity/IP. Use Services and externalize state.
- **No resource requests/limits** — leads to bad scheduling, noisy neighbors, and OOM kills.
- **Missing/incorrect readiness probes** — traffic hits pods that aren't ready, or rollouts cut over before the new version is serving.
- **Running stateful databases in-cluster casually** — storage/identity/backup are hard; prefer managed DBs unless you know what you're doing.
- **Self-managing the control plane unnecessarily** — etcd ops and upgrades are a burden; use managed K8s if you can.
- **Confusing Service types** — ClusterIP (internal) vs NodePort vs LoadBalancer vs Ingress; pick the right external-exposure mechanism.

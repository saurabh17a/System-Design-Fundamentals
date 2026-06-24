# What Makes a Good System? (Non-Functional Requirements)

> **Type:** Guide
> **Read this:** after [how-to-approach](02-how-to-approach.md) — these are the qualities that drive step 2 (NFRs) and every architectural choice.

---

## The idea

A system that *works* on your laptop and a system that's *good* in production are different things. "Good" is measured by **non-functional requirements** — the qualities that don't change *what* the system does but decide *whether you can run it at scale, survive failures, and afford it.* When an interviewer pushes on your design, they're almost always probing one of these dimensions. Knowing them by name — and the metrics and tactics for each — is how you reason instead of guess.

## Scalability

**Can the system grow with load without a rewrite?**

- **Vertical scaling** (bigger machine) — simple, but a hard ceiling and a single point of failure. Surprisingly far-reaching; try it first.
- **Horizontal scaling** (more machines) — the real answer at scale; requires **stateless** app servers (state in DB/cache/[session store](../DeepDives/Caching/redis.md)) so any server handles any request behind a [load balancer](../DeepDives/Networking/load-balancers.md).
- Data scaling: [replication](../DeepDives/Distribution/replication.md) for reads, [sharding](../DeepDives/Distribution/sharding-partitioning.md) for writes/storage.
- **Test:** "10× the users tomorrow — what do you change?" A good design answers "add more instances," not "rewrite."

## Availability

**What fraction of the time is the system up and serving?**

| "Nines" | Downtime/year | Typical use |
|---|---|---|
| 99% | ~3.65 days | internal tools |
| 99.9% | ~8.8 hours | most web apps |
| 99.99% | ~52 min | serious products |
| 99.999% | ~5 min | critical infra |

Each nine is dramatically harder and costlier. Achieved through **redundancy** (no single point of failure), **failover**, health checks, and graceful degradation — see [resiliency](../DeepDives/Resiliency/designing-for-resiliency.md). Note the [CAP](../DeepDives/Coordination/cap-and-consistency-models.md) tension: under a partition, strong consistency can *cost* availability.

## Latency & performance

**How fast does each operation feel?**

- Measure **percentiles, not averages** — p50, **p99**, p99.9. The average hides the tail; the slowest 1% is what users complain about and what cascades under load.
- **Latency** (time per request) vs **throughput** (requests/sec) — distinct, sometimes traded against each other (batching boosts throughput, hurts latency).
- Levers: [caching](../DeepDives/Caching/caching-strategies.md), [CDNs](../DeepDives/Caching/cdn.md), indexes, denormalization, doing slow work [asynchronously](../DeepDives/Messaging/asynchronous-processing.md), geographic proximity ([DNS](../DeepDives/Networking/dns.md)).
- Rough budgets: memory ns, SSD µs–ms, **same-DC RTT ~0.5ms, cross-continent RTT ~150ms**. The speed of light is a real constraint.

## Consistency

**Do all users see the same, latest data?**

- A spectrum, not a switch: **strong / linearizable** → causal → **eventual**, plus client-centric guarantees like **read-your-own-writes**. See [cap-and-consistency-models](../DeepDives/Coordination/cap-and-consistency-models.md).
- **Decide per data path:** strong for money/inventory/bookings; eventual (often + read-your-writes) for feeds/likes/counts. One global setting for the whole system is a red flag.
- Stronger consistency costs latency and availability (PACELC) — pay for it only where correctness demands.

## Durability

**Once we accept data, will we ever lose it?**

- Achieved by writing to disk (WAL/commit log) and **replicating across machines/AZs**; object stores reach ~11 nines via replication + erasure coding ([object storage](../DeepDives/Databases/object-blob-storage.md)).
- Distinct from availability: data can be **durable but temporarily unavailable** (safe on disk, but the serving node is down).
- Distinct from backups: replicas faithfully copy a bad delete too — you still need point-in-time backups ([redundancy-and-recovery](../DeepDives/Resiliency/redundancy-and-recovery.md)).
- Set the bar by data type: a financial ledger tolerates zero loss; a view counter can lose a few events.

## Reliability & fault tolerance

**Does it keep working correctly when components fail?** At scale, failure is constant — disks die, networks partition, nodes hang. A reliable system **expects failure and contains it**: redundancy, retries with backoff, [circuit breakers](../DeepDives/Resiliency/circuit-breakers.md), timeouts, bulkheads, idempotency so retries are safe. "What happens when *this* dies?" should have an answer for every box. See [designing-for-resiliency](../DeepDives/Resiliency/designing-for-resiliency.md).

## Maintainability & observability

Often overlooked, genuinely senior:

- **Observability** — metrics, logs, traces. You can't operate what you can't see; "how would you know this is broken?" is a fair interview question ([metrics-monitoring](../HLD/metrics-monitoring.md), [distributed-logging](../HLD/distributed-logging.md)).
- **Operability** — deploys, rollbacks, config changes without downtime.
- **Simplicity** — fewer moving parts fail in fewer ways. The simplest design meeting the NFRs is usually the best one.

## Cost

Every nine, every replica, every cross-region copy costs money. A good design is **economically** sensible: cache to cut DB load, tier old data to cheap [storage](../DeepDives/Databases/object-blob-storage.md), right-size redundancy to the actual availability target. "Why not just replicate everything everywhere?" — because it's expensive; match spend to requirements.

## Security

Authentication, authorization, encryption in transit (TLS) and at rest, [rate limiting](../HLD/rate-limiter.md) and abuse prevention, least privilege, PII handling/compliance. Rarely the focus of a scaling interview but a credibility signal when you mention it at the right moments (auth at the API edge, encryption for sensitive data).

## How these interact — there is no free lunch

The dimensions **trade against each other**, which is why "good" is contextual:

- **Consistency ↔ Availability** (CAP) and **Consistency ↔ Latency** (PACELC).
- **Latency ↔ Throughput** (batching).
- **Durability/Availability ↔ Cost** (more replicas, more regions).
- **Scalability ↔ Simplicity** (distributed systems are harder to operate).

A good system isn't one that maxes every dimension — it's one that **hits the targets that matter for its requirements and consciously sacrifices the rest.** That conscious sacrifice, stated out loud, is exactly what an interviewer wants to hear. Back to [how-to-approach](02-how-to-approach.md) to see where these plug into the method.

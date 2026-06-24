# Designing for Resiliency — Deep Dive

> **Type:** Core concept
> **Tags:** `[resiliency]` `[fault-tolerance]` `[availability]` `[failure]`
> **Where it shows up:** Every "what happens when X fails?" follow-up — [payment-system](../../HLD/payment-system.md), [whatsapp](../../HLD/whatsapp.md), [notification-system](../../HLD/notification-system.md), and any high-availability requirement

---

## Mental model

At scale, **failure is not an exception — it's the steady state.** With thousands of machines, something is always dying: a disk fails, a network partitions, a process hangs, a dependency slows to a crawl, a deploy goes bad. Resiliency is **designing so that individual failures don't become system failures.** The goal isn't to prevent failure (impossible) — it's to **contain** it: detect fast, isolate the blast radius, degrade gracefully, and recover automatically.

The interview reflex this builds: for every component you draw, you should be able to answer **"what happens when this dies, and how does the system keep serving?"** before the interviewer asks. That single habit separates senior answers from junior ones.

## Eliminate single points of failure (redundancy)

A **single point of failure (SPOF)** is any component whose death takes down the system. The first move in resiliency is to find and remove them with **redundancy** — more than one of everything on the critical path:

- **Stateless app servers** behind a [load balancer](../Networking/load-balancers.md) — any can die; the LB routes around it via health checks. (Statelessness is the enabler — state lives in the DB/[cache](../Caching/redis.md).)
- **Database [replication](../Distribution/replication.md)** — a replica is promoted when the primary dies (failover).
- **Redundant load balancers** — active-active or active-passive with a floating IP, so the LB itself isn't a SPOF.
- **Multi-AZ / multi-region** — survive a whole datacenter loss; [DNS](../Networking/dns.md)/anycast reroutes.

Redundancy modes: **active-active** (all handle traffic; capacity + instant failover, but must coordinate) vs **active-passive** (standby takes over on failure; simpler, but the standby is idle and failover has a gap).

## Detect failure (the hard, underrated part)

You can't route around a failure you can't see — and you can't reliably tell "dead" from "slow":

- **Health checks** — the LB/orchestrator probes endpoints and pulls unhealthy instances. Check real health (can it serve?), not just "port open."
- **Heartbeats** — nodes periodically signal liveness; missing beats trigger action. Tuning matters: too sensitive → flapping on a GC pause; too lax → slow detection.
- **Timeouts** — *every* network call needs one. A call without a timeout waits forever on a hung dependency, exhausting threads/connections — the seed of a cascading failure.

## Contain failure (stop the blast radius)

Once detected, prevent one failure from spreading:

- **Timeouts** — fail fast instead of hanging (above).
- **Retries with exponential backoff + jitter** — recover from *transient* faults. But naive retries amplify load on a struggling dependency (a **retry storm**); cap attempts, back off exponentially, and add jitter so clients don't retry in lockstep. Retries require **idempotency** to be safe.
- **[Circuit breakers](circuit-breakers.md)** — stop calling a failing dependency entirely for a cooldown, so you don't pile requests onto something already down and you fail fast. The key pattern for dependency failure.
- **Bulkheads** — isolate resources (separate thread/connection pools per dependency) so one slow dependency can't consume *all* capacity and sink everything. Named after ship compartments.
- **Rate limiting / load shedding** — under overload, reject or queue excess work to protect the core rather than collapse entirely ([rate-limiter](../../HLD/rate-limiter.md)).

## Degrade gracefully

A resilient system **does something useful when a dependency is down**, instead of erroring out:

- Serve **stale cache** when the source is unavailable (stale-while-revalidate).
- Return a **default / partial** response (e.g. hide the recommendations widget but render the page).
- Disable a non-critical feature to protect the core flow (e.g. checkout works even if reviews are down).
- **Fail open vs fail closed** — choose deliberately per feature: a recommendation service fails *open* (show generic content); an auth check fails *closed* (deny).

The principle: **the failure of a non-critical dependency should never take down a critical path.** Map which dependencies are critical vs optional and design the optional ones to be droppable.

## Recover automatically

Resilient systems self-heal without a human at 3am:

- **Auto-failover** — promote a replica / standby (often via [leader election](../Coordination/zookeeper-etcd.md), with fencing to avoid split-brain).
- **Auto-scaling / self-healing** — restart crashed processes, replace bad instances, scale out under load.
- **Idempotency + retries + queues** — a [queue](../Messaging/queues-vs-streams.md) buffers work while a consumer is down and redelivers when it's back; idempotent processing makes redelivery safe.
- **Data recovery** — backups + restore for the cases redundancy can't fix (bad writes, corruption) — see [redundancy-and-recovery](redundancy-and-recovery.md).

## Cascading failures — the thing that takes whole systems down

The failure mode interviewers love: one slow/failed component causes callers to pile up (no timeouts), exhaust threads/connections, and **fail themselves**, propagating upstream until everything is down. Prevention is the toolkit above working together: **timeouts** (don't wait), **circuit breakers** (stop calling the sick service), **bulkheads** (contain resource exhaustion), **load shedding** (drop excess), and **backpressure** (signal upstream to slow down). A "thundering herd" / retry storm on recovery is the sibling problem — fix with jittered backoff and gradual ramp-up.

## Tradeoffs & decisions

- **Resilience vs cost** — redundancy means paying for idle/extra capacity; match the level to the availability target.
- **Resilience vs complexity** — circuit breakers, bulkheads, multi-region add moving parts (and their own failure modes). Add them where the blast radius justifies it.
- **Fail open vs fail closed** — availability vs safety, decided per feature.
- **Aggressive vs lax failure detection** — fast failover vs false positives (flapping) on transient blips.
- **Consistency vs availability on failover** — promoting a replica may lose un-replicated async writes ([replication](../Distribution/replication.md)).

## Common interview follow-ups

- *"What happens when this server/DB/dependency dies?"* → redundancy + health-check failover; for a dependency, circuit breaker + graceful degradation.
- *"How do you prevent a cascading failure?"* → timeouts + circuit breakers + bulkheads + load shedding; never an unbounded wait or unbounded retry.
- *"How do retries not make it worse?"* → capped, exponential backoff, jitter, idempotent operations, circuit breaker in front.
- *"How do you hit 99.99% availability?"* → remove SPOFs (redundant everything), auto-failover, multi-AZ, graceful degradation, observability to detect fast.
- *"A non-critical service is down — does the page still load?"* → yes; degrade (default/partial/stale), fail open for optional features.

## Gotchas

- **No timeout on a network call** — the root cause of most cascading failures; a hung dependency exhausts your threads.
- **Retry storms** — synchronized, uncapped retries DoS a recovering service; backoff + jitter + circuit breaker.
- **Redundancy that shares a failure domain** — two "replicas" in the same rack/AZ, or both behind the same SPOF, aren't redundant.
- **Failover without fencing** → split-brain (two primaries) corrupting data ([replication](../Distribution/replication.md), [zookeeper-etcd](../Coordination/zookeeper-etcd.md)).
- **Treating durability as resilience** — data safe on disk doesn't help if the only node serving it is down; availability and durability are different.
- **Ignoring graceful degradation** — letting an optional dependency's outage hard-fail the whole request.
- **Untested failover/backups** — a recovery path you've never exercised will fail when you need it.

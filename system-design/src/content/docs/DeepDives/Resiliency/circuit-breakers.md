# Circuit Breakers — Deep Dive

> **Type:** Core concept
> **Tags:** `[resiliency]` `[fault-tolerance]` `[microservices]` `[cascading-failure]`
> **Where it shows up:** [payment-system](../../HLD/payment-system.md), [uber](../../HLD/uber.md), any microservice calling a flaky dependency
> **Implementation:** see the working [circuit-breaker (Go)](../../MachineCoding/Go/circuit-breaker.md) / [circuit-breaker (Python)](../../MachineCoding/Python/circuit-breaker.md) in Machine Coding

---

## Mental model

A circuit breaker borrows the idea from electrical wiring: when current spikes dangerously, the breaker **trips** and cuts the circuit to prevent a fire — and you flip it back later. In software, it wraps calls to a dependency (a downstream service, DB, API) and, when that dependency starts failing, **stops sending requests to it** for a while. Instead of every call hanging on a timeout and piling up, calls **fail fast** (or fall back) until the dependency looks healthy again.

The problem it solves is specific and critical: **a slow or failing dependency, left unchecked, drags down its callers too.** Requests block on timeouts, threads and connections exhaust, the caller stops responding, *its* callers pile up — a [cascading failure](designing-for-resiliency.md). The circuit breaker is the standard pattern to break that chain at the dependency boundary.

## The three states

A circuit breaker is a small state machine wrapping each protected dependency:

```
                failures exceed threshold
   ┌────────┐ ───────────────────────────► ┌────────┐
   │ CLOSED │                                │  OPEN  │
   │(normal)│ ◄─────────────────────────────│ (trip) │
   └────────┘     probe succeeds             └────────┘
        ▲                                         │
        │                                         │ after cooldown timer
        │   probe fails ┌──────────────┐ ◄────────┘
        └───────────────│  HALF-OPEN   │
                        │ (trial call) │
                        └──────────────┘
```

- **CLOSED (normal):** requests flow through. The breaker counts failures (and/or tracks the failure *rate* over a rolling window). If failures cross the threshold, it **trips → OPEN**.
- **OPEN (tripped):** requests are **rejected immediately** without calling the dependency — fail fast, return an error or a [fallback](#fallbacks). This gives the sick dependency room to recover and protects the caller's resources. After a **cooldown** timer, it moves to **HALF-OPEN**.
- **HALF-OPEN (testing):** allow a **limited number of trial requests** through. If they succeed, the dependency has recovered → **CLOSED**. If they fail, → back to **OPEN** and reset the timer. This probes for recovery without flooding a still-broken dependency.

## Why fail-fast matters

Without a breaker, when a dependency hangs:

1. Each request waits the full timeout (say 30s).
2. Threads/connections stay tied up waiting.
3. New requests queue; the pool exhausts.
4. The caller becomes unresponsive — it has now failed *because* of the dependency.

With a breaker OPEN, step 1 becomes "reject in microseconds." The caller stays healthy, returns fast (error or fallback), and stops hammering the thing that's already down. **Fail-fast is the whole point** — a quick, clean failure is far better than a slow, resource-exhausting one.

## Key parameters (the tuning knobs)

- **Failure threshold** — how many failures (or what failure *rate* over a rolling window) trips it. Rate-based (e.g. ">50% of the last 20 calls failed") is more robust than a raw count.
- **Cooldown / open duration** — how long to stay OPEN before probing. Too short → you re-hammer a recovering service; too long → slow to recover when it's actually back.
- **Half-open trial count** — how many probes decide recovery.
- **What counts as a failure** — timeouts and 5xx yes; a 4xx (client error) usually shouldn't trip the breaker (it's not the dependency's health). Define this carefully.

## Fallbacks

A breaker pairs naturally with **graceful degradation** — when OPEN, instead of just erroring you can:

- Return **cached/stale** data ([caching-strategies](../Caching/caching-strategies.md)).
- Return a **default / empty** response (hide an optional widget).
- Route to a **backup** provider/region.
- Queue the work for later ([async processing](../Messaging/asynchronous-processing.md)).

Choose **fail open vs fail closed** per feature: a recommendations call fails *open* (generic content); a fraud/auth check fails *closed* (deny). See [designing-for-resiliency](designing-for-resiliency.md).

## Related patterns (don't confuse them)

- **Retry** — handles *transient* blips by trying again (with backoff/jitter). Circuit breaker handles *sustained* failure by *stopping* tries. They compose: retry within CLOSED, but the breaker trips when retries keep failing — and a breaker prevents retries from becoming a storm.
- **Timeout** — bounds a single call's wait; the breaker decides whether to make the call at all. Timeouts feed the breaker (a timeout counts as a failure).
- **Bulkhead** — isolates resource pools so one dependency can't starve others; the breaker stops calling, the bulkhead limits the damage while it's still being called.
- **Rate limiter** — protects *you* from too many *inbound* requests; the breaker protects you from a failing *outbound* dependency. Opposite directions.

## Tradeoffs & decisions

- **Protection vs false trips** — a too-sensitive threshold trips on a transient blip and needlessly degrades a healthy path; too lax and it doesn't protect you. Tune with real failure-rate data.
- **Fail fast vs availability** — an OPEN breaker sacrifices that feature's availability to protect the system; mitigate with a good fallback.
- **Per-dependency state** — each dependency needs its own breaker (one slow service shouldn't trip calls to a healthy one); combine with bulkheads.
- **Added complexity** — it's a stateful wrapper with tuning and monitoring needs; worth it on critical cross-service calls, overkill for in-process logic.

## When to use / when not

**Use a circuit breaker for:** synchronous calls to **external or downstream dependencies** that can fail/slow independently — service-to-service calls in a microservice mesh, third-party APIs, calls across the network. The classic microservices resiliency primitive.

**Don't bother for:** in-process function calls (no network, no independent failure), or fire-and-forget [async](../Messaging/asynchronous-processing.md) work where a queue + retry already absorbs failure. Also unnecessary if you have exactly one dependency and failing means failing anyway — though fast-fail still helps.

## Common interview follow-ups

- *"How do you stop one slow service from taking down its callers?"* → circuit breaker (fail fast when it's failing) + timeouts + bulkheads.
- *"Walk me through the states."* → CLOSED counts failures → trips to OPEN (reject fast) → after cooldown HALF-OPEN probes → CLOSED on success / OPEN on failure.
- *"What does the user see when it's open?"* → a fallback: cached/default/partial response, or a fast clean error — graceful degradation.
- *"Breaker vs retry?"* → retry for transient faults; breaker for sustained failure; together, with the breaker preventing retry storms.
- *"How do you tune it?"* → failure-*rate* threshold over a rolling window, cooldown matched to realistic recovery time, exclude client (4xx) errors.

## Gotchas

- **Tripping on client errors** — counting 4xx as failures trips the breaker on bad requests, not dependency health; exclude them.
- **One global breaker for all dependencies** — a single flaky service trips calls to healthy ones; use per-dependency breakers + bulkheads.
- **No fallback** — an OPEN breaker that just errors still degrades UX; pair with a sensible fallback.
- **Cooldown too short** — half-open probes re-hammer a recovering service and flap OPEN↔HALF-OPEN; match cooldown to recovery time.
- **Retries without a breaker** — retries alone amplify load on a failing dependency (retry storm); the breaker is what stops them.
- **Forgetting to monitor breaker state** — an OPEN breaker is a signal something's down; alert on trips, don't let them hide outages.

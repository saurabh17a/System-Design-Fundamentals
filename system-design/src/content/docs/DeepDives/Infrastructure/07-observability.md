---
title: Observability
---

# Observability — Metrics, Logs & Traces — Deep Dive

> **Type:** Core concept
> **Tags:** `[infrastructure]` `[observability]` `[metrics]` `[logging]` `[tracing]` `[sli-slo]`
> **Where it shows up:** "How would you know it's broken?" in every design — [metrics-monitoring](../../HLD/metrics-monitoring.md), [distributed-logging](../../HLD/distributed-logging.md), [resiliency](../Resiliency/designing-for-resiliency.md)

---

## Mental model

**Observability is your ability to understand what a system is doing from the outside — to answer questions you didn't know to ask in advance.** Monitoring tells you *whether* something is wrong (a dashboard, an alert); observability lets you ask *why* (drill from "errors are up" to the exact failing service, request, and line). At scale, with dozens of services and constant partial failures, you can't operate what you can't see — so "how would you detect and debug this?" is a fair interview question for any design.

It rests on **three pillars** — metrics, logs, and traces — each answering a different question. Knowing what each is *for* (and its cost) is the core of the topic.

## The three pillars

### Metrics — "is something wrong, and how much?"

Numeric time-series aggregates: request rate, error rate, latency percentiles, CPU, queue depth. **Cheap to store** (pre-aggregated numbers), great for **dashboards and alerting**, and the basis of trends. But they're aggregates — they tell you *that* p99 latency spiked, not *which* requests or *why*.

- Track the **RED** method for services (Rate, Errors, Duration) and **USE** for resources (Utilization, Saturation, Errors).
- Always **percentiles, not averages** — p50/p95/**p99**; the tail is what hurts ([what-makes-a-good-system](../../Methodology/03-what-makes-a-good-system.md)).
- Stored in time-series DBs (Prometheus, etc.); this is the [metrics-monitoring](../../HLD/metrics-monitoring.md) system.

### Logs — "what exactly happened?"

Timestamped, discrete event records. The detail metrics lack — the actual error message, the stack trace, the request params. **High-cardinality and expensive** at volume, so you sample/retain selectively. **Structured logging** (JSON with fields: request_id, user, latency) beats free text — it's queryable. Centralized via a log pipeline ([distributed-logging](../../HLD/distributed-logging.md)) so you can search across all services, not SSH into boxes.

### Traces — "where did the time go across services?"

A **distributed trace** follows a single request as it hops across services, recording a **span** per hop with timing and parent/child relationships. This is what makes microservices debuggable: "this checkout took 3s — the trace shows 2.8s was in the fraud service calling a slow DB." Works by propagating a **trace ID** (and span IDs) through every call (HTTP headers / context). OpenTelemetry is the standard instrumentation; Jaeger/Zipkin/Tempo store and visualize.

**The pillars compose:** a metric alert ("error rate up") → logs ("NullPointer in payment-svc") → trace ("triggered by the new pricing service timing out"). Each narrows the search.

## SLI / SLO / SLA — turning signals into objectives

Observability isn't just data — it's measuring against **targets**:

- **SLI (Service Level Indicator)** — a measured signal: "% of requests < 200ms", "success rate". What you actually compute from metrics.
- **SLO (Service Level Objective)** — your *internal target* for an SLI: "99.9% of requests succeed over 30 days." Drives alerting and engineering priorities.
- **SLA (Service Level Agreement)** — a *contractual* promise to customers (with penalties), usually looser than the SLO.
- **Error budget** — `100% − SLO`. A 99.9% SLO allows ~43 min/month of failure. Spend it on risk (ship fast) until it's exhausted, then freeze and stabilize. This reframes reliability as a *budget*, not "never fail."

## Alerting

Alerts should be **actionable and symptom-based** — alert on *user-facing symptoms* (SLO burn: error rate, latency) rather than every cause (one CPU at 90%). Too many alerts → fatigue → ignored pages. Tie alerts to error-budget burn rate. This connects to [resiliency](../Resiliency/designing-for-resiliency.md): you must *detect* fast to fail over fast.

## Tradeoffs & decisions

- **Detail vs cost** — metrics are cheap aggregates; logs and traces are detailed but expensive at volume. **Sample** traces/logs (keep all errors, sample the rest), tier retention to cheap [storage](../Databases/object-blob-storage.md), and aggregate where possible.
- **Cardinality** — high-cardinality labels (user_id on a metric) explode time-series storage; keep metric dimensions bounded, push detail to logs/traces.
- **Instrumentation effort vs insight** — tracing requires propagating context through every service; the payoff is microservice debuggability. OpenTelemetry standardizes it.
- **Symptom vs cause alerting** — alert on user-facing SLOs (fewer, meaningful pages) vs every resource blip (noise).

## When to use / what to reach for

- **Metrics + dashboards + SLO alerts** — always; the baseline for knowing the system's health and being paged on real problems.
- **Centralized structured logs** — for debugging the specifics; essential once you have more than one server.
- **Distributed tracing** — once you have **multiple services** per request; it's how you find *where* latency/errors originate. Less critical for a monolith.

## Common interview follow-ups

- *"How would you know this system is broken / how do you monitor it?"* → metrics for health + SLO-based alerts (RED/USE, p99); logs for detail; traces for cross-service latency.
- *"Metrics vs logs vs traces?"* → aggregates (is it wrong, how much) vs discrete events (what happened) vs per-request cross-service timing (where).
- *"What's an SLO / error budget?"* → target for an SLI (e.g. 99.9% success); error budget = allowed failure; spend it on velocity, freeze when exhausted.
- *"How do you trace a request across microservices?"* → propagate a trace ID through every call; each hop emits a span; assemble into a trace (OpenTelemetry + Jaeger/Tempo).
- *"How do you avoid alert fatigue?"* → alert on user-facing symptoms/SLO burn, not every cause; make every alert actionable.
- *"Logs are too expensive — what do you do?"* → structured logging + sampling (keep errors), retention tiering to cheap storage, push aggregates to metrics.

## Gotchas

- **Averages instead of percentiles** — the mean hides the tail; alert and report on p95/p99.
- **High-cardinality metric labels** — user_id/request_id as metric dimensions blow up storage; that detail belongs in logs/traces.
- **Logging everything at full volume** — cost explosion; sample non-errors, tier retention.
- **Cause-based alert spam** — paging on every CPU spike trains people to ignore alerts; alert on symptoms/SLOs.
- **Tracing without full propagation** — if one service drops the trace context, the trace breaks; instrument consistently (OpenTelemetry).
- **Treating monitoring as observability** — dashboards tell you *that* it broke; you also need the logs/traces to ask *why*.
- **No SLOs** — "is it healthy?" has no answer without defined objectives and error budgets.

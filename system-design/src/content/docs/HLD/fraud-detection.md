# Fraud Detection — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[stream-processing]` `[ml]` `[low-latency]` `[feature-store]` `[rules-engine]`
> **Prep time:** ~15 min skim, ~40 min deep read
> **Companies that ask this:** Stripe, PayPal, Visa, banks, Uber, Amazon, any payments/marketplace team

---

## Beginner's Guide

### What's this in plain English?

A user swipes a card or sends money. **In under ~100 ms**, the system must decide: allow, block, or challenge (step-up auth) — based on whether this looks fraudulent. It scores the transaction using **rules** ("card used in 2 countries in 5 minutes") and **ML models** (a learned fraud probability), using **features** about the user/card/device/history. Block too much → angry legit users; block too little → financial loss.

### Why solve it?

- **Real world**: payment processors, banks, marketplaces, account-takeover defense.
- **Teaches**: **real-time low-latency scoring**, **rules + ML hybrid**, **feature stores**, **stream processing** for behavioral features, and the **precision/recall** (false-positive vs false-negative) trade-off.

### Vocabulary

- **Feature** — a signal used to score (txn amount, velocity, device, geo distance).
- **Feature store** — serving layer for precomputed/real-time features at low latency.
- **Rules engine** — deterministic if-then checks (fast, explainable).
- **Model** — ML classifier outputting a fraud score.
- **Precision/recall** — false positives (block good users) vs false negatives (miss fraud).

### High-level architecture

```
Txn → Scoring API (sync, <100ms): rules + model + feature store → allow/block/challenge
   └→ Event stream (async): update features, label feedback, retrain, batch detection
```

A **fast synchronous path** decides now; an **async path** updates features, learns, and catches slower patterns.

### How to read this doc

- **Beginner**: focus on the sync scoring path + feature store.
- **Interview**: cross-questions on latency budget, rules-vs-ML, feature freshness, feedback loops, adversaries.

---

## 0. How to use this doc in an interview

This tests **real-time ML scoring under a tight latency budget** plus the **hybrid rules+ML** design and a **feature store**. Key insights: (1) the decision is **synchronous and latency-bound** (~100 ms) — so features must be **pre-served**, not computed on the fly; (2) combine **fast explainable rules** with **ML scores**; (3) an **async stream** updates behavioral features and feeds **retraining** via a feedback/label loop; (4) it's a **precision/recall trade-off**, tunable per risk. Traps: ignoring the latency budget, treating it as pure batch ML, and forgetting the adversarial/feedback nature.

---

## 1. Problem Statement

Score transactions/events for fraud in real time and act:
- For each transaction, return **allow / block / challenge** within a tight latency budget.
- Use rules + ML on user/card/device/behavioral features.
- Update behavioral features as events stream in.
- Feed outcomes back to improve models (feedback loop).
- Be explainable enough for disputes/compliance.

---

## 2. Clarifying Questions

- [ ] Latency budget for the decision? (assume < 100 ms p99)
- [ ] Actions: block only, or allow/block/challenge? (assume all three)
- [ ] Throughput? (assume 10k–100k txns/sec peak)
- [ ] Rules, ML, or both? (assume hybrid)
- [ ] Explainability/compliance needed? (assume yes)
- [ ] Feedback labels available (chargebacks, user reports)? (assume yes, delayed)

> **Assume:** <100ms sync decision, allow/block/challenge, hybrid rules+ML, explainable, delayed labels.

---

## 3. Functional Requirements

**P0:**
1. Score a transaction in real time → allow/block/challenge.
2. Hybrid: rules engine + ML model.
3. Serve features (user/card/device/behavioral) at low latency.
4. Log every decision with its reasons (explainability/audit).

**P1:**
5. Update behavioral features from a live event stream (velocity, recent geo).
6. Feedback loop: ingest chargebacks/reports as labels → retrain.
7. Batch/offline detection for slower patterns (rings, mules).

**P2:**
8. Online experimentation (champion/challenger models, shadow mode).
9. Case management UI for analysts.

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Decision latency | < 100 ms p99 (in the payment path) |
| Availability | 99.99% — must **fail safe** (degrade, not block everything) |
| Throughput | 10k–100k txns/sec |
| Feature freshness | behavioral features seconds-fresh |
| Accuracy | tunable precision/recall by risk tier |
| Auditability | every decision logged + explainable |

---

## 5. Capacity Estimation

```
Txns:           1B/day        ≈ 12k/sec avg, ~100k/sec peak
Per decision:   N features fetched (key-value, <10ms) + rules + model inference (<30ms)
Feature store:  per-entity (user/card/device) features, hot in memory → Redis/low-latency KV
Events:         each txn + signal → stream for feature updates & retraining
Models:         retrained daily/hourly offline; served online
```

**Bottleneck:** scoring within ~100 ms at 100k/sec. → **precomputed/served features** (no on-the-fly aggregation in the hot path), fast model inference, and the heavy lifting (feature computation, training) **offline/async**.

---

## 6. API

```
POST /score   {txn: {user, card, device, amount, geo, merchant, ts}}
              -> {decision: allow|block|challenge, score, reasons[], model_version}
(internal) txn/outcome events → stream (feature updates, labels)
GET  /decisions/{id}   -> audit record (features used, rules fired, score, reasons)
```

Synchronous `score` is in the payment path → strict timeout with a **fail-safe default** if a dependency is slow.

---

## 7. Data Model

- **Feature store (online):** per-entity features keyed by user/card/device/ip, served from a low-latency store ([Redis](../DeepDives/Caching/redis.md)/KV). Two kinds: **batch features** (computed offline: historical stats) and **real-time features** (updated from the stream: "txns in last 5 min", "distinct countries today").
- **Decisions log:** append-only (features used, rules fired, score, action, model version) for audit/explainability/training — high write volume → [Cassandra](../DeepDives/Databases/nosql-cassandra.md)/log store.
- **Labels:** chargebacks/user reports/manual reviews → join to past decisions to build training data (labels arrive **late**, days later).
- **Models:** versioned artifacts in a registry; served by an inference service.
- **Rules:** config store (hot-reloadable) for the rules engine.

---

## 8. Architecture

```
   Txn ──► Scoring API (sync, <100ms)
              │   ┌──────────────────────────────┐
              ├──►│ Feature store (Redis/KV)      │  fast feature fetch
              ├──►│ Rules engine (deterministic)  │  velocity/geo/blacklist
              ├──►│ ML inference (model server)   │  fraud score
              └──►│ Decision combiner → action    │  allow/block/challenge
                  └──────────────┬───────────────┘
                                 │ emit decision + features (async)
                                 ▼
                        Kafka (events, decisions)
                    ┌────────────┼─────────────────────┐
                    ▼            ▼                      ▼
            Stream processor   Decision log        Offline pipeline
            (update real-time  (Cassandra,         (join labels →
             features)          audit)              train models → registry)
```

- **Sync path:** fetch features → run rules + model → combine → act → log. All within the budget.
- **Async path:** events update real-time features (velocity, recent geo), persist the audit log, and feed the offline training pipeline; new model versions are pushed to the inference service.

---

## 9. Component Deep-Dives

### 9.1 The latency budget (why features are pre-served)
~100 ms total: feature fetch (<10 ms) + rules (<5 ms) + model inference (<30 ms) + overhead. You **cannot** compute "transactions in the last hour" by scanning a DB in the hot path — that work happens in the **[async stream](../DeepDives/Messaging/asynchronous-processing.md)** and the result is **pre-served** in the feature store. This separation (compute async, serve fast) is the central design idea.

### 9.2 Rules + ML hybrid
- **Rules:** fast, deterministic, explainable, instantly updatable ("block if card on blacklist", "challenge if >$X from new device"). Catch known patterns; great for compliance.
- **ML model:** learns subtle/novel patterns from features → a fraud probability. Higher recall on unknown fraud, but a black box.
- **Combine:** rules can hard-block/allow; the model score drives the gray zone; thresholds map score → allow/challenge/block. Hybrid gives explainability + adaptability.

### 9.3 Feature store
The heart of real-time ML. Serves **batch features** (offline-computed historical aggregates) and **real-time features** (stream-updated: velocity, recent geo distance, device-change). Must be low-latency (Redis/KV) and **consistent between training and serving** (the "training/serving skew" problem — compute features the same way in both).

### 9.4 Stream processing for behavioral features
A [stream processor](../DeepDives/BigData/big-data-processing.md) consumes the txn/event stream and maintains windowed aggregates per entity ("count/sum in last 1m/1h/1d", "distinct countries today"), writing them to the feature store. Handles the "velocity" features rules and models rely on.

### 9.5 Feedback loop & retraining
Fraud is **adversarial** — patterns shift as fraudsters adapt. Labels (chargebacks, reports) arrive **late**; an offline pipeline joins them to logged decisions/features → builds training data → retrains → registers a new model version → deployed (often via shadow/champion-challenger first). Continuous retraining is essential.

### 9.6 Fail-safe behavior
The scorer is in the payment path; if the model server or feature store is slow/down, **don't block all payments** (massive revenue/UX hit) and **don't blindly allow** (fraud hole). Use [timeouts + circuit breakers](../DeepDives/Resiliency/circuit-breakers.md) and a **degraded policy**: fall back to rules-only, or a conservative default by risk tier. Decide fail-open vs fail-closed per risk.

---

## 10. Hard Sub-Problems

### 10.1 Scoring within 100 ms at 100k/sec
Pre-serve features (no hot-path aggregation), fast inference (optimized/compact models, GPU/batched if needed), parallel feature fetch, strict timeouts. Heavy computation is always async.

### 10.2 Real-time feature freshness
Velocity features must reflect the **last few seconds** (rapid-fire fraud). Stream processing updates them continuously; the feature store serves them. Lag here = missed fast fraud.

### 10.3 Precision vs recall (the core trade-off)
Block too aggressively → false positives anger legit users and cost conversions; too leniently → fraud losses. Tune thresholds **per risk tier**, use **challenge** (step-up auth) for the gray zone instead of hard block, and measure both error types continuously.

### 10.4 Adversarial drift
Fraudsters adapt; static models decay. Continuous retraining, anomaly detection on new patterns, and fast rule updates for emerging attacks.

### 10.5 Training/serving skew
Features must be computed identically offline (training) and online (serving), or the model sees different inputs than it learned on. A shared feature definition / feature store mitigates this.

---

## 11. Cross-Questions

### 11.1 Why both rules and ML?
Rules: fast, explainable, instant updates for known patterns + compliance. ML: catches subtle/novel fraud. Hybrid covers each other's gaps.

### 11.2 Why a feature store / why precompute features?
The 100 ms budget forbids scanning history in the hot path; features (esp. velocity) are computed async and **served** fast. Also ensures train/serve consistency.

### 11.3 Sync or async — which parts?
**Decision is sync** (in the payment path, <100ms). **Feature updates, logging, training, batch detection are async** via the stream.

### 11.4 What if the model service is down?
Fail safe: timeout + [circuit breaker](../DeepDives/Resiliency/circuit-breakers.md) → degrade to rules-only / conservative default. Never block all payments or allow all.

### 11.5 How do you handle delayed labels?
Chargebacks/reports arrive days later; the offline pipeline joins them to logged decisions to build training data — retrain on a cadence.

### 11.6 Precision vs recall — how do you balance?
Tune per risk tier; use **challenge** for the gray zone; monitor false-positive (user friction) and false-negative (loss) rates; business sets the risk appetite.

### 11.7 How do you stay ahead of adapting fraudsters?
Continuous retraining, anomaly detection for novel patterns, rapid rule deployment, champion/challenger experimentation.

### 11.8 How is it explainable?
Log features used + rules fired + score + reasons per decision; rules are inherently explainable; use model explainability (feature attributions) for the ML part — needed for disputes/compliance.

### 11.9 How do you test a new model safely?
Shadow mode (score without acting), then champion/challenger A-B, compare precision/recall before promoting.

### 11.10 Batch detection too?
Yes — some fraud (rings, mule networks) only shows in aggregate; run offline graph/batch analysis ([big-data-processing](../DeepDives/BigData/big-data-processing.md)) alongside real-time scoring.

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| Hybrid rules + ML | Explainable + adaptive | Two systems to maintain |
| Pre-served features | Meets 100 ms budget | Feature freshness lag; infra (stream + store) |
| Sync decision + async learning | Fast action + continuous improvement | Eventual feature/label consistency |
| Challenge (step-up) for gray zone | Fewer false blocks | Added user friction sometimes |
| Fail-safe degraded mode | Availability in payment path | Reduced fraud catch while degraded |

---

## 13. Cheat-Sheet

1. **Sync scoring path < 100 ms**: fetch features → rules + ML → combine → allow/block/challenge → log.
2. **Pre-serve features** (feature store); compute velocity/behavioral features **async** in a stream processor — never aggregate in the hot path.
3. **Hybrid**: fast explainable **rules** + adaptive **ML score**; thresholds drive the gray zone.
4. **Feedback loop**: late labels (chargebacks) → offline retrain → versioned models → shadow/champion-challenger rollout.
5. **Fail safe**: timeout + circuit breaker → degrade to rules/conservative default; never block-all or allow-all.
6. **Precision vs recall** tuned per risk tier; use **challenge** for the gray zone.
7. **Audit every decision** (features, rules, score, reasons) for explainability/compliance.
8. Built on [stream processing](../DeepDives/BigData/big-data-processing.md), [feature store / Redis](../DeepDives/Caching/redis.md), [resiliency](../DeepDives/Resiliency/circuit-breakers.md).

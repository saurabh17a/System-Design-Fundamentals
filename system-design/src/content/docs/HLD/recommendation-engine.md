# Recommendation Engine — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[ml]` `[candidate-generation]` `[ranking]` `[feature-store]` `[two-stage]`
> **Prep time:** ~15 min skim, ~40 min deep read
> **Companies that ask this:** Netflix, YouTube, Amazon, TikTok, Spotify, Meta, any content/commerce platform

---

## Beginner's Guide

### What's this in plain English?

Netflix's "Top Picks," YouTube's home feed, Amazon's "customers also bought," Spotify's Discover Weekly — all answer one question: **of millions of items, which ~20 should we show *this* user *right now*?** A recommendation engine learns from behavior (what you watched/bought/liked) and surfaces items you're likely to engage with.

### Why solve it?

- **Real world**: every major content/commerce platform's discovery surface; drives a huge share of engagement/revenue.
- **Teaches**: the **two-stage architecture** (candidate generation → ranking), **collaborative vs content-based filtering**, **feature stores**, **offline + online** ML serving, and the **latency vs quality** trade-off.

### Vocabulary

- **Candidate generation** — cheaply narrow millions → hundreds of plausible items.
- **Ranking** — expensively score those hundreds → ordered top-N.
- **Collaborative filtering** — "users like you liked X" (behavioral patterns).
- **Content-based** — "similar to items you liked" (item attributes).
- **Embedding** — a learned vector representing a user/item; nearby = similar.
- **Cold start** — new user/item with no history.

### High-level architecture

```
Request → Candidate generation (millions → ~hundreds, fast)
              → Ranking model (score ~hundreds, richer features)
                  → filter/diversify → top-N → user
   (offline: train models, compute embeddings, precompute candidates)
```

A cheap recall stage then an expensive precision stage — the universal recommender pattern.

### How to read this doc

- **Beginner**: focus on the two-stage funnel.
- **Interview**: cross-questions on cold start, online vs offline, freshness, filter bubbles, latency.

---

## 0. How to use this doc in an interview

This tests the **two-stage (candidate generation → ranking)** architecture and the **offline/online split**. Key insights: (1) you **can't score millions of items per request** in real time → cheaply **generate candidates** (hundreds) then **rank** them with a heavier model; (2) heavy work (training, embeddings, candidate precomputation) happens **offline**; serving is fast; (3) handle **cold start** and **freshness**; (4) it's **latency vs quality**. Traps: trying to rank the whole catalog online, ignoring cold start, and forgetting the offline pipeline that makes online serving cheap. Related: [twitter-news-feed](twitter-news-feed.md) (ranking), [ecommerce-product-listing](ecommerce-product-listing.md).

---

## 1. Problem Statement

Recommend the top-N items for a user in real time:
- Personalized to the user's history/preferences and context.
- From a large catalog (millions of items).
- Low latency (it's on the request path for a feed/home page).
- Fresh enough to reflect recent behavior and new items.
- Diverse, not repetitive; respect filters (already-seen, blocked).

---

## 2. Clarifying Questions

- [ ] Item type + catalog size? (assume millions of items)
- [ ] Latency budget? (assume < 200 ms for the rec call)
- [ ] Personalized per user, or also context (time, device, query)? (assume both)
- [ ] How fresh — react to the current session? (assume near-real-time signals)
- [ ] Optimize for what — clicks, watch time, purchases? (assume engagement metric)
- [ ] Cold start (new users/items) important? (assume yes)

> **Assume:** millions of items, <200ms, personalized + contextual, near-real-time signals, engagement objective, cold start matters.

---

## 3. Functional Requirements

**P0:**
1. Return top-N personalized items for a user/context.
2. Two-stage: candidate generation → ranking.
3. Learn from user interactions (clicks, watches, purchases).
4. Filter already-seen/blocked; basic diversity.

**P1:**
5. Cold-start handling (new users/items).
6. Near-real-time incorporation of in-session behavior.
7. Multiple objectives (engagement + diversity + business rules).

**P2:**
8. Explanations ("because you watched X"); online experimentation (A/B).

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Rec latency | < 200 ms p99 (on the page-load path) |
| Availability | 99.9%+ (fail to a non-personalized fallback) |
| Freshness | minutes for models; seconds for in-session signals |
| Scale | millions of items, 100M+ users, high QPS |
| Quality | optimize engagement; measured via A/B |

---

## 5. Capacity Estimation

```
Catalog:     ~10M items     → can't score all per request (10M × QPS = impossible)
Users:       100M           → per-user state/embeddings precomputed offline
Requests:    1B recs/day    ≈ 12k/sec avg, higher peak
Candidate gen: millions → ~500 candidates in <50ms (ANN/precomputed lists)
Ranking:     score ~500 with a richer model in <100ms
```

**Bottleneck:** you cannot run a heavy model over 10M items per request. → **two-stage funnel**: cheap recall to hundreds, then expensive ranking; plus **offline precomputation** of embeddings/candidate lists.

---

## 6. API

```
GET /recommendations?user=&context=&n=20   -> [{item_id, score, reason?}]
(internal) interaction events → stream (signals, training data)
```

Served on the request path with a strict timeout and a **fallback** (popular/trending) if the personalized path is slow.

---

## 7. Data Model

- **User profile / embedding:** learned vector + features (history summary, demographics, recent activity). Precomputed offline, refreshed; recent in-session signals layered on.
- **Item embedding / features:** learned vector + attributes (category, popularity, recency).
- **Feature store (online):** serves user/item/context features at low latency for ranking ([Redis](../DeepDives/Caching/redis.md)/KV) — same concept as in [fraud-detection](fraud-detection.md).
- **Candidate sources:** precomputed per-user candidate lists, ANN index over item embeddings, "popular/trending", "similar-to-recent".
- **Interaction log:** clicks/watches/purchases → stream + storage ([Cassandra](../DeepDives/Databases/nosql-cassandra.md)) → training data.
- **Models:** versioned candidate-gen + ranking models in a registry.

---

## 8. Architecture

```
                         ┌──────── ONLINE (serving, <200ms) ────────┐
  Request ──► Rec API ──►│ Candidate generation                     │
                         │   - ANN over embeddings (similar items)  │  millions → ~hundreds
                         │   - precomputed lists, trending, recent  │
                         │            │                              │
                         │            ▼                              │
                         │ Ranking model (richer features)          │  score ~hundreds
                         │   - feature store fetch                  │
                         │            │                              │
                         │            ▼                              │
                         │ filter (seen/blocked) + diversify → topN │
                         └──────────────────────────────────────────┘
                                        ▲ models, embeddings, candidate lists
                                        │
  Interactions ─► Kafka ─► Stream (real-time signals) ──┐
                          └─► OFFLINE: train models, compute embeddings,
                              precompute candidates, build feature store
```

- **Online:** candidate generation (fast recall) → ranking (precision) → filter/diversify → top-N. Strict latency budget; falls back to non-personalized on failure.
- **Offline:** consume interactions → train models, compute user/item embeddings, precompute candidate lists, populate the feature store. This is where the expensive ML lives.
- **Near-real-time:** a [stream](../DeepDives/BigData/big-data-processing.md) folds in-session behavior into features so recs react within seconds.

---

## 9. Component Deep-Dives

### 9.1 Two-stage architecture (the core idea)
- **Candidate generation (recall):** cheaply reduce millions → a few hundred plausible items. Techniques: **ANN (approximate nearest neighbor)** over item embeddings near the user's embedding, precomputed per-user lists, "users who liked X also liked Y", trending, recent-similar. Optimized for **recall** and speed, not precision.
- **Ranking (precision):** run a **richer model** over just those hundreds, using many features (user × item interactions, context, freshness) to produce a fine-grained score → order them. Expensive per item, but only hundreds of items.

Why two stages: a heavy model over 10M items per request is impossible; a cheap model over 10M then a heavy model over 100s is tractable. This funnel is the universal recommender pattern.

### 9.2 Collaborative vs content-based filtering
- **Collaborative filtering:** "users similar to you liked X" — learns from the user-item interaction matrix (matrix factorization → embeddings, or neural). Powerful, but suffers **cold start** (no history).
- **Content-based:** "similar to items you engaged with" — uses item attributes/embeddings. Works for new items and explains well.
- **Hybrid:** combine both (most real systems do) to cover each other's weaknesses.

### 9.3 Offline vs online split
- **Offline (batch):** train models, compute embeddings, precompute candidates, build aggregate features — heavy, periodic ([big-data-processing](../DeepDives/BigData/big-data-processing.md)).
- **Online (serving):** fetch precomputed artifacts + features, run candidate gen + ranking fast.
- **Near-real-time (stream):** update features with in-session behavior so recs adapt within the session.

This split is what makes <200 ms serving possible despite massive models.

### 9.4 Cold start
- **New user:** no history → fall back to popular/trending, onboarding preferences, demographic/context-based, or content-based until signals accumulate.
- **New item:** no interactions → content-based (attributes/embedding similarity) and exploration (show it to some users to gather signal).
- **Exploration vs exploitation:** deliberately show some uncertain items to learn (don't only exploit known winners) — bandit approaches.

### 9.5 Filtering, diversity & business rules
Post-ranking: remove already-seen/blocked/out-of-stock, **diversify** (avoid 20 near-identical items — the "filter bubble"), inject freshness/exploration, and apply business rules (promotions, content policy).

### 9.6 Serving latency & fallback
Strict budget: candidate gen <50 ms, ranking <100 ms, fetch/filter the rest. [Timeouts + circuit breaker](../DeepDives/Resiliency/circuit-breakers.md); on failure, serve a **non-personalized fallback** (trending/popular) so the page always fills.

---

## 10. Hard Sub-Problems

### 10.1 Scoring millions of items in <200 ms
Impossible directly → two-stage funnel + ANN for candidate gen + ranking only hundreds + offline precomputation. The defining solution.

### 10.2 Cold start
Hybrid: content-based + popularity + onboarding for new users; content-based + exploration for new items.

### 10.3 Freshness vs cost
Models retrain periodically (offline); in-session signals via the stream keep recs reactive without retraining. Balance retrain frequency vs compute.

### 10.4 Feedback loops / filter bubbles
Recommending only what the model already favors narrows exposure and biases training data. Mitigate with explicit **diversity** and **exploration** (bandits).

### 10.5 Evaluation
Offline metrics (precision@k, recall) guide development, but **online A/B tests** on the real objective (watch time, purchases) are the truth. Mention online experimentation.

---

## 11. Cross-Questions

### 11.1 Why two stages instead of one model over the catalog?
Can't run a heavy model over millions of items per request; cheap recall → hundreds, then expensive ranking → tractable + fast.

### 11.2 Collaborative vs content-based?
Collaborative learns from behavior (strong but cold-start-weak); content-based uses attributes (handles new items, explainable). Hybrid in practice.

### 11.3 What's offline vs online?
Offline: train models, embeddings, candidate precompute, aggregate features. Online: fetch + candidate gen + rank fast. Stream: in-session signal updates.

### 11.4 How do you handle a brand-new user/item?
Cold start: popularity/onboarding/demographic + content-based; exploration to gather signal for new items.

### 11.5 How fresh are recommendations?
Models: minutes/hours (retrain cadence). In-session behavior: seconds, via the stream into the feature store.

### 11.6 How do you avoid showing 20 of the same thing?
Post-ranking diversity + dedup + exploration; business rules.

### 11.7 What if the rec service is slow/down?
Timeout + [circuit breaker](../DeepDives/Resiliency/circuit-breakers.md) → fallback to trending/popular so the surface still fills.

### 11.8 How do you measure quality?
Offline metrics for iteration; **online A/B** on the real objective (engagement/revenue) for decisions.

### 11.9 What's a feature store doing here?
Low-latency serving of user/item/context features to the ranking model, consistent with how they were computed in training (avoid train/serve skew). Same as [fraud-detection](fraud-detection.md).

### 11.10 ANN — why approximate?
Exact nearest-neighbor over millions of embeddings per request is too slow; ANN (e.g. HNSW) trades tiny accuracy for huge speed in candidate generation.

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| Two-stage funnel | Feasible latency at catalog scale | Candidate stage may miss good items (recall cap) |
| Offline training + online serving | Heavy ML without hot-path cost | Model staleness between retrains |
| Hybrid (collab + content) | Cold-start + behavioral strength | More complexity |
| ANN candidate gen | Fast recall over millions | Approximate (slight recall loss) |
| Exploration | Learns, avoids bubbles | Some lower-confidence items shown |

---

## 13. Cheat-Sheet

1. **Two-stage**: cheap **candidate generation** (millions → hundreds via ANN/precomputed) → expensive **ranking** (score hundreds) → filter/diversify → top-N.
2. **Offline** trains models/embeddings & precomputes candidates; **online** serves fast (<200ms); **stream** folds in in-session signals.
3. **Collaborative + content-based hybrid**; embeddings represent users/items.
4. **Cold start**: popularity/onboarding/content-based + exploration.
5. **Feature store** serves features at low latency (train/serve consistency).
6. **Diversity + exploration** to avoid filter bubbles; **A/B test** on the real objective.
7. **Fallback** to trending/popular on failure ([resiliency](../DeepDives/Resiliency/circuit-breakers.md)).
8. Shares ranking ideas with [twitter-news-feed](twitter-news-feed.md); feature store with [fraud-detection](fraud-detection.md).

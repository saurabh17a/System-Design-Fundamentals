# Realtime Abuse Masker / Content Moderation — High-Level Design

> **Difficulty:** Medium → Hard
> **Tags:** `[hld]` `[low-latency]` `[ml]` `[streaming]` `[content-moderation]` `[pii]`
> **Prep time:** ~12 min skim, ~35 min deep read
> **Companies that ask this:** Meta, Discord, Twitch, Roblox, Slack, any UGC/chat/streaming platform

---

## Beginner's Guide

### What's this in plain English?

In a live chat or stream, when someone types profanity, slurs, a phone number, or other abusive/sensitive content, the system **detects and masks it in real time** (`****`) — or blocks/flags it — *before* it reaches other users, in well under a second so the conversation still feels live. It's **inline content moderation** on a high-volume message stream.

### Why solve it?

- **Real world**: Twitch/YouTube live chat, Discord, Roblox, game chat, comment streams.
- **Teaches**: **ultra-low-latency inline filtering**, layered detection (**fast rules → ML classifier**), **streaming** at scale, and the **latency vs accuracy vs safety** trade-off (you must decide fast, but mistakes both ways are costly).

### Vocabulary

- **Mask** — replace offending text (`f***`); vs **block** (drop) vs **flag** (allow but report).
- **Profanity/abuse list** — known bad terms (fast exact/fuzzy match).
- **Classifier** — ML model scoring text for toxicity/abuse (context-aware).
- **PII** — personal info (phone, email, address) to redact.
- **Evasion** — `f.u.c.k`, `f u c k`, leetspeak — adversarial obfuscation.

### High-level architecture

```
Message → Moderation service (inline, <100ms):
            fast filter (lists/regex/normalize) → ML classifier (gray zone) → mask/block/allow
         → deliver to chat   ;   async → log, human review queue, model retraining
```

A fast inline decision; heavier review and learning happen asynchronously.

### How to read this doc

- **Beginner**: focus on the inline fast-path + masking.
- **Interview**: cross-questions on evasion, latency, false positives, context, languages.

---

## 0. How to use this doc in an interview

This tests **inline low-latency moderation on a stream**. Key insights: (1) the decision is **synchronous and sub-100ms** — it sits between sender and receivers — so use a **layered cascade**: a very fast list/regex pass handles most cases, an ML classifier handles the ambiguous gray zone; (2) **evasion/obfuscation** is the hard part (normalize text first); (3) it's a **precision/recall + latency** trade-off; (4) heavy work (human review, retraining) is **async**. Traps: pure-regex (misses context/evasion), pure-ML inline (too slow/expensive per message), and ignoring false positives (censoring legit speech). Shares structure with [fraud-detection](fraud-detection.md) (inline scoring) and [notification-system](notification-system.md) (fan-out).

---

## 1. Problem Statement

Moderate user messages in real time before delivery:
- Detect profanity, hate/abuse, PII, spam in chat/comments/stream.
- **Mask / block / flag** based on severity and policy.
- Sub-100 ms so live chat stays live.
- Resist evasion (obfuscated text).
- Route uncertain/severe cases to human review; learn over time.

---

## 2. Clarifying Questions

- [ ] Action: mask, block, or flag? (assume all, by severity)
- [ ] Latency budget? (assume < 100 ms inline)
- [ ] Throughput? (assume 100k–1M messages/sec peak, live events)
- [ ] Languages? (assume multi-language)
- [ ] Detection types: profanity, hate, PII, spam? (assume all)
- [ ] Human-in-the-loop? (assume yes, async)

> **Assume:** mask/block/flag by severity, <100ms inline, ~1M msg/sec peak, multi-language, human review async.

---

## 3. Functional Requirements

**P0:**
1. Inline-moderate each message before delivery → mask/block/allow.
2. Layered detection: fast list/regex + ML classifier.
3. Normalize text to resist obfuscation/evasion.
4. Configurable policy/severity → action mapping.

**P1:**
5. PII detection + redaction.
6. Human review queue for gray-zone/severe cases; appeals.
7. Per-channel/community custom word lists + tolerance.

**P2:**
8. Image/audio/video moderation; repeat-offender reputation; multi-language model coverage.

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Inline latency | < 100 ms p99 (in the message path) |
| Throughput | 100k–1M messages/sec peak |
| Availability | 99.99% — must **fail safe** (don't drop all chat) |
| Accuracy | high recall on severe; controlled false positives |
| Freshness | new slurs/evasions deployable fast |

---

## 5. Capacity Estimation

```
Messages:     10B/day        ≈ 115k/sec avg, ~1M/sec peak (big live events)
Per message:  normalize + list match (<5ms) + maybe classifier (<30ms)
Most messages clean → fast path handles ~90%+ without the model
Logs/review:  flagged subset → async queue + storage
```

**Bottleneck:** running ML inference on **every** message at 1M/sec is too slow/expensive. → **cascade**: cheap fast filter resolves the majority; the ML classifier runs only on the **ambiguous** remainder. Heavy/human work is async.

---

## 6. API

```
POST /moderate  {message, user, channel, context?}
                -> {action: allow|mask|block|flag, masked_text?, score, categories[]}
(internal) flagged events → stream (review queue, metrics, retraining)
```

Synchronous and inline → strict timeout + **fail-safe default** if the classifier is slow.

---

## 7. Data Model

- **Word/pattern lists:** profanity/slur/PII regexes + per-channel custom lists, hot-reloadable, served from memory/[Redis](../DeepDives/Caching/redis.md) for the fast path.
- **Classifier model:** versioned toxicity/abuse model(s), per-language, served by an inference service.
- **Decisions log:** message id, action, score, categories, model version → append-only ([Cassandra](../DeepDives/Databases/nosql-cassandra.md)) for audit/appeals/training.
- **Review queue:** flagged/gray-zone items → queue for human moderators; outcomes become labels.
- **User reputation (P1):** repeat-offender scores to tune thresholds per user.

---

## 8. Architecture

```
   Message ──► Moderation service (inline, <100ms)
                  │
                  ▼
          1) Normalize (lowercase, de-leet, strip separators, unicode-fold)
                  │
                  ▼
          2) Fast filter (exact/fuzzy list + regex + PII patterns)  ── clear hit → mask/block
                  │  ambiguous / gray zone
                  ▼
          3) ML classifier (toxicity score, context-aware)          ── score → action
                  │
                  ▼
          4) Policy → allow / mask / block / flag ──► deliver to chat
                  │ emit (async)
                  ▼
              Kafka ──► review queue (humans) + decision log + retraining pipeline
```

- **Inline:** normalize → fast filter → (classifier if ambiguous) → policy → action → deliver. Most messages exit at the fast filter.
- **Async:** flagged items → human review; decisions logged; labels feed retraining; new lists/models pushed back.

---

## 9. Component Deep-Dives

### 9.1 The latency budget & the cascade (core idea)
Sub-100 ms inline at 1M/sec forbids running a model on every message. **Cascade:**
1. **Normalize** (cheap) — fold the text to a canonical form.
2. **Fast filter** (microseconds) — exact/fuzzy list + regex; resolves the clear-cut majority (obvious profanity/PII, obviously clean).
3. **ML classifier** (tens of ms) — only for the **gray zone** the fast filter can't decide (context-dependent toxicity).

Most traffic never touches the model → meets the budget and cost. Same fast-path/gray-zone pattern as [fraud-detection](fraud-detection.md).

### 9.2 Evasion / normalization (the hard part)
Users obfuscate: `f.u.c.k`, `f u c k`, `phuck`, leetspeak `4ss`, zero-width chars, homoglyphs. A naive list misses all of it. **Normalize first:** lowercase, strip separators/punctuation/whitespace within tokens, map leet/homoglyphs to base letters, unicode-normalize, then match. Fuzzy matching (edit distance) catches misspellings. This arms race never ends → fast list updates + classifier generalization.

### 9.3 Rules/lists vs ML classifier
- **Lists/regex:** instant, explainable, easy to update, great for known terms + PII patterns — but **context-blind** ("kill" in a game vs a threat) and evadable.
- **ML classifier:** context-aware (toxicity, harassment, subtle abuse), generalizes to new phrasing — but slower, costlier, a black box, needs training data and per-language coverage.
- **Together:** lists for the obvious/PII, classifier for the nuanced gray zone.

### 9.4 Actions & policy
Map (severity, category, channel policy, user reputation) → **mask** (replace offending span, keep the message), **block** (drop, notify sender), or **flag** (allow but queue for review). Severe (threats, CSAM) → block + escalate. Per-channel tolerance (a gaming server vs a kids' app) differs.

### 9.5 Human-in-the-loop (async)
Gray-zone and severe cases go to a [review queue](../DeepDives/Messaging/asynchronous-processing.md); moderator decisions become **labels** that retrain the classifier and refine lists. Appeals flow here too. Keeps humans off the hot path while improving the system.

### 9.6 Fail-safe behavior
The moderator is inline; if the classifier is slow/down, **don't break all chat** and **don't disable moderation entirely**. [Timeout + circuit breaker](../DeepDives/Resiliency/circuit-breakers.md): fall back to **fast-filter-only** (lists still run) and flag the gap, rather than blocking everything or letting everything through unmoderated. Fail toward the safer side for severe categories.

---

## 10. Hard Sub-Problems

### 10.1 Sub-100ms at 1M msg/sec
Cascade (most exit at the fast filter), model only on the gray zone, optimized/compact classifiers, horizontal scaling, strict timeouts.

### 10.2 Evasion arms race
Aggressive normalization + fuzzy matching + classifier generalization; fast deployment of new patterns; learn from missed cases via the review loop.

### 10.3 False positives vs false negatives
Over-masking censors legit speech (the "Scunthorpe problem" — innocent substrings); under-masking lets abuse through. Tune thresholds per category/channel; bias toward recall for severe harm, toward precision for mild profanity; use **flag** (not block) for uncertain cases.

### 10.4 Context & language
"Kill" is fine in a game, a threat elsewhere; sarcasm/reclaimed terms are hard. Context-aware models + per-channel policy + multi-language models (or translation). Genuinely hard; acknowledge limits.

### 10.5 Throughput spikes (live events)
A viral stream spikes chat 100×. The fast filter absorbs most; autoscale classifier capacity; shed/queue non-critical async work; never let moderation latency break the live feel.

---

## 11. Cross-Questions

### 11.1 Why not just an ML model on every message?
Too slow/expensive at 1M/sec inline. Cascade: fast filter handles the bulk, model only the gray zone.

### 11.2 Why not just a profanity list?
Context-blind and trivially evaded (`f.u.c.k`); misses novel/contextual abuse. Need normalization + a classifier.

### 11.3 How do you beat evasion?
Normalize aggressively (de-leet, strip separators, homoglyph/unicode fold) before matching; fuzzy match; classifier generalization; fast list updates; learn from misses.

### 11.4 Mask, block, or flag — how decided?
By severity × category × channel policy × user reputation. Mild → mask; severe → block + escalate; uncertain → flag for review.

### 11.5 What if the classifier is down?
Fail safe: [circuit breaker](../DeepDives/Resiliency/circuit-breakers.md) → fast-filter-only; don't block all chat or disable moderation; bias safe for severe categories.

### 11.6 How do you handle false positives (censoring legit speech)?
Tune thresholds, prefer **flag** over **block** in the gray zone, per-channel tolerance, appeals + human review feeding retraining.

### 11.7 Sync vs async?
**Decision inline/sync** (<100ms, before delivery). **Human review, logging, retraining async** via the stream.

### 11.8 Multi-language?
Per-language models or translation; language detection first; lists per locale. Hard — acknowledge coverage gaps.

### 11.9 How do new slurs/attacks get handled fast?
Hot-reloadable lists/regex for immediate coverage; classifier retraining from the review loop for generalization.

### 11.10 PII redaction?
Regex/NER for phones, emails, addresses, card numbers → redact span; severity policy (some channels block PII entirely).

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| Cascade (fast filter → ML) | Meets latency/cost at scale | Two layers to maintain/tune |
| Lists + ML hybrid | Speed + context awareness | Complexity |
| Mask/flag over block | Less over-censorship | Some abuse briefly visible (flag) |
| Inline sync decision | Stops abuse before delivery | Latency pressure on the message path |
| Fail-safe degraded mode | Chat stays up | Reduced moderation while degraded |

---

## 13. Cheat-Sheet

1. **Inline, <100ms**: normalize → fast list/regex filter → ML classifier (gray zone only) → policy → mask/block/flag → deliver.
2. **Cascade**: cheap filter resolves ~90%+; the **model runs only on ambiguous** messages (can't model 1M/sec).
3. **Normalize first** to beat evasion (de-leet, strip separators, homoglyph/unicode fold) + fuzzy match.
4. **Lists** (fast, explainable, PII) + **ML** (context-aware) — hybrid.
5. **Async** human review + logging + retraining; review outcomes = training labels.
6. **Fail safe**: circuit breaker → fast-filter-only; don't break chat or drop moderation.
7. **Precision vs recall** tuned per category/channel; **flag** for uncertainty.
8. Inline-scoring sibling of [fraud-detection](fraud-detection.md); fan-out via [notification-system](notification-system.md)/[realtime-pubsub](../DeepDives/Messaging/realtime-pubsub.md).

# Tinder / Bumble (Dating App) — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[geospatial]` `[matching]` `[recommendations]` `[fan-out]`
> **Companies that ask this:** Match Group, Bumble, Hinge, Coffee Meets Bagel

---

## Beginner's Guide

### What's this in plain English?

Tinder. You see a stack of profiles; swipe right (yes) or left (no). If two people both swipe right on each other → it's a match → they can chat. The system: serve profiles ordered by relevance; ingest hundreds of swipes per user per session; detect mutual matches in real time.

### Why solve it?

- **Real world**: Tinder, Bumble, Hinge, Match.
- **Teaches**: high-volume swipe ingestion, recommendation, mutual-match detection, geospatial.

### Vocabulary

- **Swipe** — left/right decision; like/dislike.
- **Match** — bidirectional like.
- **Discovery feed** — the deck of profiles shown.
- **Recommendation** — order profiles by predicted compatibility.
- **Geo / Distance filter** — only show profiles within N km.

### High-level architecture

```
User → Discovery Service (recommendations) → cards
              ↑
         User profile + filters

User swipes → Swipe Service → store + match detection
                  ↓
           Match Service → if mutual → notify both → Chat
```

Components:
1. **Discovery / recommendations** — ML model serving candidates.
2. **Swipe ingest** — high-throughput; mostly write-only.
3. **Match detection** — when A swipes right on B, check if B already swiped right on A.
4. **Chat** — only after match.
5. **Geo-index** — for distance filtering.

Mutual match detection: store swipes keyed by `(swiper, target)`. When A → B comes in, check if `(B, A)` exists.

### How to read this doc

- **Beginner**: focus on swipe ingest + mutual match.
- **Interview**: cross-questions on recommendations (how to rank), abuse (fake profiles), scaling for huge user counts.

---

## 0. How to use this doc in an interview

Tinder tests **swipe ingestion + recommendations + mutual matching + chat**. Tests:
1. Swipe is HIGH volume (100s per user per session).
2. "Show me profiles" uses ML ranking + filters (geo, age, preferences).
3. Mutual match detection — both swiped right → match; route to chat.
4. Notification on match.

Trap: thinking "find people in radius" is the whole problem. The hard part is the recommendation queue.

---

## 1. Problem Statement

A dating app:
- User profile (photos, bio, prefs).
- Discover screen: swipe right (like) or left (pass) on candidates.
- Mutual right-swipe = match → chat unlocked.
- Geo-filtering (within X miles), age range, gender, prefs.

---

## 2. Clarifying Questions

- [ ] Free + paid tiers?
- [ ] Photo verification?
- [ ] Boost / super-likes?
- [ ] Chat in scope?
- [ ] Algorithm — purely chronological or ML-ranked?

> **Assume:** free + paid; verified accounts; super-likes; chat in scope; ML-ranked feed.

---

## 3. Functional Requirements

**P0:**
1. Profile create/edit.
2. Discover feed (filtered + ranked candidates).
3. Swipe ingestion (right/left).
4. Mutual match detection.
5. Notification on match.
6. Match list.
7. Basic chat (post-match).

**P1:**
8. Super-likes (1/day free, more for paid).
9. Boost (visibility for 30 min).
10. Photo verification.

**P2:**
11. Video calls.
12. Background checks.
13. Travel mode (set location elsewhere).

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.99% |
| Discover load latency | < 500 ms (next batch of profiles) |
| Swipe ingest | < 100 ms ack |
| Match latency | < 1 s mutual swipe → notification |

---

## 5. Capacity Estimation

```
DAU: 50M
Swipes / DAU / day: 100 (very high)
Total swipes: 5B/day = 60k QPS sustained, 300k peak
Profile views: ~5x swipes (browse before swipe)
Active matches: 50M users × 10 active matches = 500M
Mutual swipes: ~0.5% of right-swipes → 5M matches/day
```

---

## 6. API

```
GET  /v1/discover                        -> [profile, profile, ...]
POST /v1/swipes                          body: {target, direction}
                                          -> {match: bool, match_id?: ...}
GET  /v1/matches                         -> list
WS   /v1/chats/{match_id}                -> realtime chat
```

---

## 7. Data Model

### User profiles (Postgres or doc DB)
- `users(id, name, dob, gender, prefs, photos[], bio, location)`

### Swipes (Cassandra, partitioned by swiper_id)
- `swipes(swiper_id, target_id, direction, ts)`
- Right-swipes also written to `right_swipes(target_id, swiper_id, ts)` for mutual detection.

### Matches (Cassandra)
- `matches(user_id, match_id, peer_id, matched_at)` — partitioned by user.

### Discover queue (Redis per user)
- Pre-computed list of profile IDs to show next.

### Geo index
- H3 cells (like Uber).
- `users:cell:{h3}` → set of user IDs.

---

## 8. Architecture

```
              ┌──────────────────────┐
              │   Mobile app          │
              └──────────┬────────────┘
                         │
                ┌────────▼─────────┐
                │  Discover Svc    │
                │  - filter (geo,  │
                │    age, prefs)   │
                │  - ML rank       │
                │  - return queue  │
                └────────┬─────────┘
                         │
                ┌────────▼─────────┐
                │  Swipe Svc       │
                │  - persist       │
                │  - check mutual  │
                │  - emit match    │
                └────────┬─────────┘
                         │
       ┌─────────────────┴─────────────────┐
       ▼                                   ▼
┌────────────┐                       ┌────────────┐
│ Cassandra  │                       │ Match Svc  │
│ swipes,    │                       │ - notify   │
│ matches    │                       │ - chat init│
└────────────┘                       └────────────┘
                                          │
                                          ▼
                                   ┌────────────┐
                                   │ Chat Svc   │
                                   │ (WS)       │
                                   └────────────┘
```

---

## 9. Component Deep-Dives

### 9.1 Discover queue (the hardest)
- Pre-compute per-user: candidates filtered by prefs.
- Source pool: users in your H3 cell + neighbors.
- Filter: gender, age, distance, "haven't swiped yet" (set diff with my swipes).
- Rank with ML: features = profile completeness, engagement signals, mutual swipes density.
- Cache in Redis; refresh in background.
- Pagination: deliver 20 at a time.

### 9.2 Swipe ingest
- Volume: 60k QPS sustained.
- Persist to Cassandra (partitioned by swiper).
- For right-swipe: also lookup `right_swipes(target=swiper, swiper=target)` — if exists, mutual match!
- Use Bloom filter or Redis cache to avoid hitting Cassandra for every check.

### 9.3 Mutual match detection
- On right-swipe by A on B: 
  - Insert into Cassandra `right_swipes(B, A)`.
  - Check `right_swipes(A, B)` (B already right-swiped A?).
  - If yes: create match; notify both.

### 9.4 ML ranking
- Features: text similarity, photo embedding, behavior (swipe rate), engagement patterns.
- Trained on past mutual matches.
- Trade: privacy-sensitive features (gender, age) needed for relevance.

### 9.5 Chat
- Same architecture as WhatsApp's chat (see `whatsapp.md`).
- Per-match thread; WS push.

---

## 10. Hard Sub-Problems

### 10.1 Generating discover queue at scale
- Can't recompute on every request (50M users × 20 candidates).
- Pre-compute every few hours; cache in Redis.
- Refresh on profile change or active session.

### 10.2 Filter "already swiped"
- Without filter: user sees same profile repeatedly.
- Per-user "swiped set" — could be millions of entries for power users.
- Bloom filter: false positives are OK (occasional skip); false negatives unacceptable.

### 10.3 Hot users (very attractive profiles)
- Disproportionate swipes received.
- Hot profile cached aggressively.
- Reciprocal swipe checks: hot profile gets many mutual checks.

### 10.4 Photo storage
- Multiple sizes (thumb, full).
- CDN-fronted.
- Verification: human-reviewed; ML detection of bots.

---

## 11. Cross-Questions ≥ 12

### 11.1 Why H3 for geo here?
- Same reasons as Uber: O(1) cell lookup, uniform area.
- Different resolution — coarser (50 km radius cells).

### 11.2 Why pre-compute discover queue?
- 60k QPS swipes mean 60k+ "next 20" requests/sec.
- Recomputing ML ranking per request → 60k × ~50ms = 3000 ML inferences/sec. Expensive.
- Pre-compute every few hours; cache; refresh on signals.

### 11.3 Why Cassandra for swipes?
- 5B writes/day. Cassandra fits.
- Partitioned by swiper; user's "my swipes" is one partition.
- Counter table for `right_swipes_by_target` for mutual detection.

### 11.4 Why notify both users on match?
- Engagement + UX (you can chat now).
- Push notification + in-app banner.

### 11.5 What about anti-bot / verification?
- Photo verification: pose pic matches profile pic via ML.
- Phone verification on signup.
- Behavioral: 1000 right-swipes in a minute = bot.

### 11.6 How does super-like work?
- Special swipe type; sent as priority signal.
- Recipient sees it surface to top of their queue.
- Free: 1/day; paid: more.

### 11.7 How does boost work?
- Pay-per-boost: 30 min of "your profile shown more".
- Implementation: bias ranker with `boosted=true`.
- Pre-warm cache for users who would see this profile.

### 11.8 Cross-country / travel mode?
- Override location to elsewhere; recompute discover.
- Useful for travelers; paid feature.

### 11.9 What about same-sex / non-binary preferences?
- Filter on prefs match.
- Gender field is rich (not just M/F).

### 11.10 What about "don't show me X" (block)?
- Add to "swiped left" + "blocked".
- Filter discover.
- Bloom filter union.

### 11.11 How does Tinder show profiles you might know?
- Phone contacts uploaded → exclude from discover.
- Privacy nuance.

### 11.12 What's the failure mode if discover cache is empty?
- Compute on demand from H3 + filter + small sample (100 candidates).
- Skip ML rank; use simple distance ranking.
- Async refill cache.

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| Pre-computed queue | Fast discover | Stale signals |
| Bloom filter for "swiped" | Memory efficient | Occasional re-shows |
| H3 for geo | Fast | Coarser than exact distance |
| ML ranking | Better matches | Compute cost; biases |

---

## 13. Cheat-Sheet

1. **Discover queue** pre-computed per user; refreshed periodically.
2. **H3** for geo filter.
3. **Bloom filter** for "already swiped".
4. **Cassandra** for swipes; partitioned by swiper.
5. **`right_swipes` reverse table** for O(1) mutual detection.
6. **Match → WS chat** (like WhatsApp).
7. **ML ranking** trained on past matches.

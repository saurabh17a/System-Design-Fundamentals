# Twitter Timeline / News Feed — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[social-graph]` `[fan-out]` `[hybrid-push-pull]` `[hot-keys]` `[caching]`
> **Prep time:** ~15 min skim, ~45 min deep read
> **Companies that ask this:** Meta (Facebook / Instagram), Twitter/X, LinkedIn, Pinterest, TikTok, Snap

---

## Beginner's Guide

### What's this in plain English?

You open Twitter (or X). You see tweets from the people you follow, mostly newest first. The system has to figure out: of all 500M tweets posted today, **which ~50** belong on YOUR home timeline. Do this in <300ms, for 200M users, every refresh.

### Why solve it?

- **Real world**: Twitter, FB News Feed, Instagram Home, LinkedIn, TikTok For You.
- **Teaches**: the **fan-out** problem, push vs pull, hybrid approaches, the celebrity problem (some users have 100M followers).
- **The defining social-graph interview question.**

### Vocabulary

- **Tweet / Post** — content from a user.
- **Follow graph** — who follows whom; a user has followers and follows.
- **Timeline** — the ordered list of tweets for a user.
- **Fan-out on write (push)** — when X tweets, push the tweet to every follower's inbox.
- **Fan-out on read (pull)** — when Y opens app, pull tweets from everyone Y follows and merge.
- **Hybrid / mixed** — push for normal users, pull for celebrities.
- **Hot key** — a user with crazy traffic (Elon Musk, 200M followers).

### High-level architecture

```
Tweet write → Tweet store + Push job → Per-user timeline cache (Redis)
                          (only for non-celebrity authors)

Timeline read → Pull from per-user cache + Pull recent celebrity tweets → Merge
```

Two paths because **pure push** explodes for celebrities (one tweet → 200M cache writes), and **pure pull** explodes for active readers (one timeline read → query for 1000 followees).

Hybrid:
- **Authors with < 1M followers**: push to followers' timelines.
- **Authors with > 1M followers (celebrities)**: don't push. On read, pull their recent tweets and merge with the user's regular timeline.

This gets the best of both: fast reads for most users, manageable cost for celebs.

### How to read this doc

- **Beginner**: focus on the fan-out trade-off in section 5 / deep-dives.
- **Interview**: cross-questions on celebrity problem, hot keys, and ranking.

---

## 0. How to use this doc in an interview

This is the **defining** social-graph design question. Interviewers grade on whether you grasp the **fan-out-on-write vs fan-out-on-read** trade-off and whether you can design a **hybrid** that handles the **celebrity problem**.

The four traps:

1. Picking pure fan-out-on-write without realizing what happens when @JustinBieber tweets to 200M followers (200M write fanout per tweet).
2. Picking pure fan-out-on-read without realizing what happens when 100M users each read at 5 RPS and the timeline join is N tweets across M followees (re-computed every time).
3. Drawing the architecture but not estimating the **storage** for materialized timelines (it's huge).
4. Forgetting that "the timeline" is *ranked*, not chronological — ranking adds an entire ML/feature serving layer.

If you walk through scoping → capacity → fan-out trade-off → hybrid solution → ranking layer → caching → cross-region with grounded reasoning, the interview ends in 50 minutes and the interviewer pivots to ML ranking or trending topics.

---

## 1. Problem Statement

Build a system where:
- Users can **post** a tweet (≤ 280 chars, optional media).
- Users can **follow / unfollow** other users.
- Users get a **home timeline** — a feed of recent tweets from people they follow, **ranked** by relevance + recency.
- The system runs at internet scale: hundreds of millions of DAUs, billions of tweets, asymmetric celebrity vs non-celebrity follow patterns.

Sub-systems often included:
- Search.
- Trending topics.
- Notifications.
- Direct messages.

For this design we focus on **post + home timeline + ranking**. Search and DMs are explicitly out of scope (separate systems).

---

## 2. Clarifying Questions to Ask the Interviewer

### Scope
- [ ] Home timeline only, or also "user profile" timeline (their own tweets, anyone's profile)?
- [ ] Reverse-chronological or **ranked** by relevance?
- [ ] Media tweets (images, video) — store URLs only or full media pipeline?
- [ ] Replies, retweets, quote-tweets — full graph or simplified?
- [ ] Real-time stream API (firehose) — in scope?
- [ ] Notifications, search, trending — in scope?

### Scale
- [ ] DAUs? MAUs?
- [ ] Avg posts per user per day?
- [ ] Avg follows per user? (median; the *distribution* matters more)
- [ ] Avg followers per user? (asymmetric — celebrities have millions)
- [ ] Read:write ratio? (typically 100:1+)
- [ ] Avg timeline reads per user per day?

### Non-functional
- [ ] How fresh must a tweet be in the timeline? (1 sec? 30 sec? 5 min?)
- [ ] Latency budget for **home timeline GET**? (P50, P99)
- [ ] Latency budget for **post**? (the writer must see their own tweet immediately — read-your-writes)
- [ ] Strict ordering or eventual order? (a tweet posted at T1 may appear in someone's timeline before T1 is meaningful?)
- [ ] Geographic distribution? (multi-region hot or cold?)

### Domain
- [ ] How does ranking work? (engagement, recency, relationship strength, ad mix)
- [ ] Is ranking deterministic or personalized per user?
- [ ] Do we serve ads in the timeline? (yes — affects retrieval)

> **For this doc** we'll assume: 200M DAUs, 500M MAUs, avg user follows 200, median followers per account 100 but tail to 200M, 10:1 read:write, ranked timeline (not chrono), media URLs only (separate media service), retweets in scope (replies as parent_id, simplified), real-time freshness < 30 sec for non-celebrity tweets, P99 home-timeline GET < 200ms, posts visible to author immediately (read-your-writes), single global service eventually consistent across regions.

---

## 3. Functional Requirements

**Must-have (P0):**
1. `POST /v1/tweets` — create a tweet (text + optional media URLs).
2. `GET /v1/users/me/timeline` — return ranked home timeline.
3. `POST /v1/follows/{user_id}` / `DELETE` — follow / unfollow.
4. `GET /v1/users/{user_id}/tweets` — user profile timeline (their own tweets, reverse chrono).
5. Tweets include retweets and replies (as references).
6. Author sees their own tweet in their timeline immediately (read-your-writes).
7. Ranked timeline based on recency + engagement + relationship strength (simplified).

**Should-have (P1):**
8. Tweet edits (within 30 min) and deletes.
9. Mute / block.
10. Direct mentions (`@user`) trigger inclusion in mentioned user's notifications.
11. Trending hashtags on the side rail.

**Nice-to-have (P2 — out of scope):**
12. Full search.
13. Real-time push to clients (websocket / SSE).
14. Multi-modal ranking (video vs text vs image priorities).
15. Per-tweet privacy (public, friends-only, private — assumed all public for this doc).

---

## 4. Non-Functional Requirements

| Dimension | Target | Justification |
|---|---|---|
| Availability (read) | 99.99% | Timeline is the product; outage = entire app unusable. |
| Availability (write) | 99.95% | Posts can briefly be retried; users will tolerate seconds of write outage if read still works. |
| Latency P50 (timeline GET) | < 100 ms | Mobile first impression; users notice ≥ 200 ms. |
| Latency P99 (timeline GET) | < 200 ms | Hard ceiling; beyond this, scrolling stutters. |
| Latency P50 (post) | < 200 ms | Includes write + author-side timeline insert. |
| Latency for tweet→follower-timeline | < 30 s | Real-time perception threshold; viral content needs to flow fast. |
| Throughput | 200k peak QPS reads, 6k peak QPS writes (see §5) | Sized for ~Twitter scale. |
| Consistency | Read-your-writes for author; eventual for everyone else | Standard social media semantics. |
| Durability | 11 nines on tweets, 9 nines on timelines (timelines can be re-derived) | Tweets are the truth; timelines are a cache. |

---

## 5. Capacity Estimation

### Users & Traffic

```
DAU                              = 200M
Posts per DAU per day (avg)      = 0.3       (most users lurk; ~30% post daily)
Posts/day                        = 60M
Posts/sec (avg)                  = 60M / 86400 ≈ 700/sec
Peak factor                      = 8× (real spikes — events, live moments)
Peak posts/sec                   = ~6,000/sec

Timeline reads per DAU per day   = 30        (multiple sessions, scroll refreshes)
Timeline reads/sec (avg)         = 200M × 30 / 86400 ≈ 70,000/sec
Peak                              = ~ 200,000/sec
Read:write ratio                 = ~30:1 to 50:1
```

### Follow graph

```
Avg followees per user           = 200          (median)
Total edges                       = 500M × 200 = 100B follow edges
Each edge ~ 24 bytes (2 IDs + ts) → 2.4 TB raw
With 3× replication + indexes    → ~10 TB
```

But the **distribution** is the real story:

```
Median followers per user         = 100
P99 followers                     = 100k (popular accounts)
P99.99 followers                  = 10M (celebrities)
Top 100 accounts                  = 100M+ each (rockstars, athletes, presidents)
```

This is the **celebrity problem**: fan-out cost is unbounded for top accounts.

### Storage — tweets

```
Tweet record:
  tweet_id        8 bytes
  user_id         8 bytes
  text            ~140 bytes avg (280 char Unicode, often shorter)
  media_urls      0–500 bytes
  parent_id       8 bytes (for replies/retweets)
  created_at      8 bytes
  metadata        ~50 bytes
                  ────
                  ~250 bytes/tweet on avg

Tweets/day                        = 60M
Tweets/year                       = 22B
Bytes/year                        = 22B × 250 ≈ 5.5 TB raw
With indexes + 3× replication     ≈ 30–40 TB/year
Over 5 years                       ≈ 200 TB
```

Manageable on a sharded NoSQL or sharded Postgres.

### Storage — materialized timelines (the big one)

If we **fan-out-on-write** for everyone:

```
DAU                               = 200M
Avg timeline length cached        = 800 tweets (a few days worth)
Bytes per cached entry            = ~50 bytes (just tweet_id + ranking score)
Per-user timeline                 = 800 × 50 = 40 KB
Total                             = 200M × 40 KB ≈ 8 TB
With replication                   ≈ 24 TB
```

8 TB of timelines in Redis is **expensive but doable**. The kicker is **write amplification**:

```
Posts/sec               = 6,000
Avg followers per author= 200
Naive fan-out writes/s  = 6000 × 200 = 1.2M timeline writes/sec
For celebrities:
  one celebrity tweet (50M followers) = 50M writes
```

This is **infeasible in pure form**. Hence hybrid (§10.1).

### Bandwidth

```
Read bandwidth (peak)              = 200k QPS × 50 KB response (timeline page) = 10 GB/s
Write bandwidth                    = 6k QPS × 1 KB = 6 MB/s
```

Read bandwidth is real — needs CDN / edge for media; the API itself is JSON-light.

### What's the bottleneck?

**Timeline write fan-out for celebrities.** Solving this is the design.

---

## 6. API Design

### REST (or GraphQL — Twitter actually uses both)

```
POST   /v1/tweets
  body:    { text, media_urls?, parent_id? }
  returns: 201 + { tweet_id, created_at }

GET    /v1/users/me/timeline?cursor=<opaque>&limit=20
  returns: 200 + { tweets: [...], next_cursor }

GET    /v1/users/{user_id}/tweets?cursor=...&limit=20
  returns: 200 + { tweets: [...], next_cursor }

POST   /v1/follows/{user_id}
DELETE /v1/follows/{user_id}

GET    /v1/users/{user_id}/followers?cursor=...
GET    /v1/users/{user_id}/following?cursor=...
```

### Tweet schema returned

```
{
  "tweet_id":    "1798234567890123456",        // Snowflake — time-ordered
  "user":        { "id": "...", "username": "...", "avatar_url": "..." },
  "text":        "...",
  "media_urls":  ["https://media.cdn/x.jpg"],
  "created_at":  "2026-05-17T12:00:00Z",
  "stats":       { "likes": 142, "retweets": 9, "replies": 3 },
  "parent_id":   null,
  "is_retweet":  false,
  "ranking_score": 0.78                         // populated for home timeline only
}
```

### Pagination

Cursor-based on `(score DESC, tweet_id DESC)` for ranked timeline. For chrono: `(tweet_id DESC)` since Snowflake IDs are time-ordered.

Why not offset? Same reasons as URL Shortener (§13.14). At 200M users and infinite-scroll, offset would be a disaster.

### Why `tweet_id` is a Snowflake ID

Twitter's Snowflake: 64 bits = `[timestamp:41 | machine_id:10 | sequence:12]`. Properties:

- Time-ordered (sortable in chrono order without an extra `created_at` column).
- Globally unique across machines.
- 4096 IDs per millisecond per machine — enough headroom.
- Can be sharded by ID prefix (timestamp bits).

Used throughout the design for tweets, replies, retweets, etc.

---

## 7. Data Model

### Choice: NoSQL for tweets, SQL for users / follows

#### `tweets` — Cassandra / DynamoDB / sharded MySQL

Reason for NoSQL:
- 22B tweets/year — sharding is mandatory.
- Access pattern is **point read by tweet_id** (in timeline expansion) and **range read by user_id** (profile timeline).
- No joins required.
- Schema is stable.

**Partition key:** `user_id`. **Clustering key:** `tweet_id DESC`.
- A user's tweets are co-located → profile timeline is one partition read.
- Insert into a user's partition is a tail append → write amplification minimal.

```
tweets (
  user_id        bigint,
  tweet_id       bigint,
  text           text,
  media          map<string, text>,
  parent_id      bigint,
  is_retweet     boolean,
  retweet_of     bigint,
  created_at     timestamp,
  PRIMARY KEY ((user_id), tweet_id)
) WITH CLUSTERING ORDER BY (tweet_id DESC)
```

Secondary table for `lookup-tweet-by-id`:
```
tweets_by_id (
  tweet_id       bigint PRIMARY KEY,
  user_id        bigint,
  ...
)
```

(Or, if NoSQL store supports it: a global secondary index on `tweet_id`.)

#### `users` — Postgres

Why SQL: low cardinality changes, transactional updates (username uniqueness, email verification), joinable for ad-hoc queries.

```
users (
  user_id        BIGINT PRIMARY KEY,
  username       VARCHAR UNIQUE,
  display_name   VARCHAR,
  avatar_url     TEXT,
  bio            TEXT,
  created_at     TIMESTAMP,
  follower_count BIGINT,    -- denormalized counter
  following_count BIGINT
)
```

#### `follows` — sharded Cassandra (forward + reverse tables)

The follow graph is the **largest table** in the system. Two materialized views:

```
following (
  user_id      bigint,
  followee_id  bigint,
  followed_at  timestamp,
  PRIMARY KEY ((user_id), followee_id)
)

followers (
  user_id      bigint,
  follower_id  bigint,
  followed_at  timestamp,
  PRIMARY KEY ((user_id), follower_id)
)
```

Both maintained on every follow/unfollow. Why two tables?
- `following` for "who do I follow?" (timeline construction).
- `followers` for "who follows me?" (fan-out on write — we need this list to push tweets).

A single table can't efficiently support both queries because partitioning forces a choice.

#### `home_timeline` — Redis

```
key:  timeline:{user_id}
type: ZSET (sorted set), score = ranking_score, member = tweet_id
size: ~800 entries (FIFO eviction beyond limit)
TTL:  none — actively maintained
```

Materialized timelines are stored in Redis. ~8 TB total across clusters, sharded by user_id.

---

## 8. High-Level Architecture

```
                              ┌───────────────────────────────┐
                              │     Clients (web, mobile)     │
                              └──────────────┬────────────────┘
                                             │ HTTPS
                                             ▼
                              ┌───────────────────────────────┐
                              │              CDN              │
                              │  (media + static; not API)    │
                              └──────────────┬────────────────┘
                                             │
                                             ▼
                              ┌───────────────────────────────┐
                              │       API Gateway / LB        │
                              │  (auth, rate-limit, route)    │
                              └────────┬───────────────┬──────┘
                                       │               │
                              ────── reads ───        ── writes ──
                                       │               │
                                       ▼               ▼
                ┌──────────────────────┐         ┌──────────────────────┐
                │  Timeline Service    │         │   Tweet Service      │
                │  - fetch ZSET        │         │  - validate          │
                │  - hydrate tweets    │         │  - persist (Cass.)   │
                │  - rank (ML)         │         │  - emit to Kafka     │
                │  - merge celeb pull  │         │  - bump counters     │
                └─────┬────────────────┘         └─────┬────────────────┘
                      │                                 │
                      │                                 ▼
                      │                          ┌──────────────────────┐
                      │                          │       Kafka          │
                      │                          │   topic: new_tweets  │
                      │                          └─────┬────────────────┘
                      │                                 │
                      │                                 ▼
                      │                          ┌──────────────────────┐
                      │                          │  Fan-out Service     │
                      │                          │  - lookup followers  │
                      │                          │  - decide push|pull  │
                      │                          │  - ZADD timelines    │
                      │                          │  - or skip (celeb)   │
                      │                          └─────┬────────────────┘
                      │                                 │
                      ▼                                 ▼
              ┌────────────────────────────────────────────────┐
              │             Redis (home_timeline:*)            │
              │       sharded by user_id, ZSET per user        │
              └────────────────────────────────────────────────┘
                      │                                 │
                      ▼                                 ▼
              ┌────────────────────┐         ┌──────────────────────┐
              │  Cassandra:        │         │  Cassandra:          │
              │  tweets,           │         │  follows (forward,   │
              │  tweets_by_id      │         │  reverse)            │
              └────────────────────┘         └──────────────────────┘

                                         ┌────────────────────────┐
                                         │  Ranking Service (ML)  │
                                         │  - feature lookup      │
                                         │  - score model         │
                                         └────────────────────────┘

                                         ┌────────────────────────┐
                                         │  Postgres: users        │
                                         └────────────────────────┘
```

### Hot path A — POST a tweet (non-celebrity author)

```
1. Client POST /v1/tweets.
2. Tweet Service:
   a. Validate (auth, length, content moderation hooks).
   b. Generate tweet_id (Snowflake).
   c. Persist to Cassandra tweets / tweets_by_id (R=1, W=2 with quorum is overkill — use W=1).
   d. Insert into author's own timeline ZSET (read-your-writes guarantee).
   e. Publish event to Kafka new_tweets topic.
   f. Return 201 to client.
3. Fan-out Service consumes Kafka:
   a. Look up author's follower list from Cassandra `followers`.
   b. If author is non-celebrity: bulk ZADD to each follower's timeline.
   c. If author is celebrity: skip (handled at read time — see hot path B).
4. Per-follower timeline truncated to ~800 newest entries (ZREMRANGEBYRANK).
```

### Hot path B — GET home timeline (hybrid)

```
1. Client GET /v1/users/me/timeline.
2. Timeline Service:
   a. Read user's home_timeline ZSET from Redis. (~5 ms)
   b. Identify which celebrities the user follows (in-memory cache from Postgres).
   c. For each celebrity, fetch their last ~50 tweets from Cassandra
      (parallel, cached in Redis; ~10–20 ms)
   d. Merge celeb tweets with user's home_timeline.
   e. Send merged list to Ranking Service (with user features).
   f. Receive ranking scores, sort, return top 20 + cursor.
3. Hydrate tweet_ids → full tweets via Cassandra `tweets_by_id` (cached).
4. Return JSON.
```

Latency budget: ~50–150 ms typical, ~200 ms P99.

---

## 9. Component Deep-Dives

### 9.1 Tweet Service
- Stateless, autoscaled.
- ~6k peak QPS — modest fleet.
- Generates tweet_id (Snowflake — local clock + machine_id; no central counter).
- Single write to Cassandra (W=1 with hinted handoff for replication).
- Kafka publish is **synchronous** in the request (so we can fail the request if Kafka is unhealthy → user retries).
- For author's own timeline: synchronous ZADD to author's ZSET — guarantees read-your-writes.

### 9.2 Fan-out Service
- Kafka consumer fleet.
- For each tweet:
  - Look up author's follower list in Cassandra.
  - Filter non-celebrities (or skip entirely if author is celebrity — see §10.1).
  - Batch ZADD to each follower's timeline ZSET.
  - Cap timeline length: `ZADD ... ; ZREMRANGEBYRANK -801 -1`.
- **Throughput:** 6k tweets/sec × 200 followers avg = 1.2M timeline writes/sec. Distributed across many Redis shards.
- **Failure mode:** if Redis shard is down, we drop fan-out for that range and rely on read-time fallback (celebrity-style merge). Counters track fanout completion.

### 9.3 Ranking Service
- Receives a candidate list of (tweet_id, candidate_features) from Timeline Service.
- Looks up user features (last engagement, current session signals).
- Looks up tweet features (engagement velocity, freshness, author affinity).
- Runs an ML model (gradient-boosted trees / DNN) → score per tweet.
- Returns sorted list with scores.
- **Latency budget**: ~30 ms total, including feature lookup and inference.
- Deployed as a stateless inference service (TorchServe / TF Serving / custom).

### 9.4 Timeline Service
- Stateless, autoscaled.
- Read user's ZSET from Redis.
- Resolve celebrity followees from in-memory cache.
- Pull celebrity tweets from Cassandra (with Redis cache layer).
- Merge, send to Ranking, hydrate, return.

### 9.5 Redis (home_timeline)
- Cluster mode, hundreds of shards.
- Per-shard memory: ~32 GB.
- Sharding key: `user_id`.
- Replication: 1+1 with multi-AZ.
- Persistence: AOF every-second. Loss of last second of timeline writes is fine — Kafka is source of truth and can replay.
- Eviction: per-key trim (we manage size); no `maxmemory-policy lru` because timelines must not be evicted whole.

### 9.6 Cassandra (tweets, follows)
- Cassandra (or DynamoDB, ScyllaDB, Bigtable — same pattern).
- Tweets: partitioned by user_id, clustered by tweet_id DESC.
- Follows: two tables (forward, reverse).
- Consistency: LOCAL_QUORUM for reads of important data, LOCAL_ONE for the timeline-fanout follower lookup (we tolerate eventual).
- Replication factor 3, multi-DC.

### 9.7 Kafka
- `new_tweets` topic, partitioned by user_id (so a user's tweets land in order on the same partition).
- Retention 7 days for replay during incidents.
- Consumer: Fan-out Service.
- Throughput: 6k msg/sec — trivial for Kafka.

---

## 10. Deep-Dives on the Hardest Sub-Problems

### 10.1 Fan-out: write vs read vs hybrid — the celebrity problem

#### Pure fan-out-on-write
```
On post: write to N follower timelines.
Pros:
  - Read is O(1) — just fetch your timeline.
Cons:
  - Write amplification = avg followers (200×).
  - Catastrophic for celebrities (200M followers × 6k posts/sec total?
    one celeb tweet = 200M timeline writes — kills the cluster).
  - Wasted writes for inactive users (fan out to someone who hasn't logged in for 6 months).
```

#### Pure fan-out-on-read
```
On read: query each followee's recent tweets, merge, sort, rank.
Pros:
  - Write is O(1).
  - No wasted writes for inactive users.
Cons:
  - Read is O(F × T) where F = followees (200 avg), T = tweets per followee scanned.
  - Per-read joins across 200 partitions.
  - Read load is 30× write — paying the cost where it hurts most.
  - Latency too high to meet 200ms P99.
```

#### Hybrid (Twitter's actual design: "fanout-on-write + pull for celebrities")

Classify authors:
- **Regular**: < 10k followers → fan-out-on-write.
- **Celebrity**: ≥ 10k followers → no fan-out; pulled at read time.

On read:
```
home_timeline = ZSET (already populated by fanouts of regulars I follow)
celeb_followees = pre-computed set, ~5 typical
celeb_tweets = parallel-fetch each celeb's last ~50 tweets (cached)
candidates = merge(home_timeline, celeb_tweets)
ranked = rank(candidates)
return top 20
```

Trade-off:
- Write QPS to Redis is bounded — celebrities' enormous follower counts no longer multiply through fan-out.
- Read latency includes a small celebrity pull, which is itself well-cached.
- Celebrities make up <0.01% of accounts but account for ~30%+ of fan-out cost — this fix targets the long tail directly.

#### Implementation — celebrity classification
- Threshold can be dynamic: re-evaluate every N hours.
- Once a user crosses to celeb: stop fan-out. Existing entries in followers' timelines remain (they age out).
- A user who drops below threshold: fan-out resumes.
- Edge case: a regular user who suddenly goes viral. Solution: rate-limit fan-out per user (bound at 1M follower writes per tweet; if author has more, switch to celebrity behavior on the fly).

#### Why 10k as the threshold?
- 10k × 6k tweets/sec total = 60M writes/sec at theoretical worst — sustainable.
- Above 10k, the marginal cost of fan-out is high enough to justify the read-time merge.
- In practice tuned per system; could be 50k or 100k. The principle is the same.

### 10.2 Ranking — recency + engagement + relationship affinity

The home timeline is **not** chronological. It's ranked.

Features at a high level:

**Author-level:**
- Affinity to viewer (interaction history)
- Author's overall quality (engagement rate, abuse signals)

**Tweet-level:**
- Velocity (likes/min in last N min)
- Recency (decay factor)
- Type (text/media/video — different priors)
- Recency of the topic (trend signal)

**Viewer-level:**
- Recent engagement history (boost similar)
- Time of day (different appetite at midnight)
- Session signals (just opened app vs deep scroll)

Combine with a learned model: `score = f(features) ∈ [0, 1]`. Rank by score.

Latency budget for ranking: ~30 ms over a candidate set of ~500 tweets. Practical model size: a DNN with 100k–10M params. Feature lookup is the slowest piece — feature store (Redis or in-memory) keyed by (user_id, feature_name) → bytes. Pre-computed features dominate; on-the-fly engineered features live in inference service.

Ranking is its own science — see Twitter's open-sourced ML pipeline as a reference.

### 10.3 Timeline staleness

A user opens the app at T+5s after a tweet was posted. The tweet was fanned out at T+0.5s. Has the user's timeline been refreshed?

- **In-app pull-to-refresh** triggers a Timeline Service call.
- Timeline Service reads the **current** ZSET — fan-out may or may not have completed for this tweet.
- If not yet completed: the tweet appears on next pull.

**SLA: < 30 sec for non-celebrity tweet to appear in followers' timelines.** Achieved by:
- Kafka end-to-end latency < 1s.
- Fan-out worker batch sizes calibrated for throughput vs latency (smaller batches = more workers needed but lower per-tweet delay).
- Per-user timeline ZSET update is atomic ZADD.

For celebrities (read-time merge): timeline freshness equals **author's own profile timeline cache freshness** — ~1 sec.

### 10.4 Read-your-writes

Author posts; immediately refreshes; expects to see their own tweet.

Naive design: post is asynchronous — fan-out hasn't completed → author's own timeline ZSET doesn't include their tweet → not shown.

Fix: **synchronously add author's own tweet to author's own timeline ZSET** in the write path, before returning 201. Independent of Kafka fan-out.

```python
def post_tweet(text, user_id):
    tweet_id = snowflake.next()
    cassandra.insert(tweet_id, user_id, text)
    redis.zadd(f"timeline:{user_id}", score=now, member=tweet_id)  # <-- author's own
    kafka.publish("new_tweets", tweet_id)
    return tweet_id
```

This adds one Redis op (~ms) to the write path — affordable.

### 10.5 Hot keys in Redis (a viral tweet)

A celebrity tweets; the tweet itself becomes a hot key — every follower's read pulls the *same* tweet object from Cassandra/Redis. That's millions of reads of one record.

Defenses:
- **Per-instance L1 cache** in Timeline Service for hot tweets (decay over minutes).
- **Singleflight** on tweet hydration: collapse concurrent fetches for the same tweet_id into one upstream call.
- **CDN at API tier** for popular tweets — though this only helps if the *response* is cacheable (it isn't, because timelines are personalized).
- **Replicate hot keys**: the Redis cluster's hot-key shard CPU saturates. We replicate hot keys to multiple nodes in the cluster, and clients hash with random salt for hot keys.

### 10.6 Inactive users — the wasted-fan-out problem

A user hasn't logged in for 6 months. We're still fanning out 1000s of tweets/day to their timeline.

Fix: maintain `last_seen_at` per user. When fanning out:
- If `last_seen_at < 30 days ago`: skip the fan-out write.
- On next login: trigger a backfill — pull recent tweets from each followee, populate timeline.

Saves ~30%+ of fan-out writes (long tail of dormant accounts). Cost: occasional cold-start latency on return.

---

## 11. Bottlenecks & Scaling

| Load × | What breaks | Symptom | Fix |
|---|---|---|---|
| 1× (now) | — | Healthy | — |
| 10× | Fan-out backlog | Kafka consumer lag, timelines stale > 30s | Scale Fan-out Service horizontally; partition Kafka more aggressively |
| 100× | Hot Redis shard for viral tweet | Shard CPU pegged, P99 spikes | Replicate hot keys; introduce L1 cache; per-shard rate limiting |
| 1000× | Cassandra write throughput on `tweets` | P99 write latency > 50ms | Add Cassandra capacity; tune compaction; consider per-shard sub-keying |
| Cross-region | Cross-region replication of follows / tweets | New tweets take seconds to appear globally | Pre-replicate timelines to local region; accept eventual consistency |

---

## 12. Trade-offs Summary

| Decision | Gained | Gave up | Why right |
|---|---|---|---|
| Hybrid fan-out (write for regulars, read for celebs) | Bounded write QPS, sub-200ms reads | Code complexity, 2-path system | Targets the long tail (celebs); rest of design is simple |
| Materialized timelines in Redis | Sub-10ms timeline read | 8+ TB Redis cost; rebuild on loss | Cost is justified by latency; can rebuild from Cassandra |
| Cassandra for tweets/follows | Massive horizontal scale, predictable | No JOINs, eventual consistency | We never JOIN; eventual is acceptable for follows |
| Postgres for users | Strong consistency on usernames, mature tooling | Limited horizontal scale | Users table is small relative to tweets |
| Snowflake IDs | Time-ordered, globally unique, no central counter | Need NTP-synced clocks | NTP is reliable; alternative central counter is bottleneck |
| Synchronous own-tweet ZADD | Read-your-writes guarantee | One extra Redis op on write path | RYW is non-negotiable UX; cost is small |
| Eventual cross-region | Multi-region serving, lower local latency | New tweets take seconds globally | Acceptable for social media |
| Inactive-user fan-out skip | ~30% fan-out savings | Cold-start backfill on return | Win is significant; backfill is a one-time cost |

---

## 13. Cross-Questions ("Why X and not Y") — ≥ 18

### 13.1 Why fan-out-on-write and not fan-out-on-read?

Fan-out-on-write moves the cost to **post time** (low-frequency event) instead of **read time** (high-frequency event). With a 30:1 read:write ratio, doing the heavy work at write time is 30× cheaper *if* the write fan-out cost is bounded.

The write cost is bounded iff:
- Average follower count is reasonable (200 — yes).
- Celebrity outliers are handled separately (yes — pull at read).

Without celebrity handling, fan-out-on-write would be catastrophic; with it, fan-out-on-write wins.

### 13.2 Why materialize timelines in Redis instead of computing on the fly?

Computing on the fly = fan-out-on-read = O(F × T) per read. At 200 followees, you're hitting 200 partitions per read. Even at 1ms/partition, that's 200ms — exceeds our latency budget.

Materializing = O(1) read (one ZRANGE on one shard). The cost is moved to write time, where it's bounded and parallelizable.

Storage cost (8+ TB Redis) is offset by sub-10ms reads at 200k QPS — buying us ~$1M/year of Redis to save ~$10M/year of compute on a hotter, slower path.

### 13.3 Why ZSET (sorted set) and not LIST?

A LIST gives FIFO order — adequate for chronological timelines. But:

- We rank by score (engagement * recency), not raw chrono. ZSET stores score natively.
- We need to insert tweets out of order (a fan-out for tweet T+5s may arrive after T+10s if processed by different workers). LIST insert at sorted position is O(N); ZSET ZADD is O(log N).
- ZRANGEBYSCORE / ZREVRANGE give cheap ranged queries.

For pure chronological feeds (e.g. WhatsApp message list), LIST is fine.

### 13.4 Why Cassandra for tweets and not DynamoDB / Spanner / sharded Postgres?

All four work. Reasons we pick Cassandra (or DynamoDB):
- **Scale**: 22B tweets/year — both handle it.
- **Write-heavy access pattern**: append-mostly, partition-by-user — Cassandra's LSM structure is optimized for this.
- **Operational maturity**: well-understood, lots of internal tooling.

DynamoDB wins if: AWS shop, want managed.
Spanner wins if: need strong consistency + cross-region transactions (we don't).
Sharded Postgres wins if: small-scale scenario where you'd outgrow it later (not us).

The choice is mostly orthogonal; the **partitioning strategy** matters more.

### 13.5 Why two follow tables (forward + reverse) instead of one?

A single `(follower_id, followee_id)` table indexed both ways needs two indexes. Each index doubles write cost. At 100B edges, the index alone is multi-terabyte.

Two materialized tables, each with its own partition key, gives:
- O(1) "who do I follow?" via `following` partition.
- O(1) "who follows me?" via `followers` partition.
- Same write cost (2 inserts) as the single-table-with-secondary-index approach.

Trade-off: writes must update both tables. We do this in the application layer (best effort, with a reconciliation job for drift). Cassandra MVs (materialized views) automate this but have known tail-latency issues — we prefer explicit dual-write.

### 13.6 Why a 10k follower threshold for celebrity classification?

10k is a heuristic. The true threshold is "where the marginal fan-out cost exceeds the marginal read-merge cost". That depends on:
- Cost of one Redis ZADD vs one Cassandra read.
- Frequency of follower reads vs writer's posts.

Empirically, 10k–100k is the sweet spot. Twitter has historically used something around this range. Tune it dynamically based on cluster load.

### 13.7 Why include retweets in the same `tweets` table instead of a separate one?

Retweets *are* tweets — same shape, same lifecycle, same access patterns. Adding a `is_retweet` boolean and `retweet_of` pointer keeps storage normalized.

Hydration: when displaying a retweet, the client follows `retweet_of` to fetch the original tweet's content.

Alternative: separate `retweets` table. We'd avoid mixing types, but pay double in joins (every timeline expansion would need to look up both tables). Not worth it.

### 13.8 Why eventual consistency on follows?

Follow propagation: user A follows user B. B posts a tweet within 100ms. Does A see it?

Strict consistency would require: the follow write blocks until the new edge is available globally. Latency: ~100ms in single region, ~500ms cross-region. We don't want to block follow on cross-region propagation.

Eventual consistency (within ~1s) means: A may miss B's first tweet. On next refresh, A sees it. The window is small enough to be acceptable.

If a product requires strict (e.g. sensitive notifications), we'd do "ack-after-fanout" — wait for all replicas to acknowledge before returning success. That's strictly slower; we trade for the rare case where it matters.

### 13.9 Why no L1 cache in front of Cassandra for tweets_by_id?

We **do** have an L1: every Timeline Service instance has a small in-process tweet cache (LRU, ~10k entries). It absorbs the hot top-N tweets on any given day.

What we *don't* have is a Redis L2 in front of Cassandra for tweet hydration. Reasons:
- Per-tweet lookup is already fast in Cassandra (~2 ms with row cache hit).
- Adding Redis as L2 would be ~50% redundant with timeline ZSETs.
- Tweet objects are large (~250 bytes); putting them in Redis would balloon memory.

Alternative consideration: per-tweet Redis cache for the very hottest viral tweets only. If we want to.

### 13.10 Why merge celebrity tweets at read time rather than fan-out to a smaller subset?

"Fan-out only to active users who follow the celebrity" — it sounds appealing but:
- Celebrities have 100M+ followers; even 10% active is 10M writes per tweet.
- Maintaining "active subset" lists is its own problem.
- Read-time merge is bounded: a user follows at most ~5 celebrities; fetching their last 50 tweets is 250 lookups per read — well-cached.

Read-time merge is the cleaner separation: writes always cheap (or skipped), reads pay a small bounded cost.

### 13.11 What if a celebrity unfollows someone obscure — how do we know not to fanout in reverse?

That's not how unfollows work. The follower's home timeline gets re-derived on next read; there's no immediate cleanup needed. Stale entries from before the unfollow are filtered out at read time (the Timeline Service rechecks `is X still followed by viewer?` for each candidate before showing).

This adds a check per candidate, but that's already happening for the rank step.

### 13.12 Why Snowflake IDs and not UUIDs?

UUIDs are 128 bits (vs 64 for Snowflake) — 2× storage cost across billions of rows.
UUIDs are random — break Cassandra clustering on tweet_id (no time order).
UUIDs are not globally sortable — we'd need a separate `created_at` index.
UUIDs are unguessable, which is good for security tokens, irrelevant for tweet IDs.

Snowflake gives us: small, time-sortable, partition-aware, machine-attributable. All the properties we need.

### 13.13 What happens when fan-out fails for some users?

Best-effort: log the failure, continue with others.
Reconciliation: a periodic job re-derives timelines for any user whose `last_fanout_at` lags the latest tweet by more than 5 minutes.
Catch-all: at read time, Timeline Service detects stale timelines (no entries newer than X seconds) and triggers a backfill.

Net result: timelines are eventually correct; transient fan-out failures are invisible to users.

### 13.14 How does the system handle a tweet that's deleted?

- Mark `deleted_at` on the `tweets` row; don't actually delete (for audit / abuse review).
- Publish a `tweet_deleted` event to Kafka.
- Fan-out service performs reverse fan-out: ZREM from each follower's timeline.
- Same celebrity exception: if author was celebrity, no fan-out (the deleted tweet falls out of read-time merge naturally on next refresh).

User sees the tweet disappear from timelines within ~30s of delete.

### 13.15 Why publish to Kafka instead of fanning out synchronously in the write path?

Synchronous fan-out would block the post API until 200+ Redis writes complete. Latency: ~50–100ms minimum, much worse if any shard is slow. Author's UX suffers.

Async via Kafka decouples:
- Post returns in <100ms.
- Fan-out happens in <1s (target).
- If fan-out service is degraded, posts still succeed; recipients see tweet a bit later.

Trade-off: a window of inconsistency between post and visibility. Mitigated by: (a) read-your-writes for author, (b) celebrity pull for important authors, (c) fast Kafka.

### 13.16 What's the failure mode if the entire Redis cluster goes down?

Catastrophic but recoverable:
- Reads degrade to read-time fan-out from Cassandra (fan-out-on-read fallback) — slower (~1s P99) but functional.
- Writes continue (Tweet Service writes to Cassandra; Kafka queues fan-out for replay when Redis returns).
- On Redis return: Fan-out Service replays Kafka from the last committed offset; timelines re-populate.

A full timeline rebuild for an inactive user is on-demand at next read. For 200M users, the cluster cold-start would be slow (~hours of warming) — we provision Redis for permanent residency, not cold start.

### 13.17 How do you prevent infinite scrolling from melting the system?

- **Pagination caps**: max 1000 tweets returned across all pages of a single session.
- **Cursor signing**: cursor includes a signed expiration so old cursors return 410.
- **Per-user QPS cap**: 5 timeline GETs per second per user (rate-limiter).
- **Pre-paginate**: clients are told `page_size = 20`; smaller pages = more frequent server hits for the same scroll, but shorter requests.

Beyond that, infinite scroll is a UX choice — we serve as long as the user pulls, but each pull is a fresh request that goes through normal limits.

### 13.18 Why have ranking at all instead of pure reverse-chrono?

Ranked timelines:
- **Engagement is higher**: users scroll farther when content is relevant.
- **Time spent grows**: ad inventory grows.
- **Quality content surfaces**: viral but old tweets can outrank stale boring new ones.

Trade-off: users complain ("I want chrono!"). Many platforms offer a chrono fallback toggle. Implementation: chrono fallback is the ZSET sorted by tweet_id — basically free.

### 13.19 What if the ML ranking model is broken / serving garbage?

Mitigations:
- **Shadow inference**: new models run in shadow alongside current model; we A/B compare metrics before promoting.
- **Fallback**: if model latency > 50ms or returns errors, degrade to "engagement * recency" formula (no ML). Worse rankings, but timeline still works.
- **Per-user circuit breaker**: if a model fails for a specific user repeatedly, route them to fallback.

Models are versioned and rolled back via flag; rollback < 1 minute.

---

## 14. Common Follow-Ups

### 14.1 Now add **trending hashtags**

Separate pipeline:
- Tweet Service emits hashtag mentions to a `hashtags` Kafka topic.
- A streaming aggregator (Flink) computes per-region top-K hashtags over a tumbling 5-min window with exponential decay.
- Results published to a Redis `trending:{region}` ZSET.
- Trending Service reads from Redis on demand.

Anti-spam: dedup by user_id (one user spamming a hashtag doesn't count 10000×). Velocity vs absolute count. Country-region scoping.

### 14.2 Now add **search**

Out-of-line index:
- Tweet Service emits to a Kafka topic.
- An ingestion job indexes into Elasticsearch / OpenSearch.
- Search Service is a separate read path on Elasticsearch.

Real-time freshness: ~1–10s. Acceptable for search (vs timelines' < 30s).

### 14.3 Now make it **multi-region**

- Each region has its own Redis (timelines), Cassandra (tweets, follows), Postgres (users — replicated).
- Tweets propagate via Kafka MirrorMaker cross-region — eventually consistent globally.
- Follows propagate similarly.
- Cross-region reads stay local (fast).
- Cross-region writes for follow / post: written to local primary, async-replicated.

Conflict resolution: rare. Usernames are reserved at signup via a global service (paxos / etcd). Tweets have unique Snowflake IDs (no conflict possible).

### 14.4 What about **DMs**?

Different system entirely. DMs are point-to-point, encrypted, durably stored, with read-receipts and presence. Built like a chat app — not a feed. Out of scope here.

### 14.5 Now add **real-time push to clients**

Web/mobile clients subscribe to a Pub/Sub channel. Tweet Service publishes to channel `user:{user_id}:timeline_update` after fan-out. Client receives push, prepends to in-app feed.

Architecture: WebSocket or SSE service fronted by a connection manager (millions of long-lived TCP connections). Sticky routing by user_id. Backpressure if user has too many tabs.

Adds complexity; for many products, "pull-on-app-foreground" is enough.

### 14.6 What if a tweet contains an image / video?

Media pipeline:
- Client uploads media to a presigned URL on object storage (S3).
- Server stores media URL only in `tweets.media`.
- CDN serves media (heavy traffic).
- Video transcoding pipeline (HLS / DASH).

The text/feed system stays unchanged. Media is a parallel concern.

---

## 15. Cheat-Sheet Recap

1. **Problem:** Ranked home timeline at internet scale; handle celebrity asymmetry.
2. **Scale:** 200M DAUs, 6k peak post QPS, 200k peak timeline QPS, 30:1 read:write.
3. **Hot path read:** Redis ZSET → merge with celeb pull from Cassandra → rank → hydrate.
4. **Hot path write:** Tweet Service → Cassandra + own ZSET (RYW) → Kafka → Fan-out (skip celebs).
5. **Storage:** Cassandra for tweets+follows (sharded), Redis for timelines (~8 TB), Postgres for users.
6. **ID gen:** Snowflake (time-ordered, no central counter).
7. **Ranking:** Recency + engagement + affinity, ML model, ~30 ms budget.
8. **Biggest trade-off:** Hybrid fan-out — code complexity in exchange for bounded write QPS.
9. **Breaks at 100×:** Hot Redis shards on viral tweets → L1 cache + hot-key replication.
10. **What I'd add next:** Real-time push, search, trending, multi-region.

---

## Appendix A: Numbers worth remembering

```
DAU                   = 200M (this design)
Avg followees / user  = 200
P99 followers         = 100k
P99.99 followers      = 10M (top accounts: 100M+)
Posts/sec peak        = ~6k
Timeline reads/sec    = ~200k peak
Timeline storage      = ~8 TB (Redis, materialized)
Tweet storage         = ~30 TB / year (Cassandra)
Follow edges          = 100B
Fan-out write QPS     = ~1M (excluding celebs)
Fan-out latency SLA   = < 30 sec for non-celeb tweets
```

## Appendix B: Why this question is hard

```
- Scale: every component is at the edge of feasible
- Asymmetry: power-law distribution of followers breaks naive designs
- Multiple hot paths: read AND write are critical
- Latency-critical: < 200ms P99 read
- Hybrid system: two architectures (push and pull) cohabit
- Storage > compute: 8 TB+ of timelines is real money
- Ranking layer: an entire ML system on top
```

## Appendix C: Real-world references

```
Twitter Engineering blog on timelines:    canonical hybrid design
Facebook Newsfeed (Memcached, TAO):       similar at higher edge density
Instagram Feed (Cassandra + Redis):       same pattern, photo emphasis
LinkedIn Feed (Espresso + Voldemort):     same pattern with stronger affinity
Pinterest Feed (HBase + Redis):           similar; image-heavy
```

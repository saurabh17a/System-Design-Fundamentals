# Reddit — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[forum]` `[voting]` `[ranking]` `[threaded-comments]`
> **Companies that ask this:** Reddit, HackerNews, Stack Exchange

---

## Beginner's Guide

### What's this in plain English?

Reddit. People post; others upvote / downvote. Posts with more upvotes float to the top. Plus: deeply nested comment threads, subreddits (topical communities), moderation. The "hot" feed isn't simple "by votes" — it factors in time so old posts decay.

### Why solve it?

- **Real world**: Reddit, Hacker News, Stack Exchange.
- **Teaches**: ranking algorithms (Reddit's "hot" formula uses log + time decay), threaded comments, voting at scale.

### Vocabulary

- **Subreddit** — topical community.
- **Post** — submission with title, body/link, votes.
- **Comment** — reply; can have nested replies (tree).
- **Hot rank** — `log(votes) + time_factor`. Decays.
- **Karma** — user's total upvote count.

### High-level architecture

```
User → API → Post Service → Vote Service → Re-rank Worker → Cached "Hot" lists
                                                  ↓
                                            Comment Service (tree storage)
```

Components:
1. **Post storage** — partitioned by subreddit.
2. **Vote ingest** — high write rate; eventual consistency.
3. **Hot ranker** — per subreddit, periodically recompute hot lists.
4. **Comments** — stored as a tree; pagination of nested branches.
5. **Search** — full-text across posts + comments.

Ranking trade-offs: real-time-ish ranks (every minute) are good enough; sub-second isn't worth the cost.

### How to read this doc

- **Beginner**: focus on the hot formula + threaded comments storage.
- **Interview**: cross-questions on vote manipulation, sub-second ranks, mod tools.

---

## 0. How to use this doc

Reddit tests **forum + voting + ranking + threaded comments + moderation**. The hard parts are:
1. **Hot ranking** (Reddit's "hot" formula uses log of votes + time decay).
2. **Threaded comments** at scale (popular post = 10k comments).
3. **Vote dedup** (one vote per user per item).

---

## 1. Problem Statement

Forum platform:
- Subreddits (topic communities).
- Posts (link, text, image).
- Threaded comments.
- Voting (upvote/downvote on posts and comments).
- Ranking: Hot, New, Top, Controversial.
- User feeds based on subscriptions.
- Moderation.

---

## 2. Clarifying Questions

- [ ] Real-time updates?
- [ ] Anonymous or accounts only?
- [ ] Karma system?
- [ ] Comment depth limit?
- [ ] Sort orders supported?

> **Assume:** real-time vote updates within seconds, accounts required, karma yes, no depth limit (rendered with collapse), Hot/New/Top/Controversial.

---

## 3. Functional Requirements

**P0:**
1. Create subreddit, subscribe.
2. Post (link/text/image) to subreddit.
3. Comment + nested replies.
4. Vote on posts and comments.
5. Front page: home (subscribed) or popular.
6. Sort by Hot / New / Top / Controversial.
7. User profile + karma.
8. Moderation tools (delete, ban).

**P1:**
9. Awards / badges.
10. Saved posts.
11. Search.

**P2:**
12. Live threads.
13. Polls.

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.99% |
| Page load | < 500 ms |
| Vote propagation | < 5 s for ranking update |
| Throughput | 100k votes/sec, 10k posts/sec |

---

## 5. Capacity Estimation

```
DAU: 100M
Posts/day: 10M
Comments/day: 100M
Votes/day: 1B = 11k/sec sustained, 100k/sec peak
Subreddits: 5M, top 1000 active
```

---

## 6. API

```
POST /v1/posts                      body: {sub, title, body, type}
GET  /v1/r/{sub}?sort=hot|new|top|controversial
POST /v1/posts/{id}/vote            body: {value: -1|0|+1}
POST /v1/comments                    body: {post_id, parent_id?, body}
GET  /v1/posts/{id}/comments?sort=
GET  /v1/feed                        -> subscribed front page
```

---

## 7. Data Model

### Posts (Cassandra)
- `(subreddit_id, post_id, ts, author, title, body, score, comment_count)`

### Comments (Cassandra)
- `(post_id, comment_id, ts, parent_id, author, body, score)`

### Votes (Cassandra)
- `(post_id, user_id) → vote_value` — for dedup.
- `(comment_id, user_id) → vote_value`.

### Sub subscriptions (Cassandra by user_id)
- `(user_id, sub_id, subscribed_at)`

### Hot ranking (Redis ZSET per sub)
- `hot:{sub} → ZSET (score, post_id)`.
- Updated on every vote.

---

## 8. Architecture

```
              Clients
                 │
                 ▼
              API GW
                 │
       ┌─────────┼─────────┬──────────┬─────────┐
       ▼         ▼         ▼          ▼         ▼
    Post Svc  Vote Svc  Comment Svc Ranker   Feed Svc
       │         │         │          │
       └─────┬───┴─────────┴──────────┘
             ▼
       Cassandra + Redis (ranking)
             │
             ▼
       Search via Elasticsearch
```

---

## 9. Component Deep-Dives

### 9.1 Voting
- Per-user-per-item dedup.
- Update: change from -1 to +1 = +2 score change.
- Atomically: read existing → CAS new value → emit delta to ranker.

### 9.2 Hot ranking
Reddit's formula:
```
score = log10(max(|ups - downs|, 1)) × sign(ups-downs) + ts/45000
```
- Logarithmic scaling: 1000th vote less impactful than 10th.
- Time decay: newer posts boosted.
- Updated on every vote → ZSET update.

### 9.3 Threaded comments
- Per-post comment tree.
- Parent_id links.
- Render: depth-first with depth limit on UI.
- Sort within siblings: by score, ts, etc.

### 9.4 Feed
- User's subscribed subreddits.
- Per-user pre-computed: top from each sub interleaved by score.
- Refreshed every few minutes.

### 9.5 Ranker pipeline
- Vote → Kafka → Ranker svc.
- Updates score in Cassandra; updates ZSET in Redis.

---

## 10. Hard Sub-Problems

### 10.1 Hot ranking at scale
100k votes/sec. Each = ZSET update. Sharding by subreddit handles it; hot subs may need additional sharding.

### 10.2 Vote dedup
- One vote per user per item.
- Old vote replaced; delta emitted.
- Strict consistency on this single key.

### 10.3 Comment trees with millions of comments
- Pagination by depth + parent.
- "Load more replies" buttons.
- Top-level comments first; nested loaded on click.

### 10.4 Moderation queue
- Reports → mod queue per sub.
- Mods see + act.
- Auto-mod rules for spam.

---

## 11. Cross-Questions ≥ 12

### 11.1 vs Twitter feed?
- Reddit: subreddits = topic-based; Hot/Top sort.
- Twitter: follow graph; reverse-chrono mostly.
- Reddit is "interest-graph"; Twitter "social-graph".

### 11.2 Vote count consistency?
Eventually consistent via Cassandra counter columns or aggregator pipeline. Tolerable: vote count off by ±10 on viral post.

### 11.3 Spam defense?
- Karma-based (low karma can't post).
- Rate limits.
- ML on text/links.
- Manual mod.

### 11.4 What about re-posts?
Detection via title/url similarity; not strictly enforced.

### 11.5 Karma calculation?
Sum of votes received on user's posts/comments. Cached.

### 11.6 New user account creation defense?
- Email verification.
- Captcha.
- Pattern detection.

### 11.7 Cross-region?
Per-region read replicas; writes to home region.
Vote ordering: per-post serialized.

### 11.8 Awards?
Tipping system; awards stored on post; visible badges.

### 11.9 Live threads?
Separate WS-based service.
Broadcast updates to subscribers.

### 11.10 Search?
Elasticsearch; index posts + comments.
Per-sub or global queries.

### 11.11 Image / video uploads?
S3 + CDN.

### 11.12 NSFW handling?
Tagged at post creation. Filtered by user prefs.

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| Eventually consistent vote count | Speed | Brief inaccuracy |
| Per-sub Redis ZSET | Fast Hot read | Many ZSETs |
| Async ranker pipeline | Decoupled | ~5s lag |
| Cassandra + Redis | Right tool per access | Dual storage |

---

## 13. Cheat-Sheet

1. **Subreddits → Posts → Comments** hierarchy.
2. **Per-(item, user) vote dedup** in Cassandra.
3. **Hot ZSET per sub**, updated on each vote via Kafka pipeline.
4. **Reddit formula**: log10(votes) + ts/45000.
5. **Comment tree** = parent_id pointers; pagination by depth.
6. **Feed**: pre-computed top-K from subscribed subs.

# LinkedIn — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[social-graph]` `[feed]` `[search]` `[recommendations]`
> **Companies that ask this:** LinkedIn, Meta, Twitter, Indeed

---

## Beginner's Guide

### What's this in plain English?

LinkedIn. Profiles, connections (mutual; you have to accept), a feed of posts from your network, a messaging system, a job board, search ("Find recruiters at Stripe in SF"). Several large systems glued together.

### Why solve it?

- **Real world**: LinkedIn, Indeed, business social networks.
- **Teaches**: connection graph (vs follow graph), feed for a different model, search across profiles + jobs, recommendations.

### Vocabulary

- **Connection** — mutual, both sides accepted (vs Twitter's one-way follow).
- **1st / 2nd / 3rd-degree** — graph distance from you.
- **Feed** — posts from your connections (like Twitter, but smaller graph).
- **Profile** — large structured doc (work history, skills, education).
- **Job** — listing with title, location, requirements.

### High-level architecture

```
Profile / Graph Service  ←→  Feed Service  ←→  Search (Elasticsearch)
        ↓                          ↓
Connections DB             Per-user feed cache
        ↓
Job Service / Recommendations
```

Components:
1. **Profile** — large per-user doc; storage + edit.
2. **Graph** — connection edges; query 2nd-degree paths for "people you may know."
3. **Feed** — posts from connections; smaller scale than Twitter, fan-out simpler.
4. **Search** — across profiles and jobs; filters by location, title, skills.
5. **Jobs** — listings + recommendations per user based on profile.

### How to read this doc

- **Beginner**: focus on connection vs follow graph difference.
- **Interview**: cross-questions on graph queries, search ranking, jobs ranking.

---

## 0. How to use this doc

LinkedIn is a hybrid: feed (like Twitter) + connection graph + jobs marketplace + messaging. Tests:
1. Connection graph (mutual links, not follow).
2. People-You-May-Know (graph traversal).
3. Job recommendations.
4. Messaging.
5. Feed ranking.

---

## 1. Problem Statement

A professional networking platform:
- Profile + connections (mutual).
- News feed of connections' posts.
- Job postings, applications, recommendations.
- Messaging (1:1).
- Search (people, companies, jobs).
- "Who viewed your profile."

---

## 2. Clarifying Questions

- [ ] Scale (DAU)?
- [ ] Connections vs followers?
- [ ] Jobs marketplace in scope?
- [ ] Messaging?
- [ ] Endorsements / skills?

> **Assume:** 200M DAU, mutual connections (max ~30k per user), jobs in scope, basic messaging, skills/endorsements.

---

## 3. Functional Requirements

**P0:**
1. Profile (CRUD).
2. Send / accept connection request.
3. Post update; appears in connections' feeds.
4. Feed (ranked).
5. Search people / companies.
6. Job postings + apply.
7. Messaging.

**P1:**
8. Recommendations: PYMK, Jobs, Companies.
9. Profile views ("who viewed me").
10. Endorsements / skills.

**P2:**
11. LinkedIn Live.
12. LinkedIn Learning.

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.99% |
| Feed latency | < 200 ms |
| Connection request | < 1 s |
| Search | < 500 ms |
| Throughput | 50k posts/sec peak |

---

## 5. Capacity Estimation

```
Users: 1B
Avg connections: 500
Connection edges: 500B
Posts/day: 5M
Feed reads/day: 10B
Job postings active: 50M
```

---

## 6. API

```
POST /v1/connections/{user_id}    -> request
PUT  /v1/connections/{request_id}/accept
GET  /v1/feed                     -> ranked posts
POST /v1/posts
GET  /v1/people/search?q=
GET  /v1/jobs?filters=
POST /v1/jobs/{id}/apply
WS   /v1/messages/connect
```

---

## 7. Data Model

### Connections (Cassandra, dual table)
- `connections_by_user(user_id, peer_id, connected_at)`
- Plus `connection_requests(user_id, request_id, from_id, status)`.

### Posts (Cassandra by author_id)
- `(author_id, ts, post_id, content, media)`

### Feed cache (Redis ZSET per user)
- Pre-computed; refreshed periodically.

### Profiles (Postgres or document DB)
- Rich profile data.

### Jobs (Postgres + Elasticsearch)
- `jobs(id, company, title, description, requirements)`.

### Messages (Cassandra; like WhatsApp)
- Per-user inbox.

### Graph (separate service)
- For PYMK and "2nd-degree" queries.
- May use specialized graph DB (Neo4j, custom).

---

## 8. Architecture

```
              Clients
                 │
                 ▼
          API Gateway
                 │
       ┌─────────┼──────────┬──────────┬───────────┐
       ▼         ▼          ▼          ▼           ▼
   Profile   Connection   Feed      Jobs       Messaging
   Service   Service      Service   Service    Service
                 │          │
                 ▼          ▼
          Graph Service  Ranker (ML)
                 │
                 ▼
            Cassandra (connections, posts, msgs)
            Postgres (profiles, jobs)
            Elasticsearch (search)
            Redis (feed cache, presence)
```

---

## 9. Component Deep-Dives

### 9.1 Connection graph
- Mutual; both users must accept.
- Symmetric storage: dual writes.
- 2nd-degree (friends-of-friends) for PYMK: pre-compute periodically.
- Recommendation features (school, employer, similar profiles) feed ML.

### 9.2 Feed
- Same as Twitter pattern: hybrid fan-out.
- Most users have <500 connections (no celebrity problem).
- Influencers (1M+ followers) — pull at read.

### 9.3 Search
- Elasticsearch: name, title, company, skills.
- Ranking boosts: connection degree, mutual connections, search history.

### 9.4 Jobs
- Posted by companies.
- Ranking signals: location, role match, skills, salary.
- Apply: stores applicant; company sees in dashboard.

### 9.5 Messaging
- Same architecture as WhatsApp's chat svc.
- 1:1 typically; no large groups.

### 9.6 Profile views
- Each profile view emits an event.
- Aggregated daily into "who viewed me" report.
- Premium feature.

---

## 10. Cross-Questions ≥ 12

### 10.1 Connection vs follow?
Connection: mutual (both accept). Follow: one-way.
LinkedIn primarily mutual; X/Twitter primarily one-way.
LinkedIn now supports follow-only for influencers (broadcast without symmetric tie).

### 10.2 PYMK algorithm?
- 2nd-degree connections (friends of friends).
- Same school / employer.
- Imported contacts.
- Cluster-based recommendations from ML.

### 10.3 Why feed fan-out?
Same as Twitter — read >> write; fan-out at write distributes cost.

### 10.4 Why graph DB?
Connection traversals (2nd, 3rd degree) are graph queries.
Cassandra/SQL can do, but graph DB optimizes path queries.
Many systems just use sharded SQL/Cassandra and accept some compute.

### 10.5 Job recommendations?
ML from user profile, history, skills.
Per-user pre-computed list; refresh daily.

### 10.6 Search ranking?
Bayesian: prior on candidate (connection degree, recency) + match score.

### 10.7 Endorsements?
Per-user-per-skill counter.
Adding endorsement = increment + log; recipient notified.

### 10.8 Profile completeness?
Server-side rule engine; nudge users to fill missing fields.

### 10.9 Privacy controls?
- Hide profile from search.
- "Anonymous" profile views.
- Per-section visibility.

### 10.10 What if I have 30k connections?
Fan-out is bounded; LinkedIn allows up to 30k.
Beyond: forced to follow-only model.

### 10.11 Compliance?
- PII encryption at rest.
- Soft-delete; full delete on request (GDPR).

### 10.12 Cross-region?
Per-region service; users mostly access from home region.

---

## 11. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| Mutual connections | Curated network | Slower growth than follow |
| Hybrid fan-out feed | Fast read | Code complexity |
| ES for search | Mature | Operational |
| Pre-computed PYMK | Fast | Daily-stale |

---

## 12. Cheat-Sheet

1. **Connections** as mutual graph (dual-table).
2. **Hybrid fan-out** feed (regulars + influencers).
3. **ES** for search.
4. **Per-user feed cache** (Redis ZSET).
5. **Graph service** for 2nd-degree queries.
6. **ML** for recommendations (PYMK, jobs).

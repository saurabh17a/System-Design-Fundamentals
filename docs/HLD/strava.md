# Strava (Activity Tracking + Segments) — High-Level Design

> **Difficulty:** Medium → Hard
> **Tags:** `[hld]` `[geospatial]` `[time-series]` `[leaderboard]` `[social]`
> **Companies that ask this:** Strava, Garmin, Nike, MapMyRun

---

## Beginner's Guide

### What's this in plain English?

Strava. You go for a run with your watch. It records GPS points every second. You upload. Strava shows a map, distance, pace, elevation, and ranks you on **segments** — predefined hill-climbs or routes — against everyone else who ran them. Plus a social feed of your friends' activities.

### Why solve it?

- **Real world**: Strava, Garmin Connect, Nike Run Club, MapMyRun.
- **Teaches**: GPS time-series ingest, geospatial matching against polylines, leaderboards per segment.

### Vocabulary

- **Activity** — one workout (run, ride).
- **Track** — the GPS path: a list of (lat, long, time) points.
- **Segment** — a predefined sub-route; users compete on times.
- **PR** — personal record on a segment.
- **Feed** — social view of friends' activities.

### High-level architecture

```
Watch → Activity ingest → Compress + store
            ↓
       Segment matcher (does this track contain segment X?)
            ↓
       Per-segment leaderboard (Redis ZSET)
            ↓
       Social feed (fan-out to friends)
```

Components:
1. **Ingest** — accept GPS tracks; compress (typical run = thousands of points).
2. **Segment matching** — for each activity, find which segments it traversed.
3. **Leaderboards** — per segment, sorted by completion time.
4. **Feed** — friends' recent activities; fan-out at activity completion.

Storage: tracks are time-series, mostly write-once; cheap object storage works.

### How to read this doc

- **Beginner**: focus on segment matching concept.
- **Interview**: cross-questions on GPS noise, privacy zones, anti-cheat.

---

## 0. How to use this doc in an interview

Strava tests **time-series geo data + leaderboards + social feed**. Tests:
1. GPS track ingest (per-second points).
2. Segment matching: did this activity pass through a known segment?
3. Leaderboard per segment (top times).
4. Social feed of friends' activities.

---

## 1. Problem Statement

A fitness tracker:
- Athletes record GPS-tracked activities (run, ride).
- Upload activity → process (distance, elevation, segments).
- View segments (named popular paths); leaderboards.
- Friends' feed (kudos, comments).

---

## 2. Clarifying Questions

- [ ] Live tracking during activity?
- [ ] Power data, heart rate?
- [ ] Heatmaps?
- [ ] Premium features?
- [ ] Privacy zones?

> **Assume:** post-activity upload (no live), HR/power yes, no heatmaps in scope, premium tiers, privacy zones supported.

---

## 3. Functional Requirements

**P0:**
1. Upload activity (GPX/FIT format).
2. Process: compute distance, elevation, time, segments traversed.
3. View activity detail.
4. Segment leaderboards (top N times).
5. Friends feed.
6. Kudos / comments.

**P1:**
7. Privacy zones (hide start/end of activity near home).
8. Power-of-the-day stats.
9. Goals.

**P2:**
10. Live tracking.
11. Group rides.
12. Routes / planning.

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.9% (read), 99.5% (write — activities can retry) |
| Activity processing | < 1 min from upload to feed |
| Feed load | < 500 ms |
| Leaderboard | < 200 ms |

---

## 5. Capacity Estimation

```
DAU: 10M
Activities / DAU / day: 0.7 (most don't activity every day)
Activities / day: 7M = 80/sec
Avg activity = 1 hour with 1 GPS point/sec = 3600 points × ~50 bytes = 180 KB
Total daily ingest: 7M × 180 KB = 1.3 TB/day
Total annual data: ~500 TB
```

---

## 6. API

```
POST /v1/activities/upload   body: GPX/FIT file
GET  /v1/activities/{id}
GET  /v1/feed                            -> friends' recent activities
POST /v1/activities/{id}/kudos
GET  /v1/segments/{id}/leaderboard
```

---

## 7. Data Model

### Activities (Postgres for metadata, S3 for raw track)
- `activities(id, user_id, type, started_at, distance, duration, elevation, ...)`.
- Raw GPX file in S3.

### GPS points (compressed time-series in S3 or Cassandra)
- One activity = one blob (compressed, ~50 KB).
- Stored as Parquet or custom format for analytical queries.

### Segments (PostGIS)
- Named popular paths.
- Each: polyline + start/end markers.
- Indexed by spatial bounds.

### Segment efforts (Cassandra, partitioned by segment_id)
- `(segment_id, time_seconds, athlete_id, activity_id)` — leaderboard read.
- Sorted set in Redis for top-K.

### Feed (Redis ZSET per user)
- Pre-computed from friends' activities.

---

## 8. Architecture

```
              ┌──────────────────────┐
              │   Mobile / Watch     │
              └──────────┬───────────┘
                         │
                ┌────────▼────────┐
                │   Upload Svc    │
                │  - parse GPX    │
                │  - persist raw  │
                │  - emit event   │
                └────────┬────────┘
                         │
                         ▼
                ┌──────────────────┐
                │ Activity Pipeline│
                │ - compute metrics│
                │ - segment match  │
                │ - feed fan-out   │
                └────────┬─────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
  ┌──────────┐    ┌────────────┐    ┌────────────┐
  │ Postgres │    │ Cassandra  │    │ Redis      │
  │ acts meta│    │ efforts    │    │ feeds,     │
  │          │    │            │    │ leaderbd   │
  └──────────┘    └────────────┘    └────────────┘
                                        │
                            ┌───────────┴────────┐
                            │  PostGIS for       │
                            │  segments index    │
                            └────────────────────┘
```

---

## 9. Component Deep-Dives

### 9.1 GPX/FIT parsing
- Mobile uploads compressed file.
- Parser extracts time-stamped GPS points (lat, lng, ele, hr, power).
- Validate: trim corrupt points; enforce time order.

### 9.2 Segment matching
- Hardest piece.
- Per activity: for each known segment whose bounding box overlaps the activity's bounding box → check whether activity polyline passes through segment.
- Segment trail: if activity has GPS points within 30m of segment start AND end (in order), and the path between matches loosely → it's an effort.
- Effort time = duration between matched start and end points.
- Persist effort to Cassandra; update segment leaderboard ZSET in Redis.

### 9.3 Feed fan-out
- After processing: write activity to friends' feeds (Redis ZSET, score = ts).
- Like Twitter fan-out; bounded by typical follower count (max 1000s for power users).

### 9.4 Leaderboard
- Redis ZSET per segment, score = time, member = athlete_id.
- Top K via ZRANGE.
- Per-month leaderboards: separate ZSETs with TTL.

---

## 10. Hard Sub-Problems

### 10.1 Segment matching at scale
- 1M segments globally; 80 activities/sec.
- Naive: check every activity against every segment = 80M comparisons/sec.
- Optimization: per-region segment index (PostGIS); spatial query first → ~100 candidates per activity.

### 10.2 Privacy zones
- User defines circle around home (e.g. 200m radius).
- On activity processing: trim track points within zone.
- Activity persists trimmed; raw original kept private.

### 10.3 GPS noise / cheating
- Track smoothing on upload.
- Speed-cheat detection (e.g. car-speed on a bike).
- Effort flagged; not counted on leaderboard.

### 10.4 Massive activities (long bike rides)
- Ultra-distance: 12-hour rides → 43k GPS points.
- Same processing; may take longer.
- Separate queue for long activities.

---

## 11. Cross-Questions ≥ 12

### 11.1 Why store GPS points in S3 not DB?
- 1.3 TB/day.
- DB would bloat indexes and slow queries.
- S3 is cheap + scalable; rare access (only on activity detail view).

### 11.2 Why Postgres for activity metadata?
- Small per-activity record; ACID; queryable.

### 11.3 Why Cassandra for segment efforts?
- High write rate; wide partitions per segment.
- Read by segment for leaderboard; partition fits.

### 11.4 Why Redis for leaderboards?
- Sub-ms read for top-K.
- Sorted set built-in.
- Backed by Cassandra for durability.

### 11.5 What if a user uploads same activity twice?
- Dedup by content hash.
- Reject second upload with reference to first.

### 11.6 How do you handle elevation data?
- Phone GPS elevation noisy; cross-reference with elevation map (DEM).
- DEM loaded into in-memory cache; lookup per point.

### 11.7 What about heart rate / power?
- Optional sensor data in upload.
- Stored alongside GPS points.
- Aggregates (avg HR) computed during processing.

### 11.8 How do you handle a user who joins a club / segment after recording?
- Per activity timestamp; join precedes activity → effort counted.
- Can also retroactively ride: opt-in.

### 11.9 Why fan-out feed and not pull?
- Like Twitter: feed is read-heavy; pull is N×M expensive.
- Fan-out gives O(1) feed read.

### 11.10 What about heatmap (popular routes)?
- Aggregate global heatmap from anonymized rides.
- Tile-based; computed offline.
- Out of scope for base.

### 11.11 What if I need to support live tracking (Beacon)?
- Add WS-based live channel.
- Per-second updates from athlete's phone to server.
- Friends subscribed see real-time location.

### 11.12 Cross-region privacy laws (GDPR)?
- Privacy zones by user prefs.
- Raw track deletable on request.
- Anonymized heatmap separate from PII.

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| S3 for raw tracks | Cheap | Slow access |
| Spatial pre-filter for segments | O(K) match | Complexity |
| Redis leaderboard | Fast | Volatile (backed by Cassandra) |
| Fan-out feed | Fast read | Storage cost |

---

## 13. Cheat-Sheet

1. **Upload → parse → process pipeline** (async).
2. **GPS points in S3** as compressed blobs.
3. **Postgres** for activity metadata + PostGIS for segments.
4. **Cassandra** for segment efforts.
5. **Redis** for leaderboards + feeds.
6. **Spatial pre-filter** (bounding box) before segment-match.
7. **Privacy zones** trim tracks.

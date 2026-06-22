# Spotify — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[audio-streaming]` `[cdn]` `[recommendations]` `[playlists]` `[kafka]` `[ml-pipeline]`
> **Prep time:** ~15 min skim, ~60 min deep read
> **Companies that ask this:** Spotify, Apple Music, YouTube Music, Tidal, Amazon Music, Meta (audio rooms), TikTok (sounds catalog)

---

## Beginner's Guide

### What's this in plain English?

Music streaming. You search a song; tap; it plays in seconds; you can build playlists; the app recommends new music. Audio is much smaller than video (~5 MB/song vs GBs), so the system is mostly: huge metadata search, a tight CDN, smart recommendations, and rock-solid royalty accounting.

Three things make this interesting at scale:
1. **The catalog is enormous** — 100 M+ tracks, but most plays concentrate on the top 1 % (long-tail problem flipped — it's actually a "head-heavy" distribution).
2. **The hot path is the redirect to a CDN edge**, not a database query — so we're really designing a *metadata lookup* + *CDN orchestration* system, not a streaming server.
3. **Every play is money.** Royalty calculation is non-negotiable; lose an event and an artist gets paid less. This drags an event-pipeline (Kafka) into the design even though the user-facing flow is "GET song bytes."

### Why solve it?

- **Real world:** Spotify, Apple Music, YouTube Music, Tidal, Amazon Music.
- **Teaches:**
  - Audio streaming end-to-end (lighter cousin of YouTube).
  - Search at scale with relevance ranking.
  - Recommendation pipelines (offline batch ML + online serving).
  - Event-driven architecture for analytics & royalty.
  - Multi-region CDN strategy.
  - Playlists as graph data + sharing semantics.
- **Differentiator vs YouTube:** smaller files → much higher cache hit rates, much aggressive client-side caching, no per-creator upload (label-supplied catalog).

### Vocabulary

- **Track / Song / Album / Artist** — the core taxonomy. One artist → many albums → many tracks. Songs and tracks are interchangeable in this doc.
- **ISRC** — International Standard Recording Code. Globally unique 12-char ID for a recording. We use it as a stable external key.
- **Playlist** — user-curated or system-curated ordered list of tracks.
- **CDN** — geographically distributed cache that serves byte ranges of audio files from the edge nearest to the user.
- **Bitrate** — bytes per second of audio. 96 kbps (free), 160 kbps (default premium), 320 kbps (premium high). At 160 kbps a 3-minute song is ~3.6 MB.
- **HLS / DASH** — adaptive bitrate streaming protocols. The audio file is sliced into ~10-second segments, each pre-encoded at multiple bitrates. The client picks a bitrate per segment based on bandwidth.
- **Recommendation** — a system-suggested next track, playlist, or radio station. Two flavors: collaborative filtering (users like you also liked X) and content-based (X sounds like Y).
- **Royalty event** — a durable record `(user_id, song_id, ts, completed)` produced every time a user listens past 30 s. Drives money paid to rights holders.
- **DRM** — Digital Rights Management. Encryption + license server preventing offline copies from being shared.

### High-level architecture (one-liner)

```
Search → Metadata service (Elasticsearch + Postgres)
            ↓
User picks a track → Stream service issues a signed CDN URL
            ↓
Client GETs audio segments from the nearest CDN edge
            ↓
Client emits "play" events → Kafka → Royalty + Recommendation pipelines
```

### How to read this doc

- **Beginner:** read sections 1–4 (problem, requirements, capacity, API). Skim deep dives.
- **Interview prep:** read all of it. Internalize sections 7 (Data Model), 9 (Component Deep-Dives), and 13 (Cross-Questions). Most points are won there.
- **30-min review:** read sections 0, 5, 7, 8, 13, 15.

---

## 0. How to use this doc in an interview

Spotify is **YouTube for audio plus a recommendations product**, with three killer differences:

1. **File size collapses to MB.** A 3-minute song at 160 kbps is ~3.6 MB. A 4K video minute is ~50 MB. Two orders of magnitude smaller. This means: we can cache a much larger fraction of the catalog at edges, the client can pre-fetch entire songs, and origin egress is dominated by the long-tail (cold) catalog, not the head.
2. **Caching is aggressive and multi-tier.** CDN edge → ISP cache → client local store → in-memory ring buffer. ~99 % of bytes never touch S3.
3. **Royalties drive accuracy.** Every "play counted as a play" rule (≥ 30 s, no skip) is a business rule that has to survive packet loss, app crash, offline mode, and replay attacks.

The trap junior candidates fall into: they describe "search → DB → CDN" and stop. The depth lives in:
- Adaptive bitrate (how does the client decide?).
- The Kafka pipeline (why Kafka, not SQS, what's the partition key, how do we handle a broker outage?).
- Recommendation pre-computation vs online serving.
- Multi-region failover with a music license that varies by country.

Drive your time like this in a 45-minute interview:
- 5 min — restate, clarify, lock requirements.
- 5 min — capacity, NFRs.
- 5 min — API + data model.
- 10 min — high-level architecture and the read path (search → play).
- 15 min — deep dive into the area the interviewer pushes (usually recommendations OR the play event pipeline).
- 5 min — bottlenecks, multi-region, follow-ups.

---

## 1. Problem Statement

Design a music streaming service that lets users search a catalog of 100 M+ tracks, stream any track in under one second, build and share playlists, receive personalized recommendations, and (for paid users) download tracks for offline use. The service must accurately track every play for royalty payment to rights holders, operate globally with multi-region availability, and respect content licensing (which varies by country and changes over time).

The system is **read-heavy** (plays ≫ writes), **bandwidth-heavy** at the CDN tier (TB/s aggregate egress), **latency-sensitive** on stream startup (a slow start is the #1 churn driver), and **must not lose play events** (royalty correctness is a legal/commercial obligation, not just a nice-to-have).

---

## 2. Clarifying Questions to Ask the Interviewer

Always ask before diving in. Lock these down — they shape every box you draw.

### Scope
- [ ] Free tier with ads, paid tier without ads, or both?
- [ ] Offline downloads (paid feature) in scope?
- [ ] Podcasts and audiobooks in scope, or music only?
- [ ] Lyrics (synced or static)?
- [ ] Social features: friend activity, collaborative playlists, shared listening?
- [ ] Live audio (concerts, radio shows)?
- [ ] Are we designing the entire product, or only the playback / catalog plane?

### Scale
- [ ] How many MAU? (Real Spotify: ~700 M; pick 700 M for the math.)
- [ ] What's the geographic distribution? (Global, weighted heavily toward EU + NA.)
- [ ] How many plays/day per user on average? (~7 plays/day is a good number.)
- [ ] Catalog size? (100 M tracks ≈ 500 TB raw audio at 160 kbps; multiply for multiple bitrates.)
- [ ] Read:write ratio? (Plays ≫ playlist edits ≫ catalog updates.)

### Functional
- [ ] Custom playlist sharing (links, embeds)?
- [ ] Cross-device playback (transfer from phone → speaker)?
- [ ] Family / Duo / Student plans (account sharing)?
- [ ] Crossfade, gapless playback, normalization?
- [ ] Deep linking to a specific timestamp?

### Non-functional
- [ ] Stream startup latency target? (P99 < 1 s, P50 < 200 ms is realistic.)
- [ ] Search latency? (P99 < 200 ms.)
- [ ] Availability for playback? (99.99 % — playback failures are very visible.)
- [ ] Consistency: how soon after a playlist edit must collaborators see it? (Seconds is fine.)
- [ ] Royalty event durability: zero loss, or 99.999 %?

### Constraints
- [ ] DRM strict (Widevine/FairPlay) or relaxed?
- [ ] Region-specific licensing — must enforce country-level catalog filtering?
- [ ] Compliance: GDPR for EU users, CCPA for California, etc.?
- [ ] Existing tech stack? (Spotify is heavy on Google Cloud + Kafka + Cassandra; assume we're free to choose.)

> **Assumed answers for this doc:** 700 M MAU, free + paid, podcasts + lyrics in scope, offline downloads in scope, no live audio, P99 stream-startup < 1 s, P99 search < 200 ms, 99.99 % availability for playback, royalty-event loss ≤ 10⁻⁶, multi-region active-active.

---

## 3. Functional Requirements

### Must-have (P0)

1. **Stream a track.** User taps a song; audio starts playing in under a second.
2. **Playback control.** Play, pause, seek, skip forward/back, queue management.
3. **Catalog browse & search.** Search by song, artist, album, with relevance ranking and typo tolerance.
4. **Playlist CRUD.** Create, rename, reorder, delete; add/remove tracks.
5. **Recommendations.** "Discover Weekly" personalized playlist; "Daily Mix" per-genre; "More like this".
6. **Royalty event per play.** Every play that crosses the 30-s threshold is logged durably with `(user_id, song_id, ts, country, completed_pct)`.
7. **Authentication & session.** OAuth login; session token for the client.

### Should-have (P1)

8. **Offline downloads.** Paid users can download tracks; encrypted with a time-limited DRM license.
9. **Collaborative playlists.** Friends can add/remove tracks.
10. **Lyrics sync.** Time-coded lyrics displayed during playback.
11. **Podcast playback.** Same plumbing as music; different metadata schema.
12. **Cross-device transfer.** "Spotify Connect" — start on phone, transfer to speaker without interruption.

### Nice-to-have (P2 — out of scope for the base design)

13. **Spatial audio / Dolby Atmos.**
14. **Concert recommendations / event ticketing.**
15. **Social listening (group sessions).**
16. **AI-generated playlist covers.**
17. **Live audio rooms.**

> **Out of scope explicitly:** content uploading by users, video, payments/subscriptions plumbing, customer support tooling.

---

## 4. Non-Functional Requirements

| Dimension | Target | Justification |
|---|---|---|
| Availability — playback | 99.99 % | Playback failures are visible in real time; 99.99 % = ~52 min downtime/yr, acceptable for a consumer service. |
| Availability — write paths (playlist, plays log) | 99.95 % | Tolerable to be briefly unavailable; clients buffer and retry. |
| Stream startup latency | P50 < 200 ms, P99 < 1 s | Anything above 1 s feels broken. The first byte is what the user perceives. |
| Search latency | P99 < 200 ms | Users type, expect results in real time. |
| Throughput — CDN egress | ~5 TB/s peak global | Derived from capacity estimation below. |
| Throughput — play events | 60–100 k events/s peak | Royalty pipeline must absorb this without backpressure on the client. |
| Catalog size | ~500 TB raw, ~1.5 PB with multiple bitrates | 100 M tracks × 5 MB × ~3 bitrates. |
| Consistency — playlists | Read-your-writes within ~1 s | Editing a playlist and not seeing your change is jarring. |
| Consistency — recommendations | Eventual; refresh weekly | Discover Weekly is a snapshot. |
| Durability — royalty events | ≥ 99.9999 % (six nines) | Money. |
| Scalability | Horizontal to 10× MAU | Spotify has roughly doubled every 4 years. |
| Security | TLS in transit, AES-128 at rest for audio, Widevine/FairPlay DRM for offline | Industry standard for audio. |
| Compliance | GDPR (EU) — right to delete play history; CCPA (US-CA) similar | Regulatory. |

---

## 5. Capacity Estimation (Back-of-Envelope)

Doing the math out loud is half the interview. Don't skip.

### Users & Traffic

```
MAU                          = 700 M
DAU                          = ~250 M (35 % daily-active rate; reasonable for music)
Avg plays / DAU / day        = 30 (heavy listeners offset light)
Total plays / day            = 250 M × 30 = 7.5 B plays/day
Plays / sec (avg)            = 7.5 B / 86,400 ≈ 87 k plays/sec
Peak factor                  = 3× (evening US + EU overlap)
Peak plays / sec             ≈ 260 k
```

### Read vs Write QPS

```
Reads (play start, search, browse, playlist load, recs fetch):
  - play start                   = 87 k/s avg, 260 k/s peak
  - search                       = 20 k/s avg
  - playlist/recs/browse         = 100 k/s avg
  Total read QPS (peak)          ≈ 1 M QPS at the API layer

Writes:
  - play events emitted          = ~100 k/s peak
  - playlist edits               = ~5 k/s
  - account / settings           = ~1 k/s
  Total write QPS (peak)         ≈ 110 k/s
```

Read:write ratio is roughly 10:1 at the API layer, but at the *bandwidth* layer (audio bytes) reads dominate by 1000:1.

### Storage

```
Catalog audio:
  100 M tracks × 5 MB (avg @ 160 kbps)         = 500 TB raw
  × 3 bitrates (96 / 160 / 320)                = 1.5 PB
  + 50 % overhead (segments, manifests, metadata) = ~2.3 PB
  ÷ erasure-coded across 3 regions (1.4×)      = ~3.2 PB physical

Catalog metadata:
  100 M tracks × 2 KB JSON (artist, album, ISRC, duration, …) = 200 GB
  100 M album/artist relations × 200 B          = 20 GB

Plays log (Cassandra, retained 13 months for royalty windows):
  7.5 B plays/day × 200 B/event × 400 days     = 600 TB
  + RF=3 replication                           = 1.8 TB raw on disk per node × N nodes
  Compressed (LZ4) ~3×                         = ~600 TB on disk total

Playlists:
  500 M playlists × avg 80 tracks × 50 B per ref = 2 TB
  (small — playlists are puny vs everything else)

Search index (Elasticsearch):
  100 M docs × ~1 KB tokenized = 100 GB
  + replication factor 2                       = 200 GB
```

### Bandwidth (CDN egress — the big one)

```
Peak plays/s                = 260 k
Avg song size (160 kbps)    = 3.6 MB
Naive bandwidth peak        = 260 k × 3.6 MB / 180 s (avg play duration) = ~5.2 TB/s

But: most bytes come from cache (CDN edge + client local), not origin.
  CDN hit rate                                  ≈ 95 %
  ISP cache (Open Connect / GGC) hit            ≈ another 3 %
  Origin (S3) egress                             ≈ 2 % of bytes ≈ 100 GB/s peak

Cross-check: 5 TB/s × 0.02 = 100 GB/s. ✓
```

### Cache Sizing (CDN edge tier)

```
80/20 (actually closer to 99/1 for music — head is extreme):
  1 % of catalog = 1 M songs × 3.6 MB × 3 bitrates ≈ 11 TB
  Each PoP (point of presence) caches the regional hot set:
  ~10 TB SSD per PoP × 100 PoPs = 1 PB cache footprint

Origin: full 2.3 PB on S3.
```

### Compute

```
API tier (catalog/playlist/play-start):
  ~10 k QPS per server → 1 M QPS / 10 k = ~100 servers per region × 3 regions = ~300 servers
Stream-URL signing service:
  ~50 k QPS per server (CPU-bound on HMAC) → ~5–10 servers per region
Search:
  Elasticsearch cluster, ~30 nodes per region (sized for index + 20 k QPS query)
Cassandra (plays log):
  ~250 nodes globally for 600 TB compressed × RF=3 + headroom; sized for 100 k writes/s sustained, 10× peak burst
Kafka:
  Brokers: ~30 brokers per region for plays topic (replication factor 3, partitions ~ 256, retention 7 days)
```

### Sanity check

Spotify's real published CDN egress peaks around 4–6 TB/s globally; our estimate of 5.2 TB/s is in the right ballpark. ✓

---

## 6. API Design

We expose a public REST API for clients (web / mobile / partner integrations) and gRPC internally between services.

### Public REST endpoints

```
# Catalog & search
GET    /v1/search?q=<query>&type=track,artist,album&market=<country>&limit=20&cursor=<opaque>
       → 200 + { results: [...], next_cursor }
       Headers: Authorization: Bearer <jwt>; Accept-Language; X-Client-Version
       Errors: 401, 429

GET    /v1/tracks/{id}
       → 200 + { id, title, artist, album, duration_ms, isrc, available_markets, … }
       Errors: 404 (track not found OR not licensed in caller's market — same code; details in body)

GET    /v1/albums/{id}/tracks
GET    /v1/artists/{id}/top-tracks?market=<country>

# Stream
POST   /v1/stream/{track_id}/start
       Body: { device_id, bitrate_pref, position_ms? }
       → 200 + { manifest_url (signed, 5-min TTL), session_token, recommended_bitrate }
       Errors: 403 (not licensed in market), 404, 429

GET    <manifest_url>   # CDN-signed; client fetches HLS-style manifest then segments

# Play events (sent in batches every 30 s while playing, plus on stop/pause)
POST   /v1/plays/batch
       Headers: Idempotency-Key: <uuid-per-batch>
       Body: { events: [{ session_token, track_id, position_ms, ts, completed_pct, … }] }
       → 202 Accepted (the body is enqueued, not synchronously written)
       Errors: 400, 401

# Playlists
POST   /v1/playlists                         { name, public }     → 201 + {id, …}
GET    /v1/playlists/{id}                                         → 200 + {…}  (ETag)
PUT    /v1/playlists/{id}                    { name, public }     → 200
DELETE /v1/playlists/{id}                                         → 204
POST   /v1/playlists/{id}/tracks             { track_id, position?} → 201
DELETE /v1/playlists/{id}/tracks/{track_id}                       → 204
POST   /v1/playlists/{id}/reorder            { from, to }         → 200

# Recommendations
GET    /v1/me/recommendations/discover-weekly      → 200 + { tracks: […], generated_at }
GET    /v1/me/recommendations/daily-mix?genre=…    → 200 + { … }

# User
GET    /v1/me                                                     → 200 + profile
GET    /v1/me/library                                              → 200 + saved tracks/albums

# Devices (Spotify Connect)
GET    /v1/me/devices                                             → 200 + [device,…]
PUT    /v1/me/player/transfer                 { device_id }       → 204
```

**Why REST and not GraphQL or gRPC for the client?** Three reasons. (1) CDN cacheability — REST GETs with stable URLs and ETags can cache at CloudFront. (2) Simplicity for partner integrations (Sonos, Alexa, car infotainment). (3) Mobile clients work fine with REST and don't need GraphQL's flexibility. Internally between services we use gRPC for tighter contracts and lower per-call overhead.

**Idempotency.** Critical for `POST /v1/plays/batch`. Clients in flaky networks retry; without idempotency we'd double-count plays and overpay artists. We require an `Idempotency-Key` header (UUID per batch) and store `(key, response)` for 24 h in Redis. A retry within 24 h returns the cached response without re-applying.

**Pagination.** Cursor-based. Offsets break under inserts and don't scale at billions of rows.

**Versioning.** URL versioning (`/v1/`). Easier for partners to debug than headers; trivial to route at the edge.

**Auth.** OAuth 2 with JWT access tokens (15-min TTL) + refresh tokens. Client carries `Authorization: Bearer …`. We sign manifest URLs separately with a 5-minute HMAC so leaked stream URLs expire fast.

**Errors.** Standard HTTP codes; body always JSON `{ error_code, message, request_id }`. Distinct codes for "track not found" vs "track not licensed in your market" so the UI can show the right message — we surface that in the *body* not the status (always 404 to avoid leaking which tracks exist where).

---

## 7. Data Model

### 7.1 Choice: SQL vs NoSQL — a per-store decision

Spotify is not "one database." Different access patterns get different stores. Here's the breakdown and *why* for each.

| Store | What it holds | Why this store |
|---|---|---|
| **Postgres (sharded by `track_id`)** | Track / album / artist canonical metadata | Relational joins (track → album → artist), strong consistency on label updates, low write rate (~hundreds/min), high read rate served from cache. |
| **Cassandra** | Plays log (append-only); user library; playlist track lists | Massive write volume (100 k/s), time-series-like access, predictable partition keys, cross-region active-active. JOINs not needed. |
| **Elasticsearch** | Search index over tracks/artists/albums | Text search, fuzzy match, relevance ranking, aggregations for "top hits". Postgres can't do this at 20 k QPS. |
| **Redis** | Hot caches: track metadata, signed-URL session map, idempotency keys, per-user recommendations | Sub-ms reads, TTL-based eviction, simple key/value. |
| **S3 / GCS** | Audio segment files, manifests, encoded artwork | Object storage is the only sane place for petabytes of immutable blobs. |
| **BigQuery / Snowflake (OLAP)** | Plays log mirror for analytics, royalty calculation, dashboards | Columnar, batch query — wrong shape for the OLTP plays log; right shape for "sum plays per artist last quarter". |

The interviewer will push: *"Why not put plays in Postgres?"* — Postgres tops out around 50 k writes/s on commodity hardware before you have to shard, and even sharded the write amplification of indexes hurts at 100 k/s. Plays have no JOINs, no transactional updates, append-only — Cassandra is the textbook fit.

### 7.2 Tables / Collections

#### 7.2.1 `tracks` (Postgres, sharded by `track_id`)

| Column | Type | Index | Notes |
|---|---|---|---|
| `track_id` | UUID v7 | PK | v7 = time-ordered → avoids hot tail on inserts. |
| `isrc` | CHAR(12) | UNIQUE | Industry-standard recording ID; used for cross-system reconciliation. |
| `title` | VARCHAR(500) |  |  |
| `album_id` | UUID | INDEX | FK to albums. |
| `primary_artist_id` | UUID | INDEX | FK to artists; denormalized for fast read. |
| `duration_ms` | INTEGER |  |  |
| `explicit` | BOOLEAN |  |  |
| `audio_urls` | JSONB |  | `{ "96": ".../track_id.96.m3u8", "160": "...", "320": "..." }` |
| `available_markets` | TEXT[] | GIN | ISO country codes; e.g. `{US, GB, FR}`. Filter on `?` operator. |
| `release_date` | DATE | INDEX |  |
| `popularity` | SMALLINT | INDEX | 0–100, recomputed daily by a batch job. Used in search ranking. |
| `created_at` | TIMESTAMPTZ |  |  |
| `updated_at` | TIMESTAMPTZ |  |  |

**Indexes — why these:**
- `(album_id)` for `GET /albums/{id}/tracks`.
- `(primary_artist_id, popularity DESC)` covers `GET /artists/{id}/top-tracks` without a secondary lookup.
- `GIN(available_markets)` lets us filter `WHERE 'US' = ANY(available_markets)` in milliseconds.
- No index on `title` because search lives in Elasticsearch — putting a trigram index here too would double maintenance for no benefit.

**Sharding key:** `track_id`. Why: (a) reads are `track_id`-keyed, (b) `track_id` is uniformly distributed (UUID v7's high bits are time, low bits random), (c) cross-track joins are rare in the hot path (album/artist lookup is by ID, served from a different shard via the FK).

**Sharding strategy:** Consistent hashing with virtual nodes (256 vnodes per physical shard). On adding a shard, only `1/N` of data rebalances. We start with 16 physical shards.

**Capacity:** 100 M rows × ~2 KB row size = 200 GB across 16 shards = 12.5 GB/shard. Easily fits on one Postgres node with room for 10× growth.

#### 7.2.2 `albums` (Postgres, sharded by `album_id`)

| Column | Type | Index | Notes |
|---|---|---|---|
| `album_id` | UUID v7 | PK |  |
| `title` | VARCHAR(500) |  |  |
| `primary_artist_id` | UUID | INDEX |  |
| `release_date` | DATE | INDEX |  |
| `cover_art_url` | TEXT |  | CDN-served. |
| `track_count` | INTEGER |  | Denormalized; recomputed on write. |
| `available_markets` | TEXT[] | GIN |  |

~10 M rows × ~500 B = 5 GB. Trivial.

#### 7.2.3 `artists` (Postgres, sharded by `artist_id`)

| Column | Type | Index | Notes |
|---|---|---|---|
| `artist_id` | UUID v7 | PK |  |
| `name` | VARCHAR(500) |  |  |
| `bio` | TEXT |  |  |
| `genres` | TEXT[] | GIN |  |
| `image_url` | TEXT |  |  |
| `monthly_listeners` | BIGINT | INDEX | Denormalized; recomputed daily. |

~5 M rows × ~1 KB = 5 GB.

#### 7.2.4 `users` (Postgres, sharded by `user_id`)

| Column | Type | Index | Notes |
|---|---|---|---|
| `user_id` | UUID v7 | PK |  |
| `email` | CITEXT | UNIQUE |  |
| `country` | CHAR(2) | INDEX | Drives catalog filtering. |
| `tier` | ENUM | INDEX | `free`, `premium`, `family`, `student`. |
| `subscription_renews_at` | TIMESTAMPTZ |  |  |
| `created_at` | TIMESTAMPTZ |  |  |

700 M rows × ~500 B = 350 GB across 32 shards.

#### 7.2.5 `playlists` (Cassandra)

```
CREATE TABLE playlists (
    playlist_id   uuid,
    owner_id      uuid,
    name          text,
    description   text,
    public        boolean,
    collaborative boolean,
    created_at    timestamp,
    updated_at    timestamp,
    PRIMARY KEY (playlist_id)
);
```

```
CREATE TABLE playlist_tracks (
    playlist_id   uuid,
    position      int,                  -- clustering key
    track_id      uuid,
    added_by      uuid,
    added_at      timestamp,
    PRIMARY KEY ((playlist_id), position)
) WITH CLUSTERING ORDER BY (position ASC);
```

```
CREATE TABLE user_playlists (
    user_id       uuid,
    playlist_id   uuid,
    saved_at      timestamp,
    PRIMARY KEY ((user_id), saved_at, playlist_id)
) WITH CLUSTERING ORDER BY (saved_at DESC);
```

**Why Cassandra and not Postgres?**
- 500 M playlists × ~80 tracks = 40 B rows in `playlist_tracks` — manageable in Postgres but Cassandra's wide-row model is a perfect fit (one playlist = one partition, all tracks in clustering order).
- Read-your-writes within ~1 s is acceptable; Cassandra LOCAL_QUORUM gives that.
- Active-active multi-region writes — Cassandra handles, Postgres needs heroics.

**Partition key:** `playlist_id` for the tracks table; `user_id` for `user_playlists`. Why: a playlist render = one partition fetch ≈ one disk seek per replica.

**Hot partition risk:** the "Spotify-curated mega-playlist" with 50 M followers and 200 tracks. Partition is bounded by track count not follower count — bounded width is fine. Reads of the playlist get hot, but those are cache-served, not hitting Cassandra.

**Capacity:** 500 M playlists × ~80 tracks × ~50 B = 2 TB pre-replication, 6 TB with RF=3. Fits in a small Cassandra cluster.

#### 7.2.6 `plays` (Cassandra — the big one)

```
CREATE TABLE plays (
    user_id       uuid,
    bucket        int,                  -- = floor(epoch_day / 7); 1 partition per user per week
    ts            timeuuid,
    track_id      uuid,
    country       text,
    completed_pct smallint,
    device_id     uuid,
    session_id    uuid,
    PRIMARY KEY ((user_id, bucket), ts)
) WITH CLUSTERING ORDER BY (ts DESC)
  AND default_time_to_live = 34_560_000;   -- 400 days for royalty windows
```

**Partition key choice:** `(user_id, bucket)` — composite. Why a `bucket`? Without it, a heavy listener's partition would grow unbounded (bad — Cassandra recommends partitions < 100 MB). With weekly bucketing, even a 100-plays-per-day user generates only ~700 rows per partition ≈ ~150 KB.

**Why `user_id` first, not `track_id`?** Two access patterns: "what did this user listen to?" (recs, dashboards) and "how many plays did this track get?" (royalty, popularity). The first is per-user (row count low, partition tight), the second is aggregated offline anyway. Partitioning by `user_id` serves the hot path; the royalty pipeline reads via Kafka (not Cassandra) and aggregates in Spark.

**Capacity:**
- 7.5 B plays/day × 200 B/row = 1.5 TB/day raw.
- 400-day TTL → 600 TB at peak retention.
- × RF=3 = 1.8 PB on disk pre-compression.
- LZ4 ~3× → ~600 TB physical.
- Spread over ~250 nodes × 2.5 TB SSD each.

**Why TTL of 400 days?** Royalty cycles are quarterly with audit windows; 13 months covers everything plus a buffer. After that, aggregated data lives in BigQuery; raw rows are no longer needed.

**Indexes/secondary:** none. Don't use Cassandra secondary indexes. Any cross-axis access (e.g. "all plays of this track") goes through the Kafka → BigQuery path, not Cassandra.

#### 7.2.7 `recommendations_user` (Redis, per-user)

```
KEY    rec:dw:{user_id}            (Discover Weekly, regenerated Monday)
VALUE  JSON: { generated_at, tracks: [track_id…] }
TTL    14 days

KEY    rec:dm:{user_id}:{genre}    (Daily Mix per genre)
VALUE  JSON
TTL    7 days
```

Redis chosen because reads are sub-millisecond, the hot path is `GET /v1/me/recommendations/discover-weekly`, and the data is regenerated wholesale weekly (no need for transactionality or rich queries). Total size: 700 M users × ~5 KB = 3.5 TB across a Redis cluster of ~40 nodes.

#### 7.2.8 Search index (Elasticsearch)

One index per type (`tracks`, `artists`, `albums`). Mappings:

```json
{
  "track_id":   { "type": "keyword" },
  "title":      { "type": "text", "analyzer": "spotify_text",
                   "fields": { "raw": { "type": "keyword" } } },
  "title_ngram":{ "type": "text", "analyzer": "edge_ngram_2_15" },
  "artist":     { "type": "text", "analyzer": "spotify_text" },
  "album":      { "type": "text", "analyzer": "spotify_text" },
  "available_markets": { "type": "keyword" },
  "popularity": { "type": "rank_feature", "positive_score_impact": true },
  "isrc":       { "type": "keyword" }
}
```

**Custom analyzer `spotify_text`:** lowercase + ASCII-folding (so "Beyoncé" matches "beyonce") + a synonym dict (e.g. "Bieber" ↔ "Justin Bieber" misspellings).

**`title_ngram`** powers as-you-type autocomplete with 2–15-char edge n-grams. Heavier index, but autocomplete is the highest-traffic search query.

**Capacity:** 100 M tracks × ~1 KB tokenized = 100 GB; with a `_replica` and the n-gram index ~300 GB. Cluster: 30 nodes per region, 6 shards × 1 replica per index.

### 7.3 Access patterns → store mapping

| Access pattern | Path | Latency target |
|---|---|---|
| `GET /tracks/{id}` | Redis cache → Postgres `tracks` shard (cache miss) | < 20 ms p99 |
| Search `GET /search?q=…` | Elasticsearch | < 200 ms p99 |
| `POST /stream/{id}/start` | Redis (license check) → sign URL → return | < 50 ms p99 |
| Playback (audio bytes) | CDN edge → ISP cache → S3 origin | First byte < 200 ms |
| Playlist render | Cassandra `playlist_tracks` (one partition) → batch fetch tracks from Redis/Postgres | < 100 ms p99 |
| `POST /plays/batch` | Append to Kafka topic, return 202 | < 50 ms p99 |
| Discover Weekly | Redis `rec:dw:{user_id}` | < 10 ms p99 |

---

## 8. High-Level Architecture

```
                                    Clients (web, mobile, car, smart speakers)
                                                │
                                                │ HTTPS
                                                ▼
                                       ┌──────────────────┐
                                       │      CDN         │  (CloudFront / Fastly / Open Connect)
                                       │   audio + static │
                                       └─────────┬────────┘
                                                 │
                                                 ▼
                                       ┌──────────────────┐
                                       │  L7 Load Balancer│  (TLS termination, geo-routing)
                                       └─────────┬────────┘
                                                 │
                  ┌──────────────────────────────┼──────────────────────────────┐
                  ▼                              ▼                              ▼
         ┌────────────────┐           ┌────────────────────┐         ┌────────────────────┐
         │ Catalog API    │           │ Stream-URL Service │         │  Search Service    │
         │ (track/alb/art)│           │  (signs CDN URLs)  │         │ (ES proxy, ranking)│
         └───────┬────────┘           └─────────┬──────────┘         └─────────┬──────────┘
                 │                              │                              │
        ┌────────┼─────────┐                    │                              ▼
        ▼        ▼         ▼                    │                       ┌────────────┐
   ┌────────┐ ┌──────┐ ┌────────┐                │                       │ Elasticsrch│
   │ Redis  │ │ PG   │ │ PG     │                │                       └────────────┘
   │ (cache)│ │tracks│ │albums  │                │
   └────────┘ └──────┘ └────────┘                ▼
                                       ┌──────────────────┐
                                       │ License / DRM    │
                                       │ (regional checks)│
                                       └──────────────────┘

                  ┌──────────────────┐                            ┌──────────────────┐
                  │ Playlist Service │                            │ Plays Ingest API │
                  └────────┬─────────┘                            └─────────┬────────┘
                           ▼                                                ▼
                    ┌──────────────┐                                   ┌────────┐
                    │  Cassandra   │                                   │ Kafka  │
                    │  playlists   │                                   │ "plays"│
                    └──────────────┘                                   └────┬───┘
                                                                             │
                              ┌─────────────────┬──────────────────┬─────────┴─────┐
                              ▼                 ▼                  ▼               ▼
                       ┌─────────────┐  ┌─────────────┐  ┌────────────────┐  ┌──────────────┐
                       │ Plays Sink  │  │ Royalty     │  │ Recs Pipeline  │  │ Real-time    │
                       │ → Cassandra │  │ Aggregator  │  │ (Spark / Beam) │  │ Charts / Buzz│
                       └──────┬──────┘  └──────┬──────┘  └────────┬───────┘  └──────┬───────┘
                              ▼                ▼                   ▼                 ▼
                       ┌──────────┐    ┌────────────┐    ┌────────────────┐    ┌────────┐
                       │Cassandra │    │ BigQuery   │    │ Redis (recs)   │    │ Redis  │
                       │  plays   │    │ (analytics)│    │ + Vector DB    │    │ topN   │
                       └──────────┘    └────────────┘    └────────────────┘    └────────┘
```

**The hot read path (play start):**
1. Client `POST /v1/stream/{track_id}/start`.
2. Stream-URL service checks user country + track `available_markets` (Redis lookup, ~1 ms; Postgres fallback).
3. Builds an HLS manifest URL signed with HMAC + 5-minute TTL; returns to client.
4. Client GETs the manifest from CDN (cache hit ~99 %), then fetches segments. CDN serves from edge cache; misses pull from S3 origin via shielded "mid-tier" caches that protect S3.
5. While playing, client POSTs play events to the Plays Ingest API in batches (every 30 s, on pause, on stop). Ingest writes to Kafka and returns 202 immediately.

**The pipelines off Kafka:**
- **Plays sink** → fans events into Cassandra (the OLTP plays log).
- **Royalty aggregator** → tumbling 1-h windows; sums plays per `(track_id, country, tier)`; writes to BigQuery for monthly artist payment.
- **Recs pipeline** → batch Spark jobs (weekly) train collaborative filtering models; output goes to Redis as per-user recommendations and to a vector DB for nearest-neighbor lookups.
- **Real-time charts** → tumbling 1-min windows in Flink → "Today's Top 50" updated near-real-time in Redis.

---

## 9. Component Deep-Dives

### 9.1 Audio Storage & CDN (the bandwidth machine)

**Responsibility.** Store the entire 100 M-track catalog, multiple bitrates each, segmented for HLS-style delivery, and serve hundreds of millions of plays/day at CDN edges with sub-second startup latency.

**Encoding pipeline.** When a label uploads a master file, an offline pipeline:
1. Decodes the master.
2. Re-encodes at 96 kbps (HE-AACv2), 160 kbps (Vorbis or AAC), 320 kbps (Vorbis premium).
3. Slices each bitrate into ~10-second segments and writes a per-bitrate `.m3u8` manifest.
4. Uploads everything to S3 with a deterministic key path: `s3://spotify-audio/{track_id_high2}/{track_id}/{bitrate}/{seg_n}.aac`.
5. Pre-warms the CDN for "expected hit" tracks (new releases from major labels, anything on the Today's Top 50 trajectory).

**CDN choice.** A multi-tier setup:
- **Edge caches** (CloudFront / Fastly / Spotify's own Open-Connect-style boxes inside ISPs) — closest to user, ~100 PoPs globally, ~10 TB SSD each.
- **Mid-tier "shield" caches** — protect origin from edge cache misses. One per region.
- **Origin** — S3 (or GCS) with Cross-Region Replication for DR.

**Why this tiering and not just "S3 + CloudFront"?** With a 95 % edge hit rate, that still leaves 5 % × 5 TB/s = 250 GB/s flowing toward origin. S3 caps egress per bucket and charges per GB; a shield tier (one cache per region with a 99 % hit rate) reduces origin traffic to ~2 GB/s per region and saves millions/year in egress.

**Scaling.** CDN scales horizontally; we add PoPs in regions with high RTT. Origin scales with S3, which is effectively unbounded.

**Failure mode.** Edge dies → request falls through to mid-tier (transparent). Mid-tier dies → falls through to origin (slower but works). Origin region dies → CDN edges have multi-origin failover to the DR region; cache contents continue serving for hours from existing entries even if no new misses can resolve.

**Capacity.** Sized in §5 above.

### 9.2 Stream-URL service (the gatekeeper)

**Responsibility.** When the client wants to play a track, this service:
1. Authenticates the user (JWT validation via local cache + JWKS).
2. Verifies the track is licensed in the user's country.
3. Verifies the user's tier (free vs premium → bitrate cap, ad insertion).
4. Mints a signed CDN URL for the appropriate manifest, with a 5-minute TTL.
5. Records `(session_token, track_id, user_id)` in Redis with 1-h TTL — used later to validate the play-event stream.

**Why a separate service?** Two reasons. (a) The signing key must be tightly held; only this service has it. (b) The license-check logic is gnarly (markets change daily, takedowns happen at minute granularity); isolating it lets us iterate without touching the catalog API.

**Tech.** Go service, ~5 instances per region. CPU-bound on HMAC. Sized for 50 k QPS per instance.

**Failure mode.** If the license cache (Redis) is unavailable, fall back to Postgres directly (~10× slower but correct). If the signing key is revoked, the service hard-fails — better to 503 than to serve unlicensed content.

### 9.3 Catalog API (track/album/artist metadata)

**Responsibility.** Serves canonical metadata (title, artist, duration, cover art URL, etc.) for any catalog object.

**Tech choice.** Stateless Go services backed by Postgres + Redis. Read-through cache: try Redis first, miss → Postgres → backfill Redis with 1-h TTL.

**Why Postgres for metadata?** Relational joins (track → album → artist), strong consistency for label-driven updates (a track gets pulled in the EU at 3 pm — must propagate fast), and write rate is low (hundreds/min). Postgres + Redis cache covers it for 100s of millions of reads/sec because cache hit rate is > 99 %.

**Cache invalidation.** When a track/album/artist row is updated (label-driven via an internal admin tool), the writer publishes a Kafka invalidation message. Catalog API instances subscribe and DEL the Redis key. ~1 s convergence — acceptable for label updates.

**Failure mode.** If Postgres primary fails: read replicas serve reads with up to 1-s lag (acceptable). Writes block until failover (~30 s automated).

### 9.4 Playlist Service

**Responsibility.** Playlist CRUD, track management, sharing, collaborative editing.

**Tech.** Go service backed by Cassandra. Playlist read = one partition fetch (`playlist_tracks` partitioned by `playlist_id`).

**Concurrency on collaborative playlists.** Multiple users adding tracks at once — what happens if two users insert at position 5 simultaneously? We use a *fractional position* trick: positions are doubles (0.0, 1.0, 2.0, …). Inserting between 1 and 2 yields 1.5; further inserts yield 1.25 or 1.75. Periodically a background job re-normalizes positions to integers to prevent precision drift. This avoids the shift-everyone-down-one-row problem of integer positions under concurrent writes.

**Spotify-curated mega-playlists** (e.g. "Today's Top Hits", 50 M followers): heavy reads. The playlist row itself is identical for every reader, so it's served from a CDN edge cache on the JSON response (10-min TTL). 50 M requests/min collapse to ~1 origin hit per PoP per 10 minutes.

**Failure mode.** Cassandra LOCAL_QUORUM on writes; if the local DC loses 2 of 3 replicas, writes 503 until repair. Reads can fall back to ONE level for availability at the cost of read-your-writes.

### 9.5 Search Service

**Responsibility.** Power autocomplete + full search across tracks/artists/albums/podcasts/playlists with relevance ranking.

**Tech.** Elasticsearch. ~30 nodes per region. Cluster handles 20 k QPS at < 200 ms p99.

**Index updates.** When a track is created/updated in Postgres, a Kafka CDC event triggers an upsert in ES via a dedicated indexer. Lag: < 5 s end-to-end. For deletes (license removal in market X), we don't delete the doc — we re-index with updated `available_markets` and filter at query time.

**Ranking.** Standard BM25 plus a `popularity` rank-feature plus user-personalization signals injected at query time (recent plays, saved artists). For autocomplete, we run a separate edge-n-gram analyzer for sub-50 ms response.

**Why not Postgres full-text search?** PG FTS handles ~100 GB and a few thousand QPS; we have 100 GB and 20 k QPS, with relevance tuning needs (synonyms, fuzzy match, n-grams) that PG can't match without heroic effort. ES is the standard tool.

**Failure mode.** ES cluster degrades gracefully — if a shard dies, queries route to the replica. If the whole cluster falls over, search returns 503 and the client falls back to a "browse by genre" view.

### 9.6 Plays Ingest API + Kafka pipeline (the pipeline)

This is *the* deep dive. An interviewer who asks "tell me about how plays flow through your system" wants to see a candidate who can ride this all the way from client to royalty payment. Spend time here.

**Responsibility.** Ingest play events from clients, durably enqueue them, and route them to multiple downstream consumers (Cassandra OLTP store, royalty aggregator, recs trainer, real-time charts) — all without losing events.

**Why Kafka and not SQS / Kinesis / RabbitMQ / a database write?**

- **vs SQS.** SQS is a queue; Kafka is a log. Multiple consumers can read the same message independently from Kafka (each consumer group has its own offset). With SQS, fan-out requires SNS+SQS-per-consumer, which costs 4× and gives weaker ordering guarantees. We have ≥ 4 consumers (sink, royalty, recs, charts) — Kafka wins.
- **vs Kinesis.** Functionally similar. Kafka gives us more control over partition count, retention, and schema (with Schema Registry), and we run our own brokers anyway because Spotify's volume justifies it.
- **vs RabbitMQ.** RabbitMQ tops out around 50 k msgs/s per node. We need 100 k+ sustained, 3× peak. Kafka does millions/s per broker.
- **vs writing directly to Cassandra.** That works but couples ingest to one consumer. The moment you want a second consumer (royalty aggregator), you have to dual-write or read Cassandra's commit log — both fragile. A log-based architecture decouples producers from consumers.

**Topic layout.**

```
Topic: plays
  Partitions: 256
  Replication factor: 3
  Retention: 7 days (long enough to reprocess if a downstream breaks)
  Compression: lz4
  Schema: Avro, registered in Schema Registry; backwards compatible
```

**Partition key choice.** `user_id`. Why this, not `track_id` or random?
- **Ordering within a session.** Royalty needs to know if a user listened past 30 s — that requires seeing per-user events in order. Partitioning by `user_id` puts all of one user's events in one partition, preserving order within the partition.
- **Trade-off:** `track_id` partitioning would balance load by track popularity (hot tracks would dominate one partition — bad). `user_id` distributes uniformly across 700 M users. ✓
- **Hot user issue?** A single user can't generate enough events to overload one partition (they're one human). The edge case — a bot impersonating a user — is handled at the API tier with rate limits.

**Producer configuration on the API side.**
- `acks=all` (wait for all in-sync replicas) — durability over latency. We can take the ~10 ms penalty.
- `enable.idempotence=true` — no duplicates from producer-side retries.
- Batched (linger.ms=10, batch.size=1 MB) — amortizes the per-request cost.
- Each event carries a `(client_event_id, user_id)` tuple. Downstream uses this to dedupe even if a client retries the whole batch.

**Consumer side.**
- Each consumer is a dedicated consumer group (separate offsets, separate failure domain).
- Plays sink uses `auto.offset.reset=earliest` and writes to Cassandra with `(client_event_id)` as a uniqueness check at the application level (Cassandra LWT — `IF NOT EXISTS` — for the first write of each event_id).
- Royalty aggregator runs as a Flink job: per-user windows, output every 5 min to BigQuery.
- Recs trainer runs as a Spark job: weekly, reads the entire week's offsets, outputs a model.
- Charts service runs as a Flink job with 1-minute tumbling windows, output → Redis.

**What if a consumer falls behind?** Kafka has 7-day retention; consumers can recover by reading from their last committed offset. Alarming kicks in if any consumer's lag exceeds 30 minutes — pages on-call.

**What if a Kafka broker dies?** Replication factor 3 across racks. The producer continues writing to the remaining replicas. The dead broker's partition leadership migrates within seconds. No event loss; brief latency spike.

**What if the entire plays Kafka cluster falls over?** API tier has a local-disk WAL (write-ahead-log) buffer per node; if Kafka is unreachable, events spill to disk for up to 1 h, then drain to Kafka on recovery. Beyond 1 h we drop events with a critical alarm — the alternative is unbounded buffering and node OOM.

**Capacity.**
- 100 k events/s × 200 B = 20 MB/s ingest.
- × 7 days retention = ~12 TB.
- × RF=3 = 36 TB on disk across the cluster.
- ~30 brokers per region (sized for 1 GB/s peak network in/out).

### 9.7 Royalty pipeline

**Responsibility.** Compute royalties owed per artist per month with auditability.

**Pipeline.**
1. Flink job consumes `plays` topic; emits `(track_id, country, tier, hour_bucket, count)` aggregates every 5 min into a `plays_aggregated` Kafka topic.
2. A second job sinks `plays_aggregated` into BigQuery (`plays_hourly`).
3. A monthly batch job in BigQuery joins `plays_hourly` with rights tables (which artists/labels/songwriters are entitled to which fraction of which track in which country at which time) and produces a payout report.
4. Finance team approves; payments go out.

**Why two stages (5-min aggregate, then monthly batch)?** The 5-min aggregate is small enough to fit in BigQuery without exploding storage (vs raw plays at 1.5 TB/day). The monthly join is heavy and runs on a known cadence.

**Auditability.** Raw plays in Cassandra are kept 400 days and can be replayed against the rights tables if a label disputes a payout. This is non-negotiable per recording contracts.

**Failure mode.** If Flink job dies mid-window, on restart it reads from last checkpoint (every 1 min) and re-emits. Idempotent because aggregates use upsert by `(track_id, country, tier, hour_bucket)`.

### 9.8 Recommendation pipeline

**Responsibility.** Generate Discover Weekly (per user, weekly), Daily Mix (per user × genre), and "More like this" (per track, online).

**Three-track approach.**

1. **Collaborative filtering (offline).** Spark job weekly:
   - Reads 90 days of plays.
   - Builds a user-track interaction matrix.
   - Factorizes it (ALS — Alternating Least Squares) into user-vector and track-vector embeddings of dimension ~64.
   - Persists embeddings to a vector DB (Milvus / Vespa).
   - For each user, k-NN over track-vectors → top 30 candidates.
2. **Content-based (offline + online).** A separate model encodes audio features (tempo, key, MFCC) into a track-vector. Useful for cold-start tracks (new releases with no plays yet). Also persisted to the vector DB.
3. **Online ranker.** When the user opens "Discover Weekly", a small model re-ranks the 30 candidates using features available at request time (recent plays, time of day, device). Adds personalization that batch can't do.

**Why offline batch and not pure online?** Training ALS on 90 days × 7 B plays is a multi-hour Spark job. Doing it online is impossible. The offline-batch + online-rerank pattern is the textbook approach for personalization at this scale.

**Cold start.** New users have no plays. Fall back to country-level top tracks + onboarding prompts ("pick 3 artists you like"). New tracks have no plays — content-based model places them near acoustically similar known tracks.

**Failure mode.** If Spark job fails one week, last week's recommendations stay in Redis (TTL 14 days, beyond the weekly cadence). Users see slightly stale recs; we page on-call to fix the job.

### 9.9 Offline downloads + DRM

**Responsibility.** Let paid users download tracks to their device for offline playback.

**Flow.**
1. Client requests `/v1/tracks/{id}/download` → server checks tier, mints a Widevine license bound to (`user_id`, `device_id`, `track_id`, `expiry`).
2. Client downloads encrypted segments from CDN (same files, encrypted with a content key).
3. Client stores both the encrypted segments and the license locally.
4. On offline playback, the local Widevine module decrypts using the stored license.
5. License expires after 30 days unless the client checks in (prevents permanent offline use after subscription cancel).

**Why DRM?** Without it, anyone could rip MP3s and share. Labels mandate DRM; no DRM = no catalog license.

**Multi-device limit.** Widevine licenses are tied to device IDs; we cap concurrent active licenses per user (5 devices for individual, 6 for family). A 6th device prompts the user to deactivate one.

---

## 10. Deep-Dives on the Hardest Sub-Problems

### 10.1 Adaptive Bitrate Streaming (how the client chooses what to download)

**Approach options.**

| Approach | How | Pros | Cons | When to use |
|---|---|---|---|---|
| Single-bitrate | One file per track | Simple | Bad UX on flaky networks | Internal/test |
| Manual user choice | User picks 96/160/320 in settings | Predictable | Most users won't tune; suboptimal | Power-user fallback |
| Server-driven adaptation | Client reports bandwidth; server picks | Centralized policy | Round-trip overhead | High-control environments |
| **Client-driven adaptation (HLS/DASH)** | Client downloads manifest with all bitrates; per-segment chooses based on local bandwidth measurement | No round-trips, fast adaptation | Client logic is complex | Default for streaming |

**Chosen approach.** Client-driven HLS-like adaptive streaming.

**Mechanics.**
1. Server returns a manifest listing 3 bitrates (96/160/320), each with segment URLs (~10-second segments).
2. Client downloads the first segment at the median bitrate (160).
3. Client measures: time-to-download / segment-bytes = available bandwidth.
4. Each segment, client picks the highest bitrate where `bitrate × buffer_target_seconds ≤ recent_bandwidth × safety_factor`.
5. If buffer drops below 5 seconds, client downgrades aggressively. If buffer holds above 30 seconds, client probes upward.

**Edge cases.**
- **Sudden bandwidth drop:** buffer drains, client downgrades next segment. Worst case: a glitch → 1 second gap. Better than rebuffering for 5 s at the original bitrate.
- **WiFi → cellular handoff:** measured bandwidth recalibrates. Within 1–2 segments, client adjusts.
- **Free tier:** server returns a manifest with only 96 kbps. Client has no choice.

### 10.2 Discover Weekly: how is it actually computed?

**Why this is hard.** 700 M users × 100 M tracks. A naive matrix is 7 × 10¹⁶ cells. We need a low-rank approximation that gives meaningful "user X likes track Y" scores in a tractable representation.

**Approach: collaborative filtering via ALS.**

1. Build a sparse interaction matrix: rows = users, cols = tracks, value = play count (or play count with implicit feedback weighting).
2. Factor R ≈ U × V^T where U is `users × k` (k≈64) and V is `tracks × k`.
3. For each user u, compute predicted score for unseen track t: `U[u] · V[t]`.
4. Pick top 30; filter out tracks already in user's library; pick 30 fresh.

**Implementation.**
- Spark MLlib ALS, runs weekly.
- Sparse: actual matrix has ~1 % density.
- Output: user vectors + track vectors → vector DB.
- For each user, k-NN over track vectors.
- Online ranker re-orders the 30 candidates using time-of-day and recent activity.

**Why ALS over deep models (Word2Vec-style track embeddings, transformer-based recommenders)?** ALS is well-understood, scales to billions of interactions, and produces interpretable embeddings. Spotify also uses Word2Vec-style and transformer models for *other* recommendation surfaces (e.g. "Made for You" radio); for Discover Weekly the simplicity wins.

**Why pre-compute, not online?** Each user's recommendation involves a k-NN over 100 M tracks → ~100 ms even with HNSW indexes. At 700 M users requesting daily we'd need a huge online inference fleet. Pre-computing once a week and stuffing into Redis is 10⁴× cheaper and the user experience (a fresh playlist Monday morning) is exactly what marketing wants.

### 10.3 Royalty correctness under network loss & retries

**The problem.** Client plays a song offline (no network), then comes online. Or the request times out and the client retries. We must not double-count plays (overpays artists) or miss plays (underpays).

**Approach.** Client-side `event_id` + server-side dedup window.

1. Client generates a UUID for each play event when the play is locally complete.
2. Client batches events; if network is down, holds them locally up to 30 days (matches DRM offline window).
3. Each batch carries an `Idempotency-Key` (UUID per batch) — server caches `(key → response)` in Redis 24 h.
4. Server inserts each event into Cassandra using LWT `IF NOT EXISTS` keyed on `event_id`. Duplicates are silent no-ops.
5. Royalty aggregator reads from Kafka (one event_id appears once because the producer is also idempotent — `enable.idempotence=true`).

**Edge cases.**
- **Replay attack** (malicious client sending the same event_id 1 M times): caught by LWT; counts only once.
- **Clock skew on client** (device clock wrong): server stamps `received_at`; royalty cycles use `received_at`, not `client_ts`.
- **Long-offline user** (30+ days): client buffers up to 30 days; beyond that, oldest events are dropped (rare; logged).

**Sanity check on dedup at scale.** 100 k events/s × LWT (each is a Paxos round in Cassandra) = expensive. Mitigation: only sink-stage uses LWT; royalty runs off Kafka where producer-side idempotence is enough. Sink-stage LWT cost is acceptable because Cassandra plays log isn't on the hot path.

### 10.4 Multi-region with country-specific licensing

**The problem.** Track A is licensed in `{US, GB, JP}` but not in `{DE, FR}`. Track A may be removed from `JP` overnight. Users may travel. The catalog effectively has a country dimension.

**Approach.**
1. `tracks.available_markets` (Postgres column, GIN index) lists ISO country codes.
2. Stream-URL service rejects plays where `user.country` ∉ `track.available_markets`. Returns 403.
3. Search service filters at query time (`filter: { terms: { available_markets: [user.country] }}`).
4. Updates to `available_markets` propagate via Kafka CDC to ES (< 5 s) and to Redis cache (< 1 s on next read).
5. **Travel handling:** user's `country` is from the account, not IP. We don't relax based on IP because that would let users VPN into a richer catalog. (Spotify does this in real life.)

**Multi-region active-active.** Each region (NA, EU, APAC) has its own Postgres, Cassandra, ES, Kafka, S3. Cross-region replication for catalog (Postgres logical replication) is async, ~1 s lag; for user data, Cassandra cross-DC RF=2 in each DC. Plays log writes always go to the local DC; cross-DC sync via Cassandra's gossip protocol.

**Failover.** If EU goes down, user requests reroute to NA via DNS / Anycast. NA serves EU users from a stale-but-recent catalog snapshot. Plays buffered locally, drained back to EU on recovery.

---

## 11. Bottlenecks & How They Break Under Scale

| Load level | What breaks first | Fix | Metric to watch |
|---|---|---|---|
| 1× (today) | Playlist fan-out on viral playlists (e.g. a celebrity adds a track and 50 M followers re-render simultaneously) | CDN-cached playlist JSON with 10-min TTL; in-app pull-to-refresh | CDN origin QPS for playlist endpoint |
| 3× | Stream-URL service CPU (HMAC signing) | Add instances; consider HMAC offload to a sidecar | CPU % on stream-url pods |
| 10× | Cassandra plays-log compaction lag | Larger nodes, more compaction throughput, or move to a more modern engine (ScyllaDB) | `pending_compactions` per node |
| 10× | Search ES cluster query latency p99 | Add nodes, more shards, separate hot vs cold shards | ES query p99 |
| 30× | Redis cache memory for hot tracks (top-1 % footprint grows) | Tier cache: hot in Redis, warm in CDN, cold from Postgres | Redis hit rate, memory used |
| 100× | CDN egress to ISPs (peering pipes saturate) | More PoPs, deeper ISP partnerships, encoding optimization (Opus at lower bitrate) | Per-PoP egress saturation |
| 100× | Kafka cross-DC replication bandwidth | Local-only writes for transient data (plays); reconcile in OLAP | Cross-DC MirrorMaker lag |
| 1000× | BigQuery cost for analytics | Tiered storage; archive raw plays > 1 yr to GCS Coldline | BQ query cost / month |

For each: alarm threshold = 80 % of capacity, page on 95 %.

---

## 12. Trade-offs Summary

| Decision | What we gained | What we gave up | Why it's the right call |
|---|---|---|---|
| Multiple bitrates | Adaptive streaming, free tier feasible | Storage 3× | Bandwidth savings + UX win >> storage cost |
| Pre-computed Discover Weekly | Sub-10 ms response, weekly delight | Stale within the week | Users *expect* a Monday playlist; staleness is by design |
| Cassandra for plays log | Horizontal scale, predictable writes at 100 k/s | No JOINs, no ACID across rows | Plays are append-only; analytics happens in BQ |
| Postgres for catalog | Joins, strong consistency for label updates | Manual sharding, harder cross-region writes | Catalog is small (200 GB), low write rate |
| Kafka in the middle | Decouples ingest from consumers, replay capability | Operational complexity | 4+ consumers; one source of truth for events |
| DRM (Widevine/FairPlay) | Royalty enforcement, enables offline | Cannot be played outside the app, hostile to power users | No DRM = no label license = no business |
| Active-active multi-region | Geo-low-latency, regional failure tolerance | Complex consistency, license-aware routing | Globally distributed user base requires it |
| Country-locked catalog | Legal compliance | Users hate it when traveling | Legal non-negotiable |

---

## 13. Cross-Questions ("Why X and not Y") — ≥ 15

The interviewer drills here. Each answer is 5–15 lines because shallow answers fail.

### 13.1 Why Cassandra for the plays log and not Postgres?

Cassandra is engineered for very-high-write append-only workloads with no JOINs. Plays are exactly that — 100 k writes/s, immutable, time-series-like. Postgres tops out around 50 k writes/s on commodity hardware before you have to manually shard, and even sharded the index-update overhead and WAL contention make 100 k writes/s painful. Cassandra's LSM-tree storage makes appends nearly free. Cross-region active-active is also native to Cassandra (multi-DC replication with tunable consistency); achieving the same in Postgres requires logical replication + bespoke conflict resolution. The cost is no JOINs and weaker isolation — neither matters here because the plays log is read by aggregation pipelines, not transactional code. Postgres remains right for the catalog (small, joinable, strongly consistent for label updates).

### 13.2 Why Kafka and not SQS/Kinesis/RabbitMQ?

Kafka is a *log*, not a queue. Multiple consumer groups read the same partition independently, each tracking its own offset. We have ≥ 4 consumers (sink, royalty, recs, charts) and want each to be able to replay history independently. SQS deletes a message after one consumer reads it; fan-out requires SNS+SQS-per-consumer, which is more cost and weaker ordering guarantees. Kinesis is functionally similar to Kafka but gives less control over partition count, retention, and schema management; at our volume the operational overhead of Kafka is justified. RabbitMQ tops out near 50 k msgs/s per node — we need 100 k+ sustained, 3× peak. Kafka does millions/s per broker. Lastly, Kafka's 7-day retention is exactly the "consumer fell behind, reprocess" tool we need.

### 13.3 Why partition Kafka by `user_id` and not `track_id`?

Royalty correctness needs ordered events within a play session — was track X listened to past 30 s before the user paused? Partitioning by `user_id` keeps a session's events in one partition, preserving order. `track_id` partitioning would create hot partitions (Drake gets 10× the plays of an average track) and would scramble the order of one user's session across partitions, complicating session-aware logic. `user_id` is uniformly distributed across 700 M users, so partitions are balanced. The edge case — one user generating event storms — is rate-limited at the API tier.

### 13.4 Why pre-compute Discover Weekly weekly and not on demand?

A per-user k-NN over 100 M tracks at request time is ~100 ms even with HNSW indexes. At 700 M users requesting on demand we'd need an inference fleet of thousands of GPU nodes — cost-prohibitive. Pre-computing once a week (Spark job, ~6 h on a few hundred nodes) costs a fraction of that and gives users a "Monday morning gift" cadence that has become a product feature, not a workaround. The trade-off is that recs are stale within the week, but for *weekly* discovery that's exactly the contract. For "More like this" (a per-track, online recommendation) we *do* serve online, using a smaller candidate set.

### 13.5 Why HLS-like segmented streaming and not progressive download?

Progressive download means the client gets a single byte stream from start to end. If bandwidth drops, the player rebuffers. With HLS the file is sliced into ~10-second segments at multiple bitrates; the client picks per-segment based on local bandwidth measurement. Result: graceful degradation rather than a stall. Also: segments are individually cacheable at the CDN — a popular song's segments are all cached at edges, while a niche song fetches segments on demand. Progressive download caches only at the file level, which is too coarse for our 100 M-track catalog.

### 13.6 Why CDN multi-tier (edge + shield) instead of "edge + S3"?

With ~95 % edge hit rate, 5 % of 5 TB/s peak = 250 GB/s falls through to origin. S3 caps egress per bucket and charges $0.05–$0.09/GB egress; that's millions/month. A regional shield cache in front of S3 with a 99 % hit rate (it sees only the ~5 % miss traffic) reduces origin egress to 0.05 % × 5 TB/s ≈ 2.5 GB/s — a 100× reduction. The shield tier is one cluster per region, comparatively cheap.

### 13.7 Why JWT for client auth and not opaque session tokens?

JWTs are stateless: the API tier validates locally (HMAC or RSA against a published JWKS), no DB roundtrip. At our QPS (1 M peak) that saves ~1 M Redis hits/s. The downside is revocation — a JWT remains valid until its TTL expires, even if we want to log the user out *now*. We mitigate with short TTLs (15 min) + refresh tokens (long-lived, revocable in the auth DB). For revocations of egregious abuse we publish a JWT blacklist via Redis with O(N) lookup against a small set of revoked `jti` claims.

### 13.8 Why 5-minute manifest URL TTL?

Long enough that users in slow networks can complete a fetch; short enough that a leaked URL can't be permanently shared (only 5 minutes of free playback). HMAC-signed URLs are nice because validation is purely cryptographic, no DB lookup at the CDN. We also include the user's `country` in the signed payload so an EU user can't share a URL with a friend in a region where the track is licensed differently.

### 13.9 Why both collaborative filtering and content-based recommendations?

CF excels when there's user data ("users like you also liked X"). Content-based excels when there's track data but no user data ("this new song sounds like Beyoncé") — necessary for cold-start. Combining gives the best of both: known tracks ranked by CF (the strong signal); new tracks injected via content-based (so the catalog isn't fossilized to last year's hits). The hybrid is also more robust to "filter bubble" complaints — pure CF tends to recommend what's already popular.

### 13.10 Why Elasticsearch for search and not Postgres FTS or Algolia?

Postgres FTS (`tsvector`) handles up to ~100 GB and a few thousand QPS. We have 100 GB of indexed text and 20 k QPS with relevance tuning needs (synonyms, fuzzy, n-grams, phonetic) that PG can't match without heroic custom indexes. Algolia is a managed competitor — fast, but pricing at our volume becomes prohibitive (millions/month) and we lose control over indexing pipeline. Elasticsearch is open-source, self-hosted, mature, and at our scale the operational cost is justified. Newer entrants like Vespa are interesting but ES has the community + tooling.

### 13.11 How do you handle a "thundering herd" when a globally hot track is released?

Two herd risks: (1) on the catalog metadata cache (Redis miss → all instances hammer Postgres) and (2) on the audio CDN (cold cache → all PoPs miss to origin simultaneously).

For (1): "single-flight" pattern — when one instance has a cache miss, others coalesce on the same in-flight DB request. Redis-based locks (SETNX with short TTL) gate the DB call.

For (2): pre-warm the CDN. When a major release is scheduled, a job pushes the audio segments to all PoPs hours before launch. Hot release goes live with a warm cache; first-listener latency is the same as steady-state.

### 13.12 What if a Cassandra node dies mid-write?

Writes are routed to all `RF=3` replicas. With LOCAL_QUORUM consistency (write succeeds when 2 of 3 ack), losing one node still succeeds. A hint is stored on the coordinator for the absent node and replayed when it returns. If two of three replicas die in the same DC, writes fail with `Unavailable` — clients retry against the surviving DC (cross-DC LOCAL_QUORUM if configured). The plays-log impact is bounded; we never accept lossy writes for royalty data.

### 13.13 How do you guarantee "exactly-once" royalty counting?

Strictly speaking, exactly-once distributed processing is provably impossible without coordination. We get *effectively* exactly-once via:
- Producer-side idempotence in Kafka (`enable.idempotence=true`, `acks=all`).
- Consumer-side dedup using `event_id` (a UUID generated at the client per play).
- LWT (`IF NOT EXISTS`) on the plays-log insert keyed by `event_id`.
- Royalty aggregator uses upsert by `(track_id, country, tier, hour_bucket)` so retries are idempotent.

End-to-end, we measure event loss as < 1 in 10⁶ in normal operation, and audit using a control sample.

### 13.14 What's the cache eviction strategy for Redis hot-track cache?

LRU with TTL. TTL is 1 hour for catalog metadata (label changes are rare, 1 h staleness on a niche track is fine; updates also publish a Kafka invalidation that proactively DELs). For hot keys we'd also use LFU (Least-Frequently-Used) variant — Redis 4+ supports `allkeys-lfu` which is right for the long-tail-of-tracks distribution. Without LFU, an LRU cache's cold scan (a one-off batch job listing all tracks) can flush the hot set; LFU keeps "Yesterday" by The Beatles in cache regardless.

### 13.15 How do you do schema evolution on Kafka events?

Avro + Confluent Schema Registry. Each producer writes with a schema ID embedded in the message; consumers fetch the schema by ID and deserialize. Schema changes must be backwards compatible (new optional fields with defaults, never rename or retype). The Schema Registry enforces this at write time — a producer trying to register an incompatible schema is rejected. For breaking changes, we cut a new topic version (`plays-v2`), dual-write for a transition window, then retire `plays`.

### 13.16 Why isn't the play event hot path synchronous?

Synchronous would mean: `POST /plays` writes to Cassandra, returns 200. Latency per call ≥ 30 ms (Cassandra LWT round-trip). At 100 k events/s × 30 ms = a lot of in-flight requests on the API tier. Worse, a Cassandra blip would back-pressure into the client. Asynchronous via Kafka means the API just appends to a partitioned log (~5 ms p99) and returns 202. Cassandra and aggregators consume independently. The user doesn't care about the difference (they're listening to music), and we get headroom.

### 13.17 What happens on a region failover?

DNS/Anycast routes users to the next-closest region. The new region's Postgres has the catalog (replicated async, ~1 s lag — acceptable; a few seconds of stale data on a release is fine). Cassandra has user data via cross-DC replication. Plays log writes go to the new region's local cluster; aggregators in that region pick up. CDN edges already serve from the nearest healthy origin. Within ~30 seconds, the user is on a fully-functional alternate region. The failed region's plays buffer locally (WAL on API nodes); on recovery they drain back. The interviewer's follow-up is usually "what's the data loss window?" — for plays, sub-second (Kafka with `acks=all` doesn't ack until at least 2 of 3 brokers commit). For playlist edits — same.

### 13.18 How do recommendations stay fresh between weekly batches?

Two mechanisms. (1) The online ranker re-orders the 30 candidates using real-time signals (recent plays, time-of-day). So even within a week, "Discover Weekly" ranks differently for a user who played jazz this morning vs hip-hop. (2) "Daily Mix" runs nightly, so it refreshes every day. (3) "More like this" is fully online (small candidate set, vector DB nearest-neighbor).

### 13.19 How do you detect and handle account sharing?

Heuristic: concurrent active streams from geographically-distant IPs in a short window. We don't hard-block (too many false positives — spouses, students at college). We surface a "is this you?" prompt and, for paid plans, enforce a max-concurrent-stream limit (1 for Individual, 6 for Family). Family plans require all members in one household — verified periodically by IP/region check, again with a soft prompt. This is a product/policy layer on top of the technical streaming system; not a hard architectural concern but interviewers sometimes ask.

---

## 14. Common Follow-Up Scenarios

### 14.1 "Now add real-time charts (Today's Top 50)"

Tap the `plays` Kafka topic with a Flink job. Tumbling 1-minute windows, count per `track_id`, top-K aggregator. Output → Redis sorted set keyed by country. UI fetches via `GET /v1/charts/top50?country=US`. Refresh frequency: 1 min. Same pattern works for genre charts, artist trending, etc. Cost: one more consumer group on the existing Kafka topic; one Flink cluster; one Redis sorted set per country.

### 14.2 "Now make it multi-region active-active (already covered)" — what changes if licensing is per-region?

Per-region licensing means a track playable in EU might not be playable in NA. The catalog table is replicated cross-region but `available_markets` is the source of truth. Reads always filter by user's country. The interesting edge case is a user traveling: their `country` is sticky to the account, so a US user in Germany still gets the US catalog. Some tracks legally require IP-based geofencing — we add a secondary IP-country check at the stream-URL service for a small whitelist of tracks.

### 14.3 "Now handle GDPR right-to-be-forgotten"

Two paths. (1) Hard delete personal data (account, library, playlists). (2) Anonymize plays log — replace `user_id` with `null` in plays records, but keep aggregates (royalties already paid; can't unwind). Implementation: a tombstone is published; a Spark job rewrites partitions in the Cassandra plays log replacing user_id; the user's Redis caches are flushed; user-level recs files are deleted from object storage. Process must complete within 30 days (GDPR requirement). Backups: tagged for purge on next rotation.

### 14.4 "What if MAU grows 10×?"

Walk through bottleneck table. The first-to-break is Cassandra plays-log compaction at 1 M writes/s — fix by adding nodes (Cassandra scales linearly) or migrating to ScyllaDB for higher per-node throughput. Second is CDN origin egress; fix by increasing PoP count and ISP peering. Third is Postgres catalog — at 10× MAU we'd shard further (32 → 128 shards) or move to CockroachDB. Recommendation pipeline scales with Spark cluster size — linear cost. Interestingly, search QPS doesn't scale linearly with MAU because users don't search 10× more — it scales sub-linearly (~3–5×).

### 14.5 "Now add podcasts / audiobooks"

Same plumbing; different content type. Episodes are larger files (~30 MB vs ~5 MB) but fewer (millions vs 100s of millions). A separate `episodes` table (Postgres) with `show_id`, `episode_id`, `duration`. Reuses the audio CDN. Different recs model — sequential listening (next episode in show) is the dominant signal, simpler than music CF. Royalty model is also simpler (one show owner; no songwriters/labels).

### 14.6 "Now add live audio (Spotify Live / Stations)"

This breaks the pre-encoded model. Live needs a low-latency origin that ingests RTMP/WebRTC and transcodes in real time. Different infrastructure: a live-transcoding fleet, a different CDN profile (low-latency HLS or CMAF), a live event metadata service. Plays-tracking switches to per-second listener counts. We design this as a separate pipeline that bolts onto the existing catalog/search/playlist tier.

---

## 15. Cheat-Sheet Recap (final-minute summary)

If you have 60 seconds left in the interview, recite this:

1. **Problem:** music streaming for 700 M MAU, 7.5 B plays/day, 100 M-track catalog, 99.99 % playback availability.
2. **Hot path:** Client → CDN edge → audio segments. Metadata via REST → Catalog API → Redis → Postgres. ~99 % cache hit at edge.
3. **Plays pipeline:** Client → Kafka (`acks=all`, idempotent producer, partitioned by `user_id`) → 4 consumers (Cassandra sink, Royalty Flink, Recs Spark, Charts Flink).
4. **Storage choice:** Postgres (catalog) sharded by `track_id`; Cassandra (plays + playlists) partitioned by `user_id`; Elasticsearch (search); Redis (caches + per-user recs); S3 (audio segments).
5. **Recommendations:** weekly Spark ALS for collaborative filtering + content-based for cold start, online ranker for personalization at fetch time. Output to Redis.
6. **Royalties:** every play → Kafka → Flink hourly aggregates → BigQuery monthly join with rights tables → payouts.
7. **Multi-region:** active-active per region; catalog replicated async; plays local; CDN edge multi-origin failover.
8. **Hardest sub-problem solved:** event-loss-free play pipeline using Kafka + LWT dedup + idempotent producers.
9. **Biggest trade-off:** weekly pre-computed Discover Weekly (cheap but stale) vs online (fresh but ~10⁴× more expensive). We chose batch + online ranker.
10. **What breaks at 10×:** Cassandra compaction, CDN origin egress, ES query latency. Fixes are linear capacity additions.

---

## Appendix A: Numbers worth memorizing for this design

```
Audio bitrate           → bytes/min
  96  kbps              ≈ 0.7 MB/min
  160 kbps              ≈ 1.2 MB/min
  320 kbps              ≈ 2.4 MB/min

Avg song                ≈ 3.5 MB at 160 kbps (~3 min)
Catalog size            ≈ 500 TB raw, ~1.5 PB with 3 bitrates

CDN edge hit rate       ≈ 95 % typical, 99 % for hot tracks
Origin egress           ≈ 2 % of total bandwidth → ~100 GB/s peak

Kafka broker            ≈ 1 GB/s in/out; 1 M+ msgs/s
Cassandra node          ≈ 10–20 k writes/s sustained on commodity
Postgres node           ≈ 50 k writes/s before sharding
Elasticsearch node      ≈ 1–5 k QPS depending on query complexity
Redis node              ≈ 100 k+ GET/SET ops/s

Discover Weekly batch   ≈ 6 h Spark job over 700 M users × 90 days plays
ALS factorization       k=64 typical; trained on 7 B+ interactions
```

## Appendix B: Glossary cheat-card

- **HLS:** HTTP Live Streaming. Apple's adaptive streaming protocol.
- **DASH:** Dynamic Adaptive Streaming over HTTP. ISO standard equivalent.
- **CMAF:** Common Media Application Format — unifies HLS+DASH segment formats.
- **Widevine / FairPlay / PlayReady:** the three DRM systems. Widevine = Google (Android, Chrome). FairPlay = Apple. PlayReady = Microsoft.
- **ISRC:** International Standard Recording Code.
- **ALS:** Alternating Least Squares — matrix factorization for collaborative filtering.
- **HNSW:** Hierarchical Navigable Small World — a k-NN index for vector search.
- **LWT:** Lightweight Transaction — Cassandra's `IF NOT EXISTS` Paxos-backed conditional write.
- **Open Connect:** Netflix's name for ISP-embedded CDN boxes; Spotify has equivalents.
- **MAU / DAU:** Monthly / Daily Active Users.

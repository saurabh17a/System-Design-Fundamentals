# YouTube / Netflix (Video Streaming) — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[video]` `[transcoding]` `[cdn]` `[abr]` `[recommendations]`
> **Companies that ask this:** Google, Netflix, Hulu, Amazon, Disney+, Twitch

---

## Beginner's Guide

### What's this in plain English?

You record a video on your phone, upload to YouTube. Now anyone in the world can stream it on any device, in HD or 4K, on slow Wi-Fi or fast fiber. The system has to: ingest (huge file uploads), transcode (turn into many resolutions and codecs), store (petabytes), distribute via CDN globally, adapt the bitrate to the viewer's connection live, and recommend related videos.

### Why solve it?

- **Real world**: YouTube, Netflix, Hulu, Twitch, Disney+.
- **Teaches**: video pipelines, transcoding, CDNs, adaptive bitrate streaming (ABR), HLS/DASH protocols, recommendation systems.

### Vocabulary

- **Transcoding** — re-encode video into different resolutions/codecs (4K, 1080p, 720p, 360p).
- **Codec** — encoding scheme (H.264, H.265, VP9, AV1).
- **CDN** — Content Delivery Network: edge servers close to viewers.
- **HLS / DASH** — protocols that split video into 2-10 second segments and serve them.
- **ABR (Adaptive Bitrate)** — player auto-picks the best quality for current bandwidth.
- **Bitrate** — bits per second; higher = better quality, more bandwidth.

### High-level architecture

```
Upload → Object store (raw)
   ↓
Transcoding workers (job queue) → Multiple bitrate versions
   ↓
Origin server → CDN edges (regional) → Viewer's device (HLS player)
                                          ↓
                                   adapts segments by bandwidth
```

Components:
1. **Upload** — chunked upload (resumable). Big files; slow networks.
2. **Transcoding** — split into N bitrate ladders. Asynchronous job queue (Kafka).
3. **Storage** — object store (S3-like) for segments + metadata DB.
4. **CDN** — edge servers cache popular videos near viewers.
5. **Player** — fetches segments; ABR picks resolution per segment based on download speed.

For trending content, watch out for the "thundering herd" — millions request the same new video. CDN tiered caching helps.

### How to read this doc

- **Beginner**: focus on transcoding pipeline and ABR concept.
- **Interview**: cross-questions on cold-start, live streaming vs VOD, CDN economics.

---

## 0. How to use this doc in an interview

Tests **video pipeline + CDN + adaptive bitrate streaming**. Tests:
1. Ingest → transcode → store.
2. CDN serving at scale.
3. ABR (HLS / DASH).
4. Recommendation hooks (out of scope deep, but mention).

Trap: glossing over transcoding pipeline; this is most of the data infra.

---

## 1. Problem Statement

A video streaming platform:
- Creators upload videos.
- Transcode to multiple resolutions/bitrates.
- Serve via CDN.
- Adaptive bitrate streaming.
- Discovery, search, recommendations.
- Live streaming (separate).

---

## 2. Clarifying Questions

- [ ] Live streaming or VOD only?
- [ ] Comments / likes?
- [ ] DRM (paid content)?
- [ ] Captions / multi-audio?
- [ ] Recommendations in scope?

> **Assume:** VOD primary; comments + likes; basic DRM; captions + multi-audio; brief recommendations.

---

## 3. Functional Requirements

**P0:**
1. Upload video.
2. Transcode to multiple resolutions (240p, 480p, 720p, 1080p, 4K).
3. Adaptive bitrate streaming.
4. Discovery (search, browse).
5. Watch with seek / pause.
6. Like, comment, share.
7. Captions display.

**P1:**
8. Personalized recommendations.
9. Playlists, channels.
10. Multi-audio tracks.

**P2:**
11. Live streaming.
12. DRM for premium.
13. Watch parties.

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.99% playback |
| Startup latency | < 2 s to first frame |
| Buffer rate | < 1% rebuffering |
| Throughput | 10s of TB/sec aggregate egress |
| Storage | exabytes |

---

## 5. Capacity Estimation

```
Daily uploads: 1B min of video / day (YouTube scale)
Avg duration: 10 min → 100M videos/day uploaded
Per video: 1080p ~ 50 MB/min → 500 MB raw avg
Daily ingest: 50 PB raw → ~200 PB after multi-resolution transcoding
Total catalog: hundreds of EB
Daily egress: hundreds of PB
```

---

## 6. API

```
POST /v1/uploads                                      -> upload_session
PUT  /v1/uploads/{session}                            (chunked)
POST /v1/uploads/{session}/finalize  body: {title}    -> video_id
GET  /v1/videos/{id}                                  -> manifest URL + metadata
GET  /v1/videos/{id}/manifest.m3u8                    (HLS)
GET  /v1/search?q=
```

---

## 7. Data Model

### Videos (Postgres / DocDB)
- `(video_id, owner_id, title, description, status, duration, uploaded_at)`

### Encodings (Cassandra)
- `(video_id, resolution, bitrate, codec, segment_count, manifest_url)`

### Storage
- Raw upload: S3 (deleted after transcode).
- Transcoded segments: S3, CDN-fronted.

### Watch sessions (analytics)
- Append events: play, pause, seek, end.
- Stream to data warehouse for recommendations.

---

## 8. Architecture

```
              ┌──────────────────────┐
              │  Creators            │
              └──────────┬───────────┘
                         │ chunked upload
                         ▼
                ┌─────────────────────┐
                │  Upload Service     │
                │  - resumable        │
                │  - validation       │
                └──────────┬──────────┘
                           ▼
                ┌─────────────────────┐
                │   Raw Storage (S3)  │
                └──────────┬──────────┘
                           │
                ┌──────────▼──────────┐
                │  Transcode Pipeline │
                │  - segment input    │
                │  - parallel encode  │
                │  - per-resolution   │
                │  - HLS manifest     │
                └──────────┬──────────┘
                           ▼
                ┌─────────────────────┐
                │ Encoded Storage     │
                │ (S3 + CDN)          │
                │  - HLS segments     │
                │  - manifests        │
                └──────────┬──────────┘
                           │
              ┌────────────▼────────────┐
              │    Viewers              │
              │    (HLS player)         │
              └─────────────────────────┘

              ┌─────────────────────────┐
              │ Discovery / Search       │
              └─────────────────────────┘
              ┌─────────────────────────┐
              │ Recommender             │
              └─────────────────────────┘
```

---

## 9. Component Deep-Dives

### 9.1 Upload (resumable)
- Same pattern as Dropbox: chunk + finalize.
- Large files (multi-GB).

### 9.2 Transcode pipeline
- Hardest part.
- Split video into segments (10s chunks).
- Parallel encode each segment to multiple bitrates.
- Use specialized hardware (GPU encoders, ASIC like NETINT).
- After all segments transcoded: assemble manifest.
- Latency: 10-30 min for typical video; live transcoding shorter.

### 9.3 Adaptive Bitrate (HLS / DASH)
- Manifest lists available bitrates.
- Player picks based on bandwidth estimate.
- Switches between bitrates on the fly.

### 9.4 CDN serving
- All segments served from CDN edges.
- Cache hit rate ~95%.
- Origin fetches on miss; populates edge.

### 9.5 Recommendations
- Watch history fed to ML.
- Per-user recommendation list pre-computed.
- Cached for instant serve.

---

## 10. Hard Sub-Problems

### 10.1 Transcoding cost
- Hours of compute per hour of video.
- GPU/ASIC accelerators essential.
- Tiered: lower-priority transcodes wait.

### 10.2 CDN at scale
- Multi-CDN strategy (Akamai, Cloudflare, ISP-cached).
- Per-region origin replicas.
- Real-time monitoring of edge cache hit rate.

### 10.3 Bitrate ladder choice
- Default: 240p, 360p, 480p, 720p, 1080p, 4K.
- Per-content adaptive: complex content (action) → more bitrates; simple → fewer.

### 10.4 Live streaming
- Separate pipeline; lower latency (~5s).
- HLS-LL or WebRTC.
- Out of scope here.

### 10.5 Personalized recommendations
- Per-user offline pipeline.
- Refresh daily.
- Real-time signals (current session) bias serve.

---

## 11. Cross-Questions ≥ 12

### 11.1 Why segment + transcode in parallel?
- Linear transcode: hours per hour-of-video.
- Parallel: 60× speedup.

### 11.2 Why HLS over progressive download?
- Progressive: download whole video before play; bad UX.
- HLS: stream as you go; adaptive bitrate.

### 11.3 Why multiple CDNs?
- Resilience: one CDN outage is acceptable.
- Performance: pick best per region.
- Cost: negotiate.

### 11.4 What about DRM?
- Encrypt segments at transcode.
- Key delivery via license server.
- Player decrypts; content protected.

### 11.5 How is search done?
- Title + description + tags + auto-extracted (from speech).
- Indexed in Elasticsearch.

### 11.6 How are popular videos cached?
- Hot videos in CDN edge near-permanent.
- Cold: pulled on demand.

### 11.7 What about copyright?
- Content ID: fingerprint at upload; match against rights holder DB.
- Auto-flag, monetize, or block.

### 11.8 How is bandwidth measured for ABR?
- Player measures per-segment download time.
- Updates bandwidth estimate; picks bitrate.

### 11.9 What about offline downloads?
- DRM-encrypted file delivered.
- Time-bound license.
- Local key storage.

### 11.10 Cost optimization for storage?
- Tiered: hot (S3 Standard), cold (Glacier), archive.
- Old videos with no traffic: cold tier.
- Re-promote to hot on first new view.

### 11.11 How does recommendations integrate?
- "Up next" feature: API call returns next video for current session.
- ML model serves from feature store.

### 11.12 What's the failure mode if CDN is unhealthy in a region?
- Multi-CDN failover.
- Player's manifest can specify multiple URLs.
- Or origin pull (slower, costlier).

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| Multi-resolution transcoding | Adaptive bitrate, broad device support | Storage 5-10x raw |
| Multi-CDN | Resilience | Vendor management |
| HLS over WebRTC | Mass scale | Higher latency |
| Pre-compute recommendations | Fast serve | Stale by hours |

---

## 13. Cheat-Sheet

1. **Upload → S3 → Transcode pipeline.**
2. **Segment + parallel encode** to multiple bitrates.
3. **HLS / DASH** for adaptive streaming.
4. **CDN** for serve (95%+ cache hit).
5. **Cassandra** for video metadata.
6. **ML pipeline** for recommendations (offline).
7. **Content ID** for copyright.

---

## Appendix: Bitrate ladder example

```
Resolution    Bitrate
240p          400 kbps
360p          800 kbps
480p          1.2 Mbps
720p          2.5 Mbps
1080p         5 Mbps
1440p         8 Mbps
4K            15 Mbps
```

# Dropbox / Google Drive — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[storage]` `[chunking]` `[sync]` `[dedup]` `[metadata]`
> **Companies that ask this:** Dropbox, Google, Meta, Apple, Box, Microsoft

---

## Beginner's Guide

### What's this in plain English?

You drop a file into your Dropbox folder. It uploads to the cloud. Every other device you own syncs that file. Edit the file on your phone, the laptop sees the change. The system: how to upload efficiently (don't re-upload the whole 1GB file when you change one byte), store at scale, sync to multiple clients reliably.

### Why solve it?

- **Real world**: Dropbox, Google Drive, OneDrive, iCloud Drive.
- **Teaches**: file chunking, deduplication (don't store the same chunk twice), metadata vs blob storage, sync algorithms, conflict resolution.

### Vocabulary

- **Chunk** — fixed-size piece of a file (e.g., 4MB).
- **Hash / Content addressing** — store chunks by their SHA-256; identical chunks are stored once.
- **Metadata** — file path, name, version, owner, list of chunk hashes.
- **Blob storage** — raw chunk bytes, in S3-style storage.
- **Sync** — keep multiple clients up to date.
- **Conflict** — two clients edit the same file offline; merge or pick one.

### High-level architecture

```
Client → Chunk + Hash → Upload chunks → Blob Storage (S3)
                                ↓
                          Metadata Service (file → list of chunk hashes)
                                ↓
                          Notification → Other clients sync
```

Two storage layers:
1. **Blob storage** — chunks, content-addressed, deduplicated globally.
2. **Metadata DB** — files, paths, versions, references to chunks.

When you upload, the client splits the file into 4MB chunks, hashes each, asks "do you already have this hash?" If yes, skip; else upload. This is **why uploading a duplicate file is instant** — the server already had every chunk.

Sync: on metadata change, push notifications to other clients. They download only the chunks they don't have.

### How to read this doc

- **Beginner**: focus on chunking + dedup.
- **Interview**: cross-questions on conflict resolution, mobile bandwidth, large files.

---

## 0. How to use this doc in an interview

Dropbox tests your ability to design a system that's both **storage-heavy** AND **sync-heavy**. The traps:
1. Treating files as opaque blobs — misses the chunking + dedup story.
2. Forgetting that the **metadata service is the hot path**, not the blob service.
3. Hand-waving sync conflicts — reviewer will drill on "two devices edited offline simultaneously."
4. Not separating the **client → metadata → blob** flow.

Walk through: ingest → chunking → dedup → blob storage → metadata DB → sync protocol → conflict resolution. The cross-questions section is where senior interviewers grade.

---

## 1. Problem Statement

A file synchronization service. Users:
- Upload files from any device.
- See identical view on every device, eventually.
- Resolve conflicts when two devices edit the same file offline.
- Browse history; restore prior versions.
- Share files / folders with permissions.

Scale: hundreds of millions of users, billions of files, exabytes of storage; high read amplification (every device polls metadata).

---

## 2. Clarifying Questions

### Scope
- [ ] Files only, or also Google-Docs-like collaborative editing? (Different problem; see `google-docs.md`.)
- [ ] Versioning — keep every version forever, or N most recent / N days?
- [ ] Sharing model — user-to-user, public links, team workspaces?
- [ ] Selective sync — desktop client lets users exclude folders?
- [ ] Encryption — client-side (E2E) or server-side at rest?
- [ ] Hard limits — max file size, total quota?

### Scale
- [ ] DAU? MAU?
- [ ] Avg files per user; avg file size?
- [ ] Read:write ratio? (Sync polls dominate writes.)
- [ ] Geographic distribution?

### Non-functional
- [ ] Availability SLA — 99.9%? 99.99%?
- [ ] Sync latency — how fast must a change propagate to other devices?
- [ ] Durability — multi-region replication?
- [ ] Cost — storage is the dominant cost; dedup matters.

### Edge cases
- [ ] User uploads a 10 GB file over flaky WiFi — resume?
- [ ] User uploads same file twice — 2× storage or dedup?
- [ ] Two devices edit offline; both reconnect — conflict semantics?

> **For this doc** we'll assume: 200M MAU, 100B files, 4 KB to 50 GB sizes, ~10:1 read:write, 99.99% availability, sub-30-second sync, server-side encryption at rest, version history 30 days for free / unlimited for paid, sharing supported, desktop + mobile + web clients.

---

## 3. Functional Requirements

**P0:**
1. Upload file (resumable for large files).
2. Download file.
3. Sync changes between devices.
4. List directory contents.
5. Delete (move to trash) and restore.
6. Conflict resolution (rename one as `file.txt (Conflict)`).
7. Share with another user (read or read-write).

**P1:**
8. Selective sync.
9. Version history; restore prior version.
10. Public share links.
11. Search by filename + content.

**P2 (out of scope):**
12. Real-time collaborative editing (separate problem).
13. Mobile camera roll auto-upload.
14. Document preview / thumbnails.
15. OCR on images.

---

## 4. Non-Functional Requirements

| Dimension | Target | Justification |
|---|---|---|
| Availability | 99.99% (read), 99.9% (write) | Read availability is product viability; write outages forgivable for short bursts |
| Sync latency | < 30 s end-to-end (p99 small file) | Beyond this, users lose trust |
| Durability | 11 nines | A lost file is unrecoverable customer pain |
| Throughput | 1M concurrent connected clients per region | Sync polling is the load |
| Cost | $0.02 / GB / month at S3-class storage | Storage cost dominates infra |

---

## 5. Capacity Estimation

### Storage (raw, before dedup)
```
Avg user storage      = 5 GB
Total raw             = 200M × 5 GB = 1 EB (logical)
With dedup (60% reduction typical) → ~400 PB physical
With 3× replication   → ~1.2 EB physical
```

### Bandwidth
```
Avg upload/user/day   = 50 MB
Total upload          = 200M × 50 MB = 10 PB/day ≈ 116 GB/sec average
Peak                  = ~5× → 580 GB/sec peak ingress
Egress (downloads)    = ~2× upload, dominated by sync of small chunks
```

### Metadata QPS
```
Connected clients     = 50M concurrent
Poll interval         = 30 s (most clients)
Metadata QPS          = 50M / 30 ≈ 1.7M QPS sustained, ~10M peak
```

This is the **critical bottleneck.** Blob storage is solvable with S3-class systems; metadata QPS at this scale requires careful design.

### Block sizing
```
Block size            = 4 MB (typical)
Blocks per file (avg) = file size / 4 MB
For a 5 GB file       = 1280 blocks
Block QPS (read)      ~ 100k/s on a hot file
```

---

## 6. API Design

```
# Upload (chunked, resumable)
POST   /v1/uploads                     -> upload_session_id
PUT    /v1/uploads/{session}/chunks    body: chunk N + offset
POST   /v1/uploads/{session}/finalize  body: { path, mtime }   -> file_id, version

# Download
GET    /v1/files/{file_id}/blocks/{block_hash}
GET    /v1/files/{file_id}             (returns metadata; client fetches blocks)

# Metadata
POST   /v1/sync/cursor                 body: { cursor }
                                       -> { changes: [...], next_cursor }
GET    /v1/folders/{folder_id}/list

# Sharing
POST   /v1/shares                      body: { path, recipient, permission }
DELETE /v1/shares/{share_id}
POST   /v1/links                       body: { path, expires_at }   -> short URL
```

**Cursor-based sync (not polling deltas):** server hands client an opaque cursor; on next call, returns all changes since that cursor. Idempotent; safe to retry.

---

## 7. Data Model

### Choice: SQL for metadata, blob store for content

- **Metadata** (Postgres / MySQL, sharded by user_id):
  - `users`: id, email, quota
  - `files`: id, owner_id, path, name, size, content_hash, version, mtime, deleted_at
  - `blocks`: id, file_id, offset, size, block_hash, position
  - `versions`: id, file_id, content_hash, created_at
  - `shares`: id, file_id, recipient_id, permission
  - `events`: id, user_id, type, file_id, ts (sync log)

- **Block storage** (S3 / GCS / equivalent):
  - Key = `block_hash` (content-addressable).
  - Same content from any user → same block → stored once.

### Why SQL for metadata?
- Transactional updates: file rename + version bump must be atomic.
- Sharding by user_id co-locates a user's data.
- Secondary indexes for sharing lookups.

### Why content-addressable block storage?
- **Dedup:** identical chunks (across users / files) stored once → ~60% storage reduction in practice.
- **Immutable:** once a block exists, it never changes. Caching is trivial.
- **Verification:** the hash *is* the integrity check.

---

## 8. High-Level Architecture

```
                ┌────────────────────────────────────┐
                │       Clients                      │
                │  (desktop, mobile, web)            │
                └──────────────┬─────────────────────┘
                               │ HTTPS
                               ▼
                ┌────────────────────────────────────┐
                │           CDN / Edge               │
                │  (block downloads served here)     │
                └──────────────┬─────────────────────┘
                               │  miss
                               ▼
                ┌────────────────────────────────────┐
                │       API Gateway / LB             │
                │  - auth                             │
                │  - rate-limit (per-user)            │
                └─────┬───────────────┬──────────────┘
                      │               │
            (metadata)│               │ (blob)
                      ▼               ▼
          ┌──────────────────┐  ┌──────────────────────┐
          │ Metadata Service │  │  Block Service       │
          │  - sync cursor   │  │  - upload session    │
          │  - dir listing   │  │  - chunk verify hash │
          │  - permissions   │  │  - dedup check       │
          │  - versioning    │  │                      │
          └────┬─────────┬───┘  └────────┬─────────────┘
               │         │               │
               ▼         ▼               ▼
         Postgres  Redis cache     Object Store
         (sharded) (hot dirs)      (S3 / GCS)
                          │
                          │ async events
                          ▼
                    ┌──────────────────┐
                    │  Notifier (push) │
                    │  WS / SSE        │
                    └──────────────────┘
                          │
                          ▼
                  push notify other devices
```

---

## 9. Component Deep-Dives

### 9.1 Block Service & chunking
- **Chunk size:** 4 MB fixed. Trade-off: smaller = more dedup, more metadata overhead; larger = less metadata, less dedup.
- **Variable-size chunking** (Rabin fingerprinting): better dedup on append-modified files (e.g. log files with appended lines) — same chunks survive insertion. Higher complexity.
- **Hash:** SHA-256 (collision-resistant; the hash IS the identity).
- **Upload flow:**
  1. Client computes chunk hash locally.
  2. Sends `HAS_BLOCK?` to server with hash.
  3. If server has it → skip upload (dedup at client time, saves bandwidth).
  4. If not → upload and verify hash.

### 9.2 Metadata Service
- **Sharded by user_id** (consistent hashing).
- Per-user data co-located; user's queries hit one shard.
- Shared files are tricky — see `13.7`.
- Secondary indexes: `(user_id, parent_folder_id, name)` for directory listing.

### 9.3 Sync cursor (the key abstraction)
- Cursor = `(user_id, last_event_id)`.
- Client stores cursor locally; sends with each sync call.
- Server returns events ≥ cursor.
- Events: `FILE_CREATED`, `FILE_UPDATED`, `FILE_DELETED`, `MOVED`, `SHARED`.
- Client applies events in order; updates its local state.

### 9.4 Push notifications (low-latency sync)
- Long-lived WebSocket per connected client.
- Server pushes "you have changes" — client triggers cursor poll.
- Without push: poll every 30s. With push: median sync latency ~1s.

### 9.5 Versioning
- Every change creates a new `version` row pointing to the new content_hash.
- Old versions accessible for 30 days (configurable).
- Garbage collection: every block has a refcount; when 0, deleted.

---

## 10. Hard Sub-Problems

### 10.1 Conflict resolution

Two devices edit `notes.txt` offline:
- Device A creates v2 (parent=v1).
- Device B creates v3 (parent=v1).
- Both reconnect.

Server detects: v2 and v3 both have parent v1 → fork.

Resolution: keep first-arriving as the new version; rename the other:
```
notes.txt           (v2 from device A — head)
notes (Device B's conflicting copy).txt  (the v3 content)
```

Both devices download both; user reconciles manually.

This is **not** auto-merge — too risky for binary files. Google Docs does merge but it's a different product (CRDT-friendly text only).

### 10.2 Large file resumable upload

- Client splits file into chunks.
- Each chunk uploaded individually with retry.
- Upload session tracks which chunks complete.
- Client can `GET /sessions/{id}` to know what's left after a network failure.
- Finalize: server stitches chunks → creates file metadata + version row.

### 10.3 Dedup garbage collection

- Block has refcount = number of `(file, version)` rows pointing to it.
- On version delete: decrement.
- When refcount = 0 and oldest reference > 30 days: schedule for deletion.
- Mark-and-sweep job runs nightly; decoupled from hot path.

### 10.4 Sync at scale

50M concurrent clients × 1 cursor poll / 30s = 1.7M QPS. Mitigations:
- Per-user shard concentration: poll hits one DB shard.
- Aggressive caching: "no changes since cursor X" cached per user.
- Push notifications eliminate empty polls (most polls return "no changes").

---

## 11. Bottlenecks & Scaling

| Load | What breaks first | Fix |
|---|---|---|
| 10× | Metadata DB writes (lots of file events) | Add more shards |
| 100× | Sync cursor lookups dominate read QPS | Per-user redis cache; "no changes" fast path |
| 1000× | Dedup bookkeeping | Probabilistic refcount; eventual GC |
| Multi-region | Cross-region replication lag for metadata | Per-region primary; eventual cross-region for blobs (S3 cross-region replication) |

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| Fixed 4 MB chunks | Simpler, predictable | Worse dedup on shifted files |
| Content-addressable blobs | Dedup, integrity check free | Per-block metadata overhead |
| Metadata in SQL, blobs in S3 | Right tool for each access pattern | Two systems to operate |
| Eventual consistency on cross-region | Lower latency in remote regions | Sync delay during recovery |
| Last-write-wins by upload time | Simpler conflict story | No three-way merge |

---

## 13. Cross-Questions ("Why X and not Y") — ≥ 15

### 13.1 Why content-addressable blobs (hash as ID)?
- **Dedup**: same content = same hash = stored once. Saves ~60% storage.
- **Integrity**: hash mismatch = corruption detected.
- **Caching**: immutable URLs are CDN-friendly forever.
- **Cost**: alternative (file-as-blob) loses dedup; for 200M users this means ~3× storage cost.

### 13.2 Why 4 MB chunks and not 1 MB or 16 MB?
- 4 MB minimizes per-block metadata while keeping dedup useful.
- 1 MB: 4× more metadata rows; better dedup but DB CPU dominates.
- 16 MB: less dedup; uploads of partial files require uploading full chunks even for small edits.
- 4 MB is the industry consensus (Dropbox, OneDrive, Google Drive).

### 13.3 Why fixed-size chunking and not variable (Rabin fingerprinting)?
- Fixed: simpler, faster client-side hashing.
- Variable: better dedup on append-modified files. A 1-byte insertion at the start re-chunks every chunk in fixed; in variable, chunk boundaries shift but most stay.
- Trade-off: variable saves ~10–15% additional storage but doubles client CPU.
- Dropbox uses fixed; modern systems (rsync, restic) use variable.

### 13.4 Why client-computes-hash before upload?
- Bandwidth save: skip upload if server has the block.
- Common case: copying a file or restoring from backup means *all* blocks already exist server-side.
- Cost: client CPU. Acceptable.

### 13.5 Why SQL for metadata and not NoSQL?
- Transactional updates: rename = update file + bump version + create event. Multi-row atomicity.
- Secondary indexes for sharing queries.
- Mature operational tooling.
- NoSQL would force application-level transactions and complex secondary index management.

### 13.6 Why cursor-based sync instead of polling for changes since timestamp?
- Cursor is monotonic, server-issued; client can't tamper.
- Timestamps are lossy (multiple events at same ms; clock drift).
- Cursor-as-event-id is unambiguous.

### 13.7 How do you handle shared files on a sharded metadata system?
- Sharing creates a row in `shares` keyed by (file_id, recipient).
- Recipient's sync polls *both* their own shard and any shards holding shared files.
- Optimization: maintain a `shared_with_me` list per user (denormalized) → poll their own shard only.
- On share update: fan-out to recipient's shard.

### 13.8 Why server-side encryption and not client-side (E2E)?
- E2E means server can't see content → no dedup possible across users → 3× storage cost.
- E2E means server can't index for search.
- Server-side: encrypted at rest with master key; per-tenant key derivation possible.
- Trade: E2E for the 1% who demand it; server-side as default.

### 13.9 Why long-lived WebSocket for push and not Apple/Google push services?
- WS is platform-neutral.
- Apple/Google push has latency (~5s) and rate limits.
- For desktop clients, only WS works (no native push).
- WS scales: 1M connections per modest server.

### 13.10 Why does conflict resolution rename instead of merge?
- Merge requires understanding file format. Binary files (Word, images) are unmergeable.
- For text files, three-way merge requires a base version → metadata bloat.
- Rename-on-conflict is conservative: no data loss; user reconciles.
- Power users with VCS-aware files (code) use Git, not Dropbox.

### 13.11 What about quota enforcement?
- Per-user `quota_bytes_used` counter; updated on each upload.
- Async: dedup-aware counter (charge user once for shared blocks; not double-counted).
- Hard limit: reject upload at API gateway.

### 13.12 How does CDN serve blocks?
- CDN keys = block_hash. Immutable.
- Hot blocks (popular files) get cached at edge.
- Cold blocks: origin pull from S3.
- ~85% CDN hit rate → 6× origin egress reduction.

### 13.13 What about garbage collection of orphaned blocks?
- Refcount on each block.
- Increment on upload (new file references block).
- Decrement on file delete (after retention window).
- When refcount = 0 → schedule for deletion.
- Probabilistic: maintain refcount in BigQuery / Spark; eventual deletion.

### 13.14 How would you add file content search?
- On finalize: extract text (PDF/Word/HTML); send to ElasticSearch.
- Index per-user; multi-tenant.
- Cost: significant; Dropbox charges paid users for this.

### 13.15 How do you handle a 10 GB file upload over flaky WiFi?
- Chunk into 4 MB pieces.
- Each chunk has independent retry.
- Session state stored server-side; client polls `GET /sessions/{id}` to know what's left.
- Resume from any client; uploader doesn't need to be the same device.

### 13.16 How do you prevent abuse (sharing a 50 GB file with millions)?
- Share has owner; quota charged to owner regardless of share count.
- Public links rate-limited.
- Abuse signals: high-frequency share creation, link clicks from bot networks.

### 13.17 Cross-region replication strategy?
- Metadata: per-region primary, async cross-region replication for DR.
- Blocks: S3 cross-region replication (eventual ~minutes).
- Acceptable: a sync from a remote region may show old data for ~1 minute.

### 13.18 What if a block hash collides?
- SHA-256 collision is computationally infeasible (<2^128 work).
- For paranoia: re-verify by reading and comparing, but cost is high.
- Practical answer: trust SHA-256; use a stronger hash (SHA-512) if regulatory.

---

## 14. Common Follow-Ups

### 14.1 Mobile camera roll auto-upload
- Mobile client watches photo events.
- Background upload service.
- Bandwidth-aware: defer to WiFi.

### 14.2 Selective sync
- Per-folder flag in client config.
- Excluded folders skipped during sync.
- Server-side: shared with team; client decides what to download.

### 14.3 Public share links
- Short URL (TinyURL-style; see `url-shortener.md`).
- Permission: read-only or commentable.
- Revocable; expire-able.

### 14.4 Multi-region active-active
- Per-region writes; async cross-region replication.
- Conflict on cross-region edit: same conflict resolution as offline edit.

---

## 15. Cheat-Sheet Recap

1. **Problem:** Multi-device file sync at scale.
2. **Storage:** 4 MB content-addressable blocks; 60% dedup.
3. **Metadata:** Sharded SQL by user; cursor-based sync.
4. **Push:** Long-lived WebSocket per client.
5. **Conflict:** Rename on fork; no auto-merge.
6. **Throughput challenge:** 1.7M QPS metadata polls.
7. **Cost driver:** Storage; dedup is critical.

---

## Appendix A: Numbers worth remembering

```
Avg user storage     = 5 GB → 50 GB for power users
Block size           = 4 MB
Dedup ratio          ≈ 60% (cross-user)
S3 storage cost      ≈ $0.023/GB/month → $20/yr per active user
SHA-256 hash size    = 32 bytes
WebSocket capacity   = ~1M concurrent / server
```

## Appendix B: Compared to alternatives

```
                  Dropbox       Google Drive      OneDrive      iCloud
Block size       4 MB           varied            4 MB          16 MB
Dedup            cross-user     intra-user        intra-user    none
Encryption       server-side    server-side       server-side   server-side (E2E for some)
Conflict         rename         rename            rename        rename
Sharing          full           full              full          read-only public
```

---
title: Object & Blob Storage
---

# Object & Blob Storage — Deep Dive

> **Type:** Core technology
> **Tags:** `[storage]` `[s3]` `[blob]` `[media]` `[durability]`
> **Where it shows up:** [dropbox](../../HLD/dropbox.md), [youtube](../../HLD/youtube.md), [spotify](../../HLD/spotify.md), [google-docs](../../HLD/google-docs.md), and any system storing images/video/files/backups

---

## Mental model

Object storage (Amazon S3, Google Cloud Storage, Azure Blob) stores **large, immutable blobs** — images, video, audio, documents, backups, logs — as **objects in a flat namespace**, addressed by a key, retrieved over HTTP. It is not a filesystem (no real directories, no in-place edits) and not a database (no queries, no transactions). It's the place you put **bytes that are big and that you mostly read.**

The interview reflex: **never store large binary blobs in your database.** A 50 MB video in a row bloats the DB, wrecks its cache, and slows every query. Instead, **put the blob in object storage and store its URL/key in the database row.** Stating this split — metadata in the DB, bytes in object storage, often fronted by a [CDN](../Caching/cdn.md) — is the expected answer for any media-heavy system.

## Internals

### The object model

- An **object** = the blob + metadata + a unique **key**, living in a **bucket**.
- The "folder" structure (`photos/2024/cat.jpg`) is just a key prefix — the namespace is **flat**; prefixes are a listing convenience, not real directories.
- Access is over **HTTP(S)**: `GET`/`PUT`/`DELETE` by key. Objects are effectively **immutable** — you replace an object by overwriting the whole key, not editing in place. No appends, no partial updates (beyond multipart upload assembling one object).

### Durability & availability

- Object stores achieve famously high **durability** (S3 advertises "11 nines") by **replicating each object across multiple devices/availability zones** and using erasure coding. You treat stored objects as effectively never-lost.
- **Consistency:** modern S3 is **read-after-write consistent** for new objects (a `GET` right after a `PUT` returns the data); historically it was eventually consistent, a classic gotcha — know that overwrites/listings can still have subtle timing.

### Access patterns that matter in design

- **Presigned URLs** — the server generates a time-limited, signed URL granting a client direct `PUT`/`GET` to a specific object. This lets clients **upload/download directly to/from object storage without proxying bytes through your app servers** — essential for scale ([dropbox](../../HLD/dropbox.md), [youtube](../../HLD/youtube.md) uploads). The app only issues the URL and stores metadata.
- **Multipart upload** — split a large file into parts, upload in parallel, retry individual parts, then assemble. How you handle huge files and flaky networks.
- **CDN in front** — point a [CDN](../Caching/cdn.md) at the bucket so reads are served from the edge, not the origin store. Standard for media delivery.
- **Storage classes / lifecycle** — hot vs infrequent-access vs archive (Glacier) tiers, with lifecycle rules to move old objects to cheaper tiers automatically. Cost optimization for backups/logs.
- **Versioning & events** — keep object versions; emit events on write (e.g. trigger a transcode pipeline when a video lands).

## Tradeoffs & decisions

- **Cheap, durable, scalable bytes vs no query/transaction power** — you get effectively-infinite, very cheap, very durable storage, but you can't query *inside* objects or update them in place; metadata lives in a DB.
- **Latency vs throughput** — per-object latency is higher than a local disk/DB; throughput and parallelism are huge. Great for large sequential reads, poor for tiny random hot lookups (cache/DB those).
- **Immutability** — simplifies durability/caching but means "edit" = "rewrite the whole object."
- **Storage class vs retrieval cost/time** — archive tiers are far cheaper to store but slow/costly to retrieve; match the tier to access frequency.

## When to use / when not

**Use object storage for:**
- **Large media and files** — images, video, audio, user uploads, documents ([dropbox](../../HLD/dropbox.md), [youtube](../../HLD/youtube.md), [spotify](../../HLD/spotify.md)).
- **Backups, archives, data-lake/log storage**, and static website assets (often + [CDN](../Caching/cdn.md)).
- Anywhere you'd otherwise be tempted to put a big blob in a database — store it here, keep the URL in the row.

**Don't use it for:**
- **Small, frequently-updated, queryable records** — that's a [database](sql-relational.md)'s job (no queries, no transactions, no in-place edits here).
- **Low-latency hot key-value lookups** — use [Redis](../Caching/redis.md).
- **A filesystem needing real directories / partial writes / locking** — use a file/block store (see [file-system LLD](../../LLD/Go/file-system.md) for the FS model).

## Common interview follow-ups

- *"Where do you store the uploaded images/videos?"* → object storage; DB holds metadata + the object key/URL; serve via CDN.
- *"How do clients upload huge files without overloading your servers?"* → **presigned URLs** for direct-to-storage upload + **multipart** for large/flaky uploads; app servers never proxy the bytes.
- *"How durable is it / what if a disk dies?"* → multi-AZ replication + erasure coding → ~11 nines; treat objects as effectively never lost.
- *"How do you serve media fast globally?"* → CDN in front of the bucket; geo-routed edges ([cdn](../Caching/cdn.md), [dns](../Networking/dns.md)).
- *"How do you manage cost for old data?"* → lifecycle rules to tier hot → infrequent → archive.

## Gotchas

- **Blobs in the database** — the cardinal sin; bloats the DB, kills its cache, slows everything. URL in the row, bytes in object storage.
- **Proxying uploads/downloads through app servers** — wastes bandwidth and limits scale; use presigned URLs for direct transfer.
- **Treating it like a filesystem** — no real directories, no partial edits, no rename-is-cheap; "folders" are key prefixes.
- **Assuming strong consistency on overwrites/listings** — new-object read-after-write is consistent, but overwrite/list timing can surprise you.
- **Listing huge buckets** — `LIST` over millions of keys is slow/paginated; design keys/prefixes for the access pattern and keep an index in your DB.
- **Wrong storage class** — archive tiers are cheap to store but slow/expensive to retrieve; don't archive data you read often.

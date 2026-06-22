# Google Docs (Real-time Collaborative Editing) — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[realtime]` `[ot]` `[crdt]` `[merge]` `[websocket]`
> **Companies that ask this:** Google, Notion, Figma, Atlassian, Microsoft

---

## Beginner's Guide

### What's this in plain English?

Two people open the same Google Doc. Both type at the same time. Their changes appear on each other's screens immediately, with no conflicts. The doc never gets corrupted. The hard part: how do you handle concurrent edits to the same paragraph correctly, every time, even with network delays?

### Why solve it?

- **Real world**: Google Docs, Notion, Figma, Atlassian Confluence.
- **Teaches**: Operational Transformation (OT), Conflict-free Replicated Data Types (CRDTs), realtime sync.
- **Interview**: defining "real-time collaboration" question.

### Vocabulary

- **OT (Operational Transformation)** — algorithm to transform concurrent edits so they apply consistently regardless of order.
- **CRDT (Conflict-free Replicated Data Type)** — data structures designed so concurrent edits naturally merge (no central server needed).
- **Operation** — atomic edit (insert "x" at position 5, delete chars 10-12).
- **Convergence** — all clients eventually see the same state.
- **WebSocket** — long-lived bidirectional connection.

### High-level architecture

```
Client A edits → operation → Server (validates + sequences) → broadcast to other clients
Client B edits → operation → Server (transforms against pending ops) → broadcast
```

Two main approaches:

1. **OT (what Google Docs uses)**: A central server orders all operations. When clients send concurrent ops, the server transforms them so they make sense in sequence. Hard to implement correctly but proven.

2. **CRDT (newer; Figma, Notion)**: Each character has a unique ID. Operations are commutative — applying them in any order gives the same result. No central authority needed. Simpler reasoning but more memory.

### How to read this doc

- **Beginner**: focus on the OT vs CRDT trade-off conceptually.
- **Interview**: cross-questions on conflict resolution, offline editing, presence.

---

## 0. How to use this doc in an interview

Google Docs is **the** collaborative-editing question. Tests:
1. **Concurrent edit semantics** — two users typing in same paragraph simultaneously.
2. **OT vs CRDT** — both work; trade-offs differ.
3. **Server architecture** — central authority vs P2P.
4. **History / versioning** — operation log per doc.
5. **Cursor + presence.**

Trap: not knowing what OT or CRDT is. Even a 1-paragraph high-level explanation passes the bar.

---

## 1. Problem Statement

A document editor where:
- Multiple users edit the same document simultaneously.
- Edits propagate in real time (sub-second).
- Eventual consistency: all users converge to the same final document.
- Offline edits sync on reconnect.
- Edit history; undo/redo per user.
- Comments / suggestions.

---

## 2. Clarifying Questions

- [ ] Text only or rich (formatting, embedded media)?
- [ ] Concurrency limit per doc?
- [ ] Offline editing — required?
- [ ] Doc size cap?
- [ ] Algorithm — OT (Operational Transform) or CRDT?
- [ ] Permissions / sharing?
- [ ] Comments / suggestions in scope?

> **Assume:** rich text, ~100 concurrent editors typical (much higher possible), offline supported, 50 MB doc cap, OT (mature), permissions yes, comments yes.

---

## 3. Functional Requirements

**P0:**
1. Real-time edit propagation.
2. Offline editing; sync on reconnect.
3. Cursor + selection presence.
4. Undo/redo per user.
5. Conflict-free convergence (eventually all users see same doc).
6. Permissions (view, comment, edit).

**P1:**
7. Comments anchored to ranges.
8. Suggestions (track changes).
9. Version history; restore.

**P2:**
10. Embedded media.
11. Real-time collaborative diagrams (Figma-like).

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.99% |
| Edit propagation P99 | < 500 ms |
| Concurrency | 100s of concurrent editors |
| Convergence | Eventual; all clients reach same state |

---

## 5. Capacity Estimation

```
Active docs being edited concurrently: ~10M (across all users)
Each WS: ~1 KB heartbeat / sec idle
Concurrent connections: ~50M peak
Op rate per doc: 1-100 ops/sec when actively edited
Total op rate: 10M × 1 = 10M ops/sec at peak
```

---

## 6. API

```
WS /v1/docs/{doc_id}/connect
   client→server: {op_id, base_revision, op}
   server→client: {revision, op (transformed), author}

REST:
GET /v1/docs/{doc_id}              -> snapshot + revision number
POST /v1/docs/{doc_id}/comments
GET /v1/docs/{doc_id}/history
```

Op format (OT):
```
{ type: insert|delete|format,
  position: int,
  text: string?,
  length: int? }
```

---

## 7. Data Model

### Operations log (Cassandra / log-structured)
- `(doc_id, revision, op_id, user_id, op, ts)` — ordered by revision.
- Append-only; each accepted op increments doc's revision.

### Snapshots (S3 / blob)
- Periodic full-document snapshot (every 1000 ops).
- Speeds up bootstrap (don't replay millions of ops).

### Permissions (Postgres)
- `doc_permissions(doc_id, user_id, role)`

---

## 8. Architecture

```
                ┌───────────────────────────┐
                │    Web/Desktop clients    │
                └──────────┬────────────────┘
                           │ WS
                           ▼
                ┌───────────────────────────┐
                │   Doc Servers (sticky)    │
                │  - one server per doc     │
                │    holds OT state         │
                │  - in-memory revision N   │
                │  - all editors connect    │
                │    to same server         │
                └──────────┬────────────────┘
                           │
                           ▼
                ┌───────────────────────────┐
                │   Operations Log          │
                │   (Cassandra)             │
                └──────────┬────────────────┘
                           │
                           ▼
                ┌───────────────────────────┐
                │   Snapshot Store          │
                │   (S3) every 1000 ops     │
                └───────────────────────────┘

      ┌───────────────────────────┐
      │   Permissions Svc          │ → Postgres
      └───────────────────────────┘
```

### Edit flow (OT)
```
1. Client A makes local edit (insert "hello" at pos 5).
2. Client A sends op + base_revision (5) to server.
3. Server compares against current revision (say 7 — A is behind).
4. Server transforms A's op against ops at rev 6 and 7. Gets new op.
5. Server applies; revision becomes 8.
6. Server broadcasts (rev 8, transformed op) to all connected clients.
7. Client A receives ack; updates local revision.
8. Other clients receive op; transform against their pending local ops; apply.
```

---

## 9. Component Deep-Dives

### 9.1 OT (Operational Transform)
- Each op is transformed against concurrent ops to preserve user intent.
- Server is the source of truth — single ordering authority.
- Client never sees out-of-order ops; server resolves.
- Mature: Google Docs, Etherpad use this.

### 9.2 CRDT (alternative)
- Each op carries a unique ID + Lamport timestamp.
- Clients merge ops independently; deterministic resolution.
- No central server needed.
- Used in Yjs, Automerge, Figma.

### 9.3 Doc server (sticky)
- One doc → one server (consistent hash).
- All editors of a doc connect to same server (LB sticky routing).
- Server holds in-memory: current text, revision, pending ops.
- Failover: another server takes over; replays from snapshot + ops.

### 9.4 Snapshots
- Every 1000 ops: capture full doc → S3.
- New client bootstrap: load latest snapshot + replay ops since.
- Without snapshots: a doc with 1M ops would take forever to load.

### 9.5 Presence (cursors)
- Out-of-band channel (separate WS topic).
- Each client publishes cursor position; server fan-outs to others.
- Lossy; not stored.

---

## 10. Hard Sub-Problems

### 10.1 OT correctness
The hard math: given 2 concurrent ops, produce 2 transformed versions such that applying them in either order gives the same result (TP1 / TP2 properties).

For text: insert/delete pair has well-defined transforms. Format ops are trickier.

### 10.2 Offline edits
Client buffers ops locally with base_revision = last known.
On reconnect: send queued ops; server transforms each against accepted ops since base.
If conflict can't resolve: fall back to "your version" + diff prompt (rare for text; common for tables).

### 10.3 Large docs
50 MB doc with millions of ops — server can't hold full history in memory.
Snapshot every 1000 ops → bootstrap = latest snapshot + replay tail.

### 10.4 Single-server bottleneck per doc
- One doc, one server: viral doc could overload one server.
- Mitigation: doc partitioning (e.g. one paragraph per shard) — complex; rarely worth it.
- Most docs are small/medium; central server fine.

---

## 11. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| OT (server-authoritative) | Simple model | Server is bottleneck per doc |
| Sticky doc routing | Consistency | Failover requires reconnect |
| Snapshots every 1000 ops | Fast bootstrap | Storage cost |
| Eventual consistency (presence) | Cheap | Cursor positions slightly stale |
| Single server per doc | Easy ordering | No horizontal scale per doc |

---

## 12. Cross-Questions ≥ 12

### 12.1 Why OT and not CRDT?
- OT: server-authoritative; simpler debug; smaller payload (no per-op metadata).
- CRDT: server-optional; handles long offline well; bigger payload (each op carries metadata).
- Mature products (Google Docs, Etherpad) use OT.
- New products (Yjs, Automerge, Figma) often use CRDT for offline-first.

### 12.2 Why sticky doc routing?
Server holds in-memory revision counter. Routing the same doc to different servers requires coordination (Raft) — slower.

### 12.3 What if the doc server crashes mid-edit?
- Last accepted op is in Cassandra.
- New server picks up; resumes from log.
- Clients reconnect; resync from server's revision.

### 12.4 How big can a doc get?
- 50 MB cap typical (Google).
- Larger docs partition by section (e.g. per chapter).

### 12.5 How does undo work?
- Client logs its own ops.
- Undo = inverse op + send to server.
- Server transforms inverse against subsequent ops (other authors).

### 12.6 What about formatting ops?
- Format = "apply bold to range 5-10."
- Transforms: if a delete shrinks the range, format range narrows accordingly.
- More complex than insert/delete; battle-tested rules.

### 12.7 How do permissions work?
- On WS connect: server checks `doc_permissions`.
- Edit ops accepted only if user has edit role.
- Comments allowed for commenters.

### 12.8 What about images / embeds?
- Image is a single op (insert image at position).
- Server stores the image URL; image content in S3.
- Resize / crop edits are separate ops on the image's metadata.

### 12.9 How does compose / suggest mode work?
- Suggestions = ops with `suggested=true` flag.
- Doc display layer renders them differently.
- Author accepts → flag flips; doc state changes.

### 12.10 Cross-region collaboration?
- Per-region doc servers; sticky.
- Cross-region edit: route to doc's home region.
- Latency: 150ms cross-region; acceptable.
- For active collaborators, prefer same region.

### 12.11 What about a 10000-person live document?
- Single server is bottleneck.
- Optimization: rate-limit non-editors (read-only viewers).
- For viewing only: pull snapshot + tail; no WS overhead.
- Active editors: ~50 max practical.

### 12.12 What's the failure mode under network partition?
- Client buffers ops; sees stale.
- On reconnect: server transforms queued ops; client gets all transformed ops back.
- May see "this section was edited by someone else" reordering.

---

## 13. Cheat-Sheet

1. **OT** = server-authoritative ordering; transforms concurrent ops.
2. **One doc, one server** (sticky); in-memory revision counter.
3. **Op log** in Cassandra; snapshots every 1000 ops to S3.
4. **Presence** out-of-band; lossy.
5. **Offline**: buffer ops; reconnect; transform.
6. **Mature alt**: CRDTs (Yjs, Automerge) for offline-first apps.

---

## Appendix A: OT vs CRDT cheat-sheet

```
                OT                    CRDT
Author          Google Docs          Yjs, Figma
Server          Required (auth.)      Optional
Payload size    Small                 Bigger (per-op metadata)
Offline         Possible              Trivial
Complex ops     Hand-tuned transforms Built-in commutativity
History         Linear (op log)       DAG
```

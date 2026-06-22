# Online Auction (eBay) — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[bidding]` `[ordering]` `[anti-snipe]` `[realtime]`
> **Companies that ask this:** eBay, Sotheby's, OpenSea (NFT), Mercari

---

## Beginner's Guide

### What's this in plain English?

eBay. Item with end time. People bid. Highest bid at end time wins. The hard part: **at the closing second, 1000 bids land in milliseconds.** Whose bid won? They all need a definitive total order. Plus anti-snipe: extend if a bid arrives at second 59:59.

### Why solve it?

- **Real world**: eBay, Sotheby's, government surplus auctions, NFT marketplaces.
- **Teaches**: strict ordering, realtime distribution, race conditions at close, anti-snipe.

### Vocabulary

- **Bid** — offer of an amount.
- **Reserve price** — minimum acceptable.
- **Anti-snipe** — extend close time if late bid arrives.
- **Order** — strict sequence of bids; ties broken by timestamp.
- **Last-look auction** — variant where seller has final review.

### High-level architecture

```
Bidder → Bid Service (per-auction lock) → Auction State + Bid Log
                ↓
           Live updates → All watchers (WebSocket)
                ↓
           At close time → declare winner → notify
```

Components:
1. **Bid validation** — > current bid + increment? Auction still open?
2. **Per-auction lock** — only one bid mutates state at a time.
3. **Live distribution** — websocket broadcast of new high bid.
4. **Close** — scheduled job; declare winner; notify; payment.
5. **Anti-snipe** — bid in last 30s → extend by 30s.

Sharding: one auction → one node (per-auction lock is local); horizontal scale across many auctions.

### How to read this doc

- **Beginner**: focus on the per-auction lock + close logic.
- **Interview**: cross-questions on bid history, payment, fraud.

---

## 0. How to use this doc in an interview

Auction tests **strict ordering + realtime + close-time race**. Trap: not handling the closing-second flurry where 1000 bids land at second 59:59.

---

## 1. Problem Statement

An auction site:
- Sellers list items with start price, reserve, end time.
- Bidders place bids during the auction.
- Highest valid bid at end wins.
- Real-time bid updates to all viewers.
- Anti-snipe: extending auction by N min on last-second bid.

---

## 2. Clarifying Questions

- [ ] Auction types: English (open ascending), Dutch, sealed?
- [ ] Buyout / Buy-It-Now?
- [ ] Min bid increment?
- [ ] Anti-snipe / time extension?
- [ ] Proxy bidding (max bid set by user, system bids up incrementally)?
- [ ] Reserves visible?

> **Assume:** English ascending; Buy-It-Now optional; min increment per item; anti-snipe yes; proxy bidding yes; reserve hidden.

---

## 3. Functional Requirements

**P0:**
1. List item, set start/end, reserve.
2. Place bid; reject if invalid.
3. Real-time push of new highest bid to all viewers.
4. Auction end determines winner.
5. Proxy bidding (max bid; system bids up automatically).
6. Anti-snipe (extend on last-second bid).
7. Buy-It-Now option.

**P1:**
8. Bid history.
9. Watch list.

**P2:**
10. Auto-suggest similar items.
11. Cross-region delivery.

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.99% |
| Bid acceptance latency | < 200 ms |
| Push to viewers | < 1 s |
| Strict ordering | First-arrived bid wins ties |
| Resilience | No bid lost during failover |

---

## 5. Capacity Estimation

```
Active auctions: 100M
Bids/sec sustained: 10k
End-of-auction spike: 1k bids/sec on a hot item
Concurrent viewers: 10M
```

---

## 6. API

```
GET /v1/items/{id}                       -> item + current bid
POST /v1/items/{id}/bids  body: amount   -> {accepted, current_high}
WS /v1/items/{id}/subscribe              push: new bid notifications
POST /v1/items/{id}/buy-it-now
```

---

## 7. Data Model

### Items (Postgres)
- `(item_id, seller_id, title, start_price, reserve, current_bid, current_bidder, end_time, status)`

### Bids (Cassandra, partitioned by item_id, clustered by ts)
- `(item_id, ts, bid_id, bidder_id, amount, accepted)`

### Auction state (Redis hot)
- `auction:{id}:current` → current high bid info (cached for sub-ms read).
- `auction:{id}:end_time` → for anti-snipe tracking.

---

## 8. Architecture

```
              ┌──────────────────────┐
              │  Bidders / Viewers   │
              └──────────┬───────────┘
                         │
                         ▼
                ┌───────────────────┐
                │   API Gateway     │
                └────┬──────────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
  ┌──────────────┐        ┌──────────────┐
  │ Bid Svc      │        │ Browse Svc   │
  │ - validate   │        │              │
  │ - update top │        └──────────────┘
  │ - notify     │
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐         ┌──────────────┐
  │ Redis (hot)  │         │ Cassandra    │
  │ + lock per   │         │ all bids     │
  │   item       │         │              │
  └──────┬───────┘         └──────────────┘
         │
         ▼
  ┌──────────────┐
  │ WS Push Svc  │
  │ (per item    │
  │  topic)      │
  └──────────────┘
```

---

## 9. Component Deep-Dives

### 9.1 Bid acceptance
- Validate: amount ≥ current + min increment.
- Per-item Redis lock (or atomic Lua).
- Atomic: read current; check; update if new is higher.
- Persist to Cassandra; emit event.

### 9.2 Real-time push to viewers
- Per-item WS topic.
- Subscribers receive new high bid.
- Pub/sub via Redis or Kafka.

### 9.3 Proxy bidding
- User sets max_bid (e.g. $100).
- System bids on user's behalf incrementally up to max.
- Stored as separate "auto-bid agent" per user per item.
- When new bid comes: check all auto-bid agents; outbid if necessary.

### 9.4 Anti-snipe
- Last bid within last 2 min → extend end_time by 2 min.
- Repeats until 2 min passes without bid.

### 9.5 Auction close
- Scheduler triggers at end_time.
- Final state captured.
- Winner notified; payment flow initiated.

---

## 10. Hard Sub-Problems

### 10.1 Closing-second race
- 100 bids in last 1 second on hot item.
- Per-item lock serializes; ~50 ms each = 5 sec to drain queue.
- Anti-snipe extends end → wait queue still processed.

### 10.2 Order guarantees
- First-arrived wins ties.
- Single source of truth: Redis lock.
- Deterministic ordering.

### 10.3 Proxy bidding correctness
- New bid arrives; auto-bid agents in proxy registry must each evaluate and possibly bid.
- Sequential; iterative; settles when no agent wants to bid more.

### 10.4 Failover during bid
- Bid received; not yet persisted; node dies.
- Client retries idempotently (using bid_id).
- Cassandra dedup; outcome same.

---

## 11. Cross-Questions ≥ 12

### 11.1 Why per-item lock?
- All bid validation must be atomic.
- Across items, parallel.
- Lock granularity = item.

### 11.2 What if Redis lock node dies?
- Replication; failover.
- Brief gap; bids retry.

### 11.3 How is "first-arrived wins" guaranteed?
- Lock acquisition order = arrival order at Redis primary.
- Within sub-ms tolerance (network jitter).

### 11.4 What about clock drift on extension?
- Server-authoritative time.
- Client display syncs from server (not local clock).

### 11.5 Why anti-snipe?
- Without: last-second bots win (sniping).
- With: every bid extends; legitimate competition continues.

### 11.6 Proxy bidding edge case: two users with overlapping max bids?
- A: max $100. B: max $90.
- B places $50; system auto-bids on A's behalf to $51.
- B sees $51, considers their $90 max → bids $52.
- System auto-bids A to $53.
- Iterates; ends at $91 (one above B's max + increment).

### 11.7 What about reserve price?
- Hidden minimum.
- If end without exceeding reserve → no winner; relisted.

### 11.8 Buy-It-Now logic?
- Special API; ends auction immediately if BIN clicked.
- Locks item; processes payment; closes.

### 11.9 What about fraudulent bids (shill bidding)?
- Detect: same network as seller; pattern of withdrawing.
- Block accounts.

### 11.10 How is winner notified?
- After end: push notification + email.
- Payment flow initiated.

### 11.11 What about non-payment by winner?
- Re-list item.
- Strike against winner's account.

### 11.12 Cross-region delivery?
- Per-region auction routing (lower latency).
- Bid replication cross-region for global view.
- Trade: cross-region viewers have ~150ms staleness.

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| Per-item Redis lock | Strict order | Latency on hot items |
| Anti-snipe | Fairness | Auctions can extend long |
| Proxy bidding | UX | Complex auto-bid logic |
| WS push | Real-time | Connection state |

---

## 13. Cheat-Sheet

1. **Per-item lock** for atomic bid acceptance.
2. **Cassandra** for full bid log.
3. **Redis** for current high + lock.
4. **WS push** per-item topic.
5. **Proxy bidding** as auto-agents.
6. **Anti-snipe** = extend on last-N-min bid.

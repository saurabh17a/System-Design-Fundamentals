# Ticketmaster (High-Demand Ticket Sales) — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[concurrency]` `[reservation]` `[anti-bot]` `[hot-event]` `[queue]`
> **Companies that ask this:** Ticketmaster, StubHub, BookMyShow at concert scale, Eventbrite, Live Nation

---

## Beginner's Guide

### What's this in plain English?

Taylor Swift's tour goes on sale. 3 million people hit refresh at exactly 10am. There are 200k seats. The system has to: handle the stampede without falling over; assign each seat to exactly one person; reject bots; serve a fair queue. This is "movie ticket booking" but at terrifying scale.

### Why solve it?

- **Real world**: Ticketmaster, StubHub, BookMyShow at concert scale.
- **Teaches**: hot-event handling, virtual queues, anti-bot, reservation with idempotency.

### Vocabulary

- **Hot event** — sudden traffic spike (concert on-sale).
- **Virtual waiting room** — queue users in a holding pen so backends don't get crushed.
- **Hold** — temporary reservation while user pays.
- **Anti-bot** — CAPTCHAs, throttling per IP, behavioral checks.
- **Idempotency** — retries don't double-book.

### High-level architecture

```
Users → CDN → Virtual Queue (admit N/sec) → Reservation Service → Payment → Confirm
                                                  ↓
                                        Seat inventory + per-seat lock
```

Components:
1. **Virtual queue** — when load surges, throw users into a waiting room; admit at controlled rate.
2. **Reservation** — atomic seat hold; expiry typically 8 minutes.
3. **Payment** — idempotent; on success, confirm.
4. **Anti-bot** — CAPTCHA, fingerprint, rate-limit by IP.
5. **Inventory** — partitioned by show; per-seat or per-section locks.

The virtual queue is the killer feature — without it, the database melts.

### How to read this doc

- **Beginner**: focus on the queue + hold concept.
- **Interview**: cross-questions on bots, fairness, abandoned holds, secondary market.

---

## 0. How to use this doc in an interview

Ticketmaster shares DNA with the LLD `movie-ticket-booking` doc but at **internet scale with thundering herd**. Tests:
1. **Hot-event problem** — Taylor Swift drops 200k seats; 3M users hit "buy" simultaneously.
2. **Virtual queue** — let only N users into purchase flow at once; rest wait.
3. **Anti-bot** — captchas, rate limits, behavioral analysis.
4. **Atomic seat reservation** at this scale.
5. **Resale marketplace.**

Trap: thinking it's just movie booking with more seats. The hot-event drop is a unique scaling problem.

---

## 1. Problem Statement

A platform for buying tickets:
- Browse events.
- Pick seats from a venue map.
- Pay; receive tickets.
- Some events have unlimited demand vs limited supply (concerts) — viral.
- Resale: holders sell their tickets.

---

## 2. Clarifying Questions

- [ ] Reserved seating only or general admission?
- [ ] Resale marketplace?
- [ ] Multi-event vendors (festivals)?
- [ ] Hard concurrency: 5M users in queue for one event?
- [ ] Anti-bot strict?
- [ ] Refunds / transfers?

> **Assume:** reserved seating; resale yes; multi-event; super-hot events (5M concurrent for popular drops); strict anti-bot; refunds + transfers.

---

## 3. Functional Requirements

**P0:**
1. Browse events.
2. Virtual queue for hot events.
3. Seat selection from venue map.
4. Hold + payment + confirm (two-phase like LLD).
5. Ticket delivery (QR / wallet).
6. Anti-bot pre-queue.
7. Refunds, transfers.
8. Resale marketplace.

**P1:**
9. Verified-fan presales.
10. Dynamic pricing.

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.99% |
| Hot-event throughput | 50k+ purchases/min sustained for first hour |
| Queue latency | < 30s queue position update |
| Atomic seat | Strict — never sell same seat twice |

---

## 5. Capacity Estimation

```
Big drop: 5M concurrent users hitting "buy"
Available seats: 200k
Even if 100% buy success: 200k transactions in 30 min
Realistic: 50k purchases/min for hot windows
Browse / queue traffic: 5M sessions; ~200k QPS sustained for hours
```

---

## 6. API

```
GET /v1/events/{id}                       (always cached)
POST /v1/events/{id}/queue                  -> {position, eta}
GET  /v1/queue/me                           -> {position, ready: bool}
POST /v1/events/{id}/holds  body: seats     -> hold + 8 min timer
POST /v1/holds/{id}/confirm                 (idempotent, with payment_token)
GET  /v1/tickets/me
POST /v1/listings                          (resale)
```

---

## 7. Data Model

### Events (Postgres)
- `events(id, venue_id, datetime, on_sale_at)`
- `seats(event_id, section, row, num, status)`

### Queue (Redis)
- `queue:event:{id}` → ZSET; member = user; score = enqueue ts.
- Per-event capacity counter.

### Holds + tickets (Cassandra)
- Same as LLD `movie-ticket-booking.md`.

---

## 8. Architecture

```
                ┌──────────────────────┐
                │  Users (web/mobile)  │
                └──────────┬───────────┘
                           │
                ┌──────────▼─────────┐
                │   CDN              │ (browse pages cached)
                └──────────┬─────────┘
                           │
                ┌──────────▼─────────┐
                │   API Gateway      │
                │   - rate limit     │
                │   - WAF            │
                │   - bot detection  │
                └──────────┬─────────┘
                           │
                  ┌────────┼─────────┐
                  ▼        ▼         ▼
           ┌──────────┐ ┌──────────┐ ┌────────────┐
           │ Browse   │ │ Queue Svc│ │ Booking Svc│
           │ Svc      │ │          │ │            │
           └──────────┘ └────┬─────┘ └─────┬──────┘
                             │             │
                             ▼             ▼
                       ┌──────────┐  ┌──────────┐
                       │  Redis   │  │ Cassandra│
                       │  queue   │  │ seats    │
                       └──────────┘  └──────────┘

           ┌──────────────────────┐
           │  Payment Gateway     │
           └──────────────────────┘
```

---

## 9. Component Deep-Dives

### 9.1 Virtual queue
- User clicks "buy" → enqueued in Redis ZSET.
- Position visible; estimated wait shown.
- Fixed N concurrent purchasers; new spots open as users finish/abandon.
- Bypass abuse: pre-queue captcha, bot detection.

### 9.2 Seat reservation (atomic)
- Same as LLD pattern: hold → confirm.
- For hot event: per-section locks (one section per Redis instance).
- 200k seats in 100 sections = 2k per section → manageable contention.

### 9.3 Anti-bot
- pre-queue: captcha, behavioral signals.
- Account verification (email, phone).
- Limit per account/IP.
- Verified-fan registration ahead of drop.

### 9.4 Resale
- Listing: holder lists ticket at price.
- Buyer browses; pays; transfer to buyer.
- Anti-fraud: verify holder, escrow.

---

## 10. Hard Sub-Problems

### 10.1 5M concurrent at drop time
- Pre-queue throttle: only N enter queue per second.
- Static pages (event info, venue map) on CDN.
- API rate limits aggressive.
- No-cache only for purchase flow.

### 10.2 Bot prevention
- pre-queue captcha (hCaptcha, Cloudflare Turnstile).
- Account history scoring.
- Behavioral detection (mouse patterns).
- Verified fan: pre-registration with phone verification.

### 10.3 Queue fairness
- ZSET sorted by enqueue ts.
- Bot account that joins queue many times: rate limited per IP+account.
- VIP/verified fans: separate priority queue.

### 10.4 Refunds + transfers
- Ticket → has owner.
- Transfer: owner relinquishes; new owner takes.
- Refund: ticket cancelled; seat returns to event pool.

---

## 11. Cross-Questions ≥ 12

### 11.1 Why a virtual queue?
- Without: 5M users hammer purchase API → DB melts.
- With: 50k concurrent buyers; rest wait politely.
- Standard pattern (Cloudflare's "Waiting Room" feature).

### 11.2 How is queue position fair?
- ZSET timestamp ordered by enqueue.
- New entrants get back of queue.
- Bots can't jump unless they passed prior gates.

### 11.3 Why not just rate limit users hitting purchase API?
- Rate limit is anonymous; queue is per-user.
- Queue gives UX feedback (your position, wait estimate).
- Rate limit just rejects — terrible UX at scale.

### 11.4 How does seat selection scale?
- Venue map cached on CDN.
- Real-time seat status: WS push from server when seats become unavailable.
- 200k seats × N watchers = 200k × N updates. Mitigation: subscribe to viewed sections only.

### 11.5 How is hold prevented from race?
- Same as LLD: per-show (per-event) lock during verify-and-hold transaction.
- Per-section locks for finer concurrency.

### 11.6 How is payment integrated?
- Holds for 8 min; user pays externally.
- Confirm with payment_token. Idempotent.
- Same pattern as movie booking.

### 11.7 What about resale fraud?
- Verified ticket transfer through platform; QR regenerated.
- Off-platform sales: counterfeit risk (handled via mobile-only delivery, dynamic QR).

### 11.8 What about face-value caps on resale?
- Local laws vary.
- Per-region rules; platform enforces.

### 11.9 Why pre-queue captcha?
- Reduces bot purchases.
- Trade: real users have friction.
- Better than seat-grabbing bots.

### 11.10 Verified fan?
- Pre-register with phone + match credit card.
- Get unique link for early access.
- Stops scalpers.

### 11.11 What if queue blows past 30 min wait?
- Honest UX: "Estimated wait > 30 min."
- Some leave.
- Pricing tier: VIP queues with paid jump.

### 11.12 What about post-event analysis?
- Ticket scans at gate → real-attendance data.
- Resale reconciliation.
- Fraud detection.

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| Virtual queue | DB protected from herd | UX delay |
| Per-section lock | Concurrency | Code complexity |
| Captcha pre-queue | Fewer bots | Some legit users frustrated |
| Mobile-only QR | Resale control | Some users prefer paper |

---

## 13. Cheat-Sheet

1. **Virtual queue** (ZSET) limits concurrent buyers.
2. **Two-phase hold + confirm** (idempotent).
3. **Per-section lock** for atomic seat hold.
4. **CDN** cache static pages.
5. **Anti-bot** captcha + verified fan + rate limits.
6. **Resale** with dynamic QR; on-platform transfers only.

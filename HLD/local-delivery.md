# Local Delivery Service (DoorDash / Swiggy / Zomato) — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[geospatial]` `[3-sided-marketplace]` `[matching]` `[batching]`
> **Companies that ask this:** DoorDash, Swiggy, Zomato, Uber Eats, Grab, Instacart

---

## Beginner's Guide

### What's this in plain English?

DoorDash. You order food. The system: tells the restaurant; finds a courier; courier picks up; delivers to you. **Three** parties (customer, restaurant, courier), not two like Uber. Food has prep time. Couriers can batch multiple orders. Restaurants have variable cook times. It's a 3-sided marketplace.

### Why solve it?

- **Real world**: DoorDash, Swiggy, Zomato, Uber Eats, Grab, Instacart.
- **Teaches**: 3-sided marketplaces, batching, geospatial matching with prep-time constraints.

### Vocabulary

- **3-sided marketplace** — three parties; matching is harder than 2-sided.
- **Batching** — courier picks up multiple orders going to nearby drop-offs.
- **ETA** — to restaurant, then to customer.
- **Order state** — PLACED → ACCEPTED → COOKING → READY → PICKED_UP → DELIVERED.

### High-level architecture

```
Customer → Order Service → Restaurant API
                ↓
            Dispatcher (geo + time aware) → Courier App
                ↓
            Tracking → Customer (live map)
```

Components:
1. **Order management** — customer places order; restaurant accepts; status updates.
2. **Dispatcher** — given prep time + courier locations + delivery window, pick a courier and possibly batch orders.
3. **Geo-index** — couriers' positions in real time.
4. **Tracking** — live ETA + map for customer.
5. **Pricing** — base fee + surge + tips.

Optimization: batching reduces costs but adds delay. Prep time prediction adjusts when to dispatch.

### How to read this doc

- **Beginner**: focus on the 3 parties + dispatching.
- **Interview**: batching algorithms, surge, prep-time prediction.

---

## 0. How to use this doc in an interview

Local delivery is **3-sided** (customer ↔ merchant ↔ courier), unlike Uber (2-sided). Tests:
1. Three async actors with different state machines.
2. Order batching (one courier carries 3 orders).
3. ETA = prep time + travel time + queueing.
4. Real-time tracking from kitchen to door.

Borrow from Uber for spatial; add merchant + batching layers.

---

## 1. Problem Statement

A delivery platform:
- Customer browses menus, places order with merchant.
- Merchant accepts; prepares.
- Courier picks up; delivers to customer.
- All parties tracked in real time; status updates.
- Ratings post-delivery.

---

## 2. Clarifying Questions

- [ ] Single city or global?
- [ ] Restaurants only or general retail (groceries)?
- [ ] Self-delivery (partner's own couriers) or platform fleet?
- [ ] Batching multiple orders per courier?
- [ ] Pre-orders (lunch booked at 8 AM)?

> **Assume:** global; restaurants + groceries; platform fleet; batching enabled; pre-orders supported.

---

## 3. Functional Requirements

**P0:**
1. Browse merchants by location.
2. Place order with merchant.
3. Merchant accept + start preparing.
4. Match courier when ready.
5. Track all 3 parties.
6. Confirm delivery.
7. Payment + rating.

**P1:**
8. Order batching (1 courier, 2-3 orders).
9. Live ETA updates.
10. Tip courier post-delivery.

**P2:**
11. Pre-scheduled orders.
12. Subscription tiers.
13. Group orders.

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.99% |
| Match latency | < 30 s order ready → courier assigned |
| Live ETA accuracy | ±2 min |
| End-to-end | 25–45 min typical |

---

## 5. Capacity Estimation

```
Active markets: 10k cities
Active orders: 1M concurrent peak
Couriers: 500k
Restaurants: 1M
Order rate: 100k orders/min peak
Location updates (couriers): 200k QPS (5s intervals)
```

---

## 6. API

```
# Customer
GET  /v1/merchants?lat=&lng=               -> list
POST /v1/orders                             -> order_id
GET  /v1/orders/{id}                        -> status, ETA, courier loc

# Merchant
PUT  /v1/orders/{id}/accept
PUT  /v1/orders/{id}/ready_for_pickup

# Courier
GET  /v1/courier/me/offers                  (push via WS)
PUT  /v1/courier/me/state                   (online, offline, picked_up, delivered)
POST /v1/courier/me/location
```

---

## 7. Data Model

### Orders (Cassandra, partitioned by customer_id)
- `(customer_id, order_id, ts, status, merchant_id, courier_id, items, fare)`

### Merchants (Postgres)
- profile, menu, location, prep time, status (open/closed/busy).

### Couriers (similar to Uber drivers)
- Hot: Redis H3 cells. Cold: Postgres for profile.

### Order state machine
```
NEW → MERCHANT_ACCEPTED → PREPARING → READY → COURIER_ASSIGNED → 
PICKED_UP → EN_ROUTE → DELIVERED
```

---

## 8. Architecture

```
                ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
                │   Customer   │  │   Merchant   │  │   Courier    │
                └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
                       │                 │                 │
                       └─────────┬───────┘                 │
                                 ▼                          │
                ┌────────────────────────────────┐          │
                │   API Gateway / LB             │          │
                └────────┬───────────────────────┘          │
                         │                                   │
         ┌───────────────┴───────────┬────────────────────┐  │
         ▼                           ▼                    ▼  ▼
    ┌─────────────┐     ┌─────────────┐    ┌─────────────────────┐
    │ Order Svc   │     │ Merchant    │    │ Courier Match Svc   │
    │ (state mc)  │     │   Svc       │    │ (similar to Uber)   │
    └──────┬──────┘     └─────────────┘    └─────────┬───────────┘
           │                                          │
           ▼                                          ▼
    ┌──────────────────┐                    ┌──────────────────┐
    │ Cassandra        │                    │ Redis (couriers) │
    └──────────────────┘                    └──────────────────┘
                       ┌──────────────────┐
                       │ ETA Svc (ML)     │
                       └──────────────────┘
                       ┌──────────────────┐
                       │ Notification Svc │
                       └──────────────────┘
```

---

## 9. Component Deep-Dives

### 9.1 Order state machine
- Centralized in Order Svc.
- Each transition triggers events: notifications, ETA recompute, assignment.
- Persisted on every transition.

### 9.2 Courier matching
- Same H3 spatial pattern as Uber.
- Trigger: order in `READY` state.
- Filter: idle couriers in radius; rated above threshold.
- Score: distance, rating, batching opportunity (does this courier already have an order in this direction?).

### 9.3 Batching
- Two orders heading same direction can share a courier.
- Pre-fetch optimization: if courier 5 min from merchant A and merchant B is en-route → bundle.
- Trade: longer delivery time vs more revenue per courier.

### 9.4 ETA prediction
- Components:
  - Merchant prep time (per-merchant historical).
  - Travel time merchant→customer (Maps API or in-house routing).
  - Courier queue (currently busy with another order?).
- Updated every minute.
- ML model with weather, time-of-day, special events.

### 9.5 Live tracking
- Each party's app shows the others' state.
- Customer sees: order placed, accepted, preparing, picked up, ETA.
- Courier sees: pickup pin, drop pin, route.
- WS push from each side.

---

## 10. Hard Sub-Problems

### 10.1 ETA accuracy
- Customer satisfaction tied to ETA accuracy.
- Real-time recompute after every state change.
- Shows confidence interval (±2 min) not point estimate.

### 10.2 Surge / busy mode
- Restaurant marks "kitchen busy" → adds prep time.
- Region-wide demand spike → wait time grows; surge fee on customer.

### 10.3 Cancellations
- Customer cancel before merchant accept: free.
- After accept, before pickup: customer pays partial.
- After pickup: rare; customer pays full + courier compensated.

### 10.4 Delivery to apartment / wrong address
- Photo confirmation at drop.
- "Contactless" toggle.
- Phone-call backup.

---

## 11. Cross-Questions ≥ 12

### 11.1 What's different from Uber?
- 3-sided (merchant adds prep time).
- Batching common.
- Static merchant pickup point (not customer-driven origin).
- Order has fixed value; surge is on delivery fee not ride fare.

### 11.2 How does batching decision work?
- ML scores: solo delivery cost vs batch cost (extra time on order 1, time saved on order 2).
- Bundle if total customer wait increase < 5 min.

### 11.3 Why not assign courier before order ready?
- Courier idle waiting at restaurant = bad UX.
- Match when 5 min before ready; courier arrives just-in-time.

### 11.4 What about merchant capacity?
- Merchant has "kitchen capacity" (orders/hour).
- When at capacity: marked busy; new orders queue or rejected.

### 11.5 How is the menu kept current?
- Merchant POS integration → real-time stock updates.
- Stale menu = customer orders something not available; courier returns / refunds.

### 11.6 What about cold chain (groceries)?
- Insulated bags (operational).
- Temperature monitoring (advanced).
- Delivery time SLA stricter.

### 11.7 How do you handle a viral merchant (1000 orders queued)?
- Queue gracefully; surface "60 min wait" to customer.
- Auto-suspend new orders if queue too long.

### 11.8 What happens if courier disappears mid-delivery?
- Detect via location stale + customer not delivered.
- Reassign to another courier.
- Or refund customer + investigate courier.

### 11.9 Cross-merchant orders (group order)?
- Multiple merchants in one delivery.
- Single courier picks all up; one drop.
- Coordination: each merchant ready at staggered times.

### 11.10 What about delivery quality issues?
- Photo at drop (proof).
- Customer reports → review by ops.
- Refund + courier rating impact.

### 11.11 How do you handle peak hours (lunch, dinner)?
- Surge fee.
- Pre-orders shifted to off-peak.
- Marketing nudges.
- Add fleet capacity (driver bonuses).

### 11.12 Cross-region operations?
- Per-city / per-region service.
- Drivers tied to home region.
- No inter-region delivery typically.

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| Match when ready (not on order) | Courier doesn't wait | Risk of no courier when ready |
| Batching | Higher courier utilization | Marginal customer wait |
| Per-region matching | Fast | No cross-region |
| ETA recompute every min | Accurate | Compute cost |

---

## 13. Cheat-Sheet

1. **3 actors:** customer, merchant, courier — each with state machine.
2. **H3 spatial** for courier matching (like Uber).
3. **Match when order is ready** (not at order time).
4. **Batching** for courier efficiency.
5. **ETA = prep + travel + queue** (ML-predicted).
6. **WS** for live tracking on all 3 sides.

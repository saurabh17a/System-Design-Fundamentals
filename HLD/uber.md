# Uber / Lyft (Ride Hailing) — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[geospatial]` `[matching]` `[realtime]` `[surge]`
> **Companies that ask this:** Uber, Lyft, DoorDash, Gojek, Grab

---

## Beginner's Guide

### What's this in plain English?

You open Uber, tap "Request." Within seconds, the system finds a nearby driver, sends them the request, the driver accepts, and you watch them approach on a map. After the ride, payment, rating. The hard part: searching among millions of drivers in a city to find ones near you, in milliseconds, while keeping live locations updated.

### Why solve it?

- **Real world**: Uber, Lyft, DoorDash, Gojek.
- **Teaches**: geospatial indexing (geohash, S2, H3), matching algorithms, dispatch, surge pricing, real-time location.

### Vocabulary

- **Geospatial index** — data structure that finds points near another point quickly.
- **Geohash** — encodes lat/long into a string; nearby points share prefixes.
- **S2 / H3** — Google's / Uber's geo cell systems (better than geohash for proximity search).
- **Dispatch** — pick a driver for a request.
- **Surge** — dynamic pricing when demand > supply.
- **ETA** — estimated time of arrival.

### High-level architecture

```
Driver app → Location Service (every few sec) → Geo Index
                                                    ↑
                                                    │ query
Rider request → Matching Service → pick driver → Notify driver
                                          ↓
                                       Trip Service (state machine)
                                          ↓
                                       Payment / Rating
```

Components:
1. **Location ingest** — drivers ping their location every 4-5 seconds; updates a geo-index.
2. **Geo-index** — lookup "drivers within 2km of (lat, long)" in milliseconds. Built on geohash or S2 cells.
3. **Matching** — among candidates, pick best (closest, highest rating, fewest cancels).
4. **Trip state machine** — REQUESTED → ASSIGNED → IN_PROGRESS → COMPLETED.
5. **Surge** — monitors demand/supply per area; bumps price when imbalanced.

### How to read this doc

- **Beginner**: focus on the geo-indexing concept.
- **Interview**: cross-questions on dispatch optimality, surge math, ETA computation.

---

## 0. How to use this doc in an interview

Uber tests **geospatial indexing + matching + state machine** combo. The traps:
1. Storing driver locations in a regular DB and querying with `WHERE distance < X`. Doesn't scale.
2. Hand-waving the matching algorithm.
3. Forgetting that drivers update location every 4-5 seconds — that's a write storm.

Walk through: spatial index → match → ride state machine → surge → cross-functional concerns.

---

## 1. Problem Statement

A ride-hailing platform:
- Riders request a ride from origin.
- System matches with a nearby driver.
- Driver accepts / declines.
- Live tracking during ride.
- Payment, rating after.

Scale: millions of drivers; tens of millions of riders; spike concurrency at rush hour.

---

## 2. Clarifying Questions

- [ ] Cities supported?
- [ ] Ride types (UberX, Pool, Black)?
- [ ] Pre-scheduled rides?
- [ ] Pool/share rides?
- [ ] In-app payment only or cash?
- [ ] Real-time driver tracking by rider?

> **Assume:** global, multiple ride types, immediate + scheduled, no Pool, cashless, real-time tracking.

---

## 3. Functional Requirements

**P0:**
1. Driver continuous location update.
2. Rider request ride → matched with driver.
3. Driver accept/decline.
4. Live ride tracking.
5. Trip end → fare → payment.
6. Rating both ways.

**P1:**
7. Surge pricing.
8. ETA estimation.
9. Multiple ride types.
10. Driver supply heatmap.

**P2:**
11. Pool / shared rides.
12. Pre-scheduled rides.
13. Multi-stop trips.

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.99% |
| Match latency | < 5 s rider → matched |
| Driver location ingest | 5 s update interval × 1M drivers = 200k writes/s |
| Rider request → first driver shown | < 1 s |

---

## 5. Capacity Estimation

```
Active drivers: 1M
Driver location update: every 5 s → 200k writes/s
Active riders requesting: 100/s sustained, 10k/s peak (rush hour)
Cells (H3 indexing): ~100M cells globally; ~100k active at any moment
```

---

## 6. API

```
# Driver
POST /v1/drivers/me/location  body: {lat, lng, heading, ts}
PUT  /v1/drivers/me/state     body: { online | offline | en_route | with_rider }

# Rider
POST /v1/rides                body: { origin, destination, type }   -> ride_id
GET  /v1/rides/{id}                                                 -> status, driver loc

# Matching backend
internal: Match(ride_request, candidate_drivers) -> driver
```

---

## 7. Data Model

### Drivers (Redis + DB)
- Hot: `drivers:locations:h3:{cell}` → set of (driver_id, lat, lng, ts).
- Cold: Postgres `drivers(id, profile, vehicle, ratings, status)`.

### Rides (Cassandra)
- `rides(rider_id, ride_id, ts, status, driver_id, fare, route)` — partitioned by rider for "my rides" history.
- Live ride state in Redis for hot lookup.

### Geospatial index
- **H3 (Uber's open-source library)**: hexagonal cells, multi-resolution.
- Each driver location update → compute H3 cell; insert into that cell's bucket.
- Match: search rider's cell + neighbors for candidates.

---

## 8. Architecture

```
                ┌─────────────────────────┐
                │ Drivers (mobile)        │
                └────────────┬────────────┘
                             │ every 5s
                             ▼
                ┌─────────────────────────┐
                │ Location Ingest         │
                │ - validate              │
                │ - compute H3 cell       │
                │ - update Redis          │
                └────────────┬────────────┘
                             ▼
                      ┌──────────────┐
                      │ Redis Geo    │
                      │ H3 cell sets │
                      └──────┬───────┘
                             │
                ┌─────────────────────────┐
                │ Riders (mobile)         │
                └────────────┬────────────┘
                             │ ride request
                             ▼
                ┌─────────────────────────┐
                │ Matching Service        │
                │ - look up candidates    │
                │ - rank                  │
                │ - dispatch              │
                └────────────┬────────────┘
                             │
                             ▼
                ┌─────────────────────────┐
                │ Push to driver (WS)     │
                │ - ride offered          │
                │ - 15s to accept         │
                └────────────┬────────────┘
                             ▼
                ┌─────────────────────────┐
                │ Trip Service            │
                │ - state machine          │
                │ - persist                │
                │ - fare                   │
                └─────────────────────────┘
```

---

## 9. Component Deep-Dives

### 9.1 H3 indexing
- Hexagonal cell grid; multi-resolution (15 levels).
- For matching: use res 8 (~0.7 km² cells).
- Drivers indexed by cell.
- Match: candidates = drivers in rider's cell + 6 neighboring cells.

### 9.2 Driver location ingest
- 5 s update; 1M drivers → 200k QPS.
- Hot path: Redis ZSET per cell, sorted by ts (cleanup old).
- Async: persist to DB for analytics (every minute or via Kafka).

### 9.3 Matching algorithm
- Pull all candidates from rider's cell + neighbors.
- Filter by ride type, rating, vehicle.
- Score: distance × ETA × driver rating × surge factor.
- Offer to top driver; 15s accept window.
- On decline: offer next.
- Multiple rounds; fall back to wider radius.

### 9.4 Surge pricing
- Per-cell supply (drivers) vs demand (open requests).
- Demand:supply ratio > threshold → surge multiplier.
- Adjusts every minute.
- Visible to riders as price quote.

### 9.5 Trip state machine
States: `requested → matched → en_route_pickup → arrived → in_progress → completed`.
- Transitions on driver actions or location triggers.
- Persisted; recoverable.

---

## 10. Hard Sub-Problems

### 10.1 Driver location at scale
- 1M drivers × 5s updates = 200k QPS. Redis can handle, but per-cell hotspots possible (downtown).
- Sharded Redis by cell ID.
- TTL on entries: 30s (driver gone offline if no update).

### 10.2 Matching efficiency
- Naive: scan all drivers per ride = O(M).
- With H3: O(K) where K = candidates in cell + neighbors.
- Match latency: ~100ms typical; sub-second includes accept/decline cycles.

### 10.3 Cross-cell candidates
- Rider near cell boundary: drivers in adjacent cells equally close.
- H3's `kRing(cell, 1)` returns 7 cells (center + 6 neighbors).
- Search all 7 cells.

### 10.4 Spike handling (rush hour)
- Surge: incentivize more drivers online.
- Queue: if no drivers, riders queued; matched as drivers free up.
- Backpressure: cap concurrent open requests per region.

---

## 11. Cross-Questions ≥ 12

### 11.1 Why H3 and not lat/lng range query?
- Range query in DB: `WHERE lat BETWEEN x AND y AND lng BETWEEN ... `. B-tree indexes don't help (2D); requires spatial index (R-tree, etc.).
- H3: O(1) cell lookup; pre-grouped by spatial proximity.
- Cells uniform area regardless of lat (hexagons!).

### 11.2 Why hexagons (H3) over squares (S2)?
- Hexagons: 6 equidistant neighbors; better for "K nearest" queries.
- Squares: 4 neighbors at edge distance, 4 at corner — non-uniform.
- Both work; H3 has cleaner UX for matching.

### 11.3 Why Redis for hot driver locations?
- Sub-ms read; high write throughput.
- TTL fits "driver gone offline" semantics.
- Redis Geo commands (`GEOADD`, `GEORADIUS`) built-in.

### 11.4 What about precision vs cell size?
- Resolution 8 cells ~0.7 km². Right balance for cities.
- Smaller (res 9): 100m, more cells, more overhead.
- Larger (res 7): 5 km², too coarse — too many candidates per cell.

### 11.5 Why offer to one driver at a time?
- Fair: best-match driver gets first refusal.
- Bad alternative: offer to 5 drivers simultaneously → drivers compete; UX poor; drivers feel cheap.

### 11.6 What if no driver accepts in 60s?
- Widen search radius.
- Increase surge.
- After timeout, fail the ride; rider notified.

### 11.7 How does live driver tracking work?
- Rider's app subscribes to driver's location updates via WS.
- Driver pushes location every 5s; relayed to rider.
- 15-min storage cap (after ride: not needed).

### 11.8 What about predictive ETA?
- ML model: features = origin, destination, time, traffic, weather.
- Trained on historical data.
- Updated every minute as ride progresses.

### 11.9 How does surge propagate?
- Periodic surge calculator job (1 min) per cell.
- Stored in Redis.
- Riders see price quote when requesting.

### 11.10 Cross-region (cross-city) drivers?
- Driver tagged with home market.
- Match within market only (regulatory).
- Cross-market trips handled separately.

### 11.11 What's the failure mode if Redis goes down?
- Matching halts: no driver lookups.
- DB has stale locations (~1 min old).
- Fall back to DB temporarily; degraded UX.

### 11.12 How do you prevent fraud (fake locations, ghost rides)?
- Anomaly detection: impossible movement (teleport).
- Phone GPS validation against carrier signals.
- Rider/driver pairing with reputation scores.

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| H3 spatial index | O(1) match candidates | New library to learn |
| 5s location updates | Bandwidth manageable | Older locations |
| Redis hot store | Sub-ms reads | Volatile; needs TTL |
| Sequential offers | Driver fairness | Slower match in worst case |
| Per-region matching | Latency, regulatory | No cross-region rides |

---

## 13. Cheat-Sheet

1. **H3 hexagonal index** for spatial bucketing.
2. **Redis** for hot driver locations.
3. **Per-cell candidate search** + neighbors.
4. **Sequential offers** to top-ranked driver.
5. **Surge** = per-cell demand/supply ratio.
6. **State machine** for ride lifecycle.
7. **WS** for live tracking.

---

## Appendix: Numbers

```
Active drivers / market: 10k–500k
Match latency target: < 5 s
Location updates: 5 s interval (or motion-triggered)
H3 res 8 cell: ~0.7 km²
Surge update interval: 60 s
```

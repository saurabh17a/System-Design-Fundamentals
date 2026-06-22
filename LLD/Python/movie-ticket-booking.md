# Movie Ticket Booking (BookMyShow) — Low-Level Design (Python)

> **Difficulty:** Hard
> **Tags:** `[lld]` `[ood]` `[concurrency]` `[seat-reservation]` `[hold-window]` `[idempotency]`
> **Language:** Python 3.10+
> **Prep time:** ~15 min skim, ~40 min deep read
> **Companies that ask this:** Atlassian, BookMyShow, Razorpay, Goldman Sachs, Uber, Amazon

---

## Beginner's Guide

### What's this in plain English?

BookMyShow / Fandango. A movie has multiple showings ("9pm Saturday at Cinemark Theater 4"). Each showing has a seat layout. Customer picks a showing, picks seats, pays, gets tickets. The hard part: 1000 people might be tapping the same popular seat at the same instant — only one wins.

### Why solve it?

- **Real world**: BookMyShow, AMC, every event ticketing system.
- **Teaches**: high-contention concurrency, two-phase booking (hold then confirm), idempotency, payment retries.
- **Interview**: HARD; tests systems thinking.

### Vocabulary

- **Show / Screening** — movie + theater + time.
- **Seat** — physical seat in a hall.
- **Hold / Lock** — temporary reservation while user pays (5-10 min).
- **Two-phase booking** — hold first, confirm after payment.
- **Idempotency key** — let the same payment retry without double-charging.

### High-level approach

Entities:
- **Movie / Theater / Hall / Show / Seat**.
- **Booking** — show, user, seats, status (HELD / CONFIRMED / CANCELLED), expiry.
- **PaymentService** — interface; idempotent.
- **BookingService** — orchestrator.

Hold flow under lock:
1. Validate seats are AVAILABLE.
2. Mark seats HELD with expiry = now + 8 minutes.
3. Return booking_id.

Confirm flow:
1. Find booking_id; check still HELD (not expired).
2. Process payment (idempotent via key).
3. Mark booking CONFIRMED, seats SOLD.

Expiry sweep: scheduled task; HELD bookings past expiry → release seats.

The lock is per-show or per-seat-set; granularity affects scalability.

### How to read this doc

- **Beginner**: focus on the two-phase flow and seat states.
- **Interview**: idempotency, retry handling, expiry, regional availability are the differentiators.

---

## 0. How to use this doc in an interview

Movie booking is **the** concurrency LLD — the one where two users tap the same seat at the same instant. Interviewers grade on:

1. **Did you model city → theatre → screen → show → seat correctly?** (Most candidates conflate "screen" and "show".)
2. **Two-phase booking** — `hold` (transient) → `confirm` (permanent). The hold must atomically claim seats; confirm settles payment.
3. **Hold expiry** — held seats auto-release after N minutes if payment doesn't complete.
4. **Race correctness** — two users hold same seats: exactly one wins.
5. **Idempotency on confirm** — payment retries don't double-book.
6. **Pricing** — pluggable (different per show, time, seat type, weekend premium).

Trap: implementing single-step `book(seats)` instead of `hold` + `confirm`. Real systems split because payment is slow (~3s) — holding the database row for the duration starves other buyers.

---

## 1. Problem Statement

A booking system for movies in cinemas. Customers browse cities → cinemas → shows → pick seats → pay. The system must:
- Manage a hierarchy: City → Cinema → Screen → Show → Seats.
- Show real-time seat availability.
- Allow concurrent users to **hold** seats for a fixed window (e.g. 5 min).
- Confirm or release the hold based on payment.
- Be **strictly correct** on concurrent claims of the same seat.
- Support cancellation + refund (out of payment scope here).
- Pluggable pricing.

---

## 2. Clarifying Questions

### Scope
- [ ] City → Cinema → Screen → Show — full hierarchy?
- [ ] Multiple seat types (regular, premium, recliner, balcony)?
- [ ] Reserved seating (numbered) or free-for-all?
- [ ] Hold window length — 5 min, configurable?
- [ ] Payment integration mocked or real?
- [ ] Group bookings (e.g. couple seats can't be split)?
- [ ] Promo codes / discounts?

### Domain
- [ ] What happens to a hold if payment fails — instant release or wait for window?
- [ ] Can a customer hold seats across multiple shows simultaneously?
- [ ] Can a customer cancel a confirmed booking?
- [ ] Refund mechanics — full vs partial vs none after show start?

### Non-functional
- [ ] Concurrency: thousands of users on a hot show — how do we scale?
- [ ] Persistence: in-memory or DB?
- [ ] Library API or service?

> **For this doc:** full hierarchy, 3 seat types (regular/premium/recliner), 5-minute hold, mocked payment, no group bookings (P2), pluggable pricing, in-memory thread-safe library, single instance, no cancellation in P0 (designed-for).

---

## 3. Functional Requirements

**Must-have (P0):**
1. Browse: cities → cinemas → shows → seats with availability.
2. `hold(show_id, seat_ids, customer_id) → Hold` (atomic claim).
3. `confirm(hold_id, payment_token) → Booking` (idempotent).
4. `release(hold_id)` — explicit release of unconfirmed hold.
5. Hold auto-expires after N minutes.
6. Pricing per (show, seat_type) with weekend uplift.
7. Concurrent-correct under high load.
8. Audit every state transition.

**Should-have (P1):**
9. Cancellation with refund eligibility (time-based).
10. Multiple seat-fitting strategies (best-available, contiguous group, best-row).

**Nice-to-have (P2 — designed-for):**
11. Group bookings.
12. Promo codes.
13. Real payment integration.
14. Notifications.
15. Showtime change / cancellation.

---

## 4. Actors & Use Cases

```
                    ┌──────────────────┐
                    │   Booking System │
                    └──────────────────┘
                       ▲     ▲     ▲
                       │     │     │
              ┌────────┘     │     └─────────┐
              │              │               │
        ┌─────────┐    ┌─────────┐    ┌──────────────┐
        │Customer │    │ Cinema  │    │   Sweeper    │
        │ (book)  │    │  Admin  │    │ (expire holds│
        │         │    │ (config)│    │  background) │
        └─────────┘    └─────────┘    └──────────────┘
```

---

## 5. Core Entities

| Entity | Attributes | Notes |
|---|---|---|
| `City` | id, name | |
| `Cinema` | id, city, name, screens | |
| `Screen` | id, cinema, name, seats (layout) | |
| `Seat` | id, row, col, type | Belongs to a screen layout |
| `Movie` | id, title, duration, language | |
| `Show` | id, movie, screen, start_time, end_time, seat_states (per Seat: AVAILABLE/HELD/BOOKED) | Per-show seat status |
| `Hold` | id, show, seats, customer, expires_at | Transient |
| `Booking` | id, show, seats, customer, amount, payment_token | Confirmed |
| `BookingSystem` | facade with locks, sweeper, pricing | |

**Key insight:** `Seat` is a *physical* identity (row/col on the screen layout); `seat status` is **per-show** (the same seat is booked Tuesday but free Wednesday). Don't store status on Seat directly — store it on Show as a `seat_id → SeatStatus` map.

**Enums:**
```
SeatType:    REGULAR, PREMIUM, RECLINER
SeatStatus:  AVAILABLE, HELD, BOOKED
HoldStatus:  ACTIVE, CONFIRMED, EXPIRED, RELEASED
```

---

## 6. Class Diagram (ASCII)

```
                                ┌──────────────────────────────┐
                                │       BookingSystem          │
                                │──────────────────────────────│
                                │ - cities, cinemas            │
                                │ - shows: dict[id → Show]     │
                                │ - holds:  dict[id → Hold]    │
                                │ - bookings: dict[id → Bk]    │
                                │ - pricing: PricingStrategy   │◇──┐
                                │ - clock                      │   │
                                │ - lock: RLock                │   │
                                │──────────────────────────────│   │
                                │ + browse_*                   │   │
                                │ + hold(show, seats, cust)    │   │
                                │ + confirm(hold, token)       │   │
                                │ + release(hold)              │   │
                                │ + expire_old(now)            │   │
                                └─────┬────────────────────────┘   │
                                      │ ◆                            │
                          ┌───────────┼─────────────┐                │
                          ▼                         ▼                │
                  ┌────────────┐               ┌──────────────┐      │
                  │   Cinema   │◇─────▶ Screen │     Show     │      │
                  └────────────┘               │──────────────│      │
                                               │ - movie       │      │
                                               │ - screen      │      │
                                               │ - start_time  │      │
                                               │ - seat_states │      │ status by seat
                                               └──────────────┘      │
                                                                     │
                                                                     ▼
                                                ┌──────────────────────┐
                                                │ «interface»          │
                                                │ PricingStrategy      │
                                                │──────────────────────│
                                                │ + price(show, seats) │
                                                │   → Money            │
                                                └──────────▲───────────┘
                                                           │ implements
                                                ┌──────────┴────────────┐
                                                │ FlatPerSeatPricing    │
                                                │ WeekendUpliftPricing  │
                                                └───────────────────────┘
```

---

## 7. Design Patterns Used

| Pattern | Where | Why | Alternative |
|---|---|---|---|
| Strategy | `PricingStrategy` | Different rules per cinema/promotion | if/else — fails open/closed |
| State | `SeatStatus`, `HoldStatus` | Multi-state; transitions guarded | bools — illegal combos |
| Facade | `BookingSystem` | Hide cinemas/screens internals | direct exposure — leaks |
| Two-Phase Commit (light) | `hold` + `confirm` | Slow payment shouldn't lock seats | single-step book — DB row lock during payment |
| Saga (NOT implemented) | — | For real distributed payments — log state, compensate on failure | |

---

## 8. Sequence Diagrams

### 8.1 Hold + Confirm (happy path)

```
  Customer        BookingSys         PricingStrategy        Show
    │                │                    │                  │
    │── hold(seats) ▶│                    │                  │
    │                │── (transactional)                     │
    │                │   verify all AVAILABLE ─────────────▶ │
    │                │   mark HELD ────────────────────────▶ │
    │                │   create Hold entity                  │
    │                │── price ──────────▶│                  │
    │                │◀── total ──────────│                  │
    │◀── (hold_id, $)│                    │                  │
    │   …pay externally…                  │                  │
    │── confirm ────▶│                    │                  │
    │                │── verify hold not expired             │
    │                │── mark BOOKED ───────────────────────▶│
    │                │── create Booking                      │
    │◀── booking_id ─│                                        │
```

### 8.2 Race: two customers same seats

```
  C1                BookingSys                C2
    │                  │                       │
    │── hold(s1,s2) ──▶│                       │
    │                  │── lock acquired       │
    │                  │── seats AVAILABLE     │
    │                  │── mark HELD           │
    │                  │── lock released       │
    │◀── ok ───────────│                       │
    │                  │◀── hold(s1,s2) ───────│
    │                  │── lock acquired       │
    │                  │── seats are HELD ✗    │
    │                  │── lock released       │
    │                  │── ConflictError ─────▶│
```

### 8.3 Hold expiry

```
  Sweeper          BookingSys               Show
    │                  │                       │
    │── now ──────────▶│                       │
    │                  │── for each ACTIVE hold:
    │                  │   if expires_at < now:│
    │                  │     mark seats AVAIL ▶│
    │                  │     hold.status=EXPIRED
```

---

## 9. Concurrency Considerations

**The hot race:** two threads call `hold` for overlapping seats.

Solution: per-show lock (or coarse single lock for simplicity). The atomic transaction is "verify all seats AVAILABLE → mark all HELD". Under one lock.

For `confirm`: verify hold not expired → mark all BOOKED. Also under lock.

Lock granularity:
- **Coarse (system-wide):** simple; correct; ~10k holds/sec.
- **Per-show lock:** scales linearly with show count; needs careful map-of-locks management.
- **Per-seat lock with ordering:** finest grain; hardest to get right (deadlock risk; must always acquire seats in sorted order).

For interview: coarse `RLock` on the system; mention per-show as the scaling step.

---

## 10. Full Working Code

```python
"""
Movie Ticket Booking — Low-Level Design (Python)

Features:
- City/Cinema/Screen/Show/Seat hierarchy
- Two-phase booking: hold → confirm (idempotent)
- Hold auto-expiry via sweeper
- Pluggable pricing (flat / weekend uplift)
- Thread-safe under concurrent holds for the same seats
"""
from __future__ import annotations

import enum
import threading
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Optional


class SeatType(enum.Enum):
    REGULAR = "regular"
    PREMIUM = "premium"
    RECLINER = "recliner"


class SeatStatus(enum.Enum):
    AVAILABLE = "available"
    HELD = "held"
    BOOKED = "booked"


class HoldStatus(enum.Enum):
    ACTIVE = "active"
    CONFIRMED = "confirmed"
    EXPIRED = "expired"
    RELEASED = "released"


# ──────────────────────────────────────────────────────────────────────────
# Errors
# ──────────────────────────────────────────────────────────────────────────

class BookingError(Exception): ...
class SeatUnavailable(BookingError): ...
class HoldNotFound(BookingError): ...
class HoldExpired(BookingError): ...
class HoldAlreadyConfirmed(BookingError): ...
class InvalidPayment(BookingError): ...


# ──────────────────────────────────────────────────────────────────────────
# Domain
# ──────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Seat:
    seat_id: str
    row: str          # "A", "B", ...
    col: int
    type: SeatType


@dataclass(frozen=True)
class Movie:
    movie_id: str
    title: str
    duration_min: int
    language: str


@dataclass(frozen=True)
class City:
    city_id: str
    name: str


@dataclass
class Cinema:
    cinema_id: str
    city_id: str
    name: str
    screens: list["Screen"] = field(default_factory=list)


@dataclass
class Screen:
    screen_id: str
    cinema_id: str
    name: str
    seats: list[Seat] = field(default_factory=list)


@dataclass
class Show:
    show_id: str
    movie_id: str
    screen_id: str
    start_time: datetime
    end_time: datetime
    seat_status: dict[str, SeatStatus] = field(default_factory=dict)
    seat_lookup: dict[str, Seat] = field(default_factory=dict)
    base_price: Decimal = field(default_factory=lambda: Decimal("100"))


@dataclass
class Hold:
    hold_id: str
    show_id: str
    seat_ids: tuple[str, ...]
    customer_id: str
    created_at: datetime
    expires_at: datetime
    status: HoldStatus = HoldStatus.ACTIVE
    amount: Decimal = Decimal("0")


@dataclass(frozen=True)
class Booking:
    booking_id: str
    hold_id: str
    show_id: str
    seat_ids: tuple[str, ...]
    customer_id: str
    amount: Decimal
    confirmed_at: datetime
    payment_token: str


# ──────────────────────────────────────────────────────────────────────────
# Strategy: pricing
# ──────────────────────────────────────────────────────────────────────────

class PricingStrategy(ABC):
    @abstractmethod
    def price(self, show: Show, seats: list[Seat]) -> Decimal:
        ...


class FlatPerSeatPricing(PricingStrategy):
    """Base price × number of seats × type multiplier."""
    TYPE_MULT = {
        SeatType.REGULAR:  Decimal("1.0"),
        SeatType.PREMIUM:  Decimal("1.5"),
        SeatType.RECLINER: Decimal("2.0"),
    }

    def price(self, show: Show, seats: list[Seat]) -> Decimal:
        return sum(
            (show.base_price * self.TYPE_MULT[s.type] for s in seats),
            Decimal("0"),
        )


class WeekendUpliftPricing(FlatPerSeatPricing):
    """Sat/Sun get 25% uplift over the flat price."""
    UPLIFT = Decimal("1.25")

    def price(self, show: Show, seats: list[Seat]) -> Decimal:
        base = super().price(show, seats)
        if show.start_time.weekday() in (5, 6):  # Sat or Sun
            return base * self.UPLIFT
        return base


# ──────────────────────────────────────────────────────────────────────────
# BookingSystem (facade)
# ──────────────────────────────────────────────────────────────────────────

class BookingSystem:
    DEFAULT_HOLD_WINDOW = timedelta(minutes=5)

    def __init__(self,
                 pricing: Optional[PricingStrategy] = None,
                 hold_window: timedelta = DEFAULT_HOLD_WINDOW) -> None:
        self._cities: dict[str, City] = {}
        self._cinemas: dict[str, Cinema] = {}
        self._movies: dict[str, Movie] = {}
        self._shows: dict[str, Show] = {}
        self._holds: dict[str, Hold] = {}
        self._bookings: dict[str, Booking] = {}
        # idempotency: payment_token → booking_id
        self._idem: dict[str, str] = {}
        self._pricing = pricing or FlatPerSeatPricing()
        self._hold_window = hold_window
        self._lock = threading.RLock()
        self._audit: list[tuple[str, str]] = []

    # ─── admin / setup ──────────────────────────────────────────────

    def add_city(self, name: str) -> City:
        c = City(city_id=str(uuid.uuid4()), name=name)
        self._cities[c.city_id] = c
        return c

    def add_cinema(self, city_id: str, name: str) -> Cinema:
        cin = Cinema(cinema_id=str(uuid.uuid4()), city_id=city_id, name=name)
        self._cinemas[cin.cinema_id] = cin
        return cin

    def add_screen(self, cinema_id: str, name: str, layout: list[Seat]) -> Screen:
        scr = Screen(screen_id=str(uuid.uuid4()), cinema_id=cinema_id, name=name, seats=list(layout))
        self._cinemas[cinema_id].screens.append(scr)
        return scr

    def add_movie(self, title: str, duration_min: int, language: str) -> Movie:
        m = Movie(movie_id=str(uuid.uuid4()), title=title, duration_min=duration_min, language=language)
        self._movies[m.movie_id] = m
        return m

    def add_show(self, movie_id: str, screen_id: str, start_time: datetime,
                 base_price: Decimal = Decimal("200")) -> Show:
        movie = self._movies[movie_id]
        # find screen
        screen = None
        for cin in self._cinemas.values():
            for s in cin.screens:
                if s.screen_id == screen_id:
                    screen = s
                    break
        if screen is None:
            raise BookingError(f"screen {screen_id} not found")
        end = start_time + timedelta(minutes=movie.duration_min)
        sh = Show(
            show_id=str(uuid.uuid4()),
            movie_id=movie_id,
            screen_id=screen_id,
            start_time=start_time,
            end_time=end,
            base_price=base_price,
        )
        for seat in screen.seats:
            sh.seat_status[seat.seat_id] = SeatStatus.AVAILABLE
            sh.seat_lookup[seat.seat_id] = seat
        self._shows[sh.show_id] = sh
        return sh

    # ─── browse ─────────────────────────────────────────────────────

    def list_shows_in_city(self, city_id: str) -> list[Show]:
        with self._lock:
            cinema_ids = [c.cinema_id for c in self._cinemas.values() if c.city_id == city_id]
            screen_ids = {
                s.screen_id
                for cid in cinema_ids
                for s in self._cinemas[cid].screens
            }
            return [s for s in self._shows.values() if s.screen_id in screen_ids]

    def get_seat_status(self, show_id: str) -> dict[str, str]:
        with self._lock:
            sh = self._shows[show_id]
            return {sid: st.value for sid, st in sh.seat_status.items()}

    # ─── hold / confirm / release ───────────────────────────────────

    def hold(self, show_id: str, seat_ids: list[str], customer_id: str,
             *, now: Optional[datetime] = None) -> Hold:
        now = now or datetime.utcnow()
        with self._lock:
            sh = self._shows.get(show_id)
            if sh is None:
                raise BookingError(f"show {show_id} not found")
            # verify all seats exist and are AVAILABLE
            for sid in seat_ids:
                if sid not in sh.seat_status:
                    raise BookingError(f"seat {sid} not in show {show_id}")
                st = sh.seat_status[sid]
                if st is not SeatStatus.AVAILABLE:
                    raise SeatUnavailable(f"seat {sid} is {st.value}")
            # mark all HELD atomically
            for sid in seat_ids:
                sh.seat_status[sid] = SeatStatus.HELD
            seats = [sh.seat_lookup[sid] for sid in seat_ids]
            amount = self._pricing.price(sh, seats)
            hold = Hold(
                hold_id=str(uuid.uuid4()),
                show_id=show_id,
                seat_ids=tuple(seat_ids),
                customer_id=customer_id,
                created_at=now,
                expires_at=now + self._hold_window,
                amount=amount,
            )
            self._holds[hold.hold_id] = hold
            self._audit.append(("hold", f"{hold.hold_id}/{customer_id}"))
            return hold

    def confirm(self, hold_id: str, payment_token: str,
                *, now: Optional[datetime] = None) -> Booking:
        now = now or datetime.utcnow()
        with self._lock:
            # Idempotency: same payment_token → same booking
            existing = self._idem.get(payment_token)
            if existing is not None:
                return self._bookings[existing]

            hold = self._holds.get(hold_id)
            if hold is None:
                raise HoldNotFound(f"hold {hold_id} not found")
            if hold.status is HoldStatus.CONFIRMED:
                raise HoldAlreadyConfirmed(f"hold {hold_id} already confirmed")
            if hold.status is not HoldStatus.ACTIVE:
                raise HoldNotFound(f"hold {hold_id} status={hold.status.value}")
            if now > hold.expires_at:
                # mark expired before raising — also free seats
                self._mark_expired(hold)
                raise HoldExpired(f"hold {hold_id} expired at {hold.expires_at}")

            # Mock payment — in production, call payment service here
            if not payment_token or len(payment_token) < 8:
                raise InvalidPayment("payment token invalid")

            sh = self._shows[hold.show_id]
            for sid in hold.seat_ids:
                sh.seat_status[sid] = SeatStatus.BOOKED

            booking = Booking(
                booking_id=str(uuid.uuid4()),
                hold_id=hold.hold_id,
                show_id=hold.show_id,
                seat_ids=hold.seat_ids,
                customer_id=hold.customer_id,
                amount=hold.amount,
                confirmed_at=now,
                payment_token=payment_token,
            )
            hold.status = HoldStatus.CONFIRMED
            self._bookings[booking.booking_id] = booking
            self._idem[payment_token] = booking.booking_id
            self._audit.append(("confirm", booking.booking_id))
            return booking

    def release(self, hold_id: str) -> bool:
        with self._lock:
            hold = self._holds.get(hold_id)
            if hold is None or hold.status is not HoldStatus.ACTIVE:
                return False
            sh = self._shows[hold.show_id]
            for sid in hold.seat_ids:
                if sh.seat_status[sid] is SeatStatus.HELD:
                    sh.seat_status[sid] = SeatStatus.AVAILABLE
            hold.status = HoldStatus.RELEASED
            self._audit.append(("release", hold.hold_id))
            return True

    def expire_old(self, now: Optional[datetime] = None) -> list[str]:
        """Sweep: ACTIVE holds past expiry → release seats; return expired hold IDs."""
        now = now or datetime.utcnow()
        expired: list[str] = []
        with self._lock:
            for hold in self._holds.values():
                if hold.status is HoldStatus.ACTIVE and now > hold.expires_at:
                    self._mark_expired(hold)
                    expired.append(hold.hold_id)
            return expired

    def _mark_expired(self, hold: Hold) -> None:
        sh = self._shows[hold.show_id]
        for sid in hold.seat_ids:
            if sh.seat_status[sid] is SeatStatus.HELD:
                sh.seat_status[sid] = SeatStatus.AVAILABLE
        hold.status = HoldStatus.EXPIRED
        self._audit.append(("expire", hold.hold_id))


# ──────────────────────────────────────────────────────────────────────────
# Demo / tests
# ──────────────────────────────────────────────────────────────────────────

def _build_demo_system() -> tuple[BookingSystem, Show]:
    sys = BookingSystem()
    blr = sys.add_city("Bangalore")
    pvr = sys.add_cinema(blr.city_id, "PVR Forum")
    layout: list[Seat] = []
    for r, row in enumerate("ABCDE"):
        for c in range(1, 11):
            t = SeatType.RECLINER if row == "A" else (SeatType.PREMIUM if row in ("B", "C") else SeatType.REGULAR)
            layout.append(Seat(seat_id=f"{row}{c}", row=row, col=c, type=t))
    screen = sys.add_screen(pvr.cinema_id, "Audi 1", layout)
    movie = sys.add_movie("Inception", duration_min=148, language="English")
    show = sys.add_show(movie.movie_id, screen.screen_id, datetime(2026, 5, 17, 18, 0))
    return sys, show


def _basic_flow() -> None:
    print("--- basic hold + confirm ---")
    sys, show = _build_demo_system()
    hold = sys.hold(show.show_id, ["A1", "A2"], "user-1")
    print(f"  hold = ${hold.amount}")
    booking = sys.confirm(hold.hold_id, "TOKEN-12345678")
    assert booking.amount == hold.amount
    # Status should now be BOOKED
    statuses = sys.get_seat_status(show.show_id)
    assert statuses["A1"] == "booked"
    assert statuses["A2"] == "booked"
    print("  OK")


def _race_test() -> None:
    print("--- race: 50 threads grab same 2 seats ---")
    sys, show = _build_demo_system()
    succeeded = []
    failed = 0
    succeeded_lock = threading.Lock()
    failed_lock = threading.Lock()

    def fire(i: int):
        nonlocal failed
        try:
            h = sys.hold(show.show_id, ["B5", "B6"], f"user-{i}")
            with succeeded_lock:
                succeeded.append(h.hold_id)
        except SeatUnavailable:
            with failed_lock:
                failed += 1

    threads = [threading.Thread(target=fire, args=(i,)) for i in range(50)]
    for t in threads: t.start()
    for t in threads: t.join()

    assert len(succeeded) == 1, f"got {len(succeeded)}"
    assert failed == 49
    statuses = sys.get_seat_status(show.show_id)
    assert statuses["B5"] == "held" and statuses["B6"] == "held"
    print(f"  exactly 1 succeeded, {failed} failed ✓")


def _hold_expiry() -> None:
    print("--- hold expiry ---")
    sys, show = _build_demo_system()
    base = datetime(2026, 5, 17, 17, 0)
    h = sys.hold(show.show_id, ["C3"], "user-x", now=base)
    expired = sys.expire_old(now=base + timedelta(minutes=6))
    assert h.hold_id in expired
    statuses = sys.get_seat_status(show.show_id)
    assert statuses["C3"] == "available"
    print("  OK")


def _confirm_after_expiry() -> None:
    print("--- confirm after expiry ---")
    sys, show = _build_demo_system()
    base = datetime(2026, 5, 17, 17, 0)
    h = sys.hold(show.show_id, ["D5"], "user-y", now=base)
    try:
        sys.confirm(h.hold_id, "TOKEN-AAAAAAAA", now=base + timedelta(minutes=6))
        assert False
    except HoldExpired:
        pass
    # seat should be released
    statuses = sys.get_seat_status(show.show_id)
    assert statuses["D5"] == "available"
    print("  OK")


def _idempotent_confirm() -> None:
    print("--- idempotent confirm ---")
    sys, show = _build_demo_system()
    h = sys.hold(show.show_id, ["E1"], "user-z")
    b1 = sys.confirm(h.hold_id, "TOKEN-IDEMPOTENT")
    b2 = sys.confirm(h.hold_id, "TOKEN-IDEMPOTENT")  # same token
    assert b1.booking_id == b2.booking_id
    print("  OK")


def _release_test() -> None:
    print("--- explicit release ---")
    sys, show = _build_demo_system()
    h = sys.hold(show.show_id, ["A5", "A6"], "user-r")
    assert sys.release(h.hold_id) is True
    statuses = sys.get_seat_status(show.show_id)
    assert statuses["A5"] == "available" and statuses["A6"] == "available"
    # release again → False
    assert sys.release(h.hold_id) is False
    print("  OK")


def _weekend_pricing() -> None:
    print("--- weekend pricing ---")
    sys = BookingSystem(pricing=WeekendUpliftPricing())
    # Set up cinema
    blr = sys.add_city("Mumbai")
    cin = sys.add_cinema(blr.city_id, "INOX")
    seats = [Seat("A1", "A", 1, SeatType.REGULAR)]
    scr = sys.add_screen(cin.cinema_id, "1", seats)
    mv = sys.add_movie("M", 120, "Hindi")

    # Sat
    sat = datetime(2026, 5, 16, 18, 0)  # Saturday (weekday=5)
    show_sat = sys.add_show(mv.movie_id, scr.screen_id, sat, base_price=Decimal("100"))
    h_sat = sys.hold(show_sat.show_id, ["A1"], "user-1")
    assert h_sat.amount == Decimal("125.0"), f"got {h_sat.amount}"  # 100 * 1.0 * 1.25
    print(f"  Saturday: ${h_sat.amount}")
    # Mon
    mon = datetime(2026, 5, 18, 18, 0)  # Monday
    show_mon = sys.add_show(mv.movie_id, scr.screen_id, mon, base_price=Decimal("100"))
    h_mon = sys.hold(show_mon.show_id, ["A1"], "user-2")
    assert h_mon.amount == Decimal("100.0")
    print(f"  Monday: ${h_mon.amount}")
    print("  OK")


if __name__ == "__main__":
    _basic_flow()
    _race_test()
    _hold_expiry()
    _confirm_after_expiry()
    _idempotent_confirm()
    _release_test()
    _weekend_pricing()
    print("\nAll tests passed.")
```

### How to run

```bash
python3 ~/Downloads/cc/kb/LLD/Python/movie-ticket-booking.py
```

---

## 11. Cross-Questions ("Why X and not Y") — ≥ 14

### 11.1 Why two-phase (hold → confirm) instead of one `book(seats, payment)`?

Single-step holds the lock during payment processing — payment can take seconds (3–10s for cards). For a hot show, this serializes purchases.

Two-phase: hold for 5 min (transient, low contention); pay externally; confirm with payment token. The lock is held only during the (fast) database update. Real systems all use this pattern.

### 11.2 Why is seat status stored on `Show` and not on `Seat`?

A `Seat` is a physical location (Row B, Col 5 of Audi 1). It's the same physical seat for every show. But the seat's **booking status** is per-show — booked Tuesday, free Wednesday. Storing status on Seat would force a seat-per-show explosion.

Storing on Show as `dict[seat_id, SeatStatus]` mirrors the truth: a show owns the booking state for its run.

### 11.3 Why a 5-minute hold window?

Long enough for users to enter payment details, possibly fail and retry. Short enough to release seats from abandoned carts before others give up. Real BookMyShow uses 5–8 min.

Configurable per cinema or show is reasonable.

### 11.4 Why idempotency on `payment_token` → `booking_id`?

Payment retries are common (network blip during `confirm`). Without idempotency:
- Client retries → confirm runs twice → second attempt sees hold already CONFIRMED → fails.
- Or worse: charges payment twice but only marks one booking.

With `payment_token` as idempotency key: same token → same booking. Safe to retry.

### 11.5 What if the hold is concurrently expired by the sweeper while `confirm` is mid-flight?

Both take the same lock. Whichever acquires first wins. If sweeper expires first: `confirm` sees status=EXPIRED, raises `HoldExpired`. If confirm wins first: hold is CONFIRMED; sweeper skips it.

Linearized correctness via single lock.

### 11.6 Why `tuple` for `Hold.seat_ids` instead of `list`?

Immutability + hashability. After hold creation, the seat list shouldn't change. Tuple makes that explicit. Also: tuple comparison is fast for sets/maps.

### 11.7 Why per-system lock and not per-show lock?

Per-show would scale better. Implementation:
```python
def _show_lock(self, show_id):
    with self._meta_lock:
        if show_id not in self._show_locks:
            self._show_locks[show_id] = threading.RLock()
        return self._show_locks[show_id]
```
Trade-off: meta-lock for the lock map; entry/exit ceremony. For interview, system-lock is simpler. We mention as scaling step.

### 11.8 Why not optimistic concurrency (CAS)?

Optimistic CAS: read seats, verify-and-update. If concurrent change → retry. Works when contention is low.

For movie bookings, contention IS the case (popular shows have many buyers per second). Pessimistic locks avoid retry loops. Real systems use database row locks; we mirror with mutex.

### 11.9 Why does `_mark_expired` re-check the seat status (`if HELD`)?

Defense in depth. If the same seat appeared in two holds (impossible by construction, but defensive), we don't double-release. Cheap check; costs nothing.

### 11.10 Why `Decimal` for money?

Floats round in binary; `Decimal` is base-10. Money calculations involve `* 1.5` and `* 1.25` multipliers — float would accumulate cents-of-error.

For Go (or production), `int64` cents is the canonical answer; we use `Decimal` for the Python idiom.

### 11.11 What about cancellation after confirm?

Add `cancel(booking_id) → Refund`. Logic:
- Within N hours of show start → no refund.
- Within Y days → partial refund.
- Beyond Y days → full refund.

Released seats become AVAILABLE. The original booking is marked CANCELLED but kept for audit.

We omit; designed-for. Easy addition.

### 11.12 Why aren't seats locked in sorted order (to prevent deadlock)?

We hold a single system-level lock for the whole transaction. No multi-lock acquisition; no deadlock risk.

If we moved to per-seat locks, we'd have to acquire them in a defined order (e.g. lex sort by seat_id) — otherwise two concurrent multi-seat holds could deadlock. That's a known pattern; we don't need it here.

### 11.13 What's the failure mode if `confirm` succeeds at the seat level but `Booking` creation fails?

Seats are marked BOOKED, but no Booking record exists. Customer paid and lost their booking.

Mitigation: wrap the entire confirm in try/except; on failure, roll back seats to HELD. Our code doesn't (interview minimum); production-grade does.

### 11.14 What if a customer holds seats across multiple shows simultaneously?

Each show has independent locks/state. Holds don't conflict. The system tracks them separately. No special handling needed.

A business rule could limit per-customer concurrent holds; check `customer_id` against active holds.

### 11.15 How would you handle group bookings (4 seats together)?

Add `find_contiguous(show, count, type) → list[Seat]` — search rows for contiguous available seats. Pluggable as a `SeatAllocator` strategy.

Integrate: `hold_group(show, count, customer)` calls allocator first, then holds the returned seats.

### 11.16 What about multi-cinema holds (one customer holds at two cinemas)?

The system doesn't prevent this. If desired, track per-customer active hold count. Out of scope for base.

### 11.17 What's the test the interviewer will run?

100 threads racing for the same 2 seats: exactly 1 succeeds, 99 fail. Plus: race + confirm + 99 retries → only 1 booking. Our `_race_test` covers the first; combining with `_idempotent_confirm` covers the second.

---

## 12. Extensions

### 12.1 Cancellation
`cancel(booking_id)` with time-based refund logic. Releases seats; marks booking CANCELLED.

### 12.2 Group bookings
`SeatAllocator` strategy — find N contiguous of a given type.

### 12.3 Promo codes
`PromoStrategy`: applied at `hold` time; reduces price.

### 12.4 Real payment integration
Inject `PaymentGateway` interface. `confirm` calls `gateway.charge(token, amount)` synchronously; on failure, raises `InvalidPayment` and releases the hold.

### 12.5 Notifications
Observer pattern. Subscribe to `booking_created`; SMS/email integration.

### 12.6 Show rescheduling / cancellation
`reschedule_show(show_id, new_time)` — affected bookings are notified, rebooked or refunded.

### 12.7 Per-customer concurrent hold limit
Track `holds_by_customer`; reject if over N.

### 12.8 Distributed scaling
Move to DB-backed seats with row-level locks (`SELECT ... FOR UPDATE NOWAIT`). Service is horizontally stateless.

---

## 13. Cheat-Sheet Recap

1. **Problem:** Two-phase hold + confirm; concurrent-correct seat reservation.
2. **Core entities:** City, Cinema, Screen, Seat, Movie, Show, Hold, Booking.
3. **Patterns:** Strategy (pricing), State (seat/hold), Facade (system), Two-Phase Commit-light.
4. **Hardest design call:** Status on Show (per-show), not on Seat (physical).
5. **Concurrency:** Coarse RLock; per-show as scaling extension.
6. **Idempotency:** payment_token → booking_id mapping.
7. **Trade-offs:** Optimistic vs pessimistic — pessimistic for contention.

---

## Appendix A: Test cases

```
1. Basic hold + confirm + status = BOOKED.
2. 50 threads grab same 2 seats → exactly 1 wins.
3. Hold expires after 5 min → seats released, hold = EXPIRED.
4. Confirm after expiry → HoldExpired.
5. Idempotent confirm: same payment_token → same booking.
6. Explicit release works; double-release returns False.
7. Weekend pricing 25% uplift on Sat/Sun.
8. Hold contiguous failure when 1 seat is unavailable.
9. Pricing per seat type: regular/premium/recliner multipliers.
10. Multi-customer concurrent independent holds: no interference.
```

## Appendix B: Common Python-specific gotchas

```
- datetime.utcnow() is naive; production use datetime.now(timezone.utc).
- Decimal arithmetic with floats: wrap with Decimal(str(f)).
- enum.Enum members are singletons; compare with `is`.
- threading.RLock for re-entrant safety; we don't actually re-enter.
- mutating a dict while iterating: collect keys first.
- @dataclass(frozen=True) is shallow; hashable only if all fields hashable.
```

## Appendix C: Why this question is loved by interviewers

```
- Concurrency is unavoidable — tests real understanding.
- Two-phase commit is a real-world pattern.
- Idempotency on confirm is subtle (catches weak candidates).
- Hierarchy is rich (City → Cinema → Screen → Show → Seat).
- Domain extensions are endless (group, promo, refund, reschedule).
```

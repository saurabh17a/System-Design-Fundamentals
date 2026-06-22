# Hotel Booking — LLD (Python)

> **Difficulty:** Medium → Hard
> **Tags:** `[lld]` `[reservation]` `[date-ranges]` `[concurrency]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

Booking.com or Hotels.com at LLD scale. Hotels have rooms of different types. Customer picks dates → search shows available rooms → customer reserves → pays → gets confirmation. The hard part: many people booking at once for the **same room and same dates** must not double-book.

### Why solve it?

- **Real world**: Booking, Expedia, Marriott — any reservation system.
- **Teaches**: date-range overlap detection, atomic reservation, pricing per night/season.
- **Interview**: classic concurrency-meets-domain problem.

### Vocabulary

- **Hotel / Room / RoomType** — composition.
- **Date range** — `[check_in, check_out)` (check-in inclusive, check-out exclusive — standard convention).
- **Overlap** — two ranges that share at least one night.
- **Reservation** — room + range + guest + status.

### High-level approach

Entities:
- **Room** — id, type (Standard/Deluxe/Suite), hotel.
- **Reservation** — room, check_in, check_out, guest, status (PENDING/CONFIRMED/CANCELLED).
- **HotelService** — orchestrator.

Search flow: for date range `[a, b)`, return rooms with NO existing CONFIRMED reservation overlapping. Two intervals `[a, b)` and `[c, d)` overlap iff `a < d AND c < b`.

Booking flow under lock:
1. Re-check availability (it could have changed since search).
2. Create reservation with status CONFIRMED.

The lock matters: optimistic search + pessimistic book is the standard pattern.

### How to read this doc

- **Beginner**: focus on overlap detection.
- **Interview**: discuss search vs book separation, payment idempotency, cancellation.

---

## 1. Problem Statement

Hotel reservation system:
- Hotels with rooms (multiple types).
- Bookings span date ranges (check-in / check-out).
- Availability search: rooms available for given dates + type.
- Concurrent booking; first-comes-first-served.
- Cancellation, refunds.

---

## 2. Design

| Entity |
|---|
| `Hotel` (id, name, location) |
| `Room` (id, hotel_id, type, capacity, price_per_night) |
| `RoomType` enum |
| `Booking` (id, room_id, customer, check_in, check_out, total) |
| `HotelService` |

Pattern: Strategy (pricing — peak/off), Facade.

Date-range overlap: `start1 < end2 AND start2 < end1`.

---

## 3. Code

```python
"""Hotel Booking with date-range reservations."""
from __future__ import annotations
import enum
import threading
import uuid
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional


class RoomType(enum.Enum):
    SINGLE = "single"
    DOUBLE = "double"
    SUITE = "suite"


class HotelError(Exception): ...
class NotAvailable(HotelError): ...
class InvalidDates(HotelError): ...


@dataclass(frozen=True)
class Hotel:
    id: str
    name: str
    location: str


@dataclass(frozen=True)
class Room:
    id: str
    hotel_id: str
    room_type: RoomType
    capacity: int
    price_per_night: Decimal


@dataclass
class Booking:
    id: str
    room_id: str
    customer_id: str
    check_in: date
    check_out: date
    total: Decimal
    status: str = "active"  # active|cancelled


def _overlaps(a_start: date, a_end: date, b_start: date, b_end: date) -> bool:
    return a_start < b_end and b_start < a_end


class HotelService:
    def __init__(self):
        self._hotels: dict[str, Hotel] = {}
        self._rooms: dict[str, Room] = {}
        self._rooms_by_hotel: dict[str, list[Room]] = {}
        self._bookings: dict[str, Booking] = {}
        self._bookings_by_room: dict[str, list[Booking]] = {}
        self._lock = threading.RLock()

    def add_hotel(self, name: str, location: str) -> Hotel:
        h = Hotel(id=str(uuid.uuid4()), name=name, location=location)
        self._hotels[h.id] = h
        return h

    def add_room(self, hotel_id: str, room_type: RoomType, capacity: int,
                 price: Decimal) -> Room:
        r = Room(id=str(uuid.uuid4()), hotel_id=hotel_id,
                 room_type=room_type, capacity=capacity,
                 price_per_night=price)
        self._rooms[r.id] = r
        self._rooms_by_hotel.setdefault(hotel_id, []).append(r)
        return r

    def search_available(self, hotel_id: str, room_type: Optional[RoomType],
                         check_in: date, check_out: date) -> list[Room]:
        if check_out <= check_in:
            raise InvalidDates()
        with self._lock:
            avail: list[Room] = []
            for room in self._rooms_by_hotel.get(hotel_id, []):
                if room_type is not None and room.room_type is not room_type:
                    continue
                if self._is_available(room.id, check_in, check_out):
                    avail.append(room)
            return avail

    def _is_available(self, room_id: str, check_in: date, check_out: date) -> bool:
        for b in self._bookings_by_room.get(room_id, []):
            if b.status == "active" and _overlaps(b.check_in, b.check_out, check_in, check_out):
                return False
        return True

    def book(self, room_id: str, customer_id: str,
             check_in: date, check_out: date) -> Booking:
        if check_out <= check_in:
            raise InvalidDates()
        with self._lock:
            if not self._is_available(room_id, check_in, check_out):
                raise NotAvailable()
            room = self._rooms[room_id]
            nights = (check_out - check_in).days
            total = room.price_per_night * nights
            b = Booking(
                id=str(uuid.uuid4()), room_id=room_id, customer_id=customer_id,
                check_in=check_in, check_out=check_out, total=total,
            )
            self._bookings[b.id] = b
            self._bookings_by_room.setdefault(room_id, []).append(b)
            return b

    def cancel(self, booking_id: str) -> Decimal:
        with self._lock:
            b = self._bookings.get(booking_id)
            if b is None or b.status == "cancelled":
                raise HotelError("not active")
            b.status = "cancelled"
            return b.total  # refund all (real product: time-based policy)


# Tests
def main():
    svc = HotelService()
    h = svc.add_hotel("Grand", "NY")
    r1 = svc.add_room(h.id, RoomType.DOUBLE, 2, Decimal("100"))
    r2 = svc.add_room(h.id, RoomType.SUITE, 4, Decimal("250"))

    print("--- search ---")
    av = svc.search_available(h.id, RoomType.DOUBLE, date(2026, 1, 1), date(2026, 1, 4))
    assert len(av) == 1 and av[0].id == r1.id
    print("  OK")

    print("--- book and conflict ---")
    b1 = svc.book(r1.id, "alice", date(2026, 1, 5), date(2026, 1, 8))
    assert b1.total == Decimal("300")
    try:
        svc.book(r1.id, "bob", date(2026, 1, 6), date(2026, 1, 9))
    except NotAvailable:
        pass
    print("  OK")

    print("--- non-overlapping OK ---")
    b2 = svc.book(r1.id, "carol", date(2026, 1, 10), date(2026, 1, 12))
    assert b2.total == Decimal("200")
    print("  OK")

    print("--- cancel frees room ---")
    svc.cancel(b1.id)
    b3 = svc.book(r1.id, "dave", date(2026, 1, 5), date(2026, 1, 8))
    assert b3.id != b1.id
    print("  OK")

    print("--- concurrency ---")
    svc2 = HotelService()
    h2 = svc2.add_hotel("X", "X")
    r = svc2.add_room(h2.id, RoomType.SINGLE, 1, Decimal("50"))
    succ = []
    succ_lock = threading.Lock()
    failed = 0
    failed_lock = threading.Lock()
    def fire(i):
        nonlocal failed
        try:
            b = svc2.book(r.id, f"u-{i}", date(2026, 6, 1), date(2026, 6, 3))
            with succ_lock:
                succ.append(b.id)
        except NotAvailable:
            with failed_lock:
                failed += 1
    threads = [threading.Thread(target=fire, args=(i,)) for i in range(50)]
    for t in threads: t.start()
    for t in threads: t.join()
    assert len(succ) == 1
    assert failed == 49
    print(f"  exactly 1 won, {failed} failed")

    print("\nAll tests passed.")


if __name__ == "__main__":
    main()
```

---

## 4. Cheat-Sheet
1. Bookings: list per room.
2. Availability check: any active booking overlap?
3. Date-range overlap: `a.start < b.end AND b.start < a.end`.
4. Coarse lock for atomic check-and-claim.
5. Per-room linear scan; for huge ranges, switch to interval tree.

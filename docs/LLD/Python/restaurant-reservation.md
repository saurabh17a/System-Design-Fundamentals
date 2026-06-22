# Restaurant Reservation — LLD (Python)

> **Difficulty:** Medium → Hard
> **Tags:** `[lld]` `[reservation]` `[time-slots]` `[concurrency]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

OpenTable. Restaurant has tables of various sizes. Customer requests "table for 4 at 7pm Saturday". System finds an available table at that time, reserves it, sends confirmation. 30-minute slots typically; many restaurants run 2-hour seatings.

### Why solve it?

- **Real world**: OpenTable, Resy, restaurant booking.
- **Teaches**: time-slot allocation, party-size matching, holds, no-shows.

### Vocabulary

- **Table** — has a capacity.
- **Slot** — a time window (e.g., 7:00-9:00pm).
- **Reservation** — table + slot + party size + status.
- **Walk-in** — un-reserved guests.

### High-level approach

Entities: **Restaurant**, **Table** (capacity), **Slot** (start_time, duration), **Reservation** (PENDING / CONFIRMED / CANCELLED / NO_SHOW).

Search: party_size + datetime → find tables with capacity ≥ party_size and no overlapping confirmed reservation in that slot.

Booking under lock: re-validate, create reservation.

For walk-ins, pick smallest free table that fits.

### How to read this doc

- **Beginner**: focus on slot + capacity matching.
- **Interview**: discuss waitlists, no-show penalties, dynamic pricing.

---

## 1. Problem

OpenTable-style booking:
- Restaurant has tables of various sizes.
- Bookings are time-slotted (e.g. 7-9 PM slot).
- Match party size to table.
- Concurrent: first to claim wins.

---

## 2. Code

```python
"""Restaurant Reservation."""
from __future__ import annotations
import enum
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional


class ResError(Exception): ...
class NoTableAvailable(ResError): ...


@dataclass(frozen=True)
class Restaurant:
    id: str
    name: str
    location: str


@dataclass
class Table:
    id: str
    restaurant_id: str
    seats: int


@dataclass
class Reservation:
    id: str
    table_id: str
    customer_id: str
    party_size: int
    start: datetime
    end: datetime
    status: str = "active"


def _overlaps(a_start: datetime, a_end: datetime,
              b_start: datetime, b_end: datetime) -> bool:
    return a_start < b_end and b_start < a_end


class ReservationService:
    def __init__(self, dining_window: timedelta = timedelta(hours=2)):
        self._restaurants: dict[str, Restaurant] = {}
        self._tables: dict[str, Table] = {}
        self._tables_by_rest: dict[str, list[Table]] = {}
        self._reservations: dict[str, Reservation] = {}
        self._reservations_by_table: dict[str, list[Reservation]] = {}
        self._dining_window = dining_window
        self._lock = threading.RLock()

    def add_restaurant(self, name: str, loc: str) -> Restaurant:
        r = Restaurant(id=str(uuid.uuid4()), name=name, location=loc)
        self._restaurants[r.id] = r
        return r

    def add_table(self, restaurant_id: str, seats: int) -> Table:
        t = Table(id=str(uuid.uuid4()), restaurant_id=restaurant_id, seats=seats)
        self._tables[t.id] = t
        self._tables_by_rest.setdefault(restaurant_id, []).append(t)
        return t

    def search_availability(self, restaurant_id: str, start: datetime,
                            party_size: int) -> list[Table]:
        with self._lock:
            end = start + self._dining_window
            avail: list[Table] = []
            tables = self._tables_by_rest.get(restaurant_id, [])
            tables.sort(key=lambda t: t.seats)  # smallest fit first
            for t in tables:
                if t.seats < party_size:
                    continue
                if self._is_available(t.id, start, end):
                    avail.append(t)
            return avail

    def reserve(self, table_id: str, customer_id: str,
                start: datetime, party_size: int) -> Reservation:
        with self._lock:
            table = self._tables[table_id]
            if table.seats < party_size:
                raise NoTableAvailable(f"table seats {table.seats} < party {party_size}")
            end = start + self._dining_window
            if not self._is_available(table_id, start, end):
                raise NoTableAvailable()
            r = Reservation(
                id=str(uuid.uuid4()), table_id=table_id, customer_id=customer_id,
                party_size=party_size, start=start, end=end,
            )
            self._reservations[r.id] = r
            self._reservations_by_table.setdefault(table_id, []).append(r)
            return r

    def cancel(self, reservation_id: str) -> None:
        with self._lock:
            r = self._reservations.get(reservation_id)
            if r is None or r.status != "active":
                return
            r.status = "cancelled"

    def _is_available(self, table_id: str, start: datetime, end: datetime) -> bool:
        for r in self._reservations_by_table.get(table_id, []):
            if r.status == "active" and _overlaps(r.start, r.end, start, end):
                return False
        return True


# Tests
def main():
    svc = ReservationService()
    rest = svc.add_restaurant("La Cucina", "NY")
    t2 = svc.add_table(rest.id, 2)
    t4 = svc.add_table(rest.id, 4)
    t8 = svc.add_table(rest.id, 8)

    print("--- best fit search ---")
    avail = svc.search_availability(rest.id, datetime(2026, 5, 18, 19), party_size=3)
    # 4-seat table preferred over 8
    assert avail[0].id == t4.id
    print("  OK")

    print("--- reserve ---")
    r = svc.reserve(t4.id, "alice", datetime(2026, 5, 18, 19), party_size=3)
    print(f"  {r.id}")

    print("--- conflict ---")
    try:
        svc.reserve(t4.id, "bob", datetime(2026, 5, 18, 20), party_size=2)
    except NoTableAvailable:
        pass
    print("  OK")

    print("--- non-overlap (after dining window) ---")
    r2 = svc.reserve(t4.id, "carol", datetime(2026, 5, 18, 21, 30), party_size=2)
    print(f"  {r2.id}")

    print("--- party too big ---")
    try:
        svc.reserve(t2.id, "dave", datetime(2026, 5, 18, 19), party_size=4)
    except NoTableAvailable:
        pass
    print("  OK")

    print("--- cancel + rebook ---")
    svc.cancel(r.id)
    r3 = svc.reserve(t4.id, "eve", datetime(2026, 5, 18, 19), party_size=4)
    assert r3.id != r.id
    print("  OK")

    print("\nAll tests passed.")


if __name__ == "__main__":
    main()
```

---

## 3. Cheat-Sheet
1. Restaurants → Tables of various sizes.
2. Reservations span dining window (2 hr default).
3. Best fit by smallest table that fits party.
4. Overlap check; coarse lock.

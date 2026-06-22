# Cab Booking — LLD (Python)

> **Difficulty:** Medium → Hard
> **Tags:** `[lld]` `[matching]` `[state]` `[concurrency]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

Uber/Lyft at LLD scale. A rider opens the app, taps "request ride." The system finds the nearest available driver, sends them the request, the driver accepts, picks up the rider, drops off, payment happens. We're modeling that flow without the GPS or maps — just the entities and state machines.

### Why solve it?

- **Real world**: any matching marketplace (food delivery, courier, freelance).
- **Teaches**: matching, state machines (ride status), concurrency (no double-assigning a driver), pricing strategies.
- **Interview**: tests handling many states and concurrent operations cleanly.

### Vocabulary

- **Rider / Driver** — users with state.
- **Ride** — a transaction connecting them.
- **Status** — REQUESTED → ASSIGNED → IN_PROGRESS → COMPLETED / CANCELLED.
- **Surge** — pricing multiplier when demand > supply.
- **Matching** — algorithm to pick a driver (nearest, highest rating, fewest cancels).

### High-level approach

Entities:
- **User**: Rider, Driver. Driver has state: AVAILABLE / EN_ROUTE / OFFLINE.
- **Location**: lat/long.
- **Ride**: rider, driver, pickup, drop, status, fare.
- **MatchingStrategy**: pick driver from candidates.
- **PricingStrategy**: base + per-km/min + surge.
- **CabService**: orchestrates everything.

Flow:
1. Rider requests → service finds candidate drivers (in radius, available).
2. MatchingStrategy picks one → atomically reserve driver (avoid double-book).
3. Driver accepts/rejects → on accept, status = ASSIGNED.
4. Pickup → IN_PROGRESS. Drop → COMPLETED. Compute fare. Process payment.

The atomic driver reservation is the concurrency hot point.

### How to read this doc

- **Beginner**: focus on the state machine and entities first.
- **Interview**: matching algorithm choices and concurrency details are the differentiators.

---

## 1. Problem Statement

Uber-style ride-hailing at LLD level:
- Riders request rides.
- System matches with nearest available driver.
- Driver accepts/rejects with timeout.
- Ride state machine.
- Pricing.

(For HLD, see `HLD/uber.md`.)

---

## 2. Design

| Entity |
|---|
| `Driver` (id, location, status) |
| `Rider` (id, current_ride) |
| `Ride` (id, rider, driver, origin, dest, state, fare) |
| `MatchingStrategy` (interface) |
| `PricingStrategy` |
| `CabService` |

State machine: REQUESTED → MATCHED → IN_PROGRESS → COMPLETED | CANCELLED.

---

## 3. Code

```python
"""Cab Booking LLD."""
from __future__ import annotations
import enum
import math
import threading
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional


class DriverStatus(enum.Enum):
    OFFLINE = "offline"
    AVAILABLE = "available"
    EN_ROUTE = "en_route"
    WITH_RIDER = "with_rider"


class RideState(enum.Enum):
    REQUESTED = "requested"
    MATCHED = "matched"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class CabError(Exception): ...
class NoDriversAvailable(CabError): ...


@dataclass
class Location:
    lat: float
    lng: float

    def distance(self, other: "Location") -> float:
        # Euclidean approx (good enough for LLD)
        return math.hypot(self.lat - other.lat, self.lng - other.lng)


@dataclass
class Driver:
    id: str
    name: str
    location: Location
    status: DriverStatus = DriverStatus.OFFLINE


@dataclass
class Ride:
    id: str
    rider_id: str
    origin: Location
    destination: Location
    state: RideState = RideState.REQUESTED
    driver_id: Optional[str] = None
    fare: Optional[Decimal] = None


class MatchingStrategy(ABC):
    @abstractmethod
    def match(self, origin: Location, drivers: list[Driver]) -> Optional[Driver]:
        ...


class NearestAvailableMatcher(MatchingStrategy):
    def match(self, origin, drivers):
        avail = [d for d in drivers if d.status is DriverStatus.AVAILABLE]
        if not avail:
            return None
        return min(avail, key=lambda d: d.location.distance(origin))


class PricingStrategy(ABC):
    @abstractmethod
    def fare(self, origin: Location, dest: Location) -> Decimal:
        ...


class FlatRatePricing(PricingStrategy):
    def __init__(self, per_unit: Decimal):
        self.per_unit = per_unit

    def fare(self, origin, dest):
        d = origin.distance(dest)
        return Decimal(str(d)) * self.per_unit


class CabService:
    def __init__(self, matcher: MatchingStrategy, pricing: PricingStrategy):
        self._drivers: dict[str, Driver] = {}
        self._rides: dict[str, Ride] = {}
        self._matcher = matcher
        self._pricing = pricing
        self._lock = threading.RLock()

    def register_driver(self, name: str, loc: Location) -> Driver:
        d = Driver(id=str(uuid.uuid4()), name=name, location=loc, status=DriverStatus.AVAILABLE)
        self._drivers[d.id] = d
        return d

    def update_driver_loc(self, driver_id: str, loc: Location) -> None:
        with self._lock:
            self._drivers[driver_id].location = loc

    def request_ride(self, rider_id: str, origin: Location, dest: Location) -> Ride:
        with self._lock:
            ride = Ride(id=str(uuid.uuid4()), rider_id=rider_id,
                        origin=origin, destination=dest)
            ride.fare = self._pricing.fare(origin, dest)
            self._rides[ride.id] = ride
            driver = self._matcher.match(origin, list(self._drivers.values()))
            if driver is None:
                ride.state = RideState.CANCELLED
                raise NoDriversAvailable()
            driver.status = DriverStatus.EN_ROUTE
            ride.driver_id = driver.id
            ride.state = RideState.MATCHED
            return ride

    def driver_arrived(self, ride_id: str) -> None:
        with self._lock:
            ride = self._rides[ride_id]
            assert ride.state is RideState.MATCHED
            self._drivers[ride.driver_id].status = DriverStatus.WITH_RIDER
            ride.state = RideState.IN_PROGRESS

    def complete_ride(self, ride_id: str, drop_loc: Optional[Location] = None) -> Ride:
        with self._lock:
            ride = self._rides[ride_id]
            assert ride.state is RideState.IN_PROGRESS
            ride.state = RideState.COMPLETED
            d = self._drivers[ride.driver_id]
            if drop_loc:
                d.location = drop_loc
            d.status = DriverStatus.AVAILABLE
            return ride

    def cancel_ride(self, ride_id: str) -> None:
        with self._lock:
            ride = self._rides[ride_id]
            if ride.state in (RideState.COMPLETED, RideState.CANCELLED):
                return
            ride.state = RideState.CANCELLED
            if ride.driver_id:
                self._drivers[ride.driver_id].status = DriverStatus.AVAILABLE


# Tests
def main():
    svc = CabService(
        matcher=NearestAvailableMatcher(),
        pricing=FlatRatePricing(per_unit=Decimal("10")),
    )
    d1 = svc.register_driver("Alice", Location(0, 0))
    d2 = svc.register_driver("Bob", Location(5, 5))

    print("--- match nearest ---")
    ride = svc.request_ride("rider1", Location(1, 1), Location(2, 2))
    assert ride.driver_id == d1.id
    print(f"  matched: {ride.driver_id}")

    print("--- driver busy → second request goes to other ---")
    ride2 = svc.request_ride("rider2", Location(4, 4), Location(6, 6))
    assert ride2.driver_id == d2.id
    print(f"  matched: {ride2.driver_id}")

    print("--- no drivers ---")
    try:
        svc.request_ride("rider3", Location(0, 0), Location(1, 1))
    except NoDriversAvailable:
        pass
    print("  OK")

    print("--- complete ---")
    svc.driver_arrived(ride.id)
    svc.complete_ride(ride.id, drop_loc=Location(2, 2))
    assert ride.state is RideState.COMPLETED
    assert svc._drivers[d1.id].status is DriverStatus.AVAILABLE
    print("  OK")

    print("--- new rider after completion ---")
    ride3 = svc.request_ride("rider4", Location(2, 2), Location(3, 3))
    assert ride3.driver_id == d1.id
    print("  OK")

    print("--- fare calculation ---")
    # Free up everyone first
    for r_id, r_ride in list(svc._rides.items()):
        if r_ride.state is RideState.MATCHED:
            svc.cancel_ride(r_id)
        elif r_ride.state is RideState.IN_PROGRESS:
            svc.complete_ride(r_id)
    r = svc.request_ride("rider5", Location(0, 0), Location(3, 4))
    # distance = 5
    assert r.fare is not None
    print(f"  fare={r.fare}")

    print("\nAll tests passed.")


if __name__ == "__main__":
    main()
```

---

## 4. Cheat-Sheet
1. Driver state: OFFLINE → AVAILABLE → EN_ROUTE → WITH_RIDER → AVAILABLE.
2. Ride state machine: REQUESTED → MATCHED → IN_PROGRESS → COMPLETED.
3. Strategy: matcher (nearest, balanced); pricing.
4. Lock for atomic match-and-claim driver.

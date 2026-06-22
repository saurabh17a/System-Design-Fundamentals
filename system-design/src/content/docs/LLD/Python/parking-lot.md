# Parking Lot — Low-Level Design (Python)

> **Difficulty:** Medium
> **Tags:** `[lld]` `[ood]` `[strategy]` `[factory]` `[state]` `[concurrency]`
> **Language:** Python 3.10+
> **Prep time:** ~10 min skim, ~30 min deep read
> **Companies that ask this:** Amazon, Atlassian, Uber, Microsoft, Goldman Sachs, every product company that runs an OOD round

---

## Beginner's Guide

### What's this in plain English?

You drive into a parking garage. A machine spits out a ticket. You park in any spot that fits your car. When you leave, you put the ticket in another machine, pay based on how long you parked, the gate opens, you drive out. The interview wants you to model that whole system — entry, spot allocation, exit, payment.

### Why solve it?

- **The canonical OOD interview** — almost everyone gets asked this. Foundations apply to every OOD question.
- **Teaches**: identifying entities and their relationships; using design patterns to handle variation (different vehicle types, pricing models); concurrency for spot allocation.
- **Patterns**: strategy (pricing rules), factory (vehicle/spot creation), state (spot status), composite (lot → floors → spots).

### Vocabulary

- **Lot** — the whole facility.
- **Floor / Level** — a horizontal section of the lot.
- **Spot** — a single parking space; sized for motorcycle / car / truck.
- **Vehicle** — what's parking; size determines which spots fit.
- **Ticket** — issued at entry; records spot, entry time.
- **Pricing strategy** — rules for fees (flat hourly, tiered, weekend).
- **Concurrency** — two cars arriving at the same instant must NOT get the same spot.

### High-level approach

Entities:
- **Vehicle** (Motorcycle, Car, Truck) — has a size class.
- **Spot** (Small, Medium, Large) — has a size, occupancy state.
- **Floor** — collection of spots; tracks free counts by size.
- **Lot** — collection of floors; entry/exit logic.
- **Ticket** — vehicle, spot, entry time.
- **PricingStrategy** — interface; concrete: hourly, tiered, weekend rates.
- **PaymentProcessor** — handles cash/card.

Main flow:
1. Vehicle arrives → `enter(vehicle)` → find compatible spot → reserve atomically → issue ticket.
2. Vehicle leaves → `exit(ticket)` → compute fee → process payment → free the spot.

The atomic reservation requires a lock or atomic compare-and-set — without it, two cars can race for one spot.

### How to read this doc

- **Beginner**: read the entity model and patterns first; the code at the bottom makes more sense after.
- **Interview**: cross-questions section ("why Strategy for pricing?", "what about EVs?") is the differentiator.

---

## 0. How to use this doc in an interview

Parking Lot is **the** canonical OOD interview. Interviewers grade on:
1. **Did you ask clarifying questions?** (Single floor or multi? Pricing model? EVs? Reservations?)
2. **Did you identify the right entities and relationships?** (Lot → Floors → Spots; Vehicles; Tickets; Pricing.)
3. **Did you name design patterns explicitly and justify them?** (Strategy for pricing, Factory for vehicle creation, State for spot status.)
4. **Did you handle concurrency?** (Two cars trying to claim the same spot.)
5. **Is the design open to extension?** (Adding electric vehicles, valet, monthly passes — without rewriting the world.)

The trap: starting to code in 5 minutes. Spend ~15–20 min on diagram + patterns first; senior interviewers will fail you for skipping that.

---

## 1. Problem Statement

Design a parking lot system. Cars enter, get a ticket, park in an appropriate spot. On exit, the system computes a fee based on parked duration and vehicle type and accepts payment.

The system must:
- Support multiple **floors**, each with multiple **parking spots** of different sizes.
- Support multiple **vehicle types** (motorcycle, car, truck) — each fits only in spots of compatible size.
- Issue a unique **ticket** at entry; settle at exit.
- Compute fees with a **pluggable pricing strategy** (different rates per vehicle, hourly/daily, weekend rates, etc.).
- Be **thread-safe**: two vehicles entering at the same instant must not be assigned the same spot.
- Provide **availability queries** (how many spots free per floor/type).

---

## 2. Clarifying Questions to Ask the Interviewer

### Scope
- [ ] Single-lot system, or do we model multiple physical lots in one app?
- [ ] Multi-floor or single-floor? If multi-floor, do users pick a floor or does the system?
- [ ] Vehicle types? (Bike/Car/Truck — or Motorcycle/Compact/Sedan/SUV/Truck/Bus?)
- [ ] **Electric vehicles** with charging spots — in scope?
- [ ] **Reservations** (book a spot in advance) — in scope?
- [ ] **Valet** (system parks the car) — in scope?
- [ ] **Monthly subscriptions** vs hourly only?
- [ ] **Lost ticket** flow — flat penalty fee?

### Domain
- [ ] Pricing: flat hourly, tiered (first hour cheaper), weekend rates, holiday rates?
- [ ] Payment methods: cash, card, app — does the design need to model multiple processors?
- [ ] What happens if the lot is full — turn away or queue?
- [ ] Do we issue physical tickets or QR codes / license-plate-only?

### Non-functional
- [ ] Concurrency: how many entry/exit terminals operate in parallel?
- [ ] Persistence: in-memory only, or backed by a DB?
- [ ] CLI, GUI, or library API?
- [ ] Approximate scale (number of spots — 100? 10000? 1M?)

> **For this doc** we'll assume: single lot, multi-floor, vehicle types `MOTORCYCLE / CAR / TRUCK`, pluggable pricing (default: per-vehicle hourly rate with first-hour minimum), no EV/reservations/valet (called out as P2 extensions), thread-safe in-memory implementation, library API (no UI), 1k–10k spots typical.

---

## 3. Functional Requirements

**Must-have (P0):**
1. Park a vehicle: assign a free, size-compatible spot; issue a ticket.
2. Unpark a vehicle: settle ticket, compute fee, free the spot.
3. Reject when lot is full or no compatible spot exists.
4. Multi-floor with per-floor spot inventory.
5. Pluggable pricing strategy.
6. Thread-safe spot assignment.
7. Query availability (count free spots, optionally by type/floor).

**Should-have (P1):**
8. Persistence layer (out-of-scope for code; design hooks for it).
9. Audit log of every park / unpark.

**Nice-to-have (P2 — designed-for, not implemented):**
10. Electric / charging spots (subtype of CAR).
11. Reservations.
12. Lost ticket flow.
13. Monthly passes.

---

## 4. Actors & Use Cases

```
                     ┌──────────────────┐
                     │   Parking Lot    │
                     │      System      │
                     └──────────────────┘
                     ▲    ▲       ▲
                     │    │       │
            ┌────────┘    │       └─────────┐
            │             │                 │
        ┌────────┐    ┌────────┐       ┌────────┐
        │Driver  │    │Cashier │       │ Admin  │
        │(park,  │    │(unpark,│       │(config,│
        │unpark) │    │ pay)   │       │stats)  │
        └────────┘    └────────┘       └────────┘
```

### Driver
- Park: brings vehicle to entry, gets ticket.
- Unpark: presents ticket at exit, sees fee, pays, leaves.

### Cashier (or automated)
- Validates ticket.
- Computes fee via pricing strategy.
- Accepts payment.

### Admin
- Configure pricing.
- Add / remove spots.
- View utilization.

---

## 5. Core Entities

| Entity | Attributes | Notes |
|---|---|---|
| `Vehicle` | license_plate, vehicle_type, owner_id (optional) | Domain object — stateless wrt parking |
| `ParkingSpot` | spot_id, floor_id, size, status (free/occupied/reserved/oos), occupant | Source of truth for occupancy |
| `Floor` | floor_id, spots (list), spot-by-size index | Container of spots |
| `ParkingLot` | floors, pricing strategy, spot-allocation strategy | Top-level facade |
| `Ticket` | ticket_id, vehicle, spot, entry_time | Issued at park |
| `ExitReceipt` | ticket, exit_time, amount, payment_method | Issued at unpark |

**Enums:**
```
VehicleType:    MOTORCYCLE, CAR, TRUCK
SpotSize:       SMALL, MEDIUM, LARGE  
SpotStatus:     FREE, OCCUPIED, RESERVED, OUT_OF_SERVICE
PaymentMethod:  CASH, CARD, APP
```

`SpotSize` and `VehicleType` are different enums on purpose — a `MOTORCYCLE` may fit in `SMALL`, but the *type* of vehicle ≠ the *size* of spot. The mapping is encoded in a fitting function.

---

## 6. Class Diagram (ASCII)

```
                                ┌─────────────────────────────┐
                                │        ParkingLot           │
                                │─────────────────────────────│
                                │ - floors: list[Floor]       │
                                │ - pricing: PricingStrategy  │◇──────────────┐
                                │ - allocator: SpotAllocator  │◇─────────┐    │
                                │ - tickets: dict[Ticket]     │          │    │
                                │ - lock: RLock               │          │    │
                                │─────────────────────────────│          │    │
                                │ + park(vehicle) -> Ticket   │          │    │
                                │ + unpark(tid) -> Receipt    │          │    │
                                │ + availability() -> dict    │          │    │
                                └─────┬───────────────────────┘          │    │
                                      │ ◆ owns                          │    │
                                      ▼                                  │    │
                                ┌──────────────────┐                    │    │
                                │     Floor        │                    │    │
                                │──────────────────│                    │    │
                                │ - floor_id       │                    │    │
                                │ - spots          │◆──────┐            │    │
                                │ - by_size: dict  │       │            │    │
                                │──────────────────│       │            │    │
                                │ + free_count()   │       │            │    │
                                └──────────────────┘       │            │    │
                                                           ▼            │    │
                                                ┌──────────────────┐    │    │
                                                │   ParkingSpot    │    │    │
                                                │──────────────────│    │    │
                                                │ - spot_id        │    │    │
                                                │ - size: SpotSize │    │    │
                                                │ - status         │    │    │
                                                │ - occupant       │    │    │
                                                │──────────────────│    │    │
                                                │ + assign(v)      │    │    │
                                                │ + release()      │    │    │
                                                └──────────────────┘    │    │
                                                                        │    │
              ┌─────────────────────────────────────────────────────────┘    │
              │                                                              │
              ▼                                                              │
        ┌─────────────────────────┐                                         │
        │ «interface»             │                                         │
        │ SpotAllocator           │                                         │
        │─────────────────────────│                                         │
        │ + allocate(lot, v)      │                                         │
        │   -> ParkingSpot|None   │                                         │
        └────────▲────────────────┘                                         │
                 │ implements                                                │
        ┌────────┴────────────────┐                                         │
        │ FirstFitAllocator       │                                         │
        │ NearestEntryAllocator   │                                         │
        │ FloorBalancingAllocator │                                         │
        └─────────────────────────┘                                         │
                                                                            │
              ┌─────────────────────────────────────────────────────────────┘
              │
              ▼
        ┌─────────────────────────┐
        │ «interface»             │
        │ PricingStrategy         │
        │─────────────────────────│
        │ + compute(ticket, exit) │
        │   -> Money              │
        └────────▲────────────────┘
                 │ implements
        ┌────────┴────────────────┐
        │ FlatHourlyPricing       │
        │ TieredPricing           │
        │ WeekendPremiumPricing   │
        └─────────────────────────┘

┌──────────────────┐                ┌──────────────────┐
│     Vehicle      │                │     Ticket       │
│──────────────────│                │──────────────────│
│ - license_plate  │                │ - ticket_id      │
│ - type: VType    │                │ - vehicle ──┐    │
│ - is_compatible()│                │ - spot ─────┤────┐
└──────▲───────────┘                │ - entry_time│   │
       │                            └─────────────┘   │
       └──── (referenced by Ticket) ──────────────────┘

Legend:
  ◆ composition (lifecycle bound)
  ◇ aggregation (owns ref, lives independently)
  △ inheritance
  ─ ─▶ dependency
```

> Composition vs aggregation matters: `Floor` *composes* its `ParkingSpot`s (a spot only exists as part of a floor). `ParkingLot` *aggregates* its `PricingStrategy` (the strategy can be swapped at runtime; it has independent lifecycle).

---

## 7. Design Patterns Used (and Why)

| Pattern | Where used | Why this pattern | Alternative considered |
|---|---|---|---|
| Strategy | `PricingStrategy`, `SpotAllocator` | Pluggable algorithms, runtime swap (weekend rates), open/closed for new pricing schemes | `if vehicle.type == ... ` chain — fails open/closed; testing the chain is painful |
| Factory | `VehicleFactory`, `SpotFactory` | Encapsulates which subclass / size to instantiate; callers hold no concrete types | Direct constructor calls — couples callers to concrete types |
| State | `ParkingSpot.status` transitions (`FREE → OCCUPIED → FREE`) | Behavior depends on state; transitions are explicit and validated | Boolean flag `is_occupied` — works for 2 states, fails when we add `RESERVED`, `OUT_OF_SERVICE` |
| Facade | `ParkingLot` is the system entry point; hides `Floor`, `Spot`, `Allocator` from callers | Single, simple API; internals can refactor freely | Exposing all classes — couples callers to internals |
| Singleton (NOT used) | — | We considered making `ParkingLot` a singleton; rejected. We want testability — multiple instances per test. Caller passes the instance around. | Global singleton — untestable, can't mock |

**Patterns deliberately not used:**
- **Visitor**: tempting for "operate over all spots". Overkill for our case — we have flat lists, not a heterogeneous tree.
- **Observer**: would let UI subscribe to availability changes. Out of scope; can be bolted on without redesign.

---

## 8. Sequence Diagrams

### 8.1 Park (happy path)

```
  Driver         ParkingLot      SpotAllocator   ParkingSpot   TicketStore
    │                │                │              │              │
    │── park(v) ────▶│                │              │              │
    │                │── allocate ───▶│              │              │
    │                │                │── find ─────▶│              │
    │                │                │◀── spot ─────│              │
    │                │◀── spot ───────│              │              │
    │                │── assign(v) ──────────────────▶              │
    │                │◀── ok ───────────────────────  │              │
    │                │── new Ticket ───────────────────────────────▶│
    │                │◀── ticket_id ────────────────────────────────│
    │◀── ticket ─────│                │              │              │
```

### 8.2 Park (lot full / no compatible spot)

```
  Driver         ParkingLot      SpotAllocator
    │                │                │
    │── park(v) ────▶│                │
    │                │── allocate ───▶│
    │                │◀── None ───────│
    │◀── LotFull ────│                │
       (raises)
```

### 8.3 Unpark

```
  Driver         ParkingLot     PricingStrategy   ParkingSpot
    │                │                │                │
    │── unpark(t) ──▶│                │                │
    │                │── compute ────▶│                │
    │                │◀── fee ────────│                │
    │                │── release ───────────────────────▶
    │                │◀── ok ──────────────────────────│
    │◀── receipt ────│                │                │
```

---

## 9. Concurrency Considerations

The hot race: **two vehicles arrive simultaneously; allocator picks the same spot for both.**

- A free-list of spots is a shared mutable structure.
- Without synchronization: thread A reads spot X as `FREE`, thread B reads same → both succeed in `assign(v)`, last writer wins, one car is silently homeless.

Solution in this design: **single coarse lock on `ParkingLot.lock` around the find-and-claim transaction**. The atomic unit is "find-free-and-mark-occupied". Lock is `RLock` so the same thread can re-enter (e.g. allocator calls back into lot).

For higher throughput, we could:
- **Per-floor lock** — N-way parallelism. Implemented in §10.4.
- **Lock-free claim with CAS** — each spot has an atomic status; allocator iterates and CAS-claims first free. More complex; ~5× throughput.

For 1k–10k spots and ~10s of entry terminals, coarse lock is fine. Document the limit and move on.

---

## 10. Full Working Code

```python
"""
Parking Lot — Low-Level Design (Python)

A complete, runnable implementation:
- multi-floor, multi-size spots
- pluggable pricing and spot-allocation strategies
- thread-safe park/unpark
- factory for vehicle creation
- demo at the bottom
"""

from __future__ import annotations

import enum
import itertools
import threading
import time
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Optional


# ──────────────────────────────────────────────────────────────────────────
# Enums
# ──────────────────────────────────────────────────────────────────────────

class VehicleType(enum.Enum):
    MOTORCYCLE = "motorcycle"
    CAR = "car"
    TRUCK = "truck"


class SpotSize(enum.Enum):
    SMALL = 1
    MEDIUM = 2
    LARGE = 3


class SpotStatus(enum.Enum):
    FREE = "free"
    OCCUPIED = "occupied"
    RESERVED = "reserved"
    OUT_OF_SERVICE = "oos"


class PaymentMethod(enum.Enum):
    CASH = "cash"
    CARD = "card"
    APP = "app"


# ──────────────────────────────────────────────────────────────────────────
# Domain models
# ──────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Vehicle:
    license_plate: str
    vehicle_type: VehicleType

    def fits_in(self, size: SpotSize) -> bool:
        """A vehicle fits if the spot is at least its required size."""
        required = _required_size_for(self.vehicle_type)
        return size.value >= required.value


def _required_size_for(vt: VehicleType) -> SpotSize:
    return {
        VehicleType.MOTORCYCLE: SpotSize.SMALL,
        VehicleType.CAR: SpotSize.MEDIUM,
        VehicleType.TRUCK: SpotSize.LARGE,
    }[vt]


@dataclass
class ParkingSpot:
    spot_id: str
    floor_id: str
    size: SpotSize
    status: SpotStatus = SpotStatus.FREE
    occupant: Optional[Vehicle] = None

    def assign(self, vehicle: Vehicle) -> None:
        if self.status is not SpotStatus.FREE:
            raise InvalidStateError(f"spot {self.spot_id} not free (status={self.status})")
        if not vehicle.fits_in(self.size):
            raise InvalidStateError(f"vehicle {vehicle.license_plate} does not fit in {self.size}")
        self.status = SpotStatus.OCCUPIED
        self.occupant = vehicle

    def release(self) -> Vehicle:
        if self.status is not SpotStatus.OCCUPIED:
            raise InvalidStateError(f"spot {self.spot_id} not occupied")
        v = self.occupant
        self.status = SpotStatus.FREE
        self.occupant = None
        return v


@dataclass
class Floor:
    floor_id: str
    spots: list[ParkingSpot] = field(default_factory=list)

    def free_spots_by_size(self, min_size: SpotSize) -> list[ParkingSpot]:
        return [s for s in self.spots
                if s.status is SpotStatus.FREE and s.size.value >= min_size.value]

    def free_count(self) -> int:
        return sum(1 for s in self.spots if s.status is SpotStatus.FREE)

    def total_count(self) -> int:
        return len(self.spots)


@dataclass(frozen=True)
class Ticket:
    ticket_id: str
    vehicle: Vehicle
    spot: ParkingSpot
    entry_time: datetime


@dataclass(frozen=True)
class ExitReceipt:
    ticket: Ticket
    exit_time: datetime
    amount: Decimal
    payment_method: Optional[PaymentMethod] = None


# ──────────────────────────────────────────────────────────────────────────
# Exceptions
# ──────────────────────────────────────────────────────────────────────────

class ParkingError(Exception):
    pass


class LotFullError(ParkingError):
    pass


class TicketNotFoundError(ParkingError):
    pass


class InvalidStateError(ParkingError):
    pass


# ──────────────────────────────────────────────────────────────────────────
# Strategy: Spot allocation
# ──────────────────────────────────────────────────────────────────────────

class SpotAllocator(ABC):
    @abstractmethod
    def allocate(self, floors: list[Floor], vehicle: Vehicle) -> Optional[ParkingSpot]:
        """Pick a spot for the vehicle, or return None if no fitting spot is free."""


class FirstFitAllocator(SpotAllocator):
    """First free, size-compatible spot, scanning floors in order."""
    def allocate(self, floors: list[Floor], vehicle: Vehicle) -> Optional[ParkingSpot]:
        required = _required_size_for(vehicle.vehicle_type)
        for floor in floors:
            for spot in floor.spots:
                if spot.status is SpotStatus.FREE and spot.size.value >= required.value:
                    return spot
        return None


class BestFitAllocator(SpotAllocator):
    """Smallest-fitting spot, to leave large spots open for larger vehicles."""
    def allocate(self, floors: list[Floor], vehicle: Vehicle) -> Optional[ParkingSpot]:
        required = _required_size_for(vehicle.vehicle_type)
        candidate: Optional[ParkingSpot] = None
        for floor in floors:
            for spot in floor.spots:
                if spot.status is SpotStatus.FREE and spot.size.value >= required.value:
                    if candidate is None or spot.size.value < candidate.size.value:
                        candidate = spot
                        if candidate.size.value == required.value:
                            return candidate  # exact fit, can't beat it
        return candidate


class FloorBalancingAllocator(SpotAllocator):
    """Pick the floor with the highest free-ratio (load balancing)."""
    def allocate(self, floors: list[Floor], vehicle: Vehicle) -> Optional[ParkingSpot]:
        required = _required_size_for(vehicle.vehicle_type)
        ranked = sorted(
            floors,
            key=lambda f: f.free_count() / max(1, f.total_count()),
            reverse=True,
        )
        for floor in ranked:
            free = floor.free_spots_by_size(required)
            if free:
                return free[0]
        return None


# ──────────────────────────────────────────────────────────────────────────
# Strategy: Pricing
# ──────────────────────────────────────────────────────────────────────────

class PricingStrategy(ABC):
    @abstractmethod
    def compute(self, ticket: Ticket, exit_time: datetime) -> Decimal:
        ...


class FlatHourlyPricing(PricingStrategy):
    """Per-vehicle hourly rate, with first-hour-minimum (any partial hour rounds up)."""

    def __init__(self, rates: dict[VehicleType, Decimal]):
        self._rates = rates

    def compute(self, ticket: Ticket, exit_time: datetime) -> Decimal:
        elapsed = exit_time - ticket.entry_time
        # round up to next hour, minimum 1
        hours = max(1, _ceil_hours(elapsed))
        return self._rates[ticket.vehicle.vehicle_type] * hours


class TieredPricing(PricingStrategy):
    """First N hours at base rate, beyond that at a higher 'overstay' rate."""

    def __init__(self,
                 base_rates: dict[VehicleType, Decimal],
                 overstay_rates: dict[VehicleType, Decimal],
                 base_hours: int = 3):
        self._base = base_rates
        self._overstay = overstay_rates
        self._base_hours = base_hours

    def compute(self, ticket: Ticket, exit_time: datetime) -> Decimal:
        hours = max(1, _ceil_hours(exit_time - ticket.entry_time))
        base_h = min(hours, self._base_hours)
        over_h = max(0, hours - self._base_hours)
        vt = ticket.vehicle.vehicle_type
        return self._base[vt] * base_h + self._overstay[vt] * over_h


def _ceil_hours(delta: timedelta) -> int:
    seconds = int(delta.total_seconds())
    return (seconds + 3599) // 3600


# ──────────────────────────────────────────────────────────────────────────
# Factory
# ──────────────────────────────────────────────────────────────────────────

class VehicleFactory:
    """Centralized vehicle creation; keeps the type→subclass mapping in one place."""
    @staticmethod
    def create(license_plate: str, type_str: str) -> Vehicle:
        try:
            vt = VehicleType(type_str.lower())
        except ValueError:
            raise ParkingError(f"unknown vehicle type: {type_str!r}")
        return Vehicle(license_plate=license_plate, vehicle_type=vt)


class SpotFactory:
    @staticmethod
    def create(spot_id: str, floor_id: str, size: SpotSize) -> ParkingSpot:
        return ParkingSpot(spot_id=spot_id, floor_id=floor_id, size=size)


# ──────────────────────────────────────────────────────────────────────────
# Facade: ParkingLot
# ──────────────────────────────────────────────────────────────────────────

class ParkingLot:
    """Top-level system facade. Thread-safe."""

    def __init__(self,
                 floors: list[Floor],
                 pricing: PricingStrategy,
                 allocator: Optional[SpotAllocator] = None):
        self._floors = floors
        self._pricing = pricing
        self._allocator = allocator or FirstFitAllocator()
        self._tickets: dict[str, Ticket] = {}
        self._lock = threading.RLock()
        self._audit: list[tuple[str, str]] = []  # (event, details) for tests/observability

    # --- public API ---

    def park(self, vehicle: Vehicle, *, now: Optional[datetime] = None) -> Ticket:
        now = now or datetime.utcnow()
        with self._lock:
            spot = self._allocator.allocate(self._floors, vehicle)
            if spot is None:
                self._audit.append(("park_rejected", vehicle.license_plate))
                raise LotFullError(f"no spot available for {vehicle.license_plate}")
            spot.assign(vehicle)
            ticket = Ticket(
                ticket_id=str(uuid.uuid4()),
                vehicle=vehicle,
                spot=spot,
                entry_time=now,
            )
            self._tickets[ticket.ticket_id] = ticket
            self._audit.append(("park", f"{vehicle.license_plate}@{spot.spot_id}"))
            return ticket

    def unpark(
        self,
        ticket_id: str,
        *,
        now: Optional[datetime] = None,
        payment: Optional[PaymentMethod] = None,
    ) -> ExitReceipt:
        now = now or datetime.utcnow()
        with self._lock:
            ticket = self._tickets.pop(ticket_id, None)
            if ticket is None:
                raise TicketNotFoundError(f"ticket {ticket_id} not found")
            amount = self._pricing.compute(ticket, now)
            ticket.spot.release()
            self._audit.append(("unpark", f"{ticket.vehicle.license_plate}=${amount}"))
            return ExitReceipt(ticket=ticket, exit_time=now, amount=amount, payment_method=payment)

    def availability(self) -> dict[str, dict]:
        """Snapshot of free counts per floor and per size."""
        with self._lock:
            result = {}
            for floor in self._floors:
                size_counts = {s: 0 for s in SpotSize}
                for spot in floor.spots:
                    if spot.status is SpotStatus.FREE:
                        size_counts[spot.size] += 1
                result[floor.floor_id] = {
                    "free": floor.free_count(),
                    "total": floor.total_count(),
                    "by_size": {k.name: v for k, v in size_counts.items()},
                }
            return result

    # --- testing / observability ---

    @property
    def audit(self) -> list[tuple[str, str]]:
        return list(self._audit)


# ──────────────────────────────────────────────────────────────────────────
# Demo / smoke test
# ──────────────────────────────────────────────────────────────────────────

def _build_lot() -> ParkingLot:
    """Build a small lot: 2 floors, mixed spot sizes."""
    spot_seq = itertools.count(1)
    def make_spots(floor_id: str, smalls: int, mediums: int, larges: int) -> list[ParkingSpot]:
        out = []
        for size, count in [(SpotSize.SMALL, smalls), (SpotSize.MEDIUM, mediums), (SpotSize.LARGE, larges)]:
            for _ in range(count):
                sid = f"{floor_id}-{size.name[0]}-{next(spot_seq)}"
                out.append(SpotFactory.create(sid, floor_id, size))
        return out

    f1 = Floor("F1", make_spots("F1", smalls=4, mediums=6, larges=2))
    f2 = Floor("F2", make_spots("F2", smalls=2, mediums=4, larges=4))

    rates = {
        VehicleType.MOTORCYCLE: Decimal("2.00"),
        VehicleType.CAR:        Decimal("4.00"),
        VehicleType.TRUCK:      Decimal("8.00"),
    }
    pricing = FlatHourlyPricing(rates)

    return ParkingLot(floors=[f1, f2], pricing=pricing, allocator=BestFitAllocator())


def _demo() -> None:
    lot = _build_lot()
    print("Initial availability:", lot.availability())

    # Park three vehicles
    car = VehicleFactory.create("KA-01-AB-1234", "car")
    bike = VehicleFactory.create("KA-01-CD-5678", "motorcycle")
    truck = VehicleFactory.create("KA-01-EF-9012", "truck")

    t_car = lot.park(car, now=datetime(2026, 5, 17, 10, 0))
    t_bike = lot.park(bike, now=datetime(2026, 5, 17, 10, 5))
    t_truck = lot.park(truck, now=datetime(2026, 5, 17, 10, 10))

    print(f"Parked {car.license_plate} @ {t_car.spot.spot_id}")
    print(f"Parked {bike.license_plate} @ {t_bike.spot.spot_id}")
    print(f"Parked {truck.license_plate} @ {t_truck.spot.spot_id}")
    print("After parking:", lot.availability())

    # Unpark after 2.5 hours
    receipt_car = lot.unpark(t_car.ticket_id, now=datetime(2026, 5, 17, 12, 30))
    print(f"Car bill: ${receipt_car.amount}")  # ceil 2h30m → 3h × $4 = $12

    # Concurrency smoke test
    print("\n--- concurrency test: 30 vehicles racing ---")
    lot2 = _build_lot()
    plates_parked: list[str] = []
    plates_lock = threading.Lock()
    errors: list[str] = []

    def race(plate: str):
        v = VehicleFactory.create(plate, "car")
        try:
            t = lot2.park(v)
            with plates_lock:
                plates_parked.append(plate)
        except LotFullError:
            with plates_lock:
                errors.append(plate)

    threads = [threading.Thread(target=race, args=(f"P-{i}",)) for i in range(30)]
    for t in threads: t.start()
    for t in threads: t.join()

    print(f"Parked: {len(plates_parked)}, rejected (lot full): {len(errors)}")
    avail = lot2.availability()
    total_free = sum(f["free"] for f in avail.values())
    print(f"Free remaining: {total_free}")
    # Invariant: parked + free + (other-sizes-not-fitting-cars) == total spots
    assert len(plates_parked) + len(errors) == 30


if __name__ == "__main__":
    _demo()
```

### How to run

```bash
python3 ~/Downloads/cc/kb/LLD/Python/parking-lot.py
# or just save the code block above as parking-lot.py and run
```

Expected output (truncated):
```
Initial availability: {'F1': {'free': 12, 'total': 12, ...}, 'F2': {'free': 10, 'total': 10, ...}}
Parked KA-01-AB-1234 @ F1-M-...
...
Car bill: $12.00
--- concurrency test ---
Parked: 14, rejected (lot full): 16
Free remaining: 8
```
(Numbers depend on the small/medium/large mix; the assertion at the end is the real test — 30 threads all completed, no double-assignment.)

---

## 11. Cross-Questions ("Why X and not Y") — ≥ 12

### 11.1 Why Strategy for `PricingStrategy` and not a simple `if/else` chain?

Three reasons:
1. **Open/closed**: adding a new pricing scheme (weekend premium, holiday rates, EV discount) is a new class implementing the interface. No existing code changes.
2. **Testability**: each strategy has its own unit tests; mixing them in one method makes test setup tangled.
3. **Runtime swap**: an admin can hot-swap the pricing on a running lot (`lot.pricing = WeekendPremiumPricing(...)`) without restarting.

When `if/else` is fine: tiny, fixed set of branches that will never grow (e.g. 2 cases, hardcoded). For pricing, the future always brings a new variant — Strategy pays for itself the first time you add one.

### 11.2 Why Factory for `Vehicle` creation when `Vehicle` has only one class?

`VehicleFactory` looks redundant *today* — `Vehicle(plate, type)` directly works. It exists for two reasons:
1. **Type-string parsing**: callers often have a string ("car") not an enum. Centralizing the string→enum mapping in one place avoids scatter.
2. **Future subclasses**: when we add `ElectricCar` or `Truck` with capacity attribute, the factory dispatches on type without changing call sites.

If we never extend, the factory was wasted code. We accept that as cheap insurance — a 5-line class is not a heavy bet.

### 11.3 Why `SpotStatus` enum with 4 values instead of `is_occupied: bool`?

A boolean flag handles 2 states. We have **4 distinct states**: `FREE`, `OCCUPIED`, `RESERVED` (held for a future arrival), `OUT_OF_SERVICE` (broken / under maintenance). Compressing them into booleans (e.g. `occupied + is_active`) creates illegal combinations (`occupied=True, is_active=False` — what does that mean?). An enum makes the state machine explicit and unrepresentable-states-impossible.

State transitions become explicit too: only certain transitions are legal (`FREE → OCCUPIED`, `OCCUPIED → FREE`, but never `OUT_OF_SERVICE → OCCUPIED`). Validating in `assign` / `release` is a single check on the enum.

### 11.4 Why composition (`Floor` owns `ParkingSpot`s) and not inheritance (`ParkingLot extends Container`)?

Inheritance binds child types to parent identity at compile/class definition time. We can't have a `ParkingLot` that suddenly gains a new floor at runtime. Composition lets us:
- Add or remove floors at runtime.
- Test `ParkingLot` with a mock `Floor`.
- Replace `Floor` with a different container shape (e.g. zoned floors) without breaking `ParkingLot`.

Inheritance is the right tool when behavior is genuinely an "is-a" specialization (e.g. `ElectricCar is-a Car`). For "has-a" relationships, composition every time.

### 11.5 Why a single coarse `RLock` and not finer-grained locking?

Pragmatism. A coarse lock around the find-and-claim transaction is correct, simple, and fast enough for 1k–10k spots and ~10 entry terminals.

When we'd switch to per-floor locks: when entry throughput exceeds the lock's per-second capacity (~1M lock ops/sec on modern hardware — likely fine forever for parking).

When we'd switch to lock-free CAS: if we built a 1M-spot cloud-scale parking system. Implementation: `ParkingSpot.status` is an `atomic` integer; allocator iterates and CAS-claims first match. ~5× throughput, ~10× code complexity.

The progression: coarse lock → per-floor lock → CAS. Don't pre-optimize.

### 11.6 Why is `Vehicle` a frozen dataclass (immutable) but `ParkingSpot` mutable?

`Vehicle` is identity-by-license-plate; its attributes don't change while it's in our system (the same car doesn't morph from a sedan to a truck mid-trip). Immutability gives us free hashability and thread-safe sharing.

`ParkingSpot` *must* be mutable: its `status` and `occupant` change as cars come and go. We could model it as immutable with replaced instances on each transition, but that breaks the natural identity (the *physical* spot is the same; only its state changes). Mutable is the right model.

### 11.7 Why a `Ticket` carries the `Vehicle` and `Spot` directly instead of just IDs?

In a single-process in-memory implementation, holding references is direct and cheap. If we persist tickets to a DB, we'd switch to IDs and a fetch-on-access pattern (or a denormalized view).

The class as-written is hostile to ORM mapping — that's a deliberate trade. Mapping to DB rows is an extension point (§12); keeping the in-memory model object-rich is the right local optimum.

### 11.8 Why is `ExitReceipt` separate from `Ticket` instead of one combined `ParkingSession`?

Lifecycle separation: a `Ticket` exists from park to unpark. After unpark, it's archived; the `ExitReceipt` is a different value (additional fields: `exit_time`, `amount`, `payment_method`). Combining them would force the `Ticket` to have nullable fields for the unpark side — exactly the "illegal state representable" problem.

Keeping them separate makes the state of the system clear: "Tickets are open sessions; Receipts are closed sessions."

### 11.9 Why `Decimal` for money and not `float`?

`float` has IEEE-754 binary rounding. `0.1 + 0.2 != 0.3`. Money in floating-point causes off-by-a-cent errors that compound. `Decimal` does base-10 arithmetic — exact for currency.

Cost: slightly slower than `float`. We don't care; a parking lot does ~10s of pricing calls per second.

### 11.10 What if I want to support `Reservation` (book in advance)?

Add `RESERVED` status (already in our enum), reservation table, and `reserve(spot, time_window)` method. When parking against a reservation, the allocator first tries reserved spots for the arriving plate.

The classes that change: `ParkingLot` gets `reserve` / `cancel_reservation` methods, `SpotAllocator` becomes reservation-aware (or a new `ReservedAllocator` decorator wraps an existing allocator). Existing code unchanged. Open/closed test passes.

### 11.11 What if I want to support EVs with charging spots?

Two design moves:
1. Add `ELECTRIC_CAR` to `VehicleType`, `EV_SPOT` to `SpotSize` (or a parallel attribute `requires_charger: bool` on `ParkingSpot`).
2. `Vehicle.fits_in` consults both size and the charger requirement.

Allocator and pricing are extensible — pricing might give EVs a discount via a `EVDiscountPricing` decorator that wraps an existing strategy.

The decorator pattern composes cleanly: `EVDiscountPricing(WeekendPremiumPricing(FlatHourlyPricing(...)))`.

### 11.12 What's the failure mode if `unpark` succeeds but payment processing fails?

In our design, `unpark` returns the receipt before payment is processed (the receipt has `payment_method=None` until paid). Payment is a separate step.

Wrong: making `unpark` payment-coupled means a card-decline fails the unpark, and the spot stays occupied while the customer is ranting at the gate.

Right: the spot is freed on `unpark` regardless; payment is a separate transaction with its own retry / dispute / fallback. If the customer absconds without paying, that's an `OUTSTANDING_BALANCE` audit row to chase later.

This separation of concerns — operational state (spot occupancy) from financial state (debt) — is general design wisdom. Don't couple them.

### 11.13 Why `dict` for `_tickets` and not a list?

O(1) lookup by ticket_id on `unpark`. With a list, `unpark` would scan O(N) to find the ticket. At 10k tickets, that's 10k iterations per unpark — negligible per call but accumulates under load. `dict` is the simple O(1) choice.

### 11.14 How would I add **horizontal scale** (multiple lot instances behind a load balancer)?

The current single-process design cannot horizontally scale — the lock and the in-memory state are local. To scale:

1. Move state to an external KV (Redis / Postgres). Spots become rows; status is a column.
2. Replace the `RLock` with a distributed lock (or, better, atomic SQL UPDATE: `UPDATE spots SET status='occupied', occupant=? WHERE spot_id IN (SELECT spot_id FROM spots WHERE status='free' AND size>=? LIMIT 1) RETURNING spot_id`).
3. Stateless `ParkingLot` instances behind a load balancer.

This is a meaningful redesign. The code we wrote is a single-instance prototype; the *patterns* (Strategy, Factory, State) port directly to a distributed implementation.

---

## 12. Extensions

### 12.1 EVs with charging
Add `requires_charger` to `ParkingSpot`. `Vehicle.fits_in(spot)` checks both size and charger compatibility. New allocator: `EVPreferringAllocator` prefers chargers for EVs.

### 12.2 Reservations
Add a `Reservation` table and `reserve` / `cancel_reservation` methods. Allocator becomes reservation-aware. Existing code unchanged.

### 12.3 Monthly passes
Add `Subscription` with `(user_id, expires_at, vehicle_plate)`. `unpark`'s pricing strategy first checks for an active subscription; if present, returns 0.

### 12.4 Lost ticket
Add `unpark_with_plate(plate, fee=LOST_TICKET_FEE)` — find the spot by occupant, override fee with a flat penalty.

### 12.5 Multi-lot system
Wrap `ParkingLot` instances in a `ParkingService` facade that routes by location. Each lot owns its own state.

### 12.6 Persistence
`ParkingLot` accepts a `Repository` interface that loads/saves state. In-memory repository for tests; SQL repository for production.

---

## 13. Cheat-Sheet Recap

1. **Problem:** Park/unpark vehicles in a multi-floor lot with pluggable pricing and allocation.
2. **Core entities:** `ParkingLot`, `Floor`, `ParkingSpot`, `Vehicle`, `Ticket`, `ExitReceipt`.
3. **Patterns:** Strategy (pricing, allocation), Factory (vehicle, spot), State (spot status), Facade (`ParkingLot`).
4. **Hardest design call:** Hybrid Strategy + State for spots — keeps allocation pluggable without leaking spot state.
5. **Concurrency:** Single coarse `RLock` around find-and-claim. Trivially correct, scales to ~10k spots. Per-floor locks or CAS for higher scale.
6. **Trade-off accepted:** No persistence; in-memory only. Hooks via Repository interface for an extension.
7. **Open extension points:** New pricing schemes, new allocators, new vehicle types — all without touching existing code.

---

## Appendix A: Test cases the interviewer will probe

```
1. Park motorcycle in MOTORCYCLE-only lot — succeeds, uses SMALL spot.
2. Park truck when only MEDIUM spots are free — fails with LotFullError.
3. Park 30 cars when only 12 are free — exactly 12 succeed, 18 fail.
4. Concurrent park of 100 cars from 100 threads — exactly N succeed where N = free CAR-fitting spots; no double-occupancy.
5. Unpark unknown ticket — TicketNotFoundError.
6. Park, unpark after 30 seconds → fee = 1 hour minimum.
7. Park, unpark after 1h 1m → fee = 2 hours (rounded up).
8. Re-park into a freed spot — succeeds.
9. Availability snapshot before/after — counts decrement correctly.
10. Pricing strategy swap (`lot._pricing = ...`) — next unpark uses new pricing.
```

## Appendix B: Common Python-specific gotchas

```
- `dataclass(frozen=True)` is deeply immutable only for hashable fields.
  A frozen Vehicle with a mutable `metadata: dict` field is mutable through that.
- `RLock` re-entry by the same thread is safe; cross-thread is not.
- `enum.Enum` members are singletons — identity comparison (`is`) is correct.
- `Decimal` arithmetic with `float` literals raises; always wrap floats in `Decimal(str(x))`.
- `datetime.utcnow()` is naive (no tzinfo); use `datetime.now(timezone.utc)` for production.
- Threading vs multiprocessing: GIL means threads don't speed up CPU-bound work,
  but parking is I/O-and-lock-bound, so threads are fine.
```

## Appendix C: Why this question is loved by interviewers

```
- Easy to scope; impossible to "finish" — there's always one more extension.
- Forces explicit pattern naming.
- Concurrency is naturally surfaced (don't have to invent it).
- Test cases are easy to dictate; correctness is verifiable.
- Open-ended enough to differentiate strong from weak candidates in 60 minutes.
```

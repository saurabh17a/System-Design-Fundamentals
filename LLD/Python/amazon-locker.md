# Amazon Locker — Low-Level Design (Python)

> **Difficulty:** Medium
> **Tags:** `[lld]` `[ood]` `[strategy]` `[state]` `[concurrency]` `[expiry]`
> **Language:** Python 3.10+
> **Prep time:** ~10 min skim, ~30 min deep read
> **Companies that ask this:** Amazon (literally), Microsoft, Atlassian, Uber

---

## Beginner's Guide

### What's this in plain English?

Those metal lockers at gas stations and grocery stores where Amazon delivers your packages. Driver puts the package in an empty locker that fits the package size, you get a code by email, you go there, type the code, the locker opens, you take your package. If you don't pick up in N days, the locker is reclaimed.

### Why solve it?

- **Real world**: Amazon Hub Lockers, parcel pick-up points everywhere.
- **Teaches**: state per locker (EMPTY / OCCUPIED / EXPIRED), size-based matching, OTP generation, expiry handling.
- **Patterns**: state, strategy (allocation strategy: smallest-fit vs largest-fit).

### Vocabulary

- **Locker** — a single compartment; has a size (S/M/L) and state.
- **OTP** — one-time password sent to the customer.
- **Reservation** — driver assigned a locker but hasn't actually deposited yet.
- **Expiry** — if customer doesn't pick up within N days, the package is reclaimed.

### High-level approach

Entities:
- **Package** — id, size, recipient.
- **Locker** — id, size, state, current package, OTP, deposited_at.
- **LockerLocation** — group of lockers at a physical site.
- **AllocationStrategy** — pick a free locker that fits.
- **Service** — orchestrator.

Drop-off flow: find a free locker ≥ package size (smallest fit minimizes waste). Generate OTP. Set state OCCUPIED. Notify customer.
Pick-up flow: customer enters OTP → unlock → state EMPTY.
Expiry sweep: scheduled job; if `now - deposited_at > N` days → mark EXPIRED → notify driver to reclaim.

### How to read this doc

- **Beginner**: focus on the locker state machine + size matching.
- **Interview**: discuss security (OTP entropy, brute force), expiry handling, multi-package per locker.

---

## 0. How to use this doc in an interview

Amazon Locker looks like a Parking Lot (assign a slot to a thing) but with twists:
1. **OTP-based pickup** — every reservation gets a one-time code; pickup verifies.
2. **Expiry & reclamation** — lockers held past N days are reclaimed; the customer is notified.
3. **Size-fit + nearest-locker selection** — couriers want a locker as close to the customer's address as possible.

If you walk through entities → state machine → OTP gen → expiry sweeper → concurrency, you've covered everything an interviewer wants. The Parking-Lot patterns (Strategy for size-fit, State for locker status, Facade) port directly.

---

## 1. Problem Statement

A package locker network. Couriers drop off packages; customers retrieve them with a one-time code. Each locker has a fixed size; packages must fit. Reservations expire after N hours/days; expired packages are returned to the courier or reclaimed.

The system must:
- Assign a locker of compatible size to a package at drop-off.
- Issue a unique OTP.
- Verify OTP at pickup; release the locker.
- Reclaim expired reservations.
- Be thread-safe (multiple couriers/customers operate concurrently).
- Support multiple **locations** with size mixes.

---

## 2. Clarifying Questions

### Scope
- [ ] One location or many?
- [ ] Locker sizes — small/medium/large/xlarge, or numeric?
- [ ] What's the **expiry window** — 24h, 72h, configurable?
- [ ] Are returns to the courier in scope? (Yes — we model status transition.)
- [ ] OTP format — 6-digit, 8-char alphanumeric, signed JWT?
- [ ] Can a customer **extend** their reservation?

### Domain
- [ ] Selection strategy — first-fit, best-fit, nearest to a delivery point?
- [ ] What if no compatible locker is free — reject the courier or hold queue?
- [ ] One package per locker, or can one locker hold multiple parcels?
- [ ] How is courier identity tracked? (Order ID + carrier.)

### Non-functional
- [ ] Concurrency: thousands of locations × tens of lockers — bounded.
- [ ] Persistence: in-memory or DB-backed? (Library API; pluggable repo.)
- [ ] CLI / API / library? (Library.)

> **For this doc:** single location (multiple lockers per location), 4 sizes (XS/S/M/L), 72h default expiry, returns supported, 6-digit numeric OTP, no extension, best-fit selection, in-memory thread-safe.

---

## 3. Functional Requirements

**Must-have (P0):**
1. `reserve(order_id, package_size, courier_id) → (locker_id, otp)`.
2. `pickup(otp) → package_info` — verifies OTP, releases locker.
3. `expire_old(now)` — sweep expired; mark for return; free locker.
4. Lockers of differing sizes; package must fit; smallest fit preferred.
5. Concurrent-safe.
6. Audit: every reserve/pickup/expire event logged.

**Should-have (P1):**
7. Multiple locations; courier picks nearest.
8. OTP retry limit (3 wrong attempts → lock the locker for security review).
9. Per-location size capacity reports.

**Nice-to-have (P2 — designed, not implemented):**
10. Customer extends reservation.
11. SMS/email integration.
12. Per-customer max-active-reservations limit.
13. Heat-map analytics (which locations get full).

---

## 4. Actors & Use Cases

```
                    ┌──────────────────┐
                    │   Locker System  │
                    └──────────────────┘
                    ▲      ▲       ▲
                    │      │       │
          ┌─────────┘      │       └─────────┐
          │                │                 │
      ┌────────┐    ┌────────────┐    ┌────────┐
      │Courier │    │ Customer   │    │ Admin  │
      │(drop)  │    │ (pickup)   │    │(sweep) │
      └────────┘    └────────────┘    └────────┘
```

---

## 5. Core Entities

| Entity | Attributes | Notes |
|---|---|---|
| `Package` | order_id, size, weight | Inbound by courier |
| `Locker` | locker_id, size, status, package, otp_hash, courier_id, reserved_at, expires_at, attempts | |
| `Location` | location_id, lockers, address | Container; can have many |
| `Reservation` | locker_id, otp, expires_at | Returned to courier at drop |
| `LockerSystem` | locations, sweeper, lock | Top-level facade |

**Enums:**
```
Size:   XS, S, M, L                 (cubic-foot bins)
Status: AVAILABLE, RESERVED, AWAITING_RETURN, OUT_OF_SERVICE
```

OTP is **stored hashed** (SHA-256 + per-locker salt), never in plaintext, to prevent insider lookup.

---

## 6. Class Diagram (ASCII)

```
                                ┌────────────────────────────┐
                                │       LockerSystem         │
                                │────────────────────────────│
                                │ - locations                │
                                │ - allocator: SizeAllocator │◇──────┐
                                │ - clock: Clock             │       │
                                │ - lock: RLock              │       │
                                │────────────────────────────│       │
                                │ + reserve(order, size, c)  │       │
                                │ + pickup(loc_id, otp)      │       │
                                │ + expire_old()             │       │
                                └─────┬──────────────────────┘       │
                                      │ ◆                              │
                                      ▼                                │
                                ┌──────────────────┐                  │
                                │     Location     │                  │
                                │──────────────────│                  │
                                │ - location_id    │                  │
                                │ - address        │                  │
                                │ - lockers        │◆──┐              │
                                └──────────────────┘   │              │
                                                       ▼              │
                                              ┌──────────────────┐    │
                                              │     Locker       │    │
                                              │──────────────────│    │
                                              │ - id, size       │    │
                                              │ - status         │    │
                                              │ - package?       │    │
                                              │ - otp_hash?      │    │
                                              │ - reserved_at?   │    │
                                              │ - expires_at?    │    │
                                              │ - attempts       │    │
                                              └──────────────────┘    │
                                                                      │
              ┌───────────────────────────────────────────────────────┘
              ▼
        ┌─────────────────────────┐
        │ «interface»             │
        │ SizeAllocator           │
        │─────────────────────────│
        │ + allocate(loc, size)   │
        │   -> Locker | None      │
        └────────▲────────────────┘
                 │ implements
        ┌────────┴─────────────────┐
        │ FirstFitAllocator        │
        │ BestFitAllocator ◀default│
        │ LeastUsedAllocator       │
        └──────────────────────────┘
```

---

## 7. Design Patterns Used

| Pattern | Where | Why | Alternative |
|---|---|---|---|
| Strategy | `SizeAllocator` | Pluggable selection (best-fit / first-fit / load-balance / nearest) | Inline if/else — fails open/closed |
| State | `Locker.status` (4 states) | Multi-state with valid transitions; better than booleans | bool occupied — fails on RETURN/OOS |
| Facade | `LockerSystem` | Thin API over locations + lockers + sweeper | Direct entity exposure — leaks |
| Sentinel value (NOT used) | — | OTP retry counter as int, not state | |

---

## 8. Sequence Diagrams

### 8.1 Reserve (drop-off)

```
  Courier        System          Allocator        Locker
    │              │                 │              │
    │── reserve ──▶│                 │              │
    │              │── allocate ────▶│              │
    │              │                 │── find ─────▶│
    │              │◀── locker ──────│              │
    │              │── assign + OTP ──────────────▶ │
    │              │◀── reservation ───────────────│
    │◀── (lid,otp)─│                 │              │
```

### 8.2 Pickup

```
  Customer        System              Locker
    │               │                    │
    │── pickup ────▶│                    │
    │               │── verify OTP ─────▶│
    │               │◀── ok / bad ──────│
    │   ok          │── release ────────▶│
    │   bad         │── attempts++       │
    │◀── result ────│                    │
```

### 8.3 Expire sweep

```
  Sweeper         System              Locker
    │               │                    │
    │── now ───────▶│                    │
    │               │── for each rsvd:   │
    │               │   if expires_at<now│
    │               │     status=RETURN ▶│
    │               │     audit          │
```

---

## 9. Concurrency Considerations

Two race conditions to defend:
1. Two couriers reserving simultaneously, allocator picks the same locker for both.
2. Customer pickup + expiry sweep on the same locker.

Solution:
- Single coarse `RLock` on `LockerSystem`. Acquire-find-mark-release as one atomic transaction.
- Sweep takes the same lock; never operates on a locker while a reservation is mid-write.

For high-locker-count, switch to **per-location lock** — independent locations can serve in parallel.

---

## 10. Full Working Code

```python
"""
Amazon Locker — Low-Level Design (Python)

In-memory thread-safe library:
- multi-size lockers per location
- pluggable size allocator
- 6-digit OTP (hashed at rest)
- pickup verification + retry limit
- expiry sweeper
"""
from __future__ import annotations

import enum
import hashlib
import secrets
import threading
import time
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional


class Size(enum.IntEnum):
    XS = 1
    S = 2
    M = 3
    L = 4


class Status(enum.Enum):
    AVAILABLE = "available"
    RESERVED = "reserved"
    AWAITING_RETURN = "awaiting_return"
    OUT_OF_SERVICE = "oos"


# ──────────────────────────────────────────────────────────────────────────
# Errors
# ──────────────────────────────────────────────────────────────────────────

class LockerError(Exception): ...
class NoLockerAvailable(LockerError): ...
class LockerNotFound(LockerError): ...
class InvalidOTP(LockerError): ...
class LockerLockedOut(LockerError): ...


# ──────────────────────────────────────────────────────────────────────────
# Domain
# ──────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Package:
    order_id: str
    size: Size
    courier_id: str


@dataclass
class Locker:
    locker_id: str
    size: Size
    status: Status = Status.AVAILABLE
    package: Optional[Package] = None
    otp_salt: Optional[str] = None
    otp_hash: Optional[str] = None
    reserved_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    attempts: int = 0
    MAX_ATTEMPTS: int = 3


@dataclass
class Location:
    location_id: str
    address: str
    lockers: list[Locker] = field(default_factory=list)


@dataclass(frozen=True)
class Reservation:
    locker_id: str
    location_id: str
    otp: str            # plaintext returned ONCE to the courier
    expires_at: datetime


# ──────────────────────────────────────────────────────────────────────────
# Strategy: size allocation
# ──────────────────────────────────────────────────────────────────────────

class SizeAllocator(ABC):
    @abstractmethod
    def allocate(self, location: Location, size: Size) -> Optional[Locker]:
        ...


class FirstFitAllocator(SizeAllocator):
    def allocate(self, location: Location, size: Size) -> Optional[Locker]:
        for l in location.lockers:
            if l.status is Status.AVAILABLE and l.size >= size:
                return l
        return None


class BestFitAllocator(SizeAllocator):
    """Smallest fitting locker — leaves big ones for big packages."""
    def allocate(self, location: Location, size: Size) -> Optional[Locker]:
        best: Optional[Locker] = None
        for l in location.lockers:
            if l.status is Status.AVAILABLE and l.size >= size:
                if best is None or l.size < best.size:
                    best = l
                    if best.size == size:
                        return best
        return best


# ──────────────────────────────────────────────────────────────────────────
# OTP
# ──────────────────────────────────────────────────────────────────────────

def _make_otp() -> str:
    """6-digit numeric, cryptographically random."""
    return f"{secrets.randbelow(1_000_000):06d}"


def _hash_otp(otp: str, salt: str) -> str:
    return hashlib.sha256((salt + otp).encode()).hexdigest()


# ──────────────────────────────────────────────────────────────────────────
# LockerSystem (facade)
# ──────────────────────────────────────────────────────────────────────────

class LockerSystem:
    DEFAULT_EXPIRY = timedelta(hours=72)

    def __init__(self,
                 locations: list[Location],
                 allocator: Optional[SizeAllocator] = None,
                 expiry: timedelta = DEFAULT_EXPIRY) -> None:
        self._locations = {l.location_id: l for l in locations}
        self._allocator = allocator or BestFitAllocator()
        self._expiry = expiry
        self._lock = threading.RLock()
        self._audit: list[tuple[str, str]] = []

    def reserve(self, package: Package, location_id: str,
                now: Optional[datetime] = None) -> Reservation:
        now = now or datetime.utcnow()
        with self._lock:
            loc = self._locations.get(location_id)
            if loc is None:
                raise LockerNotFound(f"location {location_id} not found")
            locker = self._allocator.allocate(loc, package.size)
            if locker is None:
                self._audit.append(("reserve_fail", f"{location_id}/{package.order_id}"))
                raise NoLockerAvailable(
                    f"no {package.size.name}+ locker free at {location_id}")

            # Generate OTP and salt
            otp = _make_otp()
            salt = secrets.token_hex(16)
            locker.status = Status.RESERVED
            locker.package = package
            locker.otp_salt = salt
            locker.otp_hash = _hash_otp(otp, salt)
            locker.reserved_at = now
            locker.expires_at = now + self._expiry
            locker.attempts = 0
            self._audit.append(("reserve", f"{locker.locker_id}/{package.order_id}"))
            return Reservation(
                locker_id=locker.locker_id,
                location_id=location_id,
                otp=otp,
                expires_at=locker.expires_at,
            )

    def pickup(self, location_id: str, locker_id: str, otp: str,
               now: Optional[datetime] = None) -> Package:
        now = now or datetime.utcnow()
        with self._lock:
            loc = self._locations.get(location_id)
            if loc is None:
                raise LockerNotFound(f"location {location_id} not found")
            locker = next((l for l in loc.lockers if l.locker_id == locker_id), None)
            if locker is None:
                raise LockerNotFound(f"locker {locker_id} not at {location_id}")
            if locker.status is Status.OUT_OF_SERVICE:
                raise LockerLockedOut(f"locker {locker_id} is out of service")
            if locker.status is not Status.RESERVED:
                raise InvalidOTP(f"locker {locker_id} not currently reserved")
            if now > (locker.expires_at or now):
                raise InvalidOTP("reservation expired")

            given_hash = _hash_otp(otp, locker.otp_salt or "")
            if given_hash != locker.otp_hash:
                locker.attempts += 1
                self._audit.append(("pickup_bad", f"{locker_id}/{locker.attempts}"))
                if locker.attempts >= locker.MAX_ATTEMPTS:
                    locker.status = Status.OUT_OF_SERVICE
                    self._audit.append(("locker_locked_out", locker_id))
                    raise LockerLockedOut(f"locker {locker_id} locked after {locker.MAX_ATTEMPTS} bad OTPs")
                raise InvalidOTP("incorrect OTP")

            # success
            pkg = locker.package
            self._reset_locker(locker)
            self._audit.append(("pickup", f"{locker_id}/{pkg.order_id if pkg else '?'}"))
            return pkg  # type: ignore[return-value]

    def expire_old(self, now: Optional[datetime] = None) -> list[str]:
        """Sweep: mark RESERVED lockers past expiry as AWAITING_RETURN.
        Returns the locker IDs swept."""
        now = now or datetime.utcnow()
        swept: list[str] = []
        with self._lock:
            for loc in self._locations.values():
                for locker in loc.lockers:
                    if (locker.status is Status.RESERVED
                            and locker.expires_at is not None
                            and now > locker.expires_at):
                        locker.status = Status.AWAITING_RETURN
                        swept.append(locker.locker_id)
                        self._audit.append(("expire", locker.locker_id))
            return swept

    def courier_collect_returned(self, location_id: str, locker_id: str) -> Package:
        """Courier picks up an expired package; locker becomes AVAILABLE."""
        with self._lock:
            loc = self._locations[location_id]
            locker = next(l for l in loc.lockers if l.locker_id == locker_id)
            if locker.status is not Status.AWAITING_RETURN:
                raise LockerError(f"locker {locker_id} not awaiting return")
            pkg = locker.package
            self._reset_locker(locker)
            self._audit.append(("returned_to_courier", locker_id))
            return pkg  # type: ignore[return-value]

    def availability(self) -> dict[str, dict]:
        with self._lock:
            out = {}
            for loc_id, loc in self._locations.items():
                by_size = {s.name: 0 for s in Size}
                for l in loc.lockers:
                    if l.status is Status.AVAILABLE:
                        by_size[l.size.name] += 1
                out[loc_id] = {
                    "total": len(loc.lockers),
                    "available": sum(1 for l in loc.lockers if l.status is Status.AVAILABLE),
                    "reserved": sum(1 for l in loc.lockers if l.status is Status.RESERVED),
                    "returns": sum(1 for l in loc.lockers if l.status is Status.AWAITING_RETURN),
                    "by_size": by_size,
                }
            return out

    @property
    def audit(self) -> list[tuple[str, str]]:
        return list(self._audit)

    # ─── private ────────────────────────────────────────────────

    def _reset_locker(self, l: Locker) -> None:
        l.status = Status.AVAILABLE
        l.package = None
        l.otp_salt = None
        l.otp_hash = None
        l.reserved_at = None
        l.expires_at = None
        l.attempts = 0


# ──────────────────────────────────────────────────────────────────────────
# Demo / smoke tests
# ──────────────────────────────────────────────────────────────────────────

def _demo() -> None:
    # Build a location with a mix of locker sizes
    lockers = []
    counts = {Size.XS: 2, Size.S: 4, Size.M: 4, Size.L: 2}
    i = 0
    for size, n in counts.items():
        for _ in range(n):
            i += 1
            lockers.append(Locker(locker_id=f"L{i:03d}", size=size))
    loc = Location("LOC-001", "1 Main St", lockers)

    sys = LockerSystem([loc])

    print("Initial availability:", sys.availability()["LOC-001"])

    # reserve a small package
    pkg1 = Package("ORD-A", Size.S, "courier-1")
    r1 = sys.reserve(pkg1, "LOC-001")
    print(f"\nReserved {pkg1.order_id} → locker {r1.locker_id}, OTP={r1.otp}")
    # pickup with right OTP
    p = sys.pickup("LOC-001", r1.locker_id, r1.otp)
    print(f"Pickup OK: got {p.order_id}")

    # Wrong OTP attempts
    pkg2 = Package("ORD-B", Size.M, "courier-1")
    r2 = sys.reserve(pkg2, "LOC-001")
    print(f"\nReserved {pkg2.order_id} → locker {r2.locker_id}")
    for guess in ["111111", "222222"]:
        try:
            sys.pickup("LOC-001", r2.locker_id, guess)
        except InvalidOTP as e:
            print(f"  bad attempt: {e}")
    # 3rd wrong → locker should lock out
    try:
        sys.pickup("LOC-001", r2.locker_id, "333333")
    except LockerLockedOut as e:
        print(f"  locked out as expected: {e}")

    # Expiry sweep
    print("\nExpiry test:")
    pkg3 = Package("ORD-C", Size.L, "courier-2")
    base = datetime(2026, 5, 17, 10, 0)
    r3 = sys.reserve(pkg3, "LOC-001", now=base)
    swept = sys.expire_old(now=base + timedelta(hours=73))
    print(f"  swept (expired): {swept}")
    assert r3.locker_id in swept

    # Concurrency smoke
    print("\n--- concurrency: 50 threads racing for ~10 lockers ---")
    sys2 = LockerSystem([Location("LOC-X", "test",
        [Locker(f"X{i:03d}", Size.S) for i in range(10)])])
    succeeded = []
    succeeded_lock = threading.Lock()
    failed = 0
    failed_lock = threading.Lock()

    def fire(i: int):
        nonlocal failed
        try:
            r = sys2.reserve(Package(f"O-{i}", Size.S, "c"), "LOC-X")
            with succeeded_lock:
                succeeded.append(r.locker_id)
        except NoLockerAvailable:
            with failed_lock:
                failed += 1

    threads = [threading.Thread(target=fire, args=(i,)) for i in range(50)]
    for t in threads: t.start()
    for t in threads: t.join()
    # Exactly 10 succeed; 40 fail; no double-assignment
    assert len(succeeded) == 10, f"got {len(succeeded)}"
    assert len(set(succeeded)) == 10, "duplicate assignment!"
    assert failed == 40
    print(f"  succeeded: {len(succeeded)}, failed: {failed} (expected 10/40)")

    print("\nAll demo checks passed.")


if __name__ == "__main__":
    _demo()
```

### How to run

```bash
python3 ~/Downloads/cc/kb/LLD/Python/amazon-locker.py
```

---

## 11. Cross-Questions ("Why X and not Y") — ≥ 12

### 11.1 Why hash the OTP at rest instead of storing plaintext?

Defense in depth. If the in-memory state leaks (memory dump, log misconfig), plaintext OTPs would let an attacker pick up packages. Hashed + per-locker salt: even if the hash leaks, brute-forcing a 6-digit space is ~1M attempts but the *salt* is unique — no rainbow tables.

We could also use HMAC with a server secret. Salt-per-locker is simpler and sufficient.

### 11.2 Why `secrets.randbelow` and not `random.randint`?

`random.randint` uses a Mersenne Twister, predictable from observed output. `secrets` wraps `os.urandom` — cryptographically random. OTPs MUST come from a secure RNG.

### 11.3 Why best-fit and not first-fit?

Best-fit leaves big lockers for big packages. With first-fit, an XS package could occupy an L locker, blocking later L deliveries. Worst-case: a flood of small parcels strands every large slot.

When first-fit is fine: when size distribution is uniform OR when lockers are quickly reused. We default to best-fit; expose first-fit as an option.

### 11.4 Why a state machine (`Status` enum) instead of multiple booleans?

Booleans (`occupied`, `awaiting_return`, `out_of_service`) make illegal combinations representable: `occupied=False, awaiting_return=True` is meaningless. Enum + transition validation in mutator methods makes the legal lifecycle explicit.

The 4 states are tightly coupled: AVAILABLE → RESERVED → (AVAILABLE | AWAITING_RETURN | OUT_OF_SERVICE). State enum clarifies the graph.

### 11.5 Why does `pickup` count attempts and lock out after 3?

Brute-force protection. 6-digit space = 1M values; an attacker could try a few and steal a package. 3 attempts gives a 0.0003% chance of guessing; lockout makes it impossible to brute-force without insider intervention.

In production: also rate-limit per courier-id and IP; add SMS-based OTP delivery rather than in-system.

### 11.6 Why is `expire_old` invoked manually and not on a thread?

Decoupling. The library exposes the operation; the embedding application schedules it (cron, async task, sweeper goroutine). This keeps the library testable: tests pass `now=` to drive expiry deterministically.

In production, a periodic job calls it every N minutes.

### 11.7 Why `RLock` and not `Lock`?

Defensive: if any internal helper takes the lock and is called from a method that already holds it, `Lock` deadlocks. `RLock` is safe under reentrancy.

For our code, `Lock` would work — no method calls another that takes the lock. But the marginal cost of `RLock` is negligible and saves future bugs.

### 11.8 Why `Reservation` returns plaintext OTP but `Locker` stores only hash?

The OTP is delivered to the courier *once* via the `Reservation`. After that, only the hash is stored — server side cannot regenerate the plaintext. This is the standard "issue once, verify many" pattern.

If the courier loses the OTP, customer support can issue a new one — but only after authenticating the customer (out of scope for this design).

### 11.9 What about extending a reservation?

Add `extend(locker_id, additional)`. Validates that the locker is RESERVED, updates `expires_at`. Trade-off: an extension can starve other deliveries; cap total extension time.

We omit for the base design. Extension API is a clean addition: doesn't touch existing entity logic.

### 11.10 Why not use a queue for couriers when no locker is available?

Queueing introduces SLA pressure: courier comes back to a locker that's now hot, but the customer expected it. We choose to **reject at full** — courier finds another location or returns later. Simpler; matches Amazon's actual behavior.

If queueing is desired: a separate `pending_reservations` queue; the sweeper drains it as lockers free.

### 11.11 What if the customer is at the wrong location?

`pickup` requires `location_id`. If the OTP came from `LOC-A` but customer enters at `LOC-B`, lookup fails (`LockerNotFound`). The locker stays reserved. Customer support resolves.

This is intentional: don't let one OTP unlock any locker globally.

### 11.12 Why `Package` is a frozen dataclass?

Identity by `order_id`. Doesn't change while in our system. Immutability gives free hashability + thread-safe sharing — we can return references without defensive copies.

### 11.13 What if package weight matters too?

Add `max_weight` to `Locker` and `weight` to `Package`. `fits_in` becomes a two-dimensional check (size AND weight). Allocator updated to filter on both. Existing classes touched minimally.

### 11.14 Why `secrets.token_hex(16)` for the salt?

128 bits of randomness. More than sufficient against birthday collisions (would need ~2^64 lockers to expect a salt collision — not happening). Hex encoding for storage convenience.

### 11.15 What's the failure mode if the courier abandons a delivery midway?

If they crash before getting the `Reservation`, the locker is in RESERVED state with no one knowing the OTP. The expiry sweeper reclaims it after 72h. Not ideal but bounded.

For high-reliability flow: the courier client retries with the same `order_id` (idempotent); the system, on detecting duplicate `order_id`, re-issues OR returns the existing reservation. We could add this; out of scope here.

---

## 12. Extensions

### 12.1 Multi-location nearest-locker
`reserve_nearest(package, customer_address)` — Geo-coordinate lookup; pick nearest location with capacity. Add a `Geocoder` strategy.

### 12.2 Reservation extension
`extend(locker_id, additional_hours)` — increments `expires_at`. Cap by configuration.

### 12.3 SMS/Email integration
A `NotificationSender` interface; injected. On reserve: notify customer with locker_id + OTP. On expire: notify customer.

### 12.4 Per-customer limits
Track active reservations by `customer_id`; reject if over limit.

### 12.5 Heat-map analytics
Per-location occupancy time-series; expose via `LockerSystem.metrics()`.

### 12.6 Persistence
`Repository` interface with in-memory and DB-backed implementations. `LockerSystem` accepts a repo at construction.

---

## 13. Cheat-Sheet Recap

1. **Problem:** Locker assignment + OTP-verified pickup + expiry sweep.
2. **Core entities:** `LockerSystem`, `Location`, `Locker`, `Package`, `Reservation`.
3. **Patterns:** Strategy (size allocator), State (locker status), Facade (system), Sentinel (no-locker None).
4. **Hardest design call:** Hashed OTP + retry limit + expiry — security-grade defense.
5. **Concurrency:** Single `RLock` (per-location lock as scaling extension).
6. **Trade-offs:** Reject on full (no queue); manual `expire_old` (no internal thread).
7. **Open extensions:** Nearest-location, multi-customer limits, persistence.

---

## Appendix A: Test cases

```
1. Reserve smallest package → BestFit picks XS.
2. Reserve XL package when only S free → NoLockerAvailable.
3. Pickup with correct OTP → success; locker AVAILABLE.
4. Pickup with 3 wrong OTPs → LockerLockedOut; status=OOS.
5. Expire after 73h → status=AWAITING_RETURN.
6. courier_collect_returned → AVAILABLE again.
7. 50 threads racing → exactly 10 succeed (cap); no duplicates.
8. Reserve into wrong size — best fit picks larger if no exact.
9. Pickup at wrong location_id → LockerNotFound.
10. Pickup expired (post-expire) → InvalidOTP.
```

## Appendix B: Common Python gotchas

```
- secrets.token_hex(n) returns 2n hex chars (n bytes).
- enum.IntEnum members are int — comparisons work; identity does too.
- datetime.utcnow() is naive; use datetime.now(timezone.utc) in production.
- threading.RLock is fine for single-process; for multi-process, use multiprocessing or DB locks.
- dataclass(frozen=True) is shallow; mutable fields inside still mutable.
```

## Appendix C: How to extend toward Amazon's real system

```
- Multi-region: locker locations in many cities; nearest-pickup for customers.
- Carrier integration: USPS/UPS/FedEx couriers with separate access codes.
- Recurring deliveries: subscriber lockers (same locker every time).
- Visualization: store opening hours; some lockers are 24/7, some 6am-10pm.
- Cold chain: temperature-controlled lockers for groceries.
- Customer-uploaded photos: package state on pickup for dispute resolution.
```

# Inventory Management — Low-Level Design (Python)

> **Difficulty:** Medium → Hard
> **Tags:** `[lld]` `[ood]` `[transactions]` `[reservation]` `[concurrency]` `[idempotency]`
> **Language:** Python 3.10+
> **Prep time:** ~10 min skim, ~30 min deep read
> **Companies that ask this:** Amazon, Flipkart, Walmart, Uber, Atlassian

---

## Beginner's Guide

### What's this in plain English?

Amazon's stock-keeping system. Products live in warehouses; each warehouse has counts. Customers buy → reserve stock → ship → decrement. Returns add stock back. Plus: replenishment when low, low-stock alerts, multi-warehouse routing. The hardest part: many concurrent buys for the same hot item must NOT overshoot the stock count.

### Why solve it?

- **Real world**: Amazon, Flipkart, Walmart, every e-commerce company.
- **Teaches**: atomic decrement, reservation pattern, idempotency for retries, multi-warehouse routing.
- **Patterns**: state machine (reservation lifecycle), strategy (allocation rules).

### Vocabulary

- **SKU** — stock-keeping unit (a unique product variant).
- **Stock / Inventory level** — count of available units.
- **Reservation** — temporary hold while customer pays.
- **Idempotency key** — let the same operation retry safely.
- **Replenishment** — refilling stock from suppliers.

### High-level approach

Entities:
- **Product / SKU** — id, name.
- **Warehouse** — id, location, `dict[sku → count]`.
- **Reservation** — order_id, items, status, expiry.
- **InventoryService** — orchestrator, coordinates atomic operations.

Reserve flow under lock per (warehouse, sku):
1. Available count ≥ requested? → decrement available, increment reserved, store reservation.
2. Else → reject.

Confirm flow: convert reserved → shipped (decrement reserved counter). Cancel flow: reserved → available.

For multi-warehouse: try in priority order (closest first), or split across warehouses if no single one has enough.

### How to read this doc

- **Beginner**: focus on the available/reserved/sold split.
- **Interview**: idempotency, optimistic vs pessimistic locking, multi-warehouse routing are the differentiators.

---

## 0. How to use this doc in an interview

Inventory shares DNA with Movie Booking — both are "atomic claim of finite resource." Tests:
1. **Multi-warehouse stock tracking** — same SKU in many warehouses; sum is global on-hand.
2. **Reservation flow** — `reserve` (transient) → `commit` (ship) or `release` (cart abandoned).
3. **Concurrent correctness** — two orders racing for last unit: exactly one wins.
4. **Reorder thresholds** — alert when stock < threshold.
5. **Movement audit** — every reservation, transfer, write-off logged.
6. **Idempotency on commit** — payment retries don't double-deduct.

Trap: not modeling reservations separately from on-hand. Real systems have *available* (on-hand minus reserved); naive design just decrements on order.

---

## 1. Problem Statement

A multi-warehouse inventory system. Each SKU has stock at one or more warehouses. Operations:
- **Receive** — increase stock (incoming shipment).
- **Reserve** — temporarily hold N units for an order; auto-expires if not committed.
- **Commit** — convert a reservation into a shipment (deduct on-hand).
- **Release** — explicit cancel of a reservation (free reserved units).
- **Transfer** — move stock from one warehouse to another (atomic).
- **Adjust** — admin write-off / write-up (lost, damaged, audit).
- Query: available, on-hand, reserved per SKU per warehouse, and globally.

Concurrent multi-user, idempotent commits, reorder alerts.

---

## 2. Clarifying Questions

### Scope
- [ ] Single warehouse or multi?
- [ ] Multiple users / concurrent orders?
- [ ] Auto-allocate from warehouses (best closest? least stocked?), or caller picks?
- [ ] Reservation expiry — fixed window or per-order config?
- [ ] Refunds / restocking?

### Domain
- [ ] What's "available" = on_hand − reserved? Yes.
- [ ] Negative stock allowed (backorder)? No (we reject).
- [ ] Reorder thresholds per (sku, warehouse)?
- [ ] Multi-currency cost tracking? (We track quantity only.)

### Non-functional
- [ ] Concurrency: many concurrent reserves on same SKU.
- [ ] Persistence: in-memory.
- [ ] Audit trail required.

> **For this doc:** multi-warehouse, multi-user, allocation strategy pluggable, default 30-min reservation window, no negative stock, reorder thresholds, audit log, in-memory thread-safe, idempotent commits.

---

## 3. Functional Requirements

**Must-have (P0):**
1. Add/remove SKUs and warehouses.
2. `receive(sku, warehouse, qty)` — increase on-hand.
3. `reserve(sku, qty, customer_id) → Reservation` — across warehouses via allocator.
4. `commit(reservation_id, payment_token) → Movement` (idempotent).
5. `release(reservation_id)`.
6. `transfer(sku, src, dst, qty)` (atomic).
7. `adjust(sku, warehouse, delta, reason)` (admin).
8. `available(sku) → int`, `on_hand_by_warehouse(sku) → dict`.
9. Reservation expiry sweep.
10. Concurrent-correct.
11. Audit log.

**Should-have (P1):**
12. Reorder threshold alerts.
13. Per-warehouse priority for allocation.
14. Movement history per SKU.

**Nice-to-have (P2 — designed):**
15. Multi-tenant.
16. Cost basis tracking (FIFO/LIFO).
17. Lot/batch tracking.
18. Cross-warehouse fulfillment optimization.
19. Backorder / preorder.

---

## 4. Actors & Use Cases

```
                ┌──────────────────┐
                │ Inventory System │
                └──────────────────┘
                  ▲    ▲     ▲    ▲
                  │    │     │    │
            ┌─────┘    │     │    └────────┐
            │          │     │             │
        ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
        │Order   │ │Receiver│ │Admin   │ │Sweeper │
        │Service │ │(receive│ │(adjust,│ │(expire │
        │(reserve│ │ goods) │ │transfer│ │ resvns)│
        │/commit)│ │        │ │  )     │ │        │
        └────────┘ └────────┘ └────────┘ └────────┘
```

---

## 5. Core Entities

| Entity | Attributes |
|---|---|
| `SKU` | sku_id, name, reorder_threshold |
| `Warehouse` | wh_id, name, city |
| `StockItem` | sku_id, wh_id, on_hand, reserved | `available = on_hand - reserved` |
| `Reservation` | id, customer_id, lines: [(sku, wh, qty)], status, expires_at |
| `Movement` | id, type (RECEIVE, COMMIT, TRANSFER, ADJUST), lines, ts |
| `InventorySystem` | facade with locks |

**Enums:**
```
ReservationStatus: ACTIVE, COMMITTED, RELEASED, EXPIRED
MovementType:      RECEIVE, COMMIT, TRANSFER, ADJUST, RELEASE_NOOP
```

---

## 6. Class Diagram (ASCII)

```
                                ┌─────────────────────────────┐
                                │     InventorySystem         │
                                │─────────────────────────────│
                                │ - skus, warehouses          │
                                │ - stock: dict[(sku,wh)→St]  │
                                │ - reservations              │
                                │ - movements                 │
                                │ - allocator: Strategy       │◇──┐
                                │ - lock: RLock               │   │
                                │─────────────────────────────│   │
                                │ + receive, reserve, commit  │   │
                                │ + release, transfer, adjust │   │
                                │ + available, expire_old     │   │
                                └─────┬───────────────────────┘   │
                                      │ ◆                          │
                                      ▼                            │
                               ┌──────────────────┐                │
                               │   StockItem      │                │
                               │  on_hand,reserved│                │
                               └──────────────────┘                │
                                                                   ▼
                                          ┌────────────────────────────────┐
                                          │ «interface»                    │
                                          │ AllocationStrategy             │
                                          │────────────────────────────────│
                                          │ + allocate(sku, qty, stock)    │
                                          │   → list[(wh_id, qty)] | None  │
                                          └─────────▲──────────────────────┘
                                                    │ implements
                                       ┌────────────┴────────────┐
                                       │ FirstFitAllocator       │
                                       │ MostStockedAllocator    │
                                       │ NearestToCustomerAllctr │
                                       └─────────────────────────┘
```

---

## 7. Design Patterns Used

| Pattern | Where | Why |
|---|---|---|
| Strategy | `AllocationStrategy` | Plug warehouse-pick logic |
| State | `Reservation.status` | Active/Committed/Released/Expired with valid transitions |
| Facade | `InventorySystem` | Single entry hides the (sku,wh) maps |
| Two-phase commit | `reserve` + `commit` | Same as MTB |
| Saga (NOT used) | — | For real multi-warehouse cross-system transfers; out of scope |

---

## 8. Sequence Diagrams

### 8.1 Reserve across warehouses

```
  Order        InvSys        Allocator        StockItem(s)
   │             │               │                │
   │── reserve ▶│               │                │
   │             │── allocate ─▶│                │
   │             │   (qty=10, sku=X)             │
   │             │               │── inspect availability of all
   │             │               │      WHs holding X
   │             │◀── [(WH-1,7),(WH-2,3)] ───────│
   │             │── reserve 7 in WH-1 + 3 in WH-2 ─▶ atomic, all-or-nothing
   │◀── reservation_id ───────────│
```

---

## 9. Concurrency Considerations

Coarse `RLock` on `InventorySystem`. Critical section: allocate-and-mark-reserved is one atomic sequence per reservation.

For per-SKU contention scaling:
- Per-SKU lock map (lazy).
- Allocator runs lock-free (snapshot read), then claim under per-SKU lock.

Coarse lock is correct for the interview; mention scaling.

---

## 10. Full Working Code

```python
"""
Inventory Management — Low-Level Design (Python)

Features:
- Multi-SKU, multi-warehouse stock
- Reservation flow with expiry sweep
- Pluggable allocator (first-fit / most-stocked)
- Atomic transfer
- Idempotent commit by payment_token
- Audit log
- Thread-safe
"""
from __future__ import annotations

import enum
import threading
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional


class ReservationStatus(enum.Enum):
    ACTIVE = "active"
    COMMITTED = "committed"
    RELEASED = "released"
    EXPIRED = "expired"


class MovementType(enum.Enum):
    RECEIVE = "receive"
    COMMIT = "commit"
    TRANSFER = "transfer"
    ADJUST = "adjust"


# ──────────────────────────────────────────────────────────────────────────
# Errors
# ──────────────────────────────────────────────────────────────────────────

class InvError(Exception): ...
class InsufficientStock(InvError): ...
class UnknownSKU(InvError): ...
class UnknownWarehouse(InvError): ...
class ReservationNotFound(InvError): ...
class ReservationExpired(InvError): ...
class ReservationAlreadyFinal(InvError): ...
class InvalidPayment(InvError): ...


# ──────────────────────────────────────────────────────────────────────────
# Domain
# ──────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class SKU:
    sku_id: str
    name: str
    reorder_threshold: int = 0  # alert when on_hand drops below


@dataclass(frozen=True)
class Warehouse:
    wh_id: str
    name: str
    city: str


@dataclass
class StockItem:
    sku_id: str
    wh_id: str
    on_hand: int = 0
    reserved: int = 0

    @property
    def available(self) -> int:
        return self.on_hand - self.reserved


@dataclass(frozen=True)
class ReservationLine:
    sku_id: str
    wh_id: str
    qty: int


@dataclass
class Reservation:
    id: str
    customer_id: str
    lines: tuple[ReservationLine, ...]
    created_at: datetime
    expires_at: datetime
    status: ReservationStatus = ReservationStatus.ACTIVE


@dataclass(frozen=True)
class Movement:
    id: str
    type: MovementType
    lines: tuple[tuple[str, str, int], ...]   # (sku, wh, signed_qty)
    timestamp: datetime
    reason: Optional[str] = None


# ──────────────────────────────────────────────────────────────────────────
# Allocation strategy
# ──────────────────────────────────────────────────────────────────────────

class AllocationStrategy(ABC):
    @abstractmethod
    def allocate(
        self,
        sku_id: str,
        qty: int,
        stock_view: list[StockItem],
    ) -> Optional[list[tuple[str, int]]]:
        """Return list of (warehouse_id, qty) or None if cannot fulfill.
        `stock_view` is a list of StockItems for this SKU across warehouses."""


class FirstFitAllocator(AllocationStrategy):
    """Walk warehouses in order; take what's available until qty satisfied."""
    def allocate(self, sku_id, qty, stock_view):
        remaining = qty
        plan: list[tuple[str, int]] = []
        for s in stock_view:
            if remaining <= 0:
                break
            take = min(remaining, s.available)
            if take > 0:
                plan.append((s.wh_id, take))
                remaining -= take
        if remaining > 0:
            return None
        return plan


class MostStockedAllocator(AllocationStrategy):
    """Prefer warehouses with the most available — minimize splits."""
    def allocate(self, sku_id, qty, stock_view):
        sorted_view = sorted(stock_view, key=lambda s: -s.available)
        return FirstFitAllocator().allocate(sku_id, qty, sorted_view)


# ──────────────────────────────────────────────────────────────────────────
# InventorySystem
# ──────────────────────────────────────────────────────────────────────────

class InventorySystem:
    DEFAULT_RESERVATION_WINDOW = timedelta(minutes=30)

    def __init__(self,
                 allocator: Optional[AllocationStrategy] = None,
                 reservation_window: timedelta = DEFAULT_RESERVATION_WINDOW) -> None:
        self._skus: dict[str, SKU] = {}
        self._warehouses: dict[str, Warehouse] = {}
        self._stock: dict[tuple[str, str], StockItem] = {}
        self._reservations: dict[str, Reservation] = {}
        self._movements: list[Movement] = []
        self._idem: dict[str, str] = {}    # payment_token → movement_id
        self._allocator = allocator or FirstFitAllocator()
        self._window = reservation_window
        self._lock = threading.RLock()
        self._audit: list[tuple[str, str]] = []

    # ─── admin ─────────────────────────────────────────────────────

    def add_sku(self, sku_id: str, name: str, reorder_threshold: int = 0) -> SKU:
        with self._lock:
            if sku_id in self._skus:
                raise InvError(f"sku {sku_id} exists")
            sku = SKU(sku_id=sku_id, name=name, reorder_threshold=reorder_threshold)
            self._skus[sku_id] = sku
            return sku

    def add_warehouse(self, wh_id: str, name: str, city: str) -> Warehouse:
        with self._lock:
            if wh_id in self._warehouses:
                raise InvError(f"warehouse {wh_id} exists")
            w = Warehouse(wh_id=wh_id, name=name, city=city)
            self._warehouses[wh_id] = w
            return w

    def _ensure_stock(self, sku_id: str, wh_id: str) -> StockItem:
        if sku_id not in self._skus:
            raise UnknownSKU(sku_id)
        if wh_id not in self._warehouses:
            raise UnknownWarehouse(wh_id)
        key = (sku_id, wh_id)
        if key not in self._stock:
            self._stock[key] = StockItem(sku_id=sku_id, wh_id=wh_id)
        return self._stock[key]

    # ─── core ops ──────────────────────────────────────────────────

    def receive(self, sku_id: str, wh_id: str, qty: int) -> Movement:
        if qty <= 0:
            raise InvError("qty must be positive")
        with self._lock:
            s = self._ensure_stock(sku_id, wh_id)
            s.on_hand += qty
            mv = Movement(
                id=str(uuid.uuid4()),
                type=MovementType.RECEIVE,
                lines=((sku_id, wh_id, +qty),),
                timestamp=datetime.utcnow(),
            )
            self._movements.append(mv)
            self._audit.append(("receive", f"{sku_id}@{wh_id} +{qty}"))
            return mv

    def reserve(self, sku_id: str, qty: int, customer_id: str,
                *, now: Optional[datetime] = None) -> Reservation:
        now = now or datetime.utcnow()
        if qty <= 0:
            raise InvError("qty must be positive")
        with self._lock:
            stock_view = self._stock_view(sku_id)
            plan = self._allocator.allocate(sku_id, qty, stock_view)
            if plan is None:
                total = sum(s.available for s in stock_view)
                raise InsufficientStock(f"sku={sku_id} qty={qty} available={total}")
            # mark reserved across all warehouses (atomic in this lock)
            lines = tuple(ReservationLine(sku_id=sku_id, wh_id=wh, qty=q) for wh, q in plan)
            for wh, q in plan:
                self._stock[(sku_id, wh)].reserved += q
            r = Reservation(
                id=str(uuid.uuid4()),
                customer_id=customer_id,
                lines=lines,
                created_at=now,
                expires_at=now + self._window,
            )
            self._reservations[r.id] = r
            self._audit.append(("reserve", f"{r.id}"))
            return r

    def commit(self, reservation_id: str, payment_token: str,
               *, now: Optional[datetime] = None) -> Movement:
        now = now or datetime.utcnow()
        with self._lock:
            existing = self._idem.get(payment_token)
            if existing is not None:
                return next(m for m in self._movements if m.id == existing)

            r = self._reservations.get(reservation_id)
            if r is None:
                raise ReservationNotFound(reservation_id)
            if r.status is ReservationStatus.COMMITTED:
                raise ReservationAlreadyFinal("already committed")
            if r.status is not ReservationStatus.ACTIVE:
                raise ReservationNotFound(f"status={r.status.value}")
            if now > r.expires_at:
                self._mark_expired(r)
                raise ReservationExpired(reservation_id)
            if not payment_token or len(payment_token) < 8:
                raise InvalidPayment(payment_token)

            for line in r.lines:
                s = self._stock[(line.sku_id, line.wh_id)]
                s.on_hand -= line.qty
                s.reserved -= line.qty
            mv = Movement(
                id=str(uuid.uuid4()),
                type=MovementType.COMMIT,
                lines=tuple((l.sku_id, l.wh_id, -l.qty) for l in r.lines),
                timestamp=now,
            )
            self._movements.append(mv)
            r.status = ReservationStatus.COMMITTED
            self._idem[payment_token] = mv.id
            self._audit.append(("commit", mv.id))
            return mv

    def release(self, reservation_id: str) -> bool:
        with self._lock:
            r = self._reservations.get(reservation_id)
            if r is None or r.status is not ReservationStatus.ACTIVE:
                return False
            for line in r.lines:
                self._stock[(line.sku_id, line.wh_id)].reserved -= line.qty
            r.status = ReservationStatus.RELEASED
            self._audit.append(("release", reservation_id))
            return True

    def transfer(self, sku_id: str, src_wh: str, dst_wh: str, qty: int) -> Movement:
        if qty <= 0:
            raise InvError("qty must be positive")
        if src_wh == dst_wh:
            raise InvError("src and dst must differ")
        with self._lock:
            src = self._ensure_stock(sku_id, src_wh)
            dst = self._ensure_stock(sku_id, dst_wh)
            if src.available < qty:
                raise InsufficientStock(f"src available {src.available} < {qty}")
            src.on_hand -= qty
            dst.on_hand += qty
            mv = Movement(
                id=str(uuid.uuid4()),
                type=MovementType.TRANSFER,
                lines=((sku_id, src_wh, -qty), (sku_id, dst_wh, +qty)),
                timestamp=datetime.utcnow(),
            )
            self._movements.append(mv)
            return mv

    def adjust(self, sku_id: str, wh_id: str, delta: int, reason: str) -> Movement:
        with self._lock:
            s = self._ensure_stock(sku_id, wh_id)
            if s.on_hand + delta < 0:
                raise InsufficientStock("would go negative")
            s.on_hand += delta
            mv = Movement(
                id=str(uuid.uuid4()),
                type=MovementType.ADJUST,
                lines=((sku_id, wh_id, delta),),
                timestamp=datetime.utcnow(),
                reason=reason,
            )
            self._movements.append(mv)
            return mv

    def expire_old(self, now: Optional[datetime] = None) -> list[str]:
        now = now or datetime.utcnow()
        expired: list[str] = []
        with self._lock:
            for r in self._reservations.values():
                if r.status is ReservationStatus.ACTIVE and now > r.expires_at:
                    self._mark_expired(r)
                    expired.append(r.id)
            return expired

    def _mark_expired(self, r: Reservation) -> None:
        for line in r.lines:
            self._stock[(line.sku_id, line.wh_id)].reserved -= line.qty
        r.status = ReservationStatus.EXPIRED
        self._audit.append(("expire", r.id))

    # ─── queries ───────────────────────────────────────────────────

    def _stock_view(self, sku_id: str) -> list[StockItem]:
        return [s for (sku, _), s in self._stock.items() if sku == sku_id]

    def available(self, sku_id: str) -> int:
        with self._lock:
            return sum(s.available for s in self._stock_view(sku_id))

    def on_hand_by_warehouse(self, sku_id: str) -> dict[str, int]:
        with self._lock:
            return {s.wh_id: s.on_hand for s in self._stock_view(sku_id)}

    def reserved_by_warehouse(self, sku_id: str) -> dict[str, int]:
        with self._lock:
            return {s.wh_id: s.reserved for s in self._stock_view(sku_id)}

    def below_reorder_threshold(self) -> list[tuple[str, str, int, int]]:
        """Return [(sku, wh, on_hand, threshold), ...] for all that need reorder."""
        with self._lock:
            out: list[tuple[str, str, int, int]] = []
            for (sku_id, wh_id), s in self._stock.items():
                thresh = self._skus[sku_id].reorder_threshold
                if thresh > 0 and s.on_hand < thresh:
                    out.append((sku_id, wh_id, s.on_hand, thresh))
            return out

    @property
    def audit(self) -> list[tuple[str, str]]:
        return list(self._audit)


# ──────────────────────────────────────────────────────────────────────────
# Demo / tests
# ──────────────────────────────────────────────────────────────────────────

def _basic_flow() -> None:
    print("--- basic ---")
    inv = InventorySystem()
    inv.add_sku("SKU-A", "Widget", reorder_threshold=5)
    inv.add_warehouse("WH-1", "Bay Area", "SF")
    inv.add_warehouse("WH-2", "East Coast", "NYC")
    inv.receive("SKU-A", "WH-1", 10)
    inv.receive("SKU-A", "WH-2", 5)
    assert inv.available("SKU-A") == 15
    r = inv.reserve("SKU-A", 12, "user-1")
    assert inv.available("SKU-A") == 3
    inv.commit(r.id, "TOKEN-12345678")
    assert inv.available("SKU-A") == 3
    by_wh = inv.on_hand_by_warehouse("SKU-A")
    print(f"  on_hand: {by_wh}; available={inv.available('SKU-A')}")
    print("  OK")


def _race_test() -> None:
    print("--- race: 50 threads reserve 1 unit, 10 in stock ---")
    inv = InventorySystem()
    inv.add_sku("SKU-X", "Hot Item")
    inv.add_warehouse("WH", "X", "X")
    inv.receive("SKU-X", "WH", 10)
    succeeded = []
    failed = 0
    succ_lock = threading.Lock()
    fail_lock = threading.Lock()
    def fire(i: int):
        nonlocal failed
        try:
            r = inv.reserve("SKU-X", 1, f"user-{i}")
            with succ_lock:
                succeeded.append(r.id)
        except InsufficientStock:
            with fail_lock:
                failed += 1
    threads = [threading.Thread(target=fire, args=(i,)) for i in range(50)]
    for t in threads: t.start()
    for t in threads: t.join()
    assert len(succeeded) == 10, f"got {len(succeeded)}"
    assert failed == 40
    assert inv.available("SKU-X") == 0
    print(f"  exactly 10 succeeded, {failed} failed ✓")


def _cross_warehouse_alloc() -> None:
    print("--- cross-warehouse allocation ---")
    inv = InventorySystem()
    inv.add_sku("SKU-A", "Widget")
    inv.add_warehouse("WH-1", "A", "A")
    inv.add_warehouse("WH-2", "B", "B")
    inv.receive("SKU-A", "WH-1", 7)
    inv.receive("SKU-A", "WH-2", 5)
    r = inv.reserve("SKU-A", 10, "user-1")  # needs both WHs
    wh_taken = {l.wh_id: l.qty for l in r.lines}
    assert wh_taken == {"WH-1": 7, "WH-2": 3}, wh_taken
    print(f"  allocated: {wh_taken}")


def _expire() -> None:
    print("--- expire reservation ---")
    inv = InventorySystem()
    inv.add_sku("SKU-A", "X")
    inv.add_warehouse("WH", "X", "X")
    inv.receive("SKU-A", "WH", 5)
    base = datetime(2026, 5, 17, 10, 0)
    r = inv.reserve("SKU-A", 3, "user-1", now=base)
    assert inv.available("SKU-A") == 2
    expired = inv.expire_old(now=base + timedelta(minutes=31))
    assert r.id in expired
    assert inv.available("SKU-A") == 5
    print("  OK")


def _idempotent_commit() -> None:
    print("--- idempotent commit ---")
    inv = InventorySystem()
    inv.add_sku("SKU-A", "X")
    inv.add_warehouse("WH", "X", "X")
    inv.receive("SKU-A", "WH", 5)
    r = inv.reserve("SKU-A", 2, "user-1")
    m1 = inv.commit(r.id, "TOKEN-IDEMPOTENT")
    m2 = inv.commit(r.id, "TOKEN-IDEMPOTENT")  # same payment_token
    assert m1.id == m2.id
    assert inv.available("SKU-A") == 3
    print("  OK")


def _transfer() -> None:
    print("--- transfer ---")
    inv = InventorySystem()
    inv.add_sku("SKU-A", "X")
    inv.add_warehouse("WH-1", "A", "A")
    inv.add_warehouse("WH-2", "B", "B")
    inv.receive("SKU-A", "WH-1", 10)
    inv.transfer("SKU-A", "WH-1", "WH-2", 4)
    by_wh = inv.on_hand_by_warehouse("SKU-A")
    assert by_wh["WH-1"] == 6 and by_wh["WH-2"] == 4
    print("  OK")


def _reorder_threshold() -> None:
    print("--- reorder threshold ---")
    inv = InventorySystem()
    inv.add_sku("SKU-A", "X", reorder_threshold=5)
    inv.add_warehouse("WH", "X", "X")
    inv.receive("SKU-A", "WH", 10)
    inv.adjust("SKU-A", "WH", -7, reason="audit")
    alerts = inv.below_reorder_threshold()
    assert ("SKU-A", "WH", 3, 5) in alerts
    print(f"  alerts: {alerts}")


def _release() -> None:
    print("--- release ---")
    inv = InventorySystem()
    inv.add_sku("SKU-A", "X")
    inv.add_warehouse("WH", "X", "X")
    inv.receive("SKU-A", "WH", 5)
    r = inv.reserve("SKU-A", 3, "user-1")
    assert inv.available("SKU-A") == 2
    assert inv.release(r.id) is True
    assert inv.available("SKU-A") == 5
    assert inv.release(r.id) is False
    print("  OK")


if __name__ == "__main__":
    _basic_flow()
    _race_test()
    _cross_warehouse_alloc()
    _expire()
    _idempotent_commit()
    _transfer()
    _reorder_threshold()
    _release()
    print("\nAll tests passed.")
```

### How to run

```bash
python3 ~/Downloads/cc/kb/LLD/Python/inventory-management.py
```

---

## 11. Cross-Questions ("Why X and not Y") — ≥ 12

### 11.1 Why separate `on_hand` and `reserved` instead of just decrementing on order?

The reservation flow is two-phase:
- `reserve` → mark units unavailable (other orders can't claim) but don't ship.
- `commit` → actually deduct on payment.
- `release` / `expire` → cart abandoned, units return to availability.

If we decremented on order: a customer abandoning cart loses their reservation atomically, but the system cannot tell "these units are pending a possible commit" from "these units are gone." Reservation tracking is essential for cancellation/refund flows and for accurate "available" reporting.

`available = on_hand - reserved` is the standard model.

### 11.2 Why a coarse system-level `RLock` instead of per-SKU?

For the interview: simple, correct, sufficient.

For scaling: per-SKU lock map, lazy-init. Reserve hits `lock_for(sku)`. Cross-SKU operations (rare) acquire all locks in sorted order to avoid deadlock. Real Amazon-scale uses per-shard distributed locks.

### 11.3 Why does `reserve` allocate across multiple warehouses?

Customer-facing inventories are multi-warehouse. A "10 units" order may legitimately split across warehouses. The allocator decides — pluggable to optimize for shipping cost, distance, or balance.

For SKUs that only live in one warehouse, plan is single-element. No special case.

### 11.4 Why is `Reservation.lines` a tuple of `ReservationLine` and not a flat list?

Immutability + hashability. After creation, the reservation's allocation shouldn't change.

If a reservation needs partial commit (commit half, release the rest), introduce a new model. Not in P0.

### 11.5 Why idempotency on commit?

Same as MTB: payment retries are common. Without idempotency, retried commit on already-committed reservation either:
- Succeeds again → double-deducts inventory.
- Fails → user thinks payment didn't go through; tries another reservation; chaos.

`payment_token → movement_id` map ensures replay safety.

### 11.6 Why `Movement.lines` instead of separate movement-per-stock-item?

A transfer affects two stock items (src -1, dst +1) but is one logical event. Bundling the lines on one Movement preserves the relationship for audit.

The `commit` of a multi-warehouse reservation similarly atomic.

### 11.7 Why does `commit` decrement `reserved` along with `on_hand`?

Reserved is the "pending claim" counter. On commit, the claim is realized (inventory leaves); reserved must decrement to keep `available = on_hand - reserved` accurate.

If we decrement only `on_hand`, `reserved` lingers — `available` would be wrong.

### 11.8 Why allow `adjust` to take a negative delta?

Real-world inventory loses items: damage, theft, audit corrections. Admin-initiated `adjust` records the variance with a `reason`. The reason field is critical for auditability.

Bound: `on_hand + delta >= 0`. We don't allow negative on_hand.

### 11.9 What about negative inventory (backorder)?

Some businesses allow committing orders without on-hand stock; backorder fulfills later. We reject in P0.

To support: lift the `if remaining > 0: return None` check; track committed-but-not-fulfilled separately. Adds complexity; designed-for.

### 11.10 What's the allocation strategy default and why?

`FirstFitAllocator` — walk warehouses in some stable order, take what's available. Simple, predictable.

`MostStockedAllocator` (P1) — prefer the warehouse with most stock to minimize splits. Better customer experience (fewer shipments).

`NearestToCustomerAllocator` (P2) — minimize shipping cost. Requires customer location.

The choice is a Strategy → swap without touching `reserve`.

### 11.11 What's the failure mode if `reserve` succeeds but Reservation creation fails?

We've already incremented `reserved` on stock items before creating Reservation. If we panic mid-creation, those increments leak.

Fix: build Reservation first, then mutate stock, all under the lock. Or wrap in try/except with rollback. Our code does it in order; if Python raises mid-way, we'd leak. For an interview demo we tolerate; production-grade rollbacks.

### 11.12 Why a separate `expire_old` method instead of background thread?

Same reason as Locker: the library exposes the operation; the embedding application schedules it (cron, async task).

In a service, a periodic job calls it every minute.

### 11.13 What about lot/batch tracking (FIFO inventory)?

Add `Lot(lot_id, sku, wh, qty, received_at)`. `StockItem` becomes a list of lots. `reserve` consumes from oldest first (FIFO).

Significant change; designed-for.

### 11.14 What if a customer reserves 10 units across 3 warehouses but pays for only 7?

Currently, `commit` is all-or-nothing. Partial commit would need a new method `commit_partial(reservation, line_quantities)` that commits some lines and releases others.

Out of scope; mention as extension.

### 11.15 Why does `transfer` not go through reserve+commit?

Transfer is admin-initiated, atomic: src -qty, dst +qty in one step. No payment involved; no two-phase needed.

Reserve+commit is the customer order flow.

### 11.16 What's the failure mode under high concurrency on same SKU?

Coarse lock serializes. 1000 reserves/sec on one SKU all serialize through the lock. Per-SKU locks would parallelize across SKUs but same-SKU contention remains.

For Amazon-scale, SKUs are sharded; database row-level locking carries the load.

### 11.17 How would you scale to multi-region?

Each region has its own InventorySystem instance with its own warehouses. Cross-region transfer is its own sync — out of scope for in-memory.

For real distributed inventory: event sourcing + per-warehouse leader; CRDTs (G-Counter for received, P-Set for committed) — heavy machinery.

---

## 12. Extensions

### 12.1 Lot/batch tracking
Add `Lot` and FIFO consumption.

### 12.2 Multi-tenant
Add `tenant_id` to every entity; partition by tenant.

### 12.3 Cost basis (FIFO/LIFO)
Track per-lot cost; calculate COGS on commit.

### 12.4 Backorder/preorder
Allow commit beyond on_hand; track expected-fulfillment date.

### 12.5 Shipping cost optimization
`AllocationStrategy` that minimizes total shipping cost (distance × weight).

### 12.6 Webhooks on threshold
On `below_reorder_threshold`, emit event for procurement.

### 12.7 Persistence + event sourcing
Movements are the source of truth; rebuild stock by replaying.

---

## 13. Cheat-Sheet Recap

1. **Problem:** Multi-warehouse inventory with reservation flow + atomic transfers.
2. **Core entities:** SKU, Warehouse, StockItem, Reservation, Movement.
3. **Patterns:** Strategy (allocator), State (reservation), Facade, Two-phase commit-light.
4. **Key invariant:** `available = on_hand - reserved`.
5. **Concurrency:** Coarse RLock; per-SKU as scaling step.
6. **Idempotency:** payment_token → movement_id.
7. **Trade-offs:** No backorder; coarse lock; pluggable allocator.

---

## Appendix A: Test cases

```
1. Receive + reserve + commit → on_hand decreases.
2. 50 threads reserve 1 unit, 10 in stock → exactly 10 succeed.
3. Cross-warehouse allocation when single WH insufficient.
4. Reservation expires → reserved restored.
5. Idempotent commit: same payment_token → same movement.
6. Transfer: src→dst atomically.
7. Reorder threshold alert.
8. Release: reservation cancelled; reserved restored.
9. Adjust: negative delta cannot go below 0.
10. Multi-SKU: independent reserves; no interference.
```

## Appendix B: Common Python-specific gotchas

```
- @dataclass(frozen=True) is shallow; tuple of mutable inner objects still mutable.
- enum.Enum members compare with `is`; numeric IntEnum allows ordering.
- defaultdict is convenient; we use explicit dict for clarity.
- threading.RLock allows re-entry; we don't actually need it but it's safer.
- datetime.utcnow() naive; production datetime.now(timezone.utc).
```

## Appendix C: Why this question is loved by interviewers

```
- Concurrency on shared resource is fundamental.
- Two-phase reserve/commit mirrors real e-commerce flows.
- Multi-warehouse adds depth (cross-warehouse allocation strategy).
- Idempotency on commit catches subtle bugs.
- Audit trail is real-world (compliance, debugging).
- Open-ended extensions: lots, multi-tenant, cost basis, etc.
```

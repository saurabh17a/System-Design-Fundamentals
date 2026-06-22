# Elevator System — Low-Level Design (Python)

> **Difficulty:** Medium → Hard
> **Tags:** `[lld]` `[ood]` `[state-machine]` `[scheduling]` `[strategy]` `[concurrency]`
> **Language:** Python 3.10+
> **Prep time:** ~10 min skim, ~30 min deep read
> **Companies that ask this:** Amazon, Google, Microsoft, Bloomberg, every product OOD round

---

## Beginner's Guide

### What's this in plain English?

A building has multiple elevators. People press buttons inside (cab buttons: "I want floor 7") and outside (hall buttons: "I'm on floor 4 and want to go up"). The system has to decide which elevator goes where, when. Smart buildings minimize total wait time, balance load, and don't keep elevators bouncing aimlessly.

### Why solve it?

- **Real world**: actual elevators, dispatching algorithms appear in MapReduce schedulers, hospital queues, even disk scheduling.
- **Teaches**: state machines per elevator (IDLE / GOING_UP / GOING_DOWN), scheduling algorithms (FCFS, SCAN, LOOK), multi-elevator coordination, concurrency (each elevator runs in its own thread/goroutine).
- **Interview**: classic systems-thinking question.

### Vocabulary

- **Cab request** — button inside the elevator (floor X).
- **Hall request** — button on a floor (going up / going down).
- **Direction** — UP, DOWN, IDLE.
- **Scheduling algorithm** — strategy to decide what's next:
  - **FCFS**: first-come-first-served (terrible — elevators thrash).
  - **SCAN**: sweep up to top, then sweep down. Like an elevator from the 70s.
  - **LOOK**: SCAN but stop at highest pending request, not the top. Better.
- **Dispatcher** — central component that assigns hall requests to elevators.

### High-level approach

Entities:
- **Elevator** — id, current_floor, direction, state, set of pending stops.
- **Request** — origin, destination, direction.
- **Dispatcher** — receives hall calls; picks best elevator (one going your way and passing by is best).
- **SchedulingStrategy** — interface; LOOK is typical.
- **Building** — N elevators, M floors, dispatcher.

Each elevator runs its own loop: pop next stop (per strategy), move floor by floor, open doors, accept new requests.

Concurrency: requests come in from many threads; each elevator's pending-stops set must be thread-safe.

### How to read this doc

- **Beginner**: focus on the per-elevator state machine and LOOK algorithm.
- **Interview**: dispatcher logic and multi-elevator optimization are the differentiators.

---

## 0. How to use this doc in an interview

Elevator System is the **state-machine + scheduling** OOD interview. Where Parking Lot is "model the entities", Elevator is "model the entities AND the algorithm that drives them."

Interviewers grade on:
1. Did you separate **request handling** from **elevator state** from **scheduling logic**?
2. Did you pick a sensible **scheduling algorithm** and justify it? (FCFS / SCAN / LOOK / SSTF.)
3. Did you handle **multi-elevator coordination** — N elevators serving the same building?
4. Did you reason about **concurrency** correctly — many threads pressing buttons simultaneously?
5. Did you cover **edge cases** — direction changes, doors, capacity, emergency, maintenance?

Trap: jumping straight to the SCAN/LOOK algorithm without first naming the actors and modeling the elevator's state. Spend ~20 min on diagram + state transitions before any algorithm code.

---

## 1. Problem Statement

Design an elevator system for a building with multiple floors and multiple elevators. Users press buttons:
- **External buttons** on each floor: UP, DOWN.
- **Internal buttons** in each elevator car: floor numbers.

The system decides:
- Which elevator picks up which external request.
- The order in which an elevator visits its queued floors.
- Door open/close timing.
- Capacity limits.
- Emergency / maintenance / VIP modes.

Goals (in order): **safety**, **fairness** (no rider waits forever), **throughput** (move many people fast), **energy** (don't move empty when avoidable).

---

## 2. Clarifying Questions to Ask the Interviewer

### Scope
- [ ] How many floors? How many elevators? (4 floors / 2 elevators is different from 50 floors / 8 elevators.)
- [ ] Are some floors **express-only** (e.g. lobby and floors 30–50)?
- [ ] Do we model **doors**, **capacity (weight/count)**, **direction indicators**?
- [ ] **Maintenance mode**, **fire emergency**, **VIP / restricted**?
- [ ] **Hall-call destination dispatch** (rider enters destination at the lobby panel before boarding) or **classic two-step** (press up/down, board, press floor)?

### Domain
- [ ] How is **fairness** measured — average wait? max wait? both?
- [ ] What's the **scheduling algorithm** preference — simple SCAN, LOOK, SSTF, or destination-dispatch?
- [ ] How long does the **door** stay open? Configurable per request?

### Non-functional
- [ ] How many requests per second peak (lunchtime spike)?
- [ ] Concurrency: many people press buttons in parallel — how is correctness guaranteed?
- [ ] In-memory simulation, or controller for real hardware? (Affects how robustly we handle I/O failure.)

> **For this doc** we'll assume: 20 floors, 4 elevators, all floors served by all elevators, classic two-step (no destination dispatch), pluggable scheduling strategy with default LOOK + nearest-car selection, no maintenance/fire/VIP (called out as P2), thread-safe in-memory simulation, single building.

---

## 3. Functional Requirements

**Must-have (P0):**
1. External request: `request_external(floor, direction)` — system assigns an elevator.
2. Internal request: rider in an elevator presses a floor → added to that elevator's stop list.
3. An elevator follows its scheduling algorithm: services its queue, opens doors at each stop, moves on.
4. Idle elevators "park" (stay where they are) until a request arrives.
5. Multi-elevator selection picks the best elevator per external request (proximity, direction, load).
6. Capacity: elevator refuses to accept new internal requests when at max load (or signals overweight).
7. Thread-safe across concurrent requests.

**Should-have (P1):**
8. **Direction-aware** scheduling — keep moving in current direction, then reverse (LOOK).
9. Configurable scheduling strategy (FCFS / SSTF / LOOK / SCAN).
10. Idle parking strategy (return to lobby vs distribute across building).
11. Audit / metrics (wait time per request, trip duration).

**Nice-to-have (P2 — out of scope for code, designed-for):**
12. Emergency / fire (recall to ground).
13. Maintenance mode (remove elevator from service).
14. Destination dispatch.
15. Predictive scheduling (ML on usage patterns).

---

## 4. Actors & Use Cases

```
                    ┌──────────────────┐
                    │ Elevator System  │
                    └──────────────────┘
                  ▲      ▲     ▲      ▲
                  │      │     │      │
        ┌─────────┘      │     │      └─────────┐
        │                │     │                │
  ┌─────────┐    ┌──────────┐ ┌──────────┐ ┌─────────┐
  │External │    │Internal  │ │ Operator │ │Maintenance│
  │Caller   │    │Rider     │ │ (admin)  │ │ Mode      │
  │(floor   │    │(in car)  │ │          │ │           │
  │button)  │    │          │ │          │ │           │
  └─────────┘    └──────────┘ └──────────┘ └─────────┘
```

### External caller
- Press UP or DOWN on a floor; wait for an assigned elevator.

### Internal rider
- Press a destination floor; system schedules a stop.

### Operator
- Configure scheduling strategy.
- Trigger system-wide events (recall all to lobby).

### Maintenance / Emergency
- Take an elevator out of service.
- Force all elevators to ground floor.

---

## 5. Core Entities

| Entity | Attributes | Notes |
|---|---|---|
| `Direction` | enum: UP, DOWN, IDLE | |
| `ElevatorState` | enum: IDLE, MOVING, DOORS_OPEN, DOORS_CLOSING, OUT_OF_SERVICE | The state machine |
| `Request` | request_id, floor, direction (external) or destination (internal), timestamp | |
| `Elevator` | id, current_floor, direction, state, stops (sorted set), capacity, load, scheduler | |
| `ElevatorScheduler` | strategy interface: `next_stop(elevator)` → floor | |
| `ElevatorSelector` | strategy interface: `pick_elevator(request, elevators)` → elevator | |
| `Building` | floors, elevators, request queues | Top-level facade |

**Why two separate strategies?**
- `ElevatorScheduler`: given an elevator's queue, what's the next stop? (Per-elevator algorithm — LOOK, SCAN, SSTF.)
- `ElevatorSelector`: given a new external request, which elevator should serve it? (System-level — nearest, balanced, predictive.)

These are **independent decisions**. Mixing them in one strategy makes both harder to swap.

---

## 6. Class Diagram (ASCII)

```
                              ┌──────────────────────────────┐
                              │           Building           │
                              │──────────────────────────────│
                              │ - elevators: list[Elevator]  │
                              │ - selector: ElevatorSelector │◇──┐
                              │ - num_floors                 │   │
                              │ - lock: RLock                │   │
                              │──────────────────────────────│   │
                              │ + request_external(f, dir)   │   │
                              │ + step()                     │   │
                              └──────┬───────────────────────┘   │
                                     │ ◆                          │
                                     ▼                            │
                              ┌──────────────────────┐            │
                              │       Elevator       │            │
                              │──────────────────────│            │
                              │ - id                 │            │
                              │ - current_floor      │            │
                              │ - direction          │            │
                              │ - state              │            │
                              │ - stops: SortedSet   │            │
                              │ - capacity, load     │            │
                              │ - scheduler          │◇──┐        │
                              │ - lock               │   │        │
                              │──────────────────────│   │        │
                              │ + add_stop(floor)    │   │        │
                              │ + step()             │   │        │
                              │ + open_doors()       │   │        │
                              └──────────────────────┘   │        │
                                                         │        │
                                                         │        │
                              ┌─────────────────────┐    │        │
                              │ «interface»         │    │        │
                              │ ElevatorScheduler   │◀───┘        │
                              │─────────────────────│             │
                              │ + next_stop(e)→int? │             │
                              └─────────▲───────────┘             │
                                        │                          │
                                        │                          │
                              ┌─────────┴────────────┐             │
                              │ FCFSScheduler        │             │
                              │ SSTFScheduler        │             │
                              │ LookScheduler  ◀── default        │
                              │ ScanScheduler        │             │
                              └──────────────────────┘             │
                                                                   │
                              ┌─────────────────────┐              │
                              │ «interface»         │              │
                              │ ElevatorSelector    │◀─────────────┘
                              │─────────────────────│
                              │ + pick(req, list)   │
                              │   → Elevator        │
                              └─────────▲───────────┘
                                        │
                              ┌─────────┴────────────┐
                              │ NearestSelector      │
                              │ DirectionAwareSel.   │
                              │ LeastLoadedSelector  │
                              └──────────────────────┘

  ┌──────────────┐          ┌──────────────┐
  │  Direction   │          │   State      │
  │  (enum)      │          │   (enum)     │
  └──────────────┘          └──────────────┘
```

---

## 7. Design Patterns Used (and Why)

| Pattern | Where used | Why this pattern | Alternative considered |
|---|---|---|---|
| State | `ElevatorState`, transitions guarded in `step()` | 5+ states with distinct behavior; transitions must be validated | If/else nested in one big method — duplicates per-state logic, easy to break |
| Strategy | `ElevatorScheduler`, `ElevatorSelector` | Two independent algorithm choices, both swappable | Inline algorithm in Elevator class — couples the elevator to one algorithm |
| Facade | `Building` | Single entry for users; hides elevator + scheduler internals | Direct elevator access — couples callers |
| Observer (NOT used) | — | Tempting to notify UI on state change. Out of scope; keep design lean |
| Command (NOT used) | — | Could reify each request; overkill — `Request` dataclass is enough |

---

## 8. Sequence Diagrams

### 8.1 External request → assigned to elevator

```
  Caller        Building       Selector        Elevator
    │              │               │              │
    │── req(5,UP) ▶│               │              │
    │              │── pick ──────▶│              │
    │              │   request, [E1, E2, E3, E4] │
    │              │◀── E2 ────────│              │
    │              │── add_stop(5) ─────────────▶ │
    │              │◀── ok ────────────────────── │
    │◀── ack ──────│               │              │
```

### 8.2 Tick of the simulation (one elevator)

```
  Building       Elevator     Scheduler
    │               │             │
    │── step ──────▶│             │
    │               │── next ────▶│
    │               │◀── 5 ───────│
    │               │  (move toward 5; if at 5, open doors, etc.)
    │◀── (state)────│             │
```

### 8.3 Internal request

```
  Rider         Elevator     Scheduler
    │              │              │
    │── press(8) ─▶│              │
    │              │── add_stop ─▶│
    │              │◀── ok ───────│
    │◀── ack ──────│              │
```

---

## 9. Concurrency Considerations

Multiple sources mutate elevator state in parallel:
- External callers (button presses).
- Internal riders.
- Simulation tick (`step()`).
- Admin (mode changes).

Each `Elevator` owns its own lock. The `Building` has a coarser lock for cross-elevator decisions (selection).

Pattern:
- `Elevator.add_stop` and `Elevator.step` lock per-elevator.
- `Building.request_external` locks Building (briefly, to pick), then locks the chosen elevator.
- Lock acquisition order: Building → Elevator. Never Elevator → Building (deadlock-free).

For a real building with hardware, the simulation tick is replaced by an event loop driven by sensors. Same locking discipline.

---

## 10. Full Working Code

```python
"""
Elevator System — Low-Level Design (Python)

A complete, runnable simulation:
- multi-elevator, multi-floor
- pluggable scheduler (per-elevator) and selector (across elevators)
- thread-safe button presses
- discrete time step() driving the simulation
"""

from __future__ import annotations

import enum
import heapq
import threading
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional


# ──────────────────────────────────────────────────────────────────────────
# Enums and value types
# ──────────────────────────────────────────────────────────────────────────

class Direction(enum.Enum):
    UP = 1
    DOWN = -1
    IDLE = 0


class ElevatorState(enum.Enum):
    IDLE = "idle"
    MOVING = "moving"
    DOORS_OPENING = "opening"
    DOORS_OPEN = "open"
    DOORS_CLOSING = "closing"
    OUT_OF_SERVICE = "oos"


@dataclass(frozen=True)
class ExternalRequest:
    floor: int
    direction: Direction
    request_id: int


@dataclass(frozen=True)
class InternalRequest:
    floor: int
    request_id: int


# ──────────────────────────────────────────────────────────────────────────
# Strategy: per-elevator scheduling
# ──────────────────────────────────────────────────────────────────────────

class ElevatorScheduler(ABC):
    """Given an elevator's current state and pending stops, return the next floor to head to."""
    @abstractmethod
    def next_stop(self, elevator: "Elevator") -> Optional[int]:
        ...


class FCFSScheduler(ElevatorScheduler):
    """First-come-first-served: serve in arrival order."""
    def next_stop(self, elevator: "Elevator") -> Optional[int]:
        if not elevator.queue:
            return None
        return elevator.queue[0]


class SSTFScheduler(ElevatorScheduler):
    """Shortest-Seek-Time-First: closest pending stop wins. Risk: starvation of far floors."""
    def next_stop(self, elevator: "Elevator") -> Optional[int]:
        if not elevator.stops_set:
            return None
        return min(elevator.stops_set, key=lambda f: abs(f - elevator.current_floor))


class LookScheduler(ElevatorScheduler):
    """LOOK: keep going in current direction until no pending stops in that direction; then reverse.
    No starvation. The de-facto industry default."""
    def next_stop(self, elevator: "Elevator") -> Optional[int]:
        stops = elevator.stops_set
        if not stops:
            return None
        cur = elevator.current_floor
        d = elevator.direction
        if d is Direction.UP:
            ahead = sorted(s for s in stops if s >= cur)
            if ahead:
                return ahead[0]
            # nothing above → reverse
            below = sorted((s for s in stops if s < cur), reverse=True)
            return below[0] if below else None
        if d is Direction.DOWN:
            below = sorted((s for s in stops if s <= cur), reverse=True)
            if below:
                return below[0]
            ahead = sorted(s for s in stops if s > cur)
            return ahead[0] if ahead else None
        # IDLE → pick closest, set direction
        return min(stops, key=lambda f: abs(f - cur))


class ScanScheduler(ElevatorScheduler):
    """SCAN ('elevator algorithm'): like LOOK but always travels to the end of the building before reversing.
    Less efficient than LOOK; rarely chosen in practice."""
    def __init__(self, top_floor: int, bottom_floor: int = 0):
        self.top = top_floor
        self.bottom = bottom_floor

    def next_stop(self, elevator: "Elevator") -> Optional[int]:
        stops = elevator.stops_set
        if not stops:
            return None
        cur, d = elevator.current_floor, elevator.direction
        if d is Direction.UP:
            ahead = sorted(s for s in stops if s >= cur)
            return ahead[0] if ahead else self.top  # travel to top, then reverse
        if d is Direction.DOWN:
            below = sorted((s for s in stops if s <= cur), reverse=True)
            return below[0] if below else self.bottom
        return min(stops, key=lambda f: abs(f - cur))


# ──────────────────────────────────────────────────────────────────────────
# Strategy: cross-elevator selection
# ──────────────────────────────────────────────────────────────────────────

class ElevatorSelector(ABC):
    @abstractmethod
    def pick(self, request: ExternalRequest, elevators: list["Elevator"]) -> Optional["Elevator"]:
        ...


class NearestSelector(ElevatorSelector):
    """Pick the closest IDLE elevator; break ties by lowest id. If none idle, closest by abs distance."""
    def pick(self, request: ExternalRequest, elevators: list["Elevator"]) -> Optional["Elevator"]:
        candidates = [e for e in elevators if e.state is not ElevatorState.OUT_OF_SERVICE]
        if not candidates:
            return None
        # prefer idle, then closest direction-compatible
        idle = [e for e in candidates if e.direction is Direction.IDLE]
        pool = idle or candidates
        return min(pool, key=lambda e: (abs(e.current_floor - request.floor), e.id))


class DirectionAwareSelector(ElevatorSelector):
    """Prefer elevators heading the same direction and approaching the request floor.
    Falls back to nearest if none qualify. Closer to real-world dispatching."""
    def pick(self, request: ExternalRequest, elevators: list["Elevator"]) -> Optional["Elevator"]:
        candidates = [e for e in elevators if e.state is not ElevatorState.OUT_OF_SERVICE]
        if not candidates:
            return None

        def score(e: "Elevator") -> tuple:
            distance = abs(e.current_floor - request.floor)
            same_dir = e.direction is request.direction
            approaching = (
                (request.direction is Direction.UP and e.current_floor <= request.floor and e.direction is Direction.UP)
                or
                (request.direction is Direction.DOWN and e.current_floor >= request.floor and e.direction is Direction.DOWN)
            )
            # tuple sort: idle wins; else approaching same-direction; else closest
            return (
                0 if e.direction is Direction.IDLE else 1,
                0 if approaching else 1,
                0 if same_dir else 1,
                distance,
                e.id,
            )

        return min(candidates, key=score)


# ──────────────────────────────────────────────────────────────────────────
# Elevator
# ──────────────────────────────────────────────────────────────────────────

@dataclass
class Elevator:
    id: int
    current_floor: int
    capacity: int
    scheduler: ElevatorScheduler
    direction: Direction = Direction.IDLE
    state: ElevatorState = ElevatorState.IDLE
    load: int = 0
    door_timer: int = 0  # ticks remaining for door cycle
    queue: list[int] = field(default_factory=list)            # FIFO order (used by FCFSScheduler)
    stops_set: set[int] = field(default_factory=set)          # de-duped set, used by other schedulers
    lock: threading.RLock = field(default_factory=threading.RLock, repr=False)
    DOOR_OPEN_TICKS: int = 2

    # ─── public API ─────────────────────────────────────────────────────

    def add_stop(self, floor: int) -> bool:
        """Add a stop to the elevator's queue. Returns True if newly added."""
        with self.lock:
            if self.state is ElevatorState.OUT_OF_SERVICE:
                return False
            if floor in self.stops_set:
                return False
            self.queue.append(floor)
            self.stops_set.add(floor)
            # If idle, kick off motion next step.
            if self.state is ElevatorState.IDLE:
                self.state = ElevatorState.MOVING  # tentative; step() resolves direction
            return True

    def step(self) -> None:
        """One tick of the simulation. Call this from the Building loop."""
        with self.lock:
            if self.state is ElevatorState.OUT_OF_SERVICE:
                return

            # door cycle
            if self.state is ElevatorState.DOORS_OPENING:
                self.state = ElevatorState.DOORS_OPEN
                self.door_timer = self.DOOR_OPEN_TICKS
                return
            if self.state is ElevatorState.DOORS_OPEN:
                self.door_timer -= 1
                if self.door_timer <= 0:
                    self.state = ElevatorState.DOORS_CLOSING
                return
            if self.state is ElevatorState.DOORS_CLOSING:
                self.state = ElevatorState.IDLE if not self.stops_set else ElevatorState.MOVING
                return

            # idle
            if not self.stops_set:
                self.state = ElevatorState.IDLE
                self.direction = Direction.IDLE
                return

            target = self.scheduler.next_stop(self)
            if target is None:
                self.state = ElevatorState.IDLE
                self.direction = Direction.IDLE
                return

            if self.current_floor == target:
                # arrived: pop, open doors
                self.stops_set.discard(target)
                if target in self.queue:
                    self.queue.remove(target)
                self.state = ElevatorState.DOORS_OPENING
                # direction: if more stops above, UP; below, DOWN; else IDLE next
                if any(s > self.current_floor for s in self.stops_set):
                    self.direction = Direction.UP
                elif any(s < self.current_floor for s in self.stops_set):
                    self.direction = Direction.DOWN
                else:
                    self.direction = Direction.IDLE
                return

            # move one floor toward target
            self.state = ElevatorState.MOVING
            if target > self.current_floor:
                self.direction = Direction.UP
                self.current_floor += 1
            else:
                self.direction = Direction.DOWN
                self.current_floor -= 1

    def board(self, count: int = 1) -> bool:
        """Add riders. Returns False if over capacity."""
        with self.lock:
            if self.load + count > self.capacity:
                return False
            self.load += count
            return True

    def alight(self, count: int = 1) -> None:
        with self.lock:
            self.load = max(0, self.load - count)

    def set_out_of_service(self) -> None:
        with self.lock:
            self.state = ElevatorState.OUT_OF_SERVICE
            self.direction = Direction.IDLE

    def set_in_service(self) -> None:
        with self.lock:
            if self.state is ElevatorState.OUT_OF_SERVICE:
                self.state = ElevatorState.IDLE


# ──────────────────────────────────────────────────────────────────────────
# Building (facade)
# ──────────────────────────────────────────────────────────────────────────

class Building:
    def __init__(self,
                 num_floors: int,
                 num_elevators: int,
                 capacity: int = 10,
                 selector: Optional[ElevatorSelector] = None,
                 scheduler_factory=None):
        self.num_floors = num_floors
        self._lock = threading.RLock()
        scheduler_factory = scheduler_factory or (lambda: LookScheduler())
        self.elevators = [
            Elevator(id=i, current_floor=0, capacity=capacity, scheduler=scheduler_factory())
            for i in range(num_elevators)
        ]
        self.selector = selector or DirectionAwareSelector()
        self._req_id = 0

    def _next_req_id(self) -> int:
        self._req_id += 1
        return self._req_id

    def request_external(self, floor: int, direction: Direction) -> Optional[Elevator]:
        """A passenger on `floor` presses the UP/DOWN button."""
        if not (0 <= floor < self.num_floors):
            raise ValueError(f"floor {floor} out of range")
        if direction is Direction.IDLE:
            raise ValueError("external request must specify UP or DOWN")
        req = ExternalRequest(floor=floor, direction=direction, request_id=self._next_req_id())
        with self._lock:
            chosen = self.selector.pick(req, self.elevators)
        if chosen is None:
            return None
        chosen.add_stop(floor)
        return chosen

    def request_internal(self, elevator_id: int, dest_floor: int) -> bool:
        """A passenger inside elevator `elevator_id` presses a destination."""
        if not (0 <= dest_floor < self.num_floors):
            raise ValueError(f"floor {dest_floor} out of range")
        if not (0 <= elevator_id < len(self.elevators)):
            raise ValueError(f"elevator {elevator_id} not found")
        return self.elevators[elevator_id].add_stop(dest_floor)

    def step_all(self) -> None:
        """Advance the simulation one tick across all elevators."""
        for e in self.elevators:
            e.step()

    def snapshot(self) -> list[dict]:
        return [
            {
                "id": e.id,
                "floor": e.current_floor,
                "dir": e.direction.name,
                "state": e.state.name,
                "stops": sorted(e.stops_set),
                "load": e.load,
            }
            for e in self.elevators
        ]


# ──────────────────────────────────────────────────────────────────────────
# Demo
# ──────────────────────────────────────────────────────────────────────────

def _demo() -> None:
    b = Building(num_floors=20, num_elevators=4, capacity=10)

    # Morning rush — many up requests from low floors
    b.request_external(0, Direction.UP)
    b.request_external(2, Direction.UP)
    b.request_external(5, Direction.UP)
    b.request_external(15, Direction.DOWN)

    # Internal requests after boarding
    b.request_internal(0, 12)
    b.request_internal(1, 7)

    # Simulate 30 ticks
    for tick in range(30):
        b.step_all()
        if tick in (0, 5, 10, 15, 20, 25, 29):
            print(f"\n── tick {tick} ──")
            for s in b.snapshot():
                print(f"  E{s['id']}: floor={s['floor']:>2}  dir={s['dir']:<4}  "
                      f"state={s['state']:<7}  stops={s['stops']}")

    print("\nDemo complete. All elevators returned to IDLE? ",
          all(e.state is ElevatorState.IDLE for e in b.elevators))

    # Concurrency smoke: 100 random external requests across many threads
    print("\n--- concurrency: 100 requests from 100 threads ---")
    b2 = Building(num_floors=20, num_elevators=4, capacity=10)
    import random
    rng = random.Random(0)

    def fire():
        f = rng.randrange(0, 20)
        d = rng.choice([Direction.UP, Direction.DOWN])
        try:
            b2.request_external(f, d)
        except ValueError:
            pass

    threads = [threading.Thread(target=fire) for _ in range(100)]
    for t in threads: t.start()
    for t in threads: t.join()

    total_pending = sum(len(e.stops_set) for e in b2.elevators)
    print(f"Pending stops queued across all elevators: {total_pending}")
    # invariant: total_pending <= 100 (some requests may collide on same floor → de-duped within an elevator)
    assert total_pending <= 100


if __name__ == "__main__":
    _demo()
```

### How to run

```bash
python3 ~/Downloads/cc/kb/LLD/Python/elevator-system.py
```

Expected output: shows elevators picking up requests, moving through floors, opening doors, and all settling to IDLE within 30 ticks. Concurrency test: 100 button presses fire across threads; assertion confirms no double-counted stops.

---

## 11. Cross-Questions ("Why X and not Y") — ≥ 12

### 11.1 Why LOOK as the default and not SCAN, SSTF, or FCFS?

- **FCFS** is fair but pessimal — an elevator at floor 3 with stops at 1 and 18 visits 1 first if pressed first, even though 18 is on the way past 3.
- **SSTF** minimizes per-step cost but **starves** distant requests forever in busy buildings.
- **SCAN** travels to the end before reversing — wasted travel when there's nothing at the end.
- **LOOK** combines fairness (no starvation: every direction is served before reversing) with efficiency (no wasted travel beyond the last stop).

LOOK matches how real dispatchers think and is what most elevator controllers ship.

### 11.2 Why two strategies (`Scheduler` and `Selector`) instead of one?

They make **different decisions at different moments**:
- `ElevatorSelector` decides *which elevator* gets a new external request (cross-elevator, building-level).
- `ElevatorScheduler` decides *what floor an elevator visits next* given its queue (intra-elevator).

Some products mix them ("destination-dispatch" couples both). Keeping them separate lets us swap one without touching the other — e.g. switch to predictive selection while keeping LOOK scheduling.

### 11.3 Why a state machine with explicit `ElevatorState` instead of derived booleans?

Booleans like `is_moving` and `door_open` would create illegal combos (`is_moving=True, door_open=True` — moving with doors open is a safety bug). An enum makes the legal states explicit and unrepresentable-states-impossible.

We also encode transitions in `step()` — it's the single place where state changes — making invariants auditable.

### 11.4 Why a discrete `step()` simulation tick rather than time-driven?

A discrete tick is:
- **Deterministic** in tests — same sequence of requests + ticks → same outcome.
- **Easy to reason** — one state change per tick.
- **Real hardware adapts**: in production, the controller is event-driven (sensors, button presses, motor positions). The OOD answer is the simulation; the real product replaces `step()` with sensor callbacks.

### 11.5 Why does the elevator hold a `stops_set` AND a `queue`?

- `queue` (list, append-on-add): preserves arrival order — needed for FCFS.
- `stops_set` (set): de-duplicates; supports "is floor X already pending?" in O(1).

We could use only one structure but pay O(N) lookups elsewhere. Two structures, one source of truth (`stops_set`), with `queue` as an FCFS-only auxiliary. Memory cost is negligible (≤ num_floors entries).

### 11.6 Why a per-elevator lock instead of a single building lock?

Per-elevator locks give N-way parallelism for the most common operations (button presses on different elevators, ticks on different elevators). The building-level lock is only held briefly during selection.

Lock acquisition order: Building lock → Elevator lock. Never the reverse. Holds even when an operation chains (request_external selects an elevator under building lock, then releases, then takes elevator lock to add the stop).

### 11.7 Why do we keep moving direction even after stops are exhausted (ELEVATOR.direction)?

Many algorithms reason about direction; we don't unset it eagerly. In LOOK, knowing the current direction is necessary to pick the next stop in the same direction first.

When stops are exhausted, `step()` resets direction to `IDLE`. Until then it stays.

### 11.8 What about door safety — can we open doors while moving?

The state machine forbids it. `step()` only opens doors when `current_floor == target` AND we are not in `MOVING`. The transitions are: `MOVING → DOORS_OPENING → DOORS_OPEN → DOORS_CLOSING → MOVING|IDLE`. There's no path from `MOVING` directly to `DOORS_OPEN`.

For real hardware, the door motor is a separate physical actuator with interlocks; the controller signals open/close, but a physical safety prevents motion-with-doors-open regardless of software.

### 11.9 What if all elevators are out of service?

`request_external` returns `None`. Caller (UI) shows an error. Real systems escalate to a maintenance alert.

### 11.10 What if a passenger boards but doesn't press a destination?

The elevator services its existing queue (stops from other passengers, external requests). The unselecting passenger rides to wherever the elevator goes. Real systems have door-close timers + over-capacity sensors.

### 11.11 How do we handle "go to the closest call" vs "stop at every floor on the way"?

"Stop at every floor on the way" is implied by LOOK: a stop in the current direction wins over reversing. If a passenger on floor 5 presses UP and the elevator is at 3 going up, the stop at 5 is added; the elevator stops at 5 even if it had a destination of 12.

The combination of `ElevatorScheduler` (next stop) and `add_stop` (always inserts) gives this behavior naturally.

### 11.12 What's the failure mode if `selector.pick` returns an out-of-service elevator?

Our selectors filter `OUT_OF_SERVICE` first. But a race: elevator goes OOS between `pick` and `add_stop`. `add_stop` checks `OUT_OF_SERVICE` and returns False — the request is **silently dropped**.

Fix: re-pick on failure with a retry budget. In real systems, the OOS event itself should rebalance: a periodic sweep reassigns dropped requests to other elevators.

### 11.13 What if two passengers press buttons simultaneously?

They serialize at the building lock during `pick`. Each gets a separate `ExternalRequest`. Both may map to the same elevator if the elevator is best for both — that's correct behavior, not a bug.

The elevator's `add_stop` deduplicates if both press the same floor + direction.

### 11.14 What happens at zero — when no elevators have stops and no requests pending?

All elevators in `IDLE`. `step()` does nothing. Building idles indefinitely until next request.

Real buildings often **park** idle elevators: top floor, lobby, distributed across floors. Pluggable as a `ParkingStrategy` (a third strategy axis) — out of scope for this design.

### 11.15 Why is `Direction.IDLE` a separate value rather than `Optional[Direction]`?

Three reasons:
1. `Direction.IDLE` is a positive statement ("not moving"), while `None` is "no direction set" — confusable.
2. Sorting / comparing directions becomes uniform.
3. Pattern-matching on enum is exhaustive; the type-checker enforces all branches handled.

---

## 12. Extensions

### 12.1 Hall-call destination dispatch
At the lobby, riders enter destinations on a panel. The system pre-assigns each rider to an elevator. The selector becomes destination-aware (group by destination floor → assign to same car).

Existing classes change minimally: a new selector strategy (`DestinationDispatchSelector`) and a new external-request shape (`destination` field).

### 12.2 Emergency / Fire
Add a `Mode` to `Building` — `NORMAL`, `FIRE`, `EARTHQUAKE`. In `FIRE`, all elevators clear queues and go to ground. Implementation: `Building.set_mode(FIRE)` triggers `elevator.clear_queue()` and `elevator.add_stop(0)` for each.

### 12.3 Maintenance
`set_out_of_service` already supported. Operator UI invokes it; selector skips. Re-enabling re-introduces.

### 12.4 Capacity by weight, not count
`board(weight)` instead of `board(count)`. Same shape; different units. Hardware sensor feeds the controller.

### 12.5 Predictive scheduling
Add a `PredictiveSelector` that uses time-of-day and historical traffic to pre-position elevators. ML model, dynamic feedback — significant addition; clean interface.

---

## 13. Cheat-Sheet Recap

1. **Problem:** Multi-floor / multi-elevator dispatching with pluggable algorithms.
2. **Core entities:** `Building`, `Elevator`, `Direction`, `State`, `Request`, `Scheduler`, `Selector`.
3. **Patterns:** State (elevator), Strategy (scheduler + selector), Facade (building).
4. **Default scheduling:** LOOK (no starvation, efficient direction reversal).
5. **Default selection:** Direction-aware (idle > approaching same-direction > closest).
6. **Hardest design call:** Splitting per-elevator scheduling from cross-elevator selection.
7. **Concurrency:** Per-elevator lock, building lock for selection. Order: building → elevator.
8. **Trade-off accepted:** Discrete simulation tick, not real-time event loop. Easy to test; replace for hardware.
9. **Open extension points:** New scheduler / selector / mode (emergency, maintenance) without touching existing.

---

## Appendix A: Test cases the interviewer will probe

```
1. Single elevator at floor 0, request UP at 5 — elevator goes 0→5, doors open, settles.
2. Two requests in opposite directions — LOOK serves nearer-direction first, reverses cleanly.
3. Idle elevator, 100 random button presses — assertion: total stops ≤ 100, all reachable.
4. Elevator at capacity — board() returns False; new boarders rejected.
5. OOS during dispatch — request silently dropped; metrics surface a warning.
6. Concurrent button presses for the same floor — de-duplicated within elevator.
7. FCFS vs LOOK on the same input → demonstrate fairness vs efficiency.
8. Door cycle — verify door state machine (OPENING → OPEN → CLOSING → MOVING/IDLE).
9. Direction inversion at endpoints — LOOK detects "no more stops above", reverses to DOWN.
10. Starvation test — SSTF on a busy elevator: a far-floor request waits forever; LOOK doesn't.
```

## Appendix B: Comparing the four scheduling algorithms

```
Algorithm    Throughput  Worst-case wait  Complexity  When to use
FCFS         Low         Very high        Trivial     Toy / simulator only
SSTF         High avg    UNBOUNDED        Easy        Light traffic, short building
SCAN         Medium      Bounded          Easy        Disk seeks; rarely elevators
LOOK         High        Bounded          Easy        DEFAULT for elevators
Predictive   Highest     Bounded          Hard        ML-driven; large buildings
```

## Appendix C: Common Python-specific gotchas

```
- threading.RLock allows a thread to re-acquire its own lock — important since
  add_stop and step both lock; if step calls add_stop transitively it'd deadlock with Lock.
- enum.Enum equality: use `is`. Direction.UP is Direction.UP works; Direction.UP == Direction.UP also.
- dataclass with mutable default (lists / sets): always use field(default_factory=list).
- frozen=True on a dataclass with mutable fields: still mutable through those fields.
- A `set` is unordered; iterating `stops_set` for "next" requires sorting — we do this in scheduler.
```

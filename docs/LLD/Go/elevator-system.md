# Elevator System — Low-Level Design (Go)

> **Difficulty:** Medium → Hard
> **Tags:** `[lld]` `[ood]` `[state-machine]` `[scheduling]` `[goroutines]` `[interfaces]`
> **Language:** Go 1.21+
> **Prep time:** ~10 min skim, ~30 min deep read
> **Companies that ask this:** Amazon, Google, Microsoft, Bloomberg, Stripe

---

## Beginner's Guide

### What's this in plain English?

A building with multiple elevators. People press cab buttons (inside) and hall buttons (outside). System assigns elevators to requests, minimizing wait time. Each elevator runs its own state machine.

### Why solve it?

- **Real world**: dispatching, scheduling, even disk-arm algorithms.
- **Teaches**: state machines, scheduling (FCFS / SCAN / LOOK), multi-elevator coordination, goroutines.

### Vocabulary

- **Cab / Hall request** — internal button vs floor button.
- **Direction** — UP / DOWN / IDLE.
- **LOOK** — sweep to the highest pending request, then reverse. Industry standard.
- **Dispatcher** — assigns hall requests to elevators.

### High-level approach

Entities: **Elevator** (id, floor, direction, pending stops), **Request**, **Dispatcher**, **SchedulingStrategy** (interface, LOOK default), **Building**.

Each elevator: own goroutine. Loop: pop next stop → move floor by floor → open doors. Pending-stops set guarded by a mutex; new requests can arrive concurrently.

### How to read this doc

- **Beginner**: per-elevator state machine + LOOK algorithm first.
- **Interview**: dispatcher logic, multi-elevator optimization.

---

## 0. How to use this doc in an interview

The Python version (separate doc) covers the algorithm choice, state machine, and patterns thoroughly. **In Go, the conversation pivots** to a few different concerns:

- **Goroutines vs single-threaded simulation.** A natural Go design is one goroutine per elevator, communicating via channels. The Python version ran a synchronous `step()` for testability. Discuss both.
- **Channels for events vs mutex for state.** Hall calls arrive asynchronously. They can be sent on a channel to a per-elevator goroutine — clean CSP. We compare with mutex.
- **Interface segregation.** Two strategies (`Scheduler`, `Selector`) become two small interfaces.
- **Context cancellation.** A real elevator system needs graceful shutdown — `context.Context` for stopping the simulation cleanly.

Watch for: defaulting to mutexes when channels are cleaner, or vice-versa. The interviewer wants to see you justify the choice.

---

## 1. Problem Statement

Same problem as the Python version. This doc emphasizes Go's idioms.

---

## 2. Clarifying Questions

Same as Python (`LLD/Python/elevator-system.md` §2). Go-specific:

- [ ] Do we run a **per-elevator goroutine** or a **single tick loop**?
- [ ] Should `Building.Step` be a method on the building, or do elevators self-tick on a timer?
- [ ] Is **graceful shutdown** required (cancel via `context.Context`)?

> **For this doc** we'll go with the per-elevator goroutine model — one goroutine per elevator, ticked by a shared `tick` channel — and a `context.Context` for shutdown. This is the more idiomatic Go shape.

---

## 3. Functional Requirements

Same as Python.

---

## 4. Actors & Use Cases

Same as Python.

---

## 5. Core Entities

| Entity | Go shape | Notes |
|---|---|---|
| `Direction` | `int` enum: `Up=1`, `Down=-1`, `Idle=0` | Numeric for natural sign math |
| `State` | `int` enum: `Idle / Moving / DoorsOpening / DoorsOpen / DoorsClosing / OOS` | |
| `ExternalRequest` | struct with `Floor`, `Dir` | |
| `Elevator` | struct with goroutine state, `requests` chan, `mu` for safe queue ops | |
| `Building` | facade owning elevators + selector | |

**Why a channel on `Elevator`?** Hall calls arrive from many goroutines. Pushing them onto a buffered channel on the per-elevator goroutine serializes them naturally — no shared mutation of the queue from outside.

We still keep an `RWMutex` for snapshot reads (status, current floor) since channels can't easily expose state for inspection.

---

## 6. Class Diagram (ASCII)

```
                          ┌─────────────────────────────────┐
                          │           Building              │
                          │─────────────────────────────────│
                          │ NumFloors                        │
                          │ Elevators []*Elevator           │
                          │ Selector  ElevatorSelector      │◇──┐
                          │ ctx        context.Context       │   │
                          │ tick chan  struct{}              │   │
                          └────┬─────────────────────────────┘   │
                               │ ◆                                 │
                               ▼                                   │
                          ┌──────────────────────┐                 │
                          │       Elevator       │                 │
                          │──────────────────────│                 │
                          │ ID                   │                 │
                          │ floor, dir, state    │                 │
                          │ stops set / queue    │                 │
                          │ Sched ElevatorScheduler │◇──┐         │
                          │ requests chan req    │     │           │
                          │ mu sync.RWMutex      │     │           │
                          └──────────────────────┘     │           │
                                                       ▼           │
                                              ┌────────────────────┐
                                              │ «interface»        │
                                              │ ElevatorScheduler  │
                                              │────────────────────│
                                              │ NextStop(*Elev) int│
                                              └─────────▲──────────┘
                                                        │
                                              ┌─────────┴────────────┐
                                              │ FCFSScheduler        │
                                              │ SSTFScheduler        │
                                              │ LookScheduler ◀──default
                                              └──────────────────────┘
                                                                    │
                                              ┌────────────────────┐│
                                              │ «interface»        ││
                                              │ ElevatorSelector   │◀┘
                                              │────────────────────│
                                              │ Pick(req, lifts)   │
                                              │ → *Elevator        │
                                              └─────────▲──────────┘
                                                        │
                                              ┌─────────┴────────────┐
                                              │ NearestSelector      │
                                              │ DirectionAware ◀default
                                              └──────────────────────┘
```

---

## 7. Design Patterns Used (Go angle)

| Pattern | Go realization | Notes |
|---|---|---|
| Strategy | `ElevatorScheduler`, `ElevatorSelector` interfaces | One method each — perfect Go-style interface segregation |
| State | `State` enum with transition validation in `step()` | Same as Python |
| Facade | `Building.RequestExternal`, `Building.Step` | |
| Producer-Consumer (Go-specific) | Hall calls posted to `requests` chan; per-elevator goroutine consumes | Channels are the idiomatic answer when multiple producers → one consumer |
| Context cancellation | `ctx.Done()` triggers per-elevator goroutine to exit | Standard graceful shutdown |

---

## 8. Sequence Diagrams (Go-specific)

### 8.1 Hall call flow (channel-based)

```
  Caller(any goroutine)   Building     Selector      Elevator's req chan
        │                    │            │               │
        │── RequestExt(5,UP)▶│            │               │
        │                    │── Pick ──▶│               │
        │                    │◀── elev ──│               │
        │                    │── send to chan ────────── ▶│
        │◀── ack ────────────│            │               │
                                                          ▼
                                                   per-elevator goroutine
                                                   reads, calls AddStop,
                                                   updates state under mu
```

---

## 9. Concurrency Considerations

Two patterns coexist:
1. **Channels for incoming requests** — many goroutines press buttons; the elevator owns its inbox. No external mutation.
2. **`sync.RWMutex` for state snapshots** — `Snapshot()` is called by external code; we read state under RLock without channel chatter.

Locking discipline:
- The elevator's goroutine holds the write lock briefly during `step()` and `processRequest()`.
- Snapshots use the read lock.
- Channels carry only requests; never share mutable state through channels.

`context.Context` cancels gracefully: elevator goroutine listens to `ctx.Done()`, drains pending requests, exits.

---

## 10. Full Working Code

```go
// File: elevator.go
// Build: go run elevator.go
package main

import (
	"context"
	"fmt"
	"math/rand"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// ──────────────────────────────────────────────────────────────────────────
// Enums
// ──────────────────────────────────────────────────────────────────────────

type Direction int

const (
	Down Direction = -1
	Idle Direction = 0
	Up   Direction = 1
)

func (d Direction) String() string {
	switch d {
	case Up:
		return "UP"
	case Down:
		return "DOWN"
	default:
		return "IDLE"
	}
}

type State int

const (
	StIdle State = iota
	StMoving
	StDoorsOpening
	StDoorsOpen
	StDoorsClosing
	StOutOfService
)

func (s State) String() string {
	return []string{"IDLE", "MOVING", "OPENING", "OPEN", "CLOSING", "OOS"}[s]
}

// ──────────────────────────────────────────────────────────────────────────
// Requests
// ──────────────────────────────────────────────────────────────────────────

type request struct {
	floor int
	dir   Direction // Idle for internal requests
}

// ──────────────────────────────────────────────────────────────────────────
// Strategy: per-elevator scheduling
// ──────────────────────────────────────────────────────────────────────────

type ElevatorScheduler interface {
	NextStop(e *Elevator) (int, bool)
}

type FCFSScheduler struct{}

func (FCFSScheduler) NextStop(e *Elevator) (int, bool) {
	if len(e.queue) == 0 {
		return 0, false
	}
	return e.queue[0], true
}

type SSTFScheduler struct{}

func (SSTFScheduler) NextStop(e *Elevator) (int, bool) {
	if len(e.stops) == 0 {
		return 0, false
	}
	best, found := 0, false
	bestDist := 1 << 30
	for f := range e.stops {
		d := abs(f - e.floor)
		if d < bestDist {
			best, bestDist, found = f, d, true
		}
	}
	return best, found
}

type LookScheduler struct{}

func (LookScheduler) NextStop(e *Elevator) (int, bool) {
	if len(e.stops) == 0 {
		return 0, false
	}
	switch e.dir {
	case Up:
		var ahead []int
		for f := range e.stops {
			if f >= e.floor {
				ahead = append(ahead, f)
			}
		}
		if len(ahead) > 0 {
			sort.Ints(ahead)
			return ahead[0], true
		}
		var below []int
		for f := range e.stops {
			if f < e.floor {
				below = append(below, f)
			}
		}
		if len(below) > 0 {
			sort.Sort(sort.Reverse(sort.IntSlice(below)))
			return below[0], true
		}
	case Down:
		var below []int
		for f := range e.stops {
			if f <= e.floor {
				below = append(below, f)
			}
		}
		if len(below) > 0 {
			sort.Sort(sort.Reverse(sort.IntSlice(below)))
			return below[0], true
		}
		var ahead []int
		for f := range e.stops {
			if f > e.floor {
				ahead = append(ahead, f)
			}
		}
		if len(ahead) > 0 {
			sort.Ints(ahead)
			return ahead[0], true
		}
	default:
		// Idle — pick closest
		best, bestDist := 0, 1<<30
		for f := range e.stops {
			d := abs(f - e.floor)
			if d < bestDist {
				best, bestDist = f, d
			}
		}
		return best, true
	}
	return 0, false
}

// ──────────────────────────────────────────────────────────────────────────
// Strategy: cross-elevator selection
// ──────────────────────────────────────────────────────────────────────────

type ElevatorSelector interface {
	Pick(req request, elevators []*Elevator) *Elevator
}

type NearestSelector struct{}

func (NearestSelector) Pick(req request, elevators []*Elevator) *Elevator {
	var best *Elevator
	bestDist := 1 << 30
	for _, e := range elevators {
		s := e.Snapshot()
		if s.State == StOutOfService {
			continue
		}
		d := abs(s.Floor - req.floor)
		if d < bestDist {
			best, bestDist = e, d
		}
	}
	return best
}

type DirectionAwareSelector struct{}

func (DirectionAwareSelector) Pick(req request, elevators []*Elevator) *Elevator {
	type cand struct {
		e        *Elevator
		idleness int
		approach int
		sameDir  int
		dist     int
	}
	var pool []cand
	for _, e := range elevators {
		s := e.Snapshot()
		if s.State == StOutOfService {
			continue
		}
		c := cand{e: e, dist: abs(s.Floor - req.floor)}
		if s.Dir == Idle {
			c.idleness = 0
		} else {
			c.idleness = 1
		}
		if (req.dir == Up && s.Floor <= req.floor && s.Dir == Up) ||
			(req.dir == Down && s.Floor >= req.floor && s.Dir == Down) {
			c.approach = 0
		} else {
			c.approach = 1
		}
		if s.Dir == req.dir {
			c.sameDir = 0
		} else {
			c.sameDir = 1
		}
		pool = append(pool, c)
	}
	if len(pool) == 0 {
		return nil
	}
	sort.SliceStable(pool, func(i, j int) bool {
		a, b := pool[i], pool[j]
		if a.idleness != b.idleness {
			return a.idleness < b.idleness
		}
		if a.approach != b.approach {
			return a.approach < b.approach
		}
		if a.sameDir != b.sameDir {
			return a.sameDir < b.sameDir
		}
		return a.dist < b.dist
	})
	return pool[0].e
}

// ──────────────────────────────────────────────────────────────────────────
// Elevator
// ──────────────────────────────────────────────────────────────────────────

type ElevatorSnapshot struct {
	ID    int
	Floor int
	Dir   Direction
	State State
	Stops []int
	Load  int
}

type Elevator struct {
	id           int
	scheduler    ElevatorScheduler
	capacity     int
	doorOpenTicks int

	mu        sync.RWMutex
	floor     int
	dir       Direction
	state     State
	load      int
	doorTimer int
	stops     map[int]struct{}
	queue     []int

	requests chan request
	tick     <-chan struct{}
	done     chan struct{}
}

func NewElevator(id int, sched ElevatorScheduler, capacity int) *Elevator {
	return &Elevator{
		id:            id,
		scheduler:     sched,
		capacity:      capacity,
		doorOpenTicks: 2,
		state:         StIdle,
		dir:           Idle,
		stops:         make(map[int]struct{}),
		requests:      make(chan request, 256),
		done:          make(chan struct{}),
	}
}

// Run starts the elevator's goroutine. Returns immediately.
func (e *Elevator) Run(ctx context.Context, tick <-chan struct{}) {
	e.tick = tick
	go func() {
		defer close(e.done)
		for {
			select {
			case <-ctx.Done():
				return
			case r, ok := <-e.requests:
				if !ok {
					return
				}
				e.addStop(r.floor)
			case <-tick:
				e.step()
			}
		}
	}()
}

// SubmitRequest queues a stop. Safe to call from any goroutine.
func (e *Elevator) SubmitRequest(floor int) bool {
	select {
	case e.requests <- request{floor: floor}:
		return true
	default:
		return false // chan full
	}
}

func (e *Elevator) Snapshot() ElevatorSnapshot {
	e.mu.RLock()
	defer e.mu.RUnlock()
	stops := make([]int, 0, len(e.stops))
	for f := range e.stops {
		stops = append(stops, f)
	}
	sort.Ints(stops)
	return ElevatorSnapshot{
		ID:    e.id,
		Floor: e.floor,
		Dir:   e.dir,
		State: e.state,
		Stops: stops,
		Load:  e.load,
	}
}

func (e *Elevator) SetOutOfService() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.state = StOutOfService
	e.dir = Idle
}

// addStop is called by Run on receiving a request.
func (e *Elevator) addStop(floor int) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.state == StOutOfService {
		return
	}
	if _, ok := e.stops[floor]; ok {
		return
	}
	e.stops[floor] = struct{}{}
	e.queue = append(e.queue, floor)
	if e.state == StIdle {
		e.state = StMoving
	}
}

// step advances the elevator one tick.
func (e *Elevator) step() {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.state == StOutOfService {
		return
	}

	// door cycle
	switch e.state {
	case StDoorsOpening:
		e.state = StDoorsOpen
		e.doorTimer = e.doorOpenTicks
		return
	case StDoorsOpen:
		e.doorTimer--
		if e.doorTimer <= 0 {
			e.state = StDoorsClosing
		}
		return
	case StDoorsClosing:
		if len(e.stops) == 0 {
			e.state = StIdle
			e.dir = Idle
		} else {
			e.state = StMoving
		}
		return
	}

	if len(e.stops) == 0 {
		e.state = StIdle
		e.dir = Idle
		return
	}

	target, ok := e.scheduler.NextStop(e)
	if !ok {
		e.state = StIdle
		e.dir = Idle
		return
	}

	if e.floor == target {
		// arrive: pop stop, open doors
		delete(e.stops, target)
		for i, f := range e.queue {
			if f == target {
				e.queue = append(e.queue[:i], e.queue[i+1:]...)
				break
			}
		}
		e.state = StDoorsOpening
		e.dir = nextDirection(e.floor, e.stops)
		return
	}

	// move toward target
	e.state = StMoving
	if target > e.floor {
		e.dir = Up
		e.floor++
	} else {
		e.dir = Down
		e.floor--
	}
}

func nextDirection(currentFloor int, stops map[int]struct{}) Direction {
	hasAbove, hasBelow := false, false
	for f := range stops {
		if f > currentFloor {
			hasAbove = true
		}
		if f < currentFloor {
			hasBelow = true
		}
	}
	switch {
	case hasAbove:
		return Up
	case hasBelow:
		return Down
	default:
		return Idle
	}
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

// ──────────────────────────────────────────────────────────────────────────
// Building (facade)
// ──────────────────────────────────────────────────────────────────────────

type Building struct {
	NumFloors int
	Elevators []*Elevator
	Selector  ElevatorSelector

	tick   chan struct{}
	cancel context.CancelFunc
}

func NewBuilding(ctx context.Context, numFloors, numElevators, capacity int,
	selector ElevatorSelector,
	schedFactory func() ElevatorScheduler,
) *Building {
	if selector == nil {
		selector = DirectionAwareSelector{}
	}
	if schedFactory == nil {
		schedFactory = func() ElevatorScheduler { return LookScheduler{} }
	}
	ctx, cancel := context.WithCancel(ctx)
	b := &Building{
		NumFloors: numFloors,
		Selector:  selector,
		tick:      make(chan struct{}, 1),
		cancel:    cancel,
	}
	for i := 0; i < numElevators; i++ {
		e := NewElevator(i, schedFactory(), capacity)
		b.Elevators = append(b.Elevators, e)
		e.Run(ctx, b.tick)
	}
	return b
}

func (b *Building) RequestExternal(floor int, dir Direction) (*Elevator, error) {
	if floor < 0 || floor >= b.NumFloors {
		return nil, fmt.Errorf("floor %d out of range", floor)
	}
	if dir == Idle {
		return nil, fmt.Errorf("external request requires UP or DOWN")
	}
	chosen := b.Selector.Pick(request{floor: floor, dir: dir}, b.Elevators)
	if chosen == nil {
		return nil, fmt.Errorf("no elevator available")
	}
	chosen.SubmitRequest(floor)
	return chosen, nil
}

func (b *Building) RequestInternal(elevatorID, dest int) error {
	if elevatorID < 0 || elevatorID >= len(b.Elevators) {
		return fmt.Errorf("elevator %d not found", elevatorID)
	}
	if dest < 0 || dest >= b.NumFloors {
		return fmt.Errorf("destination %d out of range", dest)
	}
	b.Elevators[elevatorID].SubmitRequest(dest)
	return nil
}

// Tick fires one simulation tick to all elevators.
// Non-blocking; if a previous tick is still draining, this one is dropped.
func (b *Building) Tick() {
	for range b.Elevators {
		// signal each elevator independently; simplest: send on a single shared chan and have all listen
	}
	// Use a fan-out: send N copies on the chan
	for range b.Elevators {
		select {
		case b.tick <- struct{}{}:
		default:
		}
	}
	// Slight delay so elevators settle
	time.Sleep(2 * time.Millisecond)
}

func (b *Building) Snapshot() []ElevatorSnapshot {
	out := make([]ElevatorSnapshot, 0, len(b.Elevators))
	for _, e := range b.Elevators {
		out = append(out, e.Snapshot())
	}
	return out
}

func (b *Building) Shutdown() {
	b.cancel()
}

// ──────────────────────────────────────────────────────────────────────────
// Demo
// ──────────────────────────────────────────────────────────────────────────

func main() {
	ctx := context.Background()
	b := NewBuilding(ctx, 20, 4, 10, nil, nil)
	defer b.Shutdown()

	must := func(_ *Elevator, err error) {
		if err != nil {
			panic(err)
		}
	}
	must(b.RequestExternal(0, Up))
	must(b.RequestExternal(2, Up))
	must(b.RequestExternal(5, Up))
	must(b.RequestExternal(15, Down))
	if err := b.RequestInternal(0, 12); err != nil {
		panic(err)
	}
	if err := b.RequestInternal(1, 7); err != nil {
		panic(err)
	}

	// Tick the simulation
	for i := 0; i < 30; i++ {
		b.Tick()
		if i == 0 || i == 10 || i == 20 || i == 29 {
			fmt.Printf("\n── tick %d ──\n", i)
			for _, s := range b.Snapshot() {
				fmt.Printf("  E%d: floor=%2d dir=%-4s state=%-7s stops=%v\n",
					s.ID, s.Floor, s.Dir, s.State, s.Stops)
			}
		}
	}

	// Concurrency: 100 random external requests from many goroutines
	fmt.Println("\n--- concurrency: 100 requests ---")
	ctx2 := context.Background()
	b2 := NewBuilding(ctx2, 20, 4, 10, nil, nil)
	defer b2.Shutdown()

	rng := rand.New(rand.NewSource(0))
	var wg sync.WaitGroup
	var fired atomic.Int64
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			f := rng.Intn(20)
			d := Up
			if rng.Intn(2) == 1 {
				d = Down
			}
			if _, err := b2.RequestExternal(f, d); err == nil {
				fired.Add(1)
			}
		}()
	}
	wg.Wait()
	// Allow elevators to ingest requests
	for i := 0; i < 10; i++ {
		b2.Tick()
	}
	totalStops := 0
	for _, s := range b2.Snapshot() {
		totalStops += len(s.Stops)
	}
	fmt.Printf("Successful requests: %d\n", fired.Load())
	fmt.Printf("Pending stops queued: %d (≤ requests; some collide on same floor)\n", totalStops)
	if int64(totalStops) > fired.Load() {
		panic("invariant: stops should not exceed successful requests")
	}
}
```

### How to run

```bash
go run /path/to/elevator.go
```

---

## 11. Cross-Questions ("Why X and not Y") — ≥ 12

### 11.1 Why a goroutine per elevator instead of one shared scheduler goroutine?

Per-elevator goroutines isolate state. Each elevator's queue is mutated only by its own goroutine (in response to channel messages or ticks). No cross-elevator data races.

A single shared scheduler goroutine would force all decisions through one queue — bottleneck under high request rate, complex state. Per-elevator scales linearly with elevator count and matches the natural domain (each elevator is independent).

### 11.2 Why a buffered channel for `requests` and not direct method call?

A direct method call would cross goroutine boundaries with shared state — requires locks. A buffered channel:
- Decouples the producer (caller) from the consumer (elevator goroutine).
- Provides natural backpressure: if buffer fills, `select default` drops the request, returning a signal to the caller.
- Serializes mutations to the elevator's queue without explicit locking (the goroutine reads channel sequentially).

The capacity (256) is sized for burst absorption. In a real system, dropped requests would alert and be retried.

### 11.3 Why `sync.RWMutex` despite using channels?

Channels handle **incoming** events. But callers also need to **read** state (`Snapshot()` for monitoring/UI). Reading state via channels would require a request-response over a channel — round-trips with high overhead.

`RWMutex` lets snapshot reads run lock-free relative to each other while serializing with writes from the goroutine. Best of both: write side is channel-driven (no race possible by design), read side is lock-driven (cheap snapshots).

### 11.4 Why an `int` enum (`type Direction int`) instead of string constants?

Numeric enums:
- Compare with `==` (no string compare cost).
- Switch-case is exhaustive in static analysis tools (golangci-lint can flag missing cases).
- Storage is 8 bytes (vs string with header + heap allocation).

`Direction` is also useful as a sign multiplier: `e.floor += int(e.dir)` with `Up=1, Down=-1, Idle=0` would work elegantly. We don't use it that way (clearer to branch explicitly), but the encoding is intentional.

### 11.5 Why `context.Context` for cancellation?

Standard Go idiom for graceful shutdown. The per-elevator goroutine's `select` includes `case <-ctx.Done(): return`, so cancellation propagates instantly and goroutines exit cleanly.

Without `Context`, we'd invent our own done-channel — same shape but non-standard. Always use `Context` when you have any cancellation/timeout/deadline concern.

### 11.6 Why is `Tick()` non-blocking with `select default`?

If a previous tick is still being processed (e.g. all elevator goroutines busy), we don't want `Tick()` to block the simulation driver. `select default` drops the new tick. The cost: that elevator may miss one tick. Acceptable; over many ticks, the simulation catches up.

For deterministic testing, replace `Tick()` with a synchronous version that waits for all elevators to acknowledge.

### 11.7 Why send N copies of `struct{}{}` on the tick channel rather than fan-out via separate channels?

Each elevator's goroutine reads from the same `tick` channel. We send N messages so each gets one. Trade-off: order isn't deterministic — elevator 0 may eat tick 1 while elevator 3 is still busy with tick 0.

A cleaner alternative: per-elevator `tick` channels with a fan-out goroutine. Slightly more code, more deterministic. For demo simplicity we use the shared channel.

### 11.8 Why a map (`map[int]struct{}`) for `stops` instead of a sorted set?

Go has no sorted-set in stdlib. We use `map` for O(1) membership / dedup, with on-demand sorting in the scheduler when iteration order matters. For ≤ 20 floors per building, the sort cost is negligible.

For very large floor counts, switch to `*btree.BTreeG[int]` (third-party) or maintain a sorted slice alongside the map.

### 11.9 Why isn't `Elevator.queue` (FIFO) updated when a stop is dequeued by `step()`?

We do update it: in `step()` after `delete(e.stops, target)`, we walk `e.queue` to remove the matching floor. O(N) per visit but N ≤ 20 → trivial.

If FCFS scheduling is rare (default is LOOK), the `queue` is mostly unused. Could remove it from non-FCFS scheduler implementations. We keep it for simplicity.

### 11.10 What's the failure mode if the per-elevator goroutine panics?

The deferred `close(e.done)` runs. Subsequent reads from `e.done` would unblock. But the goroutine is dead — no more requests processed.

Mitigation:
- `defer recover()` inside the goroutine to log and continue (or restart).
- Building-level supervisor that restarts dead elevator goroutines.

For an interview answer: panics indicate bugs; in production we'd recover and alert. Standalone elevator code should never panic on legitimate input.

### 11.11 Why interfaces with one method each?

Go's idiomatic style ("the bigger the interface, the weaker the abstraction"). One-method interfaces:
- Are trivially satisfied (any struct with that method).
- Encourage composition (combine multiple small interfaces).
- Pair well with `func`-typed values (`type Sched func(*E) (int, bool)` could replace `ElevatorScheduler` for stateless cases).

`io.Reader` (one method) is the standard reference.

### 11.12 Why no goroutine for the door cycle (open → wait → close)?

A goroutine per door would simplify timing (`time.Sleep(2 * time.Second)` between transitions). But:
- Spawns N×3 goroutines (per elevator, per door cycle).
- State checking from outside requires snapshotting from those goroutines.
- Coordination during shutdown is messy.

Discrete tick simulation (door cycle takes 3 ticks: opening, open, closing) is simpler and deterministic. For real hardware control, the door cycle becomes a state machine driven by sensors — same shape, different driver.

### 11.13 What if I want destination dispatch (input destination at lobby)?

Add `dest` to `request`. `Selector.Pick` becomes destination-aware: groups callers by destination, assigns them to the same elevator. The scheduler doesn't change.

This is what modern high-rise elevators do (Schindler, Otis). The OOD shape is the same; the dispatch logic is richer.

### 11.14 Why is `Building.Tick()` a manual call rather than a `time.Ticker`-driven goroutine?

Determinism in tests. A `time.Ticker` makes the simulation real-time, which is hard to assert against. Manual `Tick()` lets the test driver pump cycles deterministically.

For production hardware, replace `Tick()` with a sensor-driven event loop (e.g. door close sensor → emit "doorClosed" event → state transition).

### 11.15 What if `RequestExternal` is called for a floor with no elevators in service?

`Selector.Pick` returns `nil`; `RequestExternal` returns an error. Caller (UI) shows a service-unavailable message.

In production, this would emit a metric and alert maintenance.

---

## 12. Extensions

(Same as Python version; see `LLD/Python/elevator-system.md` §12. Implementation differences:)

- **Hall-call destination dispatch**: extend `request` with `dest`; new `DestinationDispatchSelector` that groups by destination.
- **Emergency / Fire**: a building-level `Mode` (atomic int). Per-elevator goroutine checks mode each tick; in `FIRE` mode, clears stops and adds floor 0.
- **Maintenance**: `SetOutOfService` already supported; selector skips OOS.
- **Predictive scheduling**: a separate goroutine reading historic patterns from a database, periodically nudging idle elevators to predicted hot floors via `SubmitRequest`.

---

## 13. Cheat-Sheet Recap

1. **Problem:** Multi-floor / multi-elevator dispatching.
2. **Idioms:** Goroutine per elevator, channel for requests, `RWMutex` for snapshots, `Context` for shutdown.
3. **Patterns:** Strategy (scheduler/selector interfaces), State (enum + transition validation), Facade (Building).
4. **Default scheduling:** LOOK (no starvation).
5. **Default selection:** Direction-aware.
6. **Concurrency:** Channels for events, mutex for state. Lock order: external → elevator's mu.
7. **Trade-off accepted:** Discrete tick simulation, not real-time. Easy to test; replace for hardware.

---

## Appendix A: How this differs from the Python version

```
Python                              Go
─────────                           ─────
threading.RLock                     sync.RWMutex
discrete step() called sync         goroutine per elevator + tick channel
ABCs                                interfaces (one method)
list/set                             []int / map[int]struct{}
exceptions for invalid              error returns
None                                 (val, ok) tuples or nil pointers
class Elevator                       struct Elevator + func receivers
context manager (with lock)          defer mu.Unlock()
```

## Appendix B: Common Go-specific gotchas

```
- range over a map is random — sort if you need deterministic order.
- closing a channel signals "no more sends"; receiving from closed yields zero value.
- nil channel blocks forever — useful in `select` to disable a branch.
- atomic.Int64 (Go 1.19+) is preferred over manual atomic.AddInt64 boilerplate.
- panicking goroutines crash the whole process unless recovered — always recover at goroutine entry.
- channel sends on full buffer block (without select default).
- Don't share Mutex by value — pass *Mutex or embed in a struct.
```

## Appendix C: Test patterns

```go
// Deterministic test: drive the building synchronously
func TestLook(t *testing.T) {
    ctx := context.Background()
    b := NewBuilding(ctx, 10, 1, 5, nil, nil)
    defer b.Shutdown()

    b.RequestExternal(5, Up)
    b.RequestExternal(8, Up)
    b.RequestExternal(2, Up)

    // Tick deterministically until all idle
    for i := 0; i < 50; i++ {
        b.Tick()
        idle := true
        for _, s := range b.Snapshot() {
            if s.State != StIdle {
                idle = false
                break
            }
        }
        if idle {
            break
        }
    }
    // Assert serving order: 2, 5, 8 (LOOK from floor 0 going up)
}
```

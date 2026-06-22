# Parking Lot — Low-Level Design (Go)

> **Difficulty:** Medium
> **Tags:** `[lld]` `[ood]` `[strategy]` `[interfaces]` `[concurrency]`
> **Language:** Go 1.21+
> **Prep time:** ~10 min skim, ~30 min deep read
> **Companies that ask this:** Amazon, Atlassian, Uber, Microsoft, Goldman Sachs

---

## Beginner's Guide

### What's this in plain English?

A parking garage. Drive in → ticket → park → drive out → pay based on duration. Model the whole flow: spot allocation, ticket lifecycle, payment, concurrency.

### Why solve it?

- **The canonical OOD interview** — applies to every OOD question.
- **Teaches**: identifying entities, design patterns (strategy/factory/state), concurrent spot allocation.
- **In Go**: interfaces + composition replace inheritance; goroutines pose extra concurrency questions.

### Vocabulary

- **Lot / Floor / Spot** — composition hierarchy.
- **Vehicle** (Motorcycle/Car/Truck) — size determines compatible spots.
- **Ticket** — issued at entry; records spot + time.
- **PricingStrategy** — interface; pluggable rules (hourly, weekend, etc.).
- **Atomic reservation** — a lock or CAS so two cars don't claim the same spot.

### High-level approach

Entities:
- **Vehicle** struct (with VehicleType enum or interface).
- **Spot** (size, occupancy).
- **Floor** (slice of spots).
- **Lot** (slice of floors; mutex for concurrency).
- **Ticket** (vehicle, spot, entry time).
- **PricingStrategy** — Go interface.

Flow: Enter → find compatible spot → atomic reserve → issue ticket. Exit → compute fee → payment → free spot.

In Go: `sync.Mutex` for the lot; goroutine-safe spot lookup via `sync.RWMutex`.

### How to read this doc

- **Beginner**: entity model first; code reads better after.
- **Interview**: the cross-questions are the high-value sections.

---

## 0. How to use this doc in an interview

The Python version of this question (separate doc) leans heavily on classes and ABC interfaces. **In Go, OOD looks different** — there is no `class`, no inheritance, no constructors. Idioms are:
- **Interfaces are duck-typed and small.** A `SpotAllocator` interface has one method. We don't pre-declare implementations — any type with that method satisfies it.
- **Composition by struct embedding.** No inheritance.
- **Errors as values.** No exceptions; every operation that can fail returns `(value, error)`.
- **Concurrency primitives first-class.** `sync.Mutex`, `sync.RWMutex`, channels, atomics — pick the right one.
- **No constructors.** Use `New*` factory functions by convention.

When an interviewer asks "design parking lot" in a Go context, they're testing whether you write **idiomatic** Go, not "translated Java." Watch for:
- Pointer vs value receivers — be deliberate.
- Error returns instead of `nil` checks alone.
- `sync.Mutex` vs channels — Go has both; pick by use case.
- Interface segregation — one method when one method suffices.

---

## 1. Problem Statement

(Same problem as the Python version — multi-floor parking lot with vehicle types, pluggable pricing, thread-safe park/unpark.)

This doc focuses on **how Go's type system and concurrency primitives shape the design** differently from Python.

---

## 2. Clarifying Questions to Ask the Interviewer

Same scope/domain/non-functional questions as Python (see `LLD/Python/parking-lot.md` §2). Go-specific questions:

- [ ] Is this an in-process library, a microservice (gRPC), or a CLI?
- [ ] Generics required for any container? (Go 1.18+ has them; 1.17 doesn't.)
- [ ] Logger framework — stdlib `log/slog`, or a specific lib (zap, zerolog)?
- [ ] Error handling — wrapped with `fmt.Errorf("%w", ...)`, or sentinel errors?

> **For this doc:** in-process library, Go 1.21+, stdlib `log/slog`, sentinel errors (`var ErrLotFull = errors.New(...)`) for known cases.

---

## 3. Functional Requirements

Same as Python version. Implementation differences:
- Errors returned, not raised.
- `*ParkingLot` methods take `*ParkingLot` receivers (mutating); `Vehicle` is a value type.
- Strategies are interfaces, satisfied implicitly.

---

## 4. Actors & Use Cases

Same as Python. (Driver / Cashier / Admin.)

---

## 5. Core Entities

| Entity | Go shape | Notes |
|---|---|---|
| `Vehicle` | struct (value, immutable by convention) | Value type; copies are fine |
| `ParkingSpot` | struct, mutable; protected by lot's lock | Pointer access throughout |
| `Floor` | struct holding `[]*ParkingSpot` | Owns its spots |
| `ParkingLot` | struct facade with `sync.RWMutex` | Top-level entry |
| `Ticket` | struct, immutable | Returned to caller |
| `ExitReceipt` | struct, immutable | Returned on unpark |

**No enums in Go** — we use named integer types (`type SpotSize int`) with constants:
```go
type VehicleType int
const (
    Motorcycle VehicleType = iota
    Car
    Truck
)
```

This gives type safety (`VehicleType(5)` is still valid Go but obviously wrong; use `String()` method to print).

---

## 6. Class Diagram (ASCII) — Go-flavored

```
                                 ┌──────────────────────────────┐
                                 │         ParkingLot           │
                                 │──────────────────────────────│
                                 │ floors    []*Floor           │
                                 │ pricing   PricingStrategy    │◇──────┐
                                 │ allocator SpotAllocator      │◇──┐   │
                                 │ tickets   map[string]*Ticket │   │   │
                                 │ mu        sync.RWMutex       │   │   │
                                 │──────────────────────────────│   │   │
                                 │ Park(v) (*Ticket, error)     │   │   │
                                 │ Unpark(id) (*Receipt, error) │   │   │
                                 │ Availability() Snapshot      │   │   │
                                 └────┬─────────────────────────┘   │   │
                                      │ ◆                            │   │
                                      ▼                              │   │
                                 ┌──────────────────────────┐       │   │
                                 │         Floor            │       │   │
                                 │──────────────────────────│       │   │
                                 │ ID    string             │       │   │
                                 │ Spots []*ParkingSpot     │◆──┐   │   │
                                 └──────────────────────────┘   │   │   │
                                                                ▼   │   │
                                                      ┌────────────────┐│
                                                      │ ParkingSpot    ││
                                                      │────────────────││
                                                      │ ID, FloorID    ││
                                                      │ Size SpotSize  ││
                                                      │ Status         ││
                                                      │ Occupant *V    ││
                                                      └────────────────┘│
                                                                        │
                                  ┌─────────────────────────┐           │
                                  │ «interface»             │           │
                                  │ SpotAllocator           │◀──────────┘
                                  │─────────────────────────│
                                  │ Allocate([]Floor, V)    │
                                  │   *ParkingSpot          │
                                  └─────────▲───────────────┘
                                            │
                                  ┌─────────┴────────────┐
                                  │ FirstFitAllocator    │
                                  │ BestFitAllocator     │
                                  │ FloorBalancingAlloc. │
                                  └──────────────────────┘

                                  ┌─────────────────────────┐
                                  │ «interface»             │
                                  │ PricingStrategy         │
                                  │─────────────────────────│
                                  │ Compute(t,exit) Money   │
                                  └─────────▲───────────────┘
                                            │
                                  ┌─────────┴────────────┐
                                  │ FlatHourlyPricing    │
                                  │ TieredPricing        │
                                  └──────────────────────┘
```

Note: Go interfaces are **duck-typed**. The diagram shows nominal "implements" arrows for clarity, but in code there's no `implements` keyword.

---

## 7. Design Patterns Used (and Why) — Go angle

| Pattern | Go realization | Why this pattern (Go-specific) | Alternative considered |
|---|---|---|---|
| Strategy | Interface (`PricingStrategy`, `SpotAllocator`) | Idiomatic in Go — small interfaces are accepted everywhere. Function values would also work for one-method strategies; structs preferred when state is needed. | Function-typed fields (`type PriceFunc func(*Ticket, time.Time) Money`) — fine for stateless strategies, less flexible if config grows |
| Factory | `NewParkingLot(...)`, `NewParkingSpot(...)` | Go has no constructors; `New*` functions enforce invariants | Direct struct literals — caller can construct invalid state |
| State (limited) | `SpotStatus` enum + transition methods | Go can't enforce illegal transitions at compile-time as cleanly as a language with sum types; we validate in `Assign`/`Release` | Boolean flag — same problems as Python (multi-state breaks it) |
| Facade | `ParkingLot` exposes `Park`/`Unpark`; internals are package-private | Go's lower-case unexported names give a real boundary | Public-everything — leaks internals |

**Go-specific patterns NOT used:**
- **Functional options** (`WithFoo(...)`): we considered this for `NewParkingLot` configuration, but the constructor only takes 3 mandatory args — overkill. Reach for options when you have 5+ optional args.
- **Channels for spot assignment**: a "spot manager goroutine" with channels would make `Park` blocking-on-channel. Cleaner semantically (CSP-style), but adds a goroutine and complicates shutdown. We use a mutex.

---

## 8. Sequence Diagrams

(Same as Python version — see `LLD/Python/parking-lot.md` §8.)

---

## 9. Concurrency Considerations

In Go, the choice is between:
- **`sync.Mutex` / `sync.RWMutex`** — shared memory, traditional locking. Best for fine-grained, frequently-accessed state.
- **Channels** — pass ownership of state via messages. CSP-style, deadlock-prone if not careful.

For parking lot:
- The **find-and-claim** transaction (which spot is free? mark it) is short. Mutex wins.
- A `sync.RWMutex` lets `Availability()` (read-heavy snapshot) run concurrently with other readers.
- We hold the write lock for `Park`/`Unpark`. Read lock for `Availability`.

For 1k–10k spots, mutex throughput is far above expected demand. We document the limit; per-floor locks or sharded mutex is the next scaling step.

---

## 10. Full Working Code

```go
// File: parking-lot.go
// Build: go run parking-lot.go
package main

import (
	"errors"
	"fmt"
	"math/big"
	"sort"
	"sync"
	"time"
)

// ──────────────────────────────────────────────────────────────────────────
// Enums (named ints with constants)
// ──────────────────────────────────────────────────────────────────────────

type VehicleType int

const (
	Motorcycle VehicleType = iota
	Car
	Truck
)

func (vt VehicleType) String() string {
	switch vt {
	case Motorcycle:
		return "motorcycle"
	case Car:
		return "car"
	case Truck:
		return "truck"
	}
	return "unknown"
}

type SpotSize int

const (
	SmallSpot SpotSize = iota + 1
	MediumSpot
	LargeSpot
)

func (s SpotSize) String() string {
	return []string{"_", "SMALL", "MEDIUM", "LARGE"}[s]
}

type SpotStatus int

const (
	Free SpotStatus = iota
	Occupied
	Reserved
	OutOfService
)

type PaymentMethod int

const (
	Cash PaymentMethod = iota
	Card
	App
)

// requiredSize maps vehicle types to the minimum compatible spot size.
func requiredSize(vt VehicleType) SpotSize {
	switch vt {
	case Motorcycle:
		return SmallSpot
	case Car:
		return MediumSpot
	case Truck:
		return LargeSpot
	}
	return MediumSpot
}

// ──────────────────────────────────────────────────────────────────────────
// Sentinel errors
// ──────────────────────────────────────────────────────────────────────────

var (
	ErrLotFull         = errors.New("parking: no compatible spot available")
	ErrTicketNotFound  = errors.New("parking: ticket not found")
	ErrSpotNotFree     = errors.New("parking: spot not free")
	ErrSpotNotOccupied = errors.New("parking: spot not occupied")
	ErrInvalidVehicle  = errors.New("parking: vehicle does not fit spot")
)

// ──────────────────────────────────────────────────────────────────────────
// Money — use big.Rat for exact arithmetic
// ──────────────────────────────────────────────────────────────────────────

type Money struct {
	r *big.Rat
}

func NewMoney(s string) Money {
	r := new(big.Rat)
	if _, ok := r.SetString(s); !ok {
		panic("invalid money: " + s)
	}
	return Money{r: r}
}

func (m Money) Add(o Money) Money {
	return Money{r: new(big.Rat).Add(m.r, o.r)}
}

func (m Money) MulInt(n int64) Money {
	return Money{r: new(big.Rat).Mul(m.r, big.NewRat(n, 1))}
}

func (m Money) String() string {
	return "$" + m.r.FloatString(2)
}

// ──────────────────────────────────────────────────────────────────────────
// Domain types
// ──────────────────────────────────────────────────────────────────────────

type Vehicle struct {
	LicensePlate string
	Type         VehicleType
}

func (v Vehicle) FitsIn(size SpotSize) bool {
	return size >= requiredSize(v.Type)
}

type ParkingSpot struct {
	ID       string
	FloorID  string
	Size     SpotSize
	Status   SpotStatus
	Occupant *Vehicle
}

// Assign and Release assume the caller holds the lot's lock.
func (s *ParkingSpot) Assign(v *Vehicle) error {
	if s.Status != Free {
		return fmt.Errorf("%w: spot=%s status=%d", ErrSpotNotFree, s.ID, s.Status)
	}
	if !v.FitsIn(s.Size) {
		return fmt.Errorf("%w: vehicle=%s spot=%s", ErrInvalidVehicle, v.LicensePlate, s.ID)
	}
	s.Status = Occupied
	s.Occupant = v
	return nil
}

func (s *ParkingSpot) Release() (*Vehicle, error) {
	if s.Status != Occupied {
		return nil, fmt.Errorf("%w: spot=%s", ErrSpotNotOccupied, s.ID)
	}
	v := s.Occupant
	s.Status = Free
	s.Occupant = nil
	return v, nil
}

type Floor struct {
	ID    string
	Spots []*ParkingSpot
}

func (f *Floor) FreeCount() int {
	n := 0
	for _, s := range f.Spots {
		if s.Status == Free {
			n++
		}
	}
	return n
}

func (f *Floor) TotalCount() int { return len(f.Spots) }

type Ticket struct {
	ID        string
	Vehicle   Vehicle
	Spot      *ParkingSpot
	EntryTime time.Time
}

type ExitReceipt struct {
	Ticket   *Ticket
	ExitTime time.Time
	Amount   Money
	Method   PaymentMethod
}

// ──────────────────────────────────────────────────────────────────────────
// Strategy: spot allocation (interface)
// ──────────────────────────────────────────────────────────────────────────

type SpotAllocator interface {
	Allocate(floors []*Floor, v Vehicle) *ParkingSpot
}

type FirstFitAllocator struct{}

func (FirstFitAllocator) Allocate(floors []*Floor, v Vehicle) *ParkingSpot {
	req := requiredSize(v.Type)
	for _, f := range floors {
		for _, s := range f.Spots {
			if s.Status == Free && s.Size >= req {
				return s
			}
		}
	}
	return nil
}

type BestFitAllocator struct{}

func (BestFitAllocator) Allocate(floors []*Floor, v Vehicle) *ParkingSpot {
	req := requiredSize(v.Type)
	var best *ParkingSpot
	for _, f := range floors {
		for _, s := range f.Spots {
			if s.Status != Free || s.Size < req {
				continue
			}
			if best == nil || s.Size < best.Size {
				best = s
				if best.Size == req {
					return best
				}
			}
		}
	}
	return best
}

type FloorBalancingAllocator struct{}

func (FloorBalancingAllocator) Allocate(floors []*Floor, v Vehicle) *ParkingSpot {
	req := requiredSize(v.Type)
	type entry struct {
		f     *Floor
		ratio float64
	}
	ranked := make([]entry, 0, len(floors))
	for _, f := range floors {
		total := f.TotalCount()
		if total == 0 {
			continue
		}
		ranked = append(ranked, entry{f, float64(f.FreeCount()) / float64(total)})
	}
	sort.Slice(ranked, func(i, j int) bool { return ranked[i].ratio > ranked[j].ratio })
	for _, e := range ranked {
		for _, s := range e.f.Spots {
			if s.Status == Free && s.Size >= req {
				return s
			}
		}
	}
	return nil
}

// ──────────────────────────────────────────────────────────────────────────
// Strategy: pricing (interface)
// ──────────────────────────────────────────────────────────────────────────

type PricingStrategy interface {
	Compute(t *Ticket, exit time.Time) Money
}

type FlatHourlyPricing struct {
	Rates map[VehicleType]Money
}

func (p FlatHourlyPricing) Compute(t *Ticket, exit time.Time) Money {
	dur := exit.Sub(t.EntryTime)
	hours := ceilHours(dur)
	if hours < 1 {
		hours = 1
	}
	rate := p.Rates[t.Vehicle.Type]
	return rate.MulInt(int64(hours))
}

type TieredPricing struct {
	Base       map[VehicleType]Money
	Overstay   map[VehicleType]Money
	BaseHours  int
}

func (p TieredPricing) Compute(t *Ticket, exit time.Time) Money {
	dur := exit.Sub(t.EntryTime)
	hours := ceilHours(dur)
	if hours < 1 {
		hours = 1
	}
	baseH := hours
	if baseH > p.BaseHours {
		baseH = p.BaseHours
	}
	overH := hours - baseH
	if overH < 0 {
		overH = 0
	}
	out := p.Base[t.Vehicle.Type].MulInt(int64(baseH))
	if overH > 0 {
		out = out.Add(p.Overstay[t.Vehicle.Type].MulInt(int64(overH)))
	}
	return out
}

func ceilHours(d time.Duration) int {
	secs := int64(d.Seconds())
	if secs < 0 {
		secs = 0
	}
	return int((secs + 3599) / 3600)
}

// ──────────────────────────────────────────────────────────────────────────
// Factory functions (Go convention: New*)
// ──────────────────────────────────────────────────────────────────────────

func NewVehicle(plate string, t VehicleType) Vehicle {
	return Vehicle{LicensePlate: plate, Type: t}
}

func NewSpot(id, floorID string, size SpotSize) *ParkingSpot {
	return &ParkingSpot{ID: id, FloorID: floorID, Size: size, Status: Free}
}

// ──────────────────────────────────────────────────────────────────────────
// ParkingLot facade
// ──────────────────────────────────────────────────────────────────────────

type ParkingLot struct {
	mu        sync.RWMutex
	floors    []*Floor
	pricing   PricingStrategy
	allocator SpotAllocator
	tickets   map[string]*Ticket
	idSeq     int64
}

func NewParkingLot(floors []*Floor, pricing PricingStrategy, allocator SpotAllocator) *ParkingLot {
	if allocator == nil {
		allocator = FirstFitAllocator{}
	}
	return &ParkingLot{
		floors:    floors,
		pricing:   pricing,
		allocator: allocator,
		tickets:   make(map[string]*Ticket),
	}
}

func (lot *ParkingLot) Park(v Vehicle, now time.Time) (*Ticket, error) {
	lot.mu.Lock()
	defer lot.mu.Unlock()

	spot := lot.allocator.Allocate(lot.floors, v)
	if spot == nil {
		return nil, fmt.Errorf("%w: vehicle=%s type=%s", ErrLotFull, v.LicensePlate, v.Type)
	}
	if err := spot.Assign(&v); err != nil {
		return nil, err
	}
	lot.idSeq++
	t := &Ticket{
		ID:        fmt.Sprintf("tkt-%d", lot.idSeq),
		Vehicle:   v,
		Spot:      spot,
		EntryTime: now,
	}
	lot.tickets[t.ID] = t
	return t, nil
}

func (lot *ParkingLot) Unpark(ticketID string, now time.Time, method PaymentMethod) (*ExitReceipt, error) {
	lot.mu.Lock()
	defer lot.mu.Unlock()

	t, ok := lot.tickets[ticketID]
	if !ok {
		return nil, fmt.Errorf("%w: id=%s", ErrTicketNotFound, ticketID)
	}
	delete(lot.tickets, ticketID)
	amount := lot.pricing.Compute(t, now)
	if _, err := t.Spot.Release(); err != nil {
		return nil, err
	}
	return &ExitReceipt{
		Ticket:   t,
		ExitTime: now,
		Amount:   amount,
		Method:   method,
	}, nil
}

type FloorSnapshot struct {
	FloorID string
	Free    int
	Total   int
	BySize  map[string]int
}

func (lot *ParkingLot) Availability() []FloorSnapshot {
	lot.mu.RLock()
	defer lot.mu.RUnlock()

	out := make([]FloorSnapshot, 0, len(lot.floors))
	for _, f := range lot.floors {
		bySize := map[string]int{"SMALL": 0, "MEDIUM": 0, "LARGE": 0}
		for _, s := range f.Spots {
			if s.Status == Free {
				bySize[s.Size.String()]++
			}
		}
		out = append(out, FloorSnapshot{
			FloorID: f.ID,
			Free:    f.FreeCount(),
			Total:   f.TotalCount(),
			BySize:  bySize,
		})
	}
	return out
}

// ──────────────────────────────────────────────────────────────────────────
// Demo
// ──────────────────────────────────────────────────────────────────────────

func buildLot() *ParkingLot {
	makeSpots := func(floorID string, smalls, mediums, larges int) []*ParkingSpot {
		var out []*ParkingSpot
		i := 0
		for ; i < smalls; i++ {
			out = append(out, NewSpot(fmt.Sprintf("%s-S-%d", floorID, i), floorID, SmallSpot))
		}
		for j := 0; j < mediums; j++ {
			out = append(out, NewSpot(fmt.Sprintf("%s-M-%d", floorID, j), floorID, MediumSpot))
		}
		for j := 0; j < larges; j++ {
			out = append(out, NewSpot(fmt.Sprintf("%s-L-%d", floorID, j), floorID, LargeSpot))
		}
		return out
	}

	f1 := &Floor{ID: "F1", Spots: makeSpots("F1", 4, 6, 2)}
	f2 := &Floor{ID: "F2", Spots: makeSpots("F2", 2, 4, 4)}

	pricing := FlatHourlyPricing{
		Rates: map[VehicleType]Money{
			Motorcycle: NewMoney("2.00"),
			Car:        NewMoney("4.00"),
			Truck:      NewMoney("8.00"),
		},
	}
	return NewParkingLot([]*Floor{f1, f2}, pricing, BestFitAllocator{})
}

func main() {
	lot := buildLot()
	fmt.Println("Initial availability:")
	for _, s := range lot.Availability() {
		fmt.Printf("  %s: free=%d total=%d bySize=%v\n", s.FloorID, s.Free, s.Total, s.BySize)
	}

	now := time.Date(2026, 5, 17, 10, 0, 0, 0, time.UTC)
	car := NewVehicle("KA-01-AB-1234", Car)
	bike := NewVehicle("KA-01-CD-5678", Motorcycle)
	truck := NewVehicle("KA-01-EF-9012", Truck)

	tCar, _ := lot.Park(car, now)
	tBike, _ := lot.Park(bike, now.Add(5*time.Minute))
	tTruck, _ := lot.Park(truck, now.Add(10*time.Minute))
	fmt.Printf("Parked %s @ %s\n", car.LicensePlate, tCar.Spot.ID)
	fmt.Printf("Parked %s @ %s\n", bike.LicensePlate, tBike.Spot.ID)
	fmt.Printf("Parked %s @ %s\n", truck.LicensePlate, tTruck.Spot.ID)

	receipt, _ := lot.Unpark(tCar.ID, now.Add(2*time.Hour+30*time.Minute), Card)
	fmt.Printf("Car bill: %s\n", receipt.Amount)

	// Concurrency smoke
	lot2 := buildLot()
	var wg sync.WaitGroup
	var parked, rejected int64
	var mu sync.Mutex
	for i := 0; i < 30; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			v := NewVehicle(fmt.Sprintf("P-%d", i), Car)
			if _, err := lot2.Park(v, time.Now()); err != nil {
				mu.Lock()
				rejected++
				mu.Unlock()
				return
			}
			mu.Lock()
			parked++
			mu.Unlock()
		}(i)
	}
	wg.Wait()
	fmt.Printf("\n--- concurrency ---\nParked: %d, rejected: %d\n", parked, rejected)
	totalFree := 0
	for _, s := range lot2.Availability() {
		totalFree += s.Free
	}
	fmt.Printf("Free remaining: %d\n", totalFree)
	if parked+rejected != 30 {
		panic("invariant: parked + rejected should equal 30")
	}
}
```

### How to run

```bash
mkdir -p ~/Downloads/cc/kb/LLD/Go/parking-lot && cd ~/Downloads/cc/kb/LLD/Go/parking-lot
# Save the code as parking-lot.go and:
go run parking-lot.go
```

Or compile-check the code block alone:
```bash
go run /path/to/parking-lot.go
```

---

## 11. Cross-Questions ("Why X and not Y") — ≥ 12

### 11.1 Why `interface` (Go) and not embed-and-override?

Go has no inheritance. The closest alternative is **struct embedding** — embed a base struct and "shadow" methods. But:
- Embedding can't enforce a contract; the consumer doesn't see "this satisfies the X interface" until use.
- Interfaces let us depend on behavior, not implementation. `lot.allocator` accepts any `SpotAllocator`; we don't care about the concrete type.

In Java/Python you'd inherit `AbstractAllocator`; in Go you just satisfy the interface. The Go pattern is **interface segregation by default**: small interfaces (one method!) defined where consumed, not where implemented. `SpotAllocator` lives near `ParkingLot`, not near `FirstFitAllocator`.

### 11.2 Why pointer receivers on `*ParkingSpot` methods, value receivers on `Vehicle`?

- `*ParkingSpot.Assign` mutates `Status` and `Occupant`. Mutation requires a pointer receiver.
- `Vehicle.FitsIn` is read-only. Value receiver works; copies are cheap (one int + one short string).

Go convention: be consistent within a type. If any method needs a pointer receiver, *all* methods on that type should use pointer receivers (avoids subtle bugs with method sets on interface satisfaction).

### 11.3 Why `sync.RWMutex` and not `sync.Mutex`?

`Availability()` is called frequently by dashboards / monitoring. A read-write mutex lets multiple readers proceed in parallel.

When NOT to use RWMutex:
- If reads are rare, the overhead of RWMutex is wasted.
- If writes are frequent, RWMutex starvation can hurt readers.
- For very short critical sections (~10 ns), `sync.Mutex` is faster (RWMutex has more bookkeeping).

For our usage pattern (dashboards reading often, writes on park/unpark), RWMutex is the right call.

### 11.4 Why sentinel errors (`ErrLotFull`) and not custom error types?

For the **caller's** benefit. A sentinel error is comparable with `errors.Is(err, ErrLotFull)`. Custom error types force `errors.As` and a type assertion.

When custom types are right: when the error needs to **carry data** (e.g. which spot was attempted, what limit was exceeded). Then `type LotFullError struct { Type VehicleType; ... }` with an `Is` method.

Our errors are simple — sentinel is enough. `fmt.Errorf("%w: ...", ErrLotFull, details)` wraps with context while preserving the sentinel for `errors.Is`.

### 11.5 Why `big.Rat` for money instead of `int64` cents?

- `int64` cents would also be exact, but loses readability ("$12.50" vs `1250`).
- `big.Rat` handles arbitrary-precision rational arithmetic — over-engineered for cents-resolution money but simple to read.

For real production:
- Use a dedicated money library (`github.com/Rhymond/go-money` or similar) with currency tags.
- At storage, convert to cents (`int64`) for compactness.

In an interview, `big.Rat` shows you avoid `float64`. Acceptable.

### 11.6 Why no inheritance for vehicle types (`Motorcycle`, `Car`, `Truck`)?

Go has no inheritance. We use a `VehicleType` enum + `requiredSize()` mapping. Equivalent to a sealed type hierarchy in Kotlin / sealed class in Scala.

When you'd want subclasses: if vehicles had **distinct behaviors** (e.g. trucks have a `LoadCapacity()`, motorcycles have `HasSidecar()`). Then we'd model as separate structs satisfying a `Vehicle` interface. For a parking lot where the *only* difference is required size, the enum approach is simpler.

### 11.7 Why no `defer` in `Assign` / `Release` despite manipulation?

`defer` is for cleanup that must run even on panic — typically `defer mu.Unlock()` after `mu.Lock()`. `Assign` / `Release` themselves don't acquire locks; the lock is held by the caller (`ParkingLot.Park`). They mutate a few fields and return.

If we put the lock acquisition inside `Assign`, we'd need `defer s.mu.Unlock()`. We chose to push the locking up to the lot level — single source of truth.

### 11.8 Why `[]*Floor` and not `[]Floor`?

Pointers because:
- We mutate floor state (spot status changes).
- Slices of structs would require careful `&slice[i]` indexing to mutate.
- Pointers are 8 bytes vs full struct copies.

For purely-read structs (e.g. `Vehicle`), value slices are fine and reduce allocations.

### 11.9 Why `panic` in `NewMoney` instead of returning an error?

`NewMoney` is a constructor; bad input means the caller passed garbage at compile / load time, not runtime input. Panicking surfaces the bug immediately with a stack trace.

If money strings come from user input, we'd return an error. For internal constants, `panic` is fine.

### 11.10 Why is `Park` a method on `*ParkingLot` and `Allocate` not a method on `*ParkingLot`?

`Allocate` is the strategy's responsibility, not the lot's. The lot calls into the strategy; injection is via the `allocator` field.

If `Allocate` were a lot method, we'd lose pluggability — the algorithm would be tied to the lot, not swappable.

### 11.11 What if I want N independent parking lots in one process?

Just construct N `*ParkingLot` instances. Each has its own mutex, floors, tickets. Go has no "static" state; everything is per-instance. Tests instantiate freely.

### 11.12 Why no goroutine for spot management?

Pattern: a "manager" goroutine receives requests on a channel and serves spot assignments. CSP-style. Pros: no shared mutable state, no mutex. Cons: extra goroutine, synchronous-call-via-channel adds a `chan response` per request, complicates shutdown.

For a parking lot with predictable, fast critical sections, **mutex is simpler and faster**. We document this and move on.

The CSP variant shines when the work itself is asynchronous (background processing) — not for synchronous lookup-and-claim.

### 11.13 What if I want generics for, say, a typed registry of vehicles?

Go generics (1.18+) allow:
```go
type Registry[T any] struct { items map[string]T }
func (r *Registry[T]) Get(id string) (T, bool) { ... }
```
We didn't use generics here because the domain is small and concrete. Generics earn their keep in containers and algorithms — see `MachineCoding/Go/lru-cache.md` for a concrete example.

### 11.14 What's the failure mode if `pricing.Compute` panics?

A panic propagates up through `Unpark` and unwinds the stack. The deferred `lot.mu.Unlock()` releases the lock (good). But the ticket has been removed from the map (`delete(...)` ran before `Compute`). Result: the ticket is gone but the spot is *still occupied*.

Fix:
- Use `defer recover()` inside `Unpark` to convert panics to errors.
- Or restructure so the spot release happens before the (potentially-panicking) pricing.

Best practice: pricing shouldn't panic on legitimate input. Defensive `recover()` only at API boundaries, not within.

### 11.15 Why public-by-uppercase fields on `Ticket` but not on internal types?

Go's visibility model: `UPPERCASE` is exported (visible across packages). Lowercase is package-private.

`Ticket` is returned to the caller — they need to read fields. Make them public.
`ParkingLot.tickets` is an internal map — not exported.

In a multi-package design:
- `package parking` exports `ParkingLot`, `Vehicle`, `Ticket`, etc.
- Internal helpers (`requiredSize`, the `idSeq` field) stay lowercase.

---

## 12. Extensions

(Same shape as Python version; see `LLD/Python/parking-lot.md` §12. Implementation differences:)

- **EVs**: add `RequiresCharger bool` to `ParkingSpot`. Update `Vehicle.FitsIn` to take a spot pointer.
- **Reservations**: a new `Reservation` struct, allocator becomes reservation-aware via decorator.
- **Persistence**: a `Repository` interface (`SaveSpot`, `LoadAll`) — in-memory implementation for tests, SQL-backed for production. `ParkingLot` accepts the repo via constructor.
- **Multi-lot**: a `ParkingService` facade with a map of lots; routes by location.

---

## 13. Cheat-Sheet Recap

1. **Problem:** Multi-floor parking lot with pluggable pricing/allocation.
2. **Idioms:** Small interfaces, struct embedding, value vs pointer receivers, error returns.
3. **Patterns:** Strategy (interfaces), Factory (`New*`), State (validated transitions), Facade (`ParkingLot`).
4. **Concurrency:** `sync.RWMutex` — write on park/unpark, read on availability.
5. **Money:** `big.Rat` for exact arithmetic; production uses `int64` cents or a money library.
6. **Errors:** Sentinel + wrap with `%w`; tested via `errors.Is`.
7. **Trade-offs:** Mutex over channels (simpler, faster for short critical section); enum + mapping over inheritance (Go has none).
8. **Open extensions:** All same as Python version, with Go-specific implementation paths.

---

## Appendix A: Test cases (table-driven, idiomatic Go)

```go
func TestPark_Concurrent(t *testing.T) {
    tests := []struct{
        name string
        floors []*Floor
        attempts int
        wantParked int
    }{
        {"all-cars-same-size", buildFloors(0, 16, 0), 30, 16},
        ...
    }
    for _, tc := range tests {
        t.Run(tc.name, func(t *testing.T) {
            lot := NewParkingLot(tc.floors, pricing, BestFitAllocator{})
            ...
        })
    }
}
```

Use `t.Run` for subtests, `t.Parallel()` if independent. `go test -race` to catch data races.

## Appendix B: Common Go-specific gotchas

```
- nil interface vs interface holding nil pointer: classic gotcha. Returning a typed nil
  through an interface (`var p *ParkingSpot; return p`) makes the interface non-nil.

- map iteration order is randomized: don't rely on it in tests.

- Reading from a map under concurrent write panics — protect with mutex or use sync.Map.

- defer runs in LIFO order. Multiple defers stack.

- Slice append may share underlying array; copy if you mutate.

- Time arithmetic: time.Sub returns a Duration (int64 nanoseconds). Use Duration constants
  (time.Hour) instead of magic numbers.

- big.Rat: don't compare with == — use Cmp(). And don't share Rat values without copying;
  they're not goroutine-safe for mutation.
```

## Appendix C: How this differs from the Python version

```
Python                              Go
─────────                           ─────
@dataclass(frozen=True) Vehicle     struct (default) Vehicle
ABC + abstractmethod                interface (one method)
threading.RLock                     sync.RWMutex
Decimal                             big.Rat (or int64 cents)
raise CustomException               return fmt.Errorf("%w", sentinel)
class XStrategy(StrategyBase)       struct XStrategy {} satisfying Strategy
__init__ constructor                NewX function
isinstance(x, Y)                    *Y or interface assertion x.(Y)
super().__init__()                  embedding (no super call)
```

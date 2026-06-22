# Cab Booking — LLD (Go)

> **Difficulty:** Medium → Hard
> **Tags:** `[lld]` `[matching]` `[concurrency]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

Uber/Lyft at LLD scale. Rider requests; system matches with nearest available driver; ride goes through statuses; payment at the end.

### Why solve it?

- **Real world**: any matching marketplace.
- **Teaches**: matching algorithms, ride state machine, concurrent driver allocation, pricing strategies.

### Vocabulary

- **Rider / Driver** — users; driver state: AVAILABLE / EN_ROUTE / OFFLINE.
- **Ride** — REQUESTED → ASSIGNED → IN_PROGRESS → COMPLETED / CANCELLED.
- **Surge** — demand-based pricing multiplier.
- **Matching** — strategy to pick driver.

### High-level approach

Entities: **Rider**, **Driver**, **Ride**, **MatchingStrategy** (interface), **PricingStrategy** (interface), **CabService** (orchestrator with `sync.Mutex`).

Flow:
1. Request → find candidates → match → atomically reserve driver.
2. Accept → ASSIGNED → pickup → IN_PROGRESS → drop → COMPLETED → fare → payment.

Atomic driver reservation prevents double-booking.

### How to read this doc

- **Beginner**: state machine + entities first.
- **Interview**: matching choices, concurrency, surge math are the meat.

---

## 1. Code

```go
package main

import (
	"errors"
	"fmt"
	"math"
	"sync"
)

type DriverStatus int

const (
	Offline DriverStatus = iota
	Available
	EnRoute
	WithRider
)

type RideState int

const (
	Requested RideState = iota
	Matched
	InProgress
	Completed
	Cancelled
)

type Cents int64

var ErrNoDrivers = errors.New("no drivers available")

type Location struct{ Lat, Lng float64 }

func (a Location) Distance(b Location) float64 {
	dx, dy := a.Lat-b.Lat, a.Lng-b.Lng
	return math.Hypot(dx, dy)
}

type Driver struct {
	ID, Name string
	Loc      Location
	Status   DriverStatus
}

type Ride struct {
	ID, RiderID string
	Origin, Destination Location
	State    RideState
	DriverID string
	Fare     Cents
}

type Matcher interface {
	Match(origin Location, drivers []*Driver) *Driver
}

type NearestMatcher struct{}

func (NearestMatcher) Match(origin Location, drivers []*Driver) *Driver {
	var best *Driver
	bestDist := math.Inf(1)
	for _, d := range drivers {
		if d.Status != Available {
			continue
		}
		dist := d.Loc.Distance(origin)
		if dist < bestDist {
			bestDist = dist
			best = d
		}
	}
	return best
}

type Pricing interface {
	Fare(origin, dest Location) Cents
}

type FlatRate struct {
	PerUnit Cents
}

func (f FlatRate) Fare(origin, dest Location) Cents {
	d := origin.Distance(dest)
	return Cents(d * float64(f.PerUnit))
}

type CabService struct {
	mu       sync.Mutex
	drivers  map[string]*Driver
	rides    map[string]*Ride
	matcher  Matcher
	pricing  Pricing
}

func NewCabService(m Matcher, p Pricing) *CabService {
	return &CabService{
		drivers: map[string]*Driver{},
		rides:   map[string]*Ride{},
		matcher: m, pricing: p,
	}
}

func (s *CabService) RegisterDriver(name string, loc Location) *Driver {
	d := &Driver{ID: fmt.Sprintf("d%d", len(s.drivers)+1), Name: name, Loc: loc, Status: Available}
	s.drivers[d.ID] = d
	return d
}

func (s *CabService) RequestRide(riderID string, origin, dest Location) (*Ride, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ride := &Ride{
		ID: fmt.Sprintf("r%d", len(s.rides)+1), RiderID: riderID,
		Origin: origin, Destination: dest,
		Fare: s.pricing.Fare(origin, dest),
	}
	s.rides[ride.ID] = ride
	driverList := make([]*Driver, 0, len(s.drivers))
	for _, d := range s.drivers {
		driverList = append(driverList, d)
	}
	d := s.matcher.Match(origin, driverList)
	if d == nil {
		ride.State = Cancelled
		return nil, ErrNoDrivers
	}
	d.Status = EnRoute
	ride.DriverID = d.ID
	ride.State = Matched
	return ride, nil
}

func (s *CabService) CompleteRide(rideID string, dropLoc *Location) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.rides[rideID]
	if !ok {
		return errors.New("not found")
	}
	r.State = Completed
	d := s.drivers[r.DriverID]
	if dropLoc != nil {
		d.Loc = *dropLoc
	}
	d.Status = Available
	return nil
}

func main() {
	svc := NewCabService(NearestMatcher{}, FlatRate{PerUnit: 1000})
	d1 := svc.RegisterDriver("Alice", Location{0, 0})
	d2 := svc.RegisterDriver("Bob", Location{5, 5})

	r1, err := svc.RequestRide("u1", Location{1, 1}, Location{2, 2})
	if err != nil || r1.DriverID != d1.ID {
		panic(err)
	}
	r2, _ := svc.RequestRide("u2", Location{4, 4}, Location{6, 6})
	if r2.DriverID != d2.ID {
		panic(r2.DriverID)
	}
	if _, err := svc.RequestRide("u3", Location{0, 0}, Location{1, 1}); !errors.Is(err, ErrNoDrivers) {
		panic("expected no drivers")
	}
	svc.CompleteRide(r1.ID, &Location{2, 2})
	r3, err := svc.RequestRide("u4", Location{2, 2}, Location{3, 3})
	if err != nil || r3.DriverID != d1.ID {
		panic("alice should be free")
	}
	fmt.Printf("Fare for u4: %d cents\n", r3.Fare)
	fmt.Println("All tests passed.")
}
```

---

## 2. Cheat-Sheet
1. Strategy: Matcher (nearest), Pricing.
2. State machines: driver + ride.
3. Lock for atomic match-and-claim.

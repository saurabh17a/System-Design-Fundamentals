# Restaurant Reservation — LLD (Go)

> **Difficulty:** Medium → Hard
> **Tags:** `[lld]` `[reservation]` `[concurrency]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

OpenTable. Tables of various sizes. Customer requests party size + time. System finds a fitting available table.

### Why solve it?

- **Real world**: OpenTable, Resy.
- **Teaches**: time-slot allocation, capacity matching.

### Vocabulary

- **Table** (capacity), **Slot** (time window), **Reservation** (status).

### High-level approach

Entities: **Table**, **Slot**, **Reservation** (PENDING/CONFIRMED/CANCELLED/NO_SHOW), **Service** with mutex.

Search: party size + time → tables with capacity ≥ party AND no overlapping confirmed reservation.
Book under lock: re-validate, create reservation.

### How to read this doc

- **Beginner**: capacity + slot matching.
- **Interview**: waitlists, no-shows, dynamic pricing.

---

## 1. Code

```go
package main

import (
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"
)

var ErrNoTable = errors.New("no table available")

type Restaurant struct {
	ID, Name, Location string
}

type Table struct {
	ID, RestaurantID string
	Seats            int
}

type Reservation struct {
	ID, TableID, CustomerID string
	PartySize               int
	Start, End              time.Time
	Cancelled               bool
}

type Service struct {
	mu                sync.Mutex
	restaurants       map[string]*Restaurant
	tables            map[string]*Table
	tablesByRest      map[string][]*Table
	reservations      map[string]*Reservation
	reservationsByTbl map[string][]*Reservation
	diningWindow      time.Duration
	idCount           int
}

func NewService(diningWindow time.Duration) *Service {
	if diningWindow == 0 {
		diningWindow = 2 * time.Hour
	}
	return &Service{
		restaurants: map[string]*Restaurant{},
		tables: map[string]*Table{},
		tablesByRest: map[string][]*Table{},
		reservations: map[string]*Reservation{},
		reservationsByTbl: map[string][]*Reservation{},
		diningWindow: diningWindow,
	}
}

func (s *Service) nextID(p string) string {
	s.idCount++
	return fmt.Sprintf("%s-%d", p, s.idCount)
}

func (s *Service) AddRestaurant(name, loc string) *Restaurant {
	r := &Restaurant{ID: s.nextID("r"), Name: name, Location: loc}
	s.restaurants[r.ID] = r
	return r
}

func (s *Service) AddTable(restID string, seats int) *Table {
	t := &Table{ID: s.nextID("t"), RestaurantID: restID, Seats: seats}
	s.tables[t.ID] = t
	s.tablesByRest[restID] = append(s.tablesByRest[restID], t)
	return t
}

func overlaps(aStart, aEnd, bStart, bEnd time.Time) bool {
	return aStart.Before(bEnd) && bStart.Before(aEnd)
}

func (s *Service) isAvailable(tableID string, start, end time.Time) bool {
	for _, r := range s.reservationsByTbl[tableID] {
		if !r.Cancelled && overlaps(r.Start, r.End, start, end) {
			return false
		}
	}
	return true
}

func (s *Service) SearchAvailability(restID string, start time.Time, partySize int) []*Table {
	s.mu.Lock()
	defer s.mu.Unlock()
	end := start.Add(s.diningWindow)
	tables := append([]*Table(nil), s.tablesByRest[restID]...)
	sort.Slice(tables, func(i, j int) bool { return tables[i].Seats < tables[j].Seats })
	var out []*Table
	for _, t := range tables {
		if t.Seats < partySize {
			continue
		}
		if s.isAvailable(t.ID, start, end) {
			out = append(out, t)
		}
	}
	return out
}

func (s *Service) Reserve(tableID, customerID string, start time.Time, partySize int) (*Reservation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.tables[tableID]
	if !ok || t.Seats < partySize {
		return nil, ErrNoTable
	}
	end := start.Add(s.diningWindow)
	if !s.isAvailable(tableID, start, end) {
		return nil, ErrNoTable
	}
	r := &Reservation{
		ID: s.nextID("res"), TableID: tableID, CustomerID: customerID,
		PartySize: partySize, Start: start, End: end,
	}
	s.reservations[r.ID] = r
	s.reservationsByTbl[tableID] = append(s.reservationsByTbl[tableID], r)
	return r, nil
}

func (s *Service) Cancel(resID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r, ok := s.reservations[resID]; ok {
		r.Cancelled = true
	}
}

// Tests
func main() {
	svc := NewService(0)
	r := svc.AddRestaurant("La Cucina", "NY")
	t2 := svc.AddTable(r.ID, 2)
	t4 := svc.AddTable(r.ID, 4)
	svc.AddTable(r.ID, 8)

	d := time.Date(2026, 5, 18, 19, 0, 0, 0, time.UTC)
	avail := svc.SearchAvailability(r.ID, d, 3)
	if avail[0].ID != t4.ID {
		panic("best fit")
	}

	res, err := svc.Reserve(t4.ID, "alice", d, 3)
	if err != nil {
		panic(err)
	}
	if _, err := svc.Reserve(t4.ID, "bob", d.Add(time.Hour), 2); !errors.Is(err, ErrNoTable) {
		panic("conflict")
	}
	if _, err := svc.Reserve(t4.ID, "carol", d.Add(time.Hour*2+30*time.Minute), 2); err != nil {
		panic("non-overlap")
	}
	if _, err := svc.Reserve(t2.ID, "dave", d, 4); !errors.Is(err, ErrNoTable) {
		panic("party too big")
	}
	svc.Cancel(res.ID)
	if _, err := svc.Reserve(t4.ID, "eve", d, 4); err != nil {
		panic("after cancel")
	}
	fmt.Println("All tests passed.")
}
```

---

## 2. Cheat-Sheet
1. Tables sorted by size; best fit.
2. Dining window 2 hr default; overlap check.
3. Coarse lock for atomic claim.

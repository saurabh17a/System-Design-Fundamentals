# Hotel Booking — LLD (Go)

> **Difficulty:** Medium → Hard
> **Tags:** `[lld]` `[reservation]` `[concurrency]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

Booking.com at LLD scale. Hotels with rooms; customer picks dates; system shows availability; reserves under concurrency.

### Why solve it?

- **Real world**: Booking, Expedia, any reservation app.
- **Teaches**: date-range overlap, atomic reservation, pricing.

### Vocabulary

- **Date range** — `[check_in, check_out)`.
- **Overlap** — `a < d && c < b`.
- **Reservation** — room + range + guest + status.

### High-level approach

Entities: **Room**, **Reservation** (PENDING / CONFIRMED / CANCELLED), **Service** with `sync.Mutex`.

Search: rooms with no overlapping CONFIRMED reservations.
Book under lock: re-check, create reservation.

### How to read this doc

- **Beginner**: overlap detection is the core.
- **Interview**: search vs book split, idempotency, cancellation.

---

## 1. Code

```go
package main

import (
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

type RoomType int

const (
	Single RoomType = iota
	Double
	Suite
)

type Cents int64

var (
	ErrNotAvailable = errors.New("not available")
	ErrInvalidDates = errors.New("invalid dates")
)

type Hotel struct {
	ID, Name, Location string
}

type Room struct {
	ID, HotelID    string
	Type           RoomType
	Capacity       int
	PricePerNight  Cents
}

type Booking struct {
	ID, RoomID, CustomerID string
	CheckIn, CheckOut      time.Time
	Total                  Cents
	Cancelled              bool
}

type HotelService struct {
	mu             sync.Mutex
	hotels         map[string]*Hotel
	rooms          map[string]*Room
	roomsByHotel   map[string][]*Room
	bookings       map[string]*Booking
	bookingsByRoom map[string][]*Booking
	idCounter      atomic.Int64
}

func NewHotelService() *HotelService {
	return &HotelService{
		hotels: map[string]*Hotel{}, rooms: map[string]*Room{},
		roomsByHotel: map[string][]*Room{}, bookings: map[string]*Booking{},
		bookingsByRoom: map[string][]*Booking{},
	}
}

func (s *HotelService) nextID(p string) string {
	return fmt.Sprintf("%s-%d", p, s.idCounter.Add(1))
}

func (s *HotelService) AddHotel(name, location string) *Hotel {
	h := &Hotel{ID: s.nextID("hot"), Name: name, Location: location}
	s.hotels[h.ID] = h
	return h
}

func (s *HotelService) AddRoom(hotelID string, t RoomType, cap int, price Cents) *Room {
	r := &Room{ID: s.nextID("room"), HotelID: hotelID, Type: t, Capacity: cap, PricePerNight: price}
	s.rooms[r.ID] = r
	s.roomsByHotel[hotelID] = append(s.roomsByHotel[hotelID], r)
	return r
}

func overlaps(aStart, aEnd, bStart, bEnd time.Time) bool {
	return aStart.Before(bEnd) && bStart.Before(aEnd)
}

func (s *HotelService) isAvailable(roomID string, in, out time.Time) bool {
	for _, b := range s.bookingsByRoom[roomID] {
		if !b.Cancelled && overlaps(b.CheckIn, b.CheckOut, in, out) {
			return false
		}
	}
	return true
}

func (s *HotelService) Book(roomID, customerID string, in, out time.Time) (*Booking, error) {
	if !out.After(in) {
		return nil, ErrInvalidDates
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.isAvailable(roomID, in, out) {
		return nil, ErrNotAvailable
	}
	r := s.rooms[roomID]
	nights := int64(out.Sub(in).Hours() / 24)
	total := r.PricePerNight * Cents(nights)
	b := &Booking{
		ID: s.nextID("book"), RoomID: roomID, CustomerID: customerID,
		CheckIn: in, CheckOut: out, Total: total,
	}
	s.bookings[b.ID] = b
	s.bookingsByRoom[roomID] = append(s.bookingsByRoom[roomID], b)
	return b, nil
}

func (s *HotelService) Cancel(bookingID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, ok := s.bookings[bookingID]
	if !ok || b.Cancelled {
		return errors.New("not active")
	}
	b.Cancelled = true
	return nil
}

func main() {
	svc := NewHotelService()
	h := svc.AddHotel("Grand", "NY")
	r := svc.AddRoom(h.ID, Double, 2, 10000)
	d := func(y, m, day int) time.Time {
		return time.Date(y, time.Month(m), day, 0, 0, 0, 0, time.UTC)
	}
	b1, err := svc.Book(r.ID, "alice", d(2026, 1, 5), d(2026, 1, 8))
	if err != nil || b1.Total != 30000 {
		panic(err)
	}
	if _, err := svc.Book(r.ID, "bob", d(2026, 1, 6), d(2026, 1, 9)); !errors.Is(err, ErrNotAvailable) {
		panic("conflict not detected")
	}
	if _, err := svc.Book(r.ID, "carol", d(2026, 1, 10), d(2026, 1, 12)); err != nil {
		panic(err)
	}
	svc.Cancel(b1.ID)
	if _, err := svc.Book(r.ID, "dave", d(2026, 1, 5), d(2026, 1, 8)); err != nil {
		panic("after cancel")
	}

	// Concurrency
	svc2 := NewHotelService()
	h2 := svc2.AddHotel("X", "X")
	r2 := svc2.AddRoom(h2.ID, Single, 1, 5000)
	var succ atomic.Int64
	var fail atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := svc2.Book(r2.ID, fmt.Sprintf("u%d", i), d(2026, 6, 1), d(2026, 6, 3))
			if err == nil {
				succ.Add(1)
			} else if errors.Is(err, ErrNotAvailable) {
				fail.Add(1)
			}
		}(i)
	}
	wg.Wait()
	if succ.Load() != 1 || fail.Load() != 49 {
		panic(fmt.Sprintf("got succ=%d fail=%d", succ.Load(), fail.Load()))
	}
	fmt.Println("All tests passed.")
}
```

---

## 2. Cheat-Sheet
1. Per-room booking list.
2. Availability = no overlap with active bookings.
3. Coarse lock for atomic check-and-claim.
4. Date overlap: `a.start.Before(b.end) && b.start.Before(a.end)`.

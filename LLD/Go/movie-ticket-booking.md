# Movie Ticket Booking — Low-Level Design (Go)

> **Difficulty:** Hard
> **Tags:** `[lld]` `[ood]` `[concurrency]` `[two-phase]` `[idempotency]`
> **Language:** Go 1.21+
> **Prep time:** ~15 min skim, ~40 min deep read
> **Companies that ask this:** Atlassian, BookMyShow, Razorpay, Goldman Sachs, Uber, Amazon

---

## Beginner's Guide

### What's this in plain English?

BookMyShow at LLD scale. Showings, seats, two-phase booking (hold while paying, confirm after). 1000 people may compete for the same seat — only one wins.

### Why solve it?

- **Real world**: BookMyShow, AMC, ticketing.
- **Teaches**: high-contention concurrency, two-phase booking, idempotency, expiry sweeps.

### Vocabulary

- **Show**, **Seat**, **Hold** (temporary reservation), **Two-phase** (hold → confirm), **Idempotency key**.

### High-level approach

Entities: **Show**, **Seat**, **Booking** (HELD / CONFIRMED / CANCELLED + expiry), **BookingService** with mutex, **PaymentService** interface (idempotent).

Hold under lock: seats AVAILABLE → HELD with expiry → return booking_id.
Confirm: still HELD? → pay (idempotent) → CONFIRMED + seats SOLD.
Expiry sweep: HELD past expiry → release.

### How to read this doc

- **Beginner**: two-phase flow + seat states.
- **Interview**: idempotency, retries, regional availability.

---

## 0. How to use this doc in an interview

Python version covers entities, two-phase booking, race correctness. **In Go, the conversation pivots:**
- **`sync.Mutex` over `RWMutex`** — `Hold` is read-then-write (check status, then mark); RWMutex doesn't help.
- **`int64` cents** for money (no `Decimal` in Go stdlib).
- **`time.Time` everywhere** + injectable clock for tests.
- **Idempotency via map** under the same lock.
- **No exceptions** — `(value, error)` returns; `errors.Is` for typed checks.

---

## 1. Problem Statement
(Same as Python.)

---

## 2. Clarifying Questions
Same. Go-specific: clock interface for testable time?

---

## 3. Functional Requirements
Same.

---

## 4. Actors & Use Cases
Same.

---

## 5. Core Entities

| Entity | Go shape |
|---|---|
| `Seat`, `Movie`, `City` | structs (immutable) |
| `Cinema`, `Screen`, `Show` | structs, mutated under lock |
| `Hold`, `Booking` | structs |
| `BookingSystem` | facade with `sync.Mutex` |
| `PricingStrategy` | interface |

---

## 6. Class Diagram (ASCII)
(Same as Python.)

---

## 7. Design Patterns
(Same as Python.)

---

## 8. Sequence Diagrams
(Same as Python.)

---

## 9. Concurrency Considerations

Single `sync.Mutex` on the `BookingSystem`. `Hold` and `Confirm` both acquire the write lock; the verify-then-mark pattern is atomic.

For per-show locks: `map[string]*sync.Mutex` keyed by show ID, plus a meta-lock for the map. Out of scope for the base.

---

## 10. Full Working Code

```go
// File: booking.go
// Build: go run booking.go
package main

import (
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

// ──────────────────────────────────────────────────────────────────────────
// Money (int64 cents)
// ──────────────────────────────────────────────────────────────────────────

type Cents int64

func (c Cents) String() string {
	v := int64(c)
	sign := ""
	if v < 0 {
		sign = "-"
		v = -v
	}
	return fmt.Sprintf("%s$%d.%02d", sign, v/100, v%100)
}

// ──────────────────────────────────────────────────────────────────────────
// Enums
// ──────────────────────────────────────────────────────────────────────────

type SeatType int

const (
	Regular SeatType = iota
	Premium
	Recliner
)

type SeatStatus int

const (
	SeatAvailable SeatStatus = iota
	SeatHeld
	SeatBooked
)

type HoldStatus int

const (
	HoldActive HoldStatus = iota
	HoldConfirmed
	HoldExpired
	HoldReleased
)

// ──────────────────────────────────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────────────────────────────────

var (
	ErrShowNotFound     = errors.New("booking: show not found")
	ErrSeatUnavailable  = errors.New("booking: seat unavailable")
	ErrHoldNotFound     = errors.New("booking: hold not found")
	ErrHoldExpired      = errors.New("booking: hold expired")
	ErrHoldConfirmed    = errors.New("booking: hold already confirmed")
	ErrInvalidPayment   = errors.New("booking: invalid payment token")
	ErrInvalidShow      = errors.New("booking: invalid show config")
)

// ──────────────────────────────────────────────────────────────────────────
// Domain
// ──────────────────────────────────────────────────────────────────────────

type Seat struct {
	ID   string
	Row  string
	Col  int
	Type SeatType
}

type Movie struct {
	ID       string
	Title    string
	Duration time.Duration
	Language string
}

type City struct {
	ID   string
	Name string
}

type Cinema struct {
	ID      string
	CityID  string
	Name    string
	Screens []*Screen
}

type Screen struct {
	ID       string
	CinemaID string
	Name     string
	Seats    []Seat
}

type Show struct {
	ID         string
	MovieID    string
	ScreenID   string
	StartTime  time.Time
	EndTime    time.Time
	BasePrice  Cents
	SeatStatus map[string]SeatStatus
	SeatLookup map[string]Seat
}

type Hold struct {
	ID         string
	ShowID     string
	SeatIDs    []string
	CustomerID string
	CreatedAt  time.Time
	ExpiresAt  time.Time
	Status     HoldStatus
	Amount     Cents
}

type Booking struct {
	ID           string
	HoldID       string
	ShowID       string
	SeatIDs      []string
	CustomerID   string
	Amount       Cents
	ConfirmedAt  time.Time
	PaymentToken string
}

// ──────────────────────────────────────────────────────────────────────────
// Pricing strategy
// ──────────────────────────────────────────────────────────────────────────

type PricingStrategy interface {
	Price(show *Show, seats []Seat) Cents
}

type FlatPerSeatPricing struct{}

var typeMult = map[SeatType]int64{
	Regular:  100, // 1.0×
	Premium:  150, // 1.5×
	Recliner: 200, // 2.0×
}

func (FlatPerSeatPricing) Price(show *Show, seats []Seat) Cents {
	total := int64(0)
	for _, s := range seats {
		total += int64(show.BasePrice) * typeMult[s.Type] / 100
	}
	return Cents(total)
}

type WeekendUpliftPricing struct {
	Base PricingStrategy
}

func (w WeekendUpliftPricing) Price(show *Show, seats []Seat) Cents {
	base := w.Base.Price(show, seats)
	wd := show.StartTime.Weekday()
	if wd == time.Saturday || wd == time.Sunday {
		return Cents(int64(base) * 125 / 100)
	}
	return base
}

// ──────────────────────────────────────────────────────────────────────────
// BookingSystem
// ──────────────────────────────────────────────────────────────────────────

type BookingSystem struct {
	mu sync.Mutex

	cities   map[string]*City
	cinemas  map[string]*Cinema
	movies   map[string]*Movie
	shows    map[string]*Show
	holds    map[string]*Hold
	bookings map[string]*Booking
	idem     map[string]string // payment_token → booking_id

	pricing    PricingStrategy
	holdWindow time.Duration

	idCount atomic.Int64
}

func NewBookingSystem(pricing PricingStrategy, holdWindow time.Duration) *BookingSystem {
	if pricing == nil {
		pricing = FlatPerSeatPricing{}
	}
	if holdWindow == 0 {
		holdWindow = 5 * time.Minute
	}
	return &BookingSystem{
		cities:     map[string]*City{},
		cinemas:    map[string]*Cinema{},
		movies:     map[string]*Movie{},
		shows:      map[string]*Show{},
		holds:      map[string]*Hold{},
		bookings:   map[string]*Booking{},
		idem:       map[string]string{},
		pricing:    pricing,
		holdWindow: holdWindow,
	}
}

func (s *BookingSystem) nextID(prefix string) string {
	return fmt.Sprintf("%s-%d", prefix, s.idCount.Add(1))
}

// ─── admin ──────────────────────────────────────────────────────────

func (s *BookingSystem) AddCity(name string) *City {
	c := &City{ID: s.nextID("city"), Name: name}
	s.cities[c.ID] = c
	return c
}

func (s *BookingSystem) AddCinema(cityID, name string) *Cinema {
	c := &Cinema{ID: s.nextID("cin"), CityID: cityID, Name: name}
	s.cinemas[c.ID] = c
	return c
}

func (s *BookingSystem) AddScreen(cinemaID, name string, layout []Seat) *Screen {
	scr := &Screen{ID: s.nextID("scr"), CinemaID: cinemaID, Name: name, Seats: layout}
	s.cinemas[cinemaID].Screens = append(s.cinemas[cinemaID].Screens, scr)
	return scr
}

func (s *BookingSystem) AddMovie(title string, dur time.Duration, lang string) *Movie {
	m := &Movie{ID: s.nextID("mov"), Title: title, Duration: dur, Language: lang}
	s.movies[m.ID] = m
	return m
}

func (s *BookingSystem) AddShow(movieID, screenID string, startTime time.Time, basePrice Cents) (*Show, error) {
	m := s.movies[movieID]
	if m == nil {
		return nil, fmt.Errorf("%w: movie %s", ErrInvalidShow, movieID)
	}
	var screen *Screen
	for _, c := range s.cinemas {
		for _, sc := range c.Screens {
			if sc.ID == screenID {
				screen = sc
			}
		}
	}
	if screen == nil {
		return nil, fmt.Errorf("%w: screen %s", ErrInvalidShow, screenID)
	}
	sh := &Show{
		ID:         s.nextID("show"),
		MovieID:    movieID,
		ScreenID:   screenID,
		StartTime:  startTime,
		EndTime:    startTime.Add(m.Duration),
		BasePrice:  basePrice,
		SeatStatus: map[string]SeatStatus{},
		SeatLookup: map[string]Seat{},
	}
	for _, seat := range screen.Seats {
		sh.SeatStatus[seat.ID] = SeatAvailable
		sh.SeatLookup[seat.ID] = seat
	}
	s.shows[sh.ID] = sh
	return sh, nil
}

// ─── browse ─────────────────────────────────────────────────────────

func (s *BookingSystem) GetSeatStatus(showID string) (map[string]SeatStatus, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sh, ok := s.shows[showID]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrShowNotFound, showID)
	}
	out := make(map[string]SeatStatus, len(sh.SeatStatus))
	for k, v := range sh.SeatStatus {
		out[k] = v
	}
	return out, nil
}

// ─── hold / confirm / release ───────────────────────────────────────

func (s *BookingSystem) Hold(showID string, seatIDs []string, customerID string, now time.Time) (*Hold, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sh, ok := s.shows[showID]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrShowNotFound, showID)
	}
	for _, sid := range seatIDs {
		st, exists := sh.SeatStatus[sid]
		if !exists {
			return nil, fmt.Errorf("seat %s not in show %s", sid, showID)
		}
		if st != SeatAvailable {
			return nil, fmt.Errorf("%w: seat %s status=%d", ErrSeatUnavailable, sid, st)
		}
	}
	for _, sid := range seatIDs {
		sh.SeatStatus[sid] = SeatHeld
	}
	seats := make([]Seat, 0, len(seatIDs))
	for _, sid := range seatIDs {
		seats = append(seats, sh.SeatLookup[sid])
	}
	amount := s.pricing.Price(sh, seats)
	h := &Hold{
		ID:         s.nextID("hold"),
		ShowID:     showID,
		SeatIDs:    append([]string(nil), seatIDs...),
		CustomerID: customerID,
		CreatedAt:  now,
		ExpiresAt:  now.Add(s.holdWindow),
		Status:     HoldActive,
		Amount:     amount,
	}
	s.holds[h.ID] = h
	return h, nil
}

func (s *BookingSystem) Confirm(holdID, paymentToken string, now time.Time) (*Booking, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if existingID, ok := s.idem[paymentToken]; ok {
		return s.bookings[existingID], nil
	}
	h, ok := s.holds[holdID]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrHoldNotFound, holdID)
	}
	if h.Status == HoldConfirmed {
		return nil, fmt.Errorf("%w: %s", ErrHoldConfirmed, holdID)
	}
	if h.Status != HoldActive {
		return nil, fmt.Errorf("%w: hold %s status=%d", ErrHoldNotFound, holdID, h.Status)
	}
	if now.After(h.ExpiresAt) {
		s.markExpired(h)
		return nil, fmt.Errorf("%w: %s", ErrHoldExpired, holdID)
	}
	if len(paymentToken) < 8 {
		return nil, fmt.Errorf("%w: token=%q", ErrInvalidPayment, paymentToken)
	}
	sh := s.shows[h.ShowID]
	for _, sid := range h.SeatIDs {
		sh.SeatStatus[sid] = SeatBooked
	}
	b := &Booking{
		ID:           s.nextID("book"),
		HoldID:       h.ID,
		ShowID:       h.ShowID,
		SeatIDs:      append([]string(nil), h.SeatIDs...),
		CustomerID:   h.CustomerID,
		Amount:       h.Amount,
		ConfirmedAt:  now,
		PaymentToken: paymentToken,
	}
	h.Status = HoldConfirmed
	s.bookings[b.ID] = b
	s.idem[paymentToken] = b.ID
	return b, nil
}

func (s *BookingSystem) Release(holdID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	h, ok := s.holds[holdID]
	if !ok || h.Status != HoldActive {
		return false
	}
	sh := s.shows[h.ShowID]
	for _, sid := range h.SeatIDs {
		if sh.SeatStatus[sid] == SeatHeld {
			sh.SeatStatus[sid] = SeatAvailable
		}
	}
	h.Status = HoldReleased
	return true
}

func (s *BookingSystem) ExpireOld(now time.Time) []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	var expired []string
	for _, h := range s.holds {
		if h.Status == HoldActive && now.After(h.ExpiresAt) {
			s.markExpired(h)
			expired = append(expired, h.ID)
		}
	}
	return expired
}

func (s *BookingSystem) markExpired(h *Hold) {
	sh := s.shows[h.ShowID]
	for _, sid := range h.SeatIDs {
		if sh.SeatStatus[sid] == SeatHeld {
			sh.SeatStatus[sid] = SeatAvailable
		}
	}
	h.Status = HoldExpired
}

// ──────────────────────────────────────────────────────────────────────────
// Demo / tests
// ──────────────────────────────────────────────────────────────────────────

func buildDemo(pricing PricingStrategy) (*BookingSystem, *Show) {
	sys := NewBookingSystem(pricing, 0)
	city := sys.AddCity("Bangalore")
	cin := sys.AddCinema(city.ID, "PVR")
	var seats []Seat
	for _, row := range "ABCDE" {
		for c := 1; c <= 10; c++ {
			t := Regular
			if row == 'A' {
				t = Recliner
			} else if row == 'B' || row == 'C' {
				t = Premium
			}
			seats = append(seats, Seat{ID: fmt.Sprintf("%c%d", row, c), Row: string(row), Col: c, Type: t})
		}
	}
	scr := sys.AddScreen(cin.ID, "Audi 1", seats)
	mov := sys.AddMovie("Inception", 148*time.Minute, "English")
	show, _ := sys.AddShow(mov.ID, scr.ID, time.Date(2026, 5, 17, 18, 0, 0, 0, time.UTC), 20000)
	return sys, show
}

func main() {
	basicFlow()
	raceTest()
	holdExpiry()
	confirmAfterExpiry()
	idempotentConfirm()
	releaseTest()
	weekendPricing()
	fmt.Println("\nAll tests passed.")
}

func basicFlow() {
	fmt.Println("--- basic ---")
	sys, show := buildDemo(nil)
	now := time.Now()
	h, err := sys.Hold(show.ID, []string{"A1", "A2"}, "user-1", now)
	if err != nil {
		panic(err)
	}
	fmt.Printf("  hold = %s\n", h.Amount)
	b, err := sys.Confirm(h.ID, "TOKEN-12345678", now)
	if err != nil {
		panic(err)
	}
	if b.Amount != h.Amount {
		panic("amount mismatch")
	}
	statuses, _ := sys.GetSeatStatus(show.ID)
	if statuses["A1"] != SeatBooked || statuses["A2"] != SeatBooked {
		panic("not booked")
	}
	fmt.Println("  OK")
}

func raceTest() {
	fmt.Println("--- race: 50 goroutines for B5 B6 ---")
	sys, show := buildDemo(nil)
	now := time.Now()
	var succ atomic.Int64
	var fail atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := sys.Hold(show.ID, []string{"B5", "B6"}, fmt.Sprintf("user-%d", i), now)
			if err == nil {
				succ.Add(1)
			} else if errors.Is(err, ErrSeatUnavailable) {
				fail.Add(1)
			}
		}(i)
	}
	wg.Wait()
	if succ.Load() != 1 || fail.Load() != 49 {
		panic(fmt.Sprintf("got succ=%d fail=%d", succ.Load(), fail.Load()))
	}
	fmt.Printf("  exactly 1 succeeded, %d failed ✓\n", fail.Load())
}

func holdExpiry() {
	fmt.Println("--- hold expiry ---")
	sys, show := buildDemo(nil)
	base := time.Date(2026, 5, 17, 17, 0, 0, 0, time.UTC)
	h, _ := sys.Hold(show.ID, []string{"C3"}, "user-x", base)
	expired := sys.ExpireOld(base.Add(6 * time.Minute))
	if len(expired) != 1 || expired[0] != h.ID {
		panic("expected expiry")
	}
	statuses, _ := sys.GetSeatStatus(show.ID)
	if statuses["C3"] != SeatAvailable {
		panic("seat not released")
	}
	fmt.Println("  OK")
}

func confirmAfterExpiry() {
	fmt.Println("--- confirm after expiry ---")
	sys, show := buildDemo(nil)
	base := time.Date(2026, 5, 17, 17, 0, 0, 0, time.UTC)
	h, _ := sys.Hold(show.ID, []string{"D5"}, "user-y", base)
	_, err := sys.Confirm(h.ID, "TOKEN-AAAAAAAA", base.Add(6*time.Minute))
	if !errors.Is(err, ErrHoldExpired) {
		panic("expected ErrHoldExpired")
	}
	statuses, _ := sys.GetSeatStatus(show.ID)
	if statuses["D5"] != SeatAvailable {
		panic("seat should be released")
	}
	fmt.Println("  OK")
}

func idempotentConfirm() {
	fmt.Println("--- idempotent confirm ---")
	sys, show := buildDemo(nil)
	now := time.Now()
	h, _ := sys.Hold(show.ID, []string{"E1"}, "user-z", now)
	b1, _ := sys.Confirm(h.ID, "TOKEN-IDEMPOTENT", now)
	b2, _ := sys.Confirm(h.ID, "TOKEN-IDEMPOTENT", now)
	if b1.ID != b2.ID {
		panic("idempotency broken")
	}
	fmt.Println("  OK")
}

func releaseTest() {
	fmt.Println("--- release ---")
	sys, show := buildDemo(nil)
	h, _ := sys.Hold(show.ID, []string{"A5", "A6"}, "user-r", time.Now())
	if !sys.Release(h.ID) {
		panic("release should succeed")
	}
	if sys.Release(h.ID) {
		panic("double release should fail")
	}
	statuses, _ := sys.GetSeatStatus(show.ID)
	if statuses["A5"] != SeatAvailable {
		panic("seat not released")
	}
	fmt.Println("  OK")
}

func weekendPricing() {
	fmt.Println("--- weekend pricing ---")
	pricing := WeekendUpliftPricing{Base: FlatPerSeatPricing{}}
	sys := NewBookingSystem(pricing, 0)
	city := sys.AddCity("Mumbai")
	cin := sys.AddCinema(city.ID, "INOX")
	scr := sys.AddScreen(cin.ID, "1", []Seat{{ID: "A1", Row: "A", Col: 1, Type: Regular}})
	mov := sys.AddMovie("M", 120*time.Minute, "Hindi")
	sat, _ := sys.AddShow(mov.ID, scr.ID, time.Date(2026, 5, 16, 18, 0, 0, 0, time.UTC), 10000)
	mon, _ := sys.AddShow(mov.ID, scr.ID, time.Date(2026, 5, 18, 18, 0, 0, 0, time.UTC), 10000)
	hsat, _ := sys.Hold(sat.ID, []string{"A1"}, "u1", time.Now())
	hmon, _ := sys.Hold(mon.ID, []string{"A1"}, "u2", time.Now())
	if hsat.Amount != Cents(12500) {
		panic(fmt.Sprintf("Saturday: expected $125, got %s", hsat.Amount))
	}
	if hmon.Amount != Cents(10000) {
		panic(fmt.Sprintf("Monday: expected $100, got %s", hmon.Amount))
	}
	fmt.Printf("  Sat=%s Mon=%s\n", hsat.Amount, hmon.Amount)
}
```

### How to run

```bash
go run /path/to/booking.go
```

---

## 11. Cross-Questions ("Why X and not Y") — ≥ 12

### 11.1 Why `int64` cents and not `*big.Rat`?

Money is exact. `int64` cents fits any reasonable amount up to $90 quadrillion. Compares with `==`, no allocations. Convert to/from string at API boundaries.

`big.Rat` is overkill — we don't need rational arithmetic, just integer cents.

### 11.2 Why `sync.Mutex` and not `sync.RWMutex`?

Both `Hold` and `Confirm` are read-then-write under one critical section. There's no read-only path that benefits from RLock. RWMutex would add unnecessary overhead.

`GetSeatStatus` is read-only and could use RLock if we split — but then we'd hold two different lock kinds, and the snapshot doesn't need to be lock-free with respect to Hold. Plain Mutex is simpler.

### 11.3 Why `errors.Is` for error checks?

`fmt.Errorf("%w: ...", ErrSeatUnavailable)` wraps. Direct `==` comparison fails (wrapped error has different identity). `errors.Is` walks the chain. Standard Go post-1.13.

### 11.4 Why `idem map[string]string` (token → booking ID) and not the booking itself?

Pointer indirection. Caller holds `*Booking`; idem cache points to it via ID. If we ever GC bookings (we don't here), the indirection survives.

For larger systems, idem keys live in Redis with TTL — same pattern, durable.

### 11.5 Why `nextID` as `prefix-N` instead of UUID?

Readability for debugging. `hold-42` is grep-friendly; UUIDs are not. Production would use UUIDs (collision-free across instances) — but this is single-instance.

### 11.6 What if `Hold.SeatIDs` is mutated after creation?

`append([]string(nil), seatIDs...)` defensively copies the input. Caller can't mutate our internal state via their slice.

This is an important Go pattern: never trust slice arguments; copy if you need ownership.

### 11.7 Why `WeekendUpliftPricing` wraps `Base` instead of duplicating the formula?

Decorator pattern. `WeekendUpliftPricing{Base: FlatPerSeatPricing{}}` chains: base computes, weekend multiplies. Composes with future strategies (`PromoDiscount{Base: WeekendUpliftPricing{Base: Flat{}}}`).

### 11.8 Why does `Hold` accept `now time.Time` instead of calling `time.Now()`?

Testability. Tests inject deterministic time. Production callers pass `time.Now()`.

For real apps, an injectable `Clock` interface is cleaner — we use the simpler approach of "pass now in" because the API surface is small.

### 11.9 Why does `Confirm` re-check expiry rather than rely on the sweeper?

Race: hold expires between sweeper runs. If a customer pays on a hold that's seconds past expiry (sweeper hasn't run), `Confirm` MUST detect and reject — otherwise we double-book.

Belt-and-suspenders: sweeper handles cleanup; Confirm is the source-of-truth at decision time.

### 11.10 What's the failure mode if Confirm fails midway (some seats marked, others not)?

In our code, Confirm is straight-line under the lock — no partial state visible to other goroutines. A panic mid-loop would leave the system in a bad state, but Go panics are programmer errors, not runtime conditions.

For production: deferred `recover()` to convert panics into errors and roll back. We don't here.

### 11.11 Why `[]string` for seat IDs and not `[]Seat` directly?

IDs are stable; seat structs may need refresh. The `Show.SeatLookup` map turns IDs into Seats when needed (e.g. for pricing).

Also: storing IDs only is cheaper for serialization/audit logs.

### 11.12 Why isn't there a `Cancel(bookingID)` method?

P0 doesn't include it; designed-for as P1. Implementation: revert seats from BOOKED to AVAILABLE, mark booking CANCELLED, integrate with refund (out of scope).

### 11.13 How would you scale to per-show locks?

```go
type BookingSystem struct {
    showLocks map[string]*sync.Mutex
    showLocksMu sync.Mutex // meta-lock for the map
    ...
}
func (s *BookingSystem) lockShow(id string) *sync.Mutex {
    s.showLocksMu.Lock()
    defer s.showLocksMu.Unlock()
    if s.showLocks[id] == nil {
        s.showLocks[id] = &sync.Mutex{}
    }
    return s.showLocks[id]
}
```
Acquire `showLocks[id]` instead of system lock for per-show ops. System lock only for cross-show ops (rare).

### 11.14 What about distributed deployment?

Move to a DB. Use `SELECT ... FOR UPDATE NOWAIT` on the show row. Multiple stateless service instances; the DB is the lock manager.

Or: Redis with Lua scripts for atomic check-and-mark. Same pattern, lower latency, more complex on failure paths.

### 11.15 Why is `BookingSystem.AddX` not under the lock?

For the demo, all admin ops happen at startup before concurrent traffic. In production, they would be under the lock (cinemas added at runtime is rare but possible).

We omit for clarity in the demo.

---

## 12. Extensions
(Same as Python — see `LLD/Python/movie-ticket-booking.md` §12.)

---

## 13. Cheat-Sheet Recap

1. **Problem:** Two-phase movie booking; concurrent-correct, idempotent.
2. **Idioms:** `int64` cents, `sync.Mutex`, sentinel errors, defensive slice copies.
3. **Patterns:** Strategy (pricing decorator chain), State, Facade, Two-phase commit-light.
4. **Concurrency:** Single mutex; per-show as scaling extension.
5. **Idempotency:** payment_token → booking_id map.
6. **Trade-offs:** Pessimistic lock for high contention; integer cents for exactness.

---

## Appendix A: How this differs from the Python version

```
Python                          Go
─────────                       ─────
Decimal                         int64 cents
threading.RLock                 sync.Mutex
@dataclass                      struct
raise                           return error
Optional[X]                     *X (nil)
class with method               func receivers
inheritance (FlatPerSeat→Wkn)   embedding/composition (struct field)
```

## Appendix B: Common Go gotchas

```
- map iteration order randomized; sort if you need determinism.
- A nil slice has len 0; append to it works.
- `time.Now()` returns a value; copies are independent.
- defensive slice copy: append([]T(nil), src...).
- atomic.Int64 (1.19+) preferred over atomic.AddInt64 boilerplate.
- Don't forget `defer mu.Unlock()` on every Lock.
- errors.Is for sentinel chain; errors.As for typed errors.
```

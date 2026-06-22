# Inventory Management — Low-Level Design (Go)

> **Difficulty:** Medium → Hard
> **Tags:** `[lld]` `[ood]` `[transactions]` `[reservation]` `[concurrency]` `[idempotency]`
> **Language:** Go 1.21+
> **Prep time:** ~10 min skim, ~30 min deep read
> **Companies that ask this:** Amazon, Flipkart, Walmart, Uber, Atlassian

---

## Beginner's Guide

### What's this in plain English?

Amazon's stock system. Products in warehouses. Buy → reserve → ship → decrement. Returns refill. Hot items get many concurrent buys — must not overshoot count.

### Why solve it?

- **Real world**: Amazon, Flipkart, Walmart.
- **Teaches**: atomic decrement, reservation, idempotency, multi-warehouse routing.

### Vocabulary

- **SKU** — product variant id.
- **Stock**, **Reservation** (with expiry), **Idempotency key**.

### High-level approach

Entities: **Product**, **Warehouse** (`map[SKU]int`), **Reservation**, **Service** (mutex per SKU or per warehouse).

Reserve under lock: check stock → decrement available, add reserved.
Confirm: reserved → sold.
Cancel: reserved → available.

Multi-warehouse: try in priority order; split if needed.

### How to read this doc

- **Beginner**: available / reserved / sold split.
- **Interview**: idempotency, locking strategies, multi-warehouse.

---

## 0. How to use this doc in an interview

Python version covers entities, two-phase reservation, allocator, idempotency. **In Go, the conversation pivots:**
- **`sync.Mutex`** (not RWMutex) — `Reserve` is read-then-write.
- **Sentinel errors** + `errors.Is` for typed checks.
- **No exceptions** — `(value, error)` returns.
- **Pointer receivers + map[key]*StockItem** for in-place mutation.
- **`atomic.Int64`** for ID counter.

The race correctness test (50 goroutines, 10 stock → exactly 10 succeed) is a good `-race` demonstration.

---

## 1. Problem Statement
(Same as Python.)

---

## 2. Clarifying Questions
Same. Go-specific: `time.Time` everywhere; injectable clock for tests.

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
| `SKU`, `Warehouse` | structs (immutable) |
| `StockItem` | struct, mutated under lock |
| `Reservation` | struct |
| `Movement` | struct (immutable) |
| `AllocationStrategy` | interface |
| `InventorySystem` | facade with `sync.Mutex` |

---

## 6. Class Diagram (ASCII)
(Same shape as Python — see `LLD/Python/inventory-management.md` §6.)

---

## 7. Design Patterns
(Same as Python.)

---

## 8. Sequence Diagrams
(Same as Python.)

---

## 9. Concurrency Considerations

Single `sync.Mutex` on the system. `Reserve`, `Commit`, `Release`, `Transfer`, `Adjust` all take the write lock.

For per-SKU scaling: lazy-init map of locks; meta-lock for the map; acquire SKU lock when operating on one SKU.

---

## 10. Full Working Code

```go
// File: inventory.go
// Build: go run inventory.go
package main

import (
	"errors"
	"fmt"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// ──────────────────────────────────────────────────────────────────────────
// Enums
// ──────────────────────────────────────────────────────────────────────────

type ReservationStatus int

const (
	RActive ReservationStatus = iota
	RCommitted
	RReleased
	RExpired
)

func (s ReservationStatus) String() string {
	return []string{"active", "committed", "released", "expired"}[s]
}

type MovementType int

const (
	MReceive MovementType = iota
	MCommit
	MTransfer
	MAdjust
)

func (m MovementType) String() string {
	return []string{"receive", "commit", "transfer", "adjust"}[m]
}

// ──────────────────────────────────────────────────────────────────────────
// Sentinel errors
// ──────────────────────────────────────────────────────────────────────────

var (
	ErrInsufficientStock     = errors.New("inv: insufficient stock")
	ErrUnknownSKU            = errors.New("inv: unknown sku")
	ErrUnknownWarehouse      = errors.New("inv: unknown warehouse")
	ErrReservationNotFound   = errors.New("inv: reservation not found")
	ErrReservationExpired    = errors.New("inv: reservation expired")
	ErrReservationFinal      = errors.New("inv: reservation already final")
	ErrInvalidPayment        = errors.New("inv: invalid payment token")
	ErrInvalidQty            = errors.New("inv: qty must be positive")
)

// ──────────────────────────────────────────────────────────────────────────
// Domain
// ──────────────────────────────────────────────────────────────────────────

type SKU struct {
	ID                string
	Name              string
	ReorderThreshold  int
}

type Warehouse struct {
	ID   string
	Name string
	City string
}

type StockItem struct {
	SkuID    string
	WhID     string
	OnHand   int
	Reserved int
}

func (s *StockItem) Available() int { return s.OnHand - s.Reserved }

type ReservationLine struct {
	SkuID string
	WhID  string
	Qty   int
}

type Reservation struct {
	ID         string
	CustomerID string
	Lines      []ReservationLine
	CreatedAt  time.Time
	ExpiresAt  time.Time
	Status     ReservationStatus
}

type MovementLine struct {
	SkuID string
	WhID  string
	Delta int
}

type Movement struct {
	ID        string
	Type      MovementType
	Lines     []MovementLine
	Timestamp time.Time
	Reason    string
}

// ──────────────────────────────────────────────────────────────────────────
// Allocation strategy
// ──────────────────────────────────────────────────────────────────────────

type AllocationStrategy interface {
	// Allocate returns a list of (warehouse, qty) to take, or nil if cannot fulfill.
	Allocate(sku string, qty int, view []*StockItem) []ReservationLine
}

type FirstFitAllocator struct{}

func (FirstFitAllocator) Allocate(sku string, qty int, view []*StockItem) []ReservationLine {
	remaining := qty
	var plan []ReservationLine
	for _, s := range view {
		if remaining <= 0 {
			break
		}
		take := remaining
		if s.Available() < take {
			take = s.Available()
		}
		if take > 0 {
			plan = append(plan, ReservationLine{SkuID: sku, WhID: s.WhID, Qty: take})
			remaining -= take
		}
	}
	if remaining > 0 {
		return nil
	}
	return plan
}

type MostStockedAllocator struct{}

func (MostStockedAllocator) Allocate(sku string, qty int, view []*StockItem) []ReservationLine {
	sorted := append([]*StockItem(nil), view...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Available() > sorted[j].Available() })
	return FirstFitAllocator{}.Allocate(sku, qty, sorted)
}

// ──────────────────────────────────────────────────────────────────────────
// InventorySystem
// ──────────────────────────────────────────────────────────────────────────

type stockKey struct {
	sku, wh string
}

type InventorySystem struct {
	mu sync.Mutex

	skus         map[string]*SKU
	warehouses   map[string]*Warehouse
	stock        map[stockKey]*StockItem
	reservations map[string]*Reservation
	movements    []*Movement
	idem         map[string]string // payment_token → movement_id

	allocator AllocationStrategy
	window    time.Duration

	idCount atomic.Int64
}

func NewInventorySystem(alloc AllocationStrategy, window time.Duration) *InventorySystem {
	if alloc == nil {
		alloc = FirstFitAllocator{}
	}
	if window == 0 {
		window = 30 * time.Minute
	}
	return &InventorySystem{
		skus:         map[string]*SKU{},
		warehouses:   map[string]*Warehouse{},
		stock:        map[stockKey]*StockItem{},
		reservations: map[string]*Reservation{},
		idem:         map[string]string{},
		allocator:    alloc,
		window:       window,
	}
}

func (s *InventorySystem) nextID(prefix string) string {
	return fmt.Sprintf("%s-%d", prefix, s.idCount.Add(1))
}

// ─── admin ──────────────────────────────────────────────────────────

func (s *InventorySystem) AddSKU(id, name string, reorder int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.skus[id]; ok {
		return fmt.Errorf("sku %s exists", id)
	}
	s.skus[id] = &SKU{ID: id, Name: name, ReorderThreshold: reorder}
	return nil
}

func (s *InventorySystem) AddWarehouse(id, name, city string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.warehouses[id]; ok {
		return fmt.Errorf("warehouse %s exists", id)
	}
	s.warehouses[id] = &Warehouse{ID: id, Name: name, City: city}
	return nil
}

func (s *InventorySystem) ensureStock(sku, wh string) (*StockItem, error) {
	if _, ok := s.skus[sku]; !ok {
		return nil, fmt.Errorf("%w: %s", ErrUnknownSKU, sku)
	}
	if _, ok := s.warehouses[wh]; !ok {
		return nil, fmt.Errorf("%w: %s", ErrUnknownWarehouse, wh)
	}
	k := stockKey{sku, wh}
	if _, ok := s.stock[k]; !ok {
		s.stock[k] = &StockItem{SkuID: sku, WhID: wh}
	}
	return s.stock[k], nil
}

// ─── core ops ──────────────────────────────────────────────────────

func (s *InventorySystem) Receive(sku, wh string, qty int) (*Movement, error) {
	if qty <= 0 {
		return nil, ErrInvalidQty
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	si, err := s.ensureStock(sku, wh)
	if err != nil {
		return nil, err
	}
	si.OnHand += qty
	mv := &Movement{
		ID:        s.nextID("mv"),
		Type:      MReceive,
		Lines:     []MovementLine{{SkuID: sku, WhID: wh, Delta: qty}},
		Timestamp: time.Now(),
	}
	s.movements = append(s.movements, mv)
	return mv, nil
}

func (s *InventorySystem) Reserve(sku string, qty int, customerID string, now time.Time) (*Reservation, error) {
	if qty <= 0 {
		return nil, ErrInvalidQty
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.skus[sku]; !ok {
		return nil, fmt.Errorf("%w: %s", ErrUnknownSKU, sku)
	}
	view := s.stockView(sku)
	plan := s.allocator.Allocate(sku, qty, view)
	if plan == nil {
		total := 0
		for _, si := range view {
			total += si.Available()
		}
		return nil, fmt.Errorf("%w: sku=%s qty=%d available=%d", ErrInsufficientStock, sku, qty, total)
	}
	for _, line := range plan {
		s.stock[stockKey{line.SkuID, line.WhID}].Reserved += line.Qty
	}
	r := &Reservation{
		ID:         s.nextID("rsv"),
		CustomerID: customerID,
		Lines:      append([]ReservationLine(nil), plan...),
		CreatedAt:  now,
		ExpiresAt:  now.Add(s.window),
		Status:     RActive,
	}
	s.reservations[r.ID] = r
	return r, nil
}

func (s *InventorySystem) Commit(reservationID, paymentToken string, now time.Time) (*Movement, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if mid, ok := s.idem[paymentToken]; ok {
		for _, m := range s.movements {
			if m.ID == mid {
				return m, nil
			}
		}
	}
	r, ok := s.reservations[reservationID]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrReservationNotFound, reservationID)
	}
	if r.Status == RCommitted {
		return nil, fmt.Errorf("%w: already committed", ErrReservationFinal)
	}
	if r.Status != RActive {
		return nil, fmt.Errorf("%w: status=%s", ErrReservationNotFound, r.Status)
	}
	if now.After(r.ExpiresAt) {
		s.markExpired(r)
		return nil, fmt.Errorf("%w: %s", ErrReservationExpired, r.ID)
	}
	if len(paymentToken) < 8 {
		return nil, fmt.Errorf("%w: %q", ErrInvalidPayment, paymentToken)
	}
	mvLines := make([]MovementLine, 0, len(r.Lines))
	for _, line := range r.Lines {
		si := s.stock[stockKey{line.SkuID, line.WhID}]
		si.OnHand -= line.Qty
		si.Reserved -= line.Qty
		mvLines = append(mvLines, MovementLine{SkuID: line.SkuID, WhID: line.WhID, Delta: -line.Qty})
	}
	mv := &Movement{
		ID:        s.nextID("mv"),
		Type:      MCommit,
		Lines:     mvLines,
		Timestamp: now,
	}
	s.movements = append(s.movements, mv)
	r.Status = RCommitted
	s.idem[paymentToken] = mv.ID
	return mv, nil
}

func (s *InventorySystem) Release(reservationID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.reservations[reservationID]
	if !ok || r.Status != RActive {
		return false
	}
	for _, line := range r.Lines {
		s.stock[stockKey{line.SkuID, line.WhID}].Reserved -= line.Qty
	}
	r.Status = RReleased
	return true
}

func (s *InventorySystem) Transfer(sku, srcWh, dstWh string, qty int) (*Movement, error) {
	if qty <= 0 {
		return nil, ErrInvalidQty
	}
	if srcWh == dstWh {
		return nil, fmt.Errorf("src and dst must differ")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	src, err := s.ensureStock(sku, srcWh)
	if err != nil {
		return nil, err
	}
	dst, err := s.ensureStock(sku, dstWh)
	if err != nil {
		return nil, err
	}
	if src.Available() < qty {
		return nil, fmt.Errorf("%w: src available %d < %d", ErrInsufficientStock, src.Available(), qty)
	}
	src.OnHand -= qty
	dst.OnHand += qty
	mv := &Movement{
		ID:   s.nextID("mv"),
		Type: MTransfer,
		Lines: []MovementLine{
			{SkuID: sku, WhID: srcWh, Delta: -qty},
			{SkuID: sku, WhID: dstWh, Delta: +qty},
		},
		Timestamp: time.Now(),
	}
	s.movements = append(s.movements, mv)
	return mv, nil
}

func (s *InventorySystem) Adjust(sku, wh string, delta int, reason string) (*Movement, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	si, err := s.ensureStock(sku, wh)
	if err != nil {
		return nil, err
	}
	if si.OnHand+delta < 0 {
		return nil, fmt.Errorf("%w: would go negative", ErrInsufficientStock)
	}
	si.OnHand += delta
	mv := &Movement{
		ID:        s.nextID("mv"),
		Type:      MAdjust,
		Lines:     []MovementLine{{SkuID: sku, WhID: wh, Delta: delta}},
		Timestamp: time.Now(),
		Reason:    reason,
	}
	s.movements = append(s.movements, mv)
	return mv, nil
}

func (s *InventorySystem) ExpireOld(now time.Time) []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	var expired []string
	for _, r := range s.reservations {
		if r.Status == RActive && now.After(r.ExpiresAt) {
			s.markExpired(r)
			expired = append(expired, r.ID)
		}
	}
	return expired
}

func (s *InventorySystem) markExpired(r *Reservation) {
	for _, line := range r.Lines {
		s.stock[stockKey{line.SkuID, line.WhID}].Reserved -= line.Qty
	}
	r.Status = RExpired
}

// ─── queries ───────────────────────────────────────────────────────

func (s *InventorySystem) stockView(sku string) []*StockItem {
	var out []*StockItem
	for k, si := range s.stock {
		if k.sku == sku {
			out = append(out, si)
		}
	}
	// stable order by warehouse ID
	sort.Slice(out, func(i, j int) bool { return out[i].WhID < out[j].WhID })
	return out
}

func (s *InventorySystem) Available(sku string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	total := 0
	for _, si := range s.stockView(sku) {
		total += si.Available()
	}
	return total
}

func (s *InventorySystem) OnHandByWarehouse(sku string) map[string]int {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := map[string]int{}
	for _, si := range s.stockView(sku) {
		out[si.WhID] = si.OnHand
	}
	return out
}

type ReorderAlert struct {
	SkuID     string
	WhID      string
	OnHand    int
	Threshold int
}

func (s *InventorySystem) BelowReorderThreshold() []ReorderAlert {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []ReorderAlert
	for k, si := range s.stock {
		t := s.skus[k.sku].ReorderThreshold
		if t > 0 && si.OnHand < t {
			out = append(out, ReorderAlert{SkuID: k.sku, WhID: k.wh, OnHand: si.OnHand, Threshold: t})
		}
	}
	return out
}

// ──────────────────────────────────────────────────────────────────────────
// Demo / tests
// ──────────────────────────────────────────────────────────────────────────

func main() {
	basicFlow()
	raceTest()
	crossWarehouse()
	expireTest()
	idempotentCommit()
	transferTest()
	reorderThreshold()
	releaseTest()
	fmt.Println("\nAll tests passed.")
}

func mustNoErr(err error) {
	if err != nil {
		panic(err)
	}
}

func basicFlow() {
	fmt.Println("--- basic ---")
	inv := NewInventorySystem(nil, 0)
	mustNoErr(inv.AddSKU("SKU-A", "Widget", 5))
	mustNoErr(inv.AddWarehouse("WH-1", "Bay", "SF"))
	mustNoErr(inv.AddWarehouse("WH-2", "East", "NYC"))
	_, err := inv.Receive("SKU-A", "WH-1", 10)
	mustNoErr(err)
	_, err = inv.Receive("SKU-A", "WH-2", 5)
	mustNoErr(err)
	if inv.Available("SKU-A") != 15 {
		panic("avail")
	}
	r, err := inv.Reserve("SKU-A", 12, "user-1", time.Now())
	mustNoErr(err)
	if inv.Available("SKU-A") != 3 {
		panic("avail after reserve")
	}
	_, err = inv.Commit(r.ID, "TOKEN-12345678", time.Now())
	mustNoErr(err)
	if inv.Available("SKU-A") != 3 {
		panic("avail after commit")
	}
	fmt.Println("  OK")
}

func raceTest() {
	fmt.Println("--- race: 50 goroutines reserve 1, 10 in stock ---")
	inv := NewInventorySystem(nil, 0)
	mustNoErr(inv.AddSKU("SKU-X", "Hot", 0))
	mustNoErr(inv.AddWarehouse("WH", "X", "X"))
	_, _ = inv.Receive("SKU-X", "WH", 10)

	var succ atomic.Int64
	var fail atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := inv.Reserve("SKU-X", 1, fmt.Sprintf("user-%d", i), time.Now())
			if err == nil {
				succ.Add(1)
			} else if errors.Is(err, ErrInsufficientStock) {
				fail.Add(1)
			}
		}(i)
	}
	wg.Wait()
	if succ.Load() != 10 || fail.Load() != 40 {
		panic(fmt.Sprintf("got succ=%d fail=%d", succ.Load(), fail.Load()))
	}
	if inv.Available("SKU-X") != 0 {
		panic("expected 0 available")
	}
	fmt.Printf("  exactly 10 succeeded, %d failed ✓\n", fail.Load())
}

func crossWarehouse() {
	fmt.Println("--- cross-warehouse ---")
	inv := NewInventorySystem(nil, 0)
	mustNoErr(inv.AddSKU("SKU-A", "X", 0))
	mustNoErr(inv.AddWarehouse("WH-1", "A", "A"))
	mustNoErr(inv.AddWarehouse("WH-2", "B", "B"))
	_, _ = inv.Receive("SKU-A", "WH-1", 7)
	_, _ = inv.Receive("SKU-A", "WH-2", 5)
	r, err := inv.Reserve("SKU-A", 10, "user-1", time.Now())
	mustNoErr(err)
	taken := map[string]int{}
	for _, line := range r.Lines {
		taken[line.WhID] = line.Qty
	}
	if taken["WH-1"] != 7 || taken["WH-2"] != 3 {
		panic(fmt.Sprintf("got %v", taken))
	}
	fmt.Printf("  allocated: %v\n", taken)
}

func expireTest() {
	fmt.Println("--- expire ---")
	inv := NewInventorySystem(nil, 0)
	mustNoErr(inv.AddSKU("SKU-A", "X", 0))
	mustNoErr(inv.AddWarehouse("WH", "X", "X"))
	_, _ = inv.Receive("SKU-A", "WH", 5)
	base := time.Date(2026, 5, 17, 10, 0, 0, 0, time.UTC)
	r, _ := inv.Reserve("SKU-A", 3, "user-1", base)
	if inv.Available("SKU-A") != 2 {
		panic("after reserve")
	}
	expired := inv.ExpireOld(base.Add(31 * time.Minute))
	if len(expired) != 1 || expired[0] != r.ID {
		panic("expected expiry")
	}
	if inv.Available("SKU-A") != 5 {
		panic("after expiry")
	}
	fmt.Println("  OK")
}

func idempotentCommit() {
	fmt.Println("--- idempotent commit ---")
	inv := NewInventorySystem(nil, 0)
	mustNoErr(inv.AddSKU("SKU-A", "X", 0))
	mustNoErr(inv.AddWarehouse("WH", "X", "X"))
	_, _ = inv.Receive("SKU-A", "WH", 5)
	r, _ := inv.Reserve("SKU-A", 2, "user-1", time.Now())
	m1, err := inv.Commit(r.ID, "TOKEN-IDEMPOTENT", time.Now())
	mustNoErr(err)
	m2, err := inv.Commit(r.ID, "TOKEN-IDEMPOTENT", time.Now())
	mustNoErr(err)
	if m1.ID != m2.ID {
		panic("idempotency broken")
	}
	if inv.Available("SKU-A") != 3 {
		panic("after commit")
	}
	fmt.Println("  OK")
}

func transferTest() {
	fmt.Println("--- transfer ---")
	inv := NewInventorySystem(nil, 0)
	mustNoErr(inv.AddSKU("SKU-A", "X", 0))
	mustNoErr(inv.AddWarehouse("WH-1", "A", "A"))
	mustNoErr(inv.AddWarehouse("WH-2", "B", "B"))
	_, _ = inv.Receive("SKU-A", "WH-1", 10)
	_, err := inv.Transfer("SKU-A", "WH-1", "WH-2", 4)
	mustNoErr(err)
	by := inv.OnHandByWarehouse("SKU-A")
	if by["WH-1"] != 6 || by["WH-2"] != 4 {
		panic(fmt.Sprintf("got %v", by))
	}
	fmt.Println("  OK")
}

func reorderThreshold() {
	fmt.Println("--- reorder threshold ---")
	inv := NewInventorySystem(nil, 0)
	mustNoErr(inv.AddSKU("SKU-A", "X", 5))
	mustNoErr(inv.AddWarehouse("WH", "X", "X"))
	_, _ = inv.Receive("SKU-A", "WH", 10)
	_, err := inv.Adjust("SKU-A", "WH", -7, "audit")
	mustNoErr(err)
	alerts := inv.BelowReorderThreshold()
	if len(alerts) != 1 || alerts[0].OnHand != 3 || alerts[0].Threshold != 5 {
		panic(fmt.Sprintf("got %v", alerts))
	}
	fmt.Printf("  alerts: %v\n", alerts)
}

func releaseTest() {
	fmt.Println("--- release ---")
	inv := NewInventorySystem(nil, 0)
	mustNoErr(inv.AddSKU("SKU-A", "X", 0))
	mustNoErr(inv.AddWarehouse("WH", "X", "X"))
	_, _ = inv.Receive("SKU-A", "WH", 5)
	r, _ := inv.Reserve("SKU-A", 3, "user-1", time.Now())
	if inv.Available("SKU-A") != 2 {
		panic("before release")
	}
	if !inv.Release(r.ID) {
		panic("release should succeed")
	}
	if inv.Available("SKU-A") != 5 {
		panic("after release")
	}
	if inv.Release(r.ID) {
		panic("double release should fail")
	}
	fmt.Println("  OK")
}
```

### How to run

```bash
go run /path/to/inventory.go
go run -race /path/to/inventory.go
```

---

## 11. Cross-Questions ("Why X and not Y") — ≥ 12

### 11.1 Why a struct `stockKey{sku, wh}` and not `string` concatenation?

Type safety. `stockKey{"SKU-A", "WH-1"}` can't be confused with arbitrary strings. Equal/hashable as a map key without ambiguity.

A string `"SKU-A:WH-1"` would work but introduces a parsing format and risks collisions if SKU IDs contain `:`. Struct keys are the idiomatic Go pattern.

### 11.2 Why `*StockItem` (pointer) in the map?

Mutation. We bump `OnHand` and `Reserved` in place. Map values are not addressable in Go (`s.stock[k].OnHand++` doesn't compile if the value type is not pointer), so we use pointers.

Cost: one allocation per stock item. Negligible.

### 11.3 Why `sync.Mutex` and not `sync.RWMutex`?

`Reserve`, `Commit`, `Release`, `Transfer` are read-then-write under a single critical section. There's no read-only path that benefits from RLock. RWMutex would add overhead with no concurrency win.

For `Available` / `OnHandByWarehouse` (read-only), we still lock — they snapshot state. If reads dominate, separate read methods could use RLock; for the current design, plain Mutex is correct.

### 11.4 Why does `Reserve` snapshot stock view via `stockView`?

The allocator inspects multiple stock items under the lock; iterating the map directly would be racy in multi-goroutine code (we hold the lock, but the snapshot pattern is robust to future refactors).

`stockView` returns sorted `[]*StockItem` for deterministic allocation behavior.

### 11.5 Why pointer-vs-value in `stockView`?

Pointers because allocator needs to read current `Available()` (which depends on live `Reserved`); we hold the lock so safe. Returning copies would lose updates if the lock is later relaxed.

### 11.6 Why is `Reservation.Lines` a slice (mutable) instead of a fixed array?

Variable length — depends on how many warehouses participate. Slice is the natural Go idiom.

We could enforce immutability after creation by returning copies in getters; we don't bother for the demo.

### 11.7 Why `errors.Is` checks instead of equality?

Same as other docs: `fmt.Errorf("%w: ...", ErrInsufficientStock)` wraps. Equality fails on wrapped errors. `errors.Is` traverses the chain.

### 11.8 What's the failure mode if `Reserve` succeeds at `Reserved += qty` but Reservation creation panics?

Holds the lock until exit. If we panic mid-`Reserve`, deferred `mu.Unlock()` runs but state is corrupted (Reserved counters incremented without a matching Reservation).

Fix: build Reservation struct first; mutate stock counters last; rollback on Reservation creation failure. Our code mutates first then creates — minor risk in production. For interview demo, acceptable.

### 11.9 Why `atomic.Int64` for ID counter despite holding the mutex?

It works correctly under the lock. Atomic provides a small efficiency benefit if we ever moved ID generation outside the critical section.

For consistency: any counter that's accessed under the lock can be plain `int64`. Atomic for those that may not be — defensive.

### 11.10 Why do `Receive`, `Commit`, etc. all return `*Movement`?

Audit trail. Caller can persist the movement, log it, return to user. Returning the movement makes the side effect visible.

For pure success/failure, returning just `error` would suffice; returning the movement gives the caller full info.

### 11.11 What if multiple SKUs need to be reserved atomically (multi-line cart)?

The current `Reserve` is single-SKU. For a multi-SKU cart:
```go
func (s *InventorySystem) ReserveMulti(items []ReservationLine, customerID string, now time.Time) (*Reservation, error)
```
Iterate all items; if any can't be allocated, roll back already-reserved.

We don't implement; designed-for. Would acquire the system lock once for the whole batch.

### 11.12 Why no per-SKU lock in this design?

Coarse lock is correct and simple. Per-SKU lock map adds complexity (lazy init, meta-lock). For ~10k SKUs at moderate load, coarse lock is fine.

For Amazon-scale (millions of SKUs, thousands of req/sec on hot SKUs), shard the inventory by SKU and have per-shard databases.

### 11.13 What's the failure mode if `Transfer` succeeds at src but fails at dst?

In our code, we check both stock items exist before mutating. Both mutations happen under one lock — atomic. If a panic occurs mid-mutation, state is corrupted; deferred unlock runs but inconsistency leaks.

In practice, the operations are simple integer math; panic is unlikely. For production, defensive recovery + rollback.

### 11.14 What about negative inventory (backorder)?

We reject in `Reserve` (allocator returns nil if total < qty). `Adjust` allows negative deltas but only down to 0.

For backorder support: lift the allocator's nil check; track committed-but-unfulfilled separately. Out of scope.

### 11.15 Why is `BelowReorderThreshold` a method on InventorySystem rather than per-SKU?

It's a system-wide query: "what should I reorder right now?" Operations runs this on a schedule and emits events.

For per-SKU: trivial — `OnHandByWarehouse(sku)` + threshold compare.

---

## 12. Extensions
(Same as Python — see Python doc §12.)

---

## 13. Cheat-Sheet Recap

1. **Problem:** Multi-warehouse inventory + reservation + transfer + audit.
2. **Idioms:** Struct map keys, pointer values, sentinel errors, atomic ID counter.
3. **Patterns:** Strategy (allocator), State (reservation), Facade, Two-phase commit-light.
4. **Invariant:** `available = on_hand - reserved`.
5. **Concurrency:** Single Mutex; per-SKU as scaling step.
6. **Idempotency:** payment_token → movement_id.
7. **Trade-offs:** No backorder; coarse lock; pluggable allocator.

---

## Appendix A: How this differs from the Python version

```
Python                          Go
─────────                       ─────
@dataclass                      struct
threading.RLock                 sync.Mutex
defaultdict-ish                 explicit init in ensureStock
Optional[X]                     *X (nil)
raise InsufficientStock         return fmt.Errorf("%w", ErrInsufficientStock)
isinstance                      type assertion (we don't need any here)
list[ReservationLine]           []ReservationLine
```

## Appendix B: Common Go gotchas

```
- Map values are not addressable; use *StockItem in the map for in-place mutation.
- atomic.Int64 (1.19+) preferred over atomic.AddInt64 boilerplate.
- errors.Is for sentinel chain; %w to wrap.
- defer mu.Unlock() at top of method; never bare unlock.
- nil slice append is fine; nil map write panics.
- map iteration order is randomized; sort if you need determinism.
- struct comparisons work field-by-field; OK for stockKey.
```

## Appendix C: Run with race detector

```bash
go run -race /path/to/inventory.go
```

The 50-goroutine race test exercises the lock; `-race` will flag any unsynchronized access. Our code is `-race` clean.

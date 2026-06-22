# Amazon Locker — Low-Level Design (Go)

> **Difficulty:** Medium
> **Tags:** `[lld]` `[ood]` `[interfaces]` `[concurrency]` `[crypto]`
> **Language:** Go 1.21+
> **Prep time:** ~10 min skim, ~30 min deep read
> **Companies that ask this:** Amazon, Microsoft, Atlassian, Uber

---

## Beginner's Guide

### What's this in plain English?

Those metal lockers at gas stations where Amazon delivers packages. Driver picks an empty fit-sized locker; you get an OTP; you tap it in, locker opens, you grab the package. If you don't pick up within N days, locker is reclaimed.

### Why solve it?

- **Real world**: Amazon Hub Lockers, smart parcel boxes.
- **Teaches**: state machine, size-based allocation, OTP generation, expiry sweeps.

### Vocabulary

- **Locker** — single compartment with size + state.
- **OTP** — one-time password.
- **Allocation** — pick a free locker that fits.
- **Expiry** — auto-reclaim after N days.

### High-level approach

Entities: **Package**, **Locker** (size, state, package, OTP, deposit time), **Location**, **AllocationStrategy** interface, **Service** with mutex.

Drop-off: smallest-fit free locker → OTP → state OCCUPIED → notify.
Pick-up: validate OTP → unlock → state EMPTY.
Expiry: periodic sweep on deposit time.

### How to read this doc

- **Beginner**: locker state machine + size matching.
- **Interview**: OTP security, expiry sweep, multi-package.

---

## 0. How to use this doc in an interview

Python version covers entities, OTP hashing, expiry sweep. **In Go, the conversation pivots:**
- `crypto/rand` + `crypto/sha256` for OTP — stdlib, no deps.
- `sync.RWMutex` for concurrent reserves vs reads.
- Errors as values: `var ErrNoLocker = errors.New(...)`; consumers use `errors.Is`.
- No exceptions; the `pickup` retry-then-lockout flow is built from explicit branches.

Watch for: importing `math/rand` for the OTP — that would fail every interview. Use `crypto/rand`.

---

## 1. Problem Statement
(Same as Python — see `LLD/Python/amazon-locker.md` §1.)

---

## 2. Clarifying Questions
Same as Python. Go-specific: error types as sentinels (`errors.Is`) vs structured errors.

---

## 3. Functional Requirements
Same.

---

## 4. Actors & Use Cases
Same.

---

## 5. Core Entities

| Entity | Go shape | Notes |
|---|---|---|
| `Package` | struct (immutable) | |
| `Locker` | struct, mutated under lock | |
| `Location` | struct holding `[]*Locker` | |
| `LockerSystem` | facade with `sync.RWMutex` | |
| `Reservation` | struct (returned to courier) | OTP plaintext, ONCE |
| `Status`, `Size` | named int enums | |

---

## 6. Class Diagram (ASCII)

(Same shape as Python — see `LLD/Python/amazon-locker.md` §6. Go uses `*Locker` pointers throughout for in-place mutation.)

---

## 7. Design Patterns

| Pattern | Go form | Why |
|---|---|---|
| Strategy | `SizeAllocator` interface | Pluggable best-fit / first-fit / load-balance |
| State | `Status` enum + transition checks | Multiple states with valid transitions |
| Facade | `LockerSystem` exports thin API | Hide allocator + lockers from callers |

---

## 8. Sequence Diagrams
(Same as Python.)

---

## 9. Concurrency Considerations

`sync.RWMutex` on `LockerSystem`:
- `Reserve`/`Pickup`/`ExpireOld` take write lock.
- `Availability` takes read lock — read-heavy dashboards parallelize.

For a multi-location chain, switch to per-location locks (independent locations don't contend).

---

## 10. Full Working Code

```go
// File: locker.go
// Build: go run locker.go
package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"sync"
	"sync/atomic"
	"time"
)

// ──────────────────────────────────────────────────────────────────────────
// Enums
// ──────────────────────────────────────────────────────────────────────────

type Size int

const (
	SizeXS Size = iota + 1
	SizeS
	SizeM
	SizeL
)

func (s Size) String() string {
	return []string{"_", "XS", "S", "M", "L"}[s]
}

type Status int

const (
	StatusAvailable Status = iota
	StatusReserved
	StatusAwaitingReturn
	StatusOOS
)

func (s Status) String() string {
	return []string{"AVAILABLE", "RESERVED", "AWAITING_RETURN", "OOS"}[s]
}

// ──────────────────────────────────────────────────────────────────────────
// Sentinel errors
// ──────────────────────────────────────────────────────────────────────────

var (
	ErrNoLocker        = errors.New("locker: none available")
	ErrLockerNotFound  = errors.New("locker: not found")
	ErrInvalidOTP      = errors.New("locker: invalid OTP")
	ErrLockedOut       = errors.New("locker: locked out (too many bad OTPs)")
	ErrInvalidStatus   = errors.New("locker: invalid status transition")
)

// ──────────────────────────────────────────────────────────────────────────
// Domain
// ──────────────────────────────────────────────────────────────────────────

type Package struct {
	OrderID   string
	Size      Size
	CourierID string
}

type Locker struct {
	ID         string
	Size       Size
	Status     Status
	Package    *Package
	OTPSalt    string
	OTPHash    string
	ReservedAt time.Time
	ExpiresAt  time.Time
	Attempts   int
	MaxAttempts int
}

type Location struct {
	ID      string
	Address string
	Lockers []*Locker
}

type Reservation struct {
	LockerID   string
	LocationID string
	OTP        string // plaintext returned ONCE
	ExpiresAt  time.Time
}

// ──────────────────────────────────────────────────────────────────────────
// Strategy: size allocator
// ──────────────────────────────────────────────────────────────────────────

type SizeAllocator interface {
	Allocate(loc *Location, size Size) *Locker
}

type FirstFitAllocator struct{}

func (FirstFitAllocator) Allocate(loc *Location, size Size) *Locker {
	for _, l := range loc.Lockers {
		if l.Status == StatusAvailable && l.Size >= size {
			return l
		}
	}
	return nil
}

type BestFitAllocator struct{}

func (BestFitAllocator) Allocate(loc *Location, size Size) *Locker {
	var best *Locker
	for _, l := range loc.Lockers {
		if l.Status != StatusAvailable || l.Size < size {
			continue
		}
		if best == nil || l.Size < best.Size {
			best = l
			if best.Size == size {
				return best
			}
		}
	}
	return best
}

// ──────────────────────────────────────────────────────────────────────────
// OTP utilities (crypto/rand only — never math/rand)
// ──────────────────────────────────────────────────────────────────────────

func makeOTP() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

func makeSalt() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func hashOTP(otp, salt string) string {
	h := sha256.Sum256([]byte(salt + otp))
	return hex.EncodeToString(h[:])
}

// ──────────────────────────────────────────────────────────────────────────
// LockerSystem
// ──────────────────────────────────────────────────────────────────────────

type LockerSystem struct {
	mu        sync.RWMutex
	locations map[string]*Location
	allocator SizeAllocator
	expiry    time.Duration

	auditCount atomic.Int64
}

func NewLockerSystem(locs []*Location, alloc SizeAllocator, expiry time.Duration) *LockerSystem {
	if alloc == nil {
		alloc = BestFitAllocator{}
	}
	if expiry == 0 {
		expiry = 72 * time.Hour
	}
	m := make(map[string]*Location, len(locs))
	for _, l := range locs {
		m[l.ID] = l
	}
	return &LockerSystem{
		locations: m,
		allocator: alloc,
		expiry:    expiry,
	}
}

func (s *LockerSystem) Reserve(pkg Package, locationID string, now time.Time) (*Reservation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	loc, ok := s.locations[locationID]
	if !ok {
		return nil, fmt.Errorf("%w: location %s", ErrLockerNotFound, locationID)
	}
	l := s.allocator.Allocate(loc, pkg.Size)
	if l == nil {
		return nil, fmt.Errorf("%w: location=%s size=%s", ErrNoLocker, locationID, pkg.Size)
	}

	otp, err := makeOTP()
	if err != nil {
		return nil, fmt.Errorf("otp gen: %w", err)
	}
	salt, err := makeSalt()
	if err != nil {
		return nil, fmt.Errorf("salt gen: %w", err)
	}

	l.Status = StatusReserved
	l.Package = &pkg
	l.OTPSalt = salt
	l.OTPHash = hashOTP(otp, salt)
	l.ReservedAt = now
	l.ExpiresAt = now.Add(s.expiry)
	l.Attempts = 0
	if l.MaxAttempts == 0 {
		l.MaxAttempts = 3
	}

	s.auditCount.Add(1)
	return &Reservation{
		LockerID:   l.ID,
		LocationID: locationID,
		OTP:        otp,
		ExpiresAt:  l.ExpiresAt,
	}, nil
}

func (s *LockerSystem) Pickup(locationID, lockerID, otp string, now time.Time) (*Package, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	loc, ok := s.locations[locationID]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrLockerNotFound, locationID)
	}
	var l *Locker
	for _, x := range loc.Lockers {
		if x.ID == lockerID {
			l = x
			break
		}
	}
	if l == nil {
		return nil, fmt.Errorf("%w: %s/%s", ErrLockerNotFound, locationID, lockerID)
	}
	if l.Status == StatusOOS {
		return nil, fmt.Errorf("%w: %s", ErrLockedOut, lockerID)
	}
	if l.Status != StatusReserved {
		return nil, fmt.Errorf("%w: locker %s not reserved", ErrInvalidOTP, lockerID)
	}
	if now.After(l.ExpiresAt) {
		return nil, fmt.Errorf("%w: reservation expired", ErrInvalidOTP)
	}
	if hashOTP(otp, l.OTPSalt) != l.OTPHash {
		l.Attempts++
		if l.Attempts >= l.MaxAttempts {
			l.Status = StatusOOS
			return nil, fmt.Errorf("%w: %d bad attempts", ErrLockedOut, l.Attempts)
		}
		return nil, fmt.Errorf("%w: attempt %d/%d", ErrInvalidOTP, l.Attempts, l.MaxAttempts)
	}

	pkg := l.Package
	s.resetLocker(l)
	s.auditCount.Add(1)
	return pkg, nil
}

func (s *LockerSystem) ExpireOld(now time.Time) []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	var swept []string
	for _, loc := range s.locations {
		for _, l := range loc.Lockers {
			if l.Status == StatusReserved && now.After(l.ExpiresAt) {
				l.Status = StatusAwaitingReturn
				swept = append(swept, l.ID)
				s.auditCount.Add(1)
			}
		}
	}
	return swept
}

func (s *LockerSystem) CourierCollectReturned(locationID, lockerID string) (*Package, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	loc, ok := s.locations[locationID]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrLockerNotFound, locationID)
	}
	for _, l := range loc.Lockers {
		if l.ID != lockerID {
			continue
		}
		if l.Status != StatusAwaitingReturn {
			return nil, fmt.Errorf("%w: not awaiting return", ErrInvalidStatus)
		}
		pkg := l.Package
		s.resetLocker(l)
		s.auditCount.Add(1)
		return pkg, nil
	}
	return nil, fmt.Errorf("%w: %s", ErrLockerNotFound, lockerID)
}

func (s *LockerSystem) Availability() map[string]map[string]int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]map[string]int, len(s.locations))
	for id, loc := range s.locations {
		stats := map[string]int{"total": len(loc.Lockers)}
		for _, l := range loc.Lockers {
			stats[l.Status.String()]++
		}
		out[id] = stats
	}
	return out
}

func (s *LockerSystem) resetLocker(l *Locker) {
	l.Status = StatusAvailable
	l.Package = nil
	l.OTPSalt = ""
	l.OTPHash = ""
	l.ReservedAt = time.Time{}
	l.ExpiresAt = time.Time{}
	l.Attempts = 0
}

// ──────────────────────────────────────────────────────────────────────────
// Demo
// ──────────────────────────────────────────────────────────────────────────

func main() {
	// Build location
	var lockers []*Locker
	idx := 0
	for size, n := range map[Size]int{SizeXS: 2, SizeS: 4, SizeM: 4, SizeL: 2} {
		for i := 0; i < n; i++ {
			idx++
			lockers = append(lockers, &Locker{ID: fmt.Sprintf("L%03d", idx), Size: size})
		}
	}
	loc := &Location{ID: "LOC-001", Address: "1 Main St", Lockers: lockers}
	sys := NewLockerSystem([]*Location{loc}, BestFitAllocator{}, 0)

	now := time.Date(2026, 5, 17, 10, 0, 0, 0, time.UTC)

	// reserve + pickup happy path
	pkg := Package{OrderID: "ORD-A", Size: SizeS, CourierID: "c1"}
	r, err := sys.Reserve(pkg, "LOC-001", now)
	if err != nil {
		panic(err)
	}
	fmt.Printf("Reserved %s → %s, OTP=%s\n", pkg.OrderID, r.LockerID, r.OTP)
	got, err := sys.Pickup("LOC-001", r.LockerID, r.OTP, now.Add(time.Hour))
	if err != nil || got.OrderID != "ORD-A" {
		panic(fmt.Sprintf("pickup: %v %v", got, err))
	}
	fmt.Println("Pickup OK")

	// 3 wrong OTP → lockout
	r2, _ := sys.Reserve(Package{OrderID: "ORD-B", Size: SizeM, CourierID: "c1"}, "LOC-001", now)
	for i := 0; i < 3; i++ {
		_, err = sys.Pickup("LOC-001", r2.LockerID, "000000", now)
	}
	if !errors.Is(err, ErrLockedOut) {
		panic("expected lockout")
	}
	fmt.Printf("Locked out after 3 attempts ✓ (%v)\n", err)

	// Expiry sweep
	r3, _ := sys.Reserve(Package{OrderID: "ORD-C", Size: SizeL, CourierID: "c2"}, "LOC-001", now)
	swept := sys.ExpireOld(now.Add(73 * time.Hour))
	if len(swept) != 1 || swept[0] != r3.LockerID {
		panic("expected r3 swept")
	}
	fmt.Printf("Expiry sweep: %v\n", swept)

	// Concurrency: 50 goroutines for 10 small lockers
	var lockers2 []*Locker
	for i := 0; i < 10; i++ {
		lockers2 = append(lockers2, &Locker{ID: fmt.Sprintf("X%03d", i), Size: SizeS})
	}
	loc2 := &Location{ID: "LOC-X", Lockers: lockers2}
	sys2 := NewLockerSystem([]*Location{loc2}, BestFitAllocator{}, 0)

	var wg sync.WaitGroup
	var succ, failed atomic.Int64
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := sys2.Reserve(Package{OrderID: fmt.Sprintf("O-%d", i), Size: SizeS}, "LOC-X", now)
			if err == nil {
				succ.Add(1)
			} else if errors.Is(err, ErrNoLocker) {
				failed.Add(1)
			}
		}(i)
	}
	wg.Wait()
	fmt.Printf("Concurrency: %d succeeded, %d failed (expect 10/40)\n", succ.Load(), failed.Load())
	if succ.Load() != 10 || failed.Load() != 40 {
		panic("invariant broken")
	}
	fmt.Println("\nAll demo checks passed.")
}
```

### How to run

```bash
go run /path/to/locker.go
```

---

## 11. Cross-Questions ("Why X and not Y") — ≥ 12

### 11.1 Why `crypto/rand` and not `math/rand`?

`math/rand` (pre-1.20) used a deterministic seed; `math/rand/v2` (1.22+) is better but still designed for simulation, not security. Predictable from observed output → an attacker can guess upcoming OTPs.

`crypto/rand.Reader` is `/dev/urandom`-backed (or equivalent on Windows). Cryptographically random; what `secrets` is to Python.

### 11.2 Why `errors.Is` checks in tests instead of equality?

`fmt.Errorf("%w: ...", ErrNoLocker)` wraps the sentinel. `err == ErrNoLocker` would fail (the wrapped error has different identity). `errors.Is(err, ErrNoLocker)` walks the wrap chain and returns true if any matches.

This is the canonical Go error-handling pattern post-1.13.

### 11.3 Why `sync.RWMutex` instead of `sync.Mutex`?

`Availability` is called by dashboards / monitoring routinely. RWMutex lets reads parallelize. Writes (`Reserve`/`Pickup`/`ExpireOld`) are infrequent.

If reads were rare, plain `Mutex` would be faster. Workload-dependent; for this domain, RWMutex wins.

### 11.4 Why `*Locker` pointers in `[]*Locker` and not value `[]Locker`?

Mutation. We update `Locker.Status` in place. With value slices, mutation requires indexed access (`&loc.Lockers[i]`) and breaks if anything passes a copy of the slice. Pointer slices keep the model uniform.

Cost: extra allocation per locker. Negligible.

### 11.5 Why `atomic.Int64` for the audit counter?

It increments under both read- and write-locked code paths in a future expansion. Atomic eliminates dependence on which lock is held.

For our current code we always hold the write lock when bumping. Atomic is belt-and-suspenders.

### 11.6 Why `time.Time` for timestamps and not `int64` Unix seconds?

`time.Time` carries timezone info, supports `Add`, `Before`, `After` directly, and is the stdlib idiom. For DB serialization, we'd convert at the boundary.

### 11.7 Why `MaxAttempts` field on `Locker` rather than a constant?

Tunable per-locker — premium lockers might allow more retries; security-sensitive lockers (e.g. medication delivery) might allow fewer. The field default (3) is set on first use if unspecified.

### 11.8 Why are sentinel errors `errors.New(...)` and not custom error types?

Sentinel + `%w` covers our needs. Custom types (`type LockedOutError struct {Attempts int}`) become valuable when callers need structured info (`errors.As(err, &lo); lo.Attempts`). For our API, the message string is enough.

### 11.9 What if I want to support multiple OTP delivery channels (SMS, email)?

Inject a `Notifier` interface:
```go
type Notifier interface {
    SendOTP(to, otp string) error
}
```
`Reserve` calls `notifier.SendOTP(...)` after generating; the OTP returned in `Reservation` is for the API contract (debugging / fallback) but real flow has the customer reading their phone.

### 11.10 Why doesn't `Reserve` notify the customer directly?

Separation of concerns. The library is a state machine; notification is a side effect. The embedding application reads the `Reservation` and routes the OTP through SMS / email / push.

For testability: a fake notifier in tests; a real SMS gateway in production.

### 11.11 What's the failure mode if the SHA-256 hash collides with another OTP?

SHA-256 collisions are computationally infeasible (~2^128 work). For a 6-digit OTP space (1M values), collision rates are astronomically below worry. If we used a weaker hash, salt would partially help.

For an interview answer: "we use a strong cryptographic hash; collision probability is negligible at this scale." Move on.

### 11.12 What if courier crashes mid-reservation?

The locker is RESERVED with no one knowing the OTP. The expiry sweeper reclaims it after the configured window. Customer is not notified for an unsent OTP — they never knew.

For idempotency: provide a `Reserve` that takes an `idempotency_key` (e.g. `order_id`). If duplicate `order_id` arrives, return the existing reservation. Out of scope; clean addition.

### 11.13 Why are `Locker` fields exported but `LockerSystem.locations` not?

Convention: domain types returned to callers expose fields (less ceremony, easier read). Service-internal state stays unexported to enforce method-mediated access.

In production multi-package design: `Locker` lives in `package locker`, system in `package lockersystem`. Cross-package access enforces the boundary.

### 11.14 Why does `Reserve` take the `Package` by value?

`Package` is small (3 strings) and immutable. Passing by value keeps callers from worrying about lifetime. Inside, we take the address (`&pkg`) to store the pointer — but we own that pointer; caller's value can be on stack.

### 11.15 What's the deadlock risk?

Single mutex; we never call into another method from a method holding the lock. No recursive lock acquisition. Deadlock-free.

For per-location locking (extension): always acquire in a defined order (location_id sorted) when crossing two locations.

---

## 12. Extensions
(Same as Python — see Python doc §12. Implementation: inject `Notifier` interface, `Repository` interface for persistence, etc.)

---

## 13. Cheat-Sheet Recap

1. **Problem:** Locker assignment + OTP pickup + expiry sweep, in Go.
2. **Idioms:** `crypto/rand`, sentinel errors with `%w`, `sync.RWMutex`, `atomic.Int64` for counters.
3. **Patterns:** Strategy (allocator), State (status), Facade (system).
4. **Hardest design call:** Hashed OTP + retry lockout.
5. **Concurrency:** Single RWMutex; per-location lock as scaling extension.
6. **Trade-offs:** Reject on full; manual `ExpireOld` (caller schedules).

---

## Appendix A: How this differs from the Python version

```
Python                          Go
─────────                       ─────
secrets.randbelow(1_000_000)    rand.Int(rand.Reader, big.NewInt(1_000_000))
hashlib.sha256                  crypto/sha256
threading.RLock                 sync.RWMutex
raise InvalidOTP                fmt.Errorf("%w", ErrInvalidOTP)
@dataclass                      struct
Optional[X]                     *X (nil for missing)
secrets.token_hex(16)           rand.Read into [16]byte → hex.EncodeToString
```

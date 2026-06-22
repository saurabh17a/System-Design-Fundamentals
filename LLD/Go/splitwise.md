# Splitwise — Low-Level Design (Go)

> **Difficulty:** Medium → Hard
> **Tags:** `[lld]` `[ood]` `[strategy]` `[graph-algorithm]` `[interfaces]` `[concurrency]`
> **Language:** Go 1.21+
> **Prep time:** ~10 min skim, ~30 min deep read
> **Companies that ask this:** Atlassian, Uber, Razorpay, Goldman Sachs, Microsoft

---

## Beginner's Guide

### What's this in plain English?

You and friends share expenses. App tracks who owes whom. Cool feature: simplify chains (if A→B and B→C, A→C directly). Minimize transactions.

### Why solve it?

- **Real world**: Splitwise, Tricount.
- **Teaches**: balance tracking, Strategy pattern for splits, debt simplification algorithm.

### Vocabulary

- **Expense** — payer, amount, list of (user, share) splits.
- **Split** — Equal / Exact / Percent.
- **Balance** — net per user; sum across group is 0.
- **Simplification** — shortest set of payments to zero out balances.

### High-level approach

Entities: **User**, **Group**, **Expense**, **SplitStrategy** interface (Equal/Exact/Percent), **Service** (with mutex).

Balance update: for each expense, payer's balance += total; each beneficiary's balance -= their share.

Simplify: greedy — largest creditor pays largest debtor; repeat. O(N log N).

### How to read this doc

- **Beginner**: expense → balance flow first.
- **Interview**: simplify algorithm + Strategy for splits are the meat.

---

## 0. How to use this doc in an interview

The Python version (separate doc) covers domain modeling, split types, and the debt-simplification algorithm. **In Go, the conversation pivots** to:

- **Money math without `Decimal`.** Go's stdlib has no Decimal; we use `int64` cents (canonical) or `*big.Rat` (precision but more code).
- **Errors-as-values.** Every "split mismatch" returns an error instead of raising — and errors compose with `%w`.
- **Interfaces as small contracts.** `SplitStrategy` is a one-method interface; concrete strategies are tiny structs.
- **Heap via `container/heap`.** Debt simplification needs a priority queue; Go has it in stdlib but the API is awkward — we implement the heap interface explicitly.
- **No method overloading; rely on factories or option types.**

Watch for: building a runtime-typed registry (`map[SplitType]SplitStrategy`) instead of an exhaustive switch — both are valid, the choice is taste.

---

## 1. Problem Statement

(Same as Python version — see `LLD/Python/splitwise.md` §1.)

---

## 2. Clarifying Questions

Same as Python (§2). Go-specific:

- [ ] Money representation — `int64` cents, `*big.Rat`, or third-party money lib?
- [ ] Concurrency — single-process library, or service with many goroutines? `sync.RWMutex` vs sharded?
- [ ] How are splits described to the API — typed structs or generic `map[string]int64`?

> **For this doc:** in-process library, money as `int64` cents, single `RWMutex`, typed split params via discriminated structs.

---

## 3. Functional Requirements

Same P0–P2 as Python. Implementation differences:
- All errors as `(value, error)` returns.
- Mutability tracked via pointers; immutable types (Expense, Settlement) are returned by value.

---

## 4. Actors & Use Cases

Same as Python.

---

## 5. Core Entities

| Entity | Go shape | Notes |
|---|---|---|
| `User` | struct (immutable) | |
| `Group` | struct, mutable; protected by service lock | |
| `Expense` | struct (immutable, returned by value) | |
| `Settlement` | struct (immutable) | |
| `SplitType` | named int enum | |
| `SplitStrategy` | interface (`Split` method) | |
| `Money` | `int64` cents (canonical) | |

**Money in cents:**
- Storage and arithmetic in `int64`.
- All boundary I/O converts to/from string (`12.50` ↔ `1250` cents).
- No floating-point anywhere.

---

## 6. Class Diagram (ASCII) — Go-flavored

```
                                ┌──────────────────────────────┐
                                │      SplitwiseService        │
                                │──────────────────────────────│
                                │ users      map[id]*User      │
                                │ groups     map[id]*Group     │
                                │ friendship map[a]map[b]int64 │
                                │ mu         sync.RWMutex      │
                                │──────────────────────────────│
                                │ AddUser, CreateGroup         │
                                │ RecordExpense, Settle        │
                                │ GetGroupBalances             │
                                │ SimplifyGroup                │
                                └──────────┬───────────────────┘
                                           │ ◆
                                           ▼
                              ┌──────────────────────────┐
                              │         Group            │
                              │──────────────────────────│
                              │ ID, Name                 │
                              │ Members map[id]struct{}  │
                              │ Expenses []Expense       │
                              │ Settlements []Settlement │
                              │ Balances map[id]int64    │
                              │ Pairwise map[a]map[b]int64
                              └──────────┬───────────────┘
                                         │
                                         │ uses
                                         ▼
                              ┌──────────────────────────┐
                              │ «interface»              │
                              │ SplitStrategy            │
                              │──────────────────────────│
                              │ Split(amount, parts,     │
                              │       params)            │
                              │   → (map[id]int64, error)│
                              └────────────▲─────────────┘
                                           │ implements
                       ┌───────────────────┼─────────────────────┐
                       │                   │                     │
                ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
                │ EqualSplit   │  │ ExactSplit   │  │ PercentSplit /   │
                │              │  │              │  │ ShareSplit       │
                └──────────────┘  └──────────────┘  └──────────────────┘
```

---

## 7. Design Patterns Used (Go angle)

| Pattern | Go realization | Why |
|---|---|---|
| Strategy | `SplitStrategy` interface | One-method interface; minimum surface |
| Factory | `splitFactory(SplitType) SplitStrategy` (private function in service) | Centralizes the type→implementation mapping |
| Facade | `SplitwiseService` exports a thin API | All complexity hidden |

We deliberately don't use:
- **Generics** for split params: each split type wants different params (exact: amounts, percentage: percents, share: integer shares). A union via interface methods works without parameterizing `SplitStrategy[T]` over the param type.
- **Functional options** on `RecordExpense`: too many fields are required. A struct-of-args (`RecordExpenseInput`) is clearer.

---

## 8. Sequence Diagrams

(Same as Python — see `LLD/Python/splitwise.md` §8.)

---

## 9. Concurrency Considerations

`sync.RWMutex` on the service. Reads (balance queries) take RLock; writes (expense / settlement) take Lock.

`Group` mutation happens under the service's write lock — we never expose direct group references that could be mutated outside the lock.

For very large deployments, shard the service by group_id — each shard has its own lock, no cross-shard contention.

---

## 10. Full Working Code

```go
// File: splitwise.go
// Build: go run splitwise.go
package main

import (
	"container/heap"
	"errors"
	"fmt"
	"strconv"
	"sync"
	"sync/atomic"
)

// ──────────────────────────────────────────────────────────────────────────
// Money helpers (int64 cents)
// ──────────────────────────────────────────────────────────────────────────

type Cents int64

func ParseCents(dollarStr string) (Cents, error) {
	// expects "12.50" or "12" or "12.5"
	dot := -1
	for i, c := range dollarStr {
		if c == '.' {
			dot = i
			break
		}
	}
	if dot == -1 {
		whole, err := strconv.ParseInt(dollarStr, 10, 64)
		if err != nil {
			return 0, fmt.Errorf("invalid money %q: %w", dollarStr, err)
		}
		return Cents(whole * 100), nil
	}
	wholeS, fracS := dollarStr[:dot], dollarStr[dot+1:]
	whole, err := strconv.ParseInt(wholeS, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid money %q: %w", dollarStr, err)
	}
	if len(fracS) == 0 {
		return Cents(whole * 100), nil
	}
	if len(fracS) == 1 {
		fracS = fracS + "0"
	}
	if len(fracS) > 2 {
		fracS = fracS[:2] // truncate; alternatively round
	}
	frac, err := strconv.ParseInt(fracS, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid money %q: %w", dollarStr, err)
	}
	if whole >= 0 {
		return Cents(whole*100 + frac), nil
	}
	return Cents(whole*100 - frac), nil
}

func (c Cents) String() string {
	sign := ""
	v := int64(c)
	if v < 0 {
		sign = "-"
		v = -v
	}
	return fmt.Sprintf("%s$%d.%02d", sign, v/100, v%100)
}

// ──────────────────────────────────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────────────────────────────────

var (
	ErrUnknownUser    = errors.New("splitwise: unknown user")
	ErrUnknownGroup   = errors.New("splitwise: unknown group")
	ErrInvalidParams  = errors.New("splitwise: invalid split params")
	ErrAmountInvalid  = errors.New("splitwise: amount must be positive")
	ErrPayerNotInPart = errors.New("splitwise: paid_by must be one of participants")
)

// ──────────────────────────────────────────────────────────────────────────
// Enums
// ──────────────────────────────────────────────────────────────────────────

type SplitType int

const (
	SplitEqual SplitType = iota
	SplitExact
	SplitPercentage
	SplitShare
)

func (t SplitType) String() string {
	return []string{"equal", "exact", "percentage", "share"}[t]
}

// ──────────────────────────────────────────────────────────────────────────
// Domain
// ──────────────────────────────────────────────────────────────────────────

type User struct {
	ID    string
	Name  string
	Email string
}

type SplitParams struct {
	// Exact: per-user cents amounts (sum must equal expense amount)
	Exact map[string]Cents
	// Percentage: per-user percent (sum must equal 100, in basis points * 100? we use ints summing to 100)
	Percentage map[string]int
	// Share: per-user weight (any positive integers; we normalize)
	Shares map[string]int
}

type Expense struct {
	ID           string
	Description  string
	PaidBy       string
	Amount       Cents
	Type         SplitType
	Participants []string
	Breakdown    map[string]Cents
	GroupID      string // empty = personal/friendship
}

type Settlement struct {
	ID      string
	Payer   string
	Payee   string
	Amount  Cents
	GroupID string
}

type Group struct {
	ID         string
	Name       string
	Members    map[string]struct{}
	Expenses   []Expense
	Settlements []Settlement
	Balances   map[string]Cents             // signed: + means group owes user
	Pairwise   map[string]map[string]Cents  // pairwise[a][b] = b owes a
}

func newGroup(id, name string) *Group {
	return &Group{
		ID:       id,
		Name:     name,
		Members:  make(map[string]struct{}),
		Balances: make(map[string]Cents),
		Pairwise: make(map[string]map[string]Cents),
	}
}

// ──────────────────────────────────────────────────────────────────────────
// Strategy: split algorithms
// ──────────────────────────────────────────────────────────────────────────

type SplitStrategy interface {
	Split(amount Cents, participants []string, params SplitParams) (map[string]Cents, error)
}

type EqualSplit struct{}

func (EqualSplit) Split(amount Cents, participants []string, _ SplitParams) (map[string]Cents, error) {
	n := int64(len(participants))
	if n == 0 {
		return nil, fmt.Errorf("%w: equal split needs participants", ErrInvalidParams)
	}
	each := int64(amount) / n
	rem := int64(amount) - each*n
	out := make(map[string]Cents, n)
	for _, p := range participants {
		out[p] = Cents(each)
	}
	if rem != 0 {
		out[participants[0]] += Cents(rem)
	}
	return out, nil
}

type ExactSplit struct{}

func (ExactSplit) Split(amount Cents, participants []string, params SplitParams) (map[string]Cents, error) {
	if len(params.Exact) == 0 {
		return nil, fmt.Errorf("%w: exact split needs Exact map", ErrInvalidParams)
	}
	if !sameKeys(params.Exact, participants) {
		return nil, fmt.Errorf("%w: exact map keys must equal participants", ErrInvalidParams)
	}
	var sum Cents
	for _, v := range params.Exact {
		sum += v
	}
	if sum != amount {
		return nil, fmt.Errorf("%w: exact sum %s != amount %s", ErrInvalidParams, sum, amount)
	}
	out := make(map[string]Cents, len(params.Exact))
	for k, v := range params.Exact {
		out[k] = v
	}
	return out, nil
}

type PercentageSplit struct{}

func (PercentageSplit) Split(amount Cents, participants []string, params SplitParams) (map[string]Cents, error) {
	if len(params.Percentage) == 0 {
		return nil, fmt.Errorf("%w: percentage split needs Percentage map", ErrInvalidParams)
	}
	if !samePctKeys(params.Percentage, participants) {
		return nil, fmt.Errorf("%w: percentage map keys must equal participants", ErrInvalidParams)
	}
	total := 0
	for _, p := range params.Percentage {
		total += p
	}
	if total != 100 {
		return nil, fmt.Errorf("%w: percentages must sum to 100, got %d", ErrInvalidParams, total)
	}
	out := make(map[string]Cents, len(params.Percentage))
	allocated := Cents(0)
	for _, p := range participants {
		share := Cents(int64(amount) * int64(params.Percentage[p]) / 100)
		out[p] = share
		allocated += share
	}
	rem := amount - allocated
	if rem != 0 {
		out[participants[0]] += rem
	}
	return out, nil
}

type ShareSplit struct{}

func (ShareSplit) Split(amount Cents, participants []string, params SplitParams) (map[string]Cents, error) {
	if len(params.Shares) == 0 {
		return nil, fmt.Errorf("%w: share split needs Shares map", ErrInvalidParams)
	}
	if !sameSharesKeys(params.Shares, participants) {
		return nil, fmt.Errorf("%w: shares map keys must equal participants", ErrInvalidParams)
	}
	total := 0
	for _, s := range params.Shares {
		if s <= 0 {
			return nil, fmt.Errorf("%w: shares must be positive", ErrInvalidParams)
		}
		total += s
	}
	out := make(map[string]Cents, len(params.Shares))
	allocated := Cents(0)
	for _, p := range participants {
		share := Cents(int64(amount) * int64(params.Shares[p]) / int64(total))
		out[p] = share
		allocated += share
	}
	rem := amount - allocated
	if rem != 0 {
		out[participants[0]] += rem
	}
	return out, nil
}

func splitFactory(t SplitType) SplitStrategy {
	switch t {
	case SplitEqual:
		return EqualSplit{}
	case SplitExact:
		return ExactSplit{}
	case SplitPercentage:
		return PercentageSplit{}
	case SplitShare:
		return ShareSplit{}
	}
	return nil
}

func sameKeys(m map[string]Cents, parts []string) bool {
	if len(m) != len(parts) {
		return false
	}
	for _, p := range parts {
		if _, ok := m[p]; !ok {
			return false
		}
	}
	return true
}

func samePctKeys(m map[string]int, parts []string) bool {
	if len(m) != len(parts) {
		return false
	}
	for _, p := range parts {
		if _, ok := m[p]; !ok {
			return false
		}
	}
	return true
}

func sameSharesKeys(m map[string]int, parts []string) bool {
	if len(m) != len(parts) {
		return false
	}
	for _, p := range parts {
		if _, ok := m[p]; !ok {
			return false
		}
	}
	return true
}

// ──────────────────────────────────────────────────────────────────────────
// Service
// ──────────────────────────────────────────────────────────────────────────

type SplitwiseService struct {
	mu         sync.RWMutex
	users      map[string]*User
	groups     map[string]*Group
	friendship map[string]map[string]Cents
	idCounter  atomic.Int64
}

func NewSplitwiseService() *SplitwiseService {
	return &SplitwiseService{
		users:      make(map[string]*User),
		groups:     make(map[string]*Group),
		friendship: make(map[string]map[string]Cents),
	}
}

func (s *SplitwiseService) nextID(prefix string) string {
	return fmt.Sprintf("%s-%d", prefix, s.idCounter.Add(1))
}

func (s *SplitwiseService) AddUser(name, email string) *User {
	s.mu.Lock()
	defer s.mu.Unlock()
	u := &User{ID: s.nextID("u"), Name: name, Email: email}
	s.users[u.ID] = u
	return u
}

func (s *SplitwiseService) CreateGroup(name string, memberIDs []string) (*Group, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, uid := range memberIDs {
		if _, ok := s.users[uid]; !ok {
			return nil, fmt.Errorf("%w: %s", ErrUnknownUser, uid)
		}
	}
	g := newGroup(s.nextID("g"), name)
	for _, uid := range memberIDs {
		g.Members[uid] = struct{}{}
	}
	s.groups[g.ID] = g
	return g, nil
}

type RecordExpenseInput struct {
	Description  string
	PaidBy       string
	Amount       Cents
	Type         SplitType
	Participants []string
	Params       SplitParams
	GroupID      string // empty for friendship
}

func (s *SplitwiseService) RecordExpense(in RecordExpenseInput) (*Expense, error) {
	if in.Amount <= 0 {
		return nil, ErrAmountInvalid
	}
	found := false
	for _, p := range in.Participants {
		if p == in.PaidBy {
			found = true
			break
		}
	}
	if !found {
		return nil, ErrPayerNotInPart
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	for _, uid := range in.Participants {
		if _, ok := s.users[uid]; !ok {
			return nil, fmt.Errorf("%w: %s", ErrUnknownUser, uid)
		}
	}

	strategy := splitFactory(in.Type)
	if strategy == nil {
		return nil, fmt.Errorf("%w: unknown split type", ErrInvalidParams)
	}
	breakdown, err := strategy.Split(in.Amount, in.Participants, in.Params)
	if err != nil {
		return nil, err
	}

	exp := Expense{
		ID:           s.nextID("e"),
		Description:  in.Description,
		PaidBy:       in.PaidBy,
		Amount:       in.Amount,
		Type:         in.Type,
		Participants: append([]string(nil), in.Participants...),
		Breakdown:    breakdown,
		GroupID:      in.GroupID,
	}

	if in.GroupID != "" {
		g, ok := s.groups[in.GroupID]
		if !ok {
			return nil, fmt.Errorf("%w: %s", ErrUnknownGroup, in.GroupID)
		}
		for _, p := range in.Participants {
			if _, ok := g.Members[p]; !ok {
				return nil, fmt.Errorf("%w: participant %s not in group", ErrInvalidParams, p)
			}
		}
		g.Expenses = append(g.Expenses, exp)
		s.applyToGroup(g, exp)
	} else {
		s.applyToFriendship(exp)
	}
	return &exp, nil
}

func (s *SplitwiseService) applyToGroup(g *Group, exp Expense) {
	for p, owed := range exp.Breakdown {
		if p == exp.PaidBy {
			continue
		}
		if g.Pairwise[exp.PaidBy] == nil {
			g.Pairwise[exp.PaidBy] = make(map[string]Cents)
		}
		if g.Pairwise[p] == nil {
			g.Pairwise[p] = make(map[string]Cents)
		}
		g.Pairwise[exp.PaidBy][p] += owed
		g.Pairwise[p][exp.PaidBy] -= owed
		g.Balances[exp.PaidBy] += owed
		g.Balances[p] -= owed
	}
}

func (s *SplitwiseService) applyToFriendship(exp Expense) {
	for p, owed := range exp.Breakdown {
		if p == exp.PaidBy {
			continue
		}
		if s.friendship[exp.PaidBy] == nil {
			s.friendship[exp.PaidBy] = make(map[string]Cents)
		}
		if s.friendship[p] == nil {
			s.friendship[p] = make(map[string]Cents)
		}
		s.friendship[exp.PaidBy][p] += owed
		s.friendship[p][exp.PaidBy] -= owed
	}
}

func (s *SplitwiseService) RecordSettlement(payer, payee string, amount Cents, groupID string) (*Settlement, error) {
	if amount <= 0 {
		return nil, ErrAmountInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	st := &Settlement{
		ID:      s.nextID("s"),
		Payer:   payer,
		Payee:   payee,
		Amount:  amount,
		GroupID: groupID,
	}
	if groupID != "" {
		g, ok := s.groups[groupID]
		if !ok {
			return nil, fmt.Errorf("%w: %s", ErrUnknownGroup, groupID)
		}
		g.Settlements = append(g.Settlements, *st)
		if g.Pairwise[payee] == nil {
			g.Pairwise[payee] = make(map[string]Cents)
		}
		if g.Pairwise[payer] == nil {
			g.Pairwise[payer] = make(map[string]Cents)
		}
		g.Pairwise[payee][payer] -= amount
		g.Pairwise[payer][payee] += amount
		g.Balances[payer] += amount
		g.Balances[payee] -= amount
	} else {
		if s.friendship[payee] == nil {
			s.friendship[payee] = make(map[string]Cents)
		}
		if s.friendship[payer] == nil {
			s.friendship[payer] = make(map[string]Cents)
		}
		s.friendship[payee][payer] -= amount
		s.friendship[payer][payee] += amount
	}
	return st, nil
}

func (s *SplitwiseService) GetGroupBalances(groupID string) (map[string]Cents, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	g, ok := s.groups[groupID]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrUnknownGroup, groupID)
	}
	out := make(map[string]Cents)
	for k, v := range g.Balances {
		if v != 0 {
			out[k] = v
		}
	}
	return out, nil
}

func (s *SplitwiseService) GetUser(id string) (*User, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	u, ok := s.users[id]
	return u, ok
}

// ──────────────────────────────────────────────────────────────────────────
// Debt simplification
// ──────────────────────────────────────────────────────────────────────────

type SettleTxn struct {
	Debtor   string
	Creditor string
	Amount   Cents
}

// Heap of users by absolute balance (we use two heaps: max-heap of creditors, max-heap of debtors).

type userBal struct {
	id  string
	bal Cents // creditors: positive bal; debtors: positive |debt| stored as positive
}

type maxHeap []userBal

func (h maxHeap) Len() int            { return len(h) }
func (h maxHeap) Less(i, j int) bool  { return h[i].bal > h[j].bal } // max-heap on bal
func (h maxHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *maxHeap) Push(x interface{}) { *h = append(*h, x.(userBal)) }
func (h *maxHeap) Pop() interface{}   { old := *h; n := len(old); x := old[n-1]; *h = old[:n-1]; return x }

func (s *SplitwiseService) SimplifyGroup(groupID string) ([]SettleTxn, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	g, ok := s.groups[groupID]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrUnknownGroup, groupID)
	}
	creditors := &maxHeap{}
	debtors := &maxHeap{}
	for uid, bal := range g.Balances {
		switch {
		case bal > 0:
			heap.Push(creditors, userBal{id: uid, bal: bal})
		case bal < 0:
			heap.Push(debtors, userBal{id: uid, bal: -bal})
		}
	}
	var txns []SettleTxn
	for creditors.Len() > 0 && debtors.Len() > 0 {
		c := heap.Pop(creditors).(userBal)
		d := heap.Pop(debtors).(userBal)
		pay := c.bal
		if d.bal < pay {
			pay = d.bal
		}
		if pay > 0 {
			txns = append(txns, SettleTxn{Debtor: d.id, Creditor: c.id, Amount: pay})
		}
		c.bal -= pay
		d.bal -= pay
		if c.bal > 0 {
			heap.Push(creditors, c)
		}
		if d.bal > 0 {
			heap.Push(debtors, d)
		}
	}
	return txns, nil
}

// ──────────────────────────────────────────────────────────────────────────
// Demo
// ──────────────────────────────────────────────────────────────────────────

func main() {
	s := NewSplitwiseService()
	alice := s.AddUser("Alice", "a@x.com")
	bob := s.AddUser("Bob", "b@x.com")
	carol := s.AddUser("Carol", "c@x.com")
	dave := s.AddUser("Dave", "d@x.com")

	g, err := s.CreateGroup("Trip", []string{alice.ID, bob.ID, carol.ID, dave.ID})
	if err != nil {
		panic(err)
	}

	// Hotel $400 equal among all 4
	if _, err := s.RecordExpense(RecordExpenseInput{
		Description: "Hotel", PaidBy: alice.ID, Amount: 40000,
		Type: SplitEqual, Participants: []string{alice.ID, bob.ID, carol.ID, dave.ID},
		GroupID: g.ID,
	}); err != nil {
		panic(err)
	}
	// Dinner $90 exact among Alice/Bob/Carol
	if _, err := s.RecordExpense(RecordExpenseInput{
		Description: "Dinner", PaidBy: bob.ID, Amount: 9000,
		Type: SplitExact, Participants: []string{alice.ID, bob.ID, carol.ID},
		Params:  SplitParams{Exact: map[string]Cents{alice.ID: 3000, bob.ID: 3000, carol.ID: 3000}},
		GroupID: g.ID,
	}); err != nil {
		panic(err)
	}
	// Taxi $60 share split (1, 2, 1, 2)
	if _, err := s.RecordExpense(RecordExpenseInput{
		Description: "Taxi", PaidBy: carol.ID, Amount: 6000,
		Type: SplitShare, Participants: []string{alice.ID, bob.ID, carol.ID, dave.ID},
		Params:  SplitParams{Shares: map[string]int{alice.ID: 1, bob.ID: 2, carol.ID: 1, dave.ID: 2}},
		GroupID: g.ID,
	}); err != nil {
		panic(err)
	}

	balances, _ := s.GetGroupBalances(g.ID)
	fmt.Println("Balances:")
	for uid, bal := range balances {
		u, _ := s.GetUser(uid)
		fmt.Printf("  %-5s: %s\n", u.Name, bal)
	}

	plan, _ := s.SimplifyGroup(g.ID)
	fmt.Println("\nSimplified plan:")
	for _, t := range plan {
		dn, _ := s.GetUser(t.Debtor)
		cn, _ := s.GetUser(t.Creditor)
		fmt.Printf("  %s pays %s: %s\n", dn.Name, cn.Name, t.Amount)
	}

	// Verify the plan settles balances
	bcopy := map[string]Cents{}
	for k, v := range balances {
		bcopy[k] = v
	}
	for _, t := range plan {
		bcopy[t.Debtor] += t.Amount
		bcopy[t.Creditor] -= t.Amount
	}
	for _, v := range bcopy {
		if v != 0 {
			panic(fmt.Sprintf("residual non-zero: %s", v))
		}
	}
	fmt.Println("\nResidual balances after plan: all zero ✓")

	// Concurrency smoke
	fmt.Println("\n--- concurrency: 50 expenses in 50 goroutines ---")
	s2 := NewSplitwiseService()
	users := make([]*User, 5)
	for i := 0; i < 5; i++ {
		users[i] = s2.AddUser(fmt.Sprintf("u%d", i), fmt.Sprintf("u%d@x.com", i))
	}
	uids := []string{users[0].ID, users[1].ID, users[2].ID, users[3].ID, users[4].ID}
	g2, _ := s2.CreateGroup("Concurrent", uids)

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := s2.RecordExpense(RecordExpenseInput{
				Description: fmt.Sprintf("e%d", i),
				PaidBy:      users[i%5].ID,
				Amount:      1000,
				Type:        SplitEqual,
				Participants: uids,
				GroupID:      g2.ID,
			})
			if err != nil {
				panic(err)
			}
		}(i)
	}
	wg.Wait()
	bals, _ := s2.GetGroupBalances(g2.ID)
	var sum Cents
	for _, v := range bals {
		sum += v
	}
	fmt.Printf("Sum of balances: %s (should be $0.00)\n", sum)
	if sum != 0 {
		panic("zero-sum invariant broken")
	}
}
```

### How to run

```bash
go run /path/to/splitwise.go
```

---

## 11. Cross-Questions ("Why X and not Y") — ≥ 12

### 11.1 Why `int64` cents instead of `*big.Rat`?

`int64` cents is the canonical representation in real money systems:
- Compact (8 bytes vs `big.Rat`'s heap-allocated structure).
- No allocations on arithmetic.
- Compares with `==`.
- Trivially serializable to JSON / DB.

`big.Rat` shines when fractional cents matter (e.g. accruing interest at 0.0001%). For Splitwise, integer cents is correct.

Production-grade: a typed `Money` struct with currency tag (`USD`, `EUR`) plus `int64` minor units. We elide the currency tag here.

### 11.2 Why `SplitParams` as one struct with all fields rather than four discriminated types?

Two designs were considered:
1. One struct with optional fields (`Exact`, `Percentage`, `Shares`) — ours.
2. Sum-type via interface: `type SplitParams interface { isSplitParams() }` with concrete `ExactParams`, `PercentageParams`, etc.

Go has no sum types in stdlib. Discriminated unions via interface require type assertions on the consumer side — adds noise.

Single struct keeps the API call simple: one parameter shape, ignored fields. Unused fields cost nothing. Trade-off: caller can pass conflicting fields (`Exact` AND `Percentage`); we ignore the wrong ones based on `Type`. Document this; validate on input.

### 11.3 Why `container/heap` instead of a third-party priority queue?

`container/heap` is in stdlib — zero deps. The interface requires implementing 5 methods (`Len`, `Less`, `Swap`, `Push`, `Pop`) — verbose but explicit.

Third-party heaps (e.g. `github.com/zyedidia/generic/heap`) have cleaner APIs and generic types, but adding a dep for one priority queue isn't worth it. The boilerplate is < 10 lines.

### 11.4 Why a `RWMutex` and not per-group locks?

For the size of system Splitwise targets (millions of users, but each group has ≤ 50 members), a single RWMutex serializes well. Writes are infrequent relative to reads.

Per-group locks would scale better if hot groups dominated the write traffic. The map of locks needs a meta-lock to manage entry/exit — adds complexity. Defer until needed.

### 11.5 Why public `Group.Balances` and `Pairwise` fields?

Go convention: lowercase = package-private, uppercase = exported. We export them so the service (in the same package, but also for interactive demos) can read them. In a more rigorous design, expose via getter methods to maintain encapsulation:
```go
func (g *Group) Balance(userID string) Cents { ... }
```
For an interview/in-memory demo, public fields are fine and reduce code. Real production systems use getters consistently.

### 11.6 Why is `Expense.Breakdown` exported but `SplitwiseService.users` is not?

`Expense` is a domain object returned to callers — they read its fields. Encapsulation isn't useful here because `Expense` is essentially a value type.

`SplitwiseService.users` is internal state mutated only via service methods. Exposing it would let callers bypass the lock — a correctness bug.

The line is "data the caller needs to read" vs "state that must be mediated by methods."

### 11.7 What if `RecordExpense` partially succeeds (e.g. validates, then panics)?

Validation runs before mutation. The actual mutation is straightforward (a few map updates) — unlikely to panic.

For defensive practice: wrap mutations in a deferred recover that rolls back changes. We don't here (interview scope), but flag it as a hardening step.

The single big lock around the operation makes "partial commit" unobservable to other goroutines: the operation is atomic from their perspective.

### 11.8 Why `sync/atomic` for `idCounter` and not just an `int64` under the lock?

Could be either. `atomic.Int64` lets us increment without holding the mutex — a small concurrency win for ID generation (which doesn't need to be ordered with respect to other state).

The downside: IDs may not align with map insertion order under high concurrency. We don't care.

For a real DB, IDs come from the DB sequence anyway; this in-memory approach is for the demo.

### 11.9 Why `SettleTxn` (debt simplification output) is a struct, not a tuple?

Go has no tuples. Returning `[]struct{Debtor, Creditor string; Amount Cents}` is the idiom. Naming the type makes the API clearer.

### 11.10 What if the heap-based simplification produces extra rounding error?

Our split strategies absorb rounding into the first participant. Balances are exact `int64` cents; `+`/`-` is exact. The greedy match always pays `min(creditor, debtor)` in cents — no further rounding. The plan settles to exactly zero (verified in the demo).

If we had non-cent amounts (`big.Rat`), rounding would re-enter at the simplification step. We deliberately keep simplification in cents to avoid this.

### 11.11 Why does `applyToGroup` lazy-init the inner maps?

Go `map[string]map[string]Cents` doesn't auto-init the inner map on `m[k]` — assigning `m[k][k2] = v` panics on nil inner. We check and create on-demand.

Alternative: pre-fill all `member×member` pairs at group creation. Wasteful (most pairs never trade) and brittle as members come and go. Lazy init is cleaner.

### 11.12 Why doesn't `RecordExpense` accept the cents `Amount` as a string?

Type-safety. `Cents` is a named `int64`; passing a `string` here would force parsing inside the service. We push the parsing to the API boundary (e.g. an HTTP handler) where it belongs.

`ParseCents` is provided as a helper for boundary use.

### 11.13 Why is the heap a `*maxHeap` and not a `maxHeap` value?

`container/heap` requires the value to satisfy `heap.Interface`, including `Push` and `Pop` (with pointer receivers — they mutate the slice). The stdlib documents this requirement.

If we forgot the `*`, the code would compile but the heap mutations wouldn't persist (slice value would be a copy). Classic Go gotcha — interview value here is *recognizing it*.

### 11.14 Why doesn't `SimplifyGroup` mutate the group?

It produces a *plan*; the plan isn't a settlement until the user (or their bank) executes it. After execution, they record real `Settlement` rows that mutate balances normally.

Mutating in `SimplifyGroup` would erase the audit trail (no record of actual money movement).

### 11.15 What about generics — could `SplitStrategy` be parameterized over money type?

Yes:
```go
type SplitStrategy[M Number] interface {
    Split(amount M, ...) (map[string]M, error)
}
```
Then a single `EqualSplit[Cents]` would work for any numeric type. We didn't do this because:
- The whole system uses `Cents`. No need for the parameter.
- Generics in interfaces require all consumers to specify the type — complicates the API for no benefit.

When generics earn their keep: containers (caches, heaps with arbitrary value types). For domain logic, concrete types are clearer.

---

## 12. Extensions

(Same as Python; see `LLD/Python/splitwise.md` §12. Implementation differences:)

- **Mutable expenses**: a `replaces` pointer; balances recompute by replaying active expenses. In Go: `Expense` adds `Replaces string`; recomputation is a `func (s *SplitwiseService) recomputeGroup(g *Group)`.
- **Multiple currencies**: a `Currency` field on `Expense`; conversion table looked up at expense time. Balances tracked per (user, currency).
- **Notifications**: a small event bus pattern — `Service.Subscribe(ch chan<- Event)`. Per-event types.
- **Recurring**: external scheduler driving `RecordExpense` periodically.

---

## 13. Cheat-Sheet Recap

1. **Problem:** Split-tracking with multiple split types; debt simplification.
2. **Idioms:** `int64` cents for money, interface for split strategy, error wrapping with `%w`, `RWMutex` for concurrency.
3. **Patterns:** Strategy (split types), Factory (`splitFactory`), Facade (service).
4. **Money math:** Integer cents, no floats anywhere.
5. **Debt simplification:** `container/heap`, greedy creditor/debtor matching, ≤ N-1 transactions.
6. **Concurrency:** `RWMutex` on service; reads use RLock.
7. **Trade-off accepted:** Greedy simplification (not optimal); single global lock (sharding deferred).

---

## Appendix A: How this differs from the Python version

```
Python                          Go
─────────                       ─────
Decimal                         int64 cents
ABCs                            interfaces
heapq (functions)               container/heap (interface methods)
defaultdict                     manual lazy-init
class                           struct + receiver methods
raise X                         return fmt.Errorf("%w", X)
__init__                        NewX function
None                            nil
isinstance                      type assertion or interface
```

## Appendix B: Common Go-specific gotchas

```
- nil map: reading returns zero value; writing panics. Always init inner maps.
- container/heap requires pointer receivers for Push/Pop.
- Don't compare big.Rat with == — use Cmp(). (We use Cents int64; not relevant here.)
- atomic.Int64 (Go 1.19+) preferred over atomic.AddInt64 boilerplate.
- map iteration order is randomized; sort if you need determinism.
- struct copies are deep for value fields, shallow for slices/maps.
- error wrapping with %w preserves errors.Is; %v doesn't.
- testing: use t.Cleanup for teardown, t.Parallel for parallel subtests.
```

## Appendix C: Test patterns

```go
func TestSimplify(t *testing.T) {
    s := NewSplitwiseService()
    a := s.AddUser("a", "a@x.com")
    b := s.AddUser("b", "b@x.com")
    c := s.AddUser("c", "c@x.com")
    g, _ := s.CreateGroup("g", []string{a.ID, b.ID, c.ID})

    s.RecordExpense(RecordExpenseInput{
        PaidBy: a.ID, Amount: 9000, Type: SplitEqual,
        Participants: []string{a.ID, b.ID, c.ID}, GroupID: g.ID,
    })
    // Expected: a is owed 60; b owes 30; c owes 30
    // Simplified plan: 2 transactions (b→a 30, c→a 30)

    plan, _ := s.SimplifyGroup(g.ID)
    if len(plan) != 2 {
        t.Fatalf("want 2 txns, got %d", len(plan))
    }
}
```

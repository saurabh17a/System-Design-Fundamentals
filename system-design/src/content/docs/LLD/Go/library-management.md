# Library Management — LLD (Go)

> **Difficulty:** Medium
> **Tags:** `[lld]` `[state]` `[concurrency]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

A library: books with multiple copies; members check out, return, get fined for late returns. Track who has what.

### Why solve it?

- **Real world**: libraries, equipment rental, lockers.
- **Teaches**: title-vs-copy distinction, state per copy, fine policies.

### Vocabulary

- **Book / BookCopy** — title vs physical instance.
- **Member** — borrower with limits.
- **Loan** — checkout record (copy, member, due, returned).
- **Fine** — late fee.

### High-level approach

Entities: **Book**, **BookCopy** (state: AVAILABLE/CHECKED_OUT/LOST), **Member**, **Loan**, **Library** (orchestrator with mutex), **FineStrategy** interface.

Checkout: find AVAILABLE copy → mark CHECKED_OUT → record Loan.
Return: mark AVAILABLE → if late → fine.

### How to read this doc

- **Beginner**: Book vs BookCopy is the key distinction.
- **Interview**: reservations, multi-branch, recommendations.

---

## 1. Code

```go
package main

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

type CopyStatus int

const (
	StatusAvailable CopyStatus = iota
	StatusCheckedOut
	StatusReserved
	StatusLost
)

var (
	ErrNotAvailable   = errors.New("not available")
	ErrLimitExceeded  = errors.New("limit exceeded")
	ErrUnknown        = errors.New("unknown")
)

type Book struct {
	ISBN, Title, Author string
}

type BookCopy struct {
	ID       string
	Book     *Book
	Status   CopyStatus
	CheckedOutTo string
}

type Member struct {
	ID, Name, Email string
	MaxBooks        int
}

type Cents int64

type Checkout struct {
	CopyID, MemberID string
	CheckedAt, DueAt time.Time
	ReturnedAt       time.Time
	Fine             Cents
}

type Library struct {
	mu sync.Mutex
	books         map[string]*Book
	copies        map[string]*BookCopy
	copiesByBook  map[string][]*BookCopy
	members       map[string]*Member
	checkouts     []Checkout
	activeByMember map[string]map[string]struct{}
	reservations  map[string][]string
	loanDays      int
	finePerDay    Cents
	idCounter     int
}

func NewLibrary() *Library {
	return &Library{
		books: map[string]*Book{}, copies: map[string]*BookCopy{},
		copiesByBook: map[string][]*BookCopy{}, members: map[string]*Member{},
		activeByMember: map[string]map[string]struct{}{},
		reservations:   map[string][]string{},
		loanDays:       14, finePerDay: 50, // 50 cents/day
	}
}

func (l *Library) nextID(p string) string {
	l.idCounter++
	return fmt.Sprintf("%s-%d", p, l.idCounter)
}

func (l *Library) AddBook(b *Book)                   { l.books[b.ISBN] = b }
func (l *Library) AddCopy(isbn string) *BookCopy {
	b := l.books[isbn]
	c := &BookCopy{ID: l.nextID("copy"), Book: b, Status: StatusAvailable}
	l.copies[c.ID] = c
	l.copiesByBook[isbn] = append(l.copiesByBook[isbn], c)
	return c
}
func (l *Library) AddMember(name, email string) *Member {
	m := &Member{ID: l.nextID("mem"), Name: name, Email: email, MaxBooks: 5}
	l.members[m.ID] = m
	return m
}

func (l *Library) Search(query string) []*Book {
	q := strings.ToLower(query)
	var out []*Book
	for _, b := range l.books {
		if strings.Contains(strings.ToLower(b.Title), q) ||
			strings.Contains(strings.ToLower(b.Author), q) ||
			b.ISBN == query {
			out = append(out, b)
		}
	}
	return out
}

func (l *Library) Checkout(memberID, isbn string, now time.Time) (*Checkout, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	m, ok := l.members[memberID]
	if !ok {
		return nil, ErrUnknown
	}
	if len(l.activeByMember[memberID]) >= m.MaxBooks {
		return nil, ErrLimitExceeded
	}
	for _, c := range l.copiesByBook[isbn] {
		if c.Status == StatusAvailable {
			c.Status = StatusCheckedOut
			c.CheckedOutTo = memberID
			co := Checkout{
				CopyID: c.ID, MemberID: memberID,
				CheckedAt: now, DueAt: now.Add(time.Duration(l.loanDays) * 24 * time.Hour),
			}
			l.checkouts = append(l.checkouts, co)
			if l.activeByMember[memberID] == nil {
				l.activeByMember[memberID] = map[string]struct{}{}
			}
			l.activeByMember[memberID][c.ID] = struct{}{}
			return &co, nil
		}
	}
	return nil, ErrNotAvailable
}

func (l *Library) Return(copyID string, now time.Time) (*Checkout, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	c, ok := l.copies[copyID]
	if !ok {
		return nil, ErrUnknown
	}
	if c.Status != StatusCheckedOut {
		return nil, ErrUnknown
	}
	for i := len(l.checkouts) - 1; i >= 0; i-- {
		co := &l.checkouts[i]
		if co.CopyID == copyID && co.ReturnedAt.IsZero() {
			co.ReturnedAt = now
			daysOver := int64(now.Sub(co.DueAt).Hours() / 24)
			if daysOver > 0 {
				co.Fine = Cents(daysOver) * l.finePerDay
			}
			delete(l.activeByMember[co.MemberID], copyID)
			if q := l.reservations[c.Book.ISBN]; len(q) > 0 {
				c.Status = StatusReserved
				l.reservations[c.Book.ISBN] = q[1:]
			} else {
				c.Status = StatusAvailable
				c.CheckedOutTo = ""
			}
			return co, nil
		}
	}
	return nil, ErrUnknown
}

func main() {
	lib := NewLibrary()
	b := &Book{ISBN: "978-0", Title: "The Pragmatic Programmer", Author: "Hunt"}
	lib.AddBook(b)
	lib.AddCopy("978-0"); lib.AddCopy("978-0")
	alice := lib.AddMember("A", "a@x.com")
	bob := lib.AddMember("B", "b@x.com")

	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	co, err := lib.Checkout(alice.ID, "978-0", now)
	if err != nil {
		panic(err)
	}
	rco, err := lib.Return(co.CopyID, now.Add(20*24*time.Hour))
	if err != nil {
		panic(err)
	}
	if rco.Fine != Cents(6*50) { // 6 days × 50¢
		panic(fmt.Sprintf("got %d", rco.Fine))
	}
	fmt.Printf("Fine OK: %d cents\n", rco.Fine)

	// Both copies out
	lib.Checkout(alice.ID, "978-0", now)
	lib.Checkout(bob.ID, "978-0", now)
	if _, err := lib.Checkout(alice.ID, "978-0", now); !errors.Is(err, ErrNotAvailable) {
		panic("expected unavailable")
	}
	fmt.Println("All tests passed.")
}
```

---

## 2. Cheat-Sheet
1. Book + Copy + Member + Checkout.
2. Per-copy state machine.
3. Per-member active set; enforce max.
4. Fine = ceil(days_over) × rate.
5. Reservation queue per ISBN.

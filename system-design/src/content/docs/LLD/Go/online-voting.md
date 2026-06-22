# Online Voting System — LLD (Go)

> **Difficulty:** Medium
> **Tags:** `[lld]` `[security]` `[concurrency]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

An online election. Pre-registered voters cast one vote each, anonymously. System tallies. Anti-fraud: no double-voting. Anonymity: don't store voter identity with the vote.

### Why solve it?

- **Real world**: company polls, school elections.
- **Teaches**: idempotency, hashing for anonymity, atomic vote-and-record.

### Vocabulary

- **Voter / Candidate**.
- **Eligibility set**.
- **Voter hash** — `sha256(salt + electionID + voterID)`. Records that they voted, not who.
- **State** — DRAFT → OPEN → CLOSED.

### High-level approach

Entities: **Election** (state, candidates, eligible voters set, voted-hash set, tally), **Service** (with `sync.Mutex`).

Vote flow under lock:
1. State == OPEN?
2. Voter eligible?
3. Hash already in voted-set? → reject.
4. Add hash; increment tally.

### How to read this doc

- **Beginner**: focus on the voted-set + tally invariants.
- **Interview**: discuss real election trust models, anti-coercion.

---

## 1. Code

```go
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

type State int

const (
	Draft State = iota
	Open
	Closed
)

var (
	ErrAlreadyVoted    = errors.New("already voted")
	ErrNotEligible     = errors.New("not eligible")
	ErrElectionNotOpen = errors.New("election not open")
	ErrInvalidState    = errors.New("invalid state")
)

type Voter struct{ ID, Name string }
type Candidate struct{ ID, Name string }

type Vote struct {
	ID, ElectionID, VoterHash, CandidateID string
	Timestamp                              time.Time
}

type Election struct {
	ID, Name        string
	State           State
	Candidates      map[string]*Candidate
	EligibleVoters  map[string]struct{}
	VotedSet        map[string]struct{}
	Tally           map[string]int
	Votes           []*Vote
}

type Service struct {
	mu        sync.Mutex
	elections map[string]*Election
	salt      string
	idCounter atomic.Int64
}

func NewService(salt string) *Service {
	return &Service{elections: map[string]*Election{}, salt: salt}
}

func (s *Service) hashVoter(electionID, voterID string) string {
	h := sha256.Sum256([]byte(s.salt + ":" + electionID + ":" + voterID))
	return hex.EncodeToString(h[:])
}

func (s *Service) nextID(p string) string {
	return fmt.Sprintf("%s-%d", p, s.idCounter.Add(1))
}

func (s *Service) CreateElection(name string, voters []string) *Election {
	s.mu.Lock()
	defer s.mu.Unlock()
	e := &Election{
		ID: s.nextID("e"), Name: name, State: Draft,
		Candidates: map[string]*Candidate{},
		EligibleVoters: map[string]struct{}{},
		VotedSet: map[string]struct{}{},
		Tally: map[string]int{},
	}
	for _, v := range voters {
		e.EligibleVoters[v] = struct{}{}
	}
	s.elections[e.ID] = e
	return e
}

func (s *Service) AddCandidate(electionID string, c *Candidate) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.elections[electionID]
	if e.State != Draft {
		return ErrInvalidState
	}
	e.Candidates[c.ID] = c
	return nil
}

func (s *Service) Open(electionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.elections[electionID]
	if e.State != Draft || len(e.Candidates) == 0 {
		return ErrInvalidState
	}
	e.State = Open
	return nil
}

func (s *Service) CastVote(electionID, voterID, candidateID string) (*Vote, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.elections[electionID]
	if e.State != Open {
		return nil, ErrElectionNotOpen
	}
	if _, ok := e.EligibleVoters[voterID]; !ok {
		return nil, ErrNotEligible
	}
	if _, ok := e.Candidates[candidateID]; !ok {
		return nil, errors.New("unknown candidate")
	}
	vh := s.hashVoter(electionID, voterID)
	if _, ok := e.VotedSet[vh]; ok {
		return nil, ErrAlreadyVoted
	}
	e.VotedSet[vh] = struct{}{}
	v := &Vote{
		ID: s.nextID("v"), ElectionID: electionID,
		VoterHash: vh, CandidateID: candidateID,
		Timestamp: time.Now(),
	}
	e.Votes = append(e.Votes, v)
	e.Tally[candidateID]++
	return v, nil
}

func (s *Service) Close(electionID string) (map[string]int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.elections[electionID]
	if e.State != Open {
		return nil, ErrInvalidState
	}
	e.State = Closed
	out := make(map[string]int, len(e.Tally))
	for k, v := range e.Tally {
		out[k] = v
	}
	return out, nil
}

func (s *Service) Winner(electionID string) (*Candidate, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.elections[electionID]
	if e.State != Closed {
		return nil, ErrInvalidState
	}
	bestID, bestCount := "", -1
	for cid, c := range e.Tally {
		if c > bestCount {
			bestID = cid
			bestCount = c
		}
	}
	if bestID == "" {
		return nil, nil
	}
	return e.Candidates[bestID], nil
}

// Tests
func main() {
	svc := NewService("salt")
	voters := []string{}
	for i := 0; i < 100; i++ {
		voters = append(voters, fmt.Sprintf("v%d", i))
	}
	e := svc.CreateElection("Pres", voters)
	svc.AddCandidate(e.ID, &Candidate{ID: "A", Name: "Alice"})
	svc.AddCandidate(e.ID, &Candidate{ID: "B", Name: "Bob"})
	if err := svc.Open(e.ID); err != nil {
		panic(err)
	}

	svc.CastVote(e.ID, "v0", "A")
	svc.CastVote(e.ID, "v1", "B")
	svc.CastVote(e.ID, "v2", "A")

	if _, err := svc.CastVote(e.ID, "v0", "B"); !errors.Is(err, ErrAlreadyVoted) {
		panic("double vote not rejected")
	}
	if _, err := svc.CastVote(e.ID, "v999", "A"); !errors.Is(err, ErrNotEligible) {
		panic("ineligible not rejected")
	}

	tally, _ := svc.Close(e.ID)
	if tally["A"] != 2 || tally["B"] != 1 {
		panic(tally)
	}
	w, _ := svc.Winner(e.ID)
	if w.ID != "A" {
		panic("winner")
	}

	// Concurrent voting
	e2 := svc.CreateElection("E2", []string{"u0"})
	svc.AddCandidate(e2.ID, &Candidate{ID: "X", Name: "X"})
	svc.Open(e2.ID)
	var succ atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := svc.CastVote(e2.ID, "u0", "X"); err == nil {
				succ.Add(1)
			}
		}()
	}
	wg.Wait()
	if succ.Load() != 1 {
		panic(fmt.Sprintf("got %d", succ.Load()))
	}
	fmt.Println("All tests passed.")
}
```

---

## 2. Cheat-Sheet
1. State: Draft → Open → Closed.
2. Voter hash for anonymous dedup.
3. Per-election eligible voter set.
4. Single mutex guards atomic vote+dedup.

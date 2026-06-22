# True Caller — LLD (Go)

> **Difficulty:** Medium
> **Tags:** `[lld]` `[lookup]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

Truecaller. Unknown number rings, app shows "Spam" or "Bob from Acme." Data comes from crowd-sourced reports + uploaded contacts.

### Why solve it?

- **Real world**: Truecaller, Hiya.
- **Teaches**: aggregation of votes, privacy, lookup index.

### Vocabulary

- **Number** — normalized E.164.
- **Report** — user claim (name / spam).
- **Spam score** — derived metric.

### High-level approach

Entities: **Number**, **Report** (reporter, target, name, type), **NumberInfo** (name, spam_score), **Service**.

Lookup: O(1) hashmap.
Report: increment counters; recompute name (mode) + spam_score.

Search by name → trie or inverted index.

### How to read this doc

- **Beginner**: focus on report aggregation.
- **Interview**: privacy, spam thresholds, false positives.

---

## 1. Code

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

type SpamLevel int

const (
	Safe SpamLevel = iota
	Suspicious
	Spam
)

func (s SpamLevel) String() string {
	return []string{"SAFE", "SUSPICIOUS", "SPAM"}[s]
}

type Contact struct {
	Number, Name, SourceUserID string
}

type SpamReport struct {
	Number, ReporterID, Reason string
	Timestamp                  time.Time
}

type LookupResult struct {
	Number   string
	Name     string
	Level    SpamLevel
	SpamCount int
	IsBlocked bool
}

type TrueCallerService struct {
	mu        sync.RWMutex
	contacts  map[string][]Contact
	reports   map[string][]SpamReport
	blocks    map[string]map[string]struct{}
}

func NewService() *TrueCallerService {
	return &TrueCallerService{
		contacts: map[string][]Contact{},
		reports:  map[string][]SpamReport{},
		blocks:   map[string]map[string]struct{}{},
	}
}

func (s *TrueCallerService) UploadContacts(userID string, contacts []Contact) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, c := range contacts {
		c.SourceUserID = userID
		s.contacts[c.Number] = append(s.contacts[c.Number], c)
	}
}

func (s *TrueCallerService) ReportSpam(reporterID, number, reason string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reports[number] = append(s.reports[number], SpamReport{
		Number: number, ReporterID: reporterID, Reason: reason, Timestamp: time.Now(),
	})
}

func (s *TrueCallerService) Block(userID, number string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.blocks[userID] == nil {
		s.blocks[userID] = map[string]struct{}{}
	}
	s.blocks[userID][number] = struct{}{}
}

func (s *TrueCallerService) Lookup(number, queryingUserID string) LookupResult {
	s.mu.RLock()
	defer s.mu.RUnlock()
	// Most popular name
	counts := map[string]int{}
	for _, c := range s.contacts[number] {
		counts[c.Name]++
	}
	bestName := ""
	bestCount := 0
	for n, c := range counts {
		if c > bestCount {
			bestName, bestCount = n, c
		}
	}
	spamCount := len(s.reports[number])
	level := Safe
	if spamCount >= 10 {
		level = Spam
	} else if spamCount >= 3 {
		level = Suspicious
	}
	blocked := false
	if queryingUserID != "" {
		if userBlocks, ok := s.blocks[queryingUserID]; ok {
			_, blocked = userBlocks[number]
		}
	}
	return LookupResult{
		Number: number, Name: bestName, Level: level,
		SpamCount: spamCount, IsBlocked: blocked,
	}
}

func main() {
	s := NewService()
	s.UploadContacts("u1", []Contact{
		{Number: "555-PIZZA", Name: "Pizza Place"},
		{Number: "555-MOM", Name: "Mom"},
	})
	s.UploadContacts("u2", []Contact{{Number: "555-PIZZA", Name: "Pizza Hut"}})
	s.UploadContacts("u3", []Contact{{Number: "555-PIZZA", Name: "Pizza Place"}})

	r := s.Lookup("555-PIZZA", "")
	if r.Name != "Pizza Place" {
		panic(r.Name)
	}

	for i := 0; i < 12; i++ {
		s.ReportSpam(fmt.Sprintf("r%d", i), "555-SCAM", "")
	}
	r = s.Lookup("555-SCAM", "")
	if r.Level != Spam {
		panic(r.Level)
	}

	s.Block("u1", "555-SCAM")
	r1 := s.Lookup("555-SCAM", "u1")
	r2 := s.Lookup("555-SCAM", "u2")
	if !r1.IsBlocked || r2.IsBlocked {
		panic("block per user")
	}
	fmt.Println("All tests passed.")
}
```

---

## 2. Cheat-Sheet
1. Crowdsourced contacts → most popular name.
2. Spam reports → threshold-based level.
3. Per-user block list.

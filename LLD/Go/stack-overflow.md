# Stack Overflow — LLD (Go)

> **Difficulty:** Medium
> **Tags:** `[lld]` `[forum]` `[reputation]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

A Q&A site like Stack Overflow. Users post questions and answers, vote on them. Question author can accept one answer. Users earn reputation based on votes.

### Why solve it?

- **Real world**: Quora, Reddit, internal Q&A.
- **Teaches**: vote idempotency (one user one vote), reputation math, role permissions.

### Vocabulary

- **Question / Answer** — posts with similar shape.
- **Vote** — +1 / -1 keyed by (post, user); changing reverses prior effect.
- **Accept** — question author picks an answer; +15 rep to its author.
- **Reputation** — running score per user.

### High-level approach

Entities: **User**, **Question**, **Answer**, **Vote** map keyed by `(postID, userID)`, **StackOverflow** service.

Vote logic: if user already voted, reverse old delta on reputation; apply new delta. Cleanly handles "change your vote." Block self-voting.

### How to read this doc

- **Beginner**: focus on vote → reputation flow.
- **Interview**: search, ranking, tags, badges as extensions.

---

## 1. Code

```go
package main

import (
	"errors"
	"fmt"
	"sync"
	"time"
)

var (
	ErrCannotVoteOwn = errors.New("cannot vote own")
	ErrNotAuthor     = errors.New("not author")
)

type User struct {
	ID, Name string
}

type Question struct {
	ID, AuthorID, Title, Body string
	Tags                      []string
	CreatedAt                 time.Time
	Score                     int
	AcceptedAnswerID          string
}

type Answer struct {
	ID, QuestionID, AuthorID, Body string
	CreatedAt                      time.Time
	Score                          int
}

type StackOverflow struct {
	mu             sync.Mutex
	users          map[string]*User
	questions      map[string]*Question
	answers        map[string]*Answer
	reputation     map[string]int
	votesQ         map[[2]string]int
	votesA         map[[2]string]int
	questionsByTag map[string][]string
	idCount        int
}

func New() *StackOverflow {
	return &StackOverflow{
		users: map[string]*User{}, questions: map[string]*Question{},
		answers: map[string]*Answer{}, reputation: map[string]int{},
		votesQ: map[[2]string]int{}, votesA: map[[2]string]int{},
		questionsByTag: map[string][]string{},
	}
}

func (s *StackOverflow) nextID(p string) string {
	s.idCount++
	return fmt.Sprintf("%s-%d", p, s.idCount)
}

func (s *StackOverflow) AddUser(name string) *User {
	u := &User{ID: s.nextID("u"), Name: name}
	s.users[u.ID] = u
	return u
}

func (s *StackOverflow) PostQuestion(authorID, title, body string, tags []string) *Question {
	q := &Question{ID: s.nextID("q"), AuthorID: authorID, Title: title, Body: body,
		Tags: tags, CreatedAt: time.Now()}
	s.questions[q.ID] = q
	for _, t := range tags {
		s.questionsByTag[t] = append(s.questionsByTag[t], q.ID)
	}
	return q
}

func (s *StackOverflow) PostAnswer(authorID, qID, body string) *Answer {
	a := &Answer{ID: s.nextID("a"), QuestionID: qID, AuthorID: authorID, Body: body,
		CreatedAt: time.Now()}
	s.answers[a.ID] = a
	return a
}

func qRep(v int) int {
	switch v {
	case 1: return 5
	case -1: return -2
	}
	return 0
}

func aRep(v int) int {
	switch v {
	case 1: return 10
	case -1: return -2
	}
	return 0
}

func (s *StackOverflow) VoteQuestion(qID, userID string, value int) error {
	if value < -1 || value > 1 {
		return errors.New("invalid")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	q := s.questions[qID]
	if q.AuthorID == userID {
		return ErrCannotVoteOwn
	}
	key := [2]string{qID, userID}
	old := s.votesQ[key]
	if old == value {
		return nil
	}
	s.votesQ[key] = value
	q.Score += value - old
	s.reputation[q.AuthorID] -= qRep(old)
	s.reputation[q.AuthorID] += qRep(value)
	return nil
}

func (s *StackOverflow) VoteAnswer(aID, userID string, value int) error {
	if value < -1 || value > 1 {
		return errors.New("invalid")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	a := s.answers[aID]
	if a.AuthorID == userID {
		return ErrCannotVoteOwn
	}
	key := [2]string{aID, userID}
	old := s.votesA[key]
	if old == value {
		return nil
	}
	s.votesA[key] = value
	a.Score += value - old
	s.reputation[a.AuthorID] -= aRep(old)
	s.reputation[a.AuthorID] += aRep(value)
	return nil
}

func (s *StackOverflow) AcceptAnswer(qID, aID, byUserID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	q := s.questions[qID]
	if q.AuthorID != byUserID {
		return ErrNotAuthor
	}
	q.AcceptedAnswerID = aID
	a := s.answers[aID]
	s.reputation[a.AuthorID] += 15
	return nil
}

func (s *StackOverflow) Reputation(userID string) int {
	return s.reputation[userID]
}

// Tests
func main() {
	so := New()
	alice := so.AddUser("Alice")
	bob := so.AddUser("Bob")
	carol := so.AddUser("Carol")
	q := so.PostQuestion(alice.ID, "How does X work?", "...", []string{"go"})
	a1 := so.PostAnswer(bob.ID, q.ID, "...")
	a2 := so.PostAnswer(carol.ID, q.ID, "...")

	so.VoteQuestion(q.ID, bob.ID, 1)
	if so.Reputation(alice.ID) != 5 {
		panic(so.Reputation(alice.ID))
	}
	so.VoteAnswer(a1.ID, alice.ID, 1)
	if so.Reputation(bob.ID) != 10 {
		panic(so.Reputation(bob.ID))
	}
	if err := so.VoteQuestion(q.ID, alice.ID, 1); !errors.Is(err, ErrCannotVoteOwn) {
		panic("expected cannot vote own")
	}
	so.VoteAnswer(a1.ID, alice.ID, -1)
	if so.Reputation(bob.ID) != -2 {
		panic(so.Reputation(bob.ID))
	}
	so.AcceptAnswer(q.ID, a2.ID, alice.ID)
	if q.AcceptedAnswerID != a2.ID || so.Reputation(carol.ID) != 15 {
		panic("accept")
	}

	fmt.Println("All tests passed.")
}
```

---

## 2. Cheat-Sheet
1. Question + Answer + vote tables.
2. Vote change reverses old, applies new.
3. Reputation deltas per vote type.
4. Accept answer: question author only; +15 rep.

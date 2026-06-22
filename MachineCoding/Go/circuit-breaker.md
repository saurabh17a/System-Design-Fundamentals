# Circuit Breaker — Machine Coding (Go)

> **Difficulty:** Medium
> **Tags:** `[mc]` `[resilience]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

Hammering a dying service makes it die more. A **circuit breaker** wraps calls and trips open when failures pile up — calls fail fast for a cooldown period. Then it carefully tries again. Like a fuse box, but for software.

### Why solve it?

- **Real world**: every microservice mesh, AWS SDK, gRPC clients.
- **Teaches**: state machines, time-based transitions, defensive design.
- **Interview**: appears with rate limiter + retries as the resilience trio.

### Vocabulary

- **Closed** — normal; calls go through.
- **Open** — tripped; fail fast.
- **Half-Open** — cooldown done; one trial call.
- **Threshold** — failure count that trips.
- **Cooldown** — time the breaker stays open.

### High-level approach

State: one of `{Closed, Open, HalfOpen}`. Counters: failures, lastTripTime.

`Call(fn)`:
- Closed: invoke; on failure, increment failures; trip if threshold.
- Open: if `time.Since(lastTripTime) > cooldown` → HalfOpen; else fail fast.
- HalfOpen: invoke once; success → Closed; failure → Open + reset timer.

`sync.Mutex` to guard state in concurrent code.

### How to read this doc

- **Beginner**: draw the state diagram first.
- **Interview**: discuss sliding window of failures vs simple counter.

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

type State int

const (
	Closed State = iota
	Open
	HalfOpen
)

func (s State) String() string {
	return []string{"closed", "open", "half_open"}[s]
}

var ErrCircuitOpen = errors.New("circuit open")

type CircuitBreaker struct {
	mu                sync.Mutex
	state             State
	failures          []time.Time
	openUntil         time.Time
	halfOpenAttempts  int
	halfOpenSuccesses int
	failThreshold     int
	window            time.Duration
	cooldown          time.Duration
	halfOpenProbes    int
}

func NewCircuitBreaker(failThreshold int, window, cooldown time.Duration, probes int) *CircuitBreaker {
	return &CircuitBreaker{
		state:          Closed,
		failThreshold:  failThreshold,
		window:         window,
		cooldown:       cooldown,
		halfOpenProbes: probes,
	}
}

func (c *CircuitBreaker) Call(fn func() error) error {
	c.mu.Lock()
	c.maybeTransition(time.Now())
	switch c.state {
	case Open:
		c.mu.Unlock()
		return ErrCircuitOpen
	case HalfOpen:
		if c.halfOpenAttempts >= c.halfOpenProbes {
			c.mu.Unlock()
			return ErrCircuitOpen
		}
		c.halfOpenAttempts++
	}
	c.mu.Unlock()

	err := fn()
	c.mu.Lock()
	defer c.mu.Unlock()
	if err != nil {
		c.onFailure(time.Now())
		return err
	}
	c.onSuccess()
	return nil
}

func (c *CircuitBreaker) onSuccess() {
	if c.state == HalfOpen {
		c.halfOpenSuccesses++
		if c.halfOpenSuccesses >= c.halfOpenProbes {
			c.reset()
		}
	}
}

func (c *CircuitBreaker) onFailure(now time.Time) {
	if c.state == HalfOpen {
		c.openCircuit(now)
		return
	}
	c.failures = append(c.failures, now)
	c.evictOld(now)
	if len(c.failures) >= c.failThreshold {
		c.openCircuit(now)
	}
}

func (c *CircuitBreaker) evictOld(now time.Time) {
	cutoff := now.Add(-c.window)
	i := 0
	for ; i < len(c.failures); i++ {
		if c.failures[i].After(cutoff) {
			break
		}
	}
	c.failures = c.failures[i:]
}

func (c *CircuitBreaker) openCircuit(now time.Time) {
	c.state = Open
	c.openUntil = now.Add(c.cooldown)
}

func (c *CircuitBreaker) reset() {
	c.state = Closed
	c.failures = nil
	c.halfOpenAttempts = 0
	c.halfOpenSuccesses = 0
}

func (c *CircuitBreaker) maybeTransition(now time.Time) {
	if c.state == Open && !now.Before(c.openUntil) {
		c.state = HalfOpen
		c.halfOpenAttempts = 0
		c.halfOpenSuccesses = 0
	}
}

func (c *CircuitBreaker) State() State {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.maybeTransition(time.Now())
	return c.state
}

// Tests
func main() {
	cb := NewCircuitBreaker(3, time.Minute, 100*time.Millisecond, 2)

	// Normal
	for i := 0; i < 5; i++ {
		if err := cb.Call(func() error { return nil }); err != nil {
			panic(err)
		}
	}
	if cb.State() != Closed {
		panic("should be closed")
	}

	// Trip
	for i := 0; i < 5; i++ {
		_ = cb.Call(func() error { return errors.New("boom") })
	}
	if cb.State() != Open {
		panic(fmt.Sprintf("expected open, got %s", cb.State()))
	}

	// Open rejects
	if err := cb.Call(func() error { return nil }); !errors.Is(err, ErrCircuitOpen) {
		panic("should reject")
	}

	// Wait for half-open
	time.Sleep(150 * time.Millisecond)
	if cb.State() != HalfOpen {
		panic("should be half-open")
	}

	// Probe success → closed
	cb.Call(func() error { return nil })
	cb.Call(func() error { return nil })
	if cb.State() != Closed {
		panic("should be closed after probe success")
	}

	fmt.Println("All tests passed.")
}
```

---

## 2. Cheat-Sheet
1. State: Closed → Open → HalfOpen.
2. Trip on N fails in window.
3. Open rejects fast; transitions to HalfOpen after cooldown.
4. HalfOpen probes; success closes, failure reopens.

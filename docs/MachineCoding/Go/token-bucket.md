# Token Bucket Rate Limiter — Machine Coding (Go)

> **Difficulty:** Medium
> **Tags:** `[mc]` `[concurrency]` `[rate-limit]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

You run an API. One user is hammering it. You want **at most 10 calls/sec** per user. The **token bucket** trick:
- Each user has a bucket holding up to N tokens.
- Tokens refill at R/sec.
- Each call spends 1 token; empty bucket → reject.

This allows bursts: if a user has been quiet, the bucket fills, and they can spend it all at once.

### Why solve it?

- **Real world**: GitHub/AWS/Stripe rate limits; web protection; Linux `tc` traffic shaping.
- **Teaches**: lazy refill, thread-safe state, fairness vs burst tolerance.
- **Interview**: classic, often paired with "now make it distributed."

### Vocabulary

- **Rate limit** — cap on operations over time.
- **Capacity (burst)** — max tokens.
- **Refill rate** — tokens added per second.
- **Lazy refill** — no background goroutine; on every check, add `elapsed * rate` tokens.

### High-level approach

Per user: `(tokens float64, lastRefill time.Time)`.

**Allow(key)** under a mutex:
1. `elapsed = now - lastRefill`
2. `tokens = min(capacity, tokens + elapsed*rate)`
3. `lastRefill = now`
4. If `tokens >= 1` → subtract 1, return true. Else → false.

The mutex prevents two goroutines from both spending the last token.

### How to read this doc

- **Beginner**: trace the lazy refill math for 3 sequential calls.
- **Interview**: compare to leaky bucket, fixed/sliding window.

---

## 1. Approach

Same as Python: per-key bucket with refill-on-check.

Go-specific: `time.Now()` for monotonic; `sync.Mutex`.

---

## 2. Code

```go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

type bucket struct {
	tokens     float64
	lastRefill time.Time
}

type RateLimiter struct {
	mu       sync.Mutex
	buckets  map[string]*bucket
	capacity float64
	rate     float64 // tokens per second
}

func NewRateLimiter(capacity, rate float64) *RateLimiter {
	return &RateLimiter{
		buckets:  make(map[string]*bucket),
		capacity: capacity,
		rate:     rate,
	}
}

func (r *RateLimiter) Allow(key string, cost float64, now time.Time) bool {
	if cost <= 0 {
		panic("cost must be positive")
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	b, ok := r.buckets[key]
	if !ok {
		b = &bucket{tokens: r.capacity, lastRefill: now}
		r.buckets[key] = b
	}
	elapsed := now.Sub(b.lastRefill).Seconds()
	if elapsed > 0 {
		b.tokens += elapsed * r.rate
		if b.tokens > r.capacity {
			b.tokens = r.capacity
		}
		b.lastRefill = now
	}
	if b.tokens >= cost {
		b.tokens -= cost
		return true
	}
	return false
}

// Tests

func main() {
	basic()
	refill()
	concurrent()
	fmt.Println("All tests passed.")
}

func basic() {
	fmt.Println("--- basic ---")
	rl := NewRateLimiter(5, 1)
	t0 := time.Unix(0, 0)
	for i := 0; i < 5; i++ {
		if !rl.Allow("u", 1, t0) {
			panic("should allow")
		}
	}
	if rl.Allow("u", 1, t0) {
		panic("6th should reject")
	}
	if !rl.Allow("u", 1, t0.Add(time.Second)) {
		panic("after 1 sec should allow")
	}
	fmt.Println("  OK")
}

func refill() {
	fmt.Println("--- refill ---")
	rl := NewRateLimiter(10, 10)
	t0 := time.Unix(0, 0)
	for i := 0; i < 10; i++ {
		rl.Allow("u", 1, t0)
	}
	for i := 0; i < 5; i++ {
		if !rl.Allow("u", 1, t0.Add(500*time.Millisecond)) {
			panic("refill failed")
		}
	}
	if rl.Allow("u", 1, t0.Add(500*time.Millisecond)) {
		panic("over budget")
	}
	fmt.Println("  OK")
}

func concurrent() {
	fmt.Println("--- concurrent ---")
	rl := NewRateLimiter(100, 0)
	var succ atomic.Int64
	var wg sync.WaitGroup
	now := time.Now()
	for i := 0; i < 500; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if rl.Allow("u", 1, now) {
				succ.Add(1)
			}
		}()
	}
	wg.Wait()
	if succ.Load() != 100 {
		panic(fmt.Sprintf("got %d", succ.Load()))
	}
	fmt.Printf("  OK; exactly %d succeeded\n", succ.Load())
}
```

---

## 3. Cheat-Sheet
1. Per-key bucket with `tokens, lastRefill`.
2. On Allow: compute elapsed, refill, deduct.
3. Single `sync.Mutex` for thread safety.
4. `time.Time` from caller for testability.

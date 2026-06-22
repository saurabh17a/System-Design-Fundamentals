# Memoization Wrapper — Machine Coding (Go)

> **Difficulty:** Medium
> **Tags:** `[mc]` `[caching]` `[generics]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

If a function always gives the same answer for the same input, save the result the first time and reuse it after. That's **memoization** — like Post-it notes for expensive computations.

### Why solve it?

- **Real world**: any pure expensive function (recursive, math, idempotent API calls).
- **Teaches**: closures, generics, thread-safe map access.
- **Interview**: tests generics + concurrency together.

### Vocabulary

- **Memoize** — cache results by input.
- **Pure function** — same input → same output, no side effects.
- **Cache key** — hashable input representation.
- **TTL** — time-to-live; how long an entry is valid.

### High-level approach

A generic `Memoize` function takes a function and returns a wrapped version:
1. On call, hash inputs into a map key.
2. Check the map. If present (and not expired), return.
3. Otherwise call the underlying function; store the result.

In Go: `Memoize[K comparable, V any](fn func(K) V) func(K) V`. Optional TTL stored as time + value. `sync.Mutex` (or `sync.RWMutex`) for thread safety.

### How to read this doc

- **Beginner**: focus on the closure that holds the map.
- **Interview**: be ready to add TTL and concurrency control.

---

## 1. Code

```go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

type Memoizer[K comparable, V any] struct {
	mu       sync.Mutex
	cache    map[K]entry[V]
	maxSize  int
	ttl      time.Duration
	fn       func(K) V
	order    []K // simple LRU order
}

type entry[V any] struct {
	value     V
	expiresAt time.Time
}

func NewMemoizer[K comparable, V any](fn func(K) V, maxSize int, ttl time.Duration) *Memoizer[K, V] {
	return &Memoizer[K, V]{
		cache:   make(map[K]entry[V]),
		maxSize: maxSize,
		ttl:     ttl,
		fn:      fn,
	}
}

func (m *Memoizer[K, V]) Get(key K) V {
	now := time.Now()
	m.mu.Lock()
	if e, ok := m.cache[key]; ok {
		if m.ttl == 0 || now.Before(e.expiresAt) {
			m.touchOrder(key)
			m.mu.Unlock()
			return e.value
		}
		delete(m.cache, key)
	}
	m.mu.Unlock()

	value := m.fn(key)
	exp := time.Time{}
	if m.ttl > 0 {
		exp = now.Add(m.ttl)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cache[key] = entry[V]{value: value, expiresAt: exp}
	m.appendOrder(key)
	for len(m.cache) > m.maxSize {
		if len(m.order) == 0 {
			break
		}
		oldest := m.order[0]
		m.order = m.order[1:]
		delete(m.cache, oldest)
	}
	return value
}

func (m *Memoizer[K, V]) touchOrder(key K) {
	for i, k := range m.order {
		if k == key {
			m.order = append(m.order[:i], m.order[i+1:]...)
			break
		}
	}
	m.order = append(m.order, key)
}

func (m *Memoizer[K, V]) appendOrder(key K) {
	m.touchOrder(key)
}

func (m *Memoizer[K, V]) Clear() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cache = make(map[K]entry[V])
	m.order = nil
}

// Tests
func main() {
	var calls atomic.Int64

	fib := func(n int) int {
		// non-memoized recursion
		if n < 2 {
			return n
		}
		// We'll memoize manually below
		return -1
	}
	_ = fib

	// Fibonacci with memoizer
	var memoFib *Memoizer[int, int]
	memoFib = NewMemoizer(func(n int) int {
		calls.Add(1)
		if n < 2 {
			return n
		}
		return memoFib.Get(n-1) + memoFib.Get(n-2)
	}, 100, 0)

	fmt.Println("--- fib ---")
	if v := memoFib.Get(20); v != 6765 {
		panic(v)
	}
	fmt.Printf("  computed %d times for fib(20)\n", calls.Load())

	fmt.Println("--- TTL ---")
	calls.Store(0)
	mem := NewMemoizer(func(x int) int {
		calls.Add(1)
		return x
	}, 10, 100*time.Millisecond)
	mem.Get(1); mem.Get(1)
	if calls.Load() != 1 {
		panic("not cached")
	}
	time.Sleep(150 * time.Millisecond)
	mem.Get(1)
	if calls.Load() != 2 {
		panic("ttl didn't expire")
	}
	fmt.Println("  OK")

	fmt.Println("--- LRU eviction ---")
	mem2 := NewMemoizer(func(x int) int { return x * 2 }, 2, 0)
	mem2.Get(1); mem2.Get(2); mem2.Get(3)
	// 1 should be evicted
	if _, ok := mem2.cache[1]; ok {
		panic("expected eviction")
	}
	fmt.Println("  OK")

	fmt.Println("All tests passed.")
}
```

---

## 2. Cheat-Sheet
1. Generic over K, V.
2. Cache map + LRU order list.
3. TTL via expiresAt timestamp.
4. Mutex for thread safety.

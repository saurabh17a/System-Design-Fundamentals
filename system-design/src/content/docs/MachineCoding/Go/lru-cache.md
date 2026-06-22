# LRU Cache — Machine Coding (Go)

> **Difficulty:** Medium
> **Tags:** `[machine-coding]` `[generics]` `[hashmap]` `[doubly-linked-list]` `[concurrency]`
> **Language:** Go 1.21+
> **Time budget in interview:** 60–90 min
> **Companies that ask this:** Atlassian, Razorpay, Flipkart, Uber, every L4+ MC round

---

## Beginner's Guide

### What's this in plain English?

A cache is a small fast store sitting in front of a big slow one. **LRU** decides what to throw out when the cache fills up: kick out whatever was used least recently. Like a small desk where you keep books you're currently using — if a new one arrives and the desk is full, the dustiest book goes back.

### Why solve it?

- **Real world**: every browser, database, CPU, and CDN uses LRU or a close cousin.
- **Teaches**: combining a `map` with a doubly linked list (`container/list`) to get O(1) on every operation. In Go, also a great chance to use **generics** (1.18+).
- **Interview classic**: the most-asked machine-coding question.

### Vocabulary

- **Cache** — small fast store in front of a big slow one.
- **Capacity** — max items the cache holds.
- **Eviction** — removing an item to free space.
- **Hit / Miss** — Get found the key (hit) or didn't (miss).
- **O(1)** — same time regardless of size (constant time).
- **Doubly linked list** — `container/list` package; lets you remove any node without scanning.
- **`comparable`** — generic constraint allowing `==` (needed for map keys).

### High-level approach

Two data structures cooperating:

1. **Map `K → *list.Element`** — finds any node in O(1).
2. **`container/list.List`** — keeps usage order: front = most recent, back = least recent.

Operations:
- **`Get(key)`**: map lookup. If found, move element to front; return value.
- **`Put(key, val)`**: if exists → update + move front. Otherwise → push to front; if at capacity, drop the back.

The Go version adds: **generics** (`Cache[K, V]`) and **mutex** (`sync.Mutex`) for concurrent safety.

### How to read this doc

- **Beginner / new to Go generics**: focus on sections 1–3.
- **Interview prep**: read everything; concurrency and generics drilling matter.

---

## 0. How to use this doc in an interview

The Python version (separate doc) covers the algorithm thoroughly. **In Go, the interview pivots:**

- **Generics**: Go 1.18+ supports them — use them. Don't write `interface{}`-typed caches; use `Cache[K, V]`.
- **`container/list` is the cheating answer** — Go has a built-in DLL. Show you know it; implement explicitly.
- **`sync.Mutex` over RWMutex** — `Get` mutates recency; reads don't exist as such.
- **Thread safety from day one** — Go's concurrency expectations are higher than Python's.

The bar:
- 25 min: working core (manual DLL + map, generics).
- 15 min: thread safety + tests with `-race`.
- 15 min: variants discussion (LFU/sharded/TTL).

---

## 1. Problem Statement

(Same as Python — fixed-capacity O(1) LRU.)

---

## 2. Clarifying Questions

(Same as Python.) Go-specific:

- [ ] Generics or fixed types?
- [ ] Should `Get` return `(V, bool)` or `*V` for missing?
- [ ] Lock primitive — `sync.Mutex` or sharded?

> **For this doc:** generics, `(V, bool)` return, `sync.Mutex`, sharded variant in §10.

---

## 3. API Contract

```go
type Cache[K comparable, V any] interface {
    Get(key K) (V, bool)
    Put(key K, value V)
    Delete(key K) bool
    Len() int
    Stats() Stats
}
```

| Method | Pre | Post | Time |
|---|---|---|---|
| Get | — | If found, key becomes MRU | O(1) avg |
| Put | — | Inserts or updates; may evict | O(1) avg |
| Delete | — | Removes key if present | O(1) avg |
| Len | — | current size | O(1) |

---

## 4. Approach

Same as Python: hashmap (`map[K]*node[K,V]`) + doubly-linked list with sentinels.

```
                        map[K]*node
                  ┌───────────────────┐
            "a" ──┤ node ptr          │
            "b" ──┤ node ptr          │
                  └───────────────────┘

   head ◀──▶ [a:1] ◀──▶ [b:2] ◀──▶ tail
   (sentinel)                       (sentinel)
```

Invariants: same as Python (5).

---

## 5. Full Working Code

```go
// File: lru.go
// Build: go run lru.go
package main

import (
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
)

// ──────────────────────────────────────────────────────────────────────────
// Generic node + cache
// ──────────────────────────────────────────────────────────────────────────

type node[K comparable, V any] struct {
	key   K
	value V
	prev  *node[K, V]
	next  *node[K, V]
}

type Stats struct {
	Size      int
	Capacity  int
	Hits      int64
	Misses    int64
	Evictions int64
}

type LRU[K comparable, V any] struct {
	cap       int
	m         map[K]*node[K, V]
	head      *node[K, V]
	tail      *node[K, V]
	hits      atomic.Int64
	misses    atomic.Int64
	evictions atomic.Int64
}

func NewLRU[K comparable, V any](capacity int) (*LRU[K, V], error) {
	if capacity <= 0 {
		return nil, errors.New("lru: capacity must be positive")
	}
	c := &LRU[K, V]{
		cap:  capacity,
		m:    make(map[K]*node[K, V], capacity),
		head: new(node[K, V]),
		tail: new(node[K, V]),
	}
	c.head.next = c.tail
	c.tail.prev = c.head
	return c, nil
}

func (c *LRU[K, V]) Get(key K) (V, bool) {
	var zero V
	n, ok := c.m[key]
	if !ok {
		c.misses.Add(1)
		return zero, false
	}
	c.moveToFront(n)
	c.hits.Add(1)
	return n.value, true
}

func (c *LRU[K, V]) Put(key K, value V) {
	if n, ok := c.m[key]; ok {
		n.value = value
		c.moveToFront(n)
		return
	}
	n := &node[K, V]{key: key, value: value}
	c.m[key] = n
	c.addToFront(n)
	if len(c.m) > c.cap {
		c.evictLRU()
	}
}

func (c *LRU[K, V]) Delete(key K) bool {
	n, ok := c.m[key]
	if !ok {
		return false
	}
	delete(c.m, key)
	c.unlink(n)
	return true
}

func (c *LRU[K, V]) Len() int { return len(c.m) }

func (c *LRU[K, V]) Stats() Stats {
	return Stats{
		Size:      len(c.m),
		Capacity:  c.cap,
		Hits:      c.hits.Load(),
		Misses:    c.misses.Load(),
		Evictions: c.evictions.Load(),
	}
}

// ─── private list ops ────────────────────────────────────────────────

func (c *LRU[K, V]) addToFront(n *node[K, V]) {
	nxt := c.head.next
	n.prev = c.head
	n.next = nxt
	c.head.next = n
	nxt.prev = n
}

func (c *LRU[K, V]) unlink(n *node[K, V]) {
	n.prev.next = n.next
	n.next.prev = n.prev
	n.prev = nil
	n.next = nil
}

func (c *LRU[K, V]) moveToFront(n *node[K, V]) {
	c.unlink(n)
	c.addToFront(n)
}

func (c *LRU[K, V]) evictLRU() {
	lru := c.tail.prev
	if lru == c.head {
		return
	}
	c.unlink(lru)
	delete(c.m, lru.key)
	c.evictions.Add(1)
}

// ──────────────────────────────────────────────────────────────────────────
// Thread-safe wrapper
// ──────────────────────────────────────────────────────────────────────────

type SafeLRU[K comparable, V any] struct {
	mu    sync.Mutex
	inner *LRU[K, V]
}

func NewSafeLRU[K comparable, V any](capacity int) (*SafeLRU[K, V], error) {
	inner, err := NewLRU[K, V](capacity)
	if err != nil {
		return nil, err
	}
	return &SafeLRU[K, V]{inner: inner}, nil
}

func (c *SafeLRU[K, V]) Get(key K) (V, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.inner.Get(key)
}

func (c *SafeLRU[K, V]) Put(key K, value V) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.inner.Put(key, value)
}

func (c *SafeLRU[K, V]) Delete(key K) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.inner.Delete(key)
}

func (c *SafeLRU[K, V]) Len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.inner.Len()
}

func (c *SafeLRU[K, V]) Stats() Stats {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.inner.Stats()
}

// ──────────────────────────────────────────────────────────────────────────
// Sharded LRU — for high concurrency
// ──────────────────────────────────────────────────────────────────────────

type ShardedLRU[V any] struct {
	shards []*SafeLRU[string, V] // string key for simple FNV hash
}

func NewShardedLRU[V any](capacity, numShards int) (*ShardedLRU[V], error) {
	if numShards <= 0 || capacity <= 0 {
		return nil, errors.New("invalid args")
	}
	per := capacity / numShards
	if per < 1 {
		per = 1
	}
	out := &ShardedLRU[V]{shards: make([]*SafeLRU[string, V], numShards)}
	for i := 0; i < numShards; i++ {
		s, err := NewSafeLRU[string, V](per)
		if err != nil {
			return nil, err
		}
		out.shards[i] = s
	}
	return out, nil
}

func (c *ShardedLRU[V]) shardOf(key string) *SafeLRU[string, V] {
	h := uint64(14695981039346656037) // FNV-1a basis
	for i := 0; i < len(key); i++ {
		h ^= uint64(key[i])
		h *= 1099511628211
	}
	return c.shards[h%uint64(len(c.shards))]
}

func (c *ShardedLRU[V]) Get(key string) (V, bool) { return c.shardOf(key).Get(key) }
func (c *ShardedLRU[V]) Put(key string, v V)      { c.shardOf(key).Put(key, v) }
func (c *ShardedLRU[V]) Delete(key string) bool   { return c.shardOf(key).Delete(key) }

// ──────────────────────────────────────────────────────────────────────────
// Tests / demo
// ──────────────────────────────────────────────────────────────────────────

func main() {
	basicTest()
	evictionOrderTest()
	concurrentStress()
	shardedTest()
	zeroCapTest()
	fmt.Println("\nAll tests passed.")
}

func mustOK[T any](v T, err error) T {
	if err != nil {
		panic(err)
	}
	return v
}

func basicTest() {
	fmt.Println("--- basic ---")
	c := mustOK(NewLRU[string, int](3))
	if _, ok := c.Get("a"); ok {
		panic("expected miss")
	}
	c.Put("a", 1)
	c.Put("b", 2)
	c.Put("c", 3)
	if c.Len() != 3 {
		panic("len should be 3")
	}
	if v, ok := c.Get("a"); !ok || v != 1 {
		panic("a should be 1")
	}
	c.Put("d", 4) // evicts b (LRU)
	if _, ok := c.Get("b"); ok {
		panic("b should be evicted")
	}
	if v, _ := c.Get("c"); v != 3 {
		panic("c=3")
	}
	if v, _ := c.Get("d"); v != 4 {
		panic("d=4")
	}
	c.Put("a", 100)
	if v, _ := c.Get("a"); v != 100 {
		panic("a=100")
	}
	if !c.Delete("a") {
		panic("delete should succeed")
	}
	if c.Delete("a") {
		panic("second delete should fail")
	}
	s := c.Stats()
	fmt.Printf("  stats: %+v\n", s)
	if s.Evictions != 1 {
		panic("evictions=1")
	}
}

func evictionOrderTest() {
	fmt.Println("--- eviction order ---")
	c := mustOK(NewLRU[string, int](3))
	c.Put("a", 1)
	c.Put("b", 2)
	c.Put("c", 3)
	c.Get("a") // a→MRU; LRU=b
	c.Put("d", 4) // evicts b
	if _, ok := c.Get("b"); ok {
		panic("b should be gone")
	}
	if _, ok := c.Get("a"); !ok {
		panic("a should still be there")
	}
	fmt.Println("  OK")
}

func concurrentStress() {
	fmt.Println("--- concurrent stress (10 goroutines × 1000 ops) ---")
	c := mustOK(NewSafeLRU[int, int](100))
	var wg sync.WaitGroup
	corrupt := atomic.Int64{}
	for t := 0; t < 10; t++ {
		wg.Add(1)
		go func(t int) {
			defer wg.Done()
			for i := 0; i < 1000; i++ {
				k := (t*1000 + i) % 200
				c.Put(k, k*10)
				if v, ok := c.Get(k); ok && v != k*10 {
					corrupt.Add(1)
				}
			}
		}(t)
	}
	wg.Wait()
	if corrupt.Load() != 0 {
		panic(fmt.Sprintf("corruption: %d", corrupt.Load()))
	}
	s := c.Stats()
	fmt.Printf("  stats: %+v\n", s)
	if s.Size != 100 {
		panic("size should be at capacity")
	}
}

func shardedTest() {
	fmt.Println("--- sharded ---")
	c := mustOK(NewShardedLRU[int](128, 16))
	for i := 0; i < 1000; i++ {
		c.Put(fmt.Sprintf("k%d", i), i)
	}
	hit := 0
	for i := 0; i < 1000; i++ {
		if v, ok := c.Get(fmt.Sprintf("k%d", i)); ok && v == i {
			hit++
		}
	}
	fmt.Printf("  put 1000 / get 1000; hits=%d (expect ~128 — capacity)\n", hit)
	if hit < 100 || hit > 200 {
		// rough sanity; eviction depends on hash distribution
		fmt.Printf("  WARN: hit count outside expected range\n")
	}
}

func zeroCapTest() {
	fmt.Println("--- zero-cap rejected ---")
	if _, err := NewLRU[int, int](0); err == nil {
		panic("expected error")
	}
	fmt.Println("  OK")
}
```

### How to run

```bash
go run /path/to/lru.go
go test -race ./...   # if you've split into a package with tests
```

---

## 6. Walkthrough Trace

(Same as Python — see `MachineCoding/Python/lru-cache.md` §6.)

---

## 7. Complexity Analysis

| Operation | Time | Notes |
|---|---|---|
| Get | O(1) avg | map lookup + 2 pointer rewires |
| Put | O(1) avg | insert + possible evict |
| Delete | O(1) avg | |
| Len/Stats | O(1) | |

**Memory:** O(N). Each node ~64 bytes (4 pointers + interface boxing for V if not concrete).

**Concurrency:** Single mutex ~50–100 ns per op. Sharded variant = N-way parallelism.

---

## 8. Tests (Edge Cases)

(Same as Python; see Python doc §8.)

`go test -race` should catch any data race in the SafeLRU under stress.

---

## 9. Cross-Questions ("Why X and not Y") — ≥ 10

### 9.1 Why generics and not `interface{}` keys/values?

Generics keep type info at compile time. With `interface{}`:
- Every value is boxed (heap allocation).
- Every read requires a type assertion (`v.(int)`) — runtime cost + loss of compile-time safety.
- Type errors surface only at runtime.

Generics: zero-cost type abstraction. The cache is concrete `LRU[string, int]` after compile.

### 9.2 Why not `container/list` from stdlib?

`container/list` has a working DLL — `lst.MoveToFront(elem)` exists. You'd save ~20 lines of code.

But:
- It uses `interface{}` for the value, defeating generics' purpose.
- Element is a separate allocation; we'd still need the map.
- Implementing teaches the data structure — that's the question.

For production code, use a generic library like `golang.org/x/exp/list` or roll your own with generics.

### 9.3 Why pointer receivers on cache methods?

The cache mutates internal state (map, list pointers). Value receiver would copy the cache struct — every method call copies the whole map header. Pointer receiver: O(1) call cost.

Consistency: once any method has a pointer receiver, all methods should.

### 9.4 Why not `sync.RWMutex`?

`Get` mutates recency. RWMutex with `RLock` for `Get` would race — multiple readers concurrently rewiring pointers = corruption. With `Lock` for `Get` (which we'd need), RWMutex offers no benefit over `Mutex`.

### 9.5 Why a SafeLRU wrapper instead of locking inside LRU?

Two reasons:
1. **Single-threaded users** don't pay the lock cost. Many use cases: cold-path config caches, per-request memoization.
2. **Decorator pattern**: TTL wrapper, observability wrapper, metrics wrapper — each is one composition, not a configuration knob.

Pay-for-what-you-use.

### 9.6 Why `atomic.Int64` for stats and not under the mutex?

Stats reads should be lock-free if possible. `atomic.Int64.Load/Add` is ~5 ns; taking the lock just to read a counter is ~50 ns + contention.

Stats writes happen during Get/Put — already under the lock if we used SafeLRU. The atomic op there is redundant but cheap. For the unlocked LRU, atomic is still useful if multiple goroutines somehow shared the un-safe variant (they shouldn't).

### 9.7 Why use FNV-1a in the sharded LRU instead of `hash/maphash`?

FNV-1a is small, well-known, deterministic across runs. `hash/maphash` is great for stdlib map but uses random seeds — non-deterministic across runs (intentional for DoS protection but harder to test).

For an interview, FNV is the simpler answer. In production, `xxhash` is faster and just as good.

### 9.8 Why does `evictLRU` check for `head` (empty)?

Defensive: if called on an empty cache, `tail.prev == head`. Without the check, we'd unlink the head sentinel — corruption.

In our `Put` flow this never happens (we check `len(m) > cap` only after insert). But making the function robust on its own is worth the one-line guard.

### 9.9 What if the key space is very large and the map's amortized growth dominates?

Pre-size the map: `make(map[K]*node[K, V], capacity)`. We do this. Avoids re-hashing as the cache fills.

### 9.10 What about Go's `sync.Map`?

`sync.Map` is for read-mostly workloads with disjoint keys per goroutine. It's NOT a general-purpose concurrent map. For LRU, the access pattern is read-and-update-recency for *every* operation — `sync.Map` is wrong.

`sync.Map` shines when: many goroutines write disjoint keys (rare per-key contention), or when iterating concurrently with writes. Neither fits LRU.

### 9.11 Could I use channels for serialization instead of a mutex?

Yes:
```go
type cmd struct { op int; key K; value V; resp chan response }
go func() {
    for c := range cmds { handle(c) }
}()
```
Pros: actor model, no mutex.
Cons: every op is a channel send (~50 ns) + a roundtrip via `resp` chan.

Mutex is faster for short critical sections. Channels shine for I/O-bound work.

### 9.12 What's the memory overhead per entry?

Per node: ~48 bytes (pointer + value + 2 link pointers; depends on V). Map bucket: ~16 bytes amortized. Total per cached entry: ~80 bytes minimum, more if K/V are large.

For 1M entries: ~80 MB. Sharded: same, distributed.

---

## 10. Variants

(Same as Python; see Python doc §10.)

Go-specific: the **sharded** variant is straightforward thanks to generics. Production caches like `Ristretto` and `BigCache` use sharded + TinyLFU.

---

## 11. Cheat-Sheet Recap

1. **Problem:** Generic, O(1), thread-safe LRU.
2. **Idioms:** Generics, pointer receivers, `sync.Mutex`, atomic counters for stats.
3. **Patterns:** SafeLRU wraps LRU (decorator); ShardedLRU composes SafeLRUs.
4. **Concurrency:** Single mutex; sharded for N-way parallelism.
5. **Trade-off:** RWMutex ruled out (Get mutates).
6. **Stdlib alternative:** `container/list` works but doesn't compose with generics.

---

## Appendix A: Idiomatic notes (Go)

```
- Generics on map keys: K comparable. On values: any.
- Pointer receivers throughout for mutating types.
- sync.Mutex value, not pointer (embed in struct).
- atomic.Int64 (Go 1.19+) preferred over manual AddInt64.
- Pre-size map with make(map[K]V, capacity) to avoid rehash growth.
- container/list works but breaks generics; roll your own DLL.
- go test -race catches data races; run before merge.
```

## Appendix B: Common Go gotchas

```
- nil map: read returns zero value; write panics. Always init.
- map iteration order is randomized; don't rely.
- For-range copies the value; use index for mutation.
- Don't share Mutex by value; embed or pass pointer.
- Closure capturing loop variable — fixed in Go 1.22+; before, capture explicitly.
- defer runs LIFO; multiple defers stack.
- channel send on full buffered chan blocks (no select default).
```

## Appendix C: How this differs from the Python version

```
Python                          Go
─────────                       ─────
Generic[K, V]                   [K comparable, V any]
threading.Lock                  sync.Mutex
None for missing                (zero, false) tuple
@dataclass __slots__            struct (always lean)
ABC                             interface
del map[k]                      delete(map, k)
heapq                           container/heap
isinstance(x, T)                _, ok := x.(T)
```

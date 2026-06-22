# Read-Write Lock — Machine Coding (Go)

> **Difficulty:** Medium
> **Tags:** `[mc]` `[concurrency]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

A regular `Mutex` allows ONE goroutine in at a time, even if everyone wants to read. But many readers can safely read simultaneously — they don't conflict. A **read-write lock**:
- Many **readers** at once.
- One **writer** with no readers present.

For read-heavy workloads (caches, configs), this is much faster.

### Why solve it?

- **Real world**: Go's `sync.RWMutex`, Java's `ReentrantReadWriteLock`.
- **Teaches**: fairness, writer starvation, signaling.
- **Interview**: tests deeper concurrency thinking.

### Vocabulary

- **Reader / Writer** — many concurrent readers OR one writer (mutually exclusive).
- **Reader-prefer / Writer-prefer** — who gets priority when both are waiting.
- **Starvation** — writer waits forever as new readers keep arriving (in reader-prefer); avoidable.

### High-level approach

State: `readers int`, `writer bool`, `writersWaiting int`. A `sync.Cond`.

`RLock()`: while writer || writersWaiting > 0 → wait. readers++.
`RUnlock()`: readers--; if 0, signal a writer.
`Lock()`: writersWaiting++. while writer || readers > 0 → wait. writersWaiting--; writer = true.
`Unlock()`: writer = false. Broadcast.

### How to read this doc

- **Beginner**: stdlib's `sync.RWMutex` is the production answer. We're learning it from inside.
- **Interview**: be ready to discuss starvation and how writer-prefer fixes it.

---

## 1. Note

Go's stdlib has `sync.RWMutex` — production answer. We build one to demonstrate writer-prefer semantics.

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

type RWLock struct {
	mu             sync.Mutex
	cond           *sync.Cond
	readers        int
	writerActive   bool
	writersWaiting int
}

func NewRWLock() *RWLock {
	r := &RWLock{}
	r.cond = sync.NewCond(&r.mu)
	return r
}

func (r *RWLock) AcquireRead() {
	r.mu.Lock()
	defer r.mu.Unlock()
	for r.writerActive || r.writersWaiting > 0 {
		r.cond.Wait()
	}
	r.readers++
}

func (r *RWLock) ReleaseRead() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.readers--
	if r.readers == 0 {
		r.cond.Broadcast()
	}
}

func (r *RWLock) AcquireWrite() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.writersWaiting++
	for r.writerActive || r.readers > 0 {
		r.cond.Wait()
	}
	r.writersWaiting--
	r.writerActive = true
}

func (r *RWLock) ReleaseWrite() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.writerActive = false
	r.cond.Broadcast()
}

// Tests
func main() {
	rw := NewRWLock()

	fmt.Println("--- many readers ---")
	var maxConcurrent atomic.Int32
	var current atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			rw.AcquireRead()
			cur := current.Add(1)
			if cur > maxConcurrent.Load() {
				maxConcurrent.Store(cur)
			}
			time.Sleep(50 * time.Millisecond)
			current.Add(-1)
			rw.ReleaseRead()
		}()
	}
	wg.Wait()
	if maxConcurrent.Load() < 2 {
		panic("should have multiple concurrent readers")
	}
	fmt.Printf("  max=%d\n", maxConcurrent.Load())

	fmt.Println("--- writer exclusive ---")
	rw2 := NewRWLock()
	var events []string
	var evMu sync.Mutex

	var wg2 sync.WaitGroup
	wg2.Add(2)
	go func() {
		defer wg2.Done()
		rw2.AcquireWrite()
		evMu.Lock(); events = append(events, "W_in"); evMu.Unlock()
		time.Sleep(50 * time.Millisecond)
		evMu.Lock(); events = append(events, "W_out"); evMu.Unlock()
		rw2.ReleaseWrite()
	}()
	go func() {
		defer wg2.Done()
		time.Sleep(10 * time.Millisecond)
		rw2.AcquireRead()
		evMu.Lock(); events = append(events, "R"); evMu.Unlock()
		rw2.ReleaseRead()
	}()
	wg2.Wait()

	// Writer should finish before reader
	wOutIdx, rIdx := -1, -1
	for i, e := range events {
		if e == "W_out" {
			wOutIdx = i
		}
		if e == "R" {
			rIdx = i
		}
	}
	if wOutIdx > rIdx {
		panic(fmt.Sprintf("writer should precede reader: %v", events))
	}
	fmt.Printf("  events=%v\n", events)
	fmt.Println("All tests passed.")
}
```

---

## 3. Cross-Questions

### 3.1 vs sync.RWMutex?
Stdlib's RWMutex is the production answer. Has reader-prefer with starvation prevention.

### 3.2 Why writer-prefer in our impl?
Common requirement: writes shouldn't be starved by sustained reads.

### 3.3 sync.Cond in Go?
Less common than channels. For producer-consumer, channels preferred. For RWLock, Cond is natural.

---

## 4. Cheat-Sheet
1. Counters: readers, writersWaiting, writerActive.
2. Cond.Broadcast on release.
3. Reader blocks on writerActive OR writersWaiting > 0.
4. Writer blocks on writerActive OR readers > 0.

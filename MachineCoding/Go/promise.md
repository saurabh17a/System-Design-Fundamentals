# Promise / Future from Scratch — Machine Coding (Go)

> **Difficulty:** Medium
> **Tags:** `[mc]` `[concurrency]` `[generics]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

You start a slow operation. Instead of blocking, you get a **promise**: a placeholder that says "the result will be here later." You can wait on it, or attach handlers.

In Go this is usually a **channel** (`make(chan T, 1)`). But for parity with JS-style code, we also build a `Promise[T]` with `Then`, `All`, etc.

### Why solve it?

- **Real world**: async APIs in many languages; foundational for futures, async/await, and reactive code.
- **Teaches**: how channels and goroutines compose into higher-level abstractions; generics for type-safe results.
- **Interview**: tests building primitives idiomatically.

### Vocabulary

- **Future / Promise** — placeholder for a future value.
- **Resolve / Reject** — settle with success / error.
- **Channel-as-future** — `done := make(chan T, 1)` — write once, read once.
- **`sync.WaitGroup`** — coordinate "wait for many."

### High-level approach

In Go, the idiomatic primitive is a buffered channel:
```go
done := make(chan int, 1)
go func() { done <- compute() }()
result := <-done    // waits
```

For an explicit `Promise[T]` API:
- Internal: `result T`, `err error`, `done chan struct{}`, `mu sync.Mutex`.
- `resolve(v)` / `reject(err)`: set fields, close done.
- `Get()`: receive from done, then read fields.
- `Then(fn)`: spawn a goroutine that waits then calls fn; return a new Promise.
- `All(p1, p2, ...)`: spawn N goroutines, gather all into a slice.

### How to read this doc

- **Beginner**: try the channel-as-future first; understand why Go often doesn't need an explicit Promise type.
- **Interview**: `Then`/`All` show generic + concurrency mastery.

---

## 0. Note on Go idioms

In Go, the **idiomatic answer is a channel**: `done := make(chan T, 1)`. We can also build a `Promise` type for API parity with JS-style.

---

## 1. Code

```go
package main

import (
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

type state int32

const (
	pending state = iota
	resolved
	rejected
)

type Promise[T any] struct {
	mu     sync.Mutex
	state  atomic.Int32
	value  T
	err    error
	done   chan struct{}
	cbs    []func(T, error)
}

func NewPromise[T any](executor func(resolve func(T), reject func(error))) *Promise[T] {
	p := &Promise[T]{done: make(chan struct{})}
	if executor != nil {
		go func() {
			defer func() {
				if r := recover(); r != nil {
					p.reject(fmt.Errorf("panic: %v", r))
				}
			}()
			executor(p.resolve, p.reject)
		}()
	}
	return p
}

func Resolved[T any](v T) *Promise[T] {
	p := &Promise[T]{done: make(chan struct{})}
	p.resolve(v)
	return p
}

func Rejected[T any](err error) *Promise[T] {
	p := &Promise[T]{done: make(chan struct{})}
	p.reject(err)
	return p
}

func (p *Promise[T]) resolve(v T) {
	p.mu.Lock()
	if !p.state.CompareAndSwap(int32(pending), int32(resolved)) {
		p.mu.Unlock()
		return
	}
	p.value = v
	cbs := p.cbs
	p.cbs = nil
	close(p.done)
	p.mu.Unlock()
	for _, cb := range cbs {
		cb(v, nil)
	}
}

func (p *Promise[T]) reject(err error) {
	p.mu.Lock()
	if !p.state.CompareAndSwap(int32(pending), int32(rejected)) {
		p.mu.Unlock()
		return
	}
	p.err = err
	cbs := p.cbs
	p.cbs = nil
	close(p.done)
	p.mu.Unlock()
	var zero T
	for _, cb := range cbs {
		cb(zero, err)
	}
}

func (p *Promise[T]) Result(timeout time.Duration) (T, error) {
	var zero T
	if timeout == 0 {
		<-p.done
	} else {
		select {
		case <-p.done:
		case <-time.After(timeout):
			return zero, errors.New("timeout")
		}
	}
	if state(p.state.Load()) == rejected {
		return zero, p.err
	}
	return p.value, nil
}

// Then transforms with on_ok; returns new Promise.
// (Simplified: only handles single transformation, not Promise→Promise unwrapping.)
func Then[T, U any](p *Promise[T], onOK func(T) U) *Promise[U] {
	next := &Promise[U]{done: make(chan struct{})}
	p.mu.Lock()
	if state(p.state.Load()) == pending {
		p.cbs = append(p.cbs, func(v T, err error) {
			if err != nil {
				next.reject(err)
				return
			}
			next.resolve(onOK(v))
		})
		p.mu.Unlock()
	} else {
		p.mu.Unlock()
		if state(p.state.Load()) == resolved {
			next.resolve(onOK(p.value))
		} else {
			next.reject(p.err)
		}
	}
	return next
}

// All waits for all promises to resolve; first error rejects.
func All[T any](ps []*Promise[T]) *Promise[[]T] {
	agg := &Promise[[]T]{done: make(chan struct{})}
	if len(ps) == 0 {
		agg.resolve([]T{})
		return agg
	}
	results := make([]T, len(ps))
	var doneCount atomic.Int32
	var rejected atomic.Bool
	for i, p := range ps {
		i, p := i, p
		go func() {
			v, err := p.Result(0)
			if err != nil {
				if rejected.CompareAndSwap(false, true) {
					agg.reject(err)
				}
				return
			}
			if rejected.Load() {
				return
			}
			results[i] = v
			if doneCount.Add(1) == int32(len(ps)) {
				agg.resolve(results)
			}
		}()
	}
	return agg
}

// Tests

func main() {
	basic()
	executor()
	thenTest()
	allTest()
	timeoutTest()
	fmt.Println("All tests passed.")
}

func basic() {
	fmt.Println("--- basic ---")
	p := Resolved(42)
	v, _ := p.Result(0)
	if v != 42 {
		panic(v)
	}
	fmt.Println("  OK")
}

func executor() {
	fmt.Println("--- executor ---")
	p := NewPromise[string](func(resolve func(string), reject func(error)) {
		time.Sleep(50 * time.Millisecond)
		resolve("done")
	})
	v, _ := p.Result(time.Second)
	if v != "done" {
		panic(v)
	}
	fmt.Println("  OK")
}

func thenTest() {
	fmt.Println("--- then chain ---")
	p := Resolved(10)
	q := Then(p, func(x int) int { return x * 2 })
	r := Then(q, func(x int) int { return x + 1 })
	v, _ := r.Result(0)
	if v != 21 {
		panic(v)
	}
	fmt.Println("  OK")
}

func allTest() {
	fmt.Println("--- all ---")
	p1 := Resolved(1)
	p2 := Resolved(2)
	p3 := Resolved(3)
	res, err := All([]*Promise[int]{p1, p2, p3}).Result(time.Second)
	if err != nil || len(res) != 3 || res[0] != 1 || res[1] != 2 || res[2] != 3 {
		panic(fmt.Sprintf("%v %v", res, err))
	}
	fmt.Println("  OK")
}

func timeoutTest() {
	fmt.Println("--- timeout ---")
	p := &Promise[int]{done: make(chan struct{})} // never resolved
	_, err := p.Result(50 * time.Millisecond)
	if err == nil {
		panic("expected timeout")
	}
	fmt.Println("  OK")
}
```

---

## 2. Cross-Questions

### 2.1 Why Then is a free function, not method?
Go generics don't allow methods to introduce new type parameters. `Then[T, U any]` can; method `(p *Promise[T]) Then[U](...)` cannot.

### 2.2 Why channel for `done`?
- Standard Go signal.
- Blocks readers; close fires all waiters.
- `select` integrates with timeout.

### 2.3 Compared to Python?
- Same primitives; different idioms.
- Go has channels which simplify part of this.

---

## 3. Cheat-Sheet
1. State via `atomic.Int32`.
2. `done chan struct{}` close = signal.
3. Callbacks list (simulating "then").
4. `Then[T,U]` as free function (generics constraint).
5. `All` via goroutine per promise + atomic done-count.

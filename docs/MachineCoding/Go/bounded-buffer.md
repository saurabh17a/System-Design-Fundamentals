# Bounded Buffer / Producer-Consumer — Machine Coding (Go)

> **Difficulty:** Medium
> **Tags:** `[mc]` `[concurrency]` `[channels]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

A small assembly line. Producers at the front put items on a conveyor belt; consumers at the back pick them off. Belt has limited capacity. Full → producers wait. Empty → consumers wait.

In Go, **a buffered channel is literally this** — it's built into the language. We compare both: idiomatic channel-based and the classic mutex+condition-variable approach.

### Why solve it?

- **Real world**: worker pools, log batchers, IO pipelines.
- **Teaches**: how Go's channels embody this pattern; what condition variables actually do.
- **Interview**: tests Go-idiom awareness AND classical concurrency knowledge.

### Vocabulary

- **Producer / Consumer** — goroutines that send / receive.
- **Buffered channel** — `make(chan T, N)` — N capacity; sender blocks when full, receiver blocks when empty.
- **`sync.Cond`** — a condition variable; `Wait`, `Signal`, `Broadcast`.

### High-level approach

**Idiomatic Go**:
```go
ch := make(chan int, capacity)
ch <- item       // producer (blocks if full)
v := <-ch        // consumer (blocks if empty)
```
That's it. The runtime handles all the synchronization.

**Manual version (educational)**: a slice, a `sync.Mutex`, two `sync.Cond`s (`notFull`, `notEmpty`). Same pattern as Python's condition variable approach. Valuable to write once to understand what the channel is doing internally.

### How to read this doc

- **Beginner**: see how channels just work; appreciate why Go's design eliminates so much boilerplate.
- **Interview**: be able to write the manual version too — interviewers test fundamentals.

---

## 1. Approach

In Go, the **idiomatic answer is a buffered channel**. A buffered channel IS a bounded buffer with built-in:
- `put` = `ch <- item` (blocks if full).
- `get` = `<-ch` (blocks if empty).
- close(ch) propagates EOF to receivers.

We can show both: trivial channel-based + explicit cond-var-based for educational comparison.

---

## 2. Code

```go
package main

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"
)

// Approach 1: idiomatic — buffered channel.
// Direct usage:  ch := make(chan T, capacity)

// Approach 2: explicit Lock + Cond (mirrors Python doc).

type BoundedBuffer[T any] struct {
	queue    []T
	capacity int
	mu       sync.Mutex
	notFull  *sync.Cond
	notEmpty *sync.Cond
	closed   bool
}

func NewBoundedBuffer[T any](capacity int) *BoundedBuffer[T] {
	b := &BoundedBuffer[T]{capacity: capacity}
	b.notFull = sync.NewCond(&b.mu)
	b.notEmpty = sync.NewCond(&b.mu)
	return b
}

var ErrClosed = errors.New("buffer closed")

func (b *BoundedBuffer[T]) Put(ctx context.Context, item T) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	for len(b.queue) >= b.capacity && !b.closed {
		// Cond doesn't support context; use a timer goroutine
		// For simplicity: rely on Wait + outside cancel, accept that we don't honor ctx mid-wait
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		b.notFull.Wait()
	}
	if b.closed {
		return ErrClosed
	}
	b.queue = append(b.queue, item)
	b.notEmpty.Signal()
	return nil
}

func (b *BoundedBuffer[T]) Get(ctx context.Context) (T, error) {
	var zero T
	b.mu.Lock()
	defer b.mu.Unlock()
	for len(b.queue) == 0 && !b.closed {
		select {
		case <-ctx.Done():
			return zero, ctx.Err()
		default:
		}
		b.notEmpty.Wait()
	}
	if len(b.queue) == 0 && b.closed {
		return zero, ErrClosed
	}
	item := b.queue[0]
	b.queue = b.queue[1:]
	b.notFull.Signal()
	return item, nil
}

func (b *BoundedBuffer[T]) Close() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.closed = true
	b.notEmpty.Broadcast()
	b.notFull.Broadcast()
}

func (b *BoundedBuffer[T]) Len() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.queue)
}

// Tests

func main() {
	channelVersion()
	explicitVersion()
	concurrent()
	fmt.Println("All tests passed.")
}

func channelVersion() {
	fmt.Println("--- channel (idiomatic) ---")
	ch := make(chan int, 3)
	ch <- 1; ch <- 2; ch <- 3
	if len(ch) != 3 {
		panic("len")
	}
	v := <-ch
	if v != 1 {
		panic("get")
	}
	close(ch)
	fmt.Println("  OK")
}

func explicitVersion() {
	fmt.Println("--- explicit cond ---")
	b := NewBoundedBuffer[int](3)
	for i := 1; i <= 3; i++ {
		_ = b.Put(context.Background(), i)
	}
	v, _ := b.Get(context.Background())
	if v != 1 {
		panic("get")
	}
	b.Close()
	fmt.Println("  OK")
}

func concurrent() {
	fmt.Println("--- concurrent ---")
	b := NewBoundedBuffer[int](10)
	const N = 1000
	var wg sync.WaitGroup
	consumed := make([]int, 0, N)
	var consumedMu sync.Mutex

	// 4 producers
	for p := 0; p < 4; p++ {
		p := p
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := p * 250; i < (p+1)*250; i++ {
				_ = b.Put(context.Background(), i)
			}
		}()
	}

	// 4 consumers
	consumerDone := make(chan struct{})
	var consumerWg sync.WaitGroup
	for c := 0; c < 4; c++ {
		consumerWg.Add(1)
		go func() {
			defer consumerWg.Done()
			for {
				v, err := b.Get(context.Background())
				if err != nil {
					return
				}
				consumedMu.Lock()
				consumed = append(consumed, v)
				done := len(consumed) == N
				consumedMu.Unlock()
				if done {
					close(consumerDone)
					return
				}
			}
		}()
	}

	wg.Wait()
	<-consumerDone
	b.Close()
	consumerWg.Wait()

	if len(consumed) != N {
		panic(fmt.Sprintf("consumed=%d want %d", len(consumed), N))
	}
	sort.Ints(consumed)
	for i := 0; i < N; i++ {
		if consumed[i] != i {
			panic("missing")
		}
	}
	fmt.Printf("  OK; %d items consumed\n", N)
}
```

---

## 3. Cross-Questions

### 3.1 Why use a buffered channel instead of explicit Cond?
Idiomatic Go. Built-in. Less code. `close` propagates correctly.

### 3.2 When would you write the explicit version?
When channel semantics don't fit (e.g. priority ordering, complex predicate on get).

### 3.3 Cond doesn't support context.Done?
Correct — Cond predates Context. Workaround: timer goroutine that broadcasts on cancel.

### 3.4 Channel close semantics?
- Sender: panic if you send on closed; reader gets `(zero, false)` after drain.
- One-way close: sender's responsibility.

---

## 4. Cheat-Sheet
1. **First answer**: buffered channel.
2. **Explicit version**: queue + Lock + 2 Conds (notFull, notEmpty).
3. While-loop on wait.
4. Close broadcasts.

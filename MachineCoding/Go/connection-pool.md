# Connection Pool — Machine Coding (Go)

> **Difficulty:** Medium
> **Tags:** `[mc]` `[concurrency]` `[channels]` `[context]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

Opening a DB connection takes ~10-100ms. Doing that per request kills throughput. A **connection pool** keeps N connections alive and lends them out — borrowers return them when done.

### Why solve it?

- **Real world**: `database/sql` has a built-in pool; HTTP clients pool TCP; this pattern repeats for any limited resource.
- **Teaches**: bounded resource management, timeouts, validation, lifecycle.
- **Interview**: classic Go pattern — buffered channel as the pool.

### Vocabulary

- **Pool** — fixed set of reusable resources.
- **Acquire / Release** — borrow / return.
- **Timeout / context cancellation** — bound the wait.

### High-level approach

State: a buffered channel `chan *Conn` of available connections + a counter for in-use.

**Acquire(ctx)**:
- Try to receive from the channel (`select` with `ctx.Done`).
- If empty AND in-use < max → create one, increment counter, return.
- If ctx cancelled → return error.

**Release(c)**:
- Validate (close if dead, replace).
- Send back to the channel.

`select` with `<-ctx.Done()` is the idiomatic timeout primitive in Go.

### How to read this doc

- **Beginner**: see how a buffered channel naturally is a thread-safe queue.
- **Interview**: be ready to discuss leaks, dead conns, idle timeouts.

---

## 1. Approach

Buffered channel of available conns + counter for in-use.

Channel size = max_size for the available bucket; counter ensures we don't exceed max.

Context for timeout.

---

## 2. Code

```go
package main

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

var (
	ErrPoolClosed     = errors.New("pool closed")
	ErrAcquireTimeout = errors.New("acquire timeout")
)

type Pool[T any] struct {
	available chan T
	factory   func() T
	closer    func(T)
	validator func(T) bool

	maxSize   int32
	inUse     atomic.Int32
	closed    atomic.Bool
	mu        sync.Mutex
}

func NewPool[T any](factory func() T, closer func(T), validator func(T) bool, maxSize int) *Pool[T] {
	if validator == nil {
		validator = func(T) bool { return true }
	}
	return &Pool[T]{
		available: make(chan T, maxSize),
		factory:   factory,
		closer:    closer,
		validator: validator,
		maxSize:   int32(maxSize),
	}
}

func (p *Pool[T]) Acquire(ctx context.Context) (T, error) {
	var zero T
	for {
		if p.closed.Load() {
			return zero, ErrPoolClosed
		}
		// Try non-blocking get from available
		select {
		case conn := <-p.available:
			if p.validator(conn) {
				p.inUse.Add(1)
				return conn, nil
			}
			// invalid conn; close it and loop to try again
			p.closer(conn)
			continue
		default:
		}
		// Try to create new
		p.mu.Lock()
		if p.inUse.Load() < p.maxSize {
			p.inUse.Add(1)
			p.mu.Unlock()
			return p.factory(), nil
		}
		p.mu.Unlock()

		// Wait on available or context
		select {
		case conn := <-p.available:
			if p.validator(conn) {
				p.inUse.Add(1)
				return conn, nil
			}
			p.closer(conn)
		case <-ctx.Done():
			return zero, ErrAcquireTimeout
		}
	}
}

func (p *Pool[T]) Release(conn T) {
	if p.closed.Load() {
		p.closer(conn)
		p.inUse.Add(-1)
		return
	}
	select {
	case p.available <- conn:
		p.inUse.Add(-1)
	default:
		// channel full (shouldn't happen if accounting is right)
		p.closer(conn)
		p.inUse.Add(-1)
	}
}

func (p *Pool[T]) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.closed.CompareAndSwap(false, true) {
		return
	}
	close(p.available)
	for conn := range p.available {
		p.closer(conn)
	}
}

// Tests

type FakeConn struct {
	ID int
}

func main() {
	basic()
	concurrent()
	timeout()
	fmt.Println("All tests passed.")
}

var nextConnID atomic.Int32

func newFakeConn() *FakeConn {
	return &FakeConn{ID: int(nextConnID.Add(1))}
}

func basic() {
	fmt.Println("--- basic ---")
	pool := NewPool(newFakeConn, func(*FakeConn) {}, nil, 2)
	c1, _ := pool.Acquire(context.Background())
	c2, _ := pool.Acquire(context.Background())
	if c1 == c2 {
		panic("same conn")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if _, err := pool.Acquire(ctx); !errors.Is(err, ErrAcquireTimeout) {
		panic("expected timeout")
	}

	pool.Release(c1)
	c3, _ := pool.Acquire(context.Background())
	if c3.ID != c1.ID {
		panic("not reused")
	}
	pool.Close()
	fmt.Println("  OK")
}

func concurrent() {
	fmt.Println("--- concurrent ---")
	pool := NewPool(newFakeConn, func(*FakeConn) {}, nil, 5)
	var wg sync.WaitGroup
	usedMu := sync.Mutex{}
	used := make(map[int]bool)
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c, err := pool.Acquire(context.Background())
			if err != nil {
				panic(err)
			}
			usedMu.Lock()
			used[c.ID] = true
			usedMu.Unlock()
			time.Sleep(10 * time.Millisecond)
			pool.Release(c)
		}()
	}
	wg.Wait()
	if len(used) > 5 {
		panic(fmt.Sprintf("expected ≤5 conns, got %d", len(used)))
	}
	fmt.Printf("  OK; %d distinct conns\n", len(used))
	pool.Close()
}

func timeout() {
	fmt.Println("--- timeout ---")
	pool := NewPool(newFakeConn, func(*FakeConn) {}, nil, 1)
	c1, _ := pool.Acquire(context.Background())
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	_, err := pool.Acquire(ctx)
	if !errors.Is(err, ErrAcquireTimeout) {
		panic("expected timeout")
	}
	pool.Release(c1)
	pool.Close()
	fmt.Println("  OK")
}
```

---

## 3. Cheat-Sheet
1. Buffered channel for available conns.
2. Counter for in-use.
3. Acquire: try chan; create if room; wait on chan or context.
4. Release: send back to chan.
5. Close: set flag; drain chan.

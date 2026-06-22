# Worker Pool (Thread Pool) — Machine Coding (Go)

> **Difficulty:** Medium → Hard
> **Tags:** `[machine-coding]` `[concurrency]` `[goroutines]` `[channels]` `[graceful-shutdown]`
> **Language:** Go 1.21+
> **Time budget in interview:** 60–90 min
> **Companies that ask this:** Atlassian, Razorpay, Microsoft, Stripe, Uber

---

## Beginner's Guide

### What's this in plain English?

Spinning up a fresh goroutine per request is fine — they're cheap. But if you want **bounded** concurrency (e.g., "no more than 50 concurrent DB calls"), you need a **worker pool**: N long-lived goroutines pulling jobs off a shared channel. Tasks come in; workers process; on shutdown, finish in-flight work and exit.

### Why solve it?

- **Real world**: backend job processors, API rate-limited operations, batch processing.
- **Teaches**: idiomatic Go concurrency — channels, `sync.WaitGroup`, context cancellation, graceful shutdown.
- **Interview**: tests goroutine + channel + context proficiency together.

### Vocabulary

- **Worker** — a goroutine in the pool.
- **Job channel** — the shared `chan Job`.
- **`sync.WaitGroup`** — waits for goroutines to finish.
- **`context.Context`** — propagates cancellation.
- **Graceful shutdown** — close the job channel; workers see EOF; main waits.
- **Panic recovery** — `defer recover()` so one bad job doesn't kill a worker.

### High-level approach

```
Submit(j) → [jobs chan] → [worker 1] → result chan
                          [worker 2]
                          [worker N]
```

1. `make(chan Job, queueSize)` — buffered for some backpressure tolerance.
2. Spawn N workers: each `for j := range jobs { run(j) }`.
3. `Submit(j)`: select on `jobs <- j` and `<-ctx.Done()` for timeout.
4. `Shutdown()`: close(jobs); wg.Wait().

Each worker should `defer recover()` so a panicking job doesn't take it down.

### How to read this doc

- **Beginner**: focus on the channel-as-queue + worker loop pattern.
- **Interview**: graceful vs hard shutdown, panic recovery, and tracking results are the high-value sections.

---

## 0. How to use this doc in an interview

The Python version (separate doc) covers the producer-consumer model with `queue.Queue`. **In Go, the conversation pivots dramatically:**

- **Goroutines + channels are the primitives.** No `threading.Thread`. A worker is `go workerLoop()`.
- **Shutdown is via `context.Context`** — not a sentinel. `<-ctx.Done()` is the universal signal.
- **No `Future` type** — Go uses channels (per-task `chan result`) or callbacks. We build a `Future`-like type for the API symmetry, but there's no stdlib equivalent (unlike Python's `concurrent.futures.Future`).
- **`errgroup` and `sync.WaitGroup`** are the high-level helpers; show you know them but build the pool primitive ourselves.

Watch for: defaulting to "channel for everything" without realizing channels have semantics (closed, full, nil) that need handling. Same for context: `ctx.Err()` ≠ `<-ctx.Done()`; know the difference.

The bar:
- 25 min: workers + tasks chan + ctx-driven shutdown.
- 15 min: Future-like result handling.
- 15 min: graceful drain vs cancel-pending.
- 15 min: tests with `-race`, panics, backpressure.

---

## 1. Problem Statement

Build a `WorkerPool` with N goroutines servicing a buffered tasks channel. Submit returns a Future-like object for retrieving results or errors. Support graceful shutdown (drain) and immediate shutdown (cancel pending).

### Constraints
- N goroutines (configurable).
- Bounded task channel (configurable; full → submit blocks or rejects).
- Future returned by Submit; `Result()` blocks until done.
- Worker panics don't crash the pool (recovered, surfaced as task error).
- Context cancellation cancels pending tasks.

---

## 2. Clarifying Questions

(Same as Python.) Go-specific:

- [ ] Use `context.Context` for cancellation (universal Go pattern), or own done channel?
- [ ] Buffered channel for tasks (chan capacity), or unbuffered (synchronous handoff)?
- [ ] Future API or just `chan Result` per task (more idiomatic Go)?
- [ ] `errgroup` (stdlib-like) or roll our own?

> **For this doc:** `context.Context` for shutdown, buffered chan for backpressure, custom Future-like type for API parity, in-process pool.

---

## 3. API Contract

```go
type Result[T any] struct {
    Value T
    Err   error
}

type Future[T any] interface {
    Result(ctx context.Context) (T, error)
    Cancel() bool
    Done() bool
}

type Pool[T any] struct { ... }

func New[T any](ctx context.Context, numWorkers, queueSize int) *Pool[T]
func (p *Pool[T]) Submit(fn func(context.Context) (T, error)) (Future[T], error)
func (p *Pool[T]) Shutdown(wait bool, cancelPending bool)
func (p *Pool[T]) Stats() Stats
```

| Method | Pre | Post | Time |
|---|---|---|---|
| Submit | not shutdown | task queued, returns Future | O(1) avg, blocks on full chan |
| Shutdown(wait=true) | — | no new submits; existing tasks complete | blocks until done |
| Shutdown(cancel=true) | — | pending cancelled; running completes | quick |
| Future.Result | — | blocks until done; returns value or err | O(1) once done |

---

## 4. Approach

```
                ┌──────────────────────────┐
   Submit ─────▶│   tasks chan (buffered)  │
                └────┬───┬───┬──────────────┘
                     │   │   │
                     ▼   ▼   ▼
                ┌─────┐┌─────┐┌─────┐
                │ W1  ││ W2  ││ Wn  │  goroutines
                └─────┘└─────┘└─────┘
                each:
                  for {
                    select {
                    case t := <-tasks:
                       run t with recover; set future
                    case <-ctx.Done():
                       return
                    }
                  }
```

### Invariants
1. After `Shutdown(wait=true)` returns: all submitted tasks have a result (value, error, or cancelled).
2. After `Shutdown(cancel=true)`: pending tasks return CancelledError; running ones complete.
3. Submit on shut-down pool returns ErrPoolClosed.
4. Worker panics don't kill workers; surface as task error.

---

## 5. Full Working Code

```go
// File: pool.go
// Build: go run pool.go
package main

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
)

// ──────────────────────────────────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────────────────────────────────

var (
	ErrPoolClosed   = errors.New("pool: closed")
	ErrTaskCanceled = errors.New("pool: task canceled")
)

// ──────────────────────────────────────────────────────────────────────────
// Future
// ──────────────────────────────────────────────────────────────────────────

type futureState int32

const (
	statePending futureState = iota
	stateRunning
	stateCancelled
	stateFinished
)

type future[T any] struct {
	mu     sync.Mutex
	state  atomic.Int32
	value  T
	err    error
	done   chan struct{}
}

func newFuture[T any]() *future[T] {
	return &future[T]{done: make(chan struct{})}
}

func (f *future[T]) Result(ctx context.Context) (T, error) {
	var zero T
	select {
	case <-f.done:
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.err != nil {
			return zero, f.err
		}
		return f.value, nil
	case <-ctx.Done():
		return zero, ctx.Err()
	}
}

func (f *future[T]) Cancel() bool {
	if !f.state.CompareAndSwap(int32(statePending), int32(stateCancelled)) {
		return false
	}
	f.mu.Lock()
	f.err = ErrTaskCanceled
	f.mu.Unlock()
	close(f.done)
	return true
}

func (f *future[T]) Done() bool {
	select {
	case <-f.done:
		return true
	default:
		return false
	}
}

func (f *future[T]) markRunningOrCheckCancel() bool {
	return f.state.CompareAndSwap(int32(statePending), int32(stateRunning))
}

func (f *future[T]) setResult(v T) {
	f.mu.Lock()
	if f.state.Load() == int32(stateCancelled) {
		f.mu.Unlock()
		return
	}
	f.value = v
	f.state.Store(int32(stateFinished))
	f.mu.Unlock()
	close(f.done)
}

func (f *future[T]) setError(err error) {
	f.mu.Lock()
	if f.state.Load() == int32(stateCancelled) {
		f.mu.Unlock()
		return
	}
	f.err = err
	f.state.Store(int32(stateFinished))
	f.mu.Unlock()
	close(f.done)
}

// ──────────────────────────────────────────────────────────────────────────
// Pool
// ──────────────────────────────────────────────────────────────────────────

type taskItem[T any] struct {
	fn  func(context.Context) (T, error)
	fut *future[T]
}

type Stats struct {
	Submitted uint64
	Completed uint64
	Cancelled uint64
	Failed    uint64
	Workers   int
	Queued    int
	ShutDown  bool
}

type Pool[T any] struct {
	ctx    context.Context
	cancel context.CancelFunc
	tasks  chan taskItem[T]
	wg     sync.WaitGroup

	closed atomic.Bool

	submitted atomic.Uint64
	completed atomic.Uint64
	cancelled atomic.Uint64
	failed    atomic.Uint64
	workers   int
}

func New[T any](parentCtx context.Context, numWorkers, queueSize int) *Pool[T] {
	if numWorkers <= 0 {
		numWorkers = runtime.NumCPU()
	}
	if queueSize <= 0 {
		queueSize = 1024
	}
	ctx, cancel := context.WithCancel(parentCtx)
	p := &Pool[T]{
		ctx:     ctx,
		cancel:  cancel,
		tasks:   make(chan taskItem[T], queueSize),
		workers: numWorkers,
	}
	for i := 0; i < numWorkers; i++ {
		p.wg.Add(1)
		go p.workerLoop(i)
	}
	return p
}

func (p *Pool[T]) Submit(fn func(context.Context) (T, error)) (Future[T], error) {
	if p.closed.Load() {
		return nil, ErrPoolClosed
	}
	fut := newFuture[T]()
	t := taskItem[T]{fn: fn, fut: fut}
	select {
	case p.tasks <- t:
		p.submitted.Add(1)
		return fut, nil
	case <-p.ctx.Done():
		return nil, ErrPoolClosed
	}
}

func (p *Pool[T]) Shutdown(wait, cancelPending bool) {
	if !p.closed.CompareAndSwap(false, true) {
		return
	}
	if cancelPending {
		// drain pending tasks, cancel them
	drain:
		for {
			select {
			case t := <-p.tasks:
				if t.fut.Cancel() {
					p.cancelled.Add(1)
				}
			default:
				break drain
			}
		}
	}
	close(p.tasks) // signals workers no more tasks
	if wait {
		p.wg.Wait()
	}
	p.cancel()
}

func (p *Pool[T]) Stats() Stats {
	return Stats{
		Submitted: p.submitted.Load(),
		Completed: p.completed.Load(),
		Cancelled: p.cancelled.Load(),
		Failed:    p.failed.Load(),
		Workers:   p.workers,
		Queued:    len(p.tasks),
		ShutDown:  p.closed.Load(),
	}
}

func (p *Pool[T]) workerLoop(_ int) {
	defer p.wg.Done()
	for {
		select {
		case t, ok := <-p.tasks:
			if !ok {
				return // channel closed → shutdown
			}
			p.runTask(t)
		case <-p.ctx.Done():
			// drain channel, cancelling on the way out so callers don't block on Result
			for t := range p.tasks {
				if t.fut.Cancel() {
					p.cancelled.Add(1)
				}
			}
			return
		}
	}
}

func (p *Pool[T]) runTask(t taskItem[T]) {
	if !t.fut.markRunningOrCheckCancel() {
		// already cancelled
		return
	}
	defer func() {
		if r := recover(); r != nil {
			err := fmt.Errorf("panic recovered: %v", r)
			t.fut.setError(err)
			p.failed.Add(1)
		}
	}()
	val, err := t.fn(p.ctx)
	if err != nil {
		t.fut.setError(err)
		p.failed.Add(1)
	} else {
		t.fut.setResult(val)
		p.completed.Add(1)
	}
}

// ──────────────────────────────────────────────────────────────────────────
// Type-erased Future surface
// ──────────────────────────────────────────────────────────────────────────

type Future[T any] interface {
	Result(ctx context.Context) (T, error)
	Cancel() bool
	Done() bool
}

// ──────────────────────────────────────────────────────────────────────────
// Tests / demo
// ──────────────────────────────────────────────────────────────────────────

func main() {
	basicTest()
	errorTest()
	cancelTest()
	gracefulShutdown()
	cancelPendingShutdown()
	submitAfterShutdown()
	panicRecovery()
	concurrentBurst()
	fmt.Println("\nAll tests passed.")
}

func basicTest() {
	fmt.Println("--- basic ---")
	p := New[int](context.Background(), 4, 64)
	defer p.Shutdown(true, false)
	f1, _ := p.Submit(func(ctx context.Context) (int, error) { return 41 + 1, nil })
	f2, _ := p.Submit(func(ctx context.Context) (int, error) { return 6 * 7, nil })
	if v, err := f1.Result(context.Background()); err != nil || v != 42 {
		panic("f1")
	}
	if v, err := f2.Result(context.Background()); err != nil || v != 42 {
		panic("f2")
	}
	fmt.Println("  OK")
}

func errorTest() {
	fmt.Println("--- error captured ---")
	p := New[int](context.Background(), 2, 16)
	defer p.Shutdown(true, false)
	f, _ := p.Submit(func(ctx context.Context) (int, error) { return 0, errors.New("nope") })
	_, err := f.Result(context.Background())
	if err == nil || err.Error() != "nope" {
		panic("expected nope")
	}
	// pool still alive
	f2, _ := p.Submit(func(ctx context.Context) (int, error) { return 1, nil })
	v, _ := f2.Result(context.Background())
	if v != 1 {
		panic("pool should still work")
	}
	fmt.Println("  OK")
}

func cancelTest() {
	fmt.Println("--- cancel pending ---")
	p := New[string](context.Background(), 1, 16)
	defer p.Shutdown(true, false)

	started := make(chan struct{})
	finish := make(chan struct{})
	f1, _ := p.Submit(func(ctx context.Context) (string, error) {
		close(started)
		<-finish
		return "slow done", nil
	})
	<-started
	f2, _ := p.Submit(func(ctx context.Context) (string, error) { return "f2", nil })
	f3, _ := p.Submit(func(ctx context.Context) (string, error) { return "f3", nil })
	if !f2.Cancel() {
		panic("f2 should cancel")
	}
	close(finish)
	if v, _ := f1.Result(context.Background()); v != "slow done" {
		panic("f1 result")
	}
	if _, err := f2.Result(context.Background()); !errors.Is(err, ErrTaskCanceled) {
		panic("f2 should be cancelled")
	}
	if v, _ := f3.Result(context.Background()); v != "f3" {
		panic("f3 should run")
	}
	fmt.Println("  OK")
}

func gracefulShutdown() {
	fmt.Println("--- graceful drain ---")
	p := New[int](context.Background(), 2, 100)
	var futures []Future[int]
	for i := 0; i < 20; i++ {
		i := i
		f, _ := p.Submit(func(ctx context.Context) (int, error) { return i * 2, nil })
		futures = append(futures, f)
	}
	p.Shutdown(true, false) // drain
	for i, f := range futures {
		v, err := f.Result(context.Background())
		if err != nil {
			panic(fmt.Sprintf("task %d errored: %v", i, err))
		}
		if v != i*2 {
			panic(fmt.Sprintf("task %d wrong: got %d", i, v))
		}
	}
	fmt.Printf("  stats: %+v\n", p.Stats())
}

func cancelPendingShutdown() {
	fmt.Println("--- cancel-pending shutdown ---")
	p := New[string](context.Background(), 1, 16)
	started := make(chan struct{})
	finish := make(chan struct{})
	f1, _ := p.Submit(func(ctx context.Context) (string, error) {
		close(started)
		<-finish
		return "x", nil
	})
	<-started
	var futs []Future[string]
	for i := 0; i < 5; i++ {
		f, _ := p.Submit(func(ctx context.Context) (string, error) { return "y", nil })
		futs = append(futs, f)
	}
	go func() {
		p.Shutdown(true, true) // cancel pending
	}()
	close(finish)
	if v, _ := f1.Result(context.Background()); v != "x" {
		panic("f1 should still complete")
	}
	cancelled := 0
	for _, f := range futs {
		if _, err := f.Result(context.Background()); errors.Is(err, ErrTaskCanceled) {
			cancelled++
		}
	}
	fmt.Printf("  cancelled: %d/5\n", cancelled)
	if cancelled < 4 {
		panic("expected most to cancel")
	}
}

func submitAfterShutdown() {
	fmt.Println("--- submit after shutdown ---")
	p := New[int](context.Background(), 1, 4)
	p.Shutdown(true, false)
	if _, err := p.Submit(func(ctx context.Context) (int, error) { return 1, nil }); err == nil {
		panic("expected ErrPoolClosed")
	}
	fmt.Println("  OK")
}

func panicRecovery() {
	fmt.Println("--- panic recovery ---")
	p := New[int](context.Background(), 2, 16)
	defer p.Shutdown(true, false)
	f, _ := p.Submit(func(ctx context.Context) (int, error) {
		panic("kaboom")
	})
	_, err := f.Result(context.Background())
	if err == nil {
		panic("expected error from panic")
	}
	// pool still alive
	f2, _ := p.Submit(func(ctx context.Context) (int, error) { return 1, nil })
	if v, _ := f2.Result(context.Background()); v != 1 {
		panic("pool should still work")
	}
	fmt.Println("  OK")
}

func concurrentBurst() {
	fmt.Println("--- concurrent burst (5000 squares) ---")
	p := New[int](context.Background(), 8, 10000)
	defer p.Shutdown(true, false)
	futures := make([]Future[int], 5000)
	for i := 0; i < 5000; i++ {
		i := i
		f, _ := p.Submit(func(ctx context.Context) (int, error) { return i * i, nil })
		futures[i] = f
	}
	for i, f := range futures {
		v, _ := f.Result(context.Background())
		if v != i*i {
			panic(fmt.Sprintf("mismatch at %d: %d", i, v))
		}
	}
	fmt.Println("  OK")
}
```

### How to run

```bash
go run /path/to/pool.go
go run -race /path/to/pool.go    # catches data races
```

---

## 6. Walkthrough Trace

```
Pool with 2 workers, queueSize=4
tasks chan capacity = 4

Submit(f1) → chan: [f1]
Submit(f2) → chan: [f1, f2]
            workers grab → both running
Submit(f3) → chan: [f3]
...
Submit(f7) → chan full → blocks

w1 finishes f1 → chan: [f4, f5, f6]; f7 unblocks → chan: [f4..f7]

Shutdown(wait=true) → close(tasks);
   workers see closed chan, return after draining
   wg.Wait() returns when all workers exited
```

---

## 7. Complexity Analysis

| Op | Time | Notes |
|---|---|---|
| Submit | O(1), blocks on full chan | natural backpressure |
| Result | O(1) once done | blocks via channel close |
| Cancel | O(1) | atomic CAS |
| Shutdown(wait) | O(pending) | drains chan |

**Memory:** O(N goroutines + queueSize tasks). Each goroutine ~8 KB stack initially.

---

## 8. Tests (Edge Cases)

(Same as Python; see Python doc §8.)

`go run -race` catches any data race in the futures or stats.

---

## 9. Cross-Questions ("Why X and not Y") — ≥ 10

### 9.1 Why a buffered channel and not a `queue.Queue`-like data structure with mutex?

Buffered channels are the idiomatic Go primitive for producer-consumer:
- Zero-allocation send when buffer not full.
- Built-in blocking semantics on `send` (full) and `receive` (empty).
- `close(ch)` propagates "no more tasks" naturally.
- `select` lets workers wait on tasks AND ctx simultaneously.

A mutex+slice would re-implement what the channel gives for free. Channels are the right tool.

### 9.2 Why `context.Context` for cancellation instead of a stop signal channel?

Universal Go pattern. Every Go function that may be cancellable takes a `context.Context`. Keeps the API discoverable.

`<-ctx.Done()` integrates cleanly with `select`. The pool's parent context can be derived from a longer-lived context (HTTP server's request context, app's main context). Tree-shaped cancellation flows naturally.

### 9.3 Why a custom `Future` instead of `chan Result`?

Idiomatic Go would be:
```go
ch := make(chan Result, 1)
go func() { ch <- doWork() }()
result := <-ch
```

Workable for one-off goroutines. For a pool with many submissions and uniform API, a `Future` type:
- Encapsulates done-state (Cancel, Done, Result).
- Provides a familiar API for users from other languages.
- Supports composition (await first-of, all-of, etc.) more naturally.

`errgroup.Group` from `golang.org/x/sync` is a common alternative for the "wait-for-all" case. Use it when you don't need per-task results.

### 9.4 Why `atomic.Int32` for state instead of mutex?

State transitions are single-CAS operations. Atomic is faster (~5 ns vs ~50 ns lock acquire). The actual value reads (`f.value`, `f.err`) are still under a mutex — atomic only governs the state lifecycle.

Using `atomic.Bool` for "is closed" on the pool is the same pattern.

### 9.5 What's the failure mode if a task panics?

The deferred `recover()` in `runTask` catches it, sets the future's error, increments failed counter. Worker continues to next task.

Without `recover`, panic kills the goroutine — pool slowly bleeds workers under repeated bad tasks. Always recover at goroutine entry points.

### 9.6 Why `close(tasks)` for shutdown instead of a sentinel?

`close(ch)` is the Go idiom for "no more sends". Receivers see `ok==false` on receive.
- One operation closes the channel.
- All receivers learn at once.
- The runtime guarantees memory ordering (subsequent reads see effects up to close).

A sentinel object would require sending N items (one per worker). `close` is simpler and explicit.

### 9.7 Why both `tasks` close AND `ctx.Done()` for shutdown?

Defense in depth. `Shutdown(wait=true)` closes the channel; workers exit cleanly after drain. If something goes wrong (worker stuck on a task), `cancel()` provides a hard stop signal via context.

Long-running tasks can also pass `ctx` to themselves (we plumb it via `fn(ctx context.Context)`). They check `ctx.Err()` periodically and exit cleanly.

### 9.8 Why `runtime.NumCPU()` as the default worker count?

CPU-bound rule of thumb. For I/O-bound work (HTTP calls, DB queries), N can be much higher (100s).

The interview answer: pick a default but make it configurable. For benchmarks, expose tuning.

### 9.9 What if I want unbounded concurrency (no queue)?

Pass `queueSize=0`: unbuffered channel. `Submit` blocks until a worker is free. This caps in-flight work at exactly `numWorkers`.

For "spawn one goroutine per task no limit", just use `go fn()` — no pool needed. Pools exist to bound concurrency.

### 9.10 What about `errgroup` from `golang.org/x/sync`?

`errgroup` is great when:
- You're doing fan-out + fan-in.
- First-error wins (other goroutines should cancel).
- You don't need per-task results.

```go
g, ctx := errgroup.WithContext(ctx)
for _, item := range items {
    item := item
    g.Go(func() error { return process(ctx, item) })
}
if err := g.Wait(); err != nil { ... }
```

Use `errgroup` for ad-hoc parallel work; use a pool for sustained worker patterns.

### 9.11 Why `select { case ... case <-ctx.Done(): ... }` and not just receive?

Without the context case, a worker waits on the channel forever. If the parent cancels, the worker is stuck.

`select` lets the worker react to either: a new task or a cancellation signal. The Go-canonical shape.

### 9.12 What if a task wants to spawn its own goroutines?

Pass it the ctx; it spawns goroutines that respect ctx cancellation. The pool's worker is free once `fn` returns.

Don't re-enter the pool from within a task — easy to deadlock if the pool is at capacity (task waits for sub-task, sub-task can't be admitted).

### 9.13 How would you add per-task timeout?

Wrap `fn` with `context.WithTimeout`:
```go
func (p *Pool[T]) SubmitWithTimeout(d time.Duration, fn func(...) ...) ...
   ctx, cancel := context.WithTimeout(p.ctx, d)
   wrapped := func(_ context.Context) (T, error) {
       defer cancel()
       return fn(ctx)
   }
   return p.Submit(wrapped)
```

Caller's `fn` is responsible for honoring `ctx.Err()` periodically.

---

## 10. Variants

(Same as Python; see Python doc §10.)

Go-specific:
- **errgroup-style**: built-in `golang.org/x/sync/errgroup` is the answer for fan-out fan-in.
- **Worker-stealing**: each worker has its own queue; idle workers steal. Significantly more complex.
- **Per-task priority**: replace `chan` with `container/heap` and a mutex.

---

## 11. Cheat-Sheet Recap

1. **Problem:** N-goroutine pool with futures, graceful shutdown.
2. **Idioms:** Buffered chan, `context.Context`, `defer recover`, `sync.WaitGroup`.
3. **Future:** state via `atomic.Int32`, value/err under mutex, completion via `close(done)`.
4. **Shutdown:** `close(tasks)` for graceful; `cancel()` (context) for immediate.
5. **Panic safety:** recover at worker entry; surface as task error.
6. **Bounding:** chan capacity is the natural backpressure.

---

## Appendix A: Idiomatic notes (Go)

```
- Use context.Context throughout — every cancellable operation takes one.
- close(ch) signals "no more"; receivers see ok==false.
- defer recover() at goroutine entry catches panics — workers must survive.
- atomic.Bool / atomic.Int32 for hot single-value state; mutex for compound state.
- sync.WaitGroup for "wait for all goroutines to exit".
- errgroup for "fan-out, fan-in with first-error-wins" — use for ad-hoc tasks.
- Don't re-enter the pool from within a task (deadlock risk).
- go test -race to catch data races.
```

## Appendix B: Common Go gotchas

```
- nil channel blocks forever — don't send/receive without checking init.
- Closing a channel twice panics — guard with sync.Once if needed.
- Send on closed channel panics — only the sender should close.
- Goroutine leak: a goroutine waiting on a channel that's never closed/sent to.
- Loop variable capture (Go < 1.22): for i := range ... go func() { use(i) } — captures i by reference.
- context.WithCancel must be cancelled (defer cancel()) to release resources.
- atomic.Int64 (Go 1.19+) preferred over manual AddInt64.
```

## Appendix C: How this differs from the Python version

```
Python                                Go
─────────                             ─────
threading.Thread                      go (goroutine)
queue.Queue(maxsize=K)                make(chan T, K)
sentinel object for shutdown          close(ch)
threading.Condition                   close(done) chan
Future.add_done_callback              callback closure / chan
exceptions captured                   errors via Result tuple
no native cancellation                context.Context
```

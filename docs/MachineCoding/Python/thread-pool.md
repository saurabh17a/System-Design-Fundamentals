# Custom Thread Pool — Machine Coding (Python)

> **Difficulty:** Medium → Hard
> **Tags:** `[machine-coding]` `[concurrency]` `[producer-consumer]` `[graceful-shutdown]`
> **Language:** Python 3.10+
> **Time budget in interview:** 60–90 min
> **Companies that ask this:** Atlassian, Razorpay, Microsoft, Goldman Sachs, Uber

---

## Beginner's Guide

### What's this in plain English?

Spawning a fresh OS thread for every task is wasteful — they cost time and memory to create. A **thread pool** does this: at startup, create N "worker" threads. Tasks come into a shared queue. Workers pull tasks off the queue, run them, and come back for more. When the program ends, you tell the pool to **shut down** — workers finish what they have and exit.

### Why solve it?

- **Real world**: web servers, batch processors, async I/O bridges; behind every `concurrent.futures.ThreadPoolExecutor`.
- **Teaches**: producer-consumer, graceful shutdown, panic safety, futures.
- **Interview**: classic concurrency MC; tests several primitives at once.

### Vocabulary

- **Worker** — one of the long-lived threads.
- **Task / Job** — a function to run.
- **Queue** — shared, thread-safe FIFO.
- **Future** — a promise of "the result will be here when done."
- **Graceful shutdown** — finish in-flight tasks; reject new ones.
- **Hard shutdown** — drop in-flight tasks; exit immediately.

### High-level approach

```
[caller] → submit(fn) → [queue] → [worker 1, worker 2, ...]
                                   |
                                   ↓ runs fn → result
                                   sets future
```

Components:
1. **Bounded queue** (`queue.Queue(maxsize=K)`) — backpressure.
2. **N worker threads** — each in a `while True: task = queue.get(); task.run()` loop.
3. **`submit(fn) -> Future`** — wraps `fn` in a Future, puts on queue.
4. **`shutdown(wait=True)`** — close the queue (signal "no more tasks"); wait for workers to drain.

Trickiest parts: shutdown without losing tasks, and exception handling inside the worker (one bad task shouldn't kill a worker).

### How to read this doc

- **Beginner**: focus on the queue + worker loop. Skip Future details first.
- **Interview**: shutdown semantics + exception handling are where senior interviewers drill.

---

## 0. How to use this doc in an interview

Thread pool is the **concurrency primitives** machine coding question. It tests:
1. Do you understand **producer-consumer**? Bounded queue, blocking semantics.
2. Can you implement **graceful shutdown**? Drain pending vs cancel everything.
3. Do you know **futures / promises**? Submit returns a Future.
4. Do you handle **panics / exceptions** in workers without crashing the pool?
5. Can you design **dynamic sizing** if asked?

Don't reach for `concurrent.futures.ThreadPoolExecutor` — show you can build it.

The bar:
- 25 min: bounded queue + N workers + submit/shutdown.
- 15 min: futures + exception handling.
- 15 min: graceful vs immediate shutdown.
- 15 min: tests (concurrency, exceptions, shutdown order).

---

## 1. Problem Statement

Build a `ThreadPool` that accepts callable tasks and runs them on a fixed-size worker pool. Provide a `Future` for each submission to retrieve the result or exception. Support both graceful shutdown (drain queue) and immediate shutdown (cancel pending).

### Constraints
- N worker threads (configurable).
- Bounded task queue (configurable; full queue blocks `submit` or rejects).
- Future returned by `submit`; `result()` blocks until done.
- Workers don't die on task exceptions — they recover and continue.
- Graceful shutdown waits for queue drain.
- Memory: O(N + queue_size).

---

## 2. Clarifying Questions

- [ ] Fixed-size pool, or dynamic (grow/shrink based on load)?
- [ ] Bounded queue size? Behavior when full — block, reject, or drop oldest?
- [ ] Per-task timeout?
- [ ] Should tasks be cancellable mid-execution? Python threads can't be safely killed; we cancel only pending.
- [ ] Returned Future API — `.result()`, `.cancel()`, `.done()`?
- [ ] Panic in worker — how to surface?

> **For this doc:** fixed-size pool, bounded queue (blocks on full submit), no per-task timeout, cancel pending only, full Future API, exceptions captured into Future.

---

## 3. API Contract

```python
class Future(Generic[T]):
    def result(self, timeout: float | None = None) -> T: ...
    def exception(self, timeout: float | None = None) -> BaseException | None: ...
    def cancel(self) -> bool: ...
    def cancelled(self) -> bool: ...
    def done(self) -> bool: ...
    def add_done_callback(self, fn: Callable[["Future"], None]) -> None: ...

class ThreadPool:
    def __init__(self, num_workers: int, queue_size: int = 1024) -> None: ...
    def submit(self, fn: Callable[..., T], *args, **kwargs) -> Future[T]: ...
    def shutdown(self, wait: bool = True, cancel_pending: bool = False) -> None: ...
    def stats(self) -> dict: ...
```

| Method | Pre | Post | Time |
|---|---|---|---|
| submit | pool not shut down | task queued, returns Future | O(1) avg, blocks on queue full |
| shutdown(wait=True) | — | no new submits accepted; existing tasks complete | blocks until done |
| shutdown(cancel_pending=True) | — | pending tasks cancelled; running tasks complete | quick |
| Future.result | — | blocks until task done; raises if exception | O(1) once done |
| Future.cancel | task not started | marks cancelled; worker skips | O(1) |

---

## 4. Approach + Data Structure

```
                ┌───────────────┐
   submit() ───▶│  Bounded Queue│
                │  (FIFO, size K)│
                └──┬─┬─┬─┬───────┘
                   │ │ │ │
                   ▼ ▼ ▼ ▼
              ┌──────┐ ┌──────┐ ┌──────┐
              │Wrk 1 │ │Wrk 2 │ │Wrk N │
              └──────┘ └──────┘ └──────┘
                workers loop:
                  while not shutdown:
                    task = queue.get()
                    if task is SHUTDOWN_SENTINEL: break
                    if task.future.cancelled(): continue
                    try: result = task.fn(*args)
                    except Exception as e: task.future._set_exception(e)
                    else: task.future._set_result(result)
```

### Invariants

1. After `shutdown(wait=True)` returns: all submitted tasks have completed (set_result or cancelled).
2. After `shutdown(cancel_pending=True)`: all pending (un-started) tasks are cancelled; running tasks complete normally.
3. `submit` after shutdown raises (cannot enqueue).
4. Worker exceptions never crash the pool.

---

## 5. Full Working Code

```python
"""
Custom Thread Pool — Machine Coding (Python)

Features:
- Fixed-size pool, bounded queue.
- Future API with result/exception/cancel/done/done_callback.
- Graceful and immediate shutdown.
- Worker exceptions captured into the Future; workers continue.
- Stats: submitted/completed/cancelled/failed counts.
"""

from __future__ import annotations

import queue
import threading
import traceback
from typing import Callable, Generic, TypeVar, Optional, Any

T = TypeVar("T")

# ──────────────────────────────────────────────────────────────────────────
# Future
# ──────────────────────────────────────────────────────────────────────────

class _FutureState:
    PENDING = "pending"
    RUNNING = "running"
    CANCELLED = "cancelled"
    FINISHED = "finished"


class Future(Generic[T]):
    def __init__(self) -> None:
        self._state = _FutureState.PENDING
        self._result: Optional[T] = None
        self._exc: Optional[BaseException] = None
        self._cond = threading.Condition()
        self._callbacks: list[Callable[["Future[T]"], None]] = []

    # ─── public API ──────────────────────────────────────────────

    def result(self, timeout: Optional[float] = None) -> T:
        with self._cond:
            if self._state in (_FutureState.PENDING, _FutureState.RUNNING):
                self._cond.wait(timeout)
                if self._state in (_FutureState.PENDING, _FutureState.RUNNING):
                    raise TimeoutError("future not done")
            if self._state == _FutureState.CANCELLED:
                raise CancelledError("future cancelled")
            if self._exc is not None:
                raise self._exc
            return self._result  # type: ignore

    def exception(self, timeout: Optional[float] = None) -> Optional[BaseException]:
        with self._cond:
            if self._state in (_FutureState.PENDING, _FutureState.RUNNING):
                self._cond.wait(timeout)
                if self._state in (_FutureState.PENDING, _FutureState.RUNNING):
                    raise TimeoutError("future not done")
            return self._exc

    def cancel(self) -> bool:
        """Cancel only if still pending. Returns True if cancellation succeeded."""
        with self._cond:
            if self._state != _FutureState.PENDING:
                return False
            self._state = _FutureState.CANCELLED
            self._cond.notify_all()
            cbs = list(self._callbacks)
        for cb in cbs:
            self._safe_callback(cb)
        return True

    def cancelled(self) -> bool:
        with self._cond:
            return self._state == _FutureState.CANCELLED

    def done(self) -> bool:
        with self._cond:
            return self._state in (_FutureState.CANCELLED, _FutureState.FINISHED)

    def add_done_callback(self, fn: Callable[["Future[T]"], None]) -> None:
        with self._cond:
            if self._state in (_FutureState.PENDING, _FutureState.RUNNING):
                self._callbacks.append(fn)
                return
        # already done — call immediately (outside lock)
        self._safe_callback(fn)

    # ─── internal: called by worker ──────────────────────────────

    def _set_running_or_check_cancelled(self) -> bool:
        """Returns True if worker should run; False if was cancelled."""
        with self._cond:
            if self._state == _FutureState.CANCELLED:
                return False
            self._state = _FutureState.RUNNING
            return True

    def _set_result(self, value: T) -> None:
        with self._cond:
            if self._state == _FutureState.CANCELLED:
                return  # ignore — late result on already-cancelled
            self._result = value
            self._state = _FutureState.FINISHED
            self._cond.notify_all()
            cbs = list(self._callbacks)
        for cb in cbs:
            self._safe_callback(cb)

    def _set_exception(self, exc: BaseException) -> None:
        with self._cond:
            if self._state == _FutureState.CANCELLED:
                return
            self._exc = exc
            self._state = _FutureState.FINISHED
            self._cond.notify_all()
            cbs = list(self._callbacks)
        for cb in cbs:
            self._safe_callback(cb)

    def _safe_callback(self, cb: Callable[["Future[T]"], None]) -> None:
        try:
            cb(self)
        except Exception:
            traceback.print_exc()


class CancelledError(Exception):
    pass


# ──────────────────────────────────────────────────────────────────────────
# Thread pool
# ──────────────────────────────────────────────────────────────────────────

class _Task:
    __slots__ = ("future", "fn", "args", "kwargs")
    def __init__(self, future, fn, args, kwargs):
        self.future = future
        self.fn = fn
        self.args = args
        self.kwargs = kwargs


_SHUTDOWN_SENTINEL = object()


class ThreadPool:
    def __init__(self, num_workers: int, queue_size: int = 1024) -> None:
        if num_workers <= 0:
            raise ValueError("num_workers must be positive")
        if queue_size <= 0:
            raise ValueError("queue_size must be positive")
        self._queue: queue.Queue = queue.Queue(maxsize=queue_size)
        self._workers: list[threading.Thread] = []
        self._shutdown = False
        self._shutdown_lock = threading.Lock()
        # stats
        self._submitted = 0
        self._completed = 0
        self._cancelled = 0
        self._failed = 0
        self._stats_lock = threading.Lock()
        # start workers
        for i in range(num_workers):
            t = threading.Thread(target=self._worker_loop, name=f"pool-{i}", daemon=True)
            t.start()
            self._workers.append(t)

    def submit(self, fn: Callable[..., T], *args: Any, **kwargs: Any) -> Future[T]:
        with self._shutdown_lock:
            if self._shutdown:
                raise RuntimeError("pool is shut down; cannot submit new tasks")
            fut: Future[T] = Future()
            task = _Task(fut, fn, args, kwargs)
            self._queue.put(task)  # blocks if queue is full
            with self._stats_lock:
                self._submitted += 1
            return fut

    def shutdown(self, wait: bool = True, cancel_pending: bool = False) -> None:
        with self._shutdown_lock:
            if self._shutdown:
                return
            self._shutdown = True

        if cancel_pending:
            # drain queue, cancel pending
            cancelled = 0
            while True:
                try:
                    task = self._queue.get_nowait()
                except queue.Empty:
                    break
                if task is _SHUTDOWN_SENTINEL:
                    continue
                if task.future.cancel():
                    cancelled += 1
            with self._stats_lock:
                self._cancelled += cancelled

        # send sentinels to wake workers
        for _ in self._workers:
            self._queue.put(_SHUTDOWN_SENTINEL)

        if wait:
            for t in self._workers:
                t.join()

    def stats(self) -> dict:
        with self._stats_lock:
            return {
                "submitted": self._submitted,
                "completed": self._completed,
                "cancelled": self._cancelled,
                "failed": self._failed,
                "queued": self._queue.qsize(),
                "workers": len(self._workers),
                "shutdown": self._shutdown,
            }

    # ─── worker ──────────────────────────────────────────────────

    def _worker_loop(self) -> None:
        while True:
            task = self._queue.get()
            if task is _SHUTDOWN_SENTINEL:
                self._queue.task_done()
                return
            try:
                if not task.future._set_running_or_check_cancelled():
                    with self._stats_lock:
                        self._cancelled += 1
                    continue
                try:
                    result = task.fn(*task.args, **task.kwargs)
                except BaseException as e:
                    task.future._set_exception(e)
                    with self._stats_lock:
                        self._failed += 1
                else:
                    task.future._set_result(result)
                    with self._stats_lock:
                        self._completed += 1
            finally:
                self._queue.task_done()


# ─── tests / demo ─────────────────────────────────────────────────────

def _basic_test() -> None:
    print("--- basic ---")
    p = ThreadPool(num_workers=4)
    f1 = p.submit(lambda x: x + 1, 41)
    f2 = p.submit(lambda x, y: x * y, 6, 7)
    assert f1.result() == 42
    assert f2.result() == 42
    p.shutdown()
    print("  OK")


def _exception_test() -> None:
    print("--- exception captured ---")
    p = ThreadPool(num_workers=2)
    def bad():
        raise ValueError("nope")
    f = p.submit(bad)
    try:
        f.result()
        assert False, "should have raised"
    except ValueError as e:
        assert str(e) == "nope"
    # pool still alive
    assert p.submit(lambda: 1).result() == 1
    p.shutdown()
    print("  OK")


def _cancel_test() -> None:
    print("--- cancel ---")
    p = ThreadPool(num_workers=1)
    started = threading.Event()
    finish = threading.Event()
    def slow():
        started.set()
        finish.wait()
        return "slow done"
    f1 = p.submit(slow)
    started.wait()
    # f2 is still pending (only 1 worker, busy on f1)
    f2 = p.submit(lambda: "f2")
    f3 = p.submit(lambda: "f3")
    # cancel f2 before it runs
    assert f2.cancel() is True
    finish.set()
    assert f1.result() == "slow done"
    assert f2.cancelled() is True
    assert f3.result() == "f3"
    p.shutdown()
    print("  OK")


def _shutdown_drain_test() -> None:
    print("--- graceful drain ---")
    p = ThreadPool(num_workers=2)
    futures = [p.submit(lambda i=i: i*2) for i in range(20)]
    p.shutdown(wait=True)  # waits for all 20
    for i, f in enumerate(futures):
        if not f.cancelled():
            assert f.result() == i * 2
    s = p.stats()
    print(f"  stats: {s}")
    assert s["submitted"] == 20
    assert s["completed"] + s["cancelled"] + s["failed"] == 20
    print("  OK")


def _shutdown_cancel_test() -> None:
    print("--- cancel-pending shutdown ---")
    p = ThreadPool(num_workers=1)
    started = threading.Event()
    finish = threading.Event()
    def slow():
        started.set()
        finish.wait()
        return "x"
    f1 = p.submit(slow)
    started.wait()
    futures = [p.submit(lambda i=i: i) for i in range(5)]
    p.shutdown(wait=False, cancel_pending=True)
    finish.set()
    # f1 still completes (running)
    assert f1.result() == "x"
    # rest should be cancelled
    cancelled = sum(1 for f in futures if f.cancelled())
    print(f"  cancelled: {cancelled}/5")
    assert cancelled >= 4  # at least 4 of 5 pending should be cancelled
    print("  OK")


def _submit_after_shutdown_test() -> None:
    print("--- submit after shutdown ---")
    p = ThreadPool(num_workers=1)
    p.shutdown()
    try:
        p.submit(lambda: 1)
        assert False
    except RuntimeError:
        pass
    print("  OK")


def _callback_test() -> None:
    print("--- done_callback ---")
    p = ThreadPool(num_workers=2)
    called = threading.Event()
    box: list[int] = []
    def cb(f):
        box.append(f.result())
        called.set()
    f = p.submit(lambda: 7)
    f.add_done_callback(cb)
    called.wait(timeout=1)
    assert box == [7]
    # callback on already-done future fires immediately
    box2: list[int] = []
    f.add_done_callback(lambda f: box2.append(f.result()))
    assert box2 == [7]
    p.shutdown()
    print("  OK")


def _concurrent_burst_test() -> None:
    print("--- concurrent burst ---")
    p = ThreadPool(num_workers=8, queue_size=10000)
    futures = [p.submit(lambda x=x: x * x) for x in range(5000)]
    results = [f.result() for f in futures]
    assert results == [x * x for x in range(5000)]
    p.shutdown()
    print(f"  computed 5000 squares OK")


if __name__ == "__main__":
    _basic_test()
    _exception_test()
    _cancel_test()
    _shutdown_drain_test()
    _shutdown_cancel_test()
    _submit_after_shutdown_test()
    _callback_test()
    _concurrent_burst_test()
    print("\nAll tests passed.")
```

### How to run

```bash
python3 ~/Downloads/cc/kb/MachineCoding/Python/thread-pool.py
```

---

## 6. Walkthrough Trace

```
Pool with 2 workers, queue_size=4

submit(f1) → Q=[f1]
submit(f2) → Q=[f1, f2]
            workers idle → grab f1 and f2
submit(f3) → Q=[f3]
submit(f4) → Q=[f3, f4]
submit(f5) → Q=[f3, f4, f5]
submit(f6) → Q=[f3, f4, f5, f6]
submit(f7) → blocks (queue full at 4)

w0 finishes f1 → Q=[f4, f5, f6, f7]   (f7 unblocked)
w0 grabs f3 → ...

shutdown(wait=True) → no new submit; pool waits for empty queue
   sentinels added; workers exit when they get a sentinel
```

---

## 7. Complexity Analysis

| Operation | Time | Notes |
|---|---|---|
| submit | O(1) avg, may block on full queue | Bounded queue is the natural backpressure |
| Future.result | O(1) once done; blocks until done | Condition variable wakes |
| cancel | O(1) | Atomic state flip |
| shutdown(wait) | O(pending tasks) | Drains queue |

**Memory:** O(N + queue_size) — N worker threads + queue capacity.

---

## 8. Tests (Edge Cases)

### Must-cover
- Submit + collect: 5000 squares → all correct.
- Exception in task: Future captures it; pool keeps running.
- Cancel pending: future.cancelled() True; future.result() raises CancelledError.
- Graceful shutdown: queue drains before return.
- Cancel-pending shutdown: pending cancelled; running completes.
- Submit after shutdown: raises.
- Callback on already-done future: fires immediately.

### Concurrency
- Burst submit from many threads: all results correct.
- Cancel during execution: only PENDING is cancellable (Python can't kill running threads).

---

## 9. Cross-Questions ("Why X and not Y") — ≥ 10

### 9.1 Why bounded queue and not unbounded?

Bounded queue gives **backpressure**: a fast producer can't infinitely outpace consumers. Memory use is bounded; submitter blocks → load shedding happens at the producer.

Unbounded queue: producer never blocks; if consumers fall behind, queue grows until OOM. Avoid.

### 9.2 Why one queue and not per-worker queues?

Single queue gives natural load balancing — whichever worker is idle grabs the next task. Per-worker queues create idle workers when one queue is hot. Work-stealing solves it but adds significant complexity.

For most workloads, single queue is the right answer. Per-worker + work-stealing is for very high throughput (Java's ForkJoinPool, Tokio's scheduler).

### 9.3 Why a sentinel for shutdown instead of a flag check in the worker loop?

Worker is blocked on `queue.get()` (waiting for tasks). A flag check requires the worker to wake up — typically a periodic timeout, which adds latency to shutdown.

A sentinel object placed on the queue wakes a worker immediately on receipt. One sentinel per worker = each worker exits its loop. Clean.

### 9.4 Why can't we kill a running task in Python?

CPython doesn't expose a safe thread-kill primitive. `Thread.terminate()` doesn't exist; `_async_raise` / `ctypes.pythonapi.PyThreadState_SetAsyncExc` is unsafe (can corrupt locks, leak resources).

The right pattern: cooperative cancellation. Tasks check a flag periodically and exit gracefully. We expose that via Future.cancel for **pending** tasks; running tasks must implement their own cancellation token.

### 9.5 Why `BaseException` in the catch and not `Exception`?

`BaseException` includes `KeyboardInterrupt`, `SystemExit`, `GeneratorExit`. Pool workers should not propagate these — they'd kill the worker thread silently, leaking the worker.

Catching `BaseException` and stuffing it into the Future is the right move: we surface it to the caller (`f.result()` re-raises), but the worker survives.

### 9.6 Why a `Condition` and not an `Event` on the Future?

`Event` only supports "set or not". `Condition` supports `wait(timeout)` with re-checking under the lock — exactly the pattern for "wait until done OR timeout". Plus, `notify_all` wakes multiple waiters atomically.

Could implement with `Event` — slightly less elegant, more careful timeout handling. Same outcome.

### 9.7 Why daemon threads?

`daemon=True` makes the worker thread die with the main thread. Safety net: if the user forgets to call `shutdown()`, the process can still exit.

Trade-off: pending tasks may be killed mid-run on process exit. Acceptable for an interview-grade pool; production might prefer non-daemon + atexit handler.

### 9.8 What if the task hangs forever?

We can't kill it. Options:
- Wrap the task in a timeout: `task = lambda: timeout_runner(fn, t)`.
- Caller polls with `f.result(timeout=t)` and abandons.
- Use `multiprocessing` (process pool can be killed, at the cost of IPC).

Threading-based pools fundamentally can't preempt; design accordingly.

### 9.9 Why not use `concurrent.futures.ThreadPoolExecutor`?

Because the question is to build it. The stdlib version is the reference; show you know it, then implement.

For production code, **always** use `concurrent.futures.ThreadPoolExecutor` — it's been battle-tested for years. Roll your own only when extending semantics (e.g. priority queue, dynamic resize, custom backpressure).

### 9.10 What if I want priority?

Replace `queue.Queue` with `queue.PriorityQueue`. `Task` has a priority field; ordered descending. Add a tie-breaker (insertion sequence) to avoid comparing functions.

```python
import heapq, itertools, queue
counter = itertools.count()
class _Task:
    def __init__(self, prio, fn, ...):
        self.prio = prio
        self.seq = next(counter)
    def __lt__(self, other): return (self.prio, self.seq) < (other.prio, other.seq)
```

### 9.11 What if the queue is full and the producer doesn't want to block?

`queue.put_nowait()` raises `queue.Full`; library propagates. Caller decides — drop the task or back off and retry.

We'd add an option: `submit(fn, ..., block=True, timeout=None)`. With `block=False`, raise on full.

### 9.12 What if I need dynamic sizing?

Add resize logic:
- Background monitor thread tracks queue depth.
- If depth > threshold for N seconds: spawn additional workers.
- If depth = 0 for N seconds: signal a worker to exit.

Trade-off: workers come and go → cache locality is lost; thread spin-up is expensive (~ms). For most workloads, fixed-size with right N is better. Dynamic shines when load is bimodal (idle for hours, then bursty).

---

## 10. Variants

### 10.1 Process pool
Same shape with `multiprocessing.Process` instead of `Thread`. Tasks must be pickleable; per-task IPC costs more.

### 10.2 Async (asyncio)
Use `asyncio.Queue` and async coroutines. Same producer-consumer pattern, no GIL impact for I/O-bound. `asyncio.gather` for fan-out.

### 10.3 Work-stealing
Per-worker queues; idle workers steal from busy. Significantly more code; warranted at very high throughput.

### 10.4 Priority pool
PriorityQueue. Useful for mixed-criticality tasks (urgent vs low-pri).

### 10.5 Bounded with deadline drop
Tasks have an SLA; ones older than deadline at dequeue time are dropped (logged). Useful for stale-job protection.

---

## 11. Cheat-Sheet Recap

1. **Problem:** N workers, bounded FIFO, futures, graceful shutdown.
2. **Data structure:** `queue.Queue` + N daemon threads.
3. **Future API:** result/exception/cancel/done/done_callback.
4. **Shutdown:** sentinel-based; graceful (drain) vs cancel_pending.
5. **Exceptions:** captured into Future; workers survive.
6. **Cancellation:** PENDING only; Python can't kill running threads safely.
7. **Variants:** process pool, async, work-stealing, priority, deadline-drop.

---

## Appendix A: Idiomatic notes (Python)

```
- threading.Thread(daemon=True) — let workers die with main; complement with explicit shutdown.
- queue.Queue is thread-safe and supports blocking get/put with timeouts.
- threading.Condition over Event for "wait until done": cleaner timeout handling.
- Don't catch only Exception in workers — BaseException includes KeyboardInterrupt.
- traceback.print_exc() in callback safety net — surfaces bugs without crashing pool.
- `concurrent.futures.Future` is the reference impl; mimic its API.
```

## Appendix B: Common Python gotchas

```
- Default arg gotcha (`def f(x=[]):` shares the list) — irrelevant here but watch for it.
- Lambda capture in `for i in range(N): submit(lambda: i)` — all see final i.
  Use `submit(lambda i=i: i)` or `functools.partial`.
- Daemon threads are killed abruptly on interpreter exit; finalizers may not run.
- A Future referenced by callback may keep its result alive indefinitely (memory leak).
- `queue.Queue(maxsize=0)` is unbounded — easy mistake.
```

## Appendix C: Why this question is loved by interviewers

```
- Tests genuine concurrency understanding (not just threading.start()).
- Surfaces graceful-shutdown design (subtle).
- Future API mirrors real-world stdlib — easy to grade.
- Many natural follow-ups (priority, dynamic, async).
- Tests show clearly: with 8 workers, 5000 squares should match.
```

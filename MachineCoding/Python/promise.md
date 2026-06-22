# Promise / Future from Scratch — Machine Coding (Python)

> **Difficulty:** Medium
> **Tags:** `[mc]` `[concurrency]` `[future]` `[chaining]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

You start a slow operation (an HTTP request, a DB query). You don't want to block your whole program waiting. Instead the operation hands you a **promise**: "I'll have the value later — when you're ready, ask me, or attach a callback."

JavaScript's `Promise`. Python's `Future`. Java's `CompletableFuture`. Same idea: a placeholder for a value not yet computed.

### Why solve it?

- **Real world**: every async framework has this. Foundational for chaining (`.then(...).then(...)`), parallelism (`Promise.all`), error propagation.
- **Teaches**: concurrency primitives (lock, condition variable), state machines (PENDING → RESOLVED / REJECTED), chaining.
- **Interview**: tests building from primitives, not just using `asyncio`.

### Vocabulary

- **Promise / Future** — placeholder for an eventual result.
- **Resolve** — set the result successfully.
- **Reject** — set an error.
- **Pending / Settled** — initial state / has been resolved or rejected.
- **then(callback)** — register a callback for when the value arrives.
- **all(promises)** — wait for many; resolves when all do.

### High-level approach

A `Promise` holds:
- `state`: PENDING / RESOLVED / REJECTED.
- `value` or `error`.
- `callbacks`: list of functions waiting on the result.
- `lock` + `condition variable` for thread-safety.

**resolve(value)**:
- Set state, value. Notify waiters. Run all callbacks.

**get(timeout)** (blocking):
- Wait on the condition variable until state is settled.

**then(fn)**:
- If already resolved, call `fn(value)` (in another thread, or async).
- Else, append to callbacks.

For **chaining**, `then` returns a NEW promise that resolves with `fn`'s return value. You can also chain `then(handler).catch(error_handler)`.

### How to read this doc

- **Beginner**: focus on resolve + get + then.
- **Interview**: chaining and `Promise.all`/`Promise.race` are differentiators.

---

## 0. Why this question

Tests **concurrency primitives + composition + chaining**. Promise = "value will be available eventually."

---

## 1. Problem Statement

Build a Promise/Future:
- Create with executor.
- `result(timeout)` blocks until done.
- `then(callback)` chains transformation.
- `all(promises)`, `any(promises)`.
- States: pending, resolved, rejected.

---

## 2. Code

```python
"""Promise / Future from scratch."""
import threading
import time
from typing import Callable, Generic, TypeVar, Optional, Any

T = TypeVar("T")
U = TypeVar("U")


class PromiseState:
    PENDING = "pending"
    RESOLVED = "resolved"
    REJECTED = "rejected"


class Promise(Generic[T]):
    def __init__(self, executor: Optional[Callable[[Callable, Callable], None]] = None):
        self._state = PromiseState.PENDING
        self._value: Any = None
        self._error: Optional[BaseException] = None
        self._lock = threading.Lock()
        self._cond = threading.Condition(self._lock)
        self._callbacks: list[tuple[Callable, Callable, "Promise"]] = []
        if executor is not None:
            try:
                executor(self._resolve, self._reject)
            except BaseException as e:
                self._reject(e)

    # ─── public API ──────────────────────

    @classmethod
    def resolved(cls, value: T) -> "Promise[T]":
        p = cls()
        p._resolve(value)
        return p

    @classmethod
    def rejected(cls, error: BaseException) -> "Promise[T]":
        p = cls()
        p._reject(error)
        return p

    def result(self, timeout: Optional[float] = None) -> T:
        with self._cond:
            if self._state == PromiseState.PENDING:
                self._cond.wait(timeout)
            if self._state == PromiseState.PENDING:
                raise TimeoutError("promise not done")
            if self._state == PromiseState.REJECTED:
                raise self._error
            return self._value

    def then(self, on_resolve: Callable[[T], U] | None = None,
             on_reject: Callable[[BaseException], U] | None = None) -> "Promise[U]":
        next_promise: Promise[U] = Promise()
        with self._lock:
            if self._state == PromiseState.PENDING:
                self._callbacks.append((on_resolve, on_reject, next_promise))
            else:
                # Already done; schedule callbacks immediately
                self._fire(self._state, on_resolve, on_reject, next_promise)
        return next_promise

    @classmethod
    def all(cls, promises: list["Promise[Any]"]) -> "Promise[list]":
        results: list[Any] = [None] * len(promises)
        result_lock = threading.Lock()
        completed = [0]
        agg = Promise()

        def make_handler(i):
            def on_ok(v):
                with result_lock:
                    results[i] = v
                    completed[0] += 1
                    if completed[0] == len(promises):
                        agg._resolve(results)
                return None
            return on_ok

        def on_err(e):
            agg._reject(e)
            return None

        for i, p in enumerate(promises):
            p.then(make_handler(i), on_err)
        if not promises:
            agg._resolve([])
        return agg

    @classmethod
    def any(cls, promises: list["Promise[T]"]) -> "Promise[T]":
        agg = Promise()
        for p in promises:
            p.then(lambda v: agg._resolve(v), lambda e: None)
        return agg

    # ─── internal ──────────────────────

    def _resolve(self, value):
        with self._cond:
            if self._state != PromiseState.PENDING:
                return
            self._state = PromiseState.RESOLVED
            self._value = value
            self._cond.notify_all()
            cbs = list(self._callbacks)
            self._callbacks = []
        for on_ok, on_err, next_p in cbs:
            self._fire(PromiseState.RESOLVED, on_ok, on_err, next_p)

    def _reject(self, error):
        with self._cond:
            if self._state != PromiseState.PENDING:
                return
            self._state = PromiseState.REJECTED
            self._error = error
            self._cond.notify_all()
            cbs = list(self._callbacks)
            self._callbacks = []
        for on_ok, on_err, next_p in cbs:
            self._fire(PromiseState.REJECTED, on_ok, on_err, next_p)

    def _fire(self, state, on_ok, on_err, next_p):
        try:
            if state == PromiseState.RESOLVED:
                if on_ok is None:
                    next_p._resolve(self._value)
                else:
                    next_p._resolve(on_ok(self._value))
            else:
                if on_err is None:
                    next_p._reject(self._error)
                else:
                    next_p._resolve(on_err(self._error))
        except BaseException as e:
            next_p._reject(e)


# ─── Tests ───

def _basic():
    print("--- basic resolve ---")
    p = Promise.resolved(42)
    assert p.result() == 42
    print("  OK")


def _basic_reject():
    print("--- basic reject ---")
    p = Promise.rejected(ValueError("nope"))
    try:
        p.result()
        assert False
    except ValueError:
        pass
    print("  OK")


def _executor_async():
    print("--- async executor ---")
    def slow_executor(resolve, reject):
        def w():
            time.sleep(0.05)
            resolve("done")
        threading.Thread(target=w, daemon=True).start()
    p = Promise(slow_executor)
    assert p.result(timeout=1) == "done"
    print("  OK")


def _then_chain():
    print("--- then chain ---")
    p = Promise.resolved(10)
    chained = p.then(lambda x: x * 2).then(lambda x: x + 1)
    assert chained.result() == 21
    print("  OK")


def _then_error_path():
    print("--- error path ---")
    p = Promise.rejected(ValueError("oops"))
    handled = p.then(None, lambda e: f"handled: {e}")
    assert handled.result() == "handled: oops"
    print("  OK")


def _all():
    print("--- Promise.all ---")
    p1 = Promise.resolved(1)
    p2 = Promise.resolved(2)
    p3 = Promise.resolved(3)
    all_p = Promise.all([p1, p2, p3])
    assert all_p.result() == [1, 2, 3]
    print("  OK")


def _all_rejects_on_first_error():
    print("--- all rejects on first error ---")
    p1 = Promise.resolved(1)
    p2 = Promise.rejected(ValueError("bad"))
    p3 = Promise.resolved(3)
    all_p = Promise.all([p1, p2, p3])
    try:
        all_p.result()
        assert False
    except ValueError:
        pass
    print("  OK")


def _any_resolves_first():
    print("--- any resolves first ---")
    p1 = Promise.resolved("first")
    p2 = Promise.resolved("second")
    any_p = Promise.any([p1, p2])
    assert any_p.result() == "first"
    print("  OK")


def _timeout():
    print("--- timeout ---")
    p = Promise()  # never resolved
    try:
        p.result(timeout=0.05)
        assert False
    except TimeoutError:
        pass
    print("  OK")


if __name__ == "__main__":
    _basic()
    _basic_reject()
    _executor_async()
    _then_chain()
    _then_error_path()
    _all()
    _all_rejects_on_first_error()
    _any_resolves_first()
    _timeout()
    print("\nAll tests passed.")
```

---

## 3. Cross-Questions

### 3.1 What's the executor pattern?
- Constructor takes `(resolve, reject) -> None`.
- Lets caller wire async resolution.
- Mirrors JS Promise constructor.

### 3.2 Why callbacks list inside?
- Multiple `.then()` on same promise.
- Each needs to fire on completion.

### 3.3 What's `then` chaining?
- `.then(f)` returns NEW promise that resolves with `f(value)`.
- If `f` itself returns a promise: should "unwrap"; we do simple version (no auto-unwrap).

### 3.4 What if then's callback raises?
- Catch; reject the next promise with the exception.

### 3.5 What about `Promise.race` vs `Promise.any`?
- `race`: settles with first to settle (resolve or reject).
- `any`: settles with first to resolve; rejects only if all reject.
- We implemented `any`.

### 3.6 Memory safety?
- Cycles through then chains: GC'd normally if not externally referenced.
- Long-lived chain holds intermediate results.

### 3.7 Thread safety?
- Mutex around state transitions.
- Callbacks fire under lock-released state to avoid deadlock if callback waits on something.

---

## 4. Cheat-Sheet
1. State machine: pending → resolved | rejected.
2. Executor pattern; callbacks list.
3. `.then(on_ok, on_err)` returns new promise.
4. `Promise.all` waits for all; rejects on first error.
5. `Promise.any` resolves with first success.
6. Concurrency-safe via Lock + Condition.

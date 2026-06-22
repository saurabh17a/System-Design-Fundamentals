# Circuit Breaker — Machine Coding (Python)

> **Difficulty:** Medium
> **Tags:** `[mc]` `[resilience]` `[state-machine]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

If a downstream service is dying, hammering it with retries makes things worse — you're piling load onto something that's already drowning. A **circuit breaker** is software's version of an electrical circuit breaker: when failures cross a threshold, it **trips open**. While open, calls fail instantly (no network roundtrip wasted). After a cooldown, it carefully tries one request — if that succeeds, normal service resumes; if it fails, the breaker trips again.

### Why solve it?

- **Real world**: Netflix Hystrix, every modern microservice mesh, AWS SDK retries.
- **Teaches**: state machines, time-based transitions, system thinking ("don't make the failure worse").
- **Interview**: pairs with rate limiter and retries as the resilience trio.

### Vocabulary

- **Closed** — normal; calls go through.
- **Open** — tripped; calls fail fast without contacting the service.
- **Half-Open** — cooldown elapsed; allow one trial call to test recovery.
- **Failure threshold** — N failures in a row → trip.
- **Cooldown / reset timeout** — how long to stay Open before trying again.

### High-level approach

State machine:

```
        failures ≥ threshold
CLOSED ────────────────────► OPEN
   ▲                           │
   │                           │ cooldown elapsed
   │                           ▼
   │                       HALF_OPEN
   │ success      failure
   └──────────       ────────────► OPEN
              \
               └── close after success
```

Wrap a function:
```python
breaker.call(fn, *args)
```

The breaker checks state:
- **Closed**: call through; on failure, increment count; trip if threshold.
- **Open**: instantly raise; check if cooldown elapsed → move to half-open.
- **Half-Open**: try one call; on success → close; on failure → back to open.

### How to read this doc

- **Beginner**: focus on the state diagram before code.
- **Interview**: edge cases (concurrent calls in half-open, sliding window of failures) are the high-value parts.

---

## 0. Why this question

Circuit breaker prevents cascading failures: when downstream is broken, fail fast instead of hammering it. State machine: **CLOSED → OPEN → HALF_OPEN → CLOSED**.

---

## 1. State Machine

```
CLOSED:    requests pass through; track failures.
           N failures in T seconds → OPEN.

OPEN:      reject all immediately for cool-down period.
           After cool-down → HALF_OPEN.

HALF_OPEN: allow N test requests.
           Success → CLOSED.
           Failure → OPEN (reset cool-down).
```

---

## 2. Code

```python
"""Circuit Breaker with state machine."""
from __future__ import annotations
import enum
import threading
import time
from collections import deque
from typing import Callable, TypeVar

T = TypeVar("T")


class State(enum.Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitBreakerOpenError(Exception): ...


class CircuitBreaker:
    def __init__(self,
                 failure_threshold: int = 5,
                 window_seconds: float = 60.0,
                 cooldown_seconds: float = 30.0,
                 half_open_test_count: int = 3) -> None:
        self._fail_threshold = failure_threshold
        self._window = window_seconds
        self._cooldown = cooldown_seconds
        self._half_open_test = half_open_test_count

        self._state = State.CLOSED
        self._failures: deque[float] = deque()  # timestamps
        self._open_until: float = 0
        self._half_open_attempts: int = 0
        self._half_open_successes: int = 0
        self._lock = threading.Lock()

    def call(self, fn: Callable[[], T]) -> T:
        with self._lock:
            self._maybe_transition(time.monotonic())
            if self._state is State.OPEN:
                raise CircuitBreakerOpenError("circuit open")
            if self._state is State.HALF_OPEN and self._half_open_attempts >= self._half_open_test:
                # Already enough probes in flight; reject
                raise CircuitBreakerOpenError("half-open probe budget exhausted")
            if self._state is State.HALF_OPEN:
                self._half_open_attempts += 1
        try:
            result = fn()
        except Exception:
            self._on_failure()
            raise
        else:
            self._on_success()
            return result

    def _on_success(self):
        with self._lock:
            if self._state is State.HALF_OPEN:
                self._half_open_successes += 1
                if self._half_open_successes >= self._half_open_test:
                    self._reset_to_closed()

    def _on_failure(self):
        now = time.monotonic()
        with self._lock:
            if self._state is State.HALF_OPEN:
                self._open(now)
                return
            self._failures.append(now)
            self._evict_old(now)
            if len(self._failures) >= self._fail_threshold:
                self._open(now)

    def _evict_old(self, now: float):
        cutoff = now - self._window
        while self._failures and self._failures[0] < cutoff:
            self._failures.popleft()

    def _open(self, now: float):
        self._state = State.OPEN
        self._open_until = now + self._cooldown

    def _reset_to_closed(self):
        self._state = State.CLOSED
        self._failures.clear()
        self._half_open_attempts = 0
        self._half_open_successes = 0

    def _maybe_transition(self, now: float):
        if self._state is State.OPEN and now >= self._open_until:
            self._state = State.HALF_OPEN
            self._half_open_attempts = 0
            self._half_open_successes = 0

    def state(self) -> str:
        with self._lock:
            self._maybe_transition(time.monotonic())
            return self._state.value


# ─── Tests ───
def main():
    print("--- normal operation ---")
    cb = CircuitBreaker(failure_threshold=3)
    for _ in range(10):
        assert cb.call(lambda: 42) == 42
    assert cb.state() == "closed"
    print("  OK")

    print("--- trip on failures ---")
    cb = CircuitBreaker(failure_threshold=3, cooldown_seconds=1)
    fails = 0
    for _ in range(5):
        try:
            cb.call(lambda: (_ for _ in ()).throw(ValueError("boom")))
        except ValueError:
            fails += 1
        except CircuitBreakerOpenError:
            fails += 1
    assert cb.state() == "open"
    print("  tripped to open")

    print("--- open rejects fast ---")
    try:
        cb.call(lambda: 1)
    except CircuitBreakerOpenError:
        pass
    print("  OK")

    print("--- transitions to half-open ---")
    time.sleep(1.1)
    assert cb.state() == "half_open"
    print("  OK")

    print("--- half-open success → closed ---")
    cb._half_open_test = 2  # easier to test
    cb.call(lambda: 1)
    cb.call(lambda: 1)
    assert cb.state() == "closed"
    print("  OK")

    print("--- half-open failure → open ---")
    cb2 = CircuitBreaker(failure_threshold=2, cooldown_seconds=0.5, half_open_test_count=2)
    for _ in range(3):
        try:
            cb2.call(lambda: (_ for _ in ()).throw(ValueError("x")))
        except (ValueError, CircuitBreakerOpenError):
            pass
    assert cb2.state() == "open"
    time.sleep(0.6)
    assert cb2.state() == "half_open"
    try:
        cb2.call(lambda: (_ for _ in ()).throw(ValueError("again")))
    except ValueError:
        pass
    assert cb2.state() == "open"
    print("  OK; reverts to open on probe failure")

    print("\nAll tests passed.")


if __name__ == "__main__":
    main()
```

---

## 3. Cross-Questions

### 3.1 vs retry?
Retry: pessimistic; assumes transient failure. Adds load.
Circuit breaker: protects downstream from cascade.
Use both: retry per-call; circuit breaker around the retry.

### 3.2 Why time-windowed failure threshold?
Sustained failures, not historical noise.
Window typically 30-60 sec.

### 3.3 Half-open prevents thundering herd?
Yes — only N probes allowed. Without it, all clients would hit downstream simultaneously when transitioning out of OPEN.

### 3.4 What about timeout?
Wrap the call with timeout. Failure = error or timeout.

### 3.5 Per-endpoint vs per-service?
Per-endpoint usually. Different endpoints have independent health.

### 3.6 Comparison to bulkhead pattern?
Bulkhead: limit concurrent calls (resource isolation).
Circuit breaker: stop calling when broken.
Complementary.

---

## 4. Cheat-Sheet
1. State: CLOSED → OPEN → HALF_OPEN → CLOSED.
2. Trip on N failures in window.
3. OPEN rejects immediately.
4. HALF_OPEN allows limited probes.
5. Probe success → CLOSED; failure → OPEN.

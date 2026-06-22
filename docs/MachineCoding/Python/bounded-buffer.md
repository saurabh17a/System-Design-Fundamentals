# Bounded Buffer / Producer-Consumer — Machine Coding (Python)

> **Difficulty:** Medium
> **Tags:** `[mc]` `[concurrency]` `[condition-variable]` `[blocking]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

Picture a small assembly line. Workers at the front (**producers**) put items on a conveyor belt. Workers at the back (**consumers**) pick items off. The belt has limited capacity. If producers run fast and consumers run slow, the belt fills — producers must wait. If consumers run fast, the belt empties — consumers must wait.

A **bounded buffer** is the data structure version. It's *the* canonical concurrency exercise.

### Why solve it?

- **Real world**: thread pools, message queues, log batchers, IO pipelines.
- **Teaches**: classical synchronization with locks + condition variables; how to wake the right thread at the right time without busy-waiting.
- **Interview**: directly tests concurrency primitives. If you know this, you can build queues, channels, semaphores.

### Vocabulary

- **Producer / Consumer** — threads that put / take items.
- **Bounded** — fixed max capacity.
- **Block** — thread sleeps until a condition is met.
- **Lock** — only one thread at a time inside a critical section.
- **Condition variable** — a thread can `wait` on it (releasing the lock) and another thread can `notify` it (waking sleepers).

### High-level approach

State: `buffer = deque()`, `capacity`, `lock`, `not_full`, `not_empty` (condition variables).

**put(item)**:
1. acquire lock
2. while `len(buffer) == capacity`: `not_full.wait()`
3. append item; `not_empty.notify()`
4. release lock

**take()**:
1. acquire lock
2. while `len(buffer) == 0`: `not_empty.wait()`
3. pop item; `not_full.notify()`
4. release lock; return item

The `while` (not `if`) handles spurious wake-ups.

### How to read this doc

- **Beginner**: write out the producer/consumer interactions on paper.
- **Interview**: explain why `while`, not `if`, and what could deadlock.

---

## 0. Why this question

Tests **classic concurrency primitive**: condition variables, lock-step blocking, producer/consumer fairness.

---

## 1. Problem Statement

A bounded queue:
- `put(item)` blocks if full.
- `get()` blocks if empty.
- Both with optional timeout.
- Multiple producers, multiple consumers; thread-safe.

---

## 2. Approach

```
queue = collections.deque
lock + condition (or 2 conditions: not_full, not_empty)

put(item):
  with lock:
     while len == capacity: cond_not_full.wait()
     queue.append(item)
     cond_not_empty.notify()

get():
  with lock:
     while len == 0: cond_not_empty.wait()
     item = queue.popleft()
     cond_not_full.notify()
     return item
```

---

## 3. Code

```python
"""Bounded buffer (producer-consumer)."""
import threading
import time
from collections import deque
from typing import Generic, TypeVar, Optional

T = TypeVar("T")


class BoundedBuffer(Generic[T]):
    def __init__(self, capacity: int) -> None:
        if capacity <= 0:
            raise ValueError("capacity must be positive")
        self._capacity = capacity
        self._queue: deque[T] = deque()
        self._lock = threading.Lock()
        self._not_full = threading.Condition(self._lock)
        self._not_empty = threading.Condition(self._lock)
        self._closed = False

    def put(self, item: T, timeout: Optional[float] = None) -> bool:
        deadline = (time.monotonic() + timeout) if timeout else None
        with self._not_full:
            while len(self._queue) >= self._capacity:
                if self._closed:
                    raise RuntimeError("buffer closed")
                if deadline is None:
                    self._not_full.wait()
                else:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0 or not self._not_full.wait(remaining):
                        return False
            self._queue.append(item)
            self._not_empty.notify()
            return True

    def get(self, timeout: Optional[float] = None) -> tuple[Optional[T], bool]:
        deadline = (time.monotonic() + timeout) if timeout else None
        with self._not_empty:
            while not self._queue:
                if self._closed:
                    return None, False
                if deadline is None:
                    self._not_empty.wait()
                else:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0 or not self._not_empty.wait(remaining):
                        return None, False
            item = self._queue.popleft()
            self._not_full.notify()
            return item, True

    def __len__(self) -> int:
        with self._lock:
            return len(self._queue)

    def close(self) -> None:
        with self._lock:
            self._closed = True
            self._not_empty.notify_all()
            self._not_full.notify_all()


# ─── Tests ───

def _basic():
    print("--- basic ---")
    b: BoundedBuffer[int] = BoundedBuffer(3)
    b.put(1); b.put(2); b.put(3)
    assert len(b) == 3
    v, ok = b.get()
    assert ok and v == 1
    assert len(b) == 2
    print("  OK")


def _put_blocks_when_full():
    print("--- put blocks when full ---")
    b: BoundedBuffer[int] = BoundedBuffer(2)
    b.put(1); b.put(2)
    # third put should time out
    ok = b.put(3, timeout=0.1)
    assert ok is False
    print("  OK")


def _get_blocks_when_empty():
    print("--- get blocks when empty ---")
    b: BoundedBuffer[int] = BoundedBuffer(2)
    v, ok = b.get(timeout=0.1)
    assert ok is False
    print("  OK")


def _producer_consumer():
    print("--- many producers + consumers ---")
    b: BoundedBuffer[int] = BoundedBuffer(10)
    n_items = 1000
    consumed: list[int] = []
    consumed_lock = threading.Lock()

    def producer(start, count):
        for i in range(start, start + count):
            b.put(i)

    def consumer():
        while True:
            v, ok = b.get(timeout=0.5)
            if not ok:
                return
            with consumed_lock:
                consumed.append(v)

    producers = [threading.Thread(target=producer, args=(i*250, 250)) for i in range(4)]
    consumers = [threading.Thread(target=consumer) for _ in range(4)]
    for p in producers: p.start()
    for c in consumers: c.start()
    for p in producers: p.join()
    # wait for queue drain
    while len(b) > 0:
        time.sleep(0.01)
    for c in consumers: c.join()

    assert len(consumed) == n_items
    assert sorted(consumed) == list(range(n_items))
    print(f"  OK; produced={n_items} consumed={len(consumed)}")


def _close():
    print("--- close releases waiters ---")
    b: BoundedBuffer[int] = BoundedBuffer(1)
    b.put(1)  # full
    closed_seen = []

    def waiter():
        try:
            b.put(2, timeout=5)
        except RuntimeError:
            closed_seen.append("closed")

    t = threading.Thread(target=waiter)
    t.start()
    time.sleep(0.05)
    b.close()
    t.join(timeout=2)
    assert closed_seen == ["closed"]
    print("  OK")


if __name__ == "__main__":
    _basic()
    _put_blocks_when_full()
    _get_blocks_when_empty()
    _producer_consumer()
    _close()
    print("\nAll tests passed.")
```

---

## 4. Cross-Questions

### 4.1 Why two condition variables?
- One: every notify wakes all (put-blocked + get-blocked); spurious wakeups.
- Two: notify-not-empty for consumers; notify-not-full for producers.
- Targeted; avoids waking producers when only consumers should wake.

### 4.2 Why `while` not `if` on wait?
- Spurious wakeups are real.
- After wait returns, recheck condition.

### 4.3 Why deque vs list?
- `deque.append` and `popleft` are O(1).
- list.pop(0) is O(N).

### 4.4 Why explicit close?
- Producer-consumer normally runs forever; explicit close signals shutdown.
- Wakes blocked waiters.

### 4.5 Comparison with Python's queue.Queue?
- queue.Queue is the production answer.
- Our impl shows the primitive (Lock + Condition).

### 4.6 Memory cost?
- Just the queue contents.
- Plus Condition + Lock overhead.

---

## 5. Variants
- **Priority queue**: heap-based.
- **Lock-free** (Treiber stack, Michael-Scott queue) — SPSC easy; MPMC complex.
- **Async** (asyncio.Queue).

---

## 6. Cheat-Sheet
1. Bounded queue; deque inside.
2. Two cond vars: not_full, not_empty.
3. While-loop wait (spurious wakeups).
4. notify on put → wakes get; notify on get → wakes put.
5. Close wakes all waiters.

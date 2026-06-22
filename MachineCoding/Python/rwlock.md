# Read-Write Lock — Machine Coding (Python)

> **Difficulty:** Medium
> **Tags:** `[mc]` `[concurrency]` `[fairness]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

A regular lock lets only ONE thread inside at a time, even if all they're doing is reading. But reading a shared map doesn't conflict with another reader. A **read-write lock** is smarter:
- **Many readers** can hold the lock at once.
- **One writer** at a time, with no readers present.

This dramatically helps read-heavy workloads (caches, configs).

### Why solve it?

- **Real world**: Java's `ReentrantReadWriteLock`, Go's `sync.RWMutex`, Rust's `RwLock`. Used inside cache implementations, config systems.
- **Teaches**: concurrency fairness, the writer starvation problem.
- **Interview**: tests subtle concurrency thinking.

### Vocabulary

- **Reader** — wants to read; multiple OK simultaneously.
- **Writer** — wants to write; needs exclusive access.
- **Reader-prefer** — readers always allowed in if no writer is *active*. Writers can starve.
- **Writer-prefer** — once a writer is waiting, new readers wait. No writer starvation, but readers can wait longer.
- **Fair** — first-come, first-served regardless of role.

### High-level approach

State: `readers_active` (count), `writer_active` (bool), `writers_waiting` (count). A `Condition` variable.

**read_acquire()**: wait until `not writer_active and (writers_waiting == 0 or reader_prefer)`. Increment readers_active.
**read_release()**: decrement readers_active. If 0, notify a waiting writer.
**write_acquire()**: increment writers_waiting. Wait until `not writer_active and readers_active == 0`. Decrement writers_waiting; set writer_active.
**write_release()**: clear writer_active. Notify all (a writer could enter, or all waiting readers).

### How to read this doc

- **Beginner**: focus on the difference between Reader-prefer and Writer-prefer.
- **Interview**: discussing starvation scenarios is the differentiator.

---

## 0. Why this question

Tests **fairness in concurrency primitives**. Naive RW lock has writer starvation; correct one balances.

---

## 1. Modes

- **Reader-prefer**: readers go in fast; writers may starve.
- **Writer-prefer**: queued writer blocks new readers; readers may starve briefly.
- **Fair (FIFO)**: arrivals serviced in order.

We implement **writer-prefer** (most common production choice).

---

## 2. Code

```python
"""Reader-Writer lock with writer-prefer semantics."""
import threading
import time
from contextlib import contextmanager


class RWLock:
    def __init__(self):
        self._readers = 0           # active readers
        self._writer_active = False # active writer
        self._writers_waiting = 0   # writers waiting (for writer-prefer)
        self._lock = threading.Lock()
        self._cond = threading.Condition(self._lock)

    def acquire_read(self):
        with self._cond:
            # Wait if writer active OR writers are waiting (writer-prefer)
            while self._writer_active or self._writers_waiting > 0:
                self._cond.wait()
            self._readers += 1

    def release_read(self):
        with self._cond:
            self._readers -= 1
            if self._readers == 0:
                self._cond.notify_all()

    def acquire_write(self):
        with self._cond:
            self._writers_waiting += 1
            try:
                while self._writer_active or self._readers > 0:
                    self._cond.wait()
            finally:
                self._writers_waiting -= 1
            self._writer_active = True

    def release_write(self):
        with self._cond:
            self._writer_active = False
            self._cond.notify_all()

    @contextmanager
    def read(self):
        self.acquire_read()
        try:
            yield
        finally:
            self.release_read()

    @contextmanager
    def write(self):
        self.acquire_write()
        try:
            yield
        finally:
            self.release_write()


# Tests
def main():
    rw = RWLock()
    state = {"value": 0}

    print("--- single read ---")
    with rw.read():
        v = state["value"]
        assert v == 0
    print("  OK")

    print("--- single write ---")
    with rw.write():
        state["value"] = 5
    print("  OK")

    print("--- many concurrent readers ---")
    started = threading.Event()
    counter = {"reading": 0, "max": 0}
    cnt_lock = threading.Lock()

    def reader():
        started.wait()
        with rw.read():
            with cnt_lock:
                counter["reading"] += 1
                counter["max"] = max(counter["max"], counter["reading"])
            time.sleep(0.05)
            with cnt_lock:
                counter["reading"] -= 1

    threads = [threading.Thread(target=reader) for _ in range(10)]
    for t in threads: t.start()
    started.set()
    for t in threads: t.join()
    assert counter["max"] > 1, "should have multiple concurrent readers"
    print(f"  max concurrent readers: {counter['max']}")

    print("--- writer exclusive ---")
    rw2 = RWLock()
    timeline = []
    timeline_lock = threading.Lock()

    def writer():
        with rw2.write():
            with timeline_lock:
                timeline.append("W_in")
            time.sleep(0.05)
            with timeline_lock:
                timeline.append("W_out")

    def reader_late():
        time.sleep(0.01)  # let writer start
        with rw2.read():
            with timeline_lock:
                timeline.append("R")

    tw = threading.Thread(target=writer)
    tr = threading.Thread(target=reader_late)
    tw.start()
    tr.start()
    tw.join()
    tr.join()
    # Writer must finish before reader
    w_out_idx = timeline.index("W_out")
    r_idx = timeline.index("R")
    assert w_out_idx < r_idx, f"writer should finish first; timeline={timeline}"
    print(f"  timeline: {timeline}")

    print("--- writer-prefer (no writer starvation) ---")
    rw3 = RWLock()
    events = []
    ev_lock = threading.Lock()
    barrier = threading.Barrier(11)

    def long_reader(i):
        barrier.wait()
        with rw3.read():
            with ev_lock:
                events.append(f"R{i}_in")
            time.sleep(0.05)
            with ev_lock:
                events.append(f"R{i}_out")

    def writer_inline():
        time.sleep(0.01)
        with rw3.write():
            with ev_lock:
                events.append("W_in")
            with ev_lock:
                events.append("W_out")

    def late_reader():
        time.sleep(0.02)  # arrives after writer is queued
        with rw3.read():
            with ev_lock:
                events.append("R_late")

    readers = [threading.Thread(target=long_reader, args=(i,)) for i in range(10)]
    w = threading.Thread(target=writer_inline)
    r_late = threading.Thread(target=late_reader)
    for t in readers: t.start()
    barrier.wait()
    w.start()
    r_late.start()
    for t in readers + [w, r_late]:
        t.join()
    # Writer should run before R_late
    if "W_in" in events and "R_late" in events:
        w_idx = events.index("W_in")
        rl_idx = events.index("R_late")
        assert w_idx < rl_idx, f"writer should precede late reader; events={events}"
    print("  writer-prefer verified")

    print("\nAll tests passed.")


if __name__ == "__main__":
    main()
```

---

## 3. Cross-Questions

### 3.1 Reader-prefer vs writer-prefer?
- Reader-prefer: high read throughput; writer starvation.
- Writer-prefer: writes guaranteed; brief reader pause.
- Fair (FIFO): no starvation either side.

### 3.2 Why writer-prefer here?
Most production systems prefer this — write semantics matter more (data must update).

### 3.3 RLock for re-entrancy?
Standard threading.RLock is reentrant (same thread can acquire twice). Our RWLock isn't reentrant; document.

### 3.4 vs Python's threading?
threading has no built-in RWLock. (asyncio has aio-RWLock libs.)

### 3.5 What about upgrading read → write?
Easy way: release read, acquire write. Race window in between.
Atomic upgrade: complex; usually not supported.

---

## 4. Cheat-Sheet
1. Counter for active readers; flag for active writer.
2. Writers_waiting counter for writer-prefer policy.
3. Condition variable for signaling.
4. Acquire-read blocks if writer active OR writers waiting.
5. Acquire-write blocks if writer active OR readers > 0.

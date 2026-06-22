# Connection Pool — Machine Coding (Python)

> **Difficulty:** Medium
> **Tags:** `[mc]` `[concurrency]` `[resource-pool]` `[timeout]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

Opening a database connection is **expensive** (~10-100ms — the network handshake, auth, etc.). If every web request opens its own, your app crawls. Solution: open N connections at startup, keep them alive, and **lend them out** to whoever needs one. After use, the borrower returns it, ready for the next caller. That's a **connection pool**.

### Why solve it?

- **Real world**: every DB driver (psycopg, SQLAlchemy, Go's database/sql) has a pool. HTTP clients pool TCP connections. Reusing thread pools, GPU contexts — same shape.
- **Teaches**: bounded resource management, timeouts, lifecycle (create, validate, close).
- **Interview**: tests blocking acquire-with-timeout — a non-trivial concurrency primitive.

### Vocabulary

- **Pool** — a fixed-size collection of reusable resources.
- **Acquire / Release** — borrow a resource / return it.
- **Timeout** — give up if you can't get one in T seconds.
- **Validation** — check the connection is still alive before lending it.
- **Idle timeout** — close connections that have sat unused too long.

### High-level approach

State: a queue of available connections, a counter of total opened.

**acquire(timeout)**:
1. Try to take one from the queue (with timeout).
2. If the queue is empty AND total < max → create one, return.
3. If timed out → raise.

**release(conn)**:
1. Validate (or recreate if dead).
2. Push back to the queue.

Most languages have `BlockingQueue.poll(timeout)` (Python: `queue.Queue.get(timeout=...)`). That's the key primitive.

### How to read this doc

- **Beginner**: focus on the queue + counter design.
- **Interview**: edge cases (timeouts, dead connections, leaks if release isn't called) are the meat.

---

## 0. Why this question

Tests **bounded resource pool, blocking acquire with timeout, lifecycle management**. Pattern reused for any resource (DB conns, HTTP clients).

---

## 1. Problem Statement

A connection pool:
- `acquire(timeout) -> Connection` (blocks if all in use; times out).
- `release(conn)` — return to pool.
- `close()` — close all conns.
- Validates conns (probe on acquire).

---

## 2. Approach

```
pool = bounded queue of available connections
acquired count
on acquire:
   if available: return one
   else if can create more: create
   else: block on cond var with timeout
on release: push back to queue, notify
```

---

## 3. Code

```python
"""Generic connection pool with bounded size + timeout."""
import threading
import time
from typing import Callable, Generic, TypeVar, Optional

T = TypeVar("T")


class PoolError(Exception): ...
class PoolClosed(PoolError): ...
class AcquireTimeout(PoolError): ...


class ConnectionPool(Generic[T]):
    def __init__(self,
                 factory: Callable[[], T],
                 closer: Callable[[T], None],
                 max_size: int = 10,
                 validator: Optional[Callable[[T], bool]] = None) -> None:
        self._factory = factory
        self._closer = closer
        self._validator = validator or (lambda x: True)
        self._max_size = max_size
        self._available: list[T] = []
        self._in_use: set = set()
        self._lock = threading.Lock()
        self._cond = threading.Condition(self._lock)
        self._closed = False

    def acquire(self, timeout: Optional[float] = None) -> T:
        deadline = (time.monotonic() + timeout) if timeout is not None else None
        with self._cond:
            while True:
                if self._closed:
                    raise PoolClosed()
                # Try to take from available
                while self._available:
                    conn = self._available.pop()
                    if self._validator(conn):
                        self._in_use.add(id(conn))
                        return conn
                    # invalid conn; close + drop
                    self._closer(conn)
                # Try to create
                if len(self._in_use) < self._max_size:
                    conn = self._factory()
                    self._in_use.add(id(conn))
                    return conn
                # Block until release or timeout
                if deadline is None:
                    self._cond.wait()
                else:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise AcquireTimeout()
                    self._cond.wait(remaining)

    def release(self, conn: T) -> None:
        with self._cond:
            cid = id(conn)
            if cid not in self._in_use:
                # Unknown conn; ignore (defensive)
                return
            self._in_use.discard(cid)
            if self._closed:
                self._closer(conn)
            else:
                self._available.append(conn)
                self._cond.notify()

    def close(self) -> None:
        with self._cond:
            self._closed = True
            for c in self._available:
                self._closer(c)
            self._available.clear()
            self._cond.notify_all()

    def stats(self) -> dict:
        with self._lock:
            return {
                "available": len(self._available),
                "in_use": len(self._in_use),
                "max_size": self._max_size,
                "closed": self._closed,
            }


# ─── Tests ───

class FakeConn:
    next_id = 0
    def __init__(self):
        FakeConn.next_id += 1
        self.id = FakeConn.next_id
        self.closed = False


def _basic():
    print("--- basic ---")
    pool = ConnectionPool(
        factory=FakeConn,
        closer=lambda c: setattr(c, "closed", True),
        max_size=2,
    )
    c1 = pool.acquire()
    c2 = pool.acquire()
    # third should time out
    try:
        pool.acquire(timeout=0.1)
        assert False
    except AcquireTimeout:
        pass
    pool.release(c1)
    c3 = pool.acquire()
    assert c3.id == c1.id  # reused
    pool.release(c2); pool.release(c3)
    pool.close()
    print("  OK")


def _validator():
    print("--- validator ---")
    closed = []
    rejected_ids: set[int] = set()
    pool = ConnectionPool(
        factory=FakeConn,
        closer=lambda c: closed.append(c),
        max_size=2,
        validator=lambda c: c.id not in rejected_ids,
    )
    c1 = pool.acquire()
    pool.release(c1)
    # Mark c1 as rejected — next acquire should close it and create new
    rejected_ids.add(c1.id)
    c2 = pool.acquire()
    assert c2.id != c1.id, f"expected new conn; got same {c1.id}={c2.id}"
    assert c1 in closed
    pool.close()
    print("  OK")


def _concurrent():
    print("--- concurrent ---")
    FakeConn.next_id = 0
    pool = ConnectionPool(
        factory=FakeConn,
        closer=lambda c: None,
        max_size=5,
    )
    used = []
    used_lock = threading.Lock()
    def worker():
        c = pool.acquire(timeout=2)
        with used_lock:
            used.append(c.id)
        time.sleep(0.01)
        pool.release(c)
    threads = [threading.Thread(target=worker) for _ in range(50)]
    for t in threads: t.start()
    for t in threads: t.join()
    # max simultaneous = 5; total acquires = 50
    distinct = len(set(used))
    assert distinct <= 5  # never more than max_size connections used
    pool.close()
    print(f"  OK; used {distinct} distinct connections (max 5)")


def _close_releases_waiters():
    print("--- close releases waiters ---")
    pool = ConnectionPool(
        factory=FakeConn, closer=lambda c: None, max_size=1
    )
    c1 = pool.acquire()
    errors = []
    def waiter():
        try:
            pool.acquire(timeout=5)
        except PoolClosed:
            errors.append("closed")
    t = threading.Thread(target=waiter)
    t.start()
    time.sleep(0.05)
    pool.close()
    t.join(timeout=2)
    assert errors == ["closed"]
    print("  OK")


if __name__ == "__main__":
    _basic()
    _validator()
    _concurrent()
    _close_releases_waiters()
    print("\nAll tests passed.")
```

---

## 4. Cross-Questions

### 4.1 Why bounded?
- Resource (DB, HTTP) typically limited.
- Unbounded creates risk: connection storm under load.

### 4.2 Why validator?
- Stale/dead conns may be in pool.
- Probe on acquire avoids client-visible failure.
- Simple validator: `is_alive()` ping; complex: actual no-op query.

### 4.3 Why notify_all on close?
- Multiple waiters; all should see closed state.

### 4.4 Why Lock + Condition vs queue.Queue?
- `queue.Queue` works for the data; not for the "create on demand up to max" logic.
- Condition gives flexibility.

### 4.5 What if connection dies while in use?
- Caller detects + releases.
- Validator on next acquire kicks it out.

### 4.6 What about connection idle timeout?
- Periodic sweep: close conns idle > N min.
- Out of scope in P0.

### 4.7 What about per-thread connections?
- Some libs (e.g. Postgres) use thread-local conns.
- Different design.

---

## 5. Variants
- **Async** version (asyncio + asyncio.Queue).
- **Sticky** (one conn per thread).
- **Distributed pool** (cross-process).

---

## 6. Cheat-Sheet
1. Bounded pool: `available` list + `in_use` set + max_size.
2. Acquire: take from available; create if room; else wait.
3. Release: return to available; notify.
4. Validator on acquire to filter dead conns.
5. Close releases all waiters with PoolClosed.

# Token Bucket Rate Limiter — Machine Coding (Python)

> **Difficulty:** Medium
> **Tags:** `[mc]` `[concurrency]` `[rate-limit]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

You run an API. To stop one user from hammering it 1000 times/sec, you **rate-limit**: only 10 calls/sec, say. The **token bucket** is a beautifully simple way to do this:
- Every user has a bucket holding up to N tokens (e.g., 10).
- Tokens refill at R per second (e.g., 10/sec).
- Every call costs 1 token. No tokens? Reject.

This naturally allows **bursts** — if the user has been quiet, the bucket fills up; they can spend the whole bucket at once.

### Why solve it?

- **Real world**: AWS/GitHub/Stripe rate limits, web server protection, BGP routing fairness, Linux's `tc` traffic shaping.
- **Teaches**: time-based math, lazy refill, thread-safe state, fairness vs burst tolerance.
- **Interview**: classic. Often asked alongside "now make it distributed."

### Vocabulary

- **Rate limit** — cap on operations over time.
- **Bucket capacity (burst)** — max tokens the bucket can hold.
- **Refill rate** — tokens added per second.
- **Lazy refill** — don't run a background thread; on every check, compute "how many tokens since last check?" and add them (capped).

### High-level approach

For each user (key), track `(tokens, last_refill_time)`.

**allow(key)**:
1. Lock.
2. Compute `elapsed = now - last_refill_time`.
3. Add `elapsed * rate` tokens, capped at capacity.
4. Update `last_refill_time = now`.
5. If `tokens >= 1`: subtract 1, return true.
6. Else: return false.

The lock matters: two threads checking simultaneously could both spend the last token if naively coded.

### How to read this doc

- **Beginner**: trace the lazy-refill math by hand for 3 calls in a row.
- **Interview**: be ready to compare to leaky bucket, fixed window, sliding window.

---

## 0. Why this question

Rate limiter is canonical interview MC. Token bucket: simple math, real-world useful, thread-safe is the trick.

---

## 1. Problem Statement

Per-key rate limiter:
- `allow(key) -> bool` (or `allow(key, cost=1)`)
- Configurable rate (tokens/sec) and capacity (max burst).
- Thread-safe.

---

## 2. Approach

```
Per key:
  tokens float
  last_refill float (timestamp)

allow:
  now = time.now()
  tokens = min(capacity, tokens + (now - last_refill) * rate)
  last_refill = now
  if tokens >= cost:
     tokens -= cost
     return True
  return False
```

---

## 3. Code

```python
"""Token bucket rate limiter (per-key, thread-safe)."""
import threading
import time
from dataclasses import dataclass


@dataclass
class _Bucket:
    tokens: float
    last_refill: float
    capacity: float
    rate: float

    def try_consume(self, cost: float, now: float) -> bool:
        elapsed = max(0, now - self.last_refill)
        self.tokens = min(self.capacity, self.tokens + elapsed * self.rate)
        self.last_refill = now
        if self.tokens >= cost:
            self.tokens -= cost
            return True
        return False


class RateLimiter:
    def __init__(self, capacity: float, rate: float) -> None:
        self._capacity = capacity
        self._rate = rate
        self._buckets: dict[str, _Bucket] = {}
        self._lock = threading.Lock()

    def allow(self, key: str, cost: float = 1.0, now: float | None = None) -> bool:
        if cost <= 0:
            raise ValueError("cost must be positive")
        if now is None:
            now = time.monotonic()
        with self._lock:
            b = self._buckets.get(key)
            if b is None:
                b = _Bucket(tokens=self._capacity, last_refill=now,
                           capacity=self._capacity, rate=self._rate)
                self._buckets[key] = b
            return b.try_consume(cost, now)


# ─── Tests ───

def _basic():
    print("--- basic ---")
    rl = RateLimiter(capacity=5, rate=1)  # 5 tokens, refill 1/sec
    t0 = 0
    # 5 fast requests OK; 6th rejected
    for i in range(5):
        assert rl.allow("u", now=t0) is True
    assert rl.allow("u", now=t0) is False
    # After 1 sec, 1 more token
    assert rl.allow("u", now=t0 + 1) is True
    assert rl.allow("u", now=t0 + 1) is False
    print("  OK")


def _refill():
    print("--- refill ---")
    rl = RateLimiter(capacity=10, rate=10)  # 10/s
    t0 = 0
    for i in range(10):
        assert rl.allow("u", now=t0) is True
    # After 0.5s: 5 more tokens
    for i in range(5):
        assert rl.allow("u", now=t0 + 0.5) is True
    assert rl.allow("u", now=t0 + 0.5) is False
    print("  OK")


def _per_key():
    print("--- per-key isolated ---")
    rl = RateLimiter(capacity=3, rate=1)
    t = 0
    for _ in range(3):
        assert rl.allow("user-A", now=t)
    assert not rl.allow("user-A", now=t)
    # different key fresh
    for _ in range(3):
        assert rl.allow("user-B", now=t)
    print("  OK")


def _concurrent():
    print("--- concurrent ---")
    rl = RateLimiter(capacity=100, rate=0)  # no refill
    succ = 0
    succ_lock = threading.Lock()
    def fire():
        nonlocal succ
        if rl.allow("u", now=time.monotonic()):
            with succ_lock:
                succ += 1
    threads = [threading.Thread(target=fire) for _ in range(500)]
    for t in threads: t.start()
    for t in threads: t.join()
    assert succ == 100, f"got {succ}"
    print("  OK; exactly 100 succeeded")


def _cost():
    print("--- cost ---")
    rl = RateLimiter(capacity=10, rate=0)
    t = 0
    assert rl.allow("u", cost=5, now=t) is True
    assert rl.allow("u", cost=5, now=t) is True
    assert rl.allow("u", cost=1, now=t) is False
    print("  OK")


if __name__ == "__main__":
    _basic()
    _refill()
    _per_key()
    _concurrent()
    _cost()
    print("\nAll tests passed.")
```

---

## 4. Cross-Questions

### 4.1 Why token bucket vs leaky bucket?
- Token: allows bursts up to capacity.
- Leaky: smooths output to constant rate.
- Token bucket is the user-friendly default.

### 4.2 Thread safety?
- Single Lock per RateLimiter.
- Fine-grained: per-key Lock would parallelize but adds complexity.

### 4.3 Memory?
- One Bucket per key.
- For 1M keys: ~1M × 64 bytes = 64 MB. Manageable.
- Eviction: LRU on idle keys.

### 4.4 Why `time.monotonic()`?
- Wall-clock can go backwards (NTP adjust); monotonic is one-way.

### 4.5 What if rate=0?
- Bucket only depletes; never refills.
- Useful for "fixed quota" scenarios.

### 4.6 What about distributed?
- Single-process: this works.
- Distributed: see HLD `rate-limiter.md` (Redis Lua atomic).

### 4.7 Why min(capacity, ...) for tokens?
- Cap the burst.
- Without: long-idle keys would have infinite saved tokens.

### 4.8 What if cost > capacity?
- Reject indefinitely.
- Detect: error at config time.

---

## 5. Variants
- **Sliding window counter**: see HLD doc.
- **Leaky bucket**: implementation similar but bucket fills up; no refill metaphor.
- **Distributed**: Redis-backed (see HLD).

---

## 6. Cheat-Sheet
1. Per-key Bucket: tokens, last_refill.
2. On allow: refill based on elapsed; consume if enough.
3. Thread-safe via single Lock.
4. Capacity = max burst; rate = sustained rate.

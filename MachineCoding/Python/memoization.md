# Memoization Wrapper — Machine Coding (Python)

> **Difficulty:** Medium
> **Tags:** `[mc]` `[caching]` `[generics]` `[ttl]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

If a function always returns the same answer for the same input — and computing it is expensive — you can save the result the first time and just reuse it after. That's **memoization**. Like Post-it notes: write the answer once, peek at the note next time someone asks the same question.

Python has `@functools.lru_cache` for this; we build our own to understand how, and to add features (TTL, thread safety, custom keys).

### Why solve it?

- **Real world**: any expensive pure function (recursion, API calls with idempotent results, math).
- **Teaches**: decorators, building cache keys, thread-safe lookup, TTL.
- **Interview**: shows mastery of decorators, generics, and concurrency together.

### Vocabulary

- **Memoize** — cache a function's results by input.
- **Pure function** — same input → same output, no side effects. (Required for memoization to be safe.)
- **Cache key** — a hashable representation of the inputs.
- **TTL** — time-to-live; how long an entry is valid.
- **Decorator** — a function that wraps another function, often via `@` syntax.

### High-level approach

A `memoize` decorator:
1. Builds a `cache_key` from `*args, **kwargs`. (Tricky: kwargs need stable ordering.)
2. On call, checks the cache. If present (and not expired), return cached.
3. Otherwise, call the underlying function, store the result.
4. With TTL: also store a timestamp; reject entries older than TTL.
5. With thread-safety: a lock around get/set.

```python
@memoize(ttl=60)
def fetch_weather(city): ...
```

### How to read this doc

- **Beginner**: focus on the basic decorator + key-building.
- **Interview**: TTL + thread-safety variants are the differentiator.

---

## 0. Why this question

Memoization wraps pure functions with a cache. Tests **decorator pattern, generic key building, TTL, thread safety**.

---

## 1. API

```
@memoize(maxsize=128, ttl=300)
def fn(*args, **kwargs):
    ...
```

Or programmatic: `mem = Memoizer(fn, ...); mem(x, y)`.

---

## 2. Code

```python
"""Memoization decorator with TTL + max size."""
from __future__ import annotations
import functools
import threading
import time
from collections import OrderedDict
from typing import Callable, TypeVar, ParamSpec, Optional

P = ParamSpec("P")
T = TypeVar("T")


def memoize(maxsize: int = 128, ttl: Optional[float] = None,
            key_fn: Optional[Callable] = None) -> Callable[[Callable[P, T]], Callable[P, T]]:
    """Decorator: cache results with optional TTL and LRU eviction."""

    def decorator(fn: Callable[P, T]) -> Callable[P, T]:
        cache: OrderedDict[object, tuple[T, float]] = OrderedDict()
        lock = threading.Lock()

        def _key(*args, **kwargs):
            if key_fn is not None:
                return key_fn(*args, **kwargs)
            return (args, frozenset(kwargs.items()))

        @functools.wraps(fn)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
            k = _key(*args, **kwargs)
            now = time.monotonic()
            with lock:
                if k in cache:
                    value, expires_at = cache[k]
                    if ttl is None or now < expires_at:
                        cache.move_to_end(k)  # LRU touch
                        return value
                    else:
                        # Expired
                        del cache[k]
            # Compute outside lock to avoid blocking other callers
            result = fn(*args, **kwargs)
            expires = (now + ttl) if ttl is not None else float("inf")
            with lock:
                cache[k] = (result, expires)
                cache.move_to_end(k)
                while len(cache) > maxsize:
                    cache.popitem(last=False)  # LRU
            return result

        wrapper.cache = cache  # type: ignore[attr-defined]
        wrapper.clear = lambda: cache.clear()  # type: ignore[attr-defined]
        return wrapper
    return decorator


# ─── Tests ───
def main():
    print("--- basic ---")
    calls = {"n": 0}

    @memoize(maxsize=3)
    def fib(n: int) -> int:
        calls["n"] += 1
        if n < 2:
            return n
        return fib(n - 1) + fib(n - 2)

    assert fib(20) == 6765
    print(f"  fib(20) computed {calls['n']} times (efficient memoization)")
    # Without memoization: 21k calls. With: 21.

    print("--- LRU eviction ---")
    @memoize(maxsize=2)
    def f(x):
        return x * 2

    f(1); f(2); f(3)
    # 1 should be evicted (LRU)
    assert 1 not in [k[0][0] for k in f.cache.keys()]
    print("  OK")

    print("--- TTL ---")
    counter = {"n": 0}
    @memoize(maxsize=10, ttl=0.1)
    def slow(x):
        counter["n"] += 1
        return x

    slow(1); slow(1)  # second is cached
    assert counter["n"] == 1
    time.sleep(0.15)
    slow(1)  # expired; recomputed
    assert counter["n"] == 2
    print("  OK")

    print("--- thread safe ---")
    @memoize(maxsize=100)
    def expensive(x):
        time.sleep(0.001)
        return x * x

    results = []
    results_lock = threading.Lock()
    def worker(start, count):
        local = []
        for i in range(start, start + count):
            local.append(expensive(i))
        with results_lock:
            results.extend(local)

    threads = [threading.Thread(target=worker, args=(i*10, 10)) for i in range(10)]
    for t in threads: t.start()
    for t in threads: t.join()
    assert len(results) == 100
    print("  OK")

    print("--- custom key fn ---")
    @memoize(maxsize=10, key_fn=lambda d: d["id"])
    def lookup(d):
        return d["id"] * 2

    assert lookup({"id": 5, "data": "abc"}) == 10
    assert lookup({"id": 5, "data": "different"}) == 10  # same id
    print("  OK")

    print("\nAll tests passed.")


if __name__ == "__main__":
    main()
```

---

## 3. Cross-Questions

### 3.1 vs functools.lru_cache?
Python's stdlib has `lru_cache(maxsize)` and `cache`.
Ours adds: TTL, custom key_fn.

### 3.2 Why frozenset for kwargs?
Dicts aren't hashable. frozenset of items is.

### 3.3 OrderedDict for LRU?
move_to_end on access; popitem(last=False) for eviction.
Same DLL semantics as our LRU MC.

### 3.4 Compute outside lock?
For long-running fn, blocking other callers is bad.
Trade: same key may be computed in parallel by N threads → wasted work.
Mitigation: per-key locks (singleflight pattern).

### 3.5 Singleflight (collapse)?
Only one in-flight fetch per key; others wait.
Useful for expensive functions or external API calls.

### 3.6 What if function raises?
Don't cache the exception; let it propagate.
Subsequent calls retry.
Optional: cache exceptions for negative caching.

---

## 4. Cheat-Sheet
1. OrderedDict = LRU + dict.
2. Key from args + kwargs.
3. TTL via expiry timestamp.
4. Compute outside lock.
5. functools.wraps preserves metadata.

# LRU Cache — Machine Coding (Python)

> **Difficulty:** Medium (the most-asked machine coding question)
> **Tags:** `[machine-coding]` `[data-structure]` `[hashmap]` `[doubly-linked-list]` `[concurrency]`
> **Language:** Python 3.10+
> **Time budget in interview:** 60–90 min
> **Companies that ask this:** Atlassian, Razorpay, Flipkart, Uber, every L4+ machine-coding round

---

## Beginner's Guide

### What's this in plain English?

Your laptop has fast RAM (small) and a slow disk (big). When RAM fills up, something has to go. An **LRU cache** picks what to evict: whatever was used least recently. Picture a small desk where you keep books you're using; if a new book arrives and the desk is full, the book you haven't touched longest goes back to the shelf.

### Why solve it?

- **Real world**: every browser, database, CPU, and CDN uses LRU or a close cousin.
- **Teaches**: combining a hashmap with a doubly linked list to get **O(1) get + O(1) put + O(1) eviction** — a clever trick once it clicks.
- **Interview classic**: probably the most-asked machine-coding question.

### Vocabulary

- **Cache** — a small fast store sitting in front of a big slow store.
- **Capacity** — max items the cache holds.
- **Eviction** — removing an item to free space.
- **Hit / Miss** — `get(key)` found the value (hit) vs didn't (miss).
- **O(1)** — operation takes the same time no matter how much data; constant time.
- **Doubly linked list** — list nodes have pointers to both neighbors, so you can remove a middle node in O(1) without scanning.

### High-level approach

Two data structures working together:

1. **Hashmap (`key → node`)** — find any node in O(1).
2. **Doubly linked list** — keeps order: most-recent at the head, least-recent at the tail.

Operations:
- **`get(key)`**: hashmap lookup → if found, move that node to head, return value.
- **`put(key, val)`**: if exists → update + move to head. Otherwise → new head node; if at capacity, drop the tail.

Why both? The hashmap alone gives O(1) lookup but no order. The list alone gives order but O(n) lookup. Combined → O(1) for everything.

### How to read this doc

- **Beginner**: read sections 1–3 carefully (problem, design, code).
- **Interview prep**: read everything; cross-questions matter most.

---

## 0. How to use this doc in an interview

LRU is **the** machine coding warmup. Interviewers expect:
1. **O(1) get and put.** Anything else is wrong.
2. The **correct data structure**: hashmap + doubly-linked list. Not a heap. Not a tree.
3. **Thread-safe variant** when asked.
4. **Tests** for edge cases — empty, full, eviction order, concurrent access.

The trap: candidates use `OrderedDict` and call it a day. That's *cheating* the question (it's exactly the impl) — show you know the cheating answer, then implement explicitly.

The bar:
- 30 min for working core (get / put / eviction).
- 15 min for thread safety + tests.
- 15 min for variants discussion (LFU, ARC, TTL, sharded).

---

## 1. Problem Statement

Design a fixed-capacity cache that supports `get(key)` and `put(key, value)` in **O(1)** average time. When capacity is exceeded, evict the **least-recently-used** entry. Recency is touched by both `get` and `put`.

### Constraints
- Time: O(1) for get/put.
- Memory: O(N) where N is capacity.
- Thread safety: optional (we provide both).
- Generics: ideally.

---

## 2. Clarifying Questions

- [ ] What types are keys / values? Hashable keys, any value.
- [ ] What does `get` on a missing key return — `None`, raise, or sentinel?
- [ ] Is `get` allowed to mutate (move-to-front)? Standard LRU: yes.
- [ ] `put` of an existing key — update value AND refresh recency? Yes.
- [ ] `capacity = 0` — reject or be a no-op cache?
- [ ] Need TTL / expiration?
- [ ] Need stats (hit/miss counts)?
- [ ] Thread-safe?

> **For this doc:** keys are hashable, missing-key get returns `None` + `False` flag, both ops touch recency, capacity > 0, no TTL (extension), hit/miss stats included, thread-safe variant provided.

---

## 3. API Contract

```python
class LRUCache(Generic[K, V]):
    def __init__(self, capacity: int) -> None: ...
    def get(self, key: K) -> tuple[V | None, bool]:    # (value, found)
    def put(self, key: K, value: V) -> None:
    def delete(self, key: K) -> bool:
    def __len__(self) -> int:
    def stats(self) -> dict:
```

| Method | Pre | Post | Time |
|---|---|---|---|
| `get` | — | If found, key becomes MRU | O(1) avg |
| `put` | — | Inserts or updates; may evict | O(1) avg |
| `delete` | — | Removes key if present | O(1) avg |
| `__len__` | — | current size | O(1) |
| `stats` | — | dict of hit/miss/eviction counts | O(1) |

---

## 4. Approach + Data Structure

### Why hashmap + doubly-linked list

- **Hashmap**: `key → node pointer` for O(1) lookup.
- **Doubly-linked list**: ordered by recency. Head = MRU, tail-prev = LRU.
- On `get`: hashmap lookup → unlink node → push to head. O(1).
- On `put`: if key exists → update + move to head; else create node, push to head, hashmap insert; if over capacity → unlink tail-prev (LRU), remove from hashmap. O(1).

Sentinels (dummy head and tail) eliminate special cases for empty list and end-of-list.

### Visual

```
                 hashmap
              ┌───────────┐
        "a" ──┤ node ptr  │
        "b" ──┤ node ptr  │
        "c" ──┤ node ptr  │
              └───────────┘

   head ◀──▶ [a:1] ◀──▶ [c:3] ◀──▶ [b:2] ◀──▶ tail
   (sentinel)                                  (sentinel)
       MRU ─────────────────────────────────▶ LRU
```

### Invariants

1. Every key in `map` corresponds to exactly one node in the list, and vice versa.
2. `len(map) == real_size <= capacity` (real_size excludes sentinels).
3. Head's next is always the MRU node (or tail sentinel if empty).
4. Tail's prev is always the LRU node (or head sentinel if empty).
5. After every public method returns: invariants hold.

---

## 5. Full Working Code

```python
"""
LRU Cache — Machine Coding (Python)

- Generic over (K, V).
- O(1) get / put / delete.
- Single-thread + thread-safe (mutex) variants.
- Stats: hits, misses, evictions.
- Tests at the bottom (also runs as a smoke-test demo).
"""

from __future__ import annotations

import threading
from typing import Generic, TypeVar, Optional

K = TypeVar("K")
V = TypeVar("V")


class _Node(Generic[K, V]):
    __slots__ = ("key", "value", "prev", "next")

    def __init__(self, key: Optional[K] = None, value: Optional[V] = None) -> None:
        self.key: Optional[K] = key
        self.value: Optional[V] = value
        self.prev: Optional["_Node[K, V]"] = None
        self.next: Optional["_Node[K, V]"] = None


class LRUCache(Generic[K, V]):
    """Single-threaded LRU. Wrap with ThreadSafeLRU for concurrent use."""

    def __init__(self, capacity: int) -> None:
        """Initialize an empty cache of given capacity.

        Why sentinels: the head and tail dummy nodes mean we never need
        special cases for "list is empty" or "node is at the boundary."
        Every real node always has a prev and next.

        Interview tip: stress that capacity is fixed at construction —
        resizing-on-the-fly is its own design problem.
        """
        if capacity <= 0:
            raise ValueError("capacity must be positive")
        self._cap = capacity
        self._map: dict[K, _Node[K, V]] = {}
        # sentinel head ↔ tail
        self._head: _Node[K, V] = _Node()
        self._tail: _Node[K, V] = _Node()
        self._head.next = self._tail
        self._tail.prev = self._head
        self._hits = 0
        self._misses = 0
        self._evictions = 0

    # ─── public API ─────────────────────────────────────────────────────

    def get(self, key: K) -> tuple[Optional[V], bool]:
        """Look up `key`; on hit, mark it most-recently-used.

        Why this approach: the hashmap finds the node in O(1); _move_to_front
        unlinks and re-inserts at the head, also O(1) thanks to doubly-linked
        list pointers. That's the whole reason this data structure works.

        Interview tip: emphasize that get is a WRITE operation under the hood
        (it mutates recency). This is why a plain RWMutex won't help in the
        thread-safe version.
        """
        node = self._map.get(key)
        if node is None:
            self._misses += 1
            return None, False
        self._move_to_front(node)
        self._hits += 1
        return node.value, True

    def put(self, key: K, value: V) -> None:
        """Insert or update `key`; on overflow, evict the LRU entry.

        Why this approach: existing keys are updated in place + moved to head;
        new keys create a node, register it in the map, push to head, then
        check capacity. Evicting AFTER insert keeps the size invariant clear.

        Interview tip: the order — insert first, then evict — matters when
        capacity is 1 and the same key is being put repeatedly.
        """
        node = self._map.get(key)
        if node is not None:
            node.value = value
            self._move_to_front(node)
            return
        # new key
        node = _Node(key=key, value=value)
        self._map[key] = node
        self._add_to_front(node)
        if len(self._map) > self._cap:
            self._evict_lru()

    def delete(self, key: K) -> bool:
        """Remove `key`; return True if it was present, False otherwise."""
        node = self._map.pop(key, None)
        if node is None:
            return False
        self._unlink(node)
        return True

    def __len__(self) -> int:
        """Current number of entries (excludes sentinels)."""
        return len(self._map)

    def __contains__(self, key: K) -> bool:
        """Membership check that does NOT update recency.

        Interview tip: most LRU APIs DON'T provide this; some interviewers
        will ask why we expose it. Answer: cache health checks should not
        skew the eviction order.
        """
        return key in self._map

    def stats(self) -> dict:
        """Snapshot of hit / miss / eviction counters and current size."""
        total = self._hits + self._misses
        return {
            "size": len(self._map),
            "capacity": self._cap,
            "hits": self._hits,
            "misses": self._misses,
            "hit_rate": (self._hits / total) if total else 0.0,
            "evictions": self._evictions,
        }

    # ─── private list ops ──────────────────────────────────────────────

    def _add_to_front(self, node: _Node[K, V]) -> None:
        """Splice `node` in just after the head sentinel — making it MRU.

        Interview tip: always update FOUR pointers — node.prev, node.next,
        head.next, and the old front's prev. Drawing the picture on the
        whiteboard prevents off-by-one bugs.
        """
        nxt = self._head.next
        node.prev = self._head
        node.next = nxt
        self._head.next = node
        nxt.prev = node

    def _unlink(self, node: _Node[K, V]) -> None:
        """Remove `node` from the list (clears its prev/next refs too)."""
        prv, nxt = node.prev, node.next
        prv.next = nxt
        nxt.prev = prv
        node.prev = None
        node.next = None

    def _move_to_front(self, node: _Node[K, V]) -> None:
        """Mark `node` as most-recently-used (unlink + add to front)."""
        self._unlink(node)
        self._add_to_front(node)

    def _evict_lru(self) -> None:
        """Drop the LRU entry (just before tail sentinel) and increment counter.

        Why this approach: tail.prev is always the LRU node when non-empty,
        so eviction is O(1). The check `lru is self._head` defensively
        handles the empty-list case (shouldn't happen in normal flow).
        """
        lru = self._tail.prev
        if lru is self._head:
            return  # empty
        self._unlink(lru)
        del self._map[lru.key]
        self._evictions += 1


class ThreadSafeLRU(LRUCache[K, V]):
    """Drop-in thread-safe variant: single mutex around every public method.

    Note: `get` mutates recency, so RWLock is wrong (every read is a write).
    A coarse mutex is the correct primitive here.
    """

    def __init__(self, capacity: int) -> None:
        super().__init__(capacity)
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            return super().get(key)

    def put(self, key, value):
        with self._lock:
            super().put(key, value)

    def delete(self, key):
        with self._lock:
            return super().delete(key)

    def __len__(self):
        with self._lock:
            return super().__len__()

    def stats(self):
        with self._lock:
            return super().stats()


# ─── tests / demo ─────────────────────────────────────────────────────

def _basic_tests() -> None:
    print("--- basic tests ---")
    c: LRUCache[str, int] = LRUCache(3)
    assert len(c) == 0
    assert c.get("a") == (None, False)

    c.put("a", 1)
    c.put("b", 2)
    c.put("c", 3)
    assert len(c) == 3
    assert c.get("a") == (1, True)   # a is now MRU; LRU = b

    c.put("d", 4)                    # evicts b
    assert c.get("b") == (None, False)
    assert c.get("c") == (3, True)
    assert c.get("d") == (4, True)
    assert c.get("a") == (1, True)
    assert len(c) == 3

    # Update existing
    c.put("a", 100)
    assert c.get("a") == (100, True)
    assert len(c) == 3               # update doesn't grow

    # Delete
    assert c.delete("a") is True
    assert c.delete("a") is False
    assert len(c) == 2

    # Stats
    s = c.stats()
    print(f"  stats after sequence: {s}")
    assert s["evictions"] == 1
    assert s["size"] == 2
    print("  basic OK")


def _eviction_order_test() -> None:
    print("--- eviction order ---")
    c: LRUCache[str, int] = LRUCache(3)
    for k in ["a", "b", "c"]:
        c.put(k, ord(k))
    # touch a → c is now LRU after b
    c.get("a")
    c.put("d", ord("d"))   # evicts b (LRU)
    assert "b" not in c
    assert "a" in c and "c" in c and "d" in c
    print("  eviction order OK")


def _capacity_one_test() -> None:
    print("--- capacity=1 ---")
    c: LRUCache[str, int] = LRUCache(1)
    c.put("a", 1)
    c.put("b", 2)
    assert c.get("a") == (None, False)
    assert c.get("b") == (2, True)
    print("  capacity=1 OK")


def _stress_concurrent() -> None:
    print("--- concurrent stress ---")
    cache: ThreadSafeLRU[int, int] = ThreadSafeLRU(100)
    errors: list[str] = []

    def worker(tid: int):
        try:
            for i in range(1000):
                k = (tid * 1000 + i) % 200
                cache.put(k, k * 10)
                v, ok = cache.get(k)
                if ok and v != k * 10:
                    errors.append(f"corruption: tid={tid} k={k} v={v}")
        except Exception as e:
            errors.append(f"tid={tid} exception={e}")

    threads = [threading.Thread(target=worker, args=(t,)) for t in range(10)]
    for t in threads: t.start()
    for t in threads: t.join()

    assert not errors, f"errors: {errors[:3]}"
    s = cache.stats()
    assert s["size"] == cache._cap
    print(f"  concurrent OK; final stats: {s}")


def _zero_capacity_test() -> None:
    print("--- capacity must be positive ---")
    try:
        LRUCache(0)
        assert False, "should have raised"
    except ValueError:
        pass
    print("  zero-cap rejection OK")


if __name__ == "__main__":
    _basic_tests()
    _eviction_order_test()
    _capacity_one_test()
    _zero_capacity_test()
    _stress_concurrent()
    print("\nAll tests passed.")
```

### How to run

```bash
python3 ~/Downloads/cc/kb/MachineCoding/Python/lru-cache.py
```

---

## 6. Walkthrough Trace

```
LRUCache(cap=3)
  map={}     list: H ⇄ T

put("a", 1)
  map={a→nA}  list: H ⇄ nA(a:1) ⇄ T

put("b", 2)
  map={a→nA, b→nB}  list: H ⇄ nB(b:2) ⇄ nA(a:1) ⇄ T

put("c", 3)
  list: H ⇄ nC(c:3) ⇄ nB(b:2) ⇄ nA(a:1) ⇄ T
                                          ^^^ a is LRU

get("a") → (1, True)
  list: H ⇄ nA(a:1) ⇄ nC(c:3) ⇄ nB(b:2) ⇄ T
                                          ^^^ b now LRU

put("d", 4)        # over capacity → evict b
  map={a, c, d}    list: H ⇄ nD(d:4) ⇄ nA(a:1) ⇄ nC(c:3) ⇄ T

get("b") → (None, False)
get("c") → (3, True)
  list: H ⇄ nC(c:3) ⇄ nD(d:4) ⇄ nA(a:1) ⇄ T
```

---

## 7. Complexity Analysis

| Operation | Time avg | Time worst | Space | Notes |
|---|---|---|---|---|
| get | O(1) | O(n) hash collision | — | Worst is hashmap-quality dependent |
| put | O(1) | O(1) amortized | O(1) | Insert + possible evict |
| delete | O(1) | — | — | |
| len | O(1) | — | — | |
| stats | O(1) | — | — | |

**Total space:** O(N) where N = capacity. Constant-factor overhead: ~80 bytes/node in CPython (object header + 4 ref slots).

**Concurrency overhead:** ~50–100 ns per op for the lock. Sharded variant divides contention by shard count.

---

## 8. Tests (Edge Cases)

### Must-cover
- Empty cache: `get` returns `(None, False)`.
- Single element: insert, retrieve, delete.
- Fill to capacity: all retrievable.
- Over-capacity: oldest evicted, others present in correct order.
- Update existing key: doesn't grow size; refreshes recency.
- Delete missing key: no-op, returns False.
- Get-then-put: recency moves correctly.
- Capacity = 0: rejected (depends on chosen semantic).
- Same-key reads: no eviction triggered, recency moves.

### Concurrency
- 10 goroutines × 1000 ops each, 200 unique keys, capacity 100: no corruption, no panics.
- Stress test: invariant `size ≤ capacity` after the storm.

### Negative
- `None` key: depends — Python `dict` allows it; we don't restrict.
- Capacity = 0 or negative: raise `ValueError`.

---

## 9. Cross-Questions ("Why X and not Y")

### 9.1 Why doubly-linked list and not singly-linked?

SLL forces O(n) to remove an arbitrary node — you'd need to walk from the head to find the predecessor. Kills the O(1) target for both `get` (move-to-front) and eviction. DLL nodes carry both pointers; deleting an arbitrary node is just rewiring two neighbors. The hashmap → node pointer plus DLL is the canonical pairing.

### 9.2 Why hashmap + DLL and not just `OrderedDict`?

In Python, `OrderedDict.move_to_end` and `popitem(last=False)` give a built-in LRU in 5 lines. Show you know the shortcut, but implement explicitly:
- It's the question. The interviewer wants to see you build the data structure.
- The DLL approach **ports** to languages without ordered maps (Go's `map` is unordered; Java has `LinkedHashMap` but you can't pre-sort by access).
- Implementing exposes the design: same approach extends to LFU, TTL, sharded variants. `OrderedDict` doesn't.

### 9.3 Why not a heap (priority queue)?

Heap gives O(log n) per op vs O(1). The right answer for **LFU** (where eviction is by frequency, dynamically ordered) is a different structure (paired hashmap + frequency buckets, also O(1)). For LRU, recency ordering is trivial — head/tail of a list. Heap is wrong.

### 9.4 Why not a tree (red-black, skip list)?

Trees give O(log n) — strictly worse for LRU. Trees win when you need range queries by key. We don't need range queries.

### 9.5 Why sentinels (dummy head/tail) and not nullable head/tail?

Sentinels remove the special case "is this the first/last node?" from every insert/delete. Code shrinks ~30%, branch density drops, fewer bugs. Cost: 2 extra nodes — negligible (~160 bytes).

### 9.6 Why a single mutex and not RWLock?

`get` mutates recency (move-to-front). RWLock is wrong: every "read" actually writes recency, so concurrent reads must serialize anyway. RWLock would add overhead with no concurrency win.

### 9.7 Why not a channel-based actor model (one goroutine/thread serving all ops)?

Actor model funnels everything through one worker. Throughput caps at the worker's per-op latency. Mutex lets N callers operate concurrently except for the critical section.

When actor is right: when ops are heavy (e.g. each access does I/O). For an in-memory cache, mutex wins.

### 9.8 Why generics and not `Any` / `dict[str, Any]`?

Generics keep type info at compile-time (or in stub files) — IDE support, type-checking, no boxing for primitives in compiled languages. Big wins for caches that hold ints / structs.

In Python specifically, generics are mainly for type-checker happiness (no runtime type erasure cost). Still worth it.

### 9.9 What about cache stampede on a miss?

Out of scope for the data structure but commonly asked. The data structure doesn't fetch — the *user* does. Singleflight (collapse concurrent same-key fetches into one upstream call) is the answer.

```python
# pseudo-code: wrap LRU with singleflight
def cached_fetch(key, fetch_fn):
    val, ok = cache.get(key)
    if ok: return val
    with singleflight.lock(key):
        val, ok = cache.get(key)  # double-check
        if ok: return val
        val = fetch_fn(key)
        cache.put(key, val)
        return val
```

### 9.10 How would you add TTL?

Each node carries an `expires_at`. `get` checks before returning; expired entries are deleted lazily. Optional background sweeper for eager expiration.

```python
class _Node:
    ...
    expires_at: float | None  # unix timestamp

def get(self, key):
    node = self._map.get(key)
    if node is None: return None, False
    if node.expires_at and time.time() > node.expires_at:
        self._unlink(node); del self._map[key]
        return None, False
    self._move_to_front(node)
    return node.value, True
```

Trade-off: lazy is simpler but lets expired data sit in memory; eager adds a goroutine.

### 9.11 What about the thundering herd when many keys expire at once?

Add jitter to TTLs: `expires_at = base_ttl + random.uniform(0, 0.1 * base_ttl)`. Spreads expirations across a window.

### 9.12 What if I want stats without holding the lock?

Increment hits/misses with `atomic` counters (in Python: `itertools.count` or `threading.Lock` for the increment). Read stats lock-free.

But this only helps if stats reads are very frequent. For ours, taking the lock briefly is fine.

### 9.13 What's the failure mode if `value` is mutable and the caller mutates it after `put`?

Caller's mutation is visible in the cache — the cache stores the reference, not a copy. If isolation matters, the caller deep-copies before `put` (or the cache wraps `put` with a copy).

Trade-off: copying is expensive for large values. Most caches let callers manage this.

### 9.14 Why does `__contains__` not touch recency?

Standard semantic: `in` is a *test*, not an *access*. Mutating on `in` would be surprising. If a user wants the recency touch, they call `get`.

---

## 10. Variants

### 10.1 LFU (Least Frequently Used)

Each node tracks an access count. On eviction, kick the node with the lowest count. Implementation: bucketed by frequency (paper: O(1) LFU, Pugh 2010).

```
freq=1 bucket: A → B
freq=2 bucket: C → D
freq=3 bucket: E

On get(C): C.freq → 3, move to freq=3 bucket.
On evict: pop oldest from min-freq bucket.
```

Slightly more code, same O(1).

### 10.2 ARC (Adaptive Replacement Cache)

Combines recency + frequency, self-tunes. Used by ZFS. Strictly better than LRU on most workloads but ~3× more code.

### 10.3 TinyLFU / W-TinyLFU

Caffeine (Java) and Ristretto (Go) use this. Counts frequencies in a count-min sketch, admits to cache only if the candidate is predicted hot. Best in class for high-throughput caches.

### 10.4 TTL-only

Pure expiration; size unbounded between sweeps. Simpler when memory is cheap and entries die quickly.

### 10.5 Sharded

N independent caches keyed by `hash(key) % N`. Parallelism multiplier ~= N. Used by all serious in-memory caches at scale (Caffeine, Ristretto).

```python
class ShardedLRU(Generic[K, V]):
    def __init__(self, capacity: int, shards: int = 16):
        self._shards = [LRUCache(capacity // shards) for _ in range(shards)]
        self._locks = [threading.Lock() for _ in range(shards)]

    def _idx(self, key): return hash(key) % len(self._shards)

    def get(self, key):
        i = self._idx(key)
        with self._locks[i]: return self._shards[i].get(key)

    def put(self, key, value):
        i = self._idx(key)
        with self._locks[i]: self._shards[i].put(key, value)
```

---

## 11. Cheat-Sheet Recap

1. **Problem:** Fixed-capacity cache, O(1) get/put, evict LRU.
2. **Data structure:** Hashmap + doubly-linked list with sentinels.
3. **Complexity:** O(1) average; O(N) space.
4. **Thread safety:** Single mutex (RWLock is wrong because `get` mutates).
5. **Eviction:** Drop tail-prev (LRU); update map.
6. **Stats:** Hits, misses, evictions tracked inline.
7. **Variants:** LFU, ARC, TinyLFU, TTL, sharded — all build on the same skeleton.

---

## Appendix A: Idiomatic notes (Python)

```
- collections.OrderedDict: the cheating answer; use as a sanity reference.
- __slots__ on _Node: saves ~40% memory per node by avoiding __dict__.
- TypeVar + Generic: for type-checker happiness, no runtime cost.
- threading.Lock vs RLock: Lock is faster; RLock only if reentrancy is needed.
- @dataclass on _Node: works but __slots__ is more memory-efficient.
- Use `is None` to test for sentinel/missing — `==` triggers __eq__ if defined.
```

## Appendix B: Common Python-specific gotchas

```
- Don't store mutable defaults (`def f(x=[]):`); use `None` and assign in body.
- Dict iteration is insertion-ordered (Py 3.7+); do NOT rely for LRU — implement explicitly.
- threading is GIL-bound — fine for our locking model; doesn't speed up CPU-bound work.
- `del self._map[key]` is O(1) average; same as pop().
- `__contains__` defaults to `__iter__` if you don't define it; we define it for O(1).
- If the cache holds large values, weakref or finalizers may help — out of scope.
```

## Appendix C: Why this question is loved by interviewers

```
- Tests data-structure depth (hashmap + DLL is non-trivial).
- Has a clear "wrong answer" (OrderedDict) that lets weak candidates fake it.
- Concurrency surfaces naturally.
- Tests array of variants (LFU, TTL, sharded).
- Easy to dictate test cases; correctness is verifiable in 10 lines.
- Open-ended at the variant level.
```

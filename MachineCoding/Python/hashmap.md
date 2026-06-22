# Custom HashMap — Machine Coding (Python)

> **Difficulty:** Medium
> **Tags:** `[mc]` `[data-structure]` `[chaining]` `[resize]` `[hashing]`
> **Language:** Python 3.10+
> **Time budget:** 60 min
> **Companies that ask this:** Atlassian, Razorpay, Microsoft, Apple

---

## Beginner's Guide

### What's this in plain English?

When you write `d["alice"] = 30` in Python, it just works. But what's happening underneath? Python takes the string "alice", computes a number from it (a **hash**), uses that number to pick a slot in an internal array, and puts (key, value) there. Looking it up does the same hash and goes straight to the slot. That's a **hashmap** (also called dictionary, or hash table).

### Why solve it?

- **Real world**: every language's dict/map/object/HashMap is a hashmap. Databases use them. Caches use them. JSON parsing uses them.
- **Teaches**: hashing, collision handling, load factor, dynamic resizing.
- **Interview**: tests "what's actually happening" rather than "how to use the library."

### Vocabulary

- **Hash function** — turns any key into a number.
- **Bucket / slot** — a position in the internal array; many keys may map to the same bucket.
- **Collision** — two keys hash to the same bucket. Must handle gracefully.
- **Chaining** — a bucket holds a *list* of (key, value) pairs; on collision, append.
- **Open addressing** — alternative: on collision, probe to the next bucket. Not covered here.
- **Load factor** — items / buckets. When too high (e.g. > 0.75), the map grows.
- **Resize / rehash** — double the bucket count and re-place every item. Amortized O(1) per insert.

### High-level approach

Internal storage: an array of buckets. Each bucket is a small list of `(key, value)` pairs.

**Put(k, v)**: hash k mod bucket_count → bucket index. Walk the bucket; if k exists, update; else append. If load factor crossed → resize.
**Get(k)**: same lookup; walk bucket; return value or None.
**Delete(k)**: same; remove from bucket.

Resize: allocate a new array twice the size, re-hash every existing item. Expensive *occasionally*, free *most of the time* — that's "amortized."

### How to read this doc

- **Beginner**: focus on the put/get/resize cycle.
- **Interview**: know how Python's actual `dict` differs (open addressing with quadratic probing) and trade-offs.

---

## 0. Why this question

Tests **understanding of hashing collisions, load factor, resize**. Python's `dict` is a black box; this question opens it.

---

## 1. Problem Statement

Implement a generic hashmap supporting:
- `Put(key, value)`
- `Get(key) -> (value, found)`
- `Delete(key) -> bool`
- `Len() -> int`

Targets: O(1) average; O(N) worst. Dynamic resize.

---

## 2. Approach

**Chaining**: each bucket = list of (key, value).
- Hash key → bucket index.
- On collision: append to bucket list.
- On lookup: scan bucket.

**Resize**: when load factor > threshold (e.g. 0.75) → double bucket count; rehash all.

```
buckets:  [  [(k1,v1),(k2,v2)] | [] | [(k3,v3)] | ... ]
            bucket 0           1    2
```

---

## 3. Full Code

```python
"""
Custom HashMap with chaining + dynamic resize.
"""
from __future__ import annotations
from typing import Generic, TypeVar, Optional

K = TypeVar("K")
V = TypeVar("V")


class HashMap(Generic[K, V]):
    INITIAL_CAPACITY = 16
    LOAD_FACTOR = 0.75

    def __init__(self) -> None:
        self._capacity = self.INITIAL_CAPACITY
        self._size = 0
        self._buckets: list[list[tuple[K, V]]] = [[] for _ in range(self._capacity)]

    def _hash(self, key: K) -> int:
        return hash(key) % self._capacity

    def put(self, key: K, value: V) -> None:
        if self._size + 1 > self._capacity * self.LOAD_FACTOR:
            self._resize()
        idx = self._hash(key)
        bucket = self._buckets[idx]
        for i, (k, _) in enumerate(bucket):
            if k == key:
                bucket[i] = (key, value)
                return
        bucket.append((key, value))
        self._size += 1

    def get(self, key: K) -> tuple[Optional[V], bool]:
        idx = self._hash(key)
        for k, v in self._buckets[idx]:
            if k == key:
                return v, True
        return None, False

    def delete(self, key: K) -> bool:
        idx = self._hash(key)
        bucket = self._buckets[idx]
        for i, (k, _) in enumerate(bucket):
            if k == key:
                bucket.pop(i)
                self._size -= 1
                return True
        return False

    def __len__(self) -> int:
        return self._size

    def __contains__(self, key: K) -> bool:
        _, found = self.get(key)
        return found

    def _resize(self) -> None:
        old_buckets = self._buckets
        self._capacity *= 2
        self._buckets = [[] for _ in range(self._capacity)]
        self._size = 0
        for bucket in old_buckets:
            for k, v in bucket:
                self.put(k, v)


# ─── tests ────────────────────────────────────────────────────────────

def _basic():
    print("--- basic ---")
    h: HashMap[str, int] = HashMap()
    h.put("a", 1)
    h.put("b", 2)
    h.put("c", 3)
    assert h.get("a") == (1, True)
    assert h.get("b") == (2, True)
    assert h.get("d") == (None, False)
    h.put("a", 100)  # update
    assert h.get("a") == (100, True)
    assert len(h) == 3
    assert h.delete("b") is True
    assert h.delete("b") is False
    assert len(h) == 2
    print("  OK")


def _resize():
    print("--- resize ---")
    h: HashMap[int, int] = HashMap()
    for i in range(100):
        h.put(i, i * 10)
    assert len(h) == 100
    for i in range(100):
        assert h.get(i) == (i * 10, True)
    # capacity should be > initial
    assert h._capacity > HashMap.INITIAL_CAPACITY
    print(f"  capacity={h._capacity}, size={len(h)} OK")


def _collisions():
    print("--- collisions ---")
    # Force collisions by using same modulo
    class BadHash:
        def __init__(self, v): self.v = v
        def __hash__(self): return 0  # all collide
        def __eq__(self, other): return isinstance(other, BadHash) and self.v == other.v

    h: HashMap[BadHash, int] = HashMap()
    for i in range(20):
        h.put(BadHash(i), i)
    for i in range(20):
        assert h.get(BadHash(i)) == (i, True)
    print("  OK; chaining works under collision")


if __name__ == "__main__":
    _basic()
    _resize()
    _collisions()
    print("\nAll tests passed.")
```

---

## 4. Cross-Questions

### 4.1 Why chaining vs open addressing?
- Chaining: simple; degraded performance graceful (O(N) only on bad hash).
- Open addressing: better cache locality; complex deletion (tombstones).
- Python's dict uses open addressing.

### 4.2 Why load factor 0.75?
- Industry standard.
- < 0.5: wasted memory.
- > 0.9: too many collisions.

### 4.3 Why resize doubles?
- Amortized O(1) put.
- Halving on shrink (if Len << capacity) to save memory.

### 4.4 Why O(N) worst-case?
- All keys hash to same bucket.
- Chain traversal O(N).
- Mitigation: use cryptographic-quality hash; no adversarial inputs.

### 4.5 Why update-in-place on key collision?
- Standard semantics: `put` overwrites if key present.
- Alternative: append (multimap behavior); different API.

### 4.6 Memory cost?
- Capacity buckets × empty list overhead (~64 bytes each in CPython).
- Plus key+value pairs.

### 4.7 Thread safety?
- Not by default. Wrap with Lock for safety.

### 4.8 What if hash function is bad?
- Mitigation: rehash with secondary hash on bad chain.
- Java's HashMap uses red-black tree for long chains.

---

## 5. Variants
- **Open addressing** (linear/quadratic probing).
- **Robin Hood hashing** (bounded probe distance).
- **Cuckoo hashing** (O(1) worst-case lookup).
- **Concurrent map** (sharded mutex).

---

## 6. Cheat-Sheet
1. Buckets array; chaining via lists.
2. `hash(key) % capacity` → bucket.
3. Update on existing key; append on new.
4. Resize when load factor exceeded.
5. Generics for types.

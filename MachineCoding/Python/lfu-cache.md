# LFU Cache — Machine Coding (Python)

> **Difficulty:** Hard
> **Tags:** `[mc]` `[data-structure]` `[O(1)]` `[frequency]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

LRU evicts whatever was used **least recently**. **LFU** evicts whatever was used **least frequently** — the rare items go first, regardless of when last accessed. Sometimes that's a better fit (e.g., a streaming cache where some videos are vastly more popular).

The hard part: doing it in O(1). It's significantly trickier than LRU.

### Why solve it?

- **Real world**: caches with skewed popularity (CDNs, recommendation systems).
- **Teaches**: combining a hashmap with multiple linked lists (one per frequency bucket), tracking the minimum frequency.
- **Interview**: hard. Often follow-up to LRU. If you can explain LFU's O(1) trick, you stand out.

### Vocabulary

- **Frequency** — how many times this key has been accessed.
- **LRU** — least recently used (what we covered separately).
- **LFU** — least frequently used.
- **Frequency bucket** — a list of items that all have the same access count.
- **min_freq** — the smallest frequency currently in the cache (the eviction target).

### High-level approach

Three structures:
1. `key → node` map — O(1) lookup.
2. `freq → doubly_linked_list` map — items at this frequency.
3. `min_freq` — smallest frequency present.

**get(key)**: lookup; remove from current freq list; freq++; insert into new freq list (at head). If old list is empty AND was the min_freq, increment min_freq.
**put(key, val)**: if key exists → update + treat like get. Else: if at capacity → evict from min_freq list (tail). Add new key with freq=1; min_freq=1.

The "min_freq" trick is what keeps eviction O(1) — you don't need to scan to find the rarest.

### How to read this doc

- **Beginner**: read the LRU doc first; LFU builds on the same hashmap+DLL idea.
- **Interview**: explaining how min_freq updates correctly is the differentiator.

---

## 0. Why this question

LFU is the harder cousin of LRU. Tests **frequency-based eviction in O(1)**.

---

## 1. Problem Statement

Fixed-capacity cache with O(1) get/put; evict **least frequently used** on capacity exceeded. Ties broken by LRU within same frequency.

---

## 2. Approach (O(1) — Pugh's algorithm)

Two key data structures:
1. `freq → DLL of nodes at that frequency` (LRU within freq).
2. `key → node`.
3. Track `min_freq` (current minimum frequency).

On Get:
- Look up node.
- Remove from current freq DLL.
- Increment freq; add to head of new freq DLL.
- If old DLL empty and was min_freq → increment min_freq.

On Put new:
- If at capacity: evict tail of `min_freq` DLL.
- Add node at freq=1; min_freq=1.

```
freq=1: [n1] ⇄ [n2]
freq=2: [n3]
freq=5: [n4]

min_freq = 1
On evict: remove tail of freq=1 (n2).
```

---

## 3. Code

```python
"""LFU Cache with O(1) get/put."""
from __future__ import annotations
from typing import Generic, TypeVar, Optional

K = TypeVar("K")
V = TypeVar("V")


class _Node(Generic[K, V]):
    __slots__ = ("key", "value", "freq", "prev", "next")
    def __init__(self, key, value, freq=1):
        self.key = key
        self.value = value
        self.freq = freq
        self.prev = None
        self.next = None


class _DLL(Generic[K, V]):
    """Doubly-linked list with sentinels."""
    def __init__(self):
        self.head = _Node(None, None)
        self.tail = _Node(None, None)
        self.head.next = self.tail
        self.tail.prev = self.head
        self.size = 0

    def add_front(self, node):
        nxt = self.head.next
        node.prev = self.head
        node.next = nxt
        self.head.next = node
        nxt.prev = node
        self.size += 1

    def remove(self, node):
        node.prev.next = node.next
        node.next.prev = node.prev
        node.prev = None
        node.next = None
        self.size -= 1

    def pop_tail(self):
        if self.size == 0:
            return None
        node = self.tail.prev
        self.remove(node)
        return node


class LFUCache(Generic[K, V]):
    def __init__(self, capacity: int):
        if capacity <= 0:
            raise ValueError("capacity must be positive")
        self._cap = capacity
        self._key_to_node: dict[K, _Node[K, V]] = {}
        self._freq_to_dll: dict[int, _DLL[K, V]] = {}
        self._min_freq = 0

    def get(self, key: K) -> tuple[Optional[V], bool]:
        node = self._key_to_node.get(key)
        if node is None:
            return None, False
        self._bump(node)
        return node.value, True

    def put(self, key: K, value: V) -> None:
        if self._cap == 0:
            return
        if key in self._key_to_node:
            node = self._key_to_node[key]
            node.value = value
            self._bump(node)
            return
        if len(self._key_to_node) >= self._cap:
            self._evict()
        node = _Node(key, value, freq=1)
        self._key_to_node[key] = node
        self._freq_to_dll.setdefault(1, _DLL()).add_front(node)
        self._min_freq = 1

    def _bump(self, node):
        old_freq = node.freq
        old_dll = self._freq_to_dll[old_freq]
        old_dll.remove(node)
        if old_dll.size == 0:
            del self._freq_to_dll[old_freq]
            if self._min_freq == old_freq:
                self._min_freq += 1
        node.freq += 1
        new_dll = self._freq_to_dll.setdefault(node.freq, _DLL())
        new_dll.add_front(node)

    def _evict(self):
        dll = self._freq_to_dll[self._min_freq]
        victim = dll.pop_tail()
        if dll.size == 0:
            del self._freq_to_dll[self._min_freq]
        del self._key_to_node[victim.key]

    def __len__(self):
        return len(self._key_to_node)


# ─── Tests ───

def _basic():
    print("--- basic ---")
    c = LFUCache(2)
    c.put("a", 1)
    c.put("b", 2)
    assert c.get("a") == (1, True)        # a freq=2, b freq=1
    c.put("c", 3)                         # evict b
    assert c.get("b") == (None, False)
    assert c.get("c") == (3, True)
    assert c.get("a") == (1, True)
    print("  OK")


def _eviction_order():
    print("--- eviction order ---")
    c = LFUCache(3)
    c.put("a", 1); c.put("b", 2); c.put("c", 3)
    c.get("a")     # a:2
    c.get("b")     # b:2
    # c:1 is min — should be evicted
    c.put("d", 4)
    assert c.get("c") == (None, False)
    print("  OK")


def _tie_broken_by_lru():
    print("--- tie broken by LRU ---")
    c = LFUCache(3)
    c.put("a", 1); c.put("b", 2); c.put("c", 3)
    # all freq=1; b is in middle, c is most recent, a is oldest
    c.put("d", 4)
    # min_freq=1; tail of freq-1 DLL is the LRU (a), should be evicted
    assert c.get("a") == (None, False)
    assert c.get("b") == (2, True)
    print("  OK")


if __name__ == "__main__":
    _basic()
    _eviction_order()
    _tie_broken_by_lru()
    print("\nAll tests passed.")
```

---

## 4. Cross-Questions

### 4.1 Why two data structures?
- key→node: O(1) lookup.
- freq→DLL: O(1) "find LRU at min_freq."
- Either alone is insufficient for O(1).

### 4.2 Why min_freq tracked?
- O(1) eviction: instantly know which DLL to evict from.
- Update: increments when min_freq's DLL becomes empty.

### 4.3 What if frequency overflows?
- Python int is arbitrary precision.
- In Go: int64 → 9 quintillion increments before overflow. Effectively unbounded.

### 4.4 Why LRU within same freq?
- "Least frequently used" + tiebreak = "least recently used among those tied."
- Practical heuristic.

### 4.5 What if I want LFU with TTL?
- Add expires_at to node.
- Lazy: check TTL on get; treat expired as miss.

### 4.6 Memory cost?
- Per node: ~80 bytes (5 fields).
- Per DLL: ~16 bytes (head, tail).
- Per freq: one DLL entry (only created when needed).

### 4.7 Why Pugh's O(1)?
- Earlier LFU implementations used a heap by frequency → O(log N).
- Pugh observed: only need O(1) eviction at min_freq.
- Frequency buckets remove the heap.

---

## 5. Variants
- **TinyLFU** / **W-TinyLFU**: probabilistic frequency counting; admit-only-if-popular.
- **LFU with aging**: decay frequency over time.
- **ARC**: Adaptive — combines LFU + LRU.

---

## 6. Cheat-Sheet
1. `key→node` dict + `freq→DLL` dict + `min_freq`.
2. Get: bump frequency.
3. Put: evict tail of min_freq DLL if at capacity.
4. min_freq updated when its DLL becomes empty.
5. O(1) all operations.

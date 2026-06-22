# Skip List — Machine Coding (Python)

> **Difficulty:** Hard
> **Tags:** `[mc]` `[probabilistic]` `[ordered]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

Imagine a sorted linked list: 1 → 3 → 5 → 7 → 9. Searching for 7 means walking node by node. A **skip list** adds "express lanes" above: 1 → 5 → 9, and one above that: 1 → 9. To find 7, hop the express lane to 5, then drop down to walk to 7. Effectively halves your search work each level — O(log n).

### Why solve it?

- **Real world**: Redis sorted sets, Java's `ConcurrentSkipListMap`, several DB engines.
- **Teaches**: probabilistic data structures, balanced search without rotation gymnastics (no red-black tree code), randomization as a tool.
- **Interview**: harder than most MC; shows comfort with probabilistic reasoning.

### Vocabulary

- **Level** — a horizontal "express lane." Level 0 = the base list with all elements.
- **Promotion** — when inserting, flip a coin; with probability p (typically 0.5), promote to next level. Repeat.
- **Probabilistic balance** — no rotations; randomness keeps the structure roughly balanced on average.
- **O(log n) expected** — average performance, not worst-case (which is O(n) but very unlikely).

### High-level approach

Each node has `value`, `forward[]` array of pointers (one per level it participates in).

**search(x)**:
1. Start at the top level of the head node.
2. Walk forward while `forward[level].value < x`.
3. Drop down a level. Repeat.
4. At level 0, `forward[0]` either is x or isn't.

**insert(x)**:
1. Find x's would-be position at every level (record predecessors).
2. Flip coins to decide x's height.
3. Splice x into the chain at each level up to its height.

**delete(x)**:
1. Find predecessors at every level. Splice out.

### How to read this doc

- **Beginner**: this is hard. Spend time on the search algorithm with diagrams before code.
- **Interview**: be ready to defend "why probabilistic vs balanced tree?" — simpler code, easier concurrency.

---

## 0. Why this question

Skip list = simpler-than-RBTree O(log n) ordered structure. Used in: Redis sorted sets, ConcurrentSkipListMap. Tests **probabilistic data structure design**.

---

## 1. Approach

```
Multi-level linked list. Level 0 contains all elements.
Higher levels skip ahead.

Level 3:        1 -----------> 9
Level 2:   1 -------> 5 -----> 9
Level 1:   1 --> 3 -> 5 --> 7-> 9
Level 0:   1 -> 3 -> 5 -> 7 -> 9

Each node has random level (geometric distribution).
Find: walk top-down, right-as-far-as-possible.
```

---

## 2. Code

```python
"""Skip List with O(log n) search/insert/delete."""
from __future__ import annotations
import random
from typing import Optional


class _Node:
    __slots__ = ("value", "forward")
    def __init__(self, value, level):
        self.value = value
        self.forward: list[Optional["_Node"]] = [None] * (level + 1)


class SkipList:
    MAX_LEVEL = 16
    P = 0.5

    def __init__(self, seed: Optional[int] = None):
        self._head = _Node(None, self.MAX_LEVEL)
        self._level = 0
        self._size = 0
        self._rng = random.Random(seed)

    def _random_level(self) -> int:
        lvl = 0
        while self._rng.random() < self.P and lvl < self.MAX_LEVEL:
            lvl += 1
        return lvl

    def insert(self, value) -> None:
        update = [self._head] * (self.MAX_LEVEL + 1)
        cur = self._head
        for i in range(self._level, -1, -1):
            while cur.forward[i] is not None and cur.forward[i].value < value:
                cur = cur.forward[i]
            update[i] = cur
        # already exists?
        if cur.forward[0] is not None and cur.forward[0].value == value:
            return  # ignore duplicates (or we can allow them)
        lvl = self._random_level()
        if lvl > self._level:
            for i in range(self._level + 1, lvl + 1):
                update[i] = self._head
            self._level = lvl
        node = _Node(value, lvl)
        for i in range(lvl + 1):
            node.forward[i] = update[i].forward[i]
            update[i].forward[i] = node
        self._size += 1

    def search(self, value) -> bool:
        cur = self._head
        for i in range(self._level, -1, -1):
            while cur.forward[i] is not None and cur.forward[i].value < value:
                cur = cur.forward[i]
        candidate = cur.forward[0]
        return candidate is not None and candidate.value == value

    def delete(self, value) -> bool:
        update = [self._head] * (self.MAX_LEVEL + 1)
        cur = self._head
        for i in range(self._level, -1, -1):
            while cur.forward[i] is not None and cur.forward[i].value < value:
                cur = cur.forward[i]
            update[i] = cur
        target = cur.forward[0]
        if target is None or target.value != value:
            return False
        for i in range(self._level + 1):
            if update[i].forward[i] is not target:
                break
            update[i].forward[i] = target.forward[i]
        while self._level > 0 and self._head.forward[self._level] is None:
            self._level -= 1
        self._size -= 1
        return True

    def __len__(self) -> int:
        return self._size

    def __iter__(self):
        cur = self._head.forward[0]
        while cur is not None:
            yield cur.value
            cur = cur.forward[0]


# Tests
def main():
    sl = SkipList(seed=42)
    for v in [3, 7, 1, 9, 5, 2, 8]:
        sl.insert(v)

    print("--- search ---")
    assert sl.search(5) is True
    assert sl.search(4) is False
    assert sl.search(9) is True
    print("  OK")

    print("--- ordered iteration ---")
    items = list(sl)
    assert items == sorted(items)
    print(f"  {items}")

    print("--- delete ---")
    assert sl.delete(5) is True
    assert not sl.search(5)
    assert sl.delete(5) is False
    print("  OK")

    print("--- big ---")
    sl2 = SkipList(seed=1)
    import random as r
    nums = list(range(1000))
    r.shuffle(nums)
    for n in nums:
        sl2.insert(n)
    assert len(sl2) == 1000
    items = list(sl2)
    assert items == sorted(items)
    for n in range(1000):
        assert sl2.search(n)
    print("  OK; 1000 items in order")

    print("\nAll tests passed.")


if __name__ == "__main__":
    main()
```

---

## 3. Cross-Questions

### 3.1 Why skip list vs balanced BST?
- BST: rebalance ops complex (rotations).
- Skip list: simpler; randomized; same O(log n) average.
- Concurrent versions easier (CAS-friendly).

### 3.2 Why p=0.5?
- Expected level distribution: 1/2 at level 0, 1/4 at 1, ...
- Total nodes: 2N expected.
- p=0.25 saves space (~1.33N nodes).

### 3.3 Why MAX_LEVEL=16?
- Supports up to 2^16 = 65k items at p=0.5.
- For larger: increase to 32.

### 3.4 Worst case?
O(N) if random gives bad height distribution. Astronomically unlikely.

### 3.5 vs Redis sorted set?
Redis uses skip list + hash table for member lookup.

### 3.6 Concurrent skip list?
Java's ConcurrentSkipListMap — lock-free using CAS.

---

## 4. Cheat-Sheet
1. Multi-level linked list.
2. Random level on insert (geometric).
3. Search: top-down, right-as-far.
4. O(log n) average.
5. Alternative to balanced BST.

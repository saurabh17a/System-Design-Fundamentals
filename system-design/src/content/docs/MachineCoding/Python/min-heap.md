# Min Heap / Priority Queue — Machine Coding (Python)

> **Difficulty:** Medium
> **Tags:** `[mc]` `[heap]` `[O(log n)]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

Imagine an emergency room. People arrive randomly, but doctors take patients by **priority** — heart attack first, sprained ankle later. A **priority queue** does exactly this for data: you keep adding items, and at any moment you can pull out the most-important one.

A **heap** is the data structure that makes a priority queue fast. A **min-heap** keeps the smallest item at the top.

### Why solve it?

- **Real world**: task schedulers, A* pathfinding, Dijkstra's shortest path, top-K problems, event-driven simulators.
- **Teaches**: representing a tree as an array (no node objects, no pointers!), invariants, sift-up / sift-down algorithms.
- **Interview**: foundational; expect heap-related questions in any algorithm round.

### Vocabulary

- **Priority queue** — abstract data type: insert items with priorities, remove the highest-priority one.
- **Heap** — concrete data structure: a "complete binary tree" where parent is always smaller (min-heap) or larger (max-heap) than children.
- **Sift up** — after inserting, bubble the item up until heap property holds.
- **Sift down** — after removing the root, swap with last item and bubble down.
- **O(log n)** — operation time grows with the *log* of the data size; very fast.

### High-level approach

A heap is stored as an **array**, not as nodes with pointers. The trick:
- Item at index `i` has children at `2i+1` and `2i+2`.
- Parent of item at `i` is at `(i-1)//2`.

**Push(x)**: append to end of array; sift up until parent ≤ x.
**Pop()**: take element at index 0 (the min); replace with last element; sift down.

Both are O(log n) because the tree's height is log n.

Python's stdlib has `heapq` (functions on a regular list). We implement from scratch to show how it works.

### How to read this doc

- **Beginner**: section 1 (the array-as-tree trick) is the core insight.
- **Interview**: focus on sift-up/sift-down implementations.

---

## 0. Why this question

Heap is foundational. Tests **array-as-tree, sift-up/down, generics**.

---

## 1. API

```
push(item)          O(log n)
pop() -> min        O(log n)
peek() -> min       O(1)
len                 O(1)
heapify(items)      O(n)
```

---

## 2. Approach

Array-as-binary-tree:
- `parent(i) = (i-1) // 2`
- `left(i) = 2i + 1`
- `right(i) = 2i + 2`

Push: append, sift up.
Pop: swap root with last, shrink, sift down.

Heapify: sift down from N/2 to 0 (Floyd's, O(n)).

---

## 3. Code

```python
"""Min-Heap with optional key function (for max-heap, custom orderings)."""
from __future__ import annotations
from typing import Callable, Generic, TypeVar, Optional

T = TypeVar("T")


class MinHeap(Generic[T]):
    def __init__(self, key: Optional[Callable[[T], object]] = None,
                 items: Optional[list[T]] = None) -> None:
        self._key = key or (lambda x: x)
        self._h: list[T] = list(items) if items else []
        if items:
            self._heapify()

    def _heapify(self) -> None:
        n = len(self._h)
        for i in range(n // 2 - 1, -1, -1):
            self._sift_down(i)

    def push(self, item: T) -> None:
        self._h.append(item)
        self._sift_up(len(self._h) - 1)

    def pop(self) -> T:
        if not self._h:
            raise IndexError("pop from empty heap")
        top = self._h[0]
        last = self._h.pop()
        if self._h:
            self._h[0] = last
            self._sift_down(0)
        return top

    def peek(self) -> T:
        if not self._h:
            raise IndexError("peek empty")
        return self._h[0]

    def __len__(self) -> int:
        return len(self._h)

    def _sift_up(self, i: int) -> None:
        while i > 0:
            parent = (i - 1) // 2
            if self._key(self._h[i]) < self._key(self._h[parent]):
                self._h[i], self._h[parent] = self._h[parent], self._h[i]
                i = parent
            else:
                return

    def _sift_down(self, i: int) -> None:
        n = len(self._h)
        while True:
            l, r = 2 * i + 1, 2 * i + 2
            smallest = i
            if l < n and self._key(self._h[l]) < self._key(self._h[smallest]):
                smallest = l
            if r < n and self._key(self._h[r]) < self._key(self._h[smallest]):
                smallest = r
            if smallest == i:
                return
            self._h[i], self._h[smallest] = self._h[smallest], self._h[i]
            i = smallest


# ─── Tests ───
def main():
    print("--- basic ---")
    h = MinHeap[int]()
    for v in [5, 3, 8, 1, 9, 2]:
        h.push(v)
    assert h.peek() == 1
    out = []
    while len(h):
        out.append(h.pop())
    assert out == sorted(out)
    print("  OK")

    print("--- heapify ---")
    h2 = MinHeap[int](items=[9, 5, 7, 3, 1, 4])
    assert h2.peek() == 1
    print("  OK")

    print("--- max-heap via key ---")
    max_h = MinHeap[int](key=lambda x: -x)
    for v in [3, 1, 5, 2]:
        max_h.push(v)
    assert max_h.peek() == 5
    print("  OK")

    print("--- custom objects ---")
    h3 = MinHeap(key=lambda t: t[0])
    h3.push((3, "c")); h3.push((1, "a")); h3.push((2, "b"))
    assert h3.pop() == (1, "a")
    print("  OK")

    print("\nAll tests passed.")


if __name__ == "__main__":
    main()
```

---

## 4. Cross-Questions

### 4.1 Why array vs explicit tree?
Array: no pointer overhead; cache-friendly.
Tree: easier visualization; same complexity.
Array always preferred.

### 4.2 Why sift-up after push?
Inserted at end; needs to bubble up to maintain heap property.

### 4.3 Why O(n) heapify (not O(n log n))?
Bottom-up sift-down: most nodes are near leaves (fewer levels to sift).
Math: Σ levels = O(n).

### 4.4 vs Python's heapq?
Python has `heapq` module — exact same operations.
For interview: build it.

### 4.5 Max-heap?
Negate keys (lambda x: -x).
Or implement separate max-heap (compare reversed).

### 4.6 Decrease-key?
Need item lookup → wrapped index map.
Used in Dijkstra.

---

## 5. Cheat-Sheet
1. Array as tree.
2. parent/left/right by index math.
3. push: append + sift-up.
4. pop: swap root with last; shrink; sift-down.
5. heapify: sift-down from N/2 to 0.

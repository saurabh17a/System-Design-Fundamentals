# Disjoint Set Union (Union-Find) — Machine Coding (Python)

> **Difficulty:** Medium
> **Tags:** `[mc]` `[graph]` `[connectivity]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

You're at a party. People keep being introduced to each other. At any moment you might ask "Are Alice and Bob friends-of-friends?" Naively you'd trace through the friend graph. **Disjoint Set Union (DSU)** answers it in (effectively) O(1) by maintaining "groups" — every person points at a representative of their group, and you check if two people share a representative.

### Why solve it?

- **Real world**: image segmentation, network connectivity, cycle detection in graphs, Kruskal's MST algorithm, online clustering.
- **Teaches**: amortized analysis, two clever optimizations (path compression + union by rank) that turn near-linear time into near-constant.
- **Interview**: graph problems often boil down to DSU.

### Vocabulary

- **Set** — a group; here, a connected component.
- **Representative (root)** — the "leader" of a set; we identify sets by their root.
- **Find(x)** — return the root of x's set.
- **Union(x, y)** — merge the two sets containing x and y.
- **Path compression** — when you `find`, point everyone you visited directly at the root. Future calls are faster.
- **Union by rank** — when merging, attach the shorter tree under the taller. Keeps trees flat.

### High-level approach

Each element has a `parent[i]` — initially itself (every element is its own set).

**Find(x)**: walk up `parent[x]`, `parent[parent[x]]`, ... until you reach a self-loop (the root). Optionally compress: set `parent[x] = root` along the way.

**Union(x, y)**: find both roots; if different, attach one under the other (preferring shorter tree).

With path compression + union by rank, **all operations are effectively O(α(n)) ≈ O(1)** — α is the inverse Ackermann, which never exceeds 4 in practice.

### How to read this doc

- **Beginner**: focus on `find` and `union` first; the optimizations are layered on top.
- **Interview**: know the complexity argument and when DSU is the right tool.

---

## 0. Why this question

DSU is the canonical data structure for **dynamic connectivity**. Used in: Kruskal's MST, cycle detection, online clustering.

---

## 1. API

```
make_set(x)
find(x) -> root
union(x, y) -> bool (True if merged)
connected(x, y) -> bool
size(x) -> int (size of component)
```

Targets: nearly O(1) amortized (inverse Ackermann).

---

## 2. Approach

Forest of trees; each tree = component.
- `parent[x]`: x's parent (or x if root).
- `rank[x]` or `size[x]`: tree height/size.

Optimizations:
- **Path compression**: during find, point all visited nodes directly to root.
- **Union by rank/size**: smaller tree's root → larger tree's root.

Combined: amortized O(α(n)) ≈ O(1).

---

## 3. Code

```python
"""Union-Find with path compression + union by size."""
from __future__ import annotations
from typing import Generic, TypeVar, Hashable

T = TypeVar("T", bound=Hashable)


class DSU(Generic[T]):
    def __init__(self) -> None:
        """Empty DSU. Elements are introduced lazily on first touch."""
        self._parent: dict[T, T] = {}
        self._size: dict[T, int] = {}

    def make_set(self, x: T) -> None:
        """Add x as its own singleton set. Idempotent — safe to call repeatedly.

        Why this approach: every element starts as its own root. Lazy creation
        means callers don't need to register elements upfront.
        """
        if x not in self._parent:
            self._parent[x] = x
            self._size[x] = 1

    def find(self, x: T) -> T:
        """Return x's root, applying path compression along the way.

        Why this approach: walk parents until we hit a self-loop (the root).
        Then walk again, pointing every visited node directly at the root.
        Future finds for these nodes are O(1).

        Interview tip: the two-pass approach (find root, then compress) is
        clearer to explain than the one-pass recursive version.
        """
        self.make_set(x)
        # Path compression (iterative)
        root = x
        while self._parent[root] != root:
            root = self._parent[root]
        # Compress
        cur = x
        while self._parent[cur] != root:
            nxt = self._parent[cur]
            self._parent[cur] = root
            cur = nxt
        return root

    def union(self, x: T, y: T) -> bool:
        """Merge x's and y's sets. Returns True if a merge happened (False if already same).

        Why this approach: union-by-size attaches the smaller tree under the
        larger root, keeping trees flat. Combined with path compression, this
        gives amortized O(α(n)) — effectively constant.

        Interview tip: emphasize the "smaller hangs off larger" rule —
        it's what prevents tree height from growing.
        """
        rx, ry = self.find(x), self.find(y)
        if rx == ry:
            return False
        # Union by size: smaller hangs off larger
        if self._size[rx] < self._size[ry]:
            rx, ry = ry, rx
        self._parent[ry] = rx
        self._size[rx] += self._size[ry]
        return True

    def connected(self, x: T, y: T) -> bool:
        """True iff x and y are in the same set."""
        return self.find(x) == self.find(y)

    def size(self, x: T) -> int:
        """Size of x's connected component."""
        return self._size[self.find(x)]


# Tests
def main():
    dsu: DSU[int] = DSU()
    for i in range(1, 8):
        dsu.make_set(i)

    print("--- basic ---")
    assert dsu.union(1, 2) is True
    assert dsu.union(3, 4) is True
    assert dsu.connected(1, 2)
    assert not dsu.connected(1, 3)
    print("  OK")

    print("--- merge components ---")
    dsu.union(1, 3)
    assert dsu.connected(2, 4)
    assert dsu.size(1) == 4
    print("  OK")

    print("--- duplicate union ---")
    assert dsu.union(2, 4) is False  # already merged
    print("  OK")

    print("--- isolated ---")
    assert dsu.size(7) == 1
    print("  OK")

    # Stress test with path compression
    print("--- chain test ---")
    dsu2: DSU[int] = DSU()
    for i in range(10000):
        dsu2.union(i, i + 1)
    # find should compress
    root = dsu2.find(0)
    # second find direct
    assert dsu2.find(5000) == root
    assert dsu2.size(0) == 10001
    print("  OK")

    print("\nAll tests passed.")


if __name__ == "__main__":
    main()
```

---

## 4. Cross-Questions

### 4.1 Path compression vs path halving vs path splitting?
- Compression: best amortized.
- Halving / splitting: simpler; same big-O but less work per find.

### 4.2 Union by rank vs size?
- Both achieve same complexity.
- Size: tracked count of nodes. Easier to reason about.
- Rank: upper bound on tree height; slightly cheaper update.

### 4.3 Why amortized O(α(n))?
Tarjan's analysis. α = inverse Ackermann; effectively constant for n ≤ 2^65000.

### 4.4 Application: Kruskal's MST?
Sort edges by weight; process in order; union if endpoints differ.

### 4.5 Decrease in component size?
Standard DSU doesn't support split.
For dynamic connectivity (with deletions), use Euler tour trees.

### 4.6 Persistent DSU?
Functional structure for time-traveling queries. Out of scope.

---

## 5. Cheat-Sheet
1. parent[] forest.
2. find: walk to root + compress path.
3. union: by size; merge smaller under larger.
4. Amortized O(α(n)) ≈ O(1).

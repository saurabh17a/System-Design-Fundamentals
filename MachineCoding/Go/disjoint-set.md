# Disjoint Set Union — Machine Coding (Go)

> **Difficulty:** Medium
> **Tags:** `[mc]` `[generics]` `[graph]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

People at a party get introduced. You want to ask "Are Alice and Bob in the same friend cluster?" without tracing the friend graph each time. **Disjoint Set Union (DSU)** keeps track of clusters: every person points at a representative of their cluster, and two people are in the same cluster iff they share a representative.

### Why solve it?

- **Real world**: connectivity, cycle detection, Kruskal's MST, image segmentation.
- **Teaches**: amortized analysis, the two optimizations (path compression + union by rank) that make it nearly O(1).
- **Interview**: graph problems often reduce to DSU.

### Vocabulary

- **Set / component** — a group of related elements.
- **Root** — the unique representative of a set.
- **Find(x)** — return root of x's set.
- **Union(x, y)** — merge the sets containing x and y.
- **Path compression** — during find, redirect intermediate nodes straight to the root.
- **Union by rank** — attach shorter tree under taller; keeps trees flat.

### High-level approach

Array `parent[i]` — initially `parent[i] = i` (each element is its own root).

**Find(x)**: follow `parent[x]` until self-loop. Compress along the way.
**Union(x, y)**: find both roots; attach one under the other by rank.

With both optimizations, all ops are effectively O(α(n)) ≈ O(1) (α never exceeds 4 in practice).

In Go, **generics** let us write `DSU[T comparable]` so it works for any element type.

### How to read this doc

- **Beginner**: focus on the simple find/union; layer optimizations after.
- **Interview**: know the complexity claim and when to choose DSU over BFS.

---

## 1. Code

```go
package main

import "fmt"

type DSU[T comparable] struct {
	parent map[T]T
	size   map[T]int
}

func NewDSU[T comparable]() *DSU[T] {
	return &DSU[T]{
		parent: make(map[T]T),
		size:   make(map[T]int),
	}
}

func (d *DSU[T]) MakeSet(x T) {
	if _, ok := d.parent[x]; !ok {
		d.parent[x] = x
		d.size[x] = 1
	}
}

func (d *DSU[T]) Find(x T) T {
	d.MakeSet(x)
	root := x
	for d.parent[root] != root {
		root = d.parent[root]
	}
	cur := x
	for d.parent[cur] != root {
		next := d.parent[cur]
		d.parent[cur] = root
		cur = next
	}
	return root
}

func (d *DSU[T]) Union(x, y T) bool {
	rx, ry := d.Find(x), d.Find(y)
	if rx == ry {
		return false
	}
	if d.size[rx] < d.size[ry] {
		rx, ry = ry, rx
	}
	d.parent[ry] = rx
	d.size[rx] += d.size[ry]
	return true
}

func (d *DSU[T]) Connected(x, y T) bool {
	return d.Find(x) == d.Find(y)
}

func (d *DSU[T]) Size(x T) int {
	return d.size[d.Find(x)]
}

// Tests
func main() {
	d := NewDSU[int]()
	for i := 1; i <= 7; i++ {
		d.MakeSet(i)
	}
	if !d.Union(1, 2) {
		panic("union 1,2")
	}
	if !d.Union(3, 4) {
		panic("union 3,4")
	}
	if !d.Connected(1, 2) {
		panic("1-2")
	}
	if d.Connected(1, 3) {
		panic("not yet")
	}

	d.Union(1, 3)
	if !d.Connected(2, 4) {
		panic("2-4 should be connected")
	}
	if d.Size(1) != 4 {
		panic("size")
	}
	if d.Union(2, 4) {
		panic("already merged")
	}
	if d.Size(7) != 1 {
		panic("isolated")
	}
	fmt.Println("All tests passed.")
}
```

---

## 2. Cheat-Sheet
1. parent[T]T + size[T]int maps.
2. Find with iterative path compression.
3. Union by size.
4. Amortized O(α(n)).

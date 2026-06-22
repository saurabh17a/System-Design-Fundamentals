# Min Heap — Machine Coding (Go)

> **Difficulty:** Medium
> **Tags:** `[mc]` `[generics]` `[heap]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

Imagine an ER. Patients arrive randomly, but doctors take the most-urgent first. A **priority queue** does exactly this for data; a **min-heap** is the data structure that makes it fast, with the smallest element always on top.

### Why solve it?

- **Real world**: schedulers, Dijkstra's shortest path, top-K problems, event simulators.
- **Teaches**: representing a tree as an array (no pointers!), generic programming.
- **Interview**: any algorithm round can pivot to a heap problem.

### Vocabulary

- **Priority queue** — abstract type: insert with priority, remove highest-priority.
- **Heap** — array-backed complete binary tree with parent ≤ children (min-heap).
- **Sift up / sift down** — restore heap property after inserting / removing.
- **O(log n)** — time grows with `log` of size; fast.

### High-level approach

Store the tree in an array. For node at index `i`:
- Children: `2i+1`, `2i+2`.
- Parent: `(i-1)/2`.

**Push(x)**: append to end → sift up.
**Pop()**: index-0 is the min → swap with last → sift down.

Go's stdlib has `container/heap` but requires implementing 5 interface methods. We use **generics** for a cleaner standalone heap.

### How to read this doc

- **Beginner**: see how the index math replaces pointer-based trees.
- **Interview**: be ready to compare to `container/heap` and explain trade-offs.

---

## 1. Note

Go's stdlib has `container/heap` but it requires implementing 5 interface methods. We build a generic standalone version.

---

## 2. Code

```go
package main

import "fmt"

type MinHeap[T any] struct {
	data []T
	less func(a, b T) bool
}

func NewMinHeap[T any](less func(a, b T) bool, items []T) *MinHeap[T] {
	h := &MinHeap[T]{data: append([]T(nil), items...), less: less}
	if len(h.data) > 0 {
		h.heapify()
	}
	return h
}

func (h *MinHeap[T]) heapify() {
	for i := len(h.data)/2 - 1; i >= 0; i-- {
		h.siftDown(i)
	}
}

func (h *MinHeap[T]) Push(v T) {
	h.data = append(h.data, v)
	h.siftUp(len(h.data) - 1)
}

func (h *MinHeap[T]) Pop() (T, bool) {
	var zero T
	if len(h.data) == 0 {
		return zero, false
	}
	top := h.data[0]
	last := h.data[len(h.data)-1]
	h.data = h.data[:len(h.data)-1]
	if len(h.data) > 0 {
		h.data[0] = last
		h.siftDown(0)
	}
	return top, true
}

func (h *MinHeap[T]) Peek() (T, bool) {
	var zero T
	if len(h.data) == 0 {
		return zero, false
	}
	return h.data[0], true
}

func (h *MinHeap[T]) Len() int { return len(h.data) }

func (h *MinHeap[T]) siftUp(i int) {
	for i > 0 {
		p := (i - 1) / 2
		if h.less(h.data[i], h.data[p]) {
			h.data[i], h.data[p] = h.data[p], h.data[i]
			i = p
		} else {
			return
		}
	}
}

func (h *MinHeap[T]) siftDown(i int) {
	n := len(h.data)
	for {
		l, r := 2*i+1, 2*i+2
		smallest := i
		if l < n && h.less(h.data[l], h.data[smallest]) {
			smallest = l
		}
		if r < n && h.less(h.data[r], h.data[smallest]) {
			smallest = r
		}
		if smallest == i {
			return
		}
		h.data[i], h.data[smallest] = h.data[smallest], h.data[i]
		i = smallest
	}
}

// Tests
func main() {
	intLess := func(a, b int) bool { return a < b }

	fmt.Println("--- basic ---")
	h := NewMinHeap[int](intLess, nil)
	for _, v := range []int{5, 3, 8, 1, 9, 2} {
		h.Push(v)
	}
	if v, _ := h.Peek(); v != 1 {
		panic(v)
	}
	var sorted []int
	for h.Len() > 0 {
		v, _ := h.Pop()
		sorted = append(sorted, v)
	}
	for i := 1; i < len(sorted); i++ {
		if sorted[i] < sorted[i-1] {
			panic("not sorted")
		}
	}
	fmt.Println("  OK")

	fmt.Println("--- heapify ---")
	h2 := NewMinHeap[int](intLess, []int{9, 5, 7, 3, 1, 4})
	if v, _ := h2.Peek(); v != 1 {
		panic(v)
	}
	fmt.Println("  OK")

	fmt.Println("--- max-heap via reversed less ---")
	maxH := NewMinHeap[int](func(a, b int) bool { return a > b }, nil)
	for _, v := range []int{3, 1, 5, 2} {
		maxH.Push(v)
	}
	if v, _ := maxH.Peek(); v != 5 {
		panic(v)
	}
	fmt.Println("  OK")

	fmt.Println("--- custom struct ---")
	type item struct {
		Pri  int
		Name string
	}
	h3 := NewMinHeap[item](func(a, b item) bool { return a.Pri < b.Pri }, nil)
	h3.Push(item{3, "c"})
	h3.Push(item{1, "a"})
	h3.Push(item{2, "b"})
	if v, _ := h3.Pop(); v.Pri != 1 || v.Name != "a" {
		panic(v)
	}
	fmt.Println("  OK")

	fmt.Println("All tests passed.")
}
```

---

## 3. Cross-Questions

### 3.1 vs `container/heap`?
Stdlib heap requires implementing `heap.Interface`. Generic ours is simpler.
Both same complexity.

### 3.2 Why `less` function?
Go has no `Comparable` constraint; user passes comparator. More flexible.

### 3.3 What about thread safety?
Not built-in. Wrap with sync.Mutex or use channel-based actor.

---

## 4. Cheat-Sheet
1. Generic over `T` with `less` comparator.
2. Same array-as-tree algorithm.
3. Floyd's heapify O(n) for bulk init.

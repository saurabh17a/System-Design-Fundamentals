# Skip List — Machine Coding (Go)

> **Difficulty:** Hard
> **Tags:** `[mc]` `[probabilistic]` `[generics]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

A sorted linked list with **express lanes**. Base level has everything; level 1 has half the items, level 2 has half of those, etc. To find an item, ride the highest express lane until you'd overshoot, drop down, repeat. O(log n) expected. No rotations like a red-black tree — just coin flips.

### Why solve it?

- **Real world**: Redis sorted sets, Java's ConcurrentSkipListMap, parts of LevelDB.
- **Teaches**: probabilistic structures; alternative to balanced trees with simpler code; generics for ordered types.
- **Interview**: harder problem; shows comfort with randomized algorithms.

### Vocabulary

- **Level** — height of express lanes; level 0 has everything.
- **Promotion** — coin flip; with prob 0.5, item appears in the next level up.
- **Probabilistic balance** — randomness keeps the structure ~balanced on average.

### High-level approach

Each node: `value T`, `forward []*Node` (one entry per level).

**Search(x)**: top-level head; walk while `forward[level] < x`; drop down. At level 0, the next pointer is x (or not).
**Insert(x)**: find insertion points at each level; coin-flip the height; splice in.
**Delete(x)**: find predecessors; unlink at each level.

In Go: `SkipList[T cmp.Ordered]` using the new constraint.

### How to read this doc

- **Beginner**: draw 3-4 levels and trace search by hand.
- **Interview**: defend probabilistic vs deterministic balance.

---

## 1. Code

```go
package main

import (
	"fmt"
	"math/rand"
)

const (
	maxLevel = 16
	probP    = 0.5
)

type slNode[T any] struct {
	value   T
	forward []*slNode[T]
}

type SkipList[T any] struct {
	head  *slNode[T]
	level int
	size  int
	less  func(a, b T) bool
	rng   *rand.Rand
}

func NewSkipList[T any](less func(a, b T) bool, seed int64) *SkipList[T] {
	return &SkipList[T]{
		head:  &slNode[T]{forward: make([]*slNode[T], maxLevel+1)},
		less:  less,
		rng:   rand.New(rand.NewSource(seed)),
	}
}

func (s *SkipList[T]) randomLevel() int {
	lvl := 0
	for s.rng.Float64() < probP && lvl < maxLevel {
		lvl++
	}
	return lvl
}

func (s *SkipList[T]) Insert(value T) {
	update := make([]*slNode[T], maxLevel+1)
	for i := range update {
		update[i] = s.head
	}
	cur := s.head
	for i := s.level; i >= 0; i-- {
		for cur.forward[i] != nil && s.less(cur.forward[i].value, value) {
			cur = cur.forward[i]
		}
		update[i] = cur
	}
	if cur.forward[0] != nil && !s.less(value, cur.forward[0].value) && !s.less(cur.forward[0].value, value) {
		return // duplicate
	}
	lvl := s.randomLevel()
	if lvl > s.level {
		s.level = lvl
	}
	node := &slNode[T]{value: value, forward: make([]*slNode[T], lvl+1)}
	for i := 0; i <= lvl; i++ {
		node.forward[i] = update[i].forward[i]
		update[i].forward[i] = node
	}
	s.size++
}

func (s *SkipList[T]) Search(value T) bool {
	cur := s.head
	for i := s.level; i >= 0; i-- {
		for cur.forward[i] != nil && s.less(cur.forward[i].value, value) {
			cur = cur.forward[i]
		}
	}
	candidate := cur.forward[0]
	return candidate != nil && !s.less(value, candidate.value) && !s.less(candidate.value, value)
}

func (s *SkipList[T]) Delete(value T) bool {
	update := make([]*slNode[T], maxLevel+1)
	for i := range update {
		update[i] = s.head
	}
	cur := s.head
	for i := s.level; i >= 0; i-- {
		for cur.forward[i] != nil && s.less(cur.forward[i].value, value) {
			cur = cur.forward[i]
		}
		update[i] = cur
	}
	target := cur.forward[0]
	if target == nil || s.less(target.value, value) || s.less(value, target.value) {
		return false
	}
	for i := 0; i <= s.level; i++ {
		if update[i].forward[i] != target {
			break
		}
		update[i].forward[i] = target.forward[i]
	}
	for s.level > 0 && s.head.forward[s.level] == nil {
		s.level--
	}
	s.size--
	return true
}

func (s *SkipList[T]) Len() int { return s.size }

func (s *SkipList[T]) ToSlice() []T {
	var out []T
	cur := s.head.forward[0]
	for cur != nil {
		out = append(out, cur.value)
		cur = cur.forward[0]
	}
	return out
}

// Tests
func main() {
	sl := NewSkipList[int](func(a, b int) bool { return a < b }, 42)
	for _, v := range []int{3, 7, 1, 9, 5, 2, 8} {
		sl.Insert(v)
	}
	if !sl.Search(5) || sl.Search(4) {
		panic("search")
	}
	got := sl.ToSlice()
	for i := 1; i < len(got); i++ {
		if got[i-1] >= got[i] {
			panic("not sorted")
		}
	}
	if !sl.Delete(5) || sl.Delete(5) {
		panic("delete")
	}
	fmt.Println("All tests passed.")
}
```

---

## 2. Cheat-Sheet
1. Multi-level forward arrays.
2. Random level: geometric.
3. Search: top-down, right-as-far.
4. O(log n) average.

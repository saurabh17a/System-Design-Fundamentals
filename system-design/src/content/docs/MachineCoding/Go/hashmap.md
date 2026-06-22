# Custom HashMap — Machine Coding (Go)

> **Difficulty:** Medium
> **Tags:** `[mc]` `[generics]` `[hashing]` `[chaining]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

When you write `m["alice"] = 30` in Go, you're using a hashmap. The runtime hashes "alice" to a number, picks an internal slot from that number, and stores the pair there. Lookups do the same. We build this from scratch — using **generics** so it works for any key/value types.

### Why solve it?

- **Real world**: every map / dict / object in every language is a hashmap.
- **Teaches**: hashing, collision handling (chaining), load factor, resizing.
- **Interview**: tests fundamentals beneath the syntax.

### Vocabulary

- **Hash function** — turns any key into a number.
- **Bucket** — a slot in the internal array; collisions chain there.
- **Collision** — two keys → same bucket; resolve via chaining (a list per bucket).
- **Load factor** — items / buckets. > 0.75 → grow.
- **Rehash** — on grow, redistribute every item to the bigger array.

### High-level approach

Internal storage: `[]bucket`, where each `bucket` holds a slice of `(key, value)` entries.

**Put(k, v)**: hash k → bucket index. Linear-scan bucket; if k exists, update; else append. If load factor too high, double size + rehash.
**Get(k)**: same hash; scan bucket; return value or zero.
**Delete(k)**: same; remove from bucket.

In Go, we use generics: `HashMap[K comparable, V any]`. `K comparable` is required because we compare keys with `==` inside buckets.

### How to read this doc

- **Beginner**: trace put/get/resize on paper.
- **Interview**: be ready to compare to Go's actual map (which uses open addressing) and discuss complexity.

---

## 0. Why this question

Go's `map` is a black box; this question opens it. Tests **chaining + resize + generics**.

---

## 1. Approach

Same as Python: array of buckets, each = slice of (K,V) pairs. Resize when load factor exceeded.

Go-specific:
- Generics with `K comparable` constraint (only comparable types can be keys).
- `hash/maphash` for stdlib hashing (per-process random seed).

---

## 2. Code

```go
// File: hashmap.go
package main

import (
	"fmt"
	"hash/maphash"
)

type entry[K comparable, V any] struct {
	key   K
	value V
}

type HashMap[K comparable, V any] struct {
	buckets [][]entry[K, V]
	size    int
	hasher  maphash.Hash
	seed    maphash.Seed
}

const (
	initialCap = 16
	loadFactor = 0.75
)

func NewHashMap[K comparable, V any]() *HashMap[K, V] {
	return &HashMap[K, V]{
		buckets: make([][]entry[K, V], initialCap),
		seed:    maphash.MakeSeed(),
	}
}

func (h *HashMap[K, V]) hashKey(key K) uint64 {
	h.hasher.SetSeed(h.seed)
	h.hasher.Reset()
	// crude: stringify key for hashing
	fmt.Fprint(&h.hasher, key)
	return h.hasher.Sum64()
}

func (h *HashMap[K, V]) bucketIdx(key K) int {
	return int(h.hashKey(key) % uint64(len(h.buckets)))
}

func (h *HashMap[K, V]) Put(key K, value V) {
	if float64(h.size+1) > float64(len(h.buckets))*loadFactor {
		h.resize()
	}
	idx := h.bucketIdx(key)
	for i, e := range h.buckets[idx] {
		if e.key == key {
			h.buckets[idx][i].value = value
			return
		}
	}
	h.buckets[idx] = append(h.buckets[idx], entry[K, V]{key, value})
	h.size++
}

func (h *HashMap[K, V]) Get(key K) (V, bool) {
	var zero V
	idx := h.bucketIdx(key)
	for _, e := range h.buckets[idx] {
		if e.key == key {
			return e.value, true
		}
	}
	return zero, false
}

func (h *HashMap[K, V]) Delete(key K) bool {
	idx := h.bucketIdx(key)
	for i, e := range h.buckets[idx] {
		if e.key == key {
			h.buckets[idx] = append(h.buckets[idx][:i], h.buckets[idx][i+1:]...)
			h.size--
			return true
		}
	}
	return false
}

func (h *HashMap[K, V]) Len() int {
	return h.size
}

func (h *HashMap[K, V]) resize() {
	oldBuckets := h.buckets
	h.buckets = make([][]entry[K, V], len(oldBuckets)*2)
	h.size = 0
	for _, b := range oldBuckets {
		for _, e := range b {
			h.Put(e.key, e.value)
		}
	}
}

// Tests

func main() {
	basic()
	resize()
	fmt.Println("All tests passed.")
}

func basic() {
	fmt.Println("--- basic ---")
	h := NewHashMap[string, int]()
	h.Put("a", 1)
	h.Put("b", 2)
	if v, ok := h.Get("a"); !ok || v != 1 {
		panic("a")
	}
	if _, ok := h.Get("c"); ok {
		panic("c should miss")
	}
	h.Put("a", 100)
	if v, _ := h.Get("a"); v != 100 {
		panic("update")
	}
	if !h.Delete("b") {
		panic("delete b")
	}
	if h.Delete("b") {
		panic("re-delete")
	}
	fmt.Println("  OK")
}

func resize() {
	fmt.Println("--- resize ---")
	h := NewHashMap[int, int]()
	for i := 0; i < 100; i++ {
		h.Put(i, i*10)
	}
	for i := 0; i < 100; i++ {
		if v, ok := h.Get(i); !ok || v != i*10 {
			panic(fmt.Sprintf("i=%d", i))
		}
	}
	if h.Len() != 100 {
		panic("size")
	}
	if len(h.buckets) <= initialCap {
		panic("did not resize")
	}
	fmt.Printf("  capacity=%d, size=%d OK\n", len(h.buckets), h.Len())
}
```

---

## 3. Cross-Questions

### 3.1 Why `comparable` constraint?
Map keys must support `==`. `comparable` is Go's built-in constraint.

### 3.2 Why `hash/maphash`?
Stdlib; randomized seed per process (DoS protection).

### 3.3 What if key has no good `Stringer` for hashing?
We use `fmt.Fprint` → relies on `%v` default formatting. For custom types: implement Hash() method or use a hash interface.

### 3.4 Why slice for chain not linked list?
Slice is faster for small N (cache-friendly). Linked list better only at N > 100 in chain (means bad hash).

### 3.5 Generics overhead?
None at runtime. Compiled per-type.

### 3.6 vs Go's built-in map?
- Go's map uses open addressing + grow strategy similar to ours.
- Go's map handles concurrent read; this one doesn't.
- Production: use Go's map; this is for the question.

---

## 4. Cheat-Sheet
1. `[]bucket` of `[]entry[K,V]`.
2. `hash(K) % len(buckets)` → bucket.
3. Resize on load factor > 0.75.
4. Generics with `K comparable, V any`.
5. `hash/maphash` for stdlib hashing.

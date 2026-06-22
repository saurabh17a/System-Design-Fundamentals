# LFU Cache — Machine Coding (Go)

> **Difficulty:** Hard
> **Tags:** `[mc]` `[generics]` `[O(1)]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

LRU evicts the **least recently used**. **LFU** evicts the **least frequently used** — rare items go first. Sometimes a better fit (streaming caches where popularity is skewed).

The challenge: O(1) for everything, including eviction.

### Why solve it?

- **Real world**: skewed-popularity caches.
- **Teaches**: combining hashmap with one doubly linked list per frequency, tracking minimum frequency.
- **Interview**: harder than LRU; follow-up question.

### Vocabulary

- **Frequency** — access count for this key.
- **Frequency bucket** — DLL of items with the same count.
- **min_freq** — smallest frequency currently in the cache.

### High-level approach

Structures:
1. `map[K]*node` — key → node.
2. `map[int]*list.List` — frequency → list of items.
3. `minFreq int` — smallest frequency present.

**Get(k)**: lookup; remove from current freq list; freq++; reinsert at head of new freq list. Update minFreq if needed.
**Put(k, v)**: update existing OR evict from `lists[minFreq]` tail and insert with freq=1, set minFreq=1.

The minFreq trick keeps eviction O(1) — no scanning needed.

In Go: generic `LFU[K comparable, V any]` with a `sync.Mutex`.

### How to read this doc

- **Beginner**: read the LRU doc first.
- **Interview**: explain why the min_freq tracker stays correct across all operations.

---

## 1. Approach

Same as Python: key→node, freq→DLL, min_freq tracker.

---

## 2. Code

```go
package main

import "fmt"

type lfuNode[K comparable, V any] struct {
	key   K
	value V
	freq  int
	prev  *lfuNode[K, V]
	next  *lfuNode[K, V]
}

type dll[K comparable, V any] struct {
	head *lfuNode[K, V]
	tail *lfuNode[K, V]
	size int
}

func newDLL[K comparable, V any]() *dll[K, V] {
	d := &dll[K, V]{
		head: &lfuNode[K, V]{},
		tail: &lfuNode[K, V]{},
	}
	d.head.next = d.tail
	d.tail.prev = d.head
	return d
}

func (d *dll[K, V]) addFront(n *lfuNode[K, V]) {
	nxt := d.head.next
	n.prev = d.head
	n.next = nxt
	d.head.next = n
	nxt.prev = n
	d.size++
}

func (d *dll[K, V]) remove(n *lfuNode[K, V]) {
	n.prev.next = n.next
	n.next.prev = n.prev
	n.prev, n.next = nil, nil
	d.size--
}

func (d *dll[K, V]) popTail() *lfuNode[K, V] {
	if d.size == 0 {
		return nil
	}
	n := d.tail.prev
	d.remove(n)
	return n
}

type LFUCache[K comparable, V any] struct {
	cap        int
	keyToNode  map[K]*lfuNode[K, V]
	freqToDll  map[int]*dll[K, V]
	minFreq    int
}

func NewLFUCache[K comparable, V any](capacity int) *LFUCache[K, V] {
	if capacity <= 0 {
		panic("capacity must be positive")
	}
	return &LFUCache[K, V]{
		cap:       capacity,
		keyToNode: make(map[K]*lfuNode[K, V]),
		freqToDll: make(map[int]*dll[K, V]),
	}
}

func (c *LFUCache[K, V]) Get(key K) (V, bool) {
	var zero V
	n, ok := c.keyToNode[key]
	if !ok {
		return zero, false
	}
	c.bump(n)
	return n.value, true
}

func (c *LFUCache[K, V]) Put(key K, value V) {
	if c.cap == 0 {
		return
	}
	if n, ok := c.keyToNode[key]; ok {
		n.value = value
		c.bump(n)
		return
	}
	if len(c.keyToNode) >= c.cap {
		c.evict()
	}
	n := &lfuNode[K, V]{key: key, value: value, freq: 1}
	c.keyToNode[key] = n
	if _, ok := c.freqToDll[1]; !ok {
		c.freqToDll[1] = newDLL[K, V]()
	}
	c.freqToDll[1].addFront(n)
	c.minFreq = 1
}

func (c *LFUCache[K, V]) bump(n *lfuNode[K, V]) {
	old := c.freqToDll[n.freq]
	old.remove(n)
	if old.size == 0 {
		delete(c.freqToDll, n.freq)
		if c.minFreq == n.freq {
			c.minFreq++
		}
	}
	n.freq++
	if _, ok := c.freqToDll[n.freq]; !ok {
		c.freqToDll[n.freq] = newDLL[K, V]()
	}
	c.freqToDll[n.freq].addFront(n)
}

func (c *LFUCache[K, V]) evict() {
	d := c.freqToDll[c.minFreq]
	victim := d.popTail()
	if d.size == 0 {
		delete(c.freqToDll, c.minFreq)
	}
	delete(c.keyToNode, victim.key)
}

func (c *LFUCache[K, V]) Len() int { return len(c.keyToNode) }

// Tests

func main() {
	basic()
	evictionOrder()
	tieBrokenByLRU()
	fmt.Println("All tests passed.")
}

func basic() {
	fmt.Println("--- basic ---")
	c := NewLFUCache[string, int](2)
	c.Put("a", 1)
	c.Put("b", 2)
	if v, ok := c.Get("a"); !ok || v != 1 {
		panic("a")
	}
	c.Put("c", 3) // evicts b
	if _, ok := c.Get("b"); ok {
		panic("b should be evicted")
	}
	if v, _ := c.Get("c"); v != 3 {
		panic("c")
	}
	fmt.Println("  OK")
}

func evictionOrder() {
	fmt.Println("--- eviction order ---")
	c := NewLFUCache[string, int](3)
	c.Put("a", 1); c.Put("b", 2); c.Put("c", 3)
	c.Get("a"); c.Get("b") // a,b freq=2; c freq=1
	c.Put("d", 4) // c evicted
	if _, ok := c.Get("c"); ok {
		panic("c should be evicted")
	}
	fmt.Println("  OK")
}

func tieBrokenByLRU() {
	fmt.Println("--- tie broken by LRU ---")
	c := NewLFUCache[string, int](3)
	c.Put("a", 1); c.Put("b", 2); c.Put("c", 3)
	c.Put("d", 4) // a is LRU at freq=1, evicted
	if _, ok := c.Get("a"); ok {
		panic("a should be evicted")
	}
	fmt.Println("  OK")
}
```

---

## 3. Cheat-Sheet
1. `keyToNode` + `freqToDLL` + `minFreq`.
2. Get: bump frequency.
3. Put: evict tail of minFreq DLL.
4. minFreq incremented when its DLL empties.
5. O(1) all ops; generics for K,V.

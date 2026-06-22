# In-Memory DB with Transactions — Machine Coding (Go)

> **Difficulty:** Medium → Hard
> **Tags:** `[mc]` `[transactions]` `[stack]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

A small in-memory key-value store with **transactions**: do a bunch of `Set` calls, then either `Commit` (keep) or `Rollback` (discard). Plus nesting: `Begin` inside `Begin`, with independent rollback.

### Why solve it?

- **Real world**: every DB has this.
- **Teaches**: stack of layered maps for clean nesting.
- **Interview**: HackerRank-style classic.

### Vocabulary

- **Transaction** — atomic group of operations.
- **Begin / Commit / Rollback** — start / accept / discard.
- **Nested** — transactions inside transactions.

### High-level approach

A `[]map[string]string` stack. Each `Begin` pushes an empty layer.

**Get(k)**: scan from top to bottom for first match.
**Set(k, v)**: write to top layer.
**Delete(k)**: write a sentinel "deleted" to top layer.
**Commit**: merge top into below.
**Rollback**: pop top.

Layers cleanly handle any nesting depth.

### How to read this doc

- **Beginner**: trace operations on paper.
- **Interview**: edge cases at depth 0; deletes mixing with sets.

---

## 1. Approach

Same as Python: layered stack. Each Begin pushes layer; Commit merges; Rollback pops.

Tombstone via sentinel value.

---

## 2. Code

```go
package main

import "fmt"

const tombstone = "<TOMBSTONE>"

type layer struct {
	kv         map[string]string  // value or tombstone
	countDelta map[string]int     // value → delta
}

func newLayer() *layer {
	return &layer{
		kv:         make(map[string]string),
		countDelta: make(map[string]int),
	}
}

type TxnDB struct {
	layers []*layer
}

func NewTxnDB() *TxnDB {
	return &TxnDB{layers: []*layer{newLayer()}}
}

func (d *TxnDB) Set(key, value string) {
	old, _ := d.Get(key)
	top := d.layers[len(d.layers)-1]
	top.kv[key] = value
	if old != "" {
		top.countDelta[old]--
	}
	top.countDelta[value]++
}

func (d *TxnDB) Get(key string) (string, bool) {
	for i := len(d.layers) - 1; i >= 0; i-- {
		v, ok := d.layers[i].kv[key]
		if ok {
			if v == tombstone {
				return "", false
			}
			return v, true
		}
	}
	return "", false
}

func (d *TxnDB) Delete(key string) {
	old, ok := d.Get(key)
	if !ok {
		return
	}
	top := d.layers[len(d.layers)-1]
	top.kv[key] = tombstone
	top.countDelta[old]--
}

func (d *TxnDB) Count(value string) int {
	total := 0
	for _, l := range d.layers {
		total += l.countDelta[value]
	}
	if total < 0 {
		return 0
	}
	return total
}

func (d *TxnDB) Begin() {
	d.layers = append(d.layers, newLayer())
}

func (d *TxnDB) Commit() bool {
	if len(d.layers) <= 1 {
		return false
	}
	top := d.layers[len(d.layers)-1]
	d.layers = d.layers[:len(d.layers)-1]
	below := d.layers[len(d.layers)-1]
	for k, v := range top.kv {
		below.kv[k] = v
	}
	for v, delta := range top.countDelta {
		below.countDelta[v] += delta
	}
	return true
}

func (d *TxnDB) Rollback() bool {
	if len(d.layers) <= 1 {
		return false
	}
	d.layers = d.layers[:len(d.layers)-1]
	return true
}

// Tests

func main() {
	basic()
	commit()
	rollback()
	nested()
	deleteRollback()
	countInTxn()
	fmt.Println("All tests passed.")
}

func basic() {
	fmt.Println("--- basic ---")
	d := NewTxnDB()
	d.Set("a", "1")
	if v, _ := d.Get("a"); v != "1" {
		panic("get")
	}
	d.Delete("a")
	if _, ok := d.Get("a"); ok {
		panic("delete")
	}
	fmt.Println("  OK")
}

func commit() {
	fmt.Println("--- commit ---")
	d := NewTxnDB()
	d.Set("a", "1")
	d.Begin()
	d.Set("a", "2")
	if v, _ := d.Get("a"); v != "2" {
		panic("inner")
	}
	d.Commit()
	if v, _ := d.Get("a"); v != "2" {
		panic("after commit")
	}
	fmt.Println("  OK")
}

func rollback() {
	fmt.Println("--- rollback ---")
	d := NewTxnDB()
	d.Set("a", "1")
	d.Begin()
	d.Set("a", "2")
	d.Rollback()
	if v, _ := d.Get("a"); v != "1" {
		panic("rollback")
	}
	fmt.Println("  OK")
}

func nested() {
	fmt.Println("--- nested ---")
	d := NewTxnDB()
	d.Set("a", "1")
	d.Begin()
	d.Set("a", "2")
	d.Begin()
	d.Set("a", "3")
	d.Rollback()
	if v, _ := d.Get("a"); v != "2" {
		panic("nested")
	}
	d.Commit()
	if v, _ := d.Get("a"); v != "2" {
		panic("nested final")
	}
	fmt.Println("  OK")
}

func deleteRollback() {
	fmt.Println("--- delete rollback ---")
	d := NewTxnDB()
	d.Set("a", "1")
	d.Begin()
	d.Delete("a")
	if _, ok := d.Get("a"); ok {
		panic("inner")
	}
	d.Rollback()
	if v, _ := d.Get("a"); v != "1" {
		panic("rolled back")
	}
	fmt.Println("  OK")
}

func countInTxn() {
	fmt.Println("--- count in txn ---")
	d := NewTxnDB()
	d.Set("a", "x")
	d.Begin()
	d.Set("b", "x")
	if d.Count("x") != 2 {
		panic("count in txn")
	}
	d.Rollback()
	if d.Count("x") != 1 {
		panic("count after rollback")
	}
	fmt.Println("  OK")
}
```

---

## 3. Cheat-Sheet
1. Stack of layers (slices in Go).
2. Read walks top-down.
3. Delete = tombstone marker.
4. Commit merges top into below; Rollback drops top.
5. Count via per-layer delta sum.

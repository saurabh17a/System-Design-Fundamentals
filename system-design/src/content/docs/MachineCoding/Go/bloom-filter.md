# Bloom Filter — Machine Coding (Go)

> **Difficulty:** Medium
> **Tags:** `[mc]` `[probabilistic]` `[hashing]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

You have a list of 100M bad URLs. Users type URLs; did we already see this one? A **Bloom filter** answers in two flavors:
- **"Definitely no."** Always correct.
- **"Probably yes."** Small false-positive rate, never false negative.

In return, the filter is tiny — a few MB instead of GB.

### Why solve it?

- **Real world**: crawlers, DB skip-reads, CDN cache filtering, password breach checks.
- **Teaches**: probabilistic data structures, hashing tricks, false-positive math.
- **Interview**: shows you can trade exactness for efficiency intentionally.

### Vocabulary

- **Bit array** — fixed-size array of 0/1, packed tightly.
- **K hash functions** — Bloom uses several near-independent hashes.
- **False positive** — saying "seen" when we haven't. Allowed.
- **False negative** — saying "not seen" when we have. Never allowed.

### High-level approach

Bit array of size `m`. K hash functions.

**Add(x)**: hash x with each of k; set those bits to 1.
**Contains(x)**: hash same way; if all k bits are 1 → "probably yes" else "definitely no."

False-positive rate: `(1 - e^(-kn/m))^k` where n = items added. Tune m and k.

Trick: only need 2 hashes; derive k variants with `h_i = h1 + i * h2` (double hashing).

### How to read this doc

- **Beginner**: section 1 explains the bit-array + multi-hash trick.
- **Interview**: know the math; pick m and k from a target FPR.

---

## 1. Approach

Same as Python. `crypto/sha256` for digest; double hashing for k variants.

---

## 2. Code

```go
package main

import (
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"math"
)

type BloomFilter struct {
	bits []byte
	m    uint64
	k    uint
}

func NewBloomFilter(expected int, fpRate float64) *BloomFilter {
	if expected <= 0 || fpRate <= 0 || fpRate >= 1 {
		panic("invalid params")
	}
	m := uint64(math.Max(1, -float64(expected)*math.Log(fpRate)/(math.Ln2*math.Ln2)))
	k := uint(math.Max(1, math.Round((float64(m)/float64(expected))*math.Ln2)))
	return &BloomFilter{
		bits: make([]byte, (m+7)/8),
		m:    m,
		k:    k,
	}
}

func (b *BloomFilter) hashes(item string) (h1, h2 uint64) {
	d := sha256.Sum256([]byte(item))
	h1 = binary.BigEndian.Uint64(d[:8])
	h2 = binary.BigEndian.Uint64(d[8:16])
	return
}

func (b *BloomFilter) Add(item string) {
	h1, h2 := b.hashes(item)
	for i := uint(0); i < b.k; i++ {
		idx := (h1 + uint64(i)*h2) % b.m
		b.bits[idx>>3] |= 1 << (idx & 7)
	}
}

func (b *BloomFilter) Contains(item string) bool {
	h1, h2 := b.hashes(item)
	for i := uint(0); i < b.k; i++ {
		idx := (h1 + uint64(i)*h2) % b.m
		if b.bits[idx>>3]&(1<<(idx&7)) == 0 {
			return false
		}
	}
	return true
}

func (b *BloomFilter) SizeBits() uint64 { return b.m }
func (b *BloomFilter) NumHashes() uint  { return b.k }

// Tests

func main() {
	basic()
	fpRate()
	noFalseNeg()
	fmt.Println("All tests passed.")
}

func basic() {
	fmt.Println("--- basic ---")
	bf := NewBloomFilter(1000, 0.01)
	bf.Add("hello")
	bf.Add("world")
	if !bf.Contains("hello") || !bf.Contains("world") {
		panic("missing")
	}
	if bf.Contains("xyzzy") {
		// possible false positive but unlikely
	}
	fmt.Printf("  OK m=%d k=%d\n", bf.SizeBits(), bf.NumHashes())
}

func fpRate() {
	fmt.Println("--- fp rate ---")
	n := 10000
	bf := NewBloomFilter(n, 0.01)
	for i := 0; i < n; i++ {
		bf.Add(fmt.Sprintf("item-%d", i))
	}
	fp := 0
	for i := n; i < 2*n; i++ {
		if bf.Contains(fmt.Sprintf("item-%d", i)) {
			fp++
		}
	}
	rate := float64(fp) / float64(n)
	fmt.Printf("  observed: %.4f (target 0.01)\n", rate)
	if rate > 0.02 {
		panic("FP rate too high")
	}
}

func noFalseNeg() {
	fmt.Println("--- no false neg ---")
	bf := NewBloomFilter(1000, 0.01)
	for i := 0; i < 1000; i++ {
		bf.Add(fmt.Sprintf("x%d", i))
	}
	for i := 0; i < 1000; i++ {
		if !bf.Contains(fmt.Sprintf("x%d", i)) {
			panic(fmt.Sprintf("false neg: x%d", i))
		}
	}
	fmt.Println("  OK")
}
```

---

## 3. Cheat-Sheet
1. Bit array; k hash functions per item.
2. m = -n ln(p) / (ln 2)²; k = (m/n) ln 2.
3. Double hashing (Kirsch-Mitzenmacher): h_i = h1 + i*h2.
4. No false negatives; false positives bounded.
5. Use cases: cache miss filter, URL dedup, DB file skip.

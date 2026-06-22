# Bloom Filter — Machine Coding (Python)

> **Difficulty:** Medium
> **Tags:** `[mc]` `[probabilistic]` `[memory-efficient]` `[hashing]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

You have a list of 100 million bad URLs. A user types one in. Did we already see it? Searching the list takes too long; storing it costs too much memory. A **Bloom filter** is a tiny data structure (a few MB instead of GB) that answers "have I seen X?" with two possible replies:
- **"Definitely no."** Always correct.
- **"Probably yes."** Might be a false positive — but never a false negative.

Once you accept that small false-positive rate (e.g. 1 in 1000), you save massive memory.

### Why solve it?

- **Real world**: web crawlers (don't re-crawl), databases (skip reading a file if it can't contain the key), CDN cache filtering, password breach checks.
- **Teaches**: probabilistic thinking, multi-hash design, the math of false-positive rates.
- **Interview**: tests willingness to trade exactness for efficiency.

### Vocabulary

- **Bit array** — a fixed-size array of bits (0/1), conceptually an array of booleans but tightly packed.
- **Hash function** — a function that turns any input into a number; ideally with no patterns.
- **K hash functions** — Bloom filters use K independent-ish hashes.
- **False positive** — saying "seen" when we haven't. Bloom filters allow these.
- **False negative** — saying "not seen" when we have. Bloom filters NEVER allow these.

### High-level approach

Pick a bit array of size `m`. Pick `k` hash functions.

**Add(x)**: hash x with each of the k functions; set those k bits to 1.
**Contains(x)**: hash x same way; check if ALL k bits are 1.
- All 1 → "probably yes" (false positive possible if other items happened to set those bits).
- Any 0 → "definitely no" (we'd have set them on add).

The false-positive rate is `(1 - e^(-kn/m))^k` where n = items added. Pick m and k for your tolerance.

In practice, two hash functions are enough — derive the rest with `h_i(x) = h1(x) + i * h2(x)` (double hashing).

### How to read this doc

- **Beginner**: focus on the bit-array + multi-hash insight.
- **Interview**: know the math; be ready to derive optimal k from desired false-positive rate.

---

## 0. Why this question

Tests **probabilistic data structures, false-positive math, multi-hash design**. Bloom filters appear in caches (avoid DB lookup), web crawlers (URL dedup), databases (skip files).

---

## 1. Problem Statement

A space-efficient set with:
- `add(item)`
- `contains(item) -> bool` (no false negatives; some false positives)

Configurable target false-positive rate.

---

## 2. Approach

```
bit array of size m
k hash functions

add(item):
  for each hash i in 1..k:
     bit_array[hash_i(item) % m] = 1

contains(item):
  for each hash i in 1..k:
     if bit_array[hash_i(item) % m] == 0:
        return False  (definitely not present)
  return True  (probably present)
```

### Sizing math

For n items and target false-positive rate p:
- m = -n × ln(p) / (ln 2)²
- k = (m/n) × ln 2

Example: n=10k, p=1% → m≈96k bits (12 KB), k=7.

---

## 3. Code

```python
"""Bloom filter with configurable false-positive rate."""
import math
import hashlib


class BloomFilter:
    def __init__(self, expected_items: int, false_positive_rate: float = 0.01):
        if expected_items <= 0 or not (0 < false_positive_rate < 1):
            raise ValueError("invalid params")
        # m = -n*ln(p) / (ln 2)^2
        self._m = max(1, int(-expected_items * math.log(false_positive_rate) / (math.log(2) ** 2)))
        self._k = max(1, int((self._m / expected_items) * math.log(2)))
        self._bits = bytearray((self._m + 7) // 8)
        self._items = 0

    def _hashes(self, item):
        """Generate k hashes via double hashing trick (Kirsch-Mitzenmacher).
        h_i = (h1 + i * h2) mod m"""
        s = str(item).encode()
        digest = hashlib.sha256(s).digest()
        h1 = int.from_bytes(digest[:8], "big")
        h2 = int.from_bytes(digest[8:16], "big")
        for i in range(self._k):
            yield (h1 + i * h2) % self._m

    def add(self, item) -> None:
        for idx in self._hashes(item):
            self._bits[idx >> 3] |= 1 << (idx & 7)
        self._items += 1

    def contains(self, item) -> bool:
        for idx in self._hashes(item):
            if not (self._bits[idx >> 3] & (1 << (idx & 7))):
                return False
        return True

    def __len__(self) -> int:
        return self._items

    @property
    def size_bits(self) -> int:
        return self._m

    @property
    def num_hashes(self) -> int:
        return self._k


# ─── Tests ───

def _basic():
    print("--- basic ---")
    bf = BloomFilter(expected_items=1000, false_positive_rate=0.01)
    bf.add("hello")
    bf.add("world")
    assert bf.contains("hello")
    assert bf.contains("world")
    assert not bf.contains("foobar")  # high probability of being false
    print(f"  OK; m={bf.size_bits}, k={bf.num_hashes}")


def _false_positive_rate():
    print("--- false positive rate ---")
    n = 10000
    p_target = 0.01
    bf = BloomFilter(expected_items=n, false_positive_rate=p_target)
    for i in range(n):
        bf.add(f"item-{i}")
    # Test with items NOT in the set
    fp = 0
    for i in range(n, 2*n):
        if bf.contains(f"item-{i}"):
            fp += 1
    rate = fp / n
    print(f"  observed FP rate: {rate:.4f} (target: {p_target})")
    assert rate < p_target * 2, "FP rate too high"


def _no_false_negatives():
    print("--- no false negatives ---")
    bf = BloomFilter(expected_items=1000)
    items = [f"x{i}" for i in range(1000)]
    for it in items:
        bf.add(it)
    for it in items:
        assert bf.contains(it), f"false negative: {it}"
    print("  OK; all items found")


if __name__ == "__main__":
    _basic()
    _false_positive_rate()
    _no_false_negatives()
    print("\nAll tests passed.")
```

---

## 4. Cross-Questions

### 4.1 Why no false negatives?
- Adding sets bits.
- Bits never unset (no remove in standard Bloom).
- If all k bits set, we'd never miss a present item.

### 4.2 Why double hashing instead of k separate hash functions?
- Generating k cryptographic hashes per call is expensive.
- Kirsch-Mitzenmacher: combine 2 hashes; k variants via h1 + i × h2.
- Provably similar FP rate.

### 4.3 What if I exceed expected_items?
- FP rate grows.
- Solution: scalable Bloom filter (chain of growing filters) or counting Bloom.

### 4.4 Why can't you delete?
- Setting bits to 0 might incorrectly remove other items sharing those bits.
- Solution: counting Bloom filter (use small counters instead of bits).

### 4.5 Memory analysis
- 10k items @ 1% FP = 12 KB.
- 100M items @ 1% FP = 120 MB.
- 1B items @ 1% FP = 1.2 GB.
- Way smaller than storing items themselves.

### 4.6 What about cache locality?
- All k bit accesses scattered → many cache misses.
- Blocked Bloom: pack k accesses into one cache line.

### 4.7 Comparison with HyperLogLog?
- Bloom: membership.
- HyperLogLog: cardinality (count distinct).
- Different problems.

### 4.8 Comparison with cuckoo filter?
- Cuckoo: supports delete; better space efficiency at low FP rate.
- More complex.

---

## 5. Variants
- **Counting Bloom**: each cell is small integer; supports delete.
- **Scalable Bloom**: grows with new items; chain of filters.
- **Compressed Bloom**: golden-ratio compression.
- **Cuckoo Filter**: supports delete; better at FP < 0.1%.

---

## 6. Cheat-Sheet
1. m = bit array size; k = number of hashes.
2. Math: m = -n ln(p) / (ln 2)²; k = (m/n) ln 2.
3. Double hashing for k variants.
4. No false negatives; bounded false positives.
5. Used in: caches (negative cache), DB (file skip), crawlers (URL dedup).

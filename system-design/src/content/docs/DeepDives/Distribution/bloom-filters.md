# Bloom Filters — Deep Dive

> **Type:** Core concept
> **Tags:** `[probabilistic]` `[data-structure]` `[memory-efficient]` `[membership]`
> **Where it shows up:** [search-autocomplete](../../HLD/search-autocomplete.md), [web-crawler](../../HLD/web-crawler.md), the read path of [Cassandra](../Databases/nosql-cassandra.md)/LSM stores, cache penetration defense
> **Implementation:** see the working [bloom-filter (Go)](../../MachineCoding/Go/bloom-filter.md) / [bloom-filter (Python)](../../MachineCoding/Python/bloom-filter.md) in Machine Coding

---

## Mental model

A Bloom filter answers one question — **"have I seen this element before?"** — using a tiny fraction of the memory a real set would need, by accepting a controlled error. Its defining property:

- **"No" is always correct** — if it says an element is *not* in the set, it definitely isn't (no false negatives).
- **"Yes" might be wrong** — if it says an element *is* in the set, it *probably* is, with a small **false-positive** probability.

So a Bloom filter is a **fast, cheap pre-filter** in front of an expensive lookup: "definitely not there" lets you skip the expensive check entirely; "maybe there" means you do the real check to confirm. It trades a little accuracy for enormous memory savings — storing membership of a billion items in megabytes instead of gigabytes.

## Internals

A Bloom filter is a **bit array of size `m`** (all zeros initially) plus **`k` independent hash functions**.

```
Add("apple"):  hash1→3, hash2→7, hash3→11   →  set bits 3,7,11 to 1
Add("mango"):  hash1→7, hash2→1, hash3→ 9   →  set bits 7,1,9 to 1

bit array: [0,1,0,1,0,0,0,1,0,1,0,1,...]
                ▲   ▲       ▲   ▲   ▲
                1   3       7   9   11

Query("apple"): bits 3,7,11 all 1?  → yes → "probably present"
Query("grape"): hash→ 3,7,2 ; bit 2 is 0 → "definitely absent"
Query("cherry"): hash→ 1,9,11 all 1 (set by others!) → "probably present"  ← FALSE POSITIVE
```

- **Add:** hash the element with all `k` functions, set those `k` bits to 1.
- **Query:** hash with all `k` functions; if **any** bit is 0 → definitely absent. If **all** are 1 → probably present (those bits may have been set by *other* elements — that's the false positive).

False positives arise from **bit collisions**; false negatives are impossible because adding only ever sets bits, never clears them.

### Tuning: m, k, and the false-positive rate

The false-positive rate `p` depends on the bit-array size `m`, the number of hashes `k`, and the number of inserted elements `n`:

- For a target `p` and expected `n`, the optimal sizing is roughly **`m ≈ -n·ln(p) / (ln2)²`** bits and **`k ≈ (m/n)·ln2`** hash functions.
- Rule of thumb: about **~10 bits per element gives ~1% false positives**; ~15 bits ~0.1%. Memory grows only **logarithmically** with the inverse error rate — cheap to make it more accurate.
- More elements than planned → the array saturates (more 1s) → the false-positive rate climbs. Size for your real `n`.

### The catch: no deletion

A standard Bloom filter **can't delete** — clearing an element's bits would also clear bits shared with other elements (false negatives). Workarounds: a **counting Bloom filter** (counters instead of bits, decrement on delete — more memory), or periodically **rebuild** the filter from the source of truth. Also: you **can't enumerate** the contents or get an exact count (HyperLogLog is the tool for approximate counts).

## Where it's used (the canonical applications)

- **Cache penetration / "does this key exist?"** — before hitting the DB for a key that's probably absent (attacker probing random IDs, missing-key floods), check a Bloom filter of existing keys; "definitely absent" → skip the DB. See [caching-strategies](../Caching/caching-strategies.md).
- **LSM-tree reads** — [Cassandra](../Databases/nosql-cassandra.md)/RocksDB keep a Bloom filter per SSTable so a read can **skip SSTables that definitely don't contain the key**, instead of checking every one. This is what makes LSM reads viable ([storage-engines](../Databases/storage-engines-lsm-vs-btree.md)).
- **"Have I crawled/seen this URL?"** — a [web crawler](../../HLD/web-crawler.md) checks a Bloom filter before fetching, to dedupe billions of URLs in modest memory.
- **Dedup at scale** — "have we sent this notification / processed this event?" as a cheap first pass.

The pattern is always the same: **a cheap probabilistic gate in front of an expensive definitive operation**, where you mostly want to confirm absence.

## Tradeoffs & decisions

- **Memory vs accuracy** — the core knob; smaller array = less memory, more false positives. Set by `m`, `k` for your `n` and target `p`.
- **Speed vs precision** — O(k) hashing, no I/O, vs the occasional wasted real lookup on a false positive.
- **No deletes / no enumeration** — accept rebuilds or use a counting variant if you must delete.
- **Sizing risk** — under-provisioning `n` degrades the error rate; you must estimate cardinality up front (or use a scalable Bloom filter that grows).

## When to use / when not

**Use a Bloom filter when:**
- You need a **fast, memory-cheap membership pre-check** and can tolerate a small false-positive rate.
- The expensive operation is **confirming absence** (skip DB/disk/network on "definitely not there").
- Cardinality is huge and an exact set wouldn't fit in memory.

**Don't use one when:**
- You **can't tolerate false positives** (e.g. "is this exact password breached?" where a false "yes" is unacceptable without a follow-up check).
- You need **deletes, enumeration, or exact counts** — use a real set, a counting Bloom filter, or HyperLogLog (for approximate counts) respectively.
- The set is **small enough to fit in a normal hash set** — then just use the set; a Bloom filter adds complexity for no gain.

## Common interview follow-ups

- *"How do you avoid hitting the DB for keys that don't exist?"* → Bloom filter of existing keys in front; "definitely absent" short-circuits the lookup (cache penetration).
- *"How does Cassandra avoid checking every SSTable on a read?"* → per-SSTable Bloom filters skip the ones that can't contain the key.
- *"What's the false-positive vs memory trade-off?"* → ~10 bits/element ≈ 1%; tune `m` and `k` for your `n` and target `p`.
- *"Can you delete from it?"* → not from a standard one (would cause false negatives); use a counting Bloom filter or rebuild.
- *"What if you under-size it?"* → the array saturates and the false-positive rate climbs; size for real cardinality or use a scalable variant.

## Gotchas

- **Treating "probably present" as definite** — always do the real lookup to confirm a positive; the filter only saves work on negatives.
- **Deleting by clearing bits** — corrupts shared bits → false negatives, breaking the core guarantee.
- **Under-provisioning `n`** — the error rate silently degrades as it fills past the planned cardinality.
- **Using it where false positives are unsafe** — a false "yes" must always be cheap to disprove downstream.
- **Reaching for it on small sets** — a plain hash set is simpler and exact when memory isn't the constraint.
- **Forgetting it can't count or list** — use HyperLogLog for cardinality, a real structure for enumeration.

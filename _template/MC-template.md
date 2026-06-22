# [Problem Name] — Machine Coding

> **Difficulty:** [Easy / Medium / Hard]
> **Tags:** `[machine-coding]` `[data-structure]` `[concurrency?]` `[generics?]`
> **Language:** [Go / Python]
> **Time budget in interview:** ~[60–90] min
> **Companies that ask this:** [Atlassian, Razorpay, Flipkart, Uber, ...]

---

## 0. How to use this doc in an interview

Machine coding is graded on **working code**, **edge cases**, **clean abstractions**, and **tests**. Speed matters but correctness matters more.

Phases:
1. **Clarify (5 min):** API contract, complexity targets, thread safety, generics, persistence.
2. **Sketch (5 min):** Public API + the main data structure on the whiteboard.
3. **Implement (40 min):** Skeleton → fill in → run.
4. **Test (15 min):** Edge cases — empty, full, concurrent, error paths.
5. **Discuss (10 min):** Trade-offs, variants, complexity.

If you finish core in 30 min, **add features the interviewer didn't ask for** (TTL, observability, configurable eviction). Doing this signals senior judgment.

---

## 1. Problem Statement

[State the problem in two sentences. Then list explicit constraints: time complexity targets, memory bounds, thread safety, language features allowed.]

### Constraints
- Time: [O(1) for get/put / O(log n) for ... ]
- Memory: [Bounded to N entries / no constraint]
- Thread safety: [required / optional]
- Generics: [yes / typed]
- External libs: [stdlib only / specific lib allowed]

---

## 2. Clarifying Questions

- [ ] What types are the keys / values? Primitive, string, struct?
- [ ] Is the size fixed at construction or resizable?
- [ ] Eviction policy explicit, or do I pick? (LRU / LFU / FIFO / random)
- [ ] What happens on overflow — evict, error, or block?
- [ ] Thread-safe required?
- [ ] Need TTL / expiration?
- [ ] Need stats / observability (hit rate, eviction count)?
- [ ] Persistence required?
- [ ] Should I support iterators?

---

## 3. API Contract

```
type [Name][K, V] interface {
    Get(key K) (V, bool)              // O(?)
    Put(key K, value V)               // O(?)
    Delete(key K) bool                // O(?)
    Len() int                         // O(1)
    Clear()                           // O(n)
}
```

| Method | Pre-condition | Post-condition | Complexity |
|---|---|---|---|
| Get | — | returns value if present, no mutation* | O(?) |
| Put | — | inserts or updates; may evict | O(?) |
| Delete | — | removes key if present | O(?) |
| Len | — | current size | O(1) |
| Clear | — | empty | O(n) |

\* Get may mutate access order (LRU) — call this out.

---

## 4. Approach + Data Structure

### Why this data structure
[2-3 sentences explaining the data structure choice in terms of the API's complexity targets.]

### Visual
```
                   ┌─────────────────────────────────────┐
                   │              HashMap                │
                   │  key ──▶ pointer to node            │
                   └──────────────┬──────────────────────┘
                                  │
                                  ▼
   head ◀─────▶  [n1] ◀─────▶ [n2] ◀─────▶ [n3] ◀─────▶ tail
                                                         (most recent on one end,
                                                          LRU victim on the other)
```

### Invariants
1. [Invariant 1 — must always be true after any public method returns]
2. [Invariant 2]
3. [Invariant 3]

> Writing invariants down in the interview earns points. It also helps you debug when tests fail.

---

## 5. Full Working Code

```{language}
[Production-quality code:
- Generics where the language supports them
- Idiomatic naming
- Errors returned (Go) / raised (Python) — not silent
- Thread-safe variant included if relevant
- main() / __main__ demo
]
```

### How to run

```bash
# Go
go run .
go test ./...

# Python
python3 [file].py
python3 -m pytest [test_file].py
```

---

## 6. Walkthrough Trace

> Step through the public API call by call. Show the data-structure state after each line. Interviewers love this — it proves you actually know what your code does.

```
Cap = 3

> put("a", 1)
   map: {"a"→nA}
   list: head ⇄ nA(a:1) ⇄ tail

> put("b", 2)
   map: {"a"→nA, "b"→nB}
   list: head ⇄ nB(b:2) ⇄ nA(a:1) ⇄ tail

> get("a")  ─────▶ 1
   list: head ⇄ nA(a:1) ⇄ nB(b:2) ⇄ tail   (a moved to MRU)

> put("c", 3)
   map: {"a"→nA, "b"→nB, "c"→nC}
   list: head ⇄ nC(c:3) ⇄ nA(a:1) ⇄ nB(b:2) ⇄ tail

> put("d", 4)              # at capacity → evict LRU (b)
   map: {"a"→nA, "c"→nC, "d"→nD}
   list: head ⇄ nD(d:4) ⇄ nC(c:3) ⇄ nA(a:1) ⇄ tail
```

---

## 7. Complexity Analysis

| Operation | Time | Space | Notes |
|---|---|---|---|
| Get  | O(1) avg, O(n) worst (hash collision) | — | Worst is hashmap-quality dependent |
| Put  | O(1) avg | O(1) per insert | Amortized incl. resize |
| Delete | O(1) avg | — | |
| Len  | O(1) | — | Cached |
| Clear | O(n) | — | Drops all references |

**Total space:** O(N) where N = capacity, with constant-factor overhead from {map buckets, node pointers}.

**Concurrency overhead** (if thread-safe variant): one mutex acquisition per call, ~20–50 ns. Sharded variant divides contention by shard count.

---

## 8. Tests (Edge Cases)

### Must-cover
- Empty: `Get` on empty returns zero/None + false
- Single element: put + get + delete
- At-capacity: insert N, all retrievable
- Over-capacity: insert N+1, oldest evicted, others present in correct order
- Update existing key: doesn't change size, updates value, refreshes recency
- Delete missing key: no-op, returns false
- Get-then-put: recency moves correctly
- Clear: size 0, can re-insert

### Concurrency (if applicable)
- Race detector / TSan clean: 100 goroutines × 10000 ops, no panic, no data race
- Linearizability sanity: monotonic counter under concurrent put
- Stampede: 100 misses on same key — only one fill if singleflight is wired

### Negative
- Nil/empty key handling
- Capacity = 0 — should reject or be no-op (decide and document)
- Put with zero/None value — allowed?

```{language}
[Sample test code]
```

---

## 9. Cross-Questions ("Why X and not Y") — ≥ 10

### 9.1 Why doubly-linked list and not singly-linked?
[5–15 line answer. SLL forces O(n) to remove arbitrary node — kills the O(1) target. DLL nodes carry both pointers, deleting an arbitrary node is just rewiring two neighbors. The hashmap → node pointer plus DLL is the canonical pairing.]

### 9.2 Why hashmap + DLL and not just an ordered map / LinkedHashMap?
[Java's `LinkedHashMap` does this for you, but Go's stdlib map is unordered and Python's dict is insertion-ordered — neither gives O(1) move-to-front. So you build it explicitly. Also: building it explicitly lets you swap LRU for LFU/ARC without changing the public API.]

### 9.3 Why not a heap (priority queue)?
[Heap gives O(log n) per op vs O(1). It's the right answer for LFU-with-frequency-as-priority *only if* you need ordering by frequency dynamically; LRU has trivial recency ordering.]

### 9.4 Why not a tree (e.g. skip list / red-black)?
[Trees give O(log n) — strictly worse for the LRU access pattern. Trees win when you need range queries; you don't here.]

### 9.5 Why a sentinel (dummy head/tail) and not nullable head/tail?
[Sentinels remove the special case "is this the first/last node?" from every insert/delete. Code shrinks ~30%, branch density drops, fewer bugs. Cost: 2 extra nodes — negligible.]

### 9.6 Why mutex and not RWMutex?
[Get also mutates (move-to-front). RWMutex is wrong: every "read" actually writes recency, so concurrent reads must serialize anyway. RWMutex would add overhead with no concurrency win.]

### 9.7 Why not channel-based synchronization (Go) / queue-based (Python)?
[Channels/queues give a serial actor model — every op funnels through one goroutine/thread. That's clean but caps throughput at the actor's per-op latency. Mutex lets N callers operate concurrently except for the critical section.]

### 9.8 Why generics and not `interface{}` / `Any`?
[Generics keep type info at compile time — no boxing, no runtime cast, no allocator pressure for primitives. Big wins for caches that hold ints/structs.]

### 9.9 What about cache stampede on a miss?
[Out of scope for the data structure, but commonly asked. Solution: singleflight — coalesce concurrent fetches for the same key into one upstream call.]

### 9.10 How would you add TTL?
[Each node carries an `expiresAt`. Get checks expiry before returning; expired entries are deleted lazily. Optional background sweeper removes them eagerly. Trade-off: lazy is simpler but lets expired data sit in memory; eager adds a goroutine/thread.]

[Domain-specific cross-questions: 2–5 more.]

---

## 10. Variants

### LFU
[How: each node tracks access count; on eviction, kick lowest. Implementation: bucketed by frequency (`O(1)` LFU paper, Pugh 2010).]

### ARC (Adaptive Replacement Cache)
[Combines recency + frequency, self-tunes. Used by ZFS. Strictly better than LRU on most workloads but ~3× more code.]

### TinyLFU / W-TinyLFU
[Caffeine (Java) and Ristretto (Go) use this. Counts frequencies in a count-min sketch, admits only if predicted hot. Best in class for high-throughput caches.]

### TTL-only (no eviction count)
[Pure expiration; size unbounded between sweeps. Simpler, fits when memory is cheap and entries die quickly.]

### Sharded
[N independent caches keyed by `hash(key) % N`. Parallelism multiplier ~= N. Used by all serious in-memory caches at scale.]

---

## 11. Cheat-Sheet Recap

1. **Problem:** [one line]
2. **Data structure:** [hashmap + DLL, ...]
3. **Complexity:** [O(1) get/put]
4. **Thread safety:** [single mutex / sharded / lock-free]
5. **Hardest design call:** [decision]
6. **One variant worth mentioning:** [LFU / TinyLFU / ARC]
7. **Test surface:** [must-cover list]

---

## Appendix: Idiomatic notes

### Go
- Use `*list.List` from `container/list` only for prototyping — write your own DLL for interviews; it's expected and shows you can.
- Generics: type the key constraint as `comparable`, value as `any`.
- Mutex: embed `sync.Mutex`, don't expose. Always `Lock`/`defer Unlock`.

### Python
- `collections.OrderedDict` is the cheating answer (`move_to_end` does most of the work). Show you know it, then implement explicitly.
- Type hints: `LRUCache[K, V]` via `Generic[K, V]` and `TypeVar`.
- For thread safety: `threading.Lock` is fine; `RLock` only if you reenter (you shouldn't).

# 05 — Collections: Arrays, Slices, Maps

> **Prerequisites:** `04-functions.md`.
> **Time to read:** 30 minutes.

Go has three built-in collection types: **arrays**, **slices**, and **maps**. (Also strings — see `02-types-and-variables.md`.)

You'll use slices and maps constantly. Arrays — almost never directly.

---

## The 60-second plain-English version

Before the precise rules, here is the mental model in everyday language. If you only remember this section, you'll avoid 90% of beginner bugs.

- **Array** = a row of fixed boxes, like an egg carton with exactly 12 slots. The size is baked into its type forever. Copying it copies all the eggs.
- **Slice** = a *window* onto some boxes that already exist somewhere in memory. The window is cheap — it's just three numbers: where it starts, how many boxes it currently shows (`len`), and how many boxes it *could* show before running out of room (`cap`). Two windows can look at the same boxes, so changing what you see through one window can change what the other sees.
- **Map** = a coat-check counter. You hand it a key (a ticket number), it hands you back a value (your coat). Order is not preserved — the attendant grabs coats from wherever they happen to be hung.

The precise version: an array is a contiguous, fixed-length, value-typed block of elements. A slice is a small struct `{pointer, len, cap}` that points *into* a backing array. A map is a reference to a hash table managed by the runtime. We'll unpack each below, but keep the carton / window / coat-check pictures in your head.

**One-line takeaway:** arrays own their data, slices borrow a view of data, maps look data up by key.

---

## Arrays — fixed-size

```go
var nums [5]int               // array of 5 ints, all zeros
nums[0] = 10
nums[1] = 20

// Or initialize directly
days := [7]string{"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"}

fmt.Println(len(days))       // 7
fmt.Println(days[0])         // Mon
```

### Arrays have value semantics

```go
a := [3]int{1, 2, 3}
b := a              // COPY, not reference
b[0] = 99
fmt.Println(a[0])   // 1 (a unaffected)
```

This is a key difference from slices. Don't pass arrays to functions — they get copied.

### The size is part of the type

This trips people up: `[3]int` and `[4]int` are **different, incompatible types**. You cannot assign one to the other, and a function that wants a `[3]int` will not accept a `[4]int`.

```go
package main

import "fmt"

func sum3(a [3]int) int { return a[0] + a[1] + a[2] }

func main() {
	x := [3]int{1, 2, 3}
	fmt.Println(sum3(x)) // 6

	// y := [4]int{1, 2, 3, 4}
	// sum3(y) // compile error: cannot use y (type [4]int) as type [3]int
	_ = x
}
```

Expected output:

```
6
```

**Takeaway:** because the length is baked into the type, arrays are rigid — that rigidity is exactly why we reach for slices instead.

### Let the compiler count for you with `[...]`

If you write out the elements, you can ask the compiler to size the array with `[...]`:

```go
package main

import "fmt"

func main() {
	primes := [...]int{2, 3, 5, 7, 11} // compiler infers length 5
	fmt.Println(len(primes), primes)
}
```

Expected output:

```
5 [2 3 5 7 11]
```

Note this is still a **fixed-size array**, not a slice — the `...` only means "you count the elements for me", not "grow as needed".

**Takeaway:** `[...]T{...}` is a convenience for fixed arrays; it does not make them dynamic.

### Comparing arrays

Because arrays are values, two arrays of the same type are comparable with `==` if their element type is comparable. This is unlike slices, which are *not* comparable.

```go
package main

import "fmt"

func main() {
	a := [3]int{1, 2, 3}
	b := [3]int{1, 2, 3}
	c := [3]int{1, 2, 9}
	fmt.Println(a == b) // true  — same length, same elements
	fmt.Println(a == c) // false — last element differs
}
```

Expected output:

```
true
false
```

**Takeaway:** arrays support `==`; this is one reason arrays (not slices) can be used as map keys.

### When to use arrays

- Fixed, known size.
- Performance-critical (no heap allocation).
- As **map keys** or struct fields where value semantics and comparability matter (e.g. a `[16]byte` MD5 hash, a `[4]byte` IPv4 address).
- 99% of the time: just use a slice.

---

## Slices — dynamic, flexible

```go
nums := []int{1, 2, 3}    // slice (no size in brackets)

nums = append(nums, 4)
nums = append(nums, 5, 6)
fmt.Println(nums)         // [1 2 3 4 5 6]
fmt.Println(len(nums))    // 6
```

### What a slice actually *is* (the three-field header)

A slice value is a tiny struct the runtime calls a *slice header*. It holds three things:

```
slice header:
  ptr  ──► points at element 0 inside a backing array
  len  ──► how many elements you can index (0..len-1)
  cap  ──► how many elements exist from ptr to the end of the backing array
```

That's why a slice is cheap to pass around (24 bytes on a 64-bit machine — a pointer plus two ints) yet can describe a huge amount of data. It does **not** copy the elements; it copies the header, and both headers point at the same elements.

```go
package main

import "fmt"

func main() {
	backing := [5]int{10, 20, 30, 40, 50}
	s := backing[1:3] // ptr->&backing[1], len=2, cap=4 (index 1..4)
	fmt.Println(s, "len:", len(s), "cap:", cap(s))
}
```

Expected output:

```
[20 30] len: 2 cap: 4
```

`cap` is 4 because from index 1 there are four elements left in `backing` (indices 1,2,3,4).

**Takeaway:** a slice is a view (ptr, len, cap) over a backing array — copying the slice does not copy the data.

### Slice operations

```go
s := []int{10, 20, 30, 40, 50}

s[0]            // 10
s[len(s)-1]     // 50
s[1:4]          // [20 30 40]   (includes 1, excludes 4)
s[:3]           // [10 20 30]
s[2:]           // [30 40 50]
s[:]            // entire slice
```

### The three-index slice — controlling `cap`

There is a third form, `s[low:high:max]`, that lets you cap the new slice's capacity at `max - low`. This is the surgical tool for preventing the "append stomps shared data" bug shown later.

```go
package main

import "fmt"

func main() {
	s := []int{1, 2, 3, 4, 5}
	sub := s[1:3:3] // len = 3-1 = 2, cap = 3-1 = 2
	fmt.Println(sub, "len:", len(sub), "cap:", cap(sub))

	sub = append(sub, 999) // cap is full, so append ALLOCATES a new array
	fmt.Println("sub:", sub)
	fmt.Println("s:  ", s) // s is untouched — sub no longer shares backing
}
```

Expected output:

```
[2 3] len: 2 cap: 2
sub: [2 3 999]
s:   [1 2 3 4 5]
```

**Takeaway:** `s[low:high:max]` clamps capacity so a later `append` is forced to copy instead of overwriting the original.

### Slicing creates a "view"

A slice references an underlying array. Slicing a slice **shares the same underlying array**:

```go
s := []int{1, 2, 3, 4, 5}
sub := s[1:4]
sub[0] = 999
fmt.Println(s)    // [1 999 3 4 5]
```

This can surprise you. To get an independent copy:

```go
s := []int{1, 2, 3, 4, 5}
cp := make([]int, len(s[1:4]))
copy(cp, s[1:4])
```

Or:
```go
cp := append([]int(nil), s[1:4]...)    // common idiom
```

Since Go 1.21 there is also a clear, dedicated function in the standard library:

```go
import "slices"

cp := slices.Clone(s[1:4]) // returns a fresh slice with copied elements
```

**Takeaway:** to break the shared-backing link, copy explicitly (`copy`, `append(nil, ...)`, or `slices.Clone`).

### `append` and capacity

A slice has `len` (number of elements) and `cap` (size of underlying array).

```go
s := make([]int, 3, 10)   // len=3, cap=10
fmt.Println(len(s), cap(s))    // 3 10
s = append(s, 4, 5)            // doesn't reallocate (cap was 10)

t := []int{}
for i := 0; i < 100; i++ {
    t = append(t, i)
}
// t reallocates several times as it grows. Common; not a perf issue for most uses.
```

If you know the size, pre-allocate:

```go
result := make([]int, 0, 1000)    // empty, but reserved capacity
```

This avoids reallocations in tight loops.

#### Watching capacity grow

`append` does not grow the backing array by one each time — that would be O(n²) over n appends. Instead, when capacity is exceeded it allocates a **bigger** array (historically roughly doubling for small slices, then growing ~1.25x for large ones) and copies the old elements over. The exact factor is an implementation detail and has changed across Go versions; never rely on a specific number.

```go
package main

import "fmt"

func main() {
	var s []int
	prev := cap(s)
	for i := 0; i < 10; i++ {
		s = append(s, i)
		if cap(s) != prev {
			fmt.Printf("len=%-2d cap grew to %d\n", len(s), cap(s))
			prev = cap(s)
		}
	}
}
```

Expected output (capacities are version-dependent; the *pattern* of growth is the point):

```
len=1  cap grew to 1
len=2  cap grew to 2
len=3  cap grew to 4
len=5  cap grew to 8
len=9  cap grew to 16
```

Because each reallocation copies all current elements, the **amortized** cost of one `append` is O(1), even though an individual `append` that triggers a reallocation is O(n).

**Takeaway:** `append` grows capacity geometrically and copies on reallocation — appends are amortized O(1), and pre-sizing with `make([]T, 0, n)` skips the copies entirely.

#### `append` returns a (maybe new) slice — always assign the result

This is the single most common slice bug. `append` may return a header pointing at a brand-new backing array. If you ignore the return value, you lose the appended data (or worse, keep a stale header).

```go
package main

import "fmt"

func main() {
	s := []int{1, 2, 3}
	append(s, 4) // WRONG in spirit — compiler actually errors: result of append not used
	fmt.Println(s)
}
```

```go
s = append(s, 4) // RIGHT — reassign
```

**Takeaway:** the idiom is always `s = append(s, ...)`; treating `append` as if it mutates in place is a bug.

### Initializing slices

```go
// Empty slice (len 0, cap 0)
var s []int
s := []int{}

// Length n, all zero values
s := make([]int, 5)             // [0 0 0 0 0]

// Length n with capacity c
s := make([]int, 5, 100)

// With values
s := []int{1, 2, 3, 4, 5}
```

#### `nil` slice vs empty slice — what's the difference?

Both have `len 0`. The difference is the pointer: a `nil` slice has `ptr == nil` and `cap == 0`; an empty literal `[]int{}` has a non-nil pointer to a zero-length array.

```go
package main

import (
	"encoding/json"
	"fmt"
)

func main() {
	var a []int      // nil slice
	b := []int{}     // empty, non-nil slice

	fmt.Println(a == nil, len(a)) // true 0
	fmt.Println(b == nil, len(b)) // false 0

	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	fmt.Println(string(ja)) // null
	fmt.Println(string(jb)) // []
}
```

Expected output:

```
true 0
false 0
null
[]
```

For most code you should **prefer the `nil` slice** (`var s []int`) — it's the idiomatic zero value, you can `append` to it freely, and `len`/`range` work fine. Only reach for `[]int{}` when an API contract (often JSON) specifically needs `[]` instead of `null`.

**Takeaway:** prefer `var s []int`; the nil-vs-empty distinction only matters at serialization boundaries.

### Iterating

```go
fruits := []string{"apple", "banana", "cherry"}

for i, f := range fruits {
    fmt.Println(i, f)
}

// Just values
for _, f := range fruits {
    fmt.Println(f)
}

// Just indexes
for i := range fruits {
    fmt.Println(i)
}
```

#### `range` copies each element

In `for i, v := range s`, `v` is a **copy** of `s[i]`. Mutating `v` does nothing to the slice. To mutate in place, index through `s[i]`.

```go
package main

import "fmt"

func main() {
	nums := []int{1, 2, 3}

	for _, v := range nums {
		v *= 10 // modifies the copy only
	}
	fmt.Println(nums) // [1 2 3] — unchanged

	for i := range nums {
		nums[i] *= 10 // modifies the slice
	}
	fmt.Println(nums) // [10 20 30]
}
```

Expected output:

```
[1 2 3]
[10 20 30]
```

This matters a lot for slices of structs: `for _, p := range people { p.Age++ }` increments a throwaway copy. Use `people[i].Age++`.

**Takeaway:** the `range` value variable is a copy — index by `s[i]` when you need to mutate.

### Common operations

```go
s := []int{3, 1, 4, 1, 5, 9, 2, 6}

// Sort in place
import "sort"
sort.Ints(s)
fmt.Println(s)    // [1 1 2 3 4 5 6 9]

// Custom sort
sort.Slice(s, func(i, j int) bool { return s[i] > s[j] })  // descending

// Sort strings
words := []string{"banana", "apple", "cherry"}
sort.Strings(words)

// Search
idx := sort.SearchInts(s, 4)    // returns index where 4 should go (binary search; s must be sorted)

// Reverse
for i, j := 0, len(s)-1; i < j; i, j = i+1, j-1 {
    s[i], s[j] = s[j], s[i]
}

// Removing element at index i
s = append(s[:i], s[i+1:]...)

// Insert at index i
s = append(s[:i], append([]int{newVal}, s[i:]...)...)
```

There's no built-in `Remove` — these patterns are common.

#### The modern `slices` package (Go 1.21+)

Since Go 1.21 the standard library ships a generic `slices` package that replaces many hand-rolled patterns above with clear, type-safe helpers. Prefer these in new code.

```go
package main

import (
	"fmt"
	"slices"
)

func main() {
	s := []int{3, 1, 4, 1, 5, 9, 2, 6}

	slices.Sort(s)                   // generic sort, ascending
	fmt.Println(s)                   // [1 1 2 3 4 5 6 9]

	fmt.Println(slices.Contains(s, 4)) // true
	i, found := slices.BinarySearch(s, 5)
	fmt.Println(i, found)              // 5 true (s must be sorted)

	slices.Reverse(s)
	fmt.Println(s)                     // [9 6 5 4 3 2 1 1]

	fmt.Println(slices.Max(s), slices.Min(s)) // 9 1

	// Sort descending with a comparison function
	slices.SortFunc(s, func(a, b int) int { return b - a })
	fmt.Println(s)                     // [9 6 5 4 3 2 1 1]
}
```

Expected output:

```
[1 1 2 3 4 5 6 9]
true
5 true
[9 6 5 4 3 2 1 1]
9 1
[9 6 5 4 3 2 1 1]
```

`slices.SortFunc` takes a comparator returning a negative / zero / positive int (like `strings.Compare` or `cmp.Compare`), **not** a `less` bool like `sort.Slice`. Mixing those up is a common mistake.

**Takeaway:** in Go 1.21+ reach for `slices.Sort`, `slices.Contains`, `slices.Index`, `slices.Clone`, etc. before writing manual loops.

#### Deleting safely with `slices.Delete`

```go
package main

import (
	"fmt"
	"slices"
)

func main() {
	s := []string{"a", "b", "c", "d"}
	s = slices.Delete(s, 1, 3) // remove indices [1,3): "b" and "c"
	fmt.Println(s)             // [a d]
}
```

Expected output:

```
[a d]
```

`slices.Delete` zeroes the freed tail to avoid leaking references — something the bare `append(s[:i], s[i+1:]...)` trick does not do.

**Takeaway:** `slices.Delete` is clearer and avoids the reference-leak footgun of the manual append trick.

### Slices of slices (2D)

```go
grid := [][]int{
    {1, 2, 3},
    {4, 5, 6},
    {7, 8, 9},
}

fmt.Println(grid[1][2])    // 6

// Initialize NxM with all zeros
n, m := 3, 4
grid := make([][]int, n)
for i := range grid {
    grid[i] = make([]int, m)
}
```

#### Why two-step allocation, and the shared-row trap

A common beginner attempt is to reuse one inner slice for every row. Because slices share backing arrays, every row ends up pointing at the *same* data:

```go
package main

import "fmt"

func main() {
	row := make([]int, 3)
	grid := make([][]int, 2)
	grid[0] = row
	grid[1] = row // BUG: both rows are the same backing array

	grid[0][0] = 99
	fmt.Println(grid) // [[99 0 0] [99 0 0]] — wrote to "both" rows
}
```

Expected output:

```
[[99 0 0] [99 0 0]]
```

The fix is to allocate a fresh inner slice per row (the loop in the snippet above does exactly this).

For a *truly* contiguous matrix (better cache behavior, single allocation), allocate one flat backing slice and re-slice it per row:

```go
package main

import "fmt"

func main() {
	n, m := 2, 3
	flat := make([]int, n*m)
	grid := make([][]int, n)
	for i := range grid {
		grid[i] = flat[i*m : (i+1)*m : (i+1)*m]
	}
	grid[0][0] = 1
	grid[1][2] = 9
	fmt.Println(grid) // [[1 0 0] [0 0 9]]
}
```

Expected output:

```
[[1 0 0] [0 0 9]]
```

**Takeaway:** give each row its own backing array (loop of `make`), or deliberately share one flat slice for a contiguous matrix — never accidentally alias one row.

---

## Maps — key/value store

```go
person := map[string]int{
    "Alice": 30,
    "Bob": 25,
    "Carol": 35,
}

fmt.Println(person["Alice"])    // 30

person["Dave"] = 40              // add new
person["Alice"] = 31             // update
```

### Lookup with the comma-ok idiom

```go
age, ok := person["Eve"]
if !ok {
    fmt.Println("Eve not found")
} else {
    fmt.Println("Eve:", age)
}
```

`person["Eve"]` returns zero value (0 for int) if missing — distinguish "missing" from "value is 0" with the second return value.

This distinction is *not* academic. Imagine a scoreboard where a real score of `0` is meaningful:

```go
package main

import "fmt"

func main() {
	scores := map[string]int{"Alice": 0} // Alice played and scored zero
	fmt.Println(scores["Alice"])          // 0
	fmt.Println(scores["Bob"])            // 0 — but Bob never played!

	if v, ok := scores["Bob"]; ok {
		fmt.Println("Bob scored", v)
	} else {
		fmt.Println("Bob has no score recorded")
	}
}
```

Expected output:

```
0
0
Bob has no score recorded
```

**Takeaway:** use `v, ok := m[k]` whenever a present-but-zero value must be told apart from an absent key.

### Deleting

```go
delete(person, "Bob")
```

`delete` is a built-in. (Not `person.delete(...)` — Go has fewer methods on built-ins.)

`delete` is safe to call even when the key is absent — it's a no-op, never a panic:

```go
package main

import "fmt"

func main() {
	m := map[string]int{"a": 1}
	delete(m, "zzz") // key not present — perfectly fine
	delete(m, "a")
	fmt.Println(len(m)) // 0
}
```

Expected output:

```
0
```

**Takeaway:** `delete(m, k)` on a missing key does nothing — no need to check first.

### Iterating

```go
for name, age := range person {
    fmt.Println(name, age)
}
```

**Iteration order is random.** Don't rely on it.

This randomness is *deliberate* — the Go runtime starts map iteration at a random bucket so that code never accidentally depends on a fixed order. When you need a stable order, sort the keys:

```go
package main

import (
	"fmt"
	"sort"
)

func main() {
	person := map[string]int{"Carol": 35, "Alice": 30, "Bob": 25}

	keys := make([]string, 0, len(person))
	for k := range person {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	for _, k := range keys {
		fmt.Printf("%s=%d\n", k, person[k])
	}
}
```

Expected output (now deterministic):

```
Alice=30
Bob=25
Carol=35
```

**Takeaway:** map order is intentionally randomized; collect keys into a slice and sort them when you need reproducible output.

### Modifying a map during iteration

Unlike slices, it is **safe to `delete` from a map while ranging over it**. Adding keys during iteration is allowed by the spec but the new keys may or may not be visited — so don't.

```go
package main

import "fmt"

func main() {
	m := map[int]int{1: 1, 2: 2, 3: 3, 4: 4}
	for k := range m {
		if k%2 == 0 {
			delete(m, k) // safe
		}
	}
	fmt.Println(len(m), m[1], m[3]) // 2 1 3
}
```

Expected output:

```
2 1 3
```

**Takeaway:** deleting current keys mid-range is fine for maps (not for slices); adding keys mid-range is undefined-visit territory — avoid it.

### Initializing

```go
// Empty map (zero-value is nil; can't assign to nil map!)
var m map[string]int
m["x"] = 1    // PANIC: assignment to entry in nil map

// Use make
m := make(map[string]int)
m["x"] = 1    // OK

// Or literal
m := map[string]int{}    // empty
m := map[string]int{"a": 1, "b": 2}
```

#### Reading a nil map is fine — only writing panics

A subtle but important asymmetry: a `nil` map behaves like an empty map for **reads**. You can range it, take its `len`, and look keys up. Only **writing** to a nil map panics.

```go
package main

import "fmt"

func main() {
	var m map[string]int // nil map
	fmt.Println(len(m))  // 0
	fmt.Println(m["x"])  // 0 — read is OK
	v, ok := m["x"]
	fmt.Println(v, ok)   // 0 false
	for range m {        // ranges zero times — OK
	}
	// m["x"] = 1        // would PANIC: assignment to entry in nil map
}
```

Expected output:

```
0
0
0 false
```

This is why functions that *return* maps can safely return `nil` (callers can read it), but functions that *fill in* a map must `make` it first.

**Takeaway:** nil maps read like empty maps; you must `make` (or use a literal) before the first write.

### Map keys

Any type that supports `==` comparison can be a key:
- Strings, numbers, booleans, pointers, channels.
- Structs (if all fields comparable).
- Arrays (if element type comparable).

NOT keys:
- Slices, maps, functions (not comparable).

For struct keys:
```go
type Point struct{ X, Y int }
m := map[Point]string{}
m[Point{1, 2}] = "origin-ish"
```

#### Why slices can't be keys (and the workaround)

Map keys must be comparable with `==`, and slices/maps/functions are *not* comparable (the language forbids `==` on them because equality would be ambiguous: by identity? by contents? by length?). A struct that *contains* a slice is therefore also un-keyable.

```go
package main

func main() {
	// m := map[[]int]string{} // compile error: invalid map key type []int
	_ = 0
}
```

When you genuinely need a slice-shaped key, convert it to a comparable form first — most commonly a `string` (which *is* comparable) or a fixed array:

```go
package main

import (
	"fmt"
	"strings"
)

func main() {
	// Use the string join of a slice as a stand-in key.
	seen := map[string]bool{}
	key := func(xs []int) string {
		parts := make([]string, len(xs))
		for i, x := range xs {
			parts[i] = fmt.Sprint(x)
		}
		return strings.Join(parts, ",")
	}

	seen[key([]int{1, 2, 3})] = true
	fmt.Println(seen[key([]int{1, 2, 3})]) // true
	fmt.Println(seen[key([]int{1, 2})])    // false
}
```

Expected output:

```
true
false
```

**Takeaway:** keys must be `==`-comparable; encode slice-like keys as strings or arrays.

### Maps are reference types

```go
m := map[string]int{"a": 1}

func modify(m map[string]int) {
    m["a"] = 999
}
modify(m)
fmt.Println(m["a"])    // 999
```

Like slices, maps share underlying state. Be aware when passing.

#### You cannot take the address of a map element

Because the runtime may move map entries around when it grows the table, Go forbids `&m[key]`. This bites people storing structs in maps:

```go
package main

type Counter struct{ N int }

func main() {
	m := map[string]Counter{"a": {}}
	// m["a"].N++ // compile error: cannot assign to struct field m["a"].N in map
	// &m["a"]    // compile error: cannot take the address of m["a"]

	// Fix 1: read, modify, write back
	c := m["a"]
	c.N++
	m["a"] = c

	// Fix 2 (often cleaner): store POINTERS
	mp := map[string]*Counter{"a": {}}
	mp["a"].N++ // OK — we mutate through the pointer, not the map slot
	_ = mp
}
```

**Takeaway:** map values aren't addressable; mutate a struct value by read-modify-write, or store `*Struct` and mutate through the pointer.

---

## Strings vs slices vs maps — when to use what

```
Need ordered, growable list?            → slice
Need fast lookup by key?                → map
Need fixed-size with value semantics?   → array (rare)
Need text?                              → string
```

### Cost cheat-sheet (rough Big-O)

| Operation                         | Slice                         | Map                  |
|-----------------------------------|-------------------------------|----------------------|
| Index / lookup by position        | O(1)                          | n/a                  |
| Lookup by key                     | O(n) (linear scan)            | O(1) average         |
| Append / insert at end            | O(1) amortized                | O(1) average (set)   |
| Insert / delete in the middle     | O(n) (shift elements)         | O(1) average         |
| Membership test                   | O(n) (or O(log n) if sorted)  | O(1) average         |
| Ordered iteration                 | O(n), order preserved         | O(n), order *random* |

If you find yourself scanning a slice repeatedly to ask "is X in here?", that's the signal to switch to a map (or a `map[T]struct{}` set).

**Takeaway:** pick the structure by access pattern — position → slice, key → map; don't linear-scan a slice for membership when a map is O(1).

---

## Real-world patterns

### Counting frequencies

```go
text := "the cat sat on the mat the cat is here"
counts := map[string]int{}
for _, word := range strings.Fields(text) {
    counts[word]++
}
fmt.Println(counts)
// map[cat:2 here:1 is:1 mat:1 on:1 sat:1 the:3]
```

Why `counts[word]++` works on a missing key: reading an absent key yields the zero value `0`, so the first `++` turns it into `1`. No initialization needed. This zero-value-on-read behavior is what makes Go map code so terse.

**Takeaway:** `m[k]++` and `m[k] = append(m[k], v)` lean on zero values, so you never pre-initialize entries.

### Removing duplicates

```go
input := []int{1, 2, 2, 3, 4, 4, 5}
seen := map[int]bool{}
result := []int{}
for _, n := range input {
    if !seen[n] {
        seen[n] = true
        result = append(result, n)
    }
}
fmt.Println(result)    // [1 2 3 4 5]
```

### Set (using map[T]struct{})

Go has no built-in set. Use `map[T]struct{}`:

```go
set := map[string]struct{}{}
set["apple"] = struct{}{}
set["banana"] = struct{}{}

// Check membership
if _, ok := set["apple"]; ok {
    fmt.Println("found")
}

// Remove
delete(set, "banana")
```

`struct{}` takes 0 bytes. Use this when you don't need a value.

#### `map[T]struct{}` vs `map[T]bool`

Both work as sets. `map[T]bool` is slightly more ergonomic — membership is just `set[x]` (returns `false` for absent keys) instead of the comma-ok dance — at the cost of one byte per entry. `map[T]struct{}` makes "this is a set, the value carries no information" explicit and uses zero bytes for the value.

```go
package main

import "fmt"

func main() {
	// bool set: terse membership test
	b := map[string]bool{"x": true}
	fmt.Println(b["x"], b["y"]) // true false

	// struct{} set: zero-byte values, explicit intent
	s := map[string]struct{}{"x": {}}
	_, ok := s["x"]
	fmt.Println(ok) // true
}
```

Expected output:

```
true false
true
```

For most application code, `map[T]bool` is the pragmatic choice; reach for `map[T]struct{}` in hot paths or very large sets where the per-entry byte and the explicit intent matter.

**Takeaway:** `map[T]bool` reads cleaner; `map[T]struct{}` signals "value-less set" and saves a byte per entry.

### Group items

```go
type Person struct{ Name, City string }
people := []Person{
    {"Alice", "NY"},
    {"Bob", "SF"},
    {"Carol", "NY"},
}

byCity := map[string][]string{}
for _, p := range people {
    byCity[p.City] = append(byCity[p.City], p.Name)
}
fmt.Println(byCity)
// map[NY:[Alice Carol] SF:[Bob]]
```

The append-to-a-map-of-slices idiom is worth burning into memory: `byCity[p.City]` returns a `nil` slice the first time a city is seen, and `append` happily grows a `nil` slice into a real one. You then store the (new) slice header back into the map.

**Takeaway:** `m[k] = append(m[k], v)` is the canonical "group by" — it relies on append working on the nil zero-value slice.

---

## Common mistakes

**1. Nil slice vs empty slice — usually fine.**
```go
var s []int        // nil
fmt.Println(len(s))    // 0 — works
s = append(s, 1)       // works — appending to nil slice creates new
```

Both nil and empty slices work for most operations. JSON-marshal differs (`null` vs `[]`).

**2. Modifying slice during range.**
```go
for i := range s {
    if condition {
        s = append(s[:i], s[i+1:]...)    // BUG
    }
}
```

Build a new slice instead. Concretely, the **filter-in-place** idiom is the standard fix when you want to drop elements without allocating a second slice — it writes survivors back to the front and reslices once at the end:

```go
package main

import "fmt"

func main() {
	s := []int{1, 2, 3, 4, 5, 6}
	// keep only even numbers
	out := s[:0] // reuse the same backing array, len 0
	for _, v := range s {
		if v%2 == 0 {
			out = append(out, v)
		}
	}
	s = out
	fmt.Println(s) // [2 4 6]
}
```

Expected output:

```
[2 4 6]
```

`s[:0]` gives a zero-length slice that shares `s`'s backing array, so appending survivors overwrites the front in place — O(n) and zero extra allocation. Ranging over the *original* `s` while writing into `out` is safe because `range` captured the original length up front.

**Takeaway:** to delete while iterating, build a result (or use the `s[:0]` filter-in-place trick), never `append`-delete inside a `range` over the same slice.

**3. Nil map assignment.**
```go
var m map[string]int
m["x"] = 1    // PANIC

m := make(map[string]int)
m["x"] = 1    // OK
```

**4. Confusing array and slice.**

Arrays have fixed size in their type: `[5]int`. Slices don't: `[]int`. Almost always use slices.

**5. Slice gotcha: shared backing array.**
```go
s := []int{1, 2, 3, 4, 5}
sub := s[1:3]
sub = append(sub, 999)
// sub is [2 3 999], but it might have OVERWRITTEN s[3]!
fmt.Println(s)    // [1 2 3 999 5]
```

When in doubt, copy explicitly. Or use the three-index slice `s[1:3:3]` to cap capacity, forcing `append` to allocate (see the three-index section above).

**6. Forgetting to reassign `append`'s result.**
```go
s := []int{1, 2, 3}
s = append(s, 4)   // RIGHT
// append(s, 4)    // WRONG — append doesn't mutate s in place; the new header is lost
```

**7. Trying to mutate a struct stored by value in a map.**
```go
m := map[string]Counter{"a": {}}
// m["a"].N++   // compile error: map value is not addressable
c := m["a"]; c.N++; m["a"] = c   // fix: read-modify-write
```

**8. Capturing the loop variable's address in older Go.**

In Go **before 1.22**, the `range` loop variable was reused across iterations, so taking its address (or capturing it in a goroutine/closure) gave every iteration the *same* variable — usually ending on the last element.

```go
package main

import "fmt"

func main() {
	nums := []int{10, 20, 30}
	var ptrs []*int
	for _, v := range nums {
		v := v // pre-1.22 fix: shadow with a fresh variable each iteration
		ptrs = append(ptrs, &v)
	}
	for _, p := range ptrs {
		fmt.Print(*p, " ")
	}
	fmt.Println()
}
```

Expected output:

```
10 20 30
```

Go **1.22+** changed the spec so each iteration gets a fresh variable — the `v := v` shadow is then unnecessary (but harmless). If you target older toolchains or read older code, know the trap.

**Takeaway:** pre-1.22, shadow the loop variable (`v := v`) before taking its address or capturing it in a closure; 1.22+ does this for you.

**9. Comparing slices with `==`.**
```go
a := []int{1, 2}
b := []int{1, 2}
// a == b      // compile error: slice can only be compared to nil
fmt.Println(slices.Equal(a, b)) // true — use slices.Equal (Go 1.21+) or reflect.DeepEqual
```

**Takeaway:** `==` on slices is illegal (only `s == nil` is allowed); use `slices.Equal` for element-wise comparison.

---

## Cross-questions reviewers and interviewers ask

**Q: Why does Go have both arrays and slices? Isn't one enough?**
Arrays give value semantics and a length fixed at compile time, which the compiler can use for stack allocation and bounds reasoning. Slices give a flexible, growable view layered *on top of* arrays. In practice slices are the everyday tool; arrays exist as the underlying primitive and for the rare cases where fixed size and value copying are exactly what you want (hashes, IP addresses, map keys).

**Q: A slice is "passed by value" but the function mutates my data — how?**
The slice *header* (ptr, len, cap) is copied by value, but the copy's `ptr` still points at the same backing array. So element writes through either copy are visible to both. However, an `append` inside the function that reallocates affects only the local copy's header — the caller won't see the new length unless you return the slice. This is why `append` results must be returned/reassigned.

**Q: Why is `append`'s result returned instead of `append` mutating in place?**
Because `append` may need to allocate a new, larger backing array and copy elements over. When it does, the new slice has a different `ptr` and `cap`. A function can't update the caller's header for it, so the new header is the return value. The `s = append(s, ...)` idiom makes this explicit.

**Q: Why is map iteration order randomized rather than just unspecified?**
"Unspecified but stable in practice" is a trap — people would unknowingly depend on it, then break when the runtime changed. Go actively randomizes the start bucket so the dependency can never form. The cost is you must sort keys yourself when you need order; the benefit is no fragile hidden coupling.

**Q: Why can't slices be map keys but arrays can?**
Map keys must be comparable with `==`. Arrays of comparable elements are comparable (fixed size, value semantics, well-defined element-wise equality). Slices are not comparable — their identity vs. contents vs. length equality would be ambiguous and their contents can change — so they're disallowed as keys.

**Q: When would you choose a map over a sorted slice + binary search?**
Map: O(1) average lookups, O(1) inserts/deletes, no ordering needed. Sorted slice + `sort.Search`: O(log n) lookups but contiguous memory (cache-friendly), supports range/nearest queries, and predictable iteration order. For pure membership/lookup with frequent mutation, use a map. For mostly-read data where ordering or range scans matter, a sorted slice can win.

**Q: Is `make([]int, 0, n)` premature optimization?**
No, when `n` is known. It's a single allocation instead of log-many reallocations-and-copies, with no downside in readability. It *is* premature if you're guessing `n` or the slice stays tiny. Measure when unsure, but pre-sizing a result slice whose final length you already know is just good hygiene.

**Q: Why does a small `map[T]struct{}` use less memory than `map[T]bool` — isn't `bool` already one byte?**
A `bool` value occupies one byte per entry; `struct{}` occupies zero bytes (all empty structs share a single address). For a million-element set that's ~1 MB saved and a clearer signal that the value is meaningless. For small maps the difference is negligible and `map[T]bool` reads more cleanly.

---

## Exercises

1. **Reverse a slice in place**: write `reverse([]int)`.
2. **Find unique characters**: given a string, return slice of unique chars in order of first appearance.
3. **Two-sum**: given `[]int` and target, return indexes of two numbers summing to target. Use map for O(n).
4. **Group anagrams**: from `[]string`, group anagrams. Return `[][]string`.
5. **Common items**: given two slices, return slice of items in both (intersection). Use a set.
6. **Word count**: given `string`, return `map[string]int` of word counts.
7. **Filter in place**: write `keepIf([]int, func(int) bool) []int` using the `s[:0]` trick — no second allocation.
8. **Stable map print**: given `map[string]int`, print entries sorted by key, then by value descending.
9. **Detect aliasing**: write a function that takes `s []int`, appends to it, and demonstrate (with output) one case where the caller's data changes and one where it doesn't. Explain why using `cap`.

### Hint for #3 (two-sum):

```go
func twoSum(nums []int, target int) []int {
    seen := map[int]int{}    // value -> index
    for i, n := range nums {
        if j, ok := seen[target-n]; ok {
            return []int{j, i}
        }
        seen[n] = i
    }
    return nil
}
```

### Hint for #4 (group anagrams):

Sort each word's letters to form a canonical key, then group:

```go
package main

import (
	"fmt"
	"sort"
	"strings"
)

func groupAnagrams(words []string) [][]string {
	groups := map[string][]string{}
	for _, w := range words {
		letters := strings.Split(w, "")
		sort.Strings(letters)
		key := strings.Join(letters, "")
		groups[key] = append(groups[key], w)
	}
	out := make([][]string, 0, len(groups))
	for _, g := range groups {
		out = append(out, g)
	}
	return out
}

func main() {
	fmt.Println(groupAnagrams([]string{"eat", "tea", "tan", "ate", "nat", "bat"}))
	// e.g. [[eat tea ate] [tan nat] [bat]] (group order is random)
}
```

The canonical-key trick (`"aet"` for both `"eat"` and `"tea"`) turns "are these anagrams?" into a plain map lookup. Group *order* is random because map iteration is — sort `out` if you need determinism.

---

## What to read next

- **Doc 06 — Structs and methods** (next): building your own types, value vs pointer receivers — directly relevant to the "struct in a map isn't addressable" gotcha above.
- **`02-types-and-variables.md`**: strings, runes, and bytes — strings are immutable byte slices, which explains why `[]byte(s)` copies.
- **Go standard library `slices` and `maps` packages** (`pkg.go.dev/slices`, `pkg.go.dev/maps`): the modern generic helpers (`slices.Sort`, `slices.Clone`, `maps.Keys`, `maps.Clone`) that replace most hand-written loops in Go 1.21+.
- **"Go Slices: usage and internals"** on the official Go blog: the canonical deep-dive on the slice header, capacity growth, and the shared-backing-array behavior.

---

## What's next

**Doc 06** — Structs and methods: building your own types.

```
→ Foundations/Programming/Go/06-structs-and-methods.md
```

# 12 — Generics and Iterators

> **Prerequisites:** `11-stdlib-tour.md`. Interfaces from doc 07.
> **Time to read:** 25 minutes.

Two relatively new features in Go that you'll see in modern code:

1. **Generics** (Go 1.18+) — type-parameterized functions and types.
2. **Iterators** (Go 1.23+) — `for range` over functions, lazy sequences.

You can write Go without either. But to read modern libraries (and the LLD/MC docs in this bank), you need to recognize them.

---

## The 60-second mental model (read this first)

**Plain English.** A *generic* is a function or type with a blank you fill in later. Think of a vending machine slot labeled "T". You don't decide at build-time whether it holds soda or water — you decide when you *use* it. `Stack[T]` is "a stack of *something*"; you turn it into `Stack[int]` (a stack of ints) or `Stack[string]` (a stack of strings) only when you write the call. The same source code, one copy, works for many types — and unlike the old `interface{}` trick, the compiler still *knows* the real type, so you get autocomplete, type checking, and no casting.

**Plain English (iterators).** An *iterator* is "a thing you can `for range` over that isn't a slice or a map." Instead of building a whole list in memory and then looping it, you hand `for range` a little function that *produces* the next value each time it's asked. Like a water tap (pull one cup when you need it) instead of a filled bucket (all the water up front, whether you drink it or not). This lets you describe infinite or huge sequences and only pay for the items you actually consume.

**The precise version.**
- A **type parameter** is a named placeholder (`T`, `K`, `V`) introduced in square brackets that stands for a type, bounded by a **constraint** (an interface describing the set of permitted types). At each call site the compiler performs **type inference** or you supply the type explicitly; it then **instantiates** the generic into a concrete version.
- An **iterator** in the `iter` package is a function value: `iter.Seq[V]` is `func(yield func(V) bool)`. `for v := range seq` desugars to the runtime calling `seq` and passing it a `yield` closure; the iterator calls `yield(v)` for each element and stops early if `yield` returns `false` (the consumer `break`ed). It's **pull-on-demand** and **single-pass** unless re-created.

If you remember nothing else: *generics = one definition, many types, still type-checked; iterators = `for range` over a function that yields values lazily.*

---

## Why generics?

Before 1.18, to write a generic function you used `interface{}` (now `any`):

```go
func First(items []any) any {
    return items[0]
}

// At call site:
result := First([]any{1, 2, 3}).(int)    // ugly type assertion
```

The compiler couldn't know the type. Lots of casting. Lots of unsafe.

With generics:

```go
func First[T any](items []T) T {
    return items[0]
}

// At call site:
nums := []int{1, 2, 3}
n := First(nums)    // compiler knows n is int
```

Cleaner. Type-safe. Same performance.

### What the three approaches actually cost you

Here is the same "return the first element" idea written three ways, so you can see *why* generics win:

| Approach | Type safety | Allocation / boxing | Call-site noise | Works for new types? |
| --- | --- | --- | --- | --- |
| Copy-paste per type (`FirstInt`, `FirstStr`) | Full | None | `FirstInt(xs)` | No — write a new func each time |
| `interface{}` / `any` + assertion | None until runtime | Boxes values into interface headers | `First(xs).(int)` | Yes, but unsafe |
| Generics `First[T any]` | Full, at compile time | None for slices of values | `First(xs)` | Yes, automatically |

The `any` version has a hidden cost beyond ugliness: putting an `int` into an `any` **boxes** it (allocates an interface value holding a type pointer + data pointer). For a hot loop over millions of items that is real garbage. Generics keep the `int` an `int`.

**Takeaway:** generics give you the safety of copy-paste and the reach of `interface{}` with neither's downside.

---

## Type parameter syntax

```go
func Identity[T any](x T) T {
    return x
}
```

`[T any]` is the **type parameter list**.
- `T` is the name (could be anything; `T`, `K`, `V` are conventions).
- `any` is the **constraint** — the set of types `T` can be.

Call it:
```go
Identity(42)         // T inferred as int
Identity("hello")    // T inferred as string

Identity[int](42)    // explicit (rarely needed)
```

### A complete runnable first program

```go
package main

import "fmt"

func Identity[T any](x T) T { return x }

func main() {
    fmt.Println(Identity(42))      // T = int
    fmt.Println(Identity("hello")) // T = string
    fmt.Println(Identity(3.14))    // T = float64
    fmt.Printf("%T\n", Identity(true)) // shows the inferred concrete type
}
```

Expected output:

```
42
hello
3.14
bool
```

**Takeaway:** the *value* you pass decides what `T` becomes; you rarely write `[int]` yourself.

### Reading the brackets out loud

When you see `func Map[T, U any](items []T, f func(T) U) []U`, read it as: "Map is a function over two unknown types T and U; give me a slice of T and a function turning a T into a U, and I hand back a slice of U." The `[...]` part is always **declaring** placeholders; the `(...)` part uses them. Square brackets = type parameters, round brackets = value parameters.

---

## Multiple type parameters

```go
func Map[T, U any](items []T, f func(T) U) []U {
    out := make([]U, len(items))
    for i, item := range items {
        out[i] = f(item)
    }
    return out
}

nums := []int{1, 2, 3}
strs := Map(nums, func(n int) string {
    return fmt.Sprintf("num-%d", n)
})
// ["num-1", "num-2", "num-3"]
```

### Runnable, with output

```go
package main

import (
    "fmt"
    "strings"
)

func Map[T, U any](items []T, f func(T) U) []U {
    out := make([]U, len(items))
    for i, item := range items {
        out[i] = f(item)
    }
    return out
}

func main() {
    nums := []int{1, 2, 3}
    strs := Map(nums, func(n int) string { return fmt.Sprintf("num-%d", n) })
    fmt.Println(strs)

    // T and U can differ freely — here string -> int (length).
    lengths := Map([]string{"a", "bb", "ccc"}, func(s string) int { return len(s) })
    fmt.Println(lengths)

    upper := Map([]string{"go", "rust"}, strings.ToUpper)
    fmt.Println(upper)
}
```

Expected output:

```
[num-1 num-2 num-3]
[1 2 3]
[GO RUST]
```

**Takeaway:** `Map[T, U]` decouples input and output types — that's why you can map ints to strings or strings to lengths with one function.

---

## Constraints

`any` means "any type." Sometimes you want to restrict.

A constraint answers one question: **"What operations am I allowed to perform on a value of type `T`?"** Inside the body of a generic, you may only do what *every* type in the constraint supports. With `any` you can store, pass, compare-to-nil-if-pointer, and little else — you cannot `+`, `<`, or `==`, because not every type supports them. Widen what the body can do by tightening the constraint.

### Comparable

`comparable` allows `==` and `!=`:

```go
func Contains[T comparable](items []T, target T) bool {
    for _, item := range items {
        if item == target { return true }
    }
    return false
}

Contains([]int{1, 2, 3}, 2)                    // true
Contains([]string{"a", "b"}, "c")              // false
```

`comparable` covers numbers, strings, booleans, pointers, channels, interfaces, and structs/arrays *whose fields are all comparable*. It does **not** cover slices, maps, or functions — those have no `==` (other than comparison to `nil`). So `Contains([][]int{...}, x)` fails to compile, which is exactly right: comparing slices with `==` is a bug Go refuses to let you write.

### Custom constraints — interfaces

A constraint can be an interface listing types or methods:

```go
type Numeric interface {
    int | int64 | float64
}

func Sum[T Numeric](items []T) T {
    var total T
    for _, x := range items {
        total += x
    }
    return total
}

Sum([]int{1, 2, 3})           // 6
Sum([]float64{1.5, 2.5})      // 4.0
```

The `|` is union: `T` may be `int`, `int64`, or `float64`. Listing the types is what makes `total += x` legal — the compiler verifies `+` exists for every member of the union.

#### Method constraints vs. type-set constraints

There are two flavors of constraint, and mixing them up is a common confusion:

```go
// (a) Method-based constraint: any type with a String() string method.
type Stringer interface {
    String() string
}

func Join[T Stringer](items []T, sep string) string {
    parts := make([]string, len(items))
    for i, it := range items {
        parts[i] = it.String() // allowed: every T has String()
    }
    return strings.Join(parts, sep)
}

// (b) Type-set constraint: a fixed list of underlying types.
type Number interface {
    ~int | ~float64
}
```

`(a)` lets you call methods; `(b)` lets you use operators (`+`, `<`). You can even combine them in one interface — a type set *and* a method requirement — but most real constraints are one or the other.

### `~` for type approximation

```go
type MyInt int
type Numeric interface {
    int | float64
}

Sum([]MyInt{1, 2})    // ERROR: MyInt is not int
```

`~` says "any type whose underlying type is this":

```go
type Numeric interface {
    ~int | ~float64
}

Sum([]MyInt{1, 2})    // OK now
```

This is common in modern libraries.

**Why does `MyInt` get rejected without `~`?** Because `int | float64` is the *exact* set `{int, float64}`. `MyInt`'s underlying type is `int`, but `MyInt` itself is a distinct named type and is not literally in the set. The tilde turns "exactly these types" into "these types and anything *defined as* one of them." Real code is full of named types (`time.Duration` is `~int64`, `os.FileMode` is `~uint32`), so library authors almost always write `~`. Rule of thumb: **if your constraint lists predeclared types, you probably want `~` on each.**

```go
package main

import "fmt"

type Celsius float64 // underlying type is float64

type Numeric interface{ ~int | ~float64 }

func Sum[T Numeric](xs []T) T {
    var total T
    for _, x := range xs {
        total += x
    }
    return total
}

func main() {
    fmt.Println(Sum([]Celsius{20.5, 1.0})) // works because of ~float64
}
```

Expected output:

```
21.5
```

**Takeaway:** without `~`, named types like `Celsius` are locked out; with `~`, the constraint follows the underlying type.

### Standard library constraints — `cmp.Ordered`

Go 1.21+ added `cmp.Ordered`:

```go
import "cmp"

func Min[T cmp.Ordered](a, b T) T {
    if a < b { return a }
    return b
}
```

`cmp.Ordered` covers all types that support `<`. Stdlib provides this so you don't have to redefine.

Concretely, `cmp.Ordered` is (roughly) `~int | ~int8 | ... | ~uint | ... | ~float32 | ~float64 | ~string`. Notice it does **not** include booleans (no `<` on bool) or complex numbers (no ordering). Prefer `cmp.Ordered` over hand-rolling a numeric constraint when you need `<`, `<=`, `>`, `>=` — and prefer the standard `min`/`max` *builtins* (Go 1.21+) when you just need the smaller/larger of two ordered values, since they need no import at all:

```go
fmt.Println(min(3, 7))        // 3   — builtin, any ordered type
fmt.Println(max(2.5, 9.0))    // 9   — builtin
fmt.Println(cmp.Compare(1, 2)) // -1  — returns -1, 0, or +1
```

---

## Generic types

```go
type Stack[T any] struct {
    items []T
}

func (s *Stack[T]) Push(item T) {
    s.items = append(s.items, item)
}

func (s *Stack[T]) Pop() (T, bool) {
    var zero T
    if len(s.items) == 0 {
        return zero, false
    }
    n := len(s.items) - 1
    item := s.items[n]
    s.items = s.items[:n]
    return item, true
}

func (s *Stack[T]) Len() int {
    return len(s.items)
}


// Use:
s := &Stack[int]{}
s.Push(1)
s.Push(2)
v, ok := s.Pop()    // v=2, ok=true

names := &Stack[string]{}
names.Push("hello")
```

`Stack[int]` and `Stack[string]` are different types.

### Two details beginners trip on

**1. The receiver repeats the type parameter, but does not re-declare a constraint.** Methods write `func (s *Stack[T])`, *not* `func (s *Stack[T any])`. The constraint lives on the type declaration only; methods just reference `T`.

**2. The zero value via `var zero T`.** You can't write `return nil` (T might be `int`) or `return 0` (T might be `string`). `var zero T` gives you "the zero value of whatever T is" — `0`, `""`, `false`, or a nil pointer — and is the idiomatic way to return "nothing" from a generic function. Returning it alongside an `ok bool` (the "comma-ok" pattern) is how generic containers signal absence.

### Full runnable Stack

```go
package main

import "fmt"

type Stack[T any] struct{ items []T }

func (s *Stack[T]) Push(x T) { s.items = append(s.items, x) }
func (s *Stack[T]) Len() int { return len(s.items) }
func (s *Stack[T]) Pop() (T, bool) {
    var zero T
    if len(s.items) == 0 {
        return zero, false
    }
    n := len(s.items) - 1
    x := s.items[n]
    s.items = s.items[:n]
    return x, true
}

func main() {
    s := &Stack[int]{}
    s.Push(1)
    s.Push(2)
    v, ok := s.Pop()
    fmt.Println(v, ok, "len=", s.Len()) // 2 true len= 1

    _, ok = (&Stack[string]{}).Pop()
    fmt.Println("empty pop ok?", ok) // false
}
```

Expected output:

```
2 true len= 1
empty pop ok? false
```

**Takeaway:** generic containers use `var zero T` + `bool` to report "absent" without knowing T's concrete zero.

---

## Generic helpers — common library

After 1.21, the stdlib added generic helpers:

```go
import "slices"

s := []int{3, 1, 4, 1, 5, 9, 2, 6}
slices.Sort(s)                       // sorts in place
slices.Contains(s, 5)                // true
slices.Index(s, 5)                   // index or -1
slices.Reverse(s)
slices.Max(s)                        // 9
slices.Min(s)
slices.Equal(s, []int{...})

import "maps"

m := map[string]int{"a": 1, "b": 2}
keys := maps.Keys(m)                 // returns iter.Seq[string]
maps.Equal(m1, m2)
maps.Clone(m)
```

These work for any type — internally generic. Way nicer than the old positional-arg `sort.Slice`.

### `slices` vs the old `sort` — a side by side

```go
people := []Person{{"Bob", 30}, {"Ann", 25}}

// Old way (still valid): a callback returning "is i less than j?"
sort.Slice(people, func(i, j int) bool {
    return people[i].Age < people[j].Age
})

// New way (Go 1.21+): a key/compare function, no index juggling.
slices.SortFunc(people, func(a, b Person) int {
    return cmp.Compare(a.Age, b.Age) // -1, 0, or +1
})
```

`SortFunc` takes a *comparison* (`int`-returning) function rather than a *less* (`bool`-returning) one, which composes better and avoids the easy-to-get-wrong index gymnastics. Use `slices.SortStableFunc` when equal elements must keep their original order.

A few more high-value helpers worth memorizing:

```go
slices.ContainsFunc(xs, func(x int) bool { return x > 100 })
slices.IndexFunc(xs, pred)
slices.BinarySearch(sortedXs, target)      // returns (index, found)
slices.Clone(xs)                            // shallow copy
slices.Compact(sortedXs)                    // dedup adjacent equals, in place
maps.Clone(m)                               // shallow copy of a map
```

**Takeaway:** reach for `slices`/`maps`/`cmp` before writing your own loop — they are generic, tested, and read better than `sort.Slice`.

---

## Iterators — `iter.Seq` (Go 1.23+)

Until 1.23, the only way to iterate was `for ... range` over slices, maps, channels, strings, integers. 1.23 added **range over functions** — your own iteration.

### What does an iterator look like?

```go
import "iter"

// A Seq is a function that yields values.
func Numbers() iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := 0; i < 5; i++ {
            if !yield(i) {
                return    // consumer stopped
            }
        }
    }
}

// Use it:
for n := range Numbers() {
    fmt.Println(n)
}
// 0, 1, 2, 3, 4
```

### The yield protocol, slowly

This is the one piece of iterator code everyone has to stare at twice. Here is the contract:

- `iter.Seq[V]` is just `type Seq[V any] func(yield func(V) bool)`. So an iterator is **a function that takes another function (`yield`) as its argument.**
- When you write `for v := range seq`, the compiler builds a `yield` closure for you whose body is the *loop body*, then calls `seq(yield)`.
- Your iterator calls `yield(v)` once per element. `yield` returns `true` to mean "keep going" and `false` to mean "the consumer used `break`/`return`/`panic` — stop now and clean up."
- **You must check the return of `yield` and stop when it is `false`.** Forgetting this is the #1 iterator bug; it means a `break` in the caller cannot actually stop your loop, and any cleanup after the loop never runs.

Mapping the keywords:

| In the consumer's `for` loop... | ...becomes this in your iterator |
| --- | --- |
| each iteration of the body | one call to `yield(v)` |
| `break` / `return` / labeled break | `yield` returns `false` → you `return` |
| `continue` | `yield` returns `true`, you loop to the next value |
| loop finishes normally | your function returns on its own |

### `iter.Seq2[K, V]` for key-value

```go
func Enumerate[T any](s []T) iter.Seq2[int, T] {
    return func(yield func(int, T) bool) {
        for i, v := range s {
            if !yield(i, v) {
                return
            }
        }
    }
}

for i, name := range Enumerate([]string{"a", "b", "c"}) {
    fmt.Println(i, name)
}
```

`iter.Seq2[K, V]` is `func(yield func(K, V) bool)` — the two-value version, exactly mirroring how `range` over a map or slice gives you two loop variables.

### A runnable iterator with early `break`

```go
package main

import (
    "fmt"
    "iter"
)

func Numbers() iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := 0; ; i++ { // note: infinite! laziness makes this safe
            if !yield(i) {
                return
            }
        }
    }
}

func main() {
    for n := range Numbers() {
        if n == 3 {
            break // sends yield -> false, iterator returns cleanly
        }
        fmt.Println(n)
    }
}
```

Expected output:

```
0
1
2
```

**Takeaway:** an iterator can be *infinite* because nothing is computed until `yield` is called, and the consumer's `break` stops it through the `yield` returning `false`.

### Why iterators?

Lazy. Composable. No need to allocate a full slice.

```go
func Take[T any](seq iter.Seq[T], n int) iter.Seq[T] {
    return func(yield func(T) bool) {
        i := 0
        for v := range seq {
            if i >= n { return }
            if !yield(v) { return }
            i++
        }
    }
}

func Filter[T any](seq iter.Seq[T], pred func(T) bool) iter.Seq[T] {
    return func(yield func(T) bool) {
        for v := range seq {
            if pred(v) {
                if !yield(v) { return }
            }
        }
    }
}

// Pipeline:
evens := Filter(Numbers(), func(n int) bool { return n%2 == 0 })
firstThree := Take(evens, 3)
for n := range firstThree {
    fmt.Println(n)
}
```

This is lazy — values are computed on demand, like Python generators.

#### Full runnable pipeline with output

```go
package main

import (
    "fmt"
    "iter"
)

func Count() iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := 0; ; i++ {
            if !yield(i) {
                return
            }
        }
    }
}

func Filter[T any](seq iter.Seq[T], pred func(T) bool) iter.Seq[T] {
    return func(yield func(T) bool) {
        for v := range seq {
            if pred(v) && !yield(v) {
                return
            }
        }
    }
}

func Take[T any](seq iter.Seq[T], n int) iter.Seq[T] {
    return func(yield func(T) bool) {
        i := 0
        for v := range seq {
            if i >= n {
                return
            }
            if !yield(v) {
                return
            }
            i++
        }
    }
}

func main() {
    evens := Filter(Count(), func(n int) bool { return n%2 == 0 })
    for n := range Take(evens, 3) {
        fmt.Println(n)
    }
}
```

Expected output:

```
0
2
4
```

Note how `Count()` is infinite, yet the program terminates: `Take(_, 3)` stops asking after three values, which propagates a `false` from `yield` back up the chain. **Composition + laziness = bounded work over an unbounded source.**

### Stdlib `slices.Values` / `slices.All`

```go
import "slices"

s := []string{"a", "b", "c"}

for v := range slices.Values(s) {
    fmt.Println(v)
}

for i, v := range slices.All(s) {
    fmt.Println(i, v)
}
```

These let you treat a slice as an iterator and compose.

### Going the other direction: `slices.Collect` and friends

Iterators are great for streaming, but eventually you often want a concrete slice or map back. The stdlib gives you the bridge both ways:

```go
import (
    "maps"
    "slices"
)

// Iterator -> slice
nums := slices.Collect(Take(evens, 3)) // []int{0, 2, 4}

// Iterator -> map  (Seq2 of key,value)
m := map[string]int{"a": 1, "b": 2}
clone := maps.Collect(maps.All(m))     // rebuilds the map from its iterator

// Sorted view of a map's keys, lazily then collected
keys := slices.Sorted(maps.Keys(m))    // []string{"a", "b"}
```

| Direction | Function | Produces |
| --- | --- | --- |
| slice → iterator (values) | `slices.Values(s)` | `iter.Seq[T]` |
| slice → iterator (index, value) | `slices.All(s)` | `iter.Seq2[int, T]` |
| map → iterator (keys) | `maps.Keys(m)` | `iter.Seq[K]` |
| map → iterator (values) | `maps.Values(m)` | `iter.Seq[V]` |
| map → iterator (key, value) | `maps.All(m)` | `iter.Seq2[K, V]` |
| iterator → slice | `slices.Collect(seq)` | `[]T` |
| iterator → sorted slice | `slices.Sorted(seq)` | `[]T` |
| iterator → map | `maps.Collect(seq2)` | `map[K]V` |

**Takeaway:** `Values`/`All`/`Keys` lift data *into* the iterator world; `Collect`/`Sorted` bring it *back* — pick streaming for the middle, concrete types at the edges.

### The "pull" iterator: `iter.Pull`

The `for range` form is a **push** iterator — the sequence drives, calling your loop body. Occasionally you need to pull values one at a time (e.g., merging two sorted streams, where you must peek both). `iter.Pull` converts a push `Seq` into a `next`/`stop` pair:

```go
package main

import (
    "fmt"
    "iter"
    "slices"
)

func main() {
    seq := slices.Values([]int{10, 20, 30})
    next, stop := iter.Pull(seq)
    defer stop() // MUST call stop to release the iterator's goroutine

    for {
        v, ok := next()
        if !ok {
            break
        }
        fmt.Println(v)
    }
}
```

Expected output:

```
10
20
30
```

`iter.Pull` is the advanced escape hatch — prefer plain `for range` unless you genuinely need to interleave two sequences. Always `defer stop()`; the pull iterator runs the producer on a goroutine and leaks it if you forget.

---

## Worked example — generic LRU

```go
package main

import (
    "container/list"
    "fmt"
)

type LRU[K comparable, V any] struct {
    cap   int
    ll    *list.List
    items map[K]*list.Element
}

type entry[K comparable, V any] struct {
    key K
    val V
}

func NewLRU[K comparable, V any](cap int) *LRU[K, V] {
    return &LRU[K, V]{
        cap: cap, ll: list.New(),
        items: make(map[K]*list.Element),
    }
}

func (c *LRU[K, V]) Get(key K) (V, bool) {
    var zero V
    if el, ok := c.items[key]; ok {
        c.ll.MoveToFront(el)
        return el.Value.(*entry[K, V]).val, true
    }
    return zero, false
}

func (c *LRU[K, V]) Put(key K, val V) {
    if el, ok := c.items[key]; ok {
        c.ll.MoveToFront(el)
        el.Value.(*entry[K, V]).val = val
        return
    }
    if c.ll.Len() >= c.cap {
        oldest := c.ll.Back()
        if oldest != nil {
            ent := oldest.Value.(*entry[K, V])
            c.ll.Remove(oldest)
            delete(c.items, ent.key)
        }
    }
    e := &entry[K, V]{key: key, val: val}
    c.items[key] = c.ll.PushFront(e)
}

func main() {
    cache := NewLRU[string, int](2)
    cache.Put("a", 1)
    cache.Put("b", 2)
    cache.Put("c", 3)    // evicts "a"
    if _, ok := cache.Get("a"); !ok {
        fmt.Println("a evicted ✓")
    }
    if v, ok := cache.Get("b"); ok {
        fmt.Println("b =", v)
    }
}
```

`LRU[string, int]` and `LRU[int, *User]` are different types. Compiler-enforced.

### Why the type assertion is still here

You'll notice `el.Value.(*entry[K, V])`. `container/list` predates generics, so its `Element.Value` field is `any`. We *put in* `*entry[K, V]` and *take out* `any`, so we must assert it back. This is a common pattern when wrapping an older, non-generic API in a generic shell: the assertion is safe because *we* control every value that goes into the list. Why is `K comparable` (not `any`)? Because `K` is used as a **map key** (`map[K]*list.Element`), and map keys must be comparable. `V` can stay `any` because values are never compared.

**Takeaway:** generics layer cleanly on top of pre-generics stdlib types; constrain `K` to `comparable` precisely because it indexes a map.

---

## When to use generics

- Containers: stacks, queues, sets, caches.
- Pipeline operations: map, filter, reduce.
- Helpers that work for many types: min, max, contains.
- Algorithms: sort, search, dedup.

### When NOT to use them

- Simple cases — if a function works on `int`, just write `int`.
- When the abstraction is unclear. Premature generics is harder to read than a duplicated function.
- Performance-critical code where the compiler can't specialize as well as hand-written.
- **When an ordinary interface already does the job.** If you only ever call *methods* on a value and never need to know its concrete type, a plain interface parameter (`func Render(w io.Writer)`) is simpler and idiomatic. Generics earn their keep when you must return the *same* concrete type you received, store it without boxing, or use operators.

Go's mantra: "**a little duplication is far better than a little dependency**." Generics aren't free — they have cognitive cost.

### The "interface or generic?" decision in one rule

Ask: *"Do I need to preserve or reuse the caller's concrete type?"*

- **No** (I just call methods, any implementer is fine) → use an **interface**. Example: `io.Reader`, `fmt.Stringer`.
- **Yes** (I return what I was given, build a container of it, or use `+`/`<`) → use a **generic**. Example: `slices.Max[T cmp.Ordered]`, `Stack[T]`.

```go
// Interface: caller's type is irrelevant, we only need Read.
func Drain(r io.Reader) (int, error) { ... }

// Generic: we must hand back the *same* element type we received.
func Last[T any](xs []T) T { return xs[len(xs)-1] }
```

---

## Common mistakes

### 1. Over-constraining

```go
func Sum[T int](items []T) T {     // why even use generics?
```

If you only ever use `int`, just take `int`. Generics shine when there are 2+ valid types.

### 2. Type inference fails

Sometimes the compiler can't infer:

```go
m := Map(nums, func(n int) string { ... })    // works
result := Filter([]int{}, ...)                // sometimes ambiguous
```

In ambiguous cases, specify:

```go
result := Filter[int]([]int{}, ...)
```

Inference most often fails when the type parameter appears **only in a return position** or **only inside a closure's result**, because there's no argument to read it from. The fix is always the same: name the type in brackets at the call site.

### 3. Method sets on generic types

You can't have type-specific methods on a generic type:

```go
type Stack[T any] struct { ... }

func (s *Stack[int]) Sum() int { ... }    // ERROR
```

Only methods that work for all `T` are allowed. For type-specific behavior, use a function instead:

```go
func StackSum(s *Stack[int]) int { ... }
```

### 4. Generic types as map keys

Map keys need `comparable`:

```go
type Set[T comparable] struct {
    items map[T]struct{}
}
```

Without `comparable`, `map[T]...` won't compile.

### 5. Using `any` when you mean something specific

```go
func First[T any](s []T) T { return s[0] }
```

OK — works for everything. But:

```go
func Sum[T any](items []T) T {    // can't add `any`!
```

Use a constraint when the operation requires it.

### 6. Forgetting to honor `yield`'s return value

This is the iterator equivalent of mistake #5 — silent and dangerous:

```go
// WRONG: ignores yield's bool, so caller's `break` can't stop us.
func BadCount() iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := 0; i < 1_000_000; i++ {
            yield(i) // result discarded!
        }
    }
}
```

If the consumer does `for v := range BadCount() { break }`, your loop keeps running to a million (and any cleanup after the loop never fires). The fix:

```go
func GoodCount() iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := 0; i < 1_000_000; i++ {
            if !yield(i) {
                return // respect the consumer's break
            }
        }
    }
}
```

If you allocate a resource, pair it with `defer` *inside* the iterator so it runs whether the loop completes or is broken:

```go
func Lines(name string) iter.Seq[string] {
    return func(yield func(string) bool) {
        f, err := os.Open(name)
        if err != nil {
            return
        }
        defer f.Close() // runs on normal end AND on early break
        sc := bufio.NewScanner(f)
        for sc.Scan() {
            if !yield(sc.Text()) {
                return
            }
        }
    }
}
```

### 7. Expecting C++-style template metaprogramming

Go generics are deliberately small. You **cannot** specialize a generic for one type, do compile-time arithmetic on types, or have a method's signature depend on `T` in a varying way. If you feel the urge to "switch on the type" inside a generic, that's a sign you may want a plain interface with methods, or separate functions, instead.

### 8. `comparable` does not mean `cmp.Ordered`

```go
func Sort[T comparable](xs []T) { /* if xs[i] < xs[j] ... */ } // ERROR: no <
```

`comparable` gives you `==`/`!=` only. For `<` you need `cmp.Ordered`. Picking the weakest constraint that still permits your operations is the discipline; here that's `cmp.Ordered`, not `comparable`.

---

## Cross-questions an interviewer or reviewer will ask

**Q: Why did Go add generics so late (2022, version 1.18), when Java had them in 2004?**
Because Go's designers were unwilling to ship them until they had a design that (a) preserved fast compilation, (b) didn't require boxing every value, and (c) felt simple. The accepted proposal is "type parameters" with constraints expressed as ordinary-looking interfaces (type sets). They explicitly rejected richer template systems to keep the language small.

**Q: How are Go generics implemented — like C++ templates (per-type code) or like Java (type erasure)?**
A pragmatic middle called **GC-shape stenciling with dictionaries**. The compiler generates one copy of the code per *GC shape* (loosely: per memory layout — all pointer-shaped types like `*T` share one instantiation), and passes a hidden **dictionary** carrying per-type info (like which methods to call). So it's neither pure monomorphization (C++) nor pure erasure (Java). Practical effect: usually no boxing, occasionally an indirect call. For a beginner the honest answer is "same performance as hand-written in the common case; don't pre-optimize."

**Q: Why use a constraint interface instead of just `any` everywhere?**
Because the constraint defines what you can *do* with `T`. `any` permits storing and passing — not `+`, `<`, or `==`. The constraint is a contract checked at compile time at every call site. Picking the *narrowest* constraint that compiles is the goal: it documents intent and maximizes the set of types that can call you while still being safe.

**Q: When would you choose an iterator over returning a `[]T`?**
When the sequence is large, infinite, expensive to fully materialize, or you want to compose lazily (filter→map→take) without intermediate slices. Return a plain slice when the data is small and already in memory and callers will iterate it more than once — iterators are single-pass; a slice is re-rangeable.

**Q: Are iterators concurrent or do they use goroutines?**
The `for range` (push) form is purely sequential — no goroutines, just nested function calls. Only `iter.Pull` spins up a goroutine to invert control, which is exactly why you must `defer stop()` to avoid leaking it.

**Q: Why is `comparable` a special built-in constraint and not just an interface I could write?**
Because the set of comparable types isn't a fixed list — it includes any struct or array whose fields are themselves comparable, which the compiler computes structurally. You couldn't enumerate that with `int | string | ...`. The compiler hard-codes the rule.

**Q: Can a method have its own type parameters?**
No. Only top-level functions and type declarations can introduce type parameters. A method may *use* its receiver type's parameters (`func (s *Stack[T]) Push(T)`) but cannot add new ones (`func (s *Stack[T]) MapTo[U any]() ...` is illegal). Use a free function for that.

**Q: Does `~int` include `int` itself?**
Yes. `~int` is "every type whose underlying type is `int`," and `int`'s underlying type is `int`, so plain `int` qualifies along with any `type Foo int`.

**Q: Why not make everything generic for maximum reuse?**
Cognitive cost and inference fragility. A generic signature is harder to read, and over-generic code pushes type errors to call sites with confusing messages. The Go community norm: introduce generics when you have a real second type, not speculatively.

---

## Exercises

1. **Generic queue.** Build `Queue[T]` with `Enqueue`, `Dequeue`, `Len`. Try it for `Queue[int]` and `Queue[Order]`.
2. **Generic Set.** `Set[T comparable]` with `Add`, `Remove`, `Contains`, `Size`. Methods to compute `Union`, `Intersection`.
3. **Generic Min by key.** `MinBy[T any, K cmp.Ordered](items []T, key func(T) K) T` that returns the item with the smallest key.
4. **Iterator pipeline.** Use `iter.Seq` to build a pipeline: a function that yields integers from a file, a Filter, and a Map. Compose them.
5. **Reduce.** Write `Reduce[T, U any](seq iter.Seq[T], init U, f func(U, T) U) U` that folds an iterator into a single value. Verify `Reduce(slices.Values([]int{1,2,3,4}), 0, func(acc, x int) int { return acc + x })` returns `10`.
6. **Map over an iterator.** Write `MapSeq[T, U any](seq iter.Seq[T], f func(T) U) iter.Seq[U]` (the lazy cousin of `Map`). Confirm it never builds an intermediate slice by feeding it an infinite `Count()` and `Take`-ing 3.

### Hint for #2

```go
type Set[T comparable] struct {
    items map[T]struct{}
}

func NewSet[T comparable](xs ...T) *Set[T] {
    s := &Set[T]{items: map[T]struct{}{}}
    for _, x := range xs { s.Add(x) }
    return s
}

func (s *Set[T]) Add(x T)     { s.items[x] = struct{}{} }
func (s *Set[T]) Contains(x T) bool { _, ok := s.items[x]; return ok }

func (s *Set[T]) Union(o *Set[T]) *Set[T] {
    out := NewSet[T]()
    for x := range s.items { out.Add(x) }
    for x := range o.items { out.Add(x) }
    return out
}
```

### Hint for #3

```go
import "cmp"

func MinBy[T any, K cmp.Ordered](items []T, key func(T) K) T {
    best := items[0]            // assume non-empty; in real code guard len==0
    bestKey := key(best)
    for _, it := range items[1:] {
        if k := key(it); k < bestKey {
            best, bestKey = it, k
        }
    }
    return best
}
```

Why two type parameters? `T` is the element you return; `K` is the *comparable* projection you sort by. They're independent — you might find the shortest `string` (`K=int`) or the cheapest `Product` (`K=float64`).

### Hint for #5

```go
func Reduce[T, U any](seq iter.Seq[T], init U, f func(U, T) U) U {
    acc := init
    for v := range seq {
        acc = f(acc, v)
    }
    return acc
}
```

`Reduce` is *eager* (it must consume everything to produce one answer), which is the natural shape of a fold — contrast with `MapSeq`/`Filter`, which stay lazy.

---

## What to read next

- **Within this track:** re-skim `07-interfaces.md` and put it next to this doc — the "interface or generic?" decision is the single most useful thing to internalize, and seeing both features side by side cements it.
- **Stdlib reference:** the package docs for [`slices`](https://pkg.go.dev/slices), [`maps`](https://pkg.go.dev/maps), [`cmp`](https://pkg.go.dev/cmp), and [`iter`](https://pkg.go.dev/iter) are short and worth reading end-to-end now that the concepts click.
- **Deeper background:** the official blogs ["An Introduction To Generics"](https://go.dev/blog/intro-generics), ["When To Use Generics"](https://go.dev/blog/when-generics) and ["Range Over Function Types"](https://go.dev/blog/range-functions) — the last explains the `yield` protocol from the language team's own pen.

## What's next

You've finished the Go Foundations track! 12 docs from "Hello, World" to generics and iterators.

Where to next:
- **Concepts**: `Foundations/OOP/four-pillars.md` and SOLID/Patterns.
- **Apply it**: `LLD/Go/parking-lot.md`.
- **System design**: `HLD/url-shortener.md`.

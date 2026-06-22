# 03 — Control Flow

> **Prerequisites:** `02-types-and-variables.md`.
> **Time to read:** 20 minutes.

---

## What "control flow" even means (plain English first)

A program is a list of instructions. By default the computer runs them **top to bottom, one after another**. "Control flow" is the set of tools that let you change that straight line:

- **Branching** — "do this *only if* something is true" (`if`, `switch`).
- **Looping** — "do this *over and over* until something changes" (`for`).
- **Jumping** — "stop early" / "skip ahead" (`break`, `continue`, `return`).
- **Cleanup** — "no matter how this function ends, run this last" (`defer`).
- **Crash & catch** — "blow up" and optionally "catch the explosion" (`panic` / `recover`).

The precise version: control-flow statements are the constructs that determine the **order in which statements execute** and the **conditions** under which they execute. In Go these are a deliberately small set — Go's designers removed `while`, `do-while`, the ternary `?:` operator, and exceptions, because fewer constructs means less to learn and less to argue about in code review. The whole language has essentially one branch statement family (`if`/`switch`/`select`) and **one** loop keyword (`for`). That minimalism is the theme of this entire doc.

A one-line mental model you'll reuse all chapter:

> Go prefers **explicit and obvious** over **clever and short**. Every gotcha below is a consequence of that preference.

---

## `if` / `else`

```go
age := 18

if age >= 18 {
    fmt.Println("You can vote.")
} else {
    fmt.Println("Too young.")
}
```

**Expected output:**
```
You can vote.
```

**Takeaway:** the condition must be a `bool` — no parentheses, but braces are mandatory.

Differences from many languages:
- **No parentheses** around the condition. `if (age >= 18)` compiles, but the parens are pointless and `gofmt` won't add them; idiomatic Go omits them.
- **Braces always required**, even for one-line bodies. There is no `if x > 0 doThing()` form. This single rule eliminates the entire class of "dangling else" and Apple's famous `goto fail;` bug, where a stray indented statement *looked* guarded but wasn't.
- **The opening brace must be on the same line** as the `if`. This is not style — it's required by the grammar because of automatic semicolon insertion (see the cross-questions section). Putting `{` on its own line is a compile error.
- **The condition must be strictly `bool`.** Unlike C, `if 1 { ... }` does not compile. There is no "truthiness"; `0`, `""`, and `nil` are not falsy.

### Short-statement form (init)

```go
if n := computeSomething(); n > 10 {
    fmt.Println("big")
} else {
    fmt.Println("small", n)
}
// n is out of scope here
```

The part before the `;` is an **init statement**. It runs once, before the condition is evaluated. Crucially, `n` is **scoped to the entire `if`/`else if`/`else` chain** but nowhere outside it. This is the idiomatic way to keep a variable's lifetime as short as its usefulness — a recurring Go value (small scopes = fewer bugs).

This is idiomatic Go for handling errors:

```go
if err := doThing(); err != nil {
    return err
}
```

Here `err` exists only for the length of the check. After the `if`, the name is gone, so you can't accidentally read a stale `err` later — a real source of bugs in languages where the error variable leaks into the surrounding scope.

A small runnable version:

```go
package main

import (
    "fmt"
    "strconv"
)

func main() {
    if v, err := strconv.Atoi("42"); err == nil {
        fmt.Println("parsed:", v+1)
    } else {
        fmt.Println("bad number:", err)
    }
}
```

**Expected output:**
```
parsed: 43
```

**Takeaway:** the init statement can declare *multiple* values (`v, err`), and both are scoped to the whole `if` chain.

### `else if`

```go
score := 75

if score >= 90 {
    fmt.Println("A")
} else if score >= 80 {
    fmt.Println("B")
} else if score >= 70 {
    fmt.Println("C")
} else {
    fmt.Println("F")
}
```

**Expected output:**
```
C
```

**Takeaway:** conditions are checked top to bottom; the **first** true branch wins and the rest are skipped. Order matters — if you wrote `score >= 70` first, everyone above 70 would get a "C".

### Idiom: early return over deep nesting

A very common Go style choice is to **return early** instead of nesting `else` blocks. Compare:

```go
// Less idiomatic: the "happy path" is buried inside nesting.
func process(s string) error {
    if s != "" {
        if len(s) < 100 {
            // ... real work, two levels deep ...
            return nil
        } else {
            return fmt.Errorf("too long")
        }
    } else {
        return fmt.Errorf("empty")
    }
}
```

```go
// Idiomatic: guard clauses first, happy path un-indented at the bottom.
func process(s string) error {
    if s == "" {
        return fmt.Errorf("empty")
    }
    if len(s) >= 100 {
        return fmt.Errorf("too long")
    }
    // ... real work, zero extra indentation ...
    return nil
}
```

**Why:** the reader can scan the guard clauses and then read the main logic at a flat indentation level. The Go community calls this "line of sight" — the success path runs straight down the left edge.

---

## `switch` — Go's power feature

Go's `switch` is more flexible than C/Java's.

### Basic switch

```go
day := "Monday"

switch day {
case "Monday", "Tuesday", "Wednesday", "Thursday", "Friday":
    fmt.Println("Weekday")
case "Saturday", "Sunday":
    fmt.Println("Weekend")
default:
    fmt.Println("Unknown")
}
```

**Expected output:**
```
Weekday
```

Multiple values per case via comma. **No automatic fall-through** — each case is independent. In C you'd need a `break` at the end of every case to avoid silently running the next one; Go inverts the default, so the common, safe behavior (stop after one case) requires no keyword, and the rare behavior (continue) requires the explicit `fallthrough`.

A `switch` with an expression like `switch day` is **type-checked**: the case values must be comparable to `day`'s type. `case 5:` here would be a compile error because you can't compare a `string` to an `int`.

### Switch with no expression — `if/else if` chain replacement

```go
n := 50

switch {
case n < 10:
    fmt.Println("small")
case n < 100:
    fmt.Println("medium")
default:
    fmt.Println("big")
}
```

**Expected output:**
```
medium
```

Same as a chain of `if/else if`, but cleaner. An expressionless `switch` is exactly `switch true` — each case is a boolean expression and the first one that evaluates to `true` runs. Reach for this when you have 3+ ranges or conditions; it reads more like a table than a staircase of `else if`.

### Switch with an init statement

Like `if`, `switch` can carry a short init statement:

```go
package main

import "fmt"

func classify(n int) string {
    switch r := n % 2; r {
    case 0:
        return "even"
    default:
        return fmt.Sprintf("odd (remainder %d)", r)
    }
}

func main() {
    fmt.Println(classify(4))
    fmt.Println(classify(7))
}
```

**Expected output:**
```
even
odd (remainder 1)
```

**Takeaway:** `switch init; expr { ... }` scopes the init variable to the whole switch — handy for computing a value once and switching on it.

### Type switch (powerful)

```go
func describe(x interface{}) {
    switch v := x.(type) {
    case int:
        fmt.Printf("int: %d\n", v)
    case string:
        fmt.Printf("string: %q\n", v)
    case bool:
        fmt.Printf("bool: %t\n", v)
    default:
        fmt.Printf("unknown type: %T\n", v)
    }
}

describe(42)        // int: 42
describe("hello")   // string: "hello"
describe(true)      // bool: true
```

We use this when working with interfaces. The special syntax `x.(type)` is **only** legal inside a `switch`. The variable `v` is automatically given the **concrete type of the matched case** — so inside `case int:`, `v` is an `int` and you can do arithmetic on it; inside `case string:`, `v` is a `string`. That's the whole point: it both *tests* the dynamic type and *unwraps* the value in one step.

Note `interface{}` (any value at all) can also be written `any` since Go 1.18 — they are identical aliases:

```go
func describe(x any) { /* ... */ }   // same thing, more readable
```

Two subtleties worth knowing:
- You can **group types** in one case: `case int, int64:` — but then `v` keeps the static type `any` (the original interface), because Go can't pick a single concrete type for the case body.
- A `case nil:` matches when the interface itself holds no value (`describe(nil)` prints `unknown type: <nil>` without it, or hits `case nil:` if you add one).

Runnable demonstration of all three:

```go
package main

import "fmt"

func describe(x any) {
    switch v := x.(type) {
    case nil:
        fmt.Println("it was nil")
    case int, int64:
        fmt.Printf("some integer kind: %v\n", v) // v is still 'any' here
    case string:
        fmt.Printf("string of length %d\n", len(v)) // v is a string here
    default:
        fmt.Printf("unhandled type %T\n", v)
    }
}

func main() {
    describe(nil)
    describe(7)
    describe("hello")
    describe(3.14)
}
```

**Expected output:**
```
it was nil
some integer kind: 7
string of length 5
unhandled type float64
```

**Takeaway:** single-type cases give you a typed `v`; grouped cases leave `v` as the interface type.

### `fallthrough` (rare)

```go
switch n {
case 1:
    fmt.Println("one")
    fallthrough         // also run case 2
case 2:
    fmt.Println("two")
}
```

Generally avoided. Rules that trip people up:
- `fallthrough` transfers control to the **next case unconditionally** — it does **not** re-check that case's condition. With `n == 1` above you'll print both `one` and `two`, even though `n` is not `2`.
- It must be the **last statement** in a case body. `fallthrough; fmt.Println(...)` is a compile error.
- It cannot be used in the **final** case (there's nothing to fall into) and is **not allowed in a type switch** at all.

When do you *legitimately* want it? Mostly for accumulating behavior across ordered levels — e.g. a verbosity setting where "level 2 also does everything level 1 does." Even then, many reviewers prefer combining cases with commas or restructuring, because `fallthrough` makes a case's behavior depend on text order.

---

## `for` — the only loop

Go has **only one loop keyword**: `for`. It's flexible enough. By dropping different parts of the classic `for init; cond; post { }` you recover every loop shape other languages spell with separate keywords.

### C-style

```go
for i := 0; i < 5; i++ {
    fmt.Println(i)
}
// 0 1 2 3 4
```

Three parts separated by semicolons: **init** (runs once), **condition** (checked before each iteration), **post** (runs after each iteration). `i` is scoped to the loop. Note Go has `i++` as a *statement*, not an expression — you cannot write `j = i++` or `for i++ < 5`.

### `while`-style

```go
n := 0
for n < 5 {
    fmt.Println(n)
    n++
}
```

Drop the init and post; keep only the condition. This is Go's `while`. There is no `while` keyword — `for cond {}` *is* the while loop.

### Infinite loop

```go
for {
    fmt.Println("forever")
    if someCondition() {
        break
    }
}
```

Drop everything: `for {}` loops forever. This is the idiomatic shape for servers, event loops, and "retry until success" logic, with `break`/`return` as the exit. (Go has no `do-while`; to guarantee the body runs at least once, use `for {}` with the exit check at the bottom.)

Runnable "do-while" pattern:

```go
package main

import "fmt"

func main() {
    n := 10
    for {
        fmt.Println(n)
        n--
        if n <= 7 {
            break
        }
    }
}
```

**Expected output:**
```
10
9
8
```

**Takeaway:** put the exit condition at the *end* of a `for {}` body to emulate `do-while` (body always runs once).

### Range — iterate over collections

```go
fruits := []string{"apple", "banana", "cherry"}

for i, fruit := range fruits {
    fmt.Println(i, fruit)
}
// 0 apple
// 1 banana
// 2 cherry

// Just values (discard index)
for _, fruit := range fruits {
    fmt.Println(fruit)
}

// Just indexes
for i := range fruits {
    fmt.Println(i)
}
```

`range` is Go's "for each." A key fact: **`range` copies each element into the loop variable.** For a slice of small values this is cheap; for a slice of large structs it can be wasteful, and — more importantly — mutating `fruit` does **not** change the slice. To modify the underlying element, index it directly:

```go
// WRONG: modifies a copy; the slice is unchanged.
for _, n := range nums {
    n *= 2
}

// RIGHT: index back into the slice.
for i := range nums {
    nums[i] *= 2
}
```

**Takeaway:** read with `for _, v := range`; **write** with `for i := range` and `s[i]`.

### Range over an array vs a slice (a subtle copy gotcha)

```go
package main

import "fmt"

func main() {
    arr := [3]int{1, 2, 3}
    for i, v := range arr { // 'arr' (the array value) is copied once, up front
        if i == 0 {
            arr[2] = 99 // mutate the original AFTER ranging started
        }
        fmt.Println(i, v)
    }
}
```

**Expected output:**
```
0 1
1 2
2 3
```

**Takeaway:** ranging over an **array** evaluates a *copy* of the array, so the mid-loop write to `arr[2]` is not seen. Ranging over a **slice** ranges over the live backing data. (Arrays are values; slices are descriptors pointing at shared storage — see `02-types-and-variables.md`.)

### Range over map

```go
person := map[string]int{
    "Alice": 30,
    "Bob": 25,
    "Carol": 35,
}

for name, age := range person {
    fmt.Printf("%s: %d\n", name, age)
}
// Map iteration order is RANDOM. Don't rely on order.
```

The randomization is **deliberate** — the runtime starts map iteration at a random bucket on every run, specifically so that no program accidentally grows to depend on a particular order (which historically caused brittle, hard-to-port code). If you need sorted output, collect the keys and sort them:

```go
package main

import (
    "fmt"
    "sort"
)

func main() {
    person := map[string]int{"Alice": 30, "Bob": 25, "Carol": 35}

    keys := make([]string, 0, len(person))
    for k := range person {
        keys = append(keys, k)
    }
    sort.Strings(keys)

    for _, k := range keys {
        fmt.Printf("%s: %d\n", k, person[k])
    }
}
```

**Expected output:**
```
Alice: 30
Bob: 25
Carol: 35
```

**Takeaway:** "I need maps in a stable order" → range the **sorted keys**, not the map.

### Range over string

```go
for i, r := range "héllo" {
    fmt.Printf("%d: %c\n", i, r)
}
// Indexes are BYTE positions; r is rune (Unicode codepoint).
```

**Expected output:**
```
0: h
1: é
3: l
4: l
5: o
```

Look closely: the index jumps from `1` to `3`. That's because `é` is encoded as **two bytes** in UTF-8, so the next character starts at byte offset 3. `range` over a string decodes UTF-8 for you and yields `(byteIndex, rune)`. Two consequences:

- `for i, r := range s` gives you **runes** (Unicode code points), correctly handling multi-byte characters.
- `for i := 0; i < len(s); i++ { s[i] }` gives you **raw bytes** (`s[i]` is a `byte`), which will split multi-byte characters. Use this only when you genuinely want bytes.

**Takeaway:** `range` a string for characters; index a string for bytes. `len("héllo")` is `6`, not `5`.

### Range over an integer (Go 1.22+)

Since Go 1.22 you can range over an `int` directly to count from 0:

```go
package main

import "fmt"

func main() {
    for i := range 3 { // 0, 1, 2
        fmt.Println(i)
    }
}
```

**Expected output:**
```
0
1
2
```

**Takeaway:** `for i := range n` is the modern way to write `for i := 0; i < n; i++`. (Requires `go 1.22` or later in your `go.mod`.)

### Range over channel

```go
ch := make(chan int)
go func() {
    for i := 0; i < 3; i++ {
        ch <- i
    }
    close(ch)
}()

for v := range ch {     // reads until ch is closed
    fmt.Println(v)
}
```

**Expected output:**
```
0
1
2
```

`for v := range ch` keeps receiving values until the channel is **closed and drained**. If the producer goroutine forgets to `close(ch)`, this loop blocks forever after the last value (a deadlock). (More on channels in `08-goroutines-and-channels.md`.)

### Range over a function — iterators (Go 1.23+)

Go 1.23 added "range over func," which lets a function drive a `for range` loop. You'll mostly *consume* these (e.g. `maps.Keys`, `slices.Values`) rather than write them, but here's the shape so the syntax isn't a surprise:

```go
package main

import "fmt"

// Countdown yields n, n-1, ..., 1.
func Countdown(n int) func(yield func(int) bool) {
    return func(yield func(int) bool) {
        for i := n; i >= 1; i-- {
            if !yield(i) { // yield returns false if the consumer 'break's
                return
            }
        }
    }
}

func main() {
    for v := range Countdown(3) {
        fmt.Println(v)
    }
}
```

**Expected output:**
```
3
2
1
```

**Takeaway:** any function with the signature `func(yield func(V) bool)` is a valid range target. This is how the standard library's new iterator helpers (`slices.All`, `maps.Values`, …) plug into ordinary `for range`. Requires `go 1.23+`.

---

## `break` and `continue`

Same as most languages:

```go
for i := 0; i < 10; i++ {
    if i == 5 {
        break       // exit loop entirely
    }
    if i % 2 == 0 {
        continue    // skip rest, next iteration
    }
    fmt.Println(i)
}
// Output: 1 3
```

- `break` exits the **innermost** loop (or `switch`/`select`) immediately.
- `continue` skips the rest of the current iteration and runs the **post statement**, then the condition, then the next iteration.

One gotcha worth pinning down: a `break` inside a `switch` that is *inside* a loop breaks **out of the switch, not the loop**. People hit this constantly:

```go
package main

import "fmt"

func main() {
    for i := 0; i < 5; i++ {
        switch {
        case i == 2:
            fmt.Println("found 2, breaking")
            break // breaks the SWITCH, not the for — the loop keeps going!
        default:
            fmt.Println("at", i)
        }
    }
}
```

**Expected output:**
```
at 0
at 1
found 2, breaking
at 3
at 4
```

To actually leave the loop from inside the switch, use a **labeled break** (next section). This is the most common real reason labels exist.

### Labeled break (rare)

To break out of a nested loop:

```go
outer:
for i := 0; i < 5; i++ {
    for j := 0; j < 5; j++ {
        if i*j > 6 {
            break outer    // breaks out of BOTH loops
        }
    }
}
```

`continue` can also take a label, to jump to the next iteration of an outer loop:

```go
package main

import "fmt"

func main() {
Rows:
    for i := 1; i <= 3; i++ {
        for j := 1; j <= 3; j++ {
            if j == i {
                continue Rows // stop this row, advance the outer loop
            }
            fmt.Printf("(%d,%d) ", i, j)
        }
    }
    fmt.Println()
}
```

**Expected output:**
```
(2,1) (3,1) (3,2)
```

**Takeaway:** the label names the **loop**, and goes on the line *immediately before* it with a colon. Use labels sparingly — if you need them often, that's usually a hint to extract the inner loop into a function and `return` from it instead.

---

## `goto` (you will almost never use this)

For completeness: Go does have `goto`. It jumps to a label within the same function.

```go
package main

import "fmt"

func main() {
    i := 0
loop:
    if i < 3 {
        fmt.Println(i)
        i++
        goto loop
    }
}
```

**Expected output:**
```
0
1
2
```

**When NOT to use it:** essentially always. Anything `goto` does, a `for` loop or early `return` does more readably. `goto` cannot jump *into* a block or *over* a variable declaration that's still in scope (the compiler rejects it), which limits the damage, but readers don't expect it. The one place you sometimes see it in real code is auto-generated parsers/state machines and a handful of standard-library hot paths. **Takeaway:** know it exists so you recognize it; don't reach for it.

---

## `defer` — cleanup made easy

`defer` schedules a function call to run when the surrounding function returns.

```go
func main() {
    defer fmt.Println("world")
    fmt.Println("hello")
}
// Output:
// hello
// world
```

The plain-English version: "do this *last*, on your way out the door, no matter which door you take." Whether the function returns normally, returns early from a guard clause, or panics, the deferred calls still run. That's what makes it the right tool for releasing resources.

Common use: closing files, unlocking mutexes, ensuring cleanup runs even on errors.

```go
func readFile(path string) error {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer f.Close()    // runs when function returns

    // ... use f ...
    return nil
}
```

Even if `... use f ...` panics or returns early, `f.Close()` runs. The idiom is to put the `defer` **immediately after** the resource is successfully acquired (and after the error check), so the acquisition and release sit next to each other and you can't forget the release.

### LIFO order

Multiple defers run in reverse:

```go
defer fmt.Println("1")
defer fmt.Println("2")
defer fmt.Println("3")
// Output: 3 2 1
```

Why last-in-first-out? Because cleanup usually mirrors setup: you open A, then open B; on the way out you want to close B *first*, then A (B may depend on A still being open). Stacking defers gives you that nesting for free.

### `defer` evaluates arguments immediately

```go
i := 1
defer fmt.Println(i)    // prints 1, not 2
i = 2
```

The function call is deferred, but its arguments are evaluated at the `defer` line. So `fmt.Println` is *called* later, but it's called with the value `i` had **at the moment `defer` executed** (1). This surprises almost everyone once.

If you actually want the *final* value, defer a closure that reads the variable when it runs:

```go
package main

import "fmt"

func main() {
    i := 1
    defer func() { fmt.Println("closure sees:", i) }() // reads i at return time
    defer fmt.Println("arg captured:", i)              // captured the value 1 now
    i = 2
}
```

**Expected output:**
```
arg captured: 1
closure sees: 2
```

**Takeaway:** `defer f(x)` snapshots `x` now; `defer func(){ ... x ... }()` reads `x` later. Choose deliberately.

### `defer` can change a function's named return value

A deferred closure runs *after* the `return` value is set but *before* the function actually hands control back. If the return values are **named**, the closure can modify them. This is exactly how `recover` turns a panic into an error:

```go
package main

import "fmt"

func doubleViaDefer() (result int) {
    defer func() {
        result *= 2 // mutates the named return AFTER `return 5` set it to 5
    }()
    return 5
}

func main() {
    fmt.Println(doubleViaDefer())
}
```

**Expected output:**
```
10
```

**Takeaway:** named returns + deferred closure = the only clean way to post-process a return value (used for error wrapping and panic recovery).

### `defer` in a loop — the classic resource leak

```go
// WRONG: every file stays open until processAll() returns, not until each iteration ends.
func processAll(paths []string) error {
    for _, p := range paths {
        f, err := os.Open(p)
        if err != nil {
            return err
        }
        defer f.Close() // these PILE UP; with 10,000 paths you exhaust file descriptors
        // ... use f ...
    }
    return nil
}
```

```go
// RIGHT: give each file its own function scope so defer fires per iteration.
func processAll(paths []string) error {
    for _, p := range paths {
        if err := processOne(p); err != nil {
            return err
        }
    }
    return nil
}

func processOne(p string) error {
    f, err := os.Open(p)
    if err != nil {
        return err
    }
    defer f.Close() // runs when processOne returns — i.e. per file
    // ... use f ...
    return nil
}
```

**Takeaway:** `defer` is tied to the **function**, not the loop body. If you defer inside a hot loop, refactor the body into its own function (or `f.Close()` explicitly at the end of the iteration).

---

## `panic` and `recover`

`panic` is Go's "explosive failure" — like an unrecoverable exception.

```go
func divide(a, b int) int {
    if b == 0 {
        panic("division by zero")
    }
    return a / b
}
```

A panic crashes the program unless recovered. Mechanically, a `panic` stops the normal flow, runs all **deferred functions up the call stack** (this is why cleanup still happens during a panic), prints a stack trace, and exits with status 2.

Note many runtime errors panic on their own — you don't have to call `panic` yourself to see one. Index out of range, nil-map writes, nil-pointer dereferences, and integer divide-by-zero all panic:

```go
package main

import "fmt"

func main() {
    var s []int
    fmt.Println(s[3]) // panic: runtime error: index out of range [3] with length 0
}
```

### `recover` — catch a panic

```go
func safeDivide(a, b int) (result int, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("recovered: %v", r)
        }
    }()
    return divide(a, b), nil
}

result, err := safeDivide(10, 0)
fmt.Println(result, err)    // 0 recovered: division by zero
```

Three rules that make `recover` work — break any one and it silently does nothing:
1. `recover` only has an effect when called **directly inside a deferred function**. Calling it in normal flow returns `nil`.
2. It stops the panic *and* returns the value passed to `panic`. If there was no panic, it returns `nil` (that's the `if r != nil` check).
3. To surface the result to the caller, you typically assign to a **named return value** (here `err`), per the "defer can change named returns" rule above.

Runnable end-to-end version:

```go
package main

import "fmt"

func divide(a, b int) int {
    if b == 0 {
        panic("division by zero")
    }
    return a / b
}

func safeDivide(a, b int) (result int, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("recovered: %v", r)
        }
    }()
    return divide(a, b), nil
}

func main() {
    fmt.Println(safeDivide(10, 2)) // 5 <nil>
    fmt.Println(safeDivide(10, 0)) // 0 recovered: division by zero
    fmt.Println("program continues normally")
}
```

**Expected output:**
```
5 <nil>
0 recovered: division by zero
program continues normally
```

**Takeaway:** `recover` lets the program keep running past a panic — but only from inside a `defer`, and only the goroutine that panicked.

**Use panic/recover sparingly.** Reserve for truly exceptional cases (programmer bugs, library boundaries). Normal errors should be returned. Concretely:
- **Do** return an `error` for anything a caller might reasonably want to handle: file not found, bad input, network timeout. This is the dominant Go style.
- **Do** panic for "this should be impossible" invariants and unrecoverable startup failures (e.g. a required config template fails to parse at init time).
- **Do** recover at a *boundary* — e.g. an HTTP server wraps each request handler so one handler's panic returns a 500 instead of killing the whole server. The standard `net/http` server already does this for you.
- **Don't** use panic/recover as general flow control or as cheap exceptions. A panic does not cross goroutines: a panic in a goroutine you spawned cannot be recovered by the goroutine that spawned it, and will crash the whole process. That asymmetry is a deliberate nudge toward errors.

---

## Common mistakes

**1. Forgetting curly braces.**
```go
if age >= 18
    fmt.Println("ok")    // SYNTAX ERROR
```
Fix: braces are mandatory, and the `{` must be on the same line as the `if`:
```go
if age >= 18 {
    fmt.Println("ok")
}
```

**2. Trying to declare variables in `if` body and use later.**
```go
if x := 5; x > 0 {
    fmt.Println(x)
}
fmt.Println(x)    // ERROR: x out of scope
```
Fix: if you need `x` afterward, declare it *before* the `if`:
```go
x := 5
if x > 0 {
    fmt.Println(x)
}
fmt.Println(x) // fine
```

**3. Switch fall-through assumption.**
Coming from C/Java, you might expect cases to fall through. Go doesn't (unless you use `fallthrough`). Conversely, don't litter cases with `break` — it's redundant in Go and `golint`/reviewers will flag it.

**4. Map iteration order.**
```go
for k := range myMap {
    // order is random; don't depend on it
}
```
Fix: collect keys into a slice and `sort` them (see the map section above) when you need determinism — for stable test output, JSON serialization, or anything a human reads.

**5. Range loop variable capture.**

In Go versions before 1.22:
```go
for _, x := range items {
    go func() {
        fmt.Println(x)    // CAUTION: all goroutines might see same x
    }()
}
```

Pre-1.22 fix: `x := x` inside loop. Go 1.22+ fixed this automatically: each iteration now gets a **fresh** `x`, so the closure-capture and `&x`-aliasing bugs are gone for code declaring `go 1.22+` in `go.mod`. **But know your Go version** — the same loop behaves differently on 1.21 vs 1.22, which matters when reading old code or supporting old toolchains. Demonstration of the pre-1.22 trap and its portable fix:

```go
// Portable across all Go versions — explicitly shadow the loop variable.
for _, x := range items {
    x := x // makes a per-iteration copy; harmless on 1.22+, essential before it
    go func() {
        fmt.Println(x)
    }()
}
```

**6. Comparing against a non-`bool` condition.**
```go
n := 3
if n {              // ERROR: non-bool n (type int) used as if condition
    fmt.Println("nonzero")
}
```
Fix: Go has no truthiness — compare explicitly.
```go
if n != 0 {
    fmt.Println("nonzero")
}
```

**7. Assuming `break` inside a `switch` leaves the loop.**
It leaves the `switch`. To leave the surrounding loop, use a labeled `break` (see the `break` section). This is one of the top real-world Go surprises.

**8. Mutating the range copy and expecting the collection to change.**
```go
for _, v := range nums { v *= 2 } // no effect on nums
```
Fix: index back in — `for i := range nums { nums[i] *= 2 }`.

**9. `defer` inside a loop leaking resources.**
Each `defer` waits for the *function* to return, not the loop iteration. Refactor the loop body into a helper function (see the `defer` loop section).

---

## Cross-questions an interviewer or reviewer will ask

**Q: Why does Go have only `for` and no `while` / `do-while`?**
A: Minimalism and orthogonality. `for cond {}` already covers `while`, `for {}` plus a bottom check covers `do-while`, and `for init; cond; post {}` covers the C loop. One keyword means one thing to learn and one consistent shape to read. The designers explicitly favored a small spec.

**Q: Why must the opening brace be on the same line as `if`/`for`/`func`?**
A: Because of **automatic semicolon insertion**. The Go lexer inserts a `;` at the end of a line that ends in certain tokens. If you put `{` on the next line, a phantom `;` gets inserted after the condition, breaking the statement. Rather than make the rule conditional, Go just requires the brace on the same line — which is also why `gofmt` is unopinionated here: there's only one legal layout.

**Q: Why is `switch` in Go "safe by default" (no fall-through) when C falls through?**
A: Empirically, accidental fall-through in C caused real bugs, and the *intended* case (stop after one match) was the common one. Go inverts the defaults: the common, safe behavior is free; the rare behavior costs an explicit `fallthrough`. Fewer footguns.

**Q: Why is map iteration order randomized instead of just "insertion order" or "undefined but stable"?**
A: "Undefined but stable" is the worst of both worlds — programs accidentally depend on whatever order the implementation happens to produce, then break when the implementation or platform changes. Active randomization forces you to confront ordering up front, so portable code sorts keys explicitly. (Hash maps have no natural order anyway.)

**Q: Why does `defer` evaluate its arguments immediately instead of at call time?**
A: Predictability. The deferred call captures exactly the state present where you wrote the `defer`, which is usually what you want for logging "the value at this point" and for releasing the specific resource you just acquired. If you need lazy evaluation, wrap it in a closure — the language gives you both, explicitly.

**Q: `defer` adds overhead — should I avoid it in hot paths?**
A: Modern Go (1.14+) made common `defer` cases nearly free via "open-coded defers," so for the vast majority of code the readability and safety win. In a tight inner loop running millions of times, measure; if a profiler shows it, you may unroll the cleanup manually. But "don't use `defer`" is premature optimization in normal code.

**Q: Exceptions vs. `panic`/`recover` — aren't they the same?**
A: No, and the difference is cultural as much as technical. Exceptions in Java/Python are the *normal* error channel; Go's `error` interface is. `panic` is reserved for "the program is in a state it should never reach." Using `panic` for ordinary control flow fights the standard library, the tooling, and every Go reviewer. The rule of thumb: if a caller could plausibly handle it, return an `error`.

**Q: Why can't I `recover` a panic from another goroutine?**
A: A goroutine has its own stack; `recover` only inspects the deferred frames of the **current** goroutine's stack. A panic in a child goroutine unwinds *that* stack and, if uncaught, crashes the process. This is intentional pressure to handle errors inside each goroutine (recover at its top) rather than hoping a parent catches them.

**Q: `if err != nil` everywhere is verbose — is that a design flaw?**
A: It's a deliberate trade. Explicit checks make the error path visible at each call site (you can't forget a checked exception or swallow it invisibly), and the `if init; cond` form keeps the noise local. Go 1.13+ added error *wrapping* (`fmt.Errorf("...: %w", err)`) and `errors.Is`/`errors.As` to make the verbosity carry more value. You'll cover this in `04-functions.md`.

---

## Exercises

1. **Multiplication table**: print 1..10 × 1..10 grid.
2. **FizzBuzz**: 1-100, multiples of 3 print "Fizz", of 5 "Buzz", both "FizzBuzz".
3. **Sum of digits**: read int n, return sum of its digits. (Use `n / 10` and `n % 10`.)
4. **Largest of three**: read 3 ints, print largest. (`if/else` chain or `switch`.)
5. **Day of week**: read int 0-6, print day name. Use `switch`.
6. **Greatest common divisor**: implement Euclid's algorithm with `for`.
7. **Sorted map dump**: given `map[string]int`, print entries in key order. (Practice the sort-the-keys idiom.)
8. **Rune count vs byte count**: print both `len(s)` and the number of runes for `"héllo"` and `"日本語"`. Confirm they differ.
9. **Safe array access**: write `get(s []int, i int) (int, error)` that returns an error instead of panicking when `i` is out of range; then write a version that *recovers* from the panic and compare which you'd ship.
10. **Labeled break**: scan a 2-D grid `[][]int` for the first occurrence of a target value and stop scanning entirely once found, using a labeled `break`.

### Hint for #6:

```go
func gcd(a, b int) int {
    for b != 0 {
        a, b = b, a%b
    }
    return a
}
```

### Hint for #7:

```go
keys := make([]string, 0, len(m))
for k := range m {
    keys = append(keys, k)
}
sort.Strings(keys)
for _, k := range keys {
    fmt.Println(k, m[k])
}
```

### Hint for #8:

```go
s := "héllo"
runes := 0
for range s { // ranging a string counts runes, not bytes
    runes++
}
fmt.Println(len(s), runes) // 6 5
// (or simply: utf8.RuneCountInString(s))
```

---

## What to read next

**Doc 04** — Functions, including multiple returns and Go's error idiom (`if err != nil`, error wrapping with `%w`, `errors.Is`/`errors.As`). Everything you saw here with `defer`/`recover` and `if init; cond` pays off once functions can return errors.

```
→ Foundations/Programming/Go/04-functions.md
```

For deeper, authoritative background on the constructs in this doc:
- **A Tour of Go** — the official interactive intro: <https://go.dev/tour/flowcontrol/1> (covers `for`, `if`, `switch`, `defer`).
- **Effective Go** — the canonical style guide; see the "Control structures" section: <https://go.dev/doc/effective_go#control-structures>.
- **The Go Programming Language Specification** — for the exact rules on semicolon insertion, `fallthrough`, and `defer`/`panic`/`recover`: <https://go.dev/ref/spec>.
- **Go 1.22 release notes** (loop variable change) and **Go 1.23 release notes** (range-over-func iterators) — to understand version-dependent behavior you'll meet in real code.

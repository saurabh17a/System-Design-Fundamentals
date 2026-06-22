# 04 — Functions

> **Prerequisites:** `03-control-flow.md`.
> **Time to read:** 30 minutes.

---

## What is a function, in plain English?

A function is a **named, reusable block of work**. You give it some inputs, it does
something, and it (usually) hands you back a result. Think of it like a coffee machine:
you put in water and beans (the inputs), press a button (call the function), and get coffee
out (the return value). You don't have to know *how* it brews — you just use it. The whole
point is so you write the "how" **once** and reuse it everywhere by name.

In Go specifically:

- A function has a **signature**: its name, the types of its inputs (parameters), and the
  types of its outputs (return values). The signature is a contract — the compiler enforces it.
- Go is **statically typed**, so every parameter and every return value has a known type at
  compile time. If you call `add("hi", 5)` when `add` expects two `int`s, the program will
  **not even compile**. This catches a huge class of bugs before the program ever runs.
- Functions are **values** (more on this later): you can store them in variables, pass them
  to other functions, and return them. This is what people mean by "first-class functions."

The precise/technical version: a Go function is a typed callable whose type is
`func(paramTypes) returnTypes`. Arguments are **passed by value** — Go copies each argument
into the function's parameters. (For slices, maps, channels, pointers, and function values,
the *value* being copied is a small reference/header, which is why mutating their contents is
visible to the caller — see "Common mistakes #5".) Function calls get their own stack frame;
the Go runtime decides whether locals live on the stack or escape to the heap (escape analysis).

---

## Defining a function

```go
func add(a int, b int) int {
    return a + b
}

func main() {
    result := add(3, 5)
    fmt.Println(result)    // 8
}
```

Anatomy:
- `func` — keyword.
- `add` — name.
- `(a int, b int)` — parameters with types.
- `int` — return type.
- `{}` — body.

> **Why does Go put the type *after* the name (`a int`) instead of before (`int a`) like C/Java?**
> It reads left-to-right the same way you'd say it: "a, of type int." It also makes complex
> declarations (especially function types and slices) far easier to parse for both humans and
> the compiler. See *The Go Blog: "Go's Declaration Syntax"* for the full rationale.

### Parameter types can be combined

If consecutive parameters have the same type, declare once:

```go
func add(a, b int) int {     // both a and b are int
    return a + b
}
```

**Takeaway:** `(a, b int)` is shorthand for `(a int, b int)`. The type applies to all names
to its left up to the previous type.

### A function with no parameters and no return value

```go
package main

import "fmt"

func greet() {
    fmt.Println("hello")
}

func main() {
    greet()
}
```
Expected output:
```
hello
```
**Takeaway:** parameters and return values are both optional; the parentheses are not.

### A function used as an expression

```go
package main

import "fmt"

func square(x int) int { return x * x }

func main() {
    fmt.Println(square(4) + square(3))   // 16 + 9
}
```
Expected output:
```
25
```
**Takeaway:** a call to a function returning one value is an expression you can use inline.

---

## Multiple return values

A signature feature of Go.

```go
func minMax(nums []int) (int, int) {
    min, max := nums[0], nums[0]
    for _, n := range nums {
        if n < min { min = n }
        if n > max { max = n }
    }
    return min, max
}

func main() {
    lo, hi := minMax([]int{3, 1, 4, 1, 5, 9})
    fmt.Println(lo, hi)    // 1 9
}
```

**Plain English:** instead of forcing you to bundle two results into a struct or use
"out-parameters" (pointers you write into), Go just lets a function hand back several values
at once. The most common use by far is `(result, error)`.

### Discarding a return value with the blank identifier `_`

You must do *something* with every return value, but you can explicitly throw one away with `_`:

```go
package main

import "fmt"

func minMax(nums []int) (int, int) {
    min, max := nums[0], nums[0]
    for _, n := range nums {
        if n < min { min = n }
        if n > max { max = n }
    }
    return min, max
}

func main() {
    _, hi := minMax([]int{3, 1, 4, 1, 5, 9})  // ignore the min
    fmt.Println(hi)                            // 9
}
```
Expected output:
```
9
```
**Takeaway:** `_` is the blank identifier — it says "I'm deliberately ignoring this." It is the
only way to ignore a returned value; a plain unused variable is a compile error.

### Named return values

```go
func divmod(a, b int) (quotient, remainder int) {
    quotient = a / b
    remainder = a % b
    return    // "naked" return — uses named values
}
```

Less common; mostly used when documentation benefits.

**How it works:** naming the returns declares those variables (initialized to their zero value)
the moment the function starts. `return` with no arguments — a *naked return* — returns whatever
those named variables currently hold.

```go
package main

import "fmt"

func divmod(a, b int) (quotient, remainder int) {
    quotient = a / b
    remainder = a % b
    return
}

func main() {
    q, r := divmod(17, 5)
    fmt.Println(q, r)   // 3 2
}
```
Expected output:
```
3 2
```
**Takeaway:** named returns let you `return` with no arguments, but in long functions they hurt
readability — the reader has to scroll up to learn what's being returned.

> **When NOT to use naked returns:** in any function longer than a few lines. The Go team's own
> guidance (*Effective Go*, Google Go Style Guide) is to avoid naked `return` in long functions
> because the returned values become implicit and easy to get wrong. Their best, idiomatic use
> is pairing with `defer` to modify an error on the way out — see the deferred-error pattern below.

### Modifying a named return in a deferred function

This is the one place named returns genuinely shine:

```go
package main

import "fmt"

func safeDivide(a, b int) (result int, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("recovered: %v", r)
        }
    }()
    result = a / b   // panics if b == 0
    return
}

func main() {
    r, err := safeDivide(10, 0)
    fmt.Println(r, err)
}
```
Expected output:
```
0 recovered: runtime error: integer divide by zero
```
**Takeaway:** a deferred closure can read and *overwrite* named return values after the body
finishes — the idiomatic way to convert a panic into a returned error.

---

## Errors as return values (the Go idiom)

Go has no exceptions. Instead, functions that can fail return an `error` as the last value.

```go
import "errors"

func divide(a, b float64) (float64, error) {
    if b == 0 {
        return 0, errors.New("division by zero")
    }
    return a / b, nil
}

func main() {
    result, err := divide(10, 0)
    if err != nil {
        fmt.Println("error:", err)
        return
    }
    fmt.Println("result:", result)
}
```

You'll write `if err != nil { return err }` everywhere.

**Plain English:** `error` is just an interface with one method, `Error() string`. A function
that worked returns `nil` for the error; a function that failed returns a non-nil error
describing what went wrong. The caller checks `if err != nil` right after the call and decides
what to do. There is no hidden control flow (no `throw` jumping up the stack) — failure is an
ordinary value you pass around like any other.

The actual interface from the standard library:

```go
type error interface {
    Error() string
}
```

> **Why values instead of exceptions?** Three reasons the Go authors give:
> (1) failure paths are *visible in the signature* — you can't accidentally ignore that a
> function fails; (2) there's no invisible jump, so control flow is easy to follow;
> (3) errors are composable data — you can wrap, inspect, and route them with normal code.
> The cost is verbosity (`if err != nil` repeated), which Go accepts as a deliberate trade.

### Creating errors

```go
import (
    "errors"
    "fmt"
)

// Simple
err := errors.New("something failed")

// With formatting
err := fmt.Errorf("invalid input: %s", input)

// Wrapping (preserves chain)
err := fmt.Errorf("failed to save user: %w", innerErr)
```

`%w` wraps; it lets `errors.Is(err, innerErr)` return true. Important for diagnostics.

> **`%w` vs `%v` — what's the difference?** `%v` formats the inner error into the *string* only;
> the link to the original error is lost, so `errors.Is`/`errors.As` can't see through it.
> `%w` *wraps* — it keeps a real reference to the inner error so the chain can be unwrapped later.
> Use `%w` when callers may want to inspect the cause; use `%v` when you only want a message.
> You may use `%w` more than once in a single `fmt.Errorf` (Go 1.20+) to wrap multiple errors.

### Sentinel errors

```go
var ErrNotFound = errors.New("not found")

func findUser(id string) (*User, error) {
    if !exists(id) {
        return nil, ErrNotFound
    }
    return load(id), nil
}

// Caller
user, err := findUser("alice")
if errors.Is(err, ErrNotFound) {
    fmt.Println("no such user")
}
```

`errors.Is` walks the wrap chain. `errors.As` extracts a typed error.

**Plain English:** a *sentinel* is a single, package-level error value you compare against — like
a known signpost ("not found"). `errors.Is(err, ErrNotFound)` answers "is `ErrNotFound`
*anywhere* in this error's chain?" even if it was wrapped with `%w` several layers deep.

### `errors.As` — extracting a typed error to read its fields

`errors.Is` answers "is this *that specific* error?". `errors.As` answers "is there an error of
*this type* in the chain, and if so, give it to me so I can read its fields."

```go
package main

import (
    "errors"
    "fmt"
)

type ValidationError struct {
    Field string
    Msg   string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("%s: %s", e.Field, e.Msg)
}

func validate() error {
    return fmt.Errorf("request failed: %w",
        &ValidationError{Field: "age", Msg: "must be positive"})
}

func main() {
    err := validate()

    var ve *ValidationError
    if errors.As(err, &ve) {       // note: pointer to the target
        fmt.Println("bad field:", ve.Field)   // can read the struct's fields
    }
}
```
Expected output:
```
bad field: age
```
**Takeaway:** use `errors.Is` to match a *known value*, `errors.As` to match a *type* and unwrap
it into a variable. `errors.As` takes a **pointer to** the target variable.

> **When NOT to use sentinel errors:** when callers will need details (a field name, an HTTP
> status, a row count). A bare sentinel carries only its message. Prefer a custom error *type*
> (matched with `errors.As`) when there's structured data to surface. Reserve sentinels for
> simple, stable "did exactly *this* happen?" checks like `io.EOF` or `sql.ErrNoRows`.

---

## Variadic functions

Accept any number of arguments of one type:

```go
func sum(nums ...int) int {
    total := 0
    for _, n := range nums {
        total += n
    }
    return total
}

func main() {
    fmt.Println(sum(1, 2))           // 3
    fmt.Println(sum(1, 2, 3, 4, 5))  // 15

    // Pass a slice with ...
    nums := []int{10, 20, 30}
    fmt.Println(sum(nums...))         // 60
}
```

`fmt.Println` is variadic — that's why it accepts any number of args.

**Plain English:** the `...` means "zero or more of these." Inside the function, the variadic
parameter is just a **slice** (`nums` is a `[]int`). When you already have a slice and want to
feed it in, "spread" it with `slice...`.

### Gotcha: variadic of a single type vs `...interface{}`

```go
package main

import "fmt"

func sum(nums ...int) int {
    total := 0
    for _, n := range nums {
        total += n
    }
    return total
}

func main() {
    fmt.Println(sum())   // 0 — zero arguments is valid; nums is an empty slice
}
```
Expected output:
```
0
```
**Takeaway:** calling a variadic function with no arguments is legal — the parameter is just an
empty (`len == 0`, `nil`) slice. The variadic parameter must be **last** in the signature.

### Gotcha: you cannot mix spread and explicit args

```go
nums := []int{10, 20, 30}
// fmt.Println(sum(5, nums...))   // ❌ compile error: too many arguments
```
**The fix:** either pass all values individually (`sum(5, 10, 20, 30)`) or build one slice first
and spread that (`sum(append([]int{5}, nums...)...)`). You can use `slice...` *or* loose args,
never both in the same call.

> **When NOT to make a function variadic:** when the number of arguments is fixed and meaningful
> (e.g. `rect(width, height int)`). Variadics hide arity and can mask bugs (`sum()` silently does
> nothing). Use them for genuinely open-ended lists like `fmt.Println`, `append`, or `min`/`max`.

---

## Functions as values (first-class)

```go
func add(a, b int) int { return a + b }
func sub(a, b int) int { return a - b }

func main() {
    var op func(int, int) int    // function variable

    op = add
    fmt.Println(op(3, 5))    // 8

    op = sub
    fmt.Println(op(10, 4))   // 6
}
```

Functions can be passed as arguments:

```go
func apply(fn func(int) int, numbers []int) []int {
    result := make([]int, len(numbers))
    for i, n := range numbers {
        result[i] = fn(n)
    }
    return result
}

square := func(x int) int { return x * x }
fmt.Println(apply(square, []int{1, 2, 3, 4}))   // [1 4 9 16]
```

`func(x int) int { ... }` is an **anonymous function** (no name). Useful for one-off use.

**Plain English:** "first-class" means a function is just another value, like an `int` or a
`string`. You can put it in a variable (`op`), pass it into another function (`apply`), store it
in a slice or map, and return it. A function that takes or returns another function is a
**higher-order function** (`apply` above).

### The zero value of a function is `nil` — calling it panics

```go
package main

import "fmt"

func main() {
    var op func(int, int) int   // declared but never assigned
    fmt.Println(op == nil)      // true
    op(1, 2)                    // panic: nil pointer / runtime error
}
```
Expected output:
```
true
panic: runtime error: invalid memory address or nil pointer dereference
```
**Takeaway:** an unassigned function variable is `nil`. Guard with `if fn != nil` before calling
function values that might not be set (e.g. optional callbacks/hooks).

### Function types can be named for readability

```go
package main

import "fmt"

type BinOp func(int, int) int   // a named function type

func reduce(nums []int, init int, op BinOp) int {
    acc := init
    for _, n := range nums {
        acc = op(acc, n)
    }
    return acc
}

func main() {
    add := func(a, b int) int { return a + b }
    fmt.Println(reduce([]int{1, 2, 3, 4}, 0, add))   // 10
}
```
Expected output:
```
10
```
**Takeaway:** `type BinOp func(int, int) int` gives a long signature a name, making higher-order
APIs (like `http.HandlerFunc` in the standard library) self-documenting.

---

## Closures

A function that captures variables from its surrounding scope.

```go
func makeCounter() func() int {
    count := 0
    return func() int {
        count++
        return count
    }
}

func main() {
    c := makeCounter()
    fmt.Println(c())    // 1
    fmt.Println(c())    // 2
    fmt.Println(c())    // 3

    c2 := makeCounter()
    fmt.Println(c2())   // 1 (separate state)
}
```

Each call to `makeCounter` returns a fresh closure with its own `count`.

Closures are useful for:
- State that's private to a function.
- Configuration: build a customized handler.
- Decorators / wrappers.

**Plain English:** a closure "closes over" the variables that were in scope where it was created
— it keeps them alive and *shares* them, even after the outer function has returned. `count`
isn't copied into the inner function; the inner function holds a live reference to the very same
`count`, which is why it survives and increments across calls.

### The classic loop-variable closure bug

This is one of the most famous Go gotchas. **The behavior depends on your Go version.**

```go
// Behavior in Go 1.21 and EARLIER (the bug):
package main

import "fmt"

func main() {
    funcs := []func(){}
    for i := 0; i < 3; i++ {
        funcs = append(funcs, func() { fmt.Print(i, " ") })
    }
    for _, f := range funcs {
        f()
    }
}
```
Output on **Go ≤ 1.21**:
```
3 3 3
```
Why: before Go 1.22 there was **one** `i` shared by every iteration. All three closures captured
*the same* variable, and by the time they ran the loop had finished with `i == 3`.

**The classic fix (works on every Go version)** — shadow the variable inside the loop so each
iteration gets its own copy:

```go
for i := 0; i < 3; i++ {
    i := i   // new variable, scoped to this iteration
    funcs = append(funcs, func() { fmt.Print(i, " ") })
}
// prints: 0 1 2
```

**Go 1.22+ change:** as of Go 1.22 the loop variable is **per-iteration** by default, so the
*original* (unshadowed) code now prints `0 1 2`. This kb assumes you may run older code, so the
`i := i` idiom remains the safe, version-independent habit — and it's harmless on 1.22+.

**Takeaway:** closures capture variables *by reference*, not by value. If you capture a loop
variable on Go ≤ 1.21, shadow it (`i := i`) so each closure gets its own copy.

### A small useful closure: a memoized function

```go
package main

import "fmt"

func makeMemoizedSquare() func(int) int {
    cache := map[int]int{}
    return func(n int) int {
        if v, ok := cache[n]; ok {
            return v          // cached
        }
        v := n * n
        cache[n] = v
        return v
    }
}

func main() {
    sq := makeMemoizedSquare()
    fmt.Println(sq(4))   // 16 (computed)
    fmt.Println(sq(4))   // 16 (from cache)
}
```
Expected output:
```
16
16
```
**Takeaway:** the captured `cache` map gives the returned function private, persistent state —
a tiny memoizer with no globals and no struct.

> **When NOT to reach for a closure:** when the captured state is large, long-lived, or shared
> across goroutines. Closures keep captured variables alive (preventing garbage collection) and
> offer no synchronization — concurrent calls to a closure mutating a shared map (like the one
> above) will race. For shared mutable state across goroutines, use a struct with a `sync.Mutex`
> instead.

---

## Defer (already covered in `03-`)

```go
func saveUser(u User) error {
    f, err := os.Create("users.txt")
    if err != nil {
        return err
    }
    defer f.Close()    // ensures close even on error

    // ... work with f ...
    return nil
}
```

### Quick refresher: order and argument evaluation

Two rules trip people up, so here they are with runnable proof:

```go
package main

import "fmt"

func main() {
    // 1) Deferred calls run in LIFO (last-in, first-out) order.
    for i := 0; i < 3; i++ {
        defer fmt.Print(i, " ")
    }
    // 2) Arguments to a deferred call are evaluated NOW, not at run time.
    x := 10
    defer fmt.Println("\ndeferred saw x =", x) // captures 10
    x = 99
    fmt.Println("end of main, x =", x)
}
```
Expected output:
```
end of main, x = 99
deferred saw x = 10
2 1 0 
```
**Takeaway:** `defer` arguments are snapshotted at the `defer` statement; the calls fire in
reverse order as the function returns. (To capture a *later* value, defer a closure with no
args, which reads the variable when it runs.)

---

## A larger example: error handling

```go
package main

import (
    "errors"
    "fmt"
    "strconv"
)

var ErrInvalidInput = errors.New("invalid input")

func parseAge(s string) (int, error) {
    age, err := strconv.Atoi(s)
    if err != nil {
        return 0, fmt.Errorf("parsing age: %w", err)
    }
    if age < 0 || age > 150 {
        return 0, fmt.Errorf("age %d: %w", age, ErrInvalidInput)
    }
    return age, nil
}

func main() {
    for _, s := range []string{"30", "abc", "-5", "999"} {
        age, err := parseAge(s)
        if err != nil {
            if errors.Is(err, ErrInvalidInput) {
                fmt.Printf("input rejected: %s\n", err)
            } else {
                fmt.Printf("parse error: %s\n", err)
            }
            continue
        }
        fmt.Printf("ok: %d\n", age)
    }
}
```

Output:
```
ok: 30
parse error: parsing age: strconv.Atoi: parsing "abc": invalid syntax
input rejected: age -5: invalid input
input rejected: age 999: invalid input
```

This is the typical Go error pattern: wrap with context (`fmt.Errorf("parsing age: %w", err)`), then unwrap at decision points.

---

## Idioms and best practices

A consolidated checklist drawn from *Effective Go* and the Google Go Style Guide:

- **Return early.** Handle the error and `return`, keeping the happy path un-indented at the
  left margin. Avoid deep `else` nesting.
  ```go
  // idiomatic
  f, err := os.Open(name)
  if err != nil {
      return err
  }
  defer f.Close()
  // ... use f at indentation level 1 ...
  ```
- **`error` is always the last return value**, named or not. Callers expect `(value, error)`.
- **Don't start error strings with a capital letter or end with punctuation.** They get wrapped:
  `failed to read config: open foo: no such file` reads correctly only if each piece is lowercase
  and un-punctuated. (`go vet` warns about this.)
- **Add context when wrapping, not when creating.** The lowest layer says *what* failed
  (`open foo: ...`); each layer up adds *what it was doing* (`loading config: ...`).
- **Accept interfaces, return concrete types.** A function that reads should take an `io.Reader`,
  not a `*os.File`, so callers can pass anything readable.
- **Keep functions short and single-purpose.** If you need the word "and" to describe what it
  does, it's probably two functions.
- **Exported (capitalized) functions need doc comments**; unexported ones usually don't unless
  subtle. See "Documenting functions" below.
- **Prefer multiple return values over out-parameters.** Go has no `&out int` style; return the
  value instead.

---

## Cross-questions an interviewer or reviewer will ask

**Q: Is Go pass-by-value or pass-by-reference?**
Always pass-by-value — Go copies every argument. The confusion is that slices, maps, channels,
and pointers are *small values that point at shared backing data*. Copying the slice header
still lets the function mutate the underlying array (see Common Mistakes #5). To mutate a *plain*
value (an `int`, a `struct`) the caller holds, pass a pointer to it.

**Q: Why does Go return errors instead of throwing exceptions?**
Failure becomes an ordinary, visible value in the signature; there's no hidden non-local jump;
errors compose with normal code (wrap, `errors.Is`, `errors.As`). The trade-off is verbosity.
`panic`/`recover` exist but are reserved for truly unrecoverable situations (programmer bugs),
not for ordinary error flow.

**Q: `errors.Is` vs `errors.As` — when each?**
`errors.Is(err, target)` for matching a specific *sentinel value* (`io.EOF`, `ErrNotFound`).
`errors.As(err, &target)` for matching a *type* and pulling it out so you can read its fields.

**Q: Do closures capture by value or by reference?**
By reference — they share the actual variable. That's the source of the loop-variable bug on
Go ≤ 1.21 and the power behind `makeCounter`.

**Q: What's the zero value of a function type, and what happens if you call it?**
`nil`. Calling a nil function panics with a nil pointer dereference. Guard optional callbacks.

**Q: When would you use named return values?**
Rarely for their own sake; their best use is letting a deferred closure modify the returned
`error` (e.g. converting a panic to an error). Avoid naked returns in long functions.

**Q: Can a method satisfy a function type / can a function satisfy an interface?**
A method value (`obj.Method`) is a function value and can be assigned to a matching `func` type.
And via adapter types like `http.HandlerFunc`, a plain function can satisfy an interface that has
one method. This is a common Go pattern for callbacks.

**Q: Is there recursion? Tail-call optimization?**
Yes, recursion works. No, Go does **not** guarantee tail-call optimization — deep recursion can
overflow the (growable, but bounded) goroutine stack. Prefer iteration for unbounded depth.

---

## Common mistakes

**1. Ignoring errors.**
```go
result, _ := someThing()    // tossing the error
```

Sometimes legitimate (e.g. `_ = file.Close()` because there's nothing to do). Usually a mistake.

**2. Returning before deferred cleanup.**
```go
f, _ := os.Open("x")
data, err := readAll(f)
if err != nil {
    return err
}
f.Close()    // unreachable if err != nil!
```

Use `defer f.Close()` so it always runs.

**3. Not checking error at the right spot.**
```go
data, err := fetch()
process(data)            // BUG: process before err check
if err != nil {
    return err
}
```

Always check `err != nil` immediately.

**4. Returning typed nil through interface.**

This is a famous Go gotcha:

```go
type MyError struct{ msg string }
func (e *MyError) Error() string { return e.msg }

func doSomething() error {
    var e *MyError = nil
    return e            // returns "nil" but interface is NOT nil
}

func main() {
    err := doSomething()
    fmt.Println(err == nil)    // false!
}
```

Returning a typed nil through an interface makes the interface non-nil. Best practice: return literal `nil`, not a typed nil pointer.

**Why it happens (the precise version):** an interface value is a pair `(type, value)`. It is
`nil` only when *both* halves are nil. Returning a `(*MyError)(nil)` fills the type half with
`*MyError`, so the interface is `(*MyError, nil)` — not nil. The fix is to return the untyped
`nil` directly:
```go
func doSomething() error {
    return nil          // ✓ interface is truly nil
}
// or, if you have a *MyError variable:
func doSomething() error {
    var e *MyError = computeMaybe()
    if e == nil {
        return nil      // ✓ collapse the typed nil to a real nil
    }
    return e
}
```

**5. Modifying caller's data unintentionally.**
Slices and maps are reference-like. Modifying inside a function affects the caller.

```go
func zero(nums []int) {
    for i := range nums {
        nums[i] = 0
    }
}

x := []int{1, 2, 3}
zero(x)
fmt.Println(x)    // [0 0 0]
```

This is sometimes desired, sometimes not. Be aware.

**The fix when you want isolation** — copy first:
```go
func zeroCopy(nums []int) []int {
    out := make([]int, len(nums))
    copy(out, nums)          // work on a copy
    for i := range out {
        out[i] = 0
    }
    return out
}
```
**Takeaway:** appending inside a function can *also* surprise the caller (or fail to): a function
that `append`s to a slice argument may grow a new backing array, leaving the caller's slice
unchanged in length. When in doubt about ownership, document it or return the new slice.

**6. Passing a big struct by value when you meant to mutate it.**
```go
type Account struct{ Balance int }

func deposit(a Account, amt int) { a.Balance += amt }  // mutates a COPY

func main() {
    acc := Account{Balance: 100}
    deposit(acc, 50)
    fmt.Println(acc.Balance)   // 100, not 150!
}
```
**The fix:** take a pointer when you intend to mutate the caller's value:
```go
func deposit(a *Account, amt int) { a.Balance += amt }
// deposit(&acc, 50) -> acc.Balance is now 150
```
**Takeaway:** plain structs are copied on call. Use a `*T` receiver/parameter to mutate the
original (and to avoid copying large structs).

**7. Forgetting that `defer` arguments are evaluated immediately.**
```go
func log(start time.Time) {
    defer fmt.Println("took", time.Since(start)) // time.Since runs NOW, ~0
    // ... work ...
}
```
**The fix:** defer a closure so the expensive/time-sensitive call runs at return:
```go
defer func() { fmt.Println("took", time.Since(start)) }()
```

---

## Documenting functions

```go
// Add returns the sum of two integers.
//
// If the result overflows int64, behavior is undefined.
func Add(a, b int64) int64 {
    return a + b
}
```

Comments above an exported function (capitalized) are picked up by `go doc` and documentation tools. Keep them brief and useful.

**Convention details that `go doc` and reviewers expect:**
- The comment **starts with the function's name** ("Add returns…") so generated docs read as
  full sentences.
- It describes *what* the function does and any *contract* (preconditions, what error values it
  may return), not *how* it's implemented.
- Run `go doc ./... ` or `go doc pkg.Add` locally to see exactly what users will read.

```go
// ParseAge converts s to an age in [0,150].
//
// It returns ErrInvalidInput (wrapped) if the number is out of range,
// or a wrapped strconv error if s is not a valid integer.
func ParseAge(s string) (int, error) { /* ... */ }
```
**Takeaway:** good doc comments name the function, state the contract, and name the error values
callers can match on.

---

## Exercises

1. **`maxOfThree`**: returns the largest of three integers.
2. **`isPrime`**: returns `bool` for whether n is prime.
3. **`split` & `join` ints**: `split` takes "1,2,3" returns `[]int{1,2,3}` (handle errors). `join` does reverse.
4. **`retry(fn, attempts)`**: takes `func() error`; calls until success or attempts exhausted; returns last error.
5. **`compose(f, g)`**: returns `func(x int) int { return f(g(x)) }`.
6. **`makeAccumulator()`**: returns a closure that accumulates and returns the sum:
   ```go
   acc := makeAccumulator()
   acc(5)   // 5
   acc(3)   // 8
   acc(10)  // 18
   ```
7. **`mustParse(s string) int`**: wraps `strconv.Atoi`, and `panic`s on error. Then write a
   `safeParse` that uses `recover` (and a named return) to turn that panic back into
   `(int, error)`. Goal: practice the panic↔error boundary.
8. **`onlyEven(nums ...int) []int`**: a variadic filter returning just the even numbers. Verify
   `onlyEven()` returns an empty (or `nil`) slice without panicking.

### Hint for #4:

```go
func retry(fn func() error, attempts int) error {
    var lastErr error
    for i := 0; i < attempts; i++ {
        if err := fn(); err == nil {
            return nil
        } else {
            lastErr = err
        }
    }
    return lastErr
}
```

### Hint for #5 (compose, with named function type):

```go
type IntFn func(int) int

func compose(f, g IntFn) IntFn {
    return func(x int) int { return f(g(x)) }
}
// compose(square, inc)(3) == square(inc(3)) == square(4) == 16
```

---

## What to read next

- **Doc 05** in this track — Collections: arrays, slices, maps (deepens the pass-by-value /
  reference-semantics ideas raised in Common Mistakes #5).
- **The Go Blog: "Errors are values"** and **"Working with Errors in Go 1.13"** — the canonical
  explanation of `%w`, `errors.Is`, and `errors.As`.
- **Effective Go → "Functions"** and the **Google Go Style Guide → "Errors"** — idioms this
  doc summarizes, with more examples.
- **Go 1.22 release notes → loop variable scoping** — the official word on the closure/loop fix.

```
→ Foundations/Programming/Go/05-collections.md
```

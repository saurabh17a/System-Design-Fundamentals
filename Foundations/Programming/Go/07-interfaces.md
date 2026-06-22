# 07 — Interfaces

> **Prerequisites:** `06-structs-and-methods.md`.
> **Time to read:** 30 minutes.

Interfaces are Go's main tool for **polymorphism** — different types behaving like the same thing. They're simpler than Java's interfaces but more powerful than they look.

---

## The 60-second plain-English version

Imagine a wall socket. The socket doesn't care whether you plug in a lamp, a phone charger, or a toaster. It only cares about **one thing**: does your plug have the right shape? If the plug fits, it works. The socket never asks "are you a lamp?" — it asks "can you fit this shape?"

A Go interface is exactly that socket. It says: *"I don't care what type you are. I only care that you have these specific methods."* Any type that happens to have the right methods can be "plugged in" — and you never had to declare "this lamp is socket-compatible." It just fits, automatically.

That last word — **automatically** — is the whole trick. In Java or C# you write `class Dog implements Speaker`. In Go you write nothing. If `Dog` has the methods `Speaker` lists, then `Dog` already *is* a `Speaker`. The compiler figures it out for you.

**The precise version:** An interface type is a set of method signatures. A value of an interface type can hold any concrete value whose type defines **all** of those methods (with exactly matching names and signatures). Satisfaction is checked **structurally** at compile time, not declared. At runtime, an interface value is a two-word pair: `(type, value)` — a pointer to type information plus a pointer to the underlying data.

Why does Go bother with this instead of just calling methods directly? Because it lets you write a function **once** that works with types that don't exist yet — including types written by other people in other packages who never imported your code. That is the superpower the rest of this doc unpacks.

---

## What is an interface?

An interface is a **contract**: a list of methods. Any type that has those methods *implements* the interface — automatically. No `implements` keyword needed.

```go
type Speaker interface {
    Speak() string
}

type Dog struct{ Name string }
func (d Dog) Speak() string { return "Woof from " + d.Name }

type Cat struct{ Name string }
func (c Cat) Speak() string { return "Meow from " + c.Name }

func main() {
    speakers := []Speaker{
        Dog{Name: "Rex"},
        Cat{Name: "Whiskers"},
    }
    for _, s := range speakers {
        fmt.Println(s.Speak())
    }
}
```

Output:
```
Woof from Rex
Meow from Whiskers
```

`Dog` and `Cat` both implement `Speaker` because they both have a `Speak() string` method.

This is **structural / duck typing**: "if it walks like a duck and quacks like a duck, it's a duck."

> **Takeaway:** A slice of an interface type can hold values of many different concrete types, and the loop calls the right method for each.

### A tiny end-to-end runnable example

The snippet above omits the `package`/`import` boilerplate to stay focused. Here is the complete, copy-paste-and-run version so you can see it work today:

```go
package main

import "fmt"

type Speaker interface {
    Speak() string
}

type Dog struct{ Name string }

func (d Dog) Speak() string { return "Woof from " + d.Name }

func main() {
    var s Speaker = Dog{Name: "Rex"}
    fmt.Println(s.Speak())
}
```

Output:
```
Woof from Rex
```

> **Takeaway:** `var s Speaker = Dog{...}` is the moment a concrete `Dog` is "boxed" into an interface value — from now on you can only call methods the `Speaker` contract lists.

---

## Why interfaces matter

Functions can take interfaces, accepting any type that satisfies them:

```go
func announce(s Speaker) {
    fmt.Println("Announcement:", s.Speak())
}

announce(Dog{Name: "Rex"})    // works
announce(Cat{Name: "Whiskers"})    // works
```

Add a new type without changing `announce`:

```go
type Robot struct{ ID int }
func (r Robot) Speak() string { return fmt.Sprintf("Robot %d beeping", r.ID) }

announce(Robot{ID: 7})    // works! No change to announce.
```

This is the **open/closed principle** — open for extension, closed for modification.

### The "before interfaces" version, so you feel the pain it removes

Without interfaces, `announce` would need to know every concrete type up front, and you'd extend it with a type switch or overloads that you must edit every time a new type appears:

```go
// Painful: announce must change every time a new speaker is added.
func announceConcrete(kind string, dog Dog, cat Cat) {
    switch kind {
    case "dog":
        fmt.Println(dog.Speak())
    case "cat":
        fmt.Println(cat.Speak())
    // add a new case here for every new type, forever...
    }
}
```

The interface version never grows. The *caller* picks the concrete type; the function stays frozen. That stability is exactly what lets large codebases (and the standard library) accept community-written types they've never heard of.

> **Takeaway:** Interfaces move the "which type is this?" decision from inside your function to the caller, so your function never has to change when new types appear.

---

## Built-in interfaces you'll see everywhere

### `error`

```go
type error interface {
    Error() string
}
```

Any type with an `Error() string` method is an `error`. That's why `errors.New("...")` works — its return type implements `error`.

Here's a complete custom-error example you can run, which also previews exercise #3:

```go
package main

import "fmt"

type ValidationError struct {
    Field string
    Code  int
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("field %q failed validation (code %d)", e.Field, e.Code)
}

func validate(name string) error {
    if name == "" {
        return &ValidationError{Field: "name", Code: 422}
    }
    return nil
}

func main() {
    err := validate("")
    if err != nil {
        fmt.Println(err) // fmt prints err.Error() automatically
    }
}
```

Output:
```
field "name" failed validation (code 422)
```

> **Takeaway:** `error` is just an ordinary interface; you create custom errors by giving a struct an `Error() string` method, and `fmt` calls it for you.

### `Stringer` — for `fmt.Println`

```go
type Stringer interface {
    String() string
}
```

```go
type IPAddress struct {
    A, B, C, D byte
}

func (ip IPAddress) String() string {
    return fmt.Sprintf("%d.%d.%d.%d", ip.A, ip.B, ip.C, ip.D)
}

ip := IPAddress{192, 168, 1, 1}
fmt.Println(ip)    // 192.168.1.1
```

How does `fmt.Println` know to call `String()`? Internally it does a type assertion: `if sv, ok := arg.(fmt.Stringer); ok { use sv.String() }`. If your type satisfies `Stringer`, you get pretty output; if not, you get the default `{192 168 1 1}` struct dump. This is duck typing in the standard library.

> **Takeaway:** Implementing `String() string` changes how your type prints everywhere `fmt` is used — one method, global effect.

### `io.Reader` and `io.Writer`

```go
type Reader interface {
    Read(p []byte) (n int, err error)
}

type Writer interface {
    Write(p []byte) (n int, err error)
}
```

These are foundational. Files, network connections, byte buffers — all implement these. Functions like `io.Copy(dst Writer, src Reader)` work for any pair.

Because so many types share these two tiny interfaces, you can wire wildly different things together. Here `strings.NewReader` (an in-memory string) is copied straight into `os.Stdout` (the terminal), with no code that knows about either concrete type:

```go
package main

import (
    "io"
    "os"
    "strings"
)

func main() {
    src := strings.NewReader("hello, io.Copy\n") // satisfies io.Reader
    // os.Stdout satisfies io.Writer
    io.Copy(os.Stdout, src)
}
```

Output:
```
hello, io.Copy
```

> **Takeaway:** Two one-method interfaces (`Reader`, `Writer`) let files, sockets, buffers, and strings all plug into the same plumbing — this is why Go's I/O composes so cleanly.

### `sort.Interface`

```go
type Interface interface {
    Len() int
    Less(i, j int) bool
    Swap(i, j int)
}
```

Implement these 3 methods on any type, and `sort.Sort` works. (For most uses, `sort.Slice` is easier.)

```go
package main

import (
    "fmt"
    "sort"
)

type ByLength []string

func (s ByLength) Len() int           { return len(s) }
func (s ByLength) Less(i, j int) bool { return len(s[i]) < len(s[j]) }
func (s ByLength) Swap(i, j int)      { s[i], s[j] = s[j], s[i] }

func main() {
    words := ByLength{"banana", "kiwi", "fig"}
    sort.Sort(words)
    fmt.Println(words)
}
```

Output:
```
[fig kiwi banana]
```

> **Takeaway:** `sort.Sort` doesn't know about strings — it only knows the three methods, so you can sort by any rule (length here) by defining a named slice type.

---

## Interface composition

Interfaces can embed other interfaces:

```go
type Reader interface {
    Read(p []byte) (n int, err error)
}

type Writer interface {
    Write(p []byte) (n int, err error)
}

// ReadWriter is both
type ReadWriter interface {
    Reader
    Writer
}
```

Anything implementing both becomes a `ReadWriter`.

Composition is how the standard library builds up its I/O vocabulary: `io.ReadWriter`, `io.ReadCloser`, `io.ReadWriteCloser` are all just embeddings of `Reader`, `Writer`, and `Closer`. There is no inheritance — embedding an interface simply **unions its method set** into the new one. A type satisfies `ReadWriter` exactly when it satisfies `Reader` *and* `Writer`, nothing more.

> **Takeaway:** Build big interfaces by embedding small ones; the result is just the union of their methods — no class hierarchy, no surprises.

---

## The empty interface — `interface{}` (or `any`)

`interface{}` (Go 1.18+: `any`) has no methods, so any type satisfies it. Used when you need to accept "anything":

```go
func describe(x any) {
    fmt.Printf("Value: %v, Type: %T\n", x, x)
}

describe(42)         // Value: 42, Type: int
describe("hello")    // Value: hello, Type: string
describe(3.14)       // Value: 3.14, Type: float64
```

**Use sparingly.** You lose type safety. Generics (Go 1.18+) are usually better.

### Why `any` is a footgun: the empty interface buys you nothing back

When you put a value into an `any`, you must take it back out (with a type assertion or type switch) before you can do anything useful with it. The compiler can no longer check your work, so mistakes surface at **runtime** as panics instead of at **compile time** as errors.

```go
// Fragile: caller can pass anything, and the bug is only found at runtime.
func double(x any) int {
    return x.(int) * 2 // panics if x is a string
}
```

Compare with generics, which keep type safety:

```go
// Safe: the compiler enforces that T is a number.
func Double[T int | int64 | float64](x T) T {
    return x * 2
}
```

> **Takeaway:** Reach for `any` only at true boundaries (logging, `fmt`, JSON decoding into unknown shapes); for "works on several known types," use generics so the compiler keeps protecting you.

---

## Type assertions

If you have an interface value and want to access concrete type:

```go
var x any = "hello"

s, ok := x.(string)    // type assertion
if ok {
    fmt.Println(strings.ToUpper(s))    // HELLO
}
```

Without `ok`:
```go
s := x.(string)        // PANIC if not actually a string
```

Use the `ok` form unless you're sure.

You can also assert that a value satisfies **another interface**, not just a concrete type. This is how optional behaviors are detected at runtime:

```go
package main

import "fmt"

type Closer interface{ Close() error }

func cleanup(x any) {
    if c, ok := x.(Closer); ok {
        c.Close() // only call Close if the value actually has it
        fmt.Println("closed")
    } else {
        fmt.Println("nothing to close")
    }
}
```

> **Takeaway:** A two-value assertion `v, ok := x.(T)` is the safe form and never panics; the single-value form panics on mismatch, so reserve it for cases you've already guaranteed.

### Type switch

```go
func describe(x any) {
    switch v := x.(type) {
    case int:
        fmt.Println("int:", v*2)
    case string:
        fmt.Println("string:", strings.ToUpper(v))
    case []int:
        fmt.Println("ints:", v)
    default:
        fmt.Println("unknown")
    }
}
```

A subtle but important detail: inside each `case`, the variable `v` has the **specific** type of that case (so `v*2` is legal in `case int`). In the `default` (and in any multi-type case like `case int, int64:`), `v` keeps the original interface type, because the compiler can't pick one concrete type for you.

> **Takeaway:** `switch v := x.(type)` re-types `v` per branch, letting you write type-specific code without a cascade of `if v, ok := ...` assertions.

---

## Designing with interfaces — small is better

Java/C# interfaces tend to be huge: `Iterable`, `Collection`, `List` etc. Go style: **interfaces should be small, ideally one method.**

Good Go interfaces:
- `Stringer` (1 method)
- `Reader` (1 method)
- `error` (1 method)
- `Sorter`, `Comparator` (1 method)

When you have 1-method interfaces, it's easy for ANY type to satisfy them.

### "The bigger the interface, the weaker the abstraction" — Rob Pike

```go
// BAD: forces implementers to provide everything
type AnimalDoer interface {
    Eat()
    Sleep()
    Speak()
    Walk()
    Swim()
    Fly()
}

// BETTER: separate concerns
type Speaker interface { Speak() }
type Mover interface { Move() }
```

A type only needs to satisfy what's relevant.

### Accept interfaces, return structs

A widely-followed Go idiom: **functions should accept interface types as parameters but return concrete types.**

```go
// Good: flexible input, precise output.
func NewBuffer(r io.Reader) *bytes.Buffer { /* ... */ }
```

- **Accept interfaces** so callers can pass anything that fits — maximum flexibility.
- **Return concrete types** so callers get the full set of methods and fields, and can decide for themselves which interface (if any) to store the result in. Returning an interface prematurely hides capabilities and forces awkward type assertions later.

The exception is the `error` return value, which is conventionally the `error` interface precisely so any error implementation can flow through.

> **Takeaway:** "Accept interfaces, return structs" maximizes both caller flexibility and callee usefulness — the one routine exception is returning `error`.

### Define the interface on the *consumer* side, not the producer side

In Go, the package that **uses** a behavior usually declares the interface, and the package that **provides** the type does not even import it. This is the inverse of Java.

```go
// package report (the CONSUMER) declares exactly what it needs:
package report

type Store interface {
    Get(id string) (Record, error)
}

func Build(s Store) { /* uses only Get */ }
```

The `postgres` package that has a `Get` method never imports `report` and never says "implements Store" — yet a `*postgres.DB` satisfies `report.Store` for free. Each consumer can declare its **own** minimal interface, asking for only the methods it actually calls.

> **Takeaway:** Put interfaces where they're consumed; this keeps them tiny, decouples packages, and avoids one bloated "god interface" shared by everyone.

---

## Interfaces and dependency injection

This is the killer use case.

```go
// In your library:

type Logger interface {
    Log(msg string)
}

type App struct {
    log Logger    // depends on the INTERFACE, not concrete type
}

func (a *App) DoStuff() {
    a.log.Log("did stuff")
}
```

In tests:
```go
type FakeLogger struct{ messages []string }
func (f *FakeLogger) Log(msg string) { f.messages = append(f.messages, msg) }

func TestApp(t *testing.T) {
    fake := &FakeLogger{}
    app := &App{log: fake}
    app.DoStuff()
    // assert fake.messages contains "did stuff"
}
```

In production:
```go
type ProdLogger struct{}
func (ProdLogger) Log(msg string) { fmt.Println("[INFO]", msg) }

app := &App{log: ProdLogger{}}
```

The `App` doesn't know or care which Logger it has — just that it can call `Log`. Easy to test, easy to swap.

### A complete, runnable test you can actually execute

To make the testing story concrete, here's a full `_test.go` file that passes:

```go
package main

import "testing"

type Logger interface {
    Log(msg string)
}

type App struct{ log Logger }

func (a *App) DoStuff() { a.log.Log("did stuff") }

type FakeLogger struct{ messages []string }

func (f *FakeLogger) Log(msg string) { f.messages = append(f.messages, msg) }

func TestApp(t *testing.T) {
    fake := &FakeLogger{}
    app := &App{log: fake}

    app.DoStuff()

    if len(fake.messages) != 1 || fake.messages[0] != "did stuff" {
        t.Fatalf("got %v, want [\"did stuff\"]", fake.messages)
    }
}
```

Run it with `go test ./...` and it reports `ok`. Notice there is no mocking framework — the fake is a 4-line struct. This is the everyday payoff of programming against interfaces.

> **Takeaway:** Depending on a small interface lets you swap a real implementation for a hand-written fake in tests, with zero mocking libraries.

---

## Interface satisfaction is implicit

This is a big difference from Java:

```go
type Stringer interface { String() string }

type Person struct{ Name string }
func (p Person) String() string { return "Person: " + p.Name }
// Notice: no "implements Stringer" declaration anywhere.
// But Person IS a Stringer.

var s Stringer = Person{Name: "Alice"}    // works!
```

This means you can satisfy interfaces from **other packages** even if you didn't write them. And you don't need to import the interface to satisfy it.

### Compile-time check

To force a check:

```go
var _ Stringer = (*Person)(nil)
```

This gives a compile error if `*Person` doesn't satisfy `Stringer`. Common idiom.

Read it piece by piece: `(*Person)(nil)` is a typed nil pointer of type `*Person`; assigning it to a throwaway `var _ Stringer` makes the compiler verify `*Person` satisfies `Stringer`. The `_` blank identifier means no variable is actually kept — it costs nothing at runtime and exists purely to fail the build loudly if you ever rename or remove `String()`.

> **Takeaway:** `var _ Iface = (*T)(nil)` is a free, zero-runtime-cost assertion that documents intent and turns a silent satisfaction break into a compile error.

### Pointer vs. value receivers change *what* satisfies the interface

This trips up nearly every newcomer. If you define a method on a **pointer receiver**, then only the **pointer** satisfies the interface — not the value:

```go
type Counter struct{ n int }

func (c *Counter) Add() { c.n++ } // pointer receiver

type Adder interface{ Add() }

var a Adder = &Counter{} // OK: *Counter has Add
// var b Adder = Counter{}  // COMPILE ERROR: Counter (value) does NOT satisfy Adder
```

Rule of thumb:
- **Value receiver** → both the value and the pointer satisfy the interface.
- **Pointer receiver** → only the pointer satisfies it.

Why? A pointer-receiver method may mutate the receiver, and Go can't take the address of an arbitrary interface-held value to call it safely, so it disallows the value form. The practical fix is usually to store `&Counter{}` (a pointer) in the interface.

> **Takeaway:** If your methods use pointer receivers, hand the interface a pointer (`&T{}`), not a value — otherwise you get a confusing "does not implement" compile error.

---

## Interface values and nil

An interface value has two parts: a concrete type and a value.

```go
var s Stringer    // both type and value are nil; s == nil
fmt.Println(s == nil)    // true

s = (*Person)(nil)    // type set to *Person, value still nil
fmt.Println(s == nil)    // FALSE! Common gotcha.
```

This is the "typed nil" gotcha. Be careful when returning typed nil pointers as interfaces.

**Fix:** return literal `nil`, not a typed nil pointer.

```go
func find(id int) *Person {
    if !exists(id) {
        return nil    // OK
    }
    ...
}

func findInterface(id int) Stringer {
    if !exists(id) {
        return nil    // GOOD
    }
    ...
    var p *Person = nil
    return p          // BAD: typed nil; interface won't be nil
}
```

### Why this happens, mechanically

Remember the two-word `(type, value)` model. A *truly* nil interface has **both** words nil. When you return a typed nil pointer, the value word is nil but the **type word is `*Person`** — so the pair is `(*Person, nil)`, which is not equal to the all-nil interface. The `== nil` check compares the whole pair, sees a non-nil type word, and reports `false`.

This bites hardest with errors:

```go
type MyErr struct{}
func (*MyErr) Error() string { return "boom" }

func do() error {
    var e *MyErr // nil pointer
    // ... imagine we forgot to set e ...
    return e // returns (*MyErr, nil) — a NON-nil error!
}

func main() {
    if err := do(); err != nil {
        fmt.Println("caller thinks there was an error:", err == nil) // err == nil is false
    }
}
```

The caller's `if err != nil` fires even though "nothing went wrong," because the returned error interface is not nil. The fix is to declare the return type as the concrete `*MyErr` if you'll return typed nils, or to `return nil` explicitly on the success path.

> **Takeaway:** A nil pointer stored in an interface is **not** a nil interface; always `return nil` literally on success rather than returning a typed nil pointer.

---

## Worked example — Strategy pattern with interfaces

Pricing strategy that varies at runtime:

```go
type PricingStrategy interface {
    Price(items []Item) float64
}

type FlatPricing struct{}
func (FlatPricing) Price(items []Item) float64 {
    total := 0.0
    for _, it := range items {
        total += it.Price
    }
    return total
}

type DiscountedPricing struct{ Percent float64 }
func (d DiscountedPricing) Price(items []Item) float64 {
    total := FlatPricing{}.Price(items)
    return total * (1 - d.Percent/100)
}

func computeBill(items []Item, strategy PricingStrategy) float64 {
    return strategy.Price(items)
}

// Use:
items := []Item{{Price: 10}, {Price: 20}}
total := computeBill(items, FlatPricing{})
discounted := computeBill(items, DiscountedPricing{Percent: 10})
```

`computeBill` is decoupled from how prices are computed. Add new strategies without touching it.

This is exactly what design patterns leverage — see `Foundations/DesignPatterns/strategy.md`.

### Bonus: a function value can be a strategy too

For single-method strategies, Go often skips the struct entirely and passes a **function** — frequently via a "func adapter," the same trick `http.HandlerFunc` uses:

```go
package main

import "fmt"

type Item struct{ Price float64 }

// PriceFunc lets an ordinary function satisfy a single-method interface.
type PricingStrategy interface {
    Price(items []Item) float64
}

type PriceFunc func([]Item) float64

func (f PriceFunc) Price(items []Item) float64 { return f(items) }

func computeBill(items []Item, s PricingStrategy) float64 { return s.Price(items) }

func main() {
    items := []Item{{Price: 10}, {Price: 20}}

    flat := PriceFunc(func(its []Item) float64 {
        total := 0.0
        for _, it := range its {
            total += it.Price
        }
        return total
    })

    fmt.Println(computeBill(items, flat))
}
```

Output:
```
30
```

> **Takeaway:** A named function type with one method (`type F func(...); func (f F) M(...) {...}`) lets a plain function satisfy a one-method interface — the standard library's `http.HandlerFunc` idiom.

---

## Common mistakes

**1. Big interfaces.**
Don't define a 10-method interface if a method only needs 2. Many types have only some of those methods.

**2. Defining interfaces too early.**
Don't write interfaces speculatively. Write code, then extract interfaces when you have multiple implementations.

**3. Forgetting the empty interface gotcha.**
```go
func print(x interface{}) {
    if x == nil { ... }    // doesn't catch typed nil pointers
}
```

**4. Type assertion without `ok`.**
```go
s := x.(string)    // PANIC if not string
```
Use `s, ok := x.(string)` for safety.

**5. Comparing interfaces with `==`.**
Two interface values are equal if both type AND value match. Subtle.

```go
var a Stringer = Person{Name: "Alice"}
var b Stringer = Person{Name: "Alice"}
fmt.Println(a == b)    // depends on Person's equality (values match here, so true)
```

For pointer-receiver types, you'd be comparing pointers, not values.

**6. Comparing interfaces that hold uncomparable values — runtime panic.**
`==` on interfaces compiles fine but **panics at runtime** if the underlying concrete type is not comparable (slices, maps, functions).

```go
// WRONG
var a, b any = []int{1}, []int{1}
fmt.Println(a == b) // panic: runtime error: comparing uncomparable type []int
```

```go
// FIX: compare with reflect.DeepEqual for composite values
import "reflect"
fmt.Println(reflect.DeepEqual([]int{1}, []int{1})) // true
```

> Structs, pointers, channels, strings, numbers, and booleans are comparable; slices, maps, and funcs are not. Storing the latter in an `any` and using `==` is a landmine.

**7. Pointer-receiver method, but you stored a value.**
```go
// WRONG
type Counter struct{ n int }
func (c *Counter) Add() {}
var a Adder = Counter{} // COMPILE ERROR: value doesn't satisfy interface
```
```go
// FIX
var a Adder = &Counter{} // pointer satisfies it
```

**8. Returning an interface where a concrete type would do.**
```go
// SMELLY: callers lose access to other methods/fields and must assert.
func New() io.Reader { return &bytes.Buffer{} }
```
```go
// BETTER: accept interfaces, return structs.
func New() *bytes.Buffer { return &bytes.Buffer{} }
```

**9. Wrapping a nil pointer in an interface and returning it as an error.**
Covered above — the classic typed-nil error bug. `return nil`, not a typed nil pointer.

---

## Interviewer cross-questions ("why X and not Y")

**Q: Why does Go use implicit (structural) interface satisfaction instead of an explicit `implements` keyword like Java?**
A: So a type can satisfy interfaces it was never designed for, including interfaces defined in packages it doesn't import. This lets each *consumer* declare a minimal interface for exactly the methods it needs, and lets you adapt third-party types without modifying them. The trade-off is that satisfaction isn't documented at the type's declaration; the `var _ Iface = (*T)(nil)` idiom recovers that documentation when you want it.

**Q: Why are small (often one-method) interfaces preferred? Isn't a rich interface more convenient?**
A: A rich interface forces every implementer to provide every method, so few types can satisfy it and it's hard to fake in tests. Small interfaces are easy to satisfy and compose (embed) into larger ones when needed. "The bigger the interface, the weaker the abstraction" — a one-method interface like `io.Reader` describes a sharp, reusable capability.

**Q: Why "accept interfaces, return concrete types"?**
A: Accepting an interface makes the function maximally reusable — any conforming type works. Returning a concrete type gives the caller the full API surface and lets *them* choose which interface (if any) to narrow to. Returning an interface prematurely hides methods and pushes type assertions onto callers. The standard exception is `error`, returned as an interface by convention.

**Q: Why is a nil pointer inside an interface not equal to nil?**
A: An interface value is a `(type, value)` pair. A nil interface has both words nil. A typed nil pointer sets the type word (e.g. `*Person`) while leaving the value word nil, so the pair `(*Person, nil)` is not the all-nil pair — `== nil` returns false. This is most dangerous when returning typed nil pointers as `error`.

**Q: When should I use `any`/empty interface versus generics?**
A: Use `any` only at genuine boundaries where the type truly is unknown (JSON decoding into unknown shapes, `fmt`, container libraries before generics). For "this works for several known types," use generics (Go 1.18+) so the compiler keeps type checking; `any` defers errors to runtime panics.

**Q: Why do pointer receivers restrict which values satisfy an interface?**
A: A pointer-receiver method can mutate its receiver, and Go cannot reliably take the address of a value already copied into an interface, so calling such a method on a value form would be unsafe or surprising. Therefore only `*T` (which carries an address) satisfies the interface; `T` does not. Value-receiver methods are in the method set of both `T` and `*T`.

**Q: Are interface method calls slower than direct calls?**
A: There is a small cost — an interface call is an indirect dispatch through the type's method table (similar to a virtual call), and it can defeat inlining and force a heap allocation when a value is boxed into the interface. In the vast majority of code this is negligible; reach for concrete types in genuinely hot loops if profiling shows it matters, but design for clarity first.

**Q: How does a type switch differ from a chain of type assertions, and when use each?**
A: A type switch (`switch v := x.(type)`) is the idiomatic, readable way to branch on several possible dynamic types and gives you a correctly-typed `v` per case. Use a single type assertion when you expect exactly one type (or want to probe for one optional behavior, like `Closer`). Use the comma-ok form to avoid panics.

---

## When NOT to use interfaces

- **You have exactly one implementation and no test seam.** Adding an interface "just in case" is speculative abstraction; it adds indirection and hides the concrete API. Write the struct; extract an interface later when a second implementation or a test fake appears.
- **As a return type when callers need the full struct.** Prefer returning the concrete type.
- **To fake a class hierarchy.** Go has no inheritance; don't model `Animal -> Dog` taxonomies with interfaces. Model *capabilities* (`Speaker`, `Mover`), not *kinds*.
- **For pure data with no behavior.** If there are no methods, you don't need an interface — use a struct or a generic type parameter.
- **As a substitute for generics.** If the only reason you used `any` is "it works for ints and floats," use a generic constraint instead and keep compile-time safety.

> **Takeaway:** Interfaces earn their keep when there are (or will soon be) multiple implementations or a test boundary; until then, prefer the concrete type.

---

## Exercises

1. **`Shape` interface** with `Area() float64`. Implement `Circle`, `Square`, `Triangle`.
2. **`Notifier` interface** with `Send(msg string) error`. Implement `EmailNotifier`, `SMSNotifier` (mock).
3. **Custom error** that implements `error`. Add an `Code()` method to expose error code.
4. **`Sorter`**: build your own bubble sort that takes a slice + a `less func(a, b T) bool` (or use `sort.Interface`).
5. **`Plugin` system**: define `Plugin` interface with `Run() error`. Build a registry that runs all plugins.

### Hint for #1:

```go
type Shape interface {
    Area() float64
}

type Circle struct{ Radius float64 }
func (c Circle) Area() float64 { return math.Pi * c.Radius * c.Radius }

type Square struct{ Side float64 }
func (s Square) Area() float64 { return s.Side * s.Side }

func totalArea(shapes []Shape) float64 {
    total := 0.0
    for _, s := range shapes {
        total += s.Area()
    }
    return total
}
```

### Hint for #3 (custom error with a code):

```go
type CodedError struct {
    Msg  string
    code int
}

func (e *CodedError) Error() string { return e.Msg }
func (e *CodedError) Code() int     { return e.code }

// Callers can recover the richer type:
var err error = &CodedError{Msg: "not found", code: 404}
if ce, ok := err.(interface{ Code() int }); ok {
    fmt.Println("HTTP", ce.Code()) // HTTP 404
}
```

Note the anonymous interface `interface{ Code() int }` in the assertion — you can probe for *any* method without naming a formal interface type. This is exactly how `errors.As` / behavior-probing works in real codebases.

---

## What to read next

- **Doc 08 — Goroutines and channels:** Go's concurrency primitives. Channels and interfaces compose constantly (e.g. `chan io.Reader`).

  ```
  → Foundations/Programming/Go/08-goroutines-and-channels.md
  ```

- **Generics (Go 1.18+):** the type-safe alternative to `any` for "works on many types." Look for `Foundations/Programming/Go/` generics material, or the official tour at <https://go.dev/doc/tutorial/generics>.
- **`errors` package:** `errors.Is`, `errors.As`, and error wrapping (`fmt.Errorf("...: %w", err)`) build directly on the `error` interface and the type-assertion ideas here.
- **Design patterns:** `Foundations/DesignPatterns/strategy.md` for the Strategy pattern shown above, and other behavioral patterns that lean on small interfaces.
- **Effective Go — Interfaces:** <https://go.dev/doc/effective_go#interfaces> for the canonical style guidance ("accept interfaces, return structs," small interfaces, the `Stringer`/`Reader`/`Writer` conventions).

## What's next

**Doc 08** — Goroutines and channels: Go's concurrency primitives.

```
→ Foundations/Programming/Go/08-goroutines-and-channels.md
```

# 02 — Types and Variables

> **Prerequisites:** `01-getting-started.md`.
> **Time to read:** 25 minutes.

Go is **statically typed** — every variable has a type known at compile time. The compiler enforces type safety, catching bugs early.

### Plain-English version (read this first)

Think of a variable as a **labeled box**. In Go, when you make the box you must also decide (or let the compiler figure out) **what shape of thing fits in it** — a whole number, a decimal, some text, a yes/no flag. Once decided, that box only ever holds that shape. If you try to drop a decimal into an "integer" box, Go refuses *before your program ever runs* and tells you exactly where. That refusal is the whole point: bugs that other languages discover at 3am in production, Go discovers while you're still typing.

Contrast this with Python or JavaScript, where the same box can hold a number now and a string five lines later — convenient, but the mistakes hide until runtime. Go trades a little typing for a lot of certainty.

### Precise/technical version

Every Go expression has a **static type** determined by the compiler. Type checking happens at compile time; there is **no runtime type coercion** between distinct types (unlike C's implicit `int`→`double`, or JavaScript's `1 + "2" === "12"`). Variables are introduced via `var` declarations or short `:=` declarations, always have a fully-defined type, and are always initialized — to an explicit value or to the type's **zero value**. The type system is **nominal** for named types (two named types are never assignable to each other without an explicit conversion, even if their underlying types match) and **structural** for interfaces (covered in doc 07).

### Declaring variables — the four forms

```go
package main

import "fmt"

func main() {
	var a int = 10        // 1. explicit type + value
	var b = 20            // 2. type inferred from value (still int)
	var c int             // 3. type only -> zero value (0)
	d := 40               // 4. short form: declare + infer, FUNCTION SCOPE ONLY

	fmt.Println(a, b, c, d) // 10 20 0 40
}
```

**Expected output:** `10 20 0 40`
**Takeaway:** `:=` is the everyday form inside functions; `var` is required at package level and whenever you want the zero value or an explicit type.

> **Gotcha:** `:=` only works *inside* a function body. At package (file) scope you must use `var`. Also, `:=` requires **at least one new variable** on the left — `x := 1; x := 2` is a compile error; the second must be `x = 2`.

---

## Basic types

```go
var i int = 42                  // integer
var f float64 = 3.14            // floating point
var s string = "hello"          // text
var b bool = true               // boolean
var bt byte = 65                // 8-bit unsigned integer; same as uint8
var r rune = '🎉'                // 32-bit Unicode code point; same as int32
```

### Integer types

| Type | Size | Range |
|---|---|---|
| `int8`, `int16`, `int32`, `int64` | 8/16/32/64 bits | signed |
| `uint8`, `uint16`, `uint32`, `uint64` | 8/16/32/64 bits | unsigned (0+) |
| `int`, `uint` | 32 or 64 (platform) | system-default |
| `byte` | alias for `uint8` | bytes |
| `rune` | alias for `int32` | Unicode codepoint |

For most code, just use `int`. Use specific sizes when:
- Memory matters (large arrays).
- Interacting with binary protocols.

#### Exact ranges (memorize the signed ones)

| Type | Min | Max |
|---|---|---|
| `int8` | -128 | 127 |
| `uint8` / `byte` | 0 | 255 |
| `int16` | -32,768 | 32,767 |
| `uint16` | 0 | 65,535 |
| `int32` / `rune` | -2,147,483,648 | 2,147,483,647 |
| `uint32` | 0 | 4,294,967,295 |
| `int64` | -9.22e18 | 9.22e18 |
| `uint64` | 0 | 1.84e19 |

A signed N-bit integer ranges from `-2^(N-1)` to `2^(N-1) - 1`; an unsigned one from `0` to `2^N - 1`. The lopsided signed range (one extra negative) is **two's complement**, the standard binary representation for signed integers.

> **`int` is not a fixed size.** On a 64-bit build `int` is 64 bits; on a 32-bit build it is 32 bits. Never assume `int` is 32 or 64 — if you need a guaranteed width (e.g. a file format, a wire protocol, a hash), use `int32`/`int64` explicitly.

#### Integer overflow wraps silently — it does NOT panic

```go
package main

import "fmt"

func main() {
	var x uint8 = 255
	x++              // wraps around, no error
	fmt.Println(x)   // 0

	var y int8 = 127
	y++
	fmt.Println(y)   // -128
}
```

**Expected output:**
```
0
-128
```
**Takeaway:** Go integer arithmetic wraps modulo 2^N on overflow — it is well-defined but silent. If you handle counters, sizes, or money in small types, pick a type wide enough that overflow is impossible, or check bounds yourself.

#### Untyped constants and the default type rule

```go
i := 42      // default type of an integer literal is int
f := 3.14    // default type of a float literal is float64
r := 'A'     // default type of a rune literal is rune (int32)
c := 1 + 2i  // default type of a complex literal is complex128
```

The literal `42` has no type until it lands somewhere; in `i := 42` it adopts its **default type** `int`. This is why `:=` "just works" without you naming a type.

```go
var pi float32 = 3.14
var precise float64 = 3.141592653589793
```

`float64` is the common choice (more precision).

#### Floating-point is not exact — never `==` two floats

```go
package main

import (
	"fmt"
	"math"
)

func main() {
	fmt.Println(0.1 + 0.2)            // 0.30000000000000004
	fmt.Println(0.1+0.2 == 0.3)       // false (!)

	// Correct: compare within a tolerance (epsilon)
	const eps = 1e-9
	fmt.Println(math.Abs((0.1+0.2)-0.3) < eps) // true
}
```

**Expected output:**
```
0.30000000000000004
false
0.30000000000000004 ... true
```
**Takeaway:** `float64`/`float32` are IEEE-754 binary fractions; values like `0.1` cannot be represented exactly, so equality comparisons lie. Compare with an epsilon, or use integer cents / `math/big` for money. **Never represent currency as a float.**

#### Numeric separators and other literal forms

```go
billion := 1_000_000_000   // underscores improve readability (Go 1.13+)
hex      := 0xFF           // 255
octal    := 0o17          // 15
binary   := 0b1010        // 10
big      := 1e6           // 1000000.0 (a float64)
```

**Takeaway:** Underscores are purely cosmetic — the compiler ignores them. They make large constants readable without changing the value.

---

## Zero values

When a variable is declared without an initial value, it gets the **zero value** for its type:

```go
var i int          // 0
var f float64      // 0.0
var s string       // ""  (empty string, NOT nil)
var b bool         // false
var p *int         // nil (pointer)
var sl []int       // nil (slice)
```

This is different from Python where uninitialized variables don't exist. In Go, every variable always has a value.

### The full zero-value table

| Kind | Zero value |
|---|---|
| numeric (`int`, `float64`, `byte`, `rune`, ...) | `0` |
| `bool` | `false` |
| `string` | `""` (length 0, never nil) |
| pointer | `nil` |
| slice | `nil` |
| map | `nil` |
| channel | `nil` |
| function | `nil` |
| interface | `nil` |
| struct | each field set to its own zero value (recursively) |
| array | each element set to its element type's zero value |

### Why zero values matter: the "useful zero value" idiom

Go's standard library is designed so the zero value is often *immediately usable*. You don't need a constructor.

```go
package main

import (
	"fmt"
	"strings"
	"sync"
)

func main() {
	var b strings.Builder // zero value is a ready-to-use empty builder
	b.WriteString("hi")
	fmt.Println(b.String()) // "hi"

	var mu sync.Mutex // zero value is an unlocked mutex, ready to use
	mu.Lock()
	mu.Unlock()
	fmt.Println("ok")
}
```

**Expected output:**
```
hi
ok
```
**Takeaway:** A well-designed Go type works correctly straight from its zero value — `var b strings.Builder` needs no `New...()` call. When you design your own types, aim for the same.

> **Beginner trap — empty vs nil.** An empty string `""` and a nil string don't both exist: strings are never nil. But a nil **slice** and an empty (`make([]int, 0)`) slice *both* have length 0 and you can `append` to either — yet `s == nil` distinguishes them. Treat "nil slice" and "empty slice" as interchangeable for reading/appending; only the `== nil` check sees the difference.

---

## Type conversion (explicit)

Go has NO implicit type conversion. You can't add `int` and `float64`:

```go
i := 5
f := 2.5
// total := i + f    // ERROR

total := float64(i) + f    // 7.5
```

This catches bugs but is verbose.

```go
// String to int
import "strconv"

s := "42"
n, err := strconv.Atoi(s)
if err != nil {
    fmt.Println("not a number")
}

// Int to string
s := strconv.Itoa(42)    // "42"

// Float to string
s := strconv.FormatFloat(3.14, 'f', 2, 64)    // "3.14"

// String to float
f, err := strconv.ParseFloat("3.14", 64)
```

`strconv` is the standard package for these.

### Conversion is not the same as parsing — and `string(int)` is a famous trap

```go
package main

import (
	"fmt"
	"strconv"
)

func main() {
	n := 65

	wrong := string(rune(n))   // "A"  -> interprets 65 as a Unicode code point!
	right := strconv.Itoa(n)   // "65" -> the decimal text you actually wanted

	fmt.Println(wrong, right)  // A 65
}
```

**Expected output:** `A 65`
**Takeaway:** `string(someInt)` does **not** give you the digits — it produces the character with that code point. (Modern `go vet` flags `string(int)` as a likely bug.) To turn a number into its decimal text, use `strconv.Itoa` / `strconv.FormatInt`.

### Conversions that truncate or lose data

```go
package main

import "fmt"

func main() {
	f := 9.99
	fmt.Println(int(f))      // 9  -> truncates toward zero, does NOT round

	g := -9.99
	fmt.Println(int(g))      // -9 -> toward zero, not toward -inf

	var big int32 = 300
	fmt.Println(uint8(big))  // 44 -> 300 mod 256, narrowing silently wraps
}
```

**Expected output:**
```
9
-9
44
```
**Takeaway:** Numeric conversions truncate (floats) and wrap (narrowing integers) **silently**. To round a float, use `math.Round` *before* converting: `int(math.Round(9.99))` == 10.

### Named types need explicit conversion too (nominal typing)

```go
package main

import "fmt"

type Celsius float64
type Fahrenheit float64

func main() {
	var c Celsius = 100
	// var f Fahrenheit = c     // ERROR: cannot use c (Celsius) as Fahrenheit
	var f Fahrenheit = Fahrenheit(c*9/5 + 32)
	fmt.Println(f) // 212
}
```

**Expected output:** `212`
**Takeaway:** Even though `Celsius` and `Fahrenheit` both have underlying type `float64`, Go treats them as distinct types. You must convert explicitly — which is exactly the safety that stops you assigning a temperature where a different unit was expected.

---

## Strings

```go
s := "Hello, World!"
fmt.Println(len(s))     // 13

// Indexing returns BYTES, not characters
b := s[0]
fmt.Println(b)          // 72 (the byte 'H')
fmt.Printf("%c\n", b)   // H (rendered)
```

### What a string actually is

A Go string is a **read-only slice of bytes** (UTF-8 encoded by convention), described by a 2-word header: a pointer to the bytes and a length. That's why:

- `len(s)` returns the number of **bytes**, not characters.
- `s[i]` returns the **byte** at index `i` (type `byte`/`uint8`).
- Slicing `s[a:b]` is O(1) and shares the underlying bytes (no copy).

```go
package main

import "fmt"

func main() {
	s := "héllo"
	fmt.Println(len(s))            // 6  -> 'é' is 2 bytes in UTF-8
	fmt.Println(len([]rune(s)))    // 5  -> 5 actual characters
}
```

**Expected output:**
```
6
5
```
**Takeaway:** "Length of a string" is ambiguous in Unicode. `len(s)` = bytes; `len([]rune(s))` = code points. Use `utf8.RuneCountInString(s)` for the same count without allocating a slice.

### Strings are immutable

```go
s := "hello"
s[0] = 'H'    // ERROR: can't modify
```

To "modify," create a new string:

```go
s := "hello"
s = "Hello"    // new string assigned
```

> **Why immutable?** Immutability lets strings be shared and sliced freely without defensive copies, makes them safe to use as map keys, and lets the compiler intern string constants. The cost: any "edit" allocates a new string. For heavy editing, convert to `[]byte` or `[]rune`, mutate, then convert back.

```go
package main

import "fmt"

func main() {
	b := []byte("hello") // copy into a mutable byte slice
	b[0] = 'H'
	fmt.Println(string(b)) // "Hello"
}
```

**Expected output:** `Hello`
**Takeaway:** `[]byte(s)` and `string(b)` each **allocate and copy** — cheap for small strings, but don't do it in a tight loop.

### Concatenation

```go
greeting := "Hello, " + "world!"
```

For many strings, use `strings.Builder` (efficient):

```go
import "strings"

var b strings.Builder
b.WriteString("Hello")
b.WriteString(", ")
b.WriteString("world!")
fmt.Println(b.String())    // "Hello, world!"
```

#### Why `+=` in a loop is O(n²) and Builder is O(n)

```go
package main

import (
	"fmt"
	"strings"
)

func main() {
	// BAD: each += allocates a brand-new string and copies everything so far.
	bad := ""
	for i := 0; i < 5; i++ {
		bad += "x" // allocations grow with total length -> O(n^2)
	}

	// GOOD: Builder keeps one growing buffer, doubling capacity as needed.
	var sb strings.Builder
	for i := 0; i < 5; i++ {
		sb.WriteString("x")
	}

	fmt.Println(bad, sb.String()) // xxxxx xxxxx
}
```

**Expected output:** `xxxxx xxxxx`
**Takeaway:** Because strings are immutable, `s += "x"` copies the whole accumulated string every iteration — total work grows quadratically. `strings.Builder` amortizes to O(n). For two or three pieces, plain `+` is fine and clearer; reach for `Builder` only in loops.

### Substrings (slicing)

```go
s := "Hello, World!"
fmt.Println(s[7:12])    // "World"
fmt.Println(s[:5])      // "Hello"
fmt.Println(s[7:])      // "World!"
```

Note: indices are **byte-based**. For Unicode-safe iteration, use `range`:

```go
for i, r := range "héllo" {
    fmt.Printf("%d: %c\n", i, r)
}
// 0: h
// 1: é
// 3: l   (note: index 3 because é took 2 bytes)
// 4: l
// 5: o
```

`range` over a string gives `(byte_index, rune)` pairs — Unicode correct.

> **Gotcha — slicing in the middle of a multibyte rune.** `"héllo"[1:2]` gives you *half* of the `é` (one byte of a two-byte rune), which prints as the replacement character `�`. Byte slicing is safe only when you know the boundaries are ASCII or you computed them from a `range` index.

### Common string functions

```go
import "strings"

strings.ToUpper("hello")       // "HELLO"
strings.ToLower("HELLO")       // "hello"
strings.Contains("hello", "ll")  // true
strings.HasPrefix("hello", "he")  // true
strings.HasSuffix("hello", "lo")  // true
strings.Replace("hello", "l", "L", -1)  // "heLLo" (-1 = all)
strings.Split("a,b,c", ",")    // ["a", "b", "c"]
strings.Join([]string{"a", "b"}, "-")    // "a-b"
strings.TrimSpace("  hello  ")           // "hello"
```

A few more you'll reach for constantly:

```go
strings.ReplaceAll("hello", "l", "L")    // "heLLo" (clearer than Replace(..., -1))
strings.Index("chicken", "ken")          // 4  (-1 if not found)
strings.Count("cheese", "e")             // 3
strings.Repeat("ab", 3)                  // "ababab"
strings.Fields("  a  b   c ")            // ["a","b","c"] (splits on any whitespace runs)
strings.EqualFold("Go", "GO")            // true  (case-insensitive compare)
strings.TrimPrefix("v1.2", "v")          // "1.2"
```

> **All `strings` functions return new strings** (immutability again). None mutate their input. `strings.ToUpper(s)` does *not* change `s` — you must assign the result.

---

## Booleans

```go
isReady := true
isDone := false

// Logical
fmt.Println(true && false)    // false
fmt.Println(true || false)    // true
fmt.Println(!true)            // false

// Short-circuit
result := someCondition() && expensive()  // expensive() only if first is true
```

Comparisons return `bool`:

```go
fmt.Println(5 > 3)     // true
fmt.Println(5 == 5)    // true
fmt.Println(5 != 5)    // false
```

### `bool` is its own type — no truthiness

```go
package main

import "fmt"

func main() {
	x := 0
	// if x { ... }       // ERROR: non-bool x (type int) used as if condition
	if x != 0 {           // you must produce an actual bool
		fmt.Println("nonzero")
	} else {
		fmt.Println("zero") // prints this
	}
}
```

**Expected output:** `zero`
**Takeaway:** Unlike C, Python, or JS, Go has no implicit truthiness — `0`, `""`, and `nil` are **not** "falsy". Conditions must be of type `bool`. This eliminates a whole class of `if (ptr)` ambiguity bugs.

> **Short-circuit as a guard idiom.** `if u != nil && u.Active { ... }` — the `&& u.Active` is only evaluated when `u != nil`, so it safely avoids a nil dereference. Ordering matters: put the cheap/safe check first.

---

## Constants

```go
const Pi = 3.14159
const Greeting = "Hello"
const MaxRetries = 5
```

Constants can be:
- Untyped (more flexible) or typed.
- Used at package or function level.

```go
const (
    StatusActive   = "active"
    StatusInactive = "inactive"
    StatusBanned   = "banned"
)
```

### Untyped vs typed constants — why "untyped" is a feature

```go
package main

import "fmt"

const untypedTwo = 2          // untyped constant
const typedTwo int = 2        // typed constant

func main() {
	var f float64 = 1.5
	fmt.Println(f * untypedTwo) // 3 -> untypedTwo adapts to float64

	// fmt.Println(f * typedTwo) // ERROR: mismatched types float64 and int
	fmt.Println(f * float64(typedTwo)) // 3 -> must convert a typed constant
}
```

**Expected output:**
```
3
3
```
**Takeaway:** An *untyped* constant takes on whatever type the context needs, so `2` works as `int`, `float64`, `byte`, etc. A *typed* constant is locked to one type and needs explicit conversion. Prefer leaving constants untyped unless you specifically need to pin the type.

> **Constants must be known at compile time.** You cannot write `const t = time.Now()` or `const n = len(os.Args)` — only expressions the compiler can evaluate (literals, other constants, `len`/`cap` of arrays, `iota`). They have no address, so `&MyConst` is illegal.

### `iota` — auto-incrementing

For enum-like constants:

```go
const (
    Sunday = iota   // 0
    Monday          // 1
    Tuesday         // 2
    Wednesday       // 3
    Thursday        // 4
    Friday          // 5
    Saturday        // 6
)
```

`iota` resets to 0 in each `const` block, increments by 1 per line.

### `iota` is more than +1 — patterns you'll see in real code

`iota` is the line index within the const block (starting at 0). You can build expressions from it. Each line repeats the previous line's expression if you omit it.

```go
package main

import "fmt"

// Powers of two — classic for bit flags / sizes.
const (
	_  = iota             // skip 0 with the blank identifier
	KB = 1 << (10 * iota) // 1 << 10 = 1024
	MB                    // 1 << 20
	GB                    // 1 << 30
)

// Bit-flag set: each constant owns one bit, so they OR together cleanly.
type Permission uint8

const (
	Read    Permission = 1 << iota // 1  (binary 001)
	Write                          // 2  (binary 010)
	Execute                        // 4  (binary 100)
)

func main() {
	fmt.Println(KB, MB, GB) // 1024 1048576 1073741824

	perms := Read | Write          // combine flags with bitwise OR
	fmt.Println(perms&Read != 0)   // true  -> has Read
	fmt.Println(perms&Execute != 0) // false -> lacks Execute
}
```

**Expected output:**
```
1024 1048576 1073741824
true
false
```
**Takeaway:** `1 << iota` gives each constant a distinct power of two, which is exactly what you want for combinable bit flags. Use `_ = iota` to discard the unwanted zero value when zero would be meaningless.

> **Gotcha — `iota` counts blank lines and skips too.** `iota` increments per *ConstSpec line* in the block, including lines using `_`. If you delete or reorder lines, every value below shifts — which silently changes the numbers a database or wire protocol may depend on. For values that must be stable forever, assign them explicitly rather than via `iota`.

### Custom typed enum

```go
type Status int

const (
    Active Status = iota
    Inactive
    Banned
)

func main() {
    s := Active
    fmt.Println(s)    // 0
}
```

To make it print as a string, add a `String()` method (we'll see this in `06-structs-and-methods.md`).

#### Preview: a typed enum that prints nicely (with `String()`)

```go
package main

import "fmt"

type Status int

const (
	Active Status = iota
	Inactive
	Banned
)

// String makes Status satisfy fmt.Stringer, so Println prints the name.
func (s Status) String() string {
	switch s {
	case Active:
		return "active"
	case Inactive:
		return "inactive"
	case Banned:
		return "banned"
	default:
		return fmt.Sprintf("Status(%d)", int(s))
	}
}

func main() {
	fmt.Println(Active)    // active   (not 0)
	fmt.Println(Status(9)) // Status(9) (defends against bad values)
}
```

**Expected output:**
```
active
Status(9)
```
**Takeaway:** A bare `Status int` enum prints as a number; adding a `String()` method makes it human-readable everywhere `fmt` is used. The `default` branch guards against invalid values. The standard tool `stringer` (`go install golang.org/x/tools/cmd/stringer@latest`) can generate this method for you. Full method coverage is in doc 06.

> **Go has no real `enum` keyword.** The `type + const + iota` pattern is the idiom. Its weakness: nothing stops `Status(42)` from being created, so always handle the unknown case.

---

## Pointers (briefly — full coverage in `06-`)

A pointer holds the address of a value.

```go
x := 42
p := &x          // p points to x
fmt.Println(*p)  // 42 (dereference)
*p = 100         // modify through pointer
fmt.Println(x)   // 100
```

- `&x` — address of x.
- `*p` — value at p.

You'll see pointers when:
- Passing things to functions that should modify them.
- Working with structs (mutate without copying).
- Optional/null values (`*int` can be nil).

### Plain-English: what a pointer is and why you'd want one

A pointer is a **note that says "the value lives over there"** instead of the value itself. Go passes everything *by value* — when you hand a variable to a function, the function gets a **copy**. If the function should change the caller's original, you instead hand it the *address* (a pointer), and the function edits through that address.

```go
package main

import "fmt"

func addOneCopy(n int)  { n++ }       // edits a copy; caller unaffected
func addOnePtr(n *int)  { *n++ }      // edits through the pointer; caller sees it

func main() {
	x := 10
	addOneCopy(x)
	fmt.Println(x) // 10 -> unchanged

	addOnePtr(&x)
	fmt.Println(x) // 11 -> changed
}
```

**Expected output:**
```
10
11
```
**Takeaway:** Pass a pointer when a function must mutate the caller's variable (or to avoid copying a large struct). For small values you just want to read, pass by value — it's simpler and often faster.

> **Dereferencing a nil pointer panics at runtime.** `var p *int; fmt.Println(*p)` compiles fine but panics with `invalid memory address or nil pointer dereference`. Always ensure a pointer is non-nil before `*p`. Go has **no pointer arithmetic** (no `p+1`) — that's a deliberate safety choice versus C.

We'll go deep on pointers in doc 06.

---

## Type aliases

```go
type UserID int
type Email string

func sendEmail(to Email, content string) {
    fmt.Println("Sending to", to)
}

func main() {
    var u UserID = 42
    e := Email("user@example.com")
    sendEmail(e, "hi")
}
```

Aliases give your code domain-specific types. Helps prevent mixing up `UserID` and `OrderID`, both `int`.

### "Defined type" vs true "type alias" — they are NOT the same

The heading above shows **defined types** (`type UserID int`), which create a *new, distinct* type. Go also has **true aliases** (`type Byte = byte`, note the `=`), which are just *another name for the exact same type*.

```go
package main

import "fmt"

type Miles int   // DEFINED type: distinct from int
type Km = int    // true ALIAS: literally int, interchangeable

func main() {
	var m Miles = 26
	var k Km = 42

	// var x int = m          // ERROR: Miles is a different type
	var x int = int(m)        // OK: explicit conversion required
	var y int = k             // OK: Km IS int, no conversion needed

	fmt.Println(x, y) // 26 42
}
```

**Expected output:** `26 42`
**Takeaway:** `type T U` (no `=`) makes a new type that needs explicit conversion — use this for domain safety (`UserID`, `Email`). `type T = U` (with `=`) is a transparent alias that changes nothing about the type — use it rarely, mainly to rename a type during a large refactor or migration. **Day to day, you almost always want the defined-type form.**

> **When NOT to make a defined type:** if the wrapper adds no safety or methods and you'll just be converting back and forth constantly, it's noise. Reach for `type UserID int` when mixing it up with another `int` would be a real bug; skip it for throwaway local values.

---

## Multiple return values

```go
func divide(a, b float64) (float64, float64) {
    return a / b, a * b    // quotient, product
}

func main() {
    q, p := divide(10, 3)
    fmt.Println(q, p)

    // Discard with _
    q, _ := divide(10, 3)    // only need quotient
}
```

This is the foundation of Go's error handling — functions return `(value, error)`.

### The `(value, error)` and `(value, ok)` idioms

```go
package main

import (
	"errors"
	"fmt"
)

func safeDivide(a, b float64) (float64, error) {
	if b == 0 {
		return 0, errors.New("divide by zero")
	}
	return a / b, nil
}

func main() {
	// Pattern 1: (value, error) — check err, not the value.
	if q, err := safeDivide(10, 0); err != nil {
		fmt.Println("error:", err) // error: divide by zero
	} else {
		fmt.Println("result:", q)
	}

	// Pattern 2: (value, ok) — the "comma ok" idiom, used by maps and casts.
	m := map[string]int{"a": 1}
	if v, ok := m["a"]; ok {
		fmt.Println("found", v) // found 1
	}
	if _, ok := m["z"]; !ok {
		fmt.Println("missing z") // missing z
	}
}
```

**Expected output:**
```
error: divide by zero
found 1
missing z
```
**Takeaway:** Two ubiquitous shapes: `(result, error)` for operations that can fail, and `(value, ok bool)` for lookups that may not find anything. The "comma ok" form on a map distinguishes "key present with zero value" from "key absent" — `m["x"]` alone returns `0` for both.

### Named return values — handy, but use sparingly

```go
package main

import "fmt"

func split(sum int) (x, y int) { // x and y are declared and zero-initialized
	x = sum * 4 / 9
	y = sum - x
	return // "naked" return uses the current x, y
}

func main() {
	fmt.Println(split(17)) // 7 10
}
```

**Expected output:** `7 10`
**Takeaway:** Named returns document what each value means and pair well with deferred error wrapping. But **naked `return`s hurt readability in long functions** — prefer explicit `return x, y` except in short helpers.

---

## Common mistakes

**1. Implicit type conversion.**
```go
i := 5
f := 2.5
total := i + f    // ERROR
total := float64(i) + f    // OK
```

**2. Nil maps / slices vs empty.**
```go
var m map[string]int    // nil
m["x"] = 1              // PANIC (nil map)

m := make(map[string]int)    // initialized, OK
m["x"] = 1
```

We'll cover `make` in collections doc.

**3. Forgetting unused variable rule.**
```go
x := 5    // ERROR if x is never used
```

**4. Calling string methods on nil.**
Strings are never nil in Go (only `*string` can be). But empty string is fine.

**5. Confusing `byte` and `rune`.**
- `byte`: 8-bit unsigned (alias for `uint8`).
- `rune`: 32-bit signed Unicode codepoint (alias for `int32`).
For text, prefer `rune`. For binary, `byte`.

**6. Array vs slice confusion.**
- `[5]int` — array, fixed size, value semantics.
- `[]int` — slice, dynamic size, reference semantics.
You'll almost always use slices.

**7. `string(myInt)` to get digits.**
```go
n := 65
fmt.Println(string(rune(n)))  // "A"  — WRONG, that's the code point
fmt.Println(strconv.Itoa(n))  // "65" — RIGHT
```
`string(int)` produces the character at that code point, not the decimal text. (Use `strconv`.)

**8. Comparing floats with `==`.**
```go
fmt.Println(0.1+0.2 == 0.3)                 // false — WRONG approach
fmt.Println(math.Abs(0.1+0.2-0.3) < 1e-9)   // true  — compare with epsilon
```

**9. Truncating a float and expecting rounding.**
```go
fmt.Println(int(9.99))               // 9  — truncates toward zero
fmt.Println(int(math.Round(9.99)))   // 10 — round first, then convert
```

**10. Shadowing with `:=` in an inner scope.**
```go
err := doThing()
if cond {
    err := doOther()   // NEW err, shadows the outer one
    _ = err            // outer err never updated -> bug
}
// the outer err is still from doThing()
```
Inside the `if`, `:=` declares a *new* `err`; the outer one is untouched. Use `=` when you mean to reassign. (`go vet -vettool=shadow` and many linters catch this.)

**11. Integer division surprises.**
```go
fmt.Println(5 / 2)          // 2   — integer division truncates
fmt.Println(5.0 / 2.0)      // 2.5 — float division
fmt.Println(float64(5) / 2) // 2.5 — convert at least one operand
```
`int / int` is integer division; promote an operand to `float64` for a fractional result.

---

## Idioms & best practices

- **Prefer `:=` inside functions, `var` at package scope.** Use `var` when you want the zero value (`var buf bytes.Buffer`) or an explicit type for clarity.
- **Reach for plain `int`** unless a specific width is required by memory pressure, a binary format, or an external API. Don't sprinkle `int32`/`int64` for no reason.
- **Leave constants untyped** unless you must pin a type; untyped constants flex to their context.
- **Design types with a useful zero value.** If a `New...()` constructor is the only way to get a working value, reconsider — Go style favors `var x T` being ready to use.
- **Use `strconv` for number↔string**, `strings.Builder` for loop concatenation, and `[]rune`/`[]byte` conversions only when you genuinely need to mutate or index by character.
- **Make domain types** (`type UserID int`, `type Email string`) when mixing values up would be a real bug; add a `String()` method to enums so they log readably.
- **Money is never a float.** Use integer minor units (cents) or a decimal library.
- **Check `err`, not the value.** The value is only meaningful when `err == nil`.

---

## Cross-questions an interviewer / reviewer will ask

**Q: Why does Go forbid implicit `int`→`float64` conversion when C allows it?**
A: Implicit numeric conversions hide precision loss and sign/width surprises (C's integer promotions are a notorious bug source). Forcing `float64(i)` makes the conversion — and its cost — visible at the call site, and prevents accidental mixing of units/types. The verbosity is the safety.

**Q: Is `int` 32 or 64 bits?**
A: Platform-dependent: 64 on a 64-bit build, 32 on a 32-bit build. If you need a guaranteed size, use `int32`/`int64`. `int` is the right default only when the exact width doesn't matter.

**Q: What's the difference between `byte` and `rune`?**
A: `byte` is an alias for `uint8` (one byte of raw data, e.g. one UTF-8 code unit). `rune` is an alias for `int32` and represents a single Unicode code point. Iterating a string with `range` yields `rune`s; indexing with `s[i]` yields `byte`s.

**Q: Why is `len("héllo")` 6 and not 5?**
A: Strings are UTF-8 byte sequences and `len` counts bytes. `é` encodes to two bytes, so the byte length is 6 while the rune count is 5. Use `utf8.RuneCountInString` or `len([]rune(s))` for characters.

**Q: Why are strings immutable, and what's the cost?**
A: Immutability lets strings be shared/sliced without copying, be safe map keys, and be safely passed across goroutines. The cost is that every "edit" allocates; for repeated mutation use `[]byte`/`[]rune` or `strings.Builder`.

**Q: Why `0.1 + 0.2 != 0.3`?**
A: `float64` is IEEE-754 binary floating point; `0.1`, `0.2`, `0.3` have no exact binary representation, so rounding error accumulates. Compare with an epsilon, or use integers/`math/big` for exact decimals.

**Q: Untyped vs typed constant — why prefer untyped?**
A: An untyped constant adopts the type required by its context, so the same `2` works as `int`, `float64`, `byte`, etc., without conversions. A typed constant is fixed and needs explicit conversion when used with another type. Untyped is more reusable.

**Q: How does `iota` work and where does it bite you?**
A: `iota` is the zero-based index of the ConstSpec line in a `const` block; it resets per block. It bites when you reorder/insert lines, because the numeric values of everything below shift — dangerous if those numbers are persisted. For stable wire/DB values, assign explicitly.

**Q: `type T int` vs `type T = int` — what's the difference?**
A: Without `=` it's a *defined type*: distinct, needs explicit conversion, can carry methods — use for domain safety. With `=` it's a *true alias*: the same type under a second name, fully interchangeable — use mainly during refactors/migrations.

**Q: When do I pass a pointer vs a value?**
A: Pass a pointer when the function must mutate the caller's variable, when copying would be expensive (large struct), or when you need a nullable/optional value. Pass by value for small, read-only data — it's simpler and avoids aliasing bugs.

**Q: Why does Go reject unused local variables and imports?**
A: To keep code clean and catch mistakes (a declared-but-unused variable often signals a typo or dead code). It's a *compile error*, not a warning, so you can't ignore it. Use `_` to intentionally discard a value.

---

## Exercises

1. **Temperature converter**: read Celsius, print Fahrenheit. (`F = C * 9/5 + 32`.)
2. **String reverser**: reverse a string. (Hint: use `[]rune`, not `[]byte`, to be Unicode-safe.)
3. **Word counter**: count words in a sentence. (`strings.Fields` splits on whitespace.)
4. **Type pyramid**: compute `int`, `float32`, `float64` representations of `1/3` and print.
5. **Constants**: define `enum`-style constants for HTTP status (200 OK, 404 NOT_FOUND, etc.) using `iota`.
6. **Overflow demo**: start `var x uint8 = 250`, add 10 in a loop printing each step, and observe the wrap-around at 255→0.
7. **Money safely**: represent `$19.99` as an `int` number of cents, add `$0.01`, and print it back as a dollar string (`$20.00`) using integer math only.
8. **Permission flags**: build a `Permission uint8` bit-flag enum (`Read|Write|Execute`) with `iota`, then write a `has(p, flag)` helper using `&`.

### Hint for #2 (reversing Unicode-safe)

```go
func reverse(s string) string {
    runes := []rune(s)
    for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
        runes[i], runes[j] = runes[j], runes[i]
    }
    return string(runes)
}
```

### Hint for #7 (money in cents)

```go
package main

import "fmt"

func main() {
	cents := 1999          // $19.99 as an integer count of cents
	cents += 1             // add one cent
	fmt.Printf("$%d.%02d\n", cents/100, cents%100) // $20.00
}
```
`/100` gives whole dollars, `%100` gives the leftover cents, and `%02d` zero-pads to two digits. No float ever touches the money.

---

## What to read next

- **Doc 03** — Control flow: `if`, `for`, `switch` (including the scoping and shadowing rules touched on in mistake #10).
- **Doc 06** — Structs, methods, and pointers in depth (the `String()` method preview and pointer mutation patterns).
- **Doc 07** — Interfaces and `fmt.Stringer`.
- **Reference:** [Go spec — Types](https://go.dev/ref/spec#Types), [Go spec — Constants](https://go.dev/ref/spec#Constants), and the blog post ["Strings, bytes, runes and characters in Go"](https://go.dev/blog/strings).

## What's next

**Doc 03** — Control flow: `if`, `for`, `switch`.

```
→ Foundations/Programming/Go/03-control-flow.md
```

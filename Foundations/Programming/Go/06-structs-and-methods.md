# 06 — Structs and Methods

> **Prerequisites:** `05-collections.md`.
> **Time to read:** 45 minutes.

A **struct** is Go's way of defining custom types — bundling related data together. You can attach **methods** to structs, getting OOP-like behavior without classes.

---

## The big idea (plain English first)

Imagine you're tracking people in a program. Each person has a name and an age. You *could* keep two separate variables — `name string` and `age int` — but the moment you have two people you have four loose variables, and nothing ties "Alice" to "30". They just float around.

A **struct** is a labelled box. You say "a `Person` is a box with a `Name` slot and an `Age` slot," and from then on you carry the whole box around as one thing. When you pass a `Person` to a function, the name and age travel together. When you have a list of people, each item is a complete box, not a pile of disconnected fields.

A **method** is a verb that belongs to that box. Instead of writing `area(rect)` (a function that takes a rectangle), you write `rect.Area()` (a method the rectangle knows how to do). The code reads like English: *the rectangle computes its area*. The data and the behavior that operates on it live next to each other.

That's the whole mental model. Now the precise version:

- A struct is an **aggregate value type**: a fixed sequence of named fields laid out contiguously in memory. The size of a struct is (roughly) the sum of its field sizes plus alignment padding. It is *not* a reference type — assigning a struct copies all of its fields.
- A method is **a function with a special first parameter called the receiver**. `func (r Rectangle) Area() float64` is essentially `func Area(r Rectangle) float64` with sugar that lets you call it as `r.Area()`. Methods can be attached to any *named type* you define (not just structs — you can attach methods to a named `int`, `string`, slice, etc., as long as the type is declared in your package).

Go deliberately has **no classes, no inheritance, no constructors, and no `this` keyword**. It gives you structs + methods + interfaces + embedding, and that combination is enough to build everything OOP gives you, with less hidden machinery. The rest of this doc shows how.

---

## Defining a struct

```go
type Person struct {
    Name string
    Age  int
}

func main() {
    p := Person{Name: "Alice", Age: 30}
    fmt.Println(p.Name)    // Alice
    fmt.Println(p.Age)     // 30
}
```

Anatomy:
- `type Person struct {...}` — defines a new type.
- Fields with names + types.
- Capitalized field name = exported (visible from other packages).

**Takeaway:** a struct groups related fields into one named type you carry around as a single value.

### Same-type fields can share a line

When several fields have the same type, you may list them together. This is purely cosmetic — it produces the exact same type.

```go
type Point struct {
    X, Y, Z float64   // three float64 fields
}

func main() {
    pt := Point{X: 1, Y: 2, Z: 3}
    fmt.Println(pt)    // {1 2 3}
}
```

**Takeaway:** `X, Y, Z float64` is shorthand for three separate `float64` fields, not one combined field.

### Initialization

```go
// Field-by-field (recommended — readable)
p := Person{Name: "Alice", Age: 30}

// Positional (matches struct order — fragile)
p := Person{"Alice", 30}

// Zero value (all fields default-initialized)
var p Person          // {"" 0}

// Then assign
p.Name = "Alice"
```

#### Why field-by-field beats positional

Positional initialization (`Person{"Alice", 30}`) depends on the *order* of the fields in the declaration. If a teammate later adds a field, reorders fields, or you mistype, the compiler may stay silent because the types still line up — and you've silently assigned the wrong value to the wrong field. Keyed initialization (`Person{Name: "Alice", Age: 30}`) survives field reordering and new fields, and it documents intent at the call site. The Go community treats positional struct literals as a smell for anything beyond tiny two-field "pair" types. `go vet` will even warn about unkeyed composite literals from *other* packages.

```go
// You can also omit fields you want left at their zero value:
p := Person{Name: "Alice"}    // Age is 0
fmt.Println(p)                // {Alice 0}
```

**Takeaway:** prefer keyed literals; they're refactor-proof and self-documenting.

### The zero value is always meaningful in Go

Every Go type has a **zero value**, and a freshly declared struct is filled with the zero value of each field — `0` for numbers, `""` for strings, `false` for bools, `nil` for pointers/slices/maps/channels/interfaces. You never get "uninitialized garbage" like in C.

```go
type Config struct {
    Verbose bool
    Retries int
    Tags    []string
    Cache   map[string]string
}

func main() {
    var c Config
    fmt.Printf("%+v\n", c)   // {Verbose:false Retries:0 Tags:[] Cache:map[]}
    fmt.Println(c.Tags == nil)   // true  (a nil slice, length 0)
    fmt.Println(len(c.Tags))     // 0     (len of nil slice is fine)
    // c.Cache["k"] = "v"        // would PANIC: assignment to nil map
}
```

A nil slice is read-safe (`len`, `range`, `append` all work), but a nil map is read-safe yet **write-unsafe** — writing to it panics. A good struct design makes the zero value usable; `sync.Mutex{}`, `bytes.Buffer{}`, and `time.Time{}` are all useful straight out of the zero value, no constructor needed.

**Takeaway:** the zero value is real and predictable — design structs so the zero value is a sensible starting state when you can.

### Printing structs while learning

`fmt` has verbs that are invaluable when you're debugging struct contents:

```go
p := Person{Name: "Alice", Age: 30}
fmt.Println(p)          // {Alice 30}
fmt.Printf("%v\n", p)   // {Alice 30}
fmt.Printf("%+v\n", p)  // {Name:Alice Age:30}   ← shows field names
fmt.Printf("%#v\n", p)  // main.Person{Name:"Alice", Age:30}  ← Go syntax
```

**Takeaway:** use `%+v` to see field names and `%#v` to see a value you could paste back into code.

### Anonymous fields (embedding) — covered later

### Anonymous structs (no name needed)

Sometimes you want a one-off struct that doesn't deserve a top-level name — a quick grouping in a function, a test table row, or a JSON shape used once. Go lets you declare the struct type inline:

```go
func main() {
    point := struct {
        X, Y int
    }{X: 3, Y: 4}
    fmt.Println(point)   // {3 4}

    // Very common in table-driven tests:
    tests := []struct {
        name string
        in   int
        want int
    }{
        {"double zero", 0, 0},
        {"double three", 3, 6},
    }
    for _, tc := range tests {
        got := tc.in * 2
        if got != tc.want {
            fmt.Printf("%s: got %d want %d\n", tc.name, got, tc.want)
        }
    }
}
```

**Takeaway:** anonymous structs are perfect for throwaway groupings — especially test tables — where naming a type would add noise.

---

## Comparing structs

Structs are **comparable with `==`** if (and only if) all their fields are comparable. Comparison is field-by-field.

```go
type Point struct{ X, Y int }

func main() {
    a := Point{1, 2}
    b := Point{1, 2}
    c := Point{1, 3}
    fmt.Println(a == b)   // true  (all fields equal)
    fmt.Println(a == c)   // false
}
```

Because comparable structs are valid map keys, you can do this:

```go
counts := map[Point]int{}
counts[Point{0, 0}]++
counts[Point{0, 0}]++
fmt.Println(counts[Point{0, 0}])   // 2
```

But a struct that contains a slice, map, or function is **not comparable** — `==` won't compile:

```go
type Bag struct{ items []int }
// _ = Bag{} == Bag{}   // compile error: struct containing []int cannot be compared
```

For those, use `reflect.DeepEqual(x, y)` (slower, reflection-based) or write your own equality method.

**Takeaway:** `==` works on structs of comparable fields and makes them usable as map keys; structs holding slices/maps/funcs need `reflect.DeepEqual` or a custom comparison.

---

## Modifying structs

```go
p := Person{Name: "Alice", Age: 30}
p.Age = 31
fmt.Println(p.Age)    // 31
```

Struct fields are mutable when the variable is mutable.

### Assignment copies the whole struct

This is the single most important consequence of structs being value types: **assigning a struct, or passing it as an argument, copies every field.** The copy is independent.

```go
type Person struct {
    Name string
    Age  int
}

func main() {
    a := Person{Name: "Alice", Age: 30}
    b := a            // full copy
    b.Age = 99
    fmt.Println(a.Age)   // 30  (a is untouched)
    fmt.Println(b.Age)   // 99
}
```

The catch: the copy is **shallow**. If a field is a slice, map, or pointer, the copy duplicates the *header/pointer*, not the underlying data — so both copies share the same backing storage.

```go
type Cart struct {
    Owner string
    Items []string   // a slice — header is copied, backing array is shared
}

func main() {
    a := Cart{Owner: "Alice", Items: []string{"apple"}}
    b := a               // shallow copy
    b.Items[0] = "BANANA"
    fmt.Println(a.Items[0])   // BANANA  (shared backing array!)

    b.Owner = "Bob"
    fmt.Println(a.Owner)      // Alice   (string field copied independently)
}
```

**Takeaway:** struct copies are deep for value fields (numbers, strings, bools, nested structs) but shallow for reference fields (slices, maps, pointers, channels).

---

## Structs in functions — value vs pointer

By default, structs are passed **by value** (copied):

```go
func birthday(p Person) {
    p.Age++          // modifies the COPY
}

p := Person{Name: "Alice", Age: 30}
birthday(p)
fmt.Println(p.Age)    // 30 (unchanged)
```

To modify the caller's struct, pass a **pointer**:

```go
func birthday(p *Person) {
    p.Age++          // dereferenced for you (Go is forgiving here)
}

p := Person{Name: "Alice", Age: 30}
birthday(&p)
fmt.Println(p.Age)    // 31
```

#### What `p.Age++` really means through a pointer

`p` is a `*Person` (a pointer). Strictly, modifying the age is `(*p).Age++` — first dereference the pointer to reach the struct, then bump the field. Go lets you write `p.Age++` because the compiler **automatically inserts the dereference** for field access through a pointer. This sugar is one of the reasons Go pointers feel less painful than C pointers: you rarely type `*` or `&` by hand.

```go
func birthday(p *Person) {
    (*p).Age++   // explicit, fully spelled out
    p.Age++      // identical — Go inserts the (*p) for you
}
```

**Takeaway:** through a struct pointer, `p.Field` automatically means `(*p).Field` — you almost never write the dereference yourself.

### When to use pointer to struct

- The struct is large (avoid copy cost).
- You want to modify the original.
- The struct represents identity (one user = one pointer).

```go
type LargeStruct struct {
    Field1 string
    Field2 string
    // ... 20 more fields ...
}

// Pass by pointer; avoids copying ~200 bytes
func process(s *LargeStruct) {
    // ...
}
```

For small structs (≤ 3-4 fields), value semantics are fine.

#### Putting numbers on "large"

A `string` header is 16 bytes on a 64-bit machine (a pointer + a length). A slice header is 24 bytes. An `int`/`float64` is 8 bytes. So a struct with "20 more `string` fields" is roughly `22 * 16 ≈ 352` bytes — copying that on every call is wasteful, and a `*LargeStruct` pointer is just 8 bytes regardless of struct size. By contrast, a `Point{X, Y int}` is 16 bytes; copying it is cheaper than the indirection and potential heap allocation a pointer can cause. There is no hard line, but a common rule of thumb is: *if it's bigger than a few machine words and you're passing it around hot loops, prefer a pointer.* When in doubt, write the simple value version first and only switch to pointers if a benchmark says it matters — premature pointer-everything hurts readability and can cause more heap allocations (see the "escape analysis" cross-question below).

**Takeaway:** pointers shine for large structs and mutation; tiny read-only structs are cheaper and clearer passed by value.

---

## Methods

A method is a function attached to a type.

```go
type Rectangle struct {
    Width, Height float64
}

func (r Rectangle) Area() float64 {
    return r.Width * r.Height
}

func main() {
    rect := Rectangle{Width: 5, Height: 3}
    fmt.Println(rect.Area())    // 15
}
```

The `(r Rectangle)` is the **receiver** — like Python's `self`. `r` is the instance the method runs on.

#### Methods are just functions with sugar

A method value can be turned back into a plain function. These two calls are equivalent, which makes the "receiver is the first argument" idea concrete:

```go
rect := Rectangle{Width: 5, Height: 3}

fmt.Println(rect.Area())            // 15  — normal method call
fmt.Println(Rectangle.Area(rect))   // 15  — "method expression": receiver passed explicitly

f := rect.Area     // "method value": rect is bound in
fmt.Println(f())   // 15
```

**Takeaway:** a method is a function whose first parameter is the receiver; `T.Method(v)` and `v.Method()` are the same call.

### Methods on non-struct types

You're not limited to structs. You can attach a method to **any named type defined in your package** — including a renamed primitive. This is how you give a plain number or string domain-specific behavior.

```go
type Celsius float64

func (c Celsius) Fahrenheit() float64 {
    return float64(c)*9/5 + 32
}

func (c Celsius) String() string {
    return fmt.Sprintf("%.1f°C", float64(c))
}

func main() {
    boiling := Celsius(100)
    fmt.Println(boiling)               // 100.0°C   (uses String())
    fmt.Println(boiling.Fahrenheit())  // 212
}
```

The one rule: you can only define methods on a type **declared in the same package**. You cannot write `func (s string) Shout() string` — `string` is built in and not yours. The fix is to define your own named type (`type MyString string`) and attach methods to that.

**Takeaway:** methods attach to any named type you declare, not just structs — great for giving primitives domain meaning.

### Value vs pointer receiver

```go
type Counter struct {
    Value int
}

// Value receiver — works on COPY; doesn't change original
func (c Counter) BadIncrement() {
    c.Value++         // modifies the copy, not the original
}

// Pointer receiver — works on original
func (c *Counter) Increment() {
    c.Value++
}

func main() {
    c := Counter{Value: 0}
    c.BadIncrement()
    fmt.Println(c.Value)    // 0 (unchanged)
    c.Increment()
    fmt.Println(c.Value)    // 1
}
```

**Rule of thumb:**
- Pointer receiver: if the method modifies the struct, OR if struct is large.
- Value receiver: if the method only reads, AND struct is small.
- **Be consistent within a type.** All methods on `Counter` should use the same receiver kind.

#### Why consistency matters (the method set rule)

There's a deeper reason to pick one receiver kind per type, and it bites people when they reach interfaces (doc 07). Go defines a **method set** for each type:

- The method set of a **value** `T` includes only the **value-receiver** methods.
- The method set of a **pointer** `*T` includes **both** value- and pointer-receiver methods.

Consequence: if `Increment` has a pointer receiver, then a `Counter` *value* does **not** satisfy an interface that requires `Increment()` — only a `*Counter` does. Mixing receiver kinds means some interfaces are satisfied by `T` and others only by `*T`, which is endlessly confusing. Picking one kind makes "does my type implement this interface?" a single, predictable answer.

```go
type Incrementer interface{ Increment() }

func main() {
    var i Incrementer
    c := Counter{}
    // i = c     // compile error: Counter does not implement Incrementer
    //           // (Increment has pointer receiver)
    i = &c       // OK: *Counter has Increment in its method set
    i.Increment()
    fmt.Println(c.Value)   // 1
}
```

**Takeaway:** value method sets exclude pointer-receiver methods, so mixing kinds makes interface satisfaction depend on whether you hold a `T` or a `*T` — pick one kind per type.

### Calling methods on pointers / values

Go is forgiving:

```go
c := Counter{Value: 0}
c.Increment()        // Go automatically takes &c
(&c).Increment()     // explicit; same thing

ptr := &Counter{Value: 0}
ptr.Increment()      // Go automatically dereferences
(*ptr).Increment()   // explicit; same thing
```

You almost never need to write `&` or `*` explicitly when calling methods.

#### The one case where the sugar does NOT save you: non-addressable values

The auto-`&` only works when the value is **addressable** — i.e., Go can take its address. A plain local variable is addressable; a map element, a function return value, or a literal in an expression is **not**. Calling a pointer-receiver method on a non-addressable value is a compile error.

```go
type Counter struct{ Value int }
func (c *Counter) Increment() { c.Value++ }

func makeCounter() Counter { return Counter{} }

func main() {
    m := map[string]Counter{"a": {}}
    // m["a"].Increment()      // compile error: cannot call pointer method on m["a"]
    //                         // (map elements are not addressable)

    // makeCounter().Increment() // compile error: cannot take address of makeCounter()

    // Fixes:
    c := m["a"]      // copy to an addressable local
    c.Increment()
    m["a"] = c       // write it back

    // Or store pointers in the map from the start:
    mp := map[string]*Counter{"a": {}}
    mp["a"].Increment()        // fine: element is already a pointer
    fmt.Println(mp["a"].Value) // 1
}
```

**Takeaway:** the auto-`&` needs an addressable value; map elements and temporary results aren't addressable, so store pointers (`map[K]*T`) or copy to a local first.

### Methods with a value receiver still see shared backing data

A value receiver copies the struct — but, exactly like struct assignment, that copy is *shallow*. A read-only-looking value-receiver method can still mutate the contents of a slice field, surprising you:

```go
type Board struct {
    cells []int
}

// value receiver — copies the Board header, but shares the cells backing array
func (b Board) Set(i, v int) {
    b.cells[i] = v   // mutates shared backing array!
}

func main() {
    b := Board{cells: []int{0, 0, 0}}
    b.Set(1, 42)
    fmt.Println(b.cells)   // [0 42 0]  — the "copy" reached the original
}
```

This is not a contradiction of "value receivers don't mutate": the *header* copy is discarded, but the slice header it copied still points at the same array. If you intend `Board` to be immutable, don't expose slice fields, or copy them defensively.

**Takeaway:** a value receiver protects the struct's own value fields, not the contents of slices/maps it holds — those are still shared.

---

## A complete example: BankAccount

```go
type BankAccount struct {
    Owner   string
    balance int    // unexported — hidden from outside package
}

func NewBankAccount(owner string, initial int) *BankAccount {
    return &BankAccount{Owner: owner, balance: initial}
}

func (a *BankAccount) Deposit(amount int) {
    a.balance += amount
}

func (a *BankAccount) Withdraw(amount int) error {
    if amount > a.balance {
        return fmt.Errorf("insufficient funds")
    }
    a.balance -= amount
    return nil
}

func (a *BankAccount) Balance() int {
    return a.balance
}

func main() {
    a := NewBankAccount("Alice", 100)
    a.Deposit(50)

    if err := a.Withdraw(200); err != nil {
        fmt.Println(err)    // insufficient funds
    }

    fmt.Println(a.Balance())   // 150
}
```

**Convention: `NewX` constructors.**
Go has no constructors; the convention is functions named `New<TypeName>` that return a pointer. They:
- Validate input.
- Set initial state.
- Return `*Type` (or `(Type, error)`).

#### Why unexported `balance` + exported methods = encapsulation

The lowercase `balance` field cannot be touched from another package. Outside code can only change the balance through `Deposit` and `Withdraw`, which enforce the rules (no negative withdrawal below zero, etc.). This is Go's encapsulation: **visibility is per-identifier (capitalization), and the unit of privacy is the package, not the type.** Code *inside* the same package can still read `a.balance` directly — there is no `private`-to-the-struct concept. So the way to protect an invariant is: put the type in its own package, lowercase the fields that hold the invariant, and expose methods that maintain it.

```go
// In package bank, this is fine (same package):
func audit(a *BankAccount) int { return a.balance }

// In package main, this fails to compile:
// a := bank.NewBankAccount("Alice", 100)
// a.balance = 1_000_000   // ERROR: a.balance undefined (unexported)
```

**Takeaway:** lowercase fields are package-private; combine them with exported methods to guard invariants — the privacy boundary is the package, not the struct.

---

## Embedding — Go's "inheritance"

Go has no inheritance. But you can **embed** one struct in another, gaining its fields and methods.

```go
type Animal struct {
    Name string
}

func (a Animal) Eat() {
    fmt.Println(a.Name, "is eating")
}

type Dog struct {
    Animal      // embedded
    Breed string
}

func main() {
    d := Dog{
        Animal: Animal{Name: "Rex"},
        Breed:  "Labrador",
    }
    fmt.Println(d.Name)    // Rex (from Animal)
    d.Eat()                 // Rex is eating (Animal's method)
}
```

`Dog` "has-a" Animal, but you can use Animal's fields and methods as if they were Dog's own.

This is **composition over inheritance**. Less coupling than classical inheritance.

#### Embedding is field promotion, not subclassing

Mechanically, embedding `Animal` inside `Dog` creates a field whose **name is the type name** (`Animal`), and Go *promotes* that field's exported fields and methods so you can reach them directly on `Dog`. There's no parent/child relationship and no virtual dispatch — it's flattened lookup. The promoted member is still reachable by its full path:

```go
d := Dog{Animal: Animal{Name: "Rex"}, Breed: "Labrador"}
fmt.Println(d.Name)         // Rex   — promoted
fmt.Println(d.Animal.Name)  // Rex   — explicit path, identical field
```

The crucial difference from inheritance: when `Animal.Eat()` runs, its receiver is the embedded `Animal`, which knows **nothing** about the enclosing `Dog`. There's no "the method secretly sees the whole Dog" behavior. If you "override" a promoted method by defining `func (d Dog) Eat()`, calling `d.Eat()` picks the Dog one (the shallower name shadows the deeper), but `Animal.Eat()` called internally still only sees the `Animal` part — no polymorphic callback into `Dog`. This absence of "virtual method" surprises is intentional.

```go
func (d Dog) Speak() {
    fmt.Println(d.Name, "barks")   // composes Animal's field with Dog behavior
}
```

**Takeaway:** embedding flattens a field's members onto the outer type (promotion); it is composition with delegation, not inheritance — there is no upcall from the inner type into the outer.

#### Embedding a pointer

You can embed `*Animal` instead of `Animal`. Promotion still works, but now the inner value is shared (and can be `nil`):

```go
type Dog struct {
    *Animal
    Breed string
}

func main() {
    a := &Animal{Name: "Rex"}
    d := Dog{Animal: a, Breed: "Lab"}
    d.Eat()                 // Rex is eating
    a.Name = "Rexford"
    d.Eat()                 // Rexford is eating  (shared via pointer)

    var bad Dog             // embedded *Animal is nil
    // bad.Eat()            // PANIC: nil pointer dereference
    _ = bad
}
```

**Takeaway:** embedding a pointer shares the inner value and lets it be nil — convenient, but the zero value of the outer struct is now a panic waiting to happen.

#### Name collisions in embedding

If two embedded types both have a field or method named `X`, accessing `outer.X` is **ambiguous and won't compile** — you must disambiguate with the full path. A name declared *directly* on the outer struct always wins over a promoted one at the same depth.

```go
type A struct{ ID int }
type B struct{ ID int }
type C struct {
    A
    B
}

func main() {
    c := C{A{1}, B{2}}
    // fmt.Println(c.ID)   // compile error: ambiguous selector c.ID
    fmt.Println(c.A.ID)    // 1   — disambiguated
    fmt.Println(c.B.ID)    // 2
}
```

**Takeaway:** ambiguous promoted names don't silently pick one — they fail to compile until you write the full path; an outer-declared name shadows a promoted one.

### Multiple embedding

```go
type Walker interface { Walk() }
type Swimmer interface { Swim() }

type Duck struct {
    Walker
    Swimmer
}
```

A Duck can walk AND swim. (We'll see interfaces in `07-interfaces.md`.)

---

## Constructor patterns

### Simple constructor

```go
func NewPerson(name string, age int) *Person {
    return &Person{Name: name, Age: age}
}
```

### Validating constructor

```go
func NewPerson(name string, age int) (*Person, error) {
    if name == "" {
        return nil, errors.New("name required")
    }
    if age < 0 {
        return nil, errors.New("age must be non-negative")
    }
    return &Person{Name: name, Age: age}, nil
}
```

#### When you *don't* need a constructor

If a struct's zero value is already a valid, usable state, skip the constructor and let callers write `var x T` or `T{}`. Inventing `NewT()` that just returns `&T{}` with no validation adds ceremony for nothing and forces heap allocation. The standard library follows this: you write `var buf bytes.Buffer` and `var mu sync.Mutex`, not `bytes.NewBuffer()` with no args. Reserve constructors for when there's real work to do: validation, setting non-zero defaults, allocating internal maps/slices, or returning an interface.

```go
type RateLimiter struct {
    seen map[string]int   // must be initialized before use
}

// Constructor needed: the zero value's nil map would panic on write.
func NewRateLimiter() *RateLimiter {
    return &RateLimiter{seen: make(map[string]int)}
}
```

**Takeaway:** add a constructor only when the zero value isn't usable or there's setup/validation to do — otherwise let callers use `T{}`.

### Functional options (advanced; for many optional fields)

```go
type Server struct {
    Host    string
    Port    int
    Timeout time.Duration
}

type ServerOption func(*Server)

func WithHost(h string) ServerOption  { return func(s *Server) { s.Host = h } }
func WithPort(p int) ServerOption      { return func(s *Server) { s.Port = p } }
func WithTimeout(t time.Duration) ServerOption { return func(s *Server) { s.Timeout = t } }

func NewServer(opts ...ServerOption) *Server {
    s := &Server{
        Host: "localhost",
        Port: 8080,
        Timeout: 30 * time.Second,
    }
    for _, opt := range opts {
        opt(s)
    }
    return s
}

// Use:
s := NewServer(WithPort(9090), WithTimeout(5 * time.Second))
```

This is a popular Go pattern when you have many optional configurations.

#### Why functional options instead of a config struct?

The obvious alternative is to pass a `Config` struct: `NewServer(Config{Port: 9090})`. That's fine and simpler for many cases. Functional options win specifically when: (1) most fields have sensible defaults and callers set only a few; (2) you want to add new options later **without breaking** existing call sites (adding `WithTLS` doesn't change anyone's existing call, whereas adding a field to a positional API would); and (3) an option needs validation or to set several fields together. The cost is more boilerplate (`With...` per field) and a little indirection, so don't reach for it on a two-field struct — use a plain config struct or positional args there.

**Takeaway:** functional options give defaulting + forward-compatible APIs for many-optional-field types; a plain config struct is simpler when you only have a few fields.

---

## `String()` method — custom display

If a type has a `String() string` method, `fmt.Println` uses it:

```go
type Status int

const (
    Active Status = iota
    Inactive
    Banned
)

func (s Status) String() string {
    switch s {
    case Active: return "active"
    case Inactive: return "inactive"
    case Banned: return "banned"
    }
    return "unknown"
}

func main() {
    s := Active
    fmt.Println(s)    // "active" (not "0")
}
```

This is implementing the `Stringer` interface (more in next doc).

#### Gotcha: never call `fmt` on the receiver inside `String()` with `%v`

If your `String()` method formats the receiver itself with `%v` (or `%s`), `fmt` will call `String()` again to format it — infinite recursion until the stack overflows.

```go
type Temp float64

// BUG: %v on t re-invokes String() forever
func (t Temp) String() string {
    return fmt.Sprintf("%v degrees", t)   // stack overflow!
}

// FIX: convert to the underlying type first so fmt doesn't see a Stringer
func (t Temp) StringFixed() string {
    return fmt.Sprintf("%v degrees", float64(t))
}
```

Also choose the receiver kind deliberately: `func (s Status) String()` (value receiver) means both `Status` and `*Status` print nicely. A pointer-receiver `String()` would **not** be used when you print a non-pointer value — a common reason a `Stringer` "doesn't fire."

**Takeaway:** inside `String()`, format the underlying type (e.g. `float64(t)`), not the Stringer itself, and prefer a value receiver so both values and pointers print correctly.

---

## Idioms and best practices (summary)

- **Keyed struct literals** everywhere except trivial pairs; let `go vet` catch the rest.
- **One receiver kind per type.** If any method needs a pointer receiver, give all methods pointer receivers for consistency.
- **Make the zero value useful** when you can; it removes the need for a constructor and prevents nil-map panics.
- **Constructors only when they earn their keep** (validation, defaults, internal allocation, returning an interface).
- **Encapsulate invariants** with unexported fields + exported methods, placed in their own package.
- **Prefer composition (embedding) over deep type hierarchies.** Embed to reuse behavior; embed an interface to require it.
- **Pointers for mutation and large structs; values for small read-only ones.** Don't pointer-everything reflexively.
- **Document with `%+v`/`%#v`** while debugging; add a `String()` only when human-readable output adds value.
- **When NOT to use a struct:** if you have a single value with no associated fields, a named primitive type (`type UserID int64`) is lighter and still takes methods. If fields never travel together, they're probably separate variables, not a struct.

---

## Common mistakes

**1. Forgetting pointer receiver for mutation.**
```go
func (c Counter) Bad() { c.Value++ }    // doesn't modify caller's c
```
Fix:
```go
func (c *Counter) Good() { c.Value++ }  // pointer receiver mutates the original
```

**2. Mixing receiver kinds on same type.**
```go
type Foo struct{}
func (f Foo) A() {}
func (f *Foo) B() {}
```
This works, but it's confusing. Pick one. (See the method-set explanation above for *why* it breaks interface satisfaction.)

**3. Returning slice into struct field — sharing memory.**
```go
type Cache struct{ items []int }
c := Cache{items: []int{1, 2, 3}}
internal := c.items
internal[0] = 999
fmt.Println(c.items[0])    // 999 (shared)
```
Fix — hand out a copy if callers must not mutate your internals:
```go
func (c Cache) Items() []int {
    out := make([]int, len(c.items))
    copy(out, c.items)
    return out             // caller gets an independent slice
}
```

**4. Trying to access unexported fields from another package.**
```go
// pkg p
type Config struct{ apiKey string }   // lowercase = private

// pkg main
import "p"
c := p.Config{}
c.apiKey = "x"      // ERROR: not visible
```
Fix — expose a method or constructor that sets it:
```go
// pkg p
func NewConfig(key string) Config { return Config{apiKey: key} }
```

**5. nil pointer dereference.**
```go
var p *Person    // nil
fmt.Println(p.Name)    // PANIC

p = &Person{Name: "Alice"}
fmt.Println(p.Name)    // Alice
```

Always initialize pointers before use.

**6. Calling a pointer-receiver method on a non-addressable value.**
```go
type Counter struct{ Value int }
func (c *Counter) Inc() { c.Value++ }

m := map[string]Counter{"a": {}}
// m["a"].Inc()   // compile error: cannot call pointer method on m["a"]
```
Fix — copy out, mutate, write back, or store pointers in the map:
```go
v := m["a"]; v.Inc(); m["a"] = v
// or: map[string]*Counter
```

**7. Comparing structs that contain slices/maps.**
```go
type Bag struct{ items []int }
// _ = Bag{} == Bag{}   // compile error: cannot compare
```
Fix:
```go
import "reflect"
equal := reflect.DeepEqual(Bag{}, Bag{})   // true
```

**8. Self-recursive `String()`.** See the `String()` gotcha above — format `float64(t)`, not the Stringer value.

---

## Cross-questions an interviewer or reviewer will ask

**Q: Why does Go have no classes or inheritance?**
A: To keep the type system simple and avoid the fragile-base-class and deep-hierarchy problems classical inheritance breeds. Go composes behavior with embedding and abstracts it with interfaces, which are satisfied **structurally** (implicitly) rather than by declared `extends`/`implements`. You get reuse and polymorphism without a class graph.

**Q: Value receiver or pointer receiver — how do you actually decide?**
A: Pointer receiver if the method mutates the receiver, if the struct is large enough that copying is costly, or if the type already holds something that shouldn't be copied (e.g. a `sync.Mutex`). Value receiver if the method only reads and the struct is small. Then: be consistent across the whole type so the method set is predictable for interfaces.

**Q: If methods don't mutate, why not always use value receivers?**
A: Two reasons. (1) Consistency: if even one method must mutate, mixing kinds breaks interface satisfaction (only `*T` would implement the interface). (2) Copy cost: a value receiver copies the struct on every call; for large or hot-path structs that's measurable. Also, copying a struct that contains a `sync.Mutex` or `sync.WaitGroup` copies the lock — a bug `go vet` will flag.

**Q: Does using a pointer always avoid an allocation / is it always faster?**
A: No. Go's **escape analysis** decides whether a value lives on the stack or heap. Returning a `*T` from a constructor often forces `T` onto the heap (it "escapes"), which adds GC pressure. A small value passed by value can stay entirely on the stack and be faster than chasing a pointer. "Pointer = fast" is folklore; measure with `go build -gcflags=-m` and benchmarks.

**Q: What's the difference between embedding and just having a named field?**
A: A named field `a Animal` requires you to write `d.a.Eat()`. Embedding (`Animal` with no field name) **promotes** Animal's exported fields/methods so you write `d.Eat()` directly, and it lets `Dog` automatically satisfy any interface that `Animal` satisfies. Use a named field when you want delegation but not promotion.

**Q: Is embedding inheritance? Can the embedded method see the outer struct?**
A: No and no. Embedding is composition with automatic delegation. When the inner method runs, its receiver is only the inner value; there is no virtual dispatch back into the outer type. "Overriding" a promoted method just shadows the name for external callers — it does not redirect the inner type's own internal calls.

**Q: Why are some of my struct copies "deep" and others "shallow"?**
A: Copy is a field-by-field bitwise copy. Value fields (numbers, bools, strings, nested structs, arrays) are copied independently. Reference fields (slices, maps, pointers, channels, funcs) copy only the header/pointer, so the copy shares the underlying data. Strings are immutable so the shared backing is harmless; slices and maps are mutable, so sharing surprises people.

**Q: Can two goroutines safely call methods on the same struct?**
A: Not inherently. A struct gives no concurrency guarantees. Reads of immutable fields are fine; concurrent writes, or a write racing a read, are data races. Protect shared mutable state with a `sync.Mutex` (embed or field it), use channels, or hand each goroutine its own copy. (Covered more under concurrency.)

**Q: Why prefer the package as the privacy boundary instead of `private` per field?**
A: It keeps the model tiny — one rule (capitalization) governs all visibility — and it matches Go's unit of compilation and reuse. Tightly coupled types in the same package can share internals freely; the wall goes up at the package edge, which is also the API surface you version and document.

---

## Exercises

1. **Rectangle**: `type Rectangle struct{ Width, Height float64 }`. Methods `Area`, `Perimeter`, `IsSquare`.
2. **Stack** of ints: `Push`, `Pop`, `Peek`, `Len`, `IsEmpty`.
3. **LinkedList** with single field next *Node, value int. Methods: AddAtHead, AddAtTail, Remove, Print.
4. **`Vector2D`**: with `X, Y float64`. Methods: `Add(other)`, `Subtract(other)`, `Magnitude()`. Make `String()` method for printing.
5. **`Queue` with embedded slice**: methods `Enqueue`, `Dequeue` (returns `(int, error)`), `Len`.
6. **`Temperature`** as a named `float64`: methods `Celsius()`, `Fahrenheit()`, `Kelvin()`, and a `String()` that prints `"20.0°C"`. Verify `fmt.Println` uses your `String()`.
7. **`Logger` via embedding**: define `type Logger struct{ prefix string }` with `func (l Logger) Log(msg string)`. Embed `Logger` into `type Service struct{ Logger; name string }` and confirm `svc.Log("up")` works through promotion. Then add `func (s Service) Log(msg string)` and observe shadowing.
8. **Equality**: make a `Point{X,Y int}` usable as a map key and count visits; then add a `[]int` field and show why `==` no longer compiles — switch to `reflect.DeepEqual`.

### Hint for #2 (Stack):

```go
type Stack struct {
    items []int
}

func (s *Stack) Push(x int) {
    s.items = append(s.items, x)
}

func (s *Stack) Pop() (int, bool) {
    if len(s.items) == 0 {
        return 0, false
    }
    last := s.items[len(s.items)-1]
    s.items = s.items[:len(s.items)-1]
    return last, true
}

func (s *Stack) Peek() (int, bool) {
    if len(s.items) == 0 {
        return 0, false
    }
    return s.items[len(s.items)-1], true
}

func (s *Stack) Len() int { return len(s.items) }
```

### Hint for #6 (Temperature as a named float64):

```go
type Temperature float64   // a named type — can carry methods

func (t Temperature) Celsius() float64    { return float64(t) }
func (t Temperature) Fahrenheit() float64 { return float64(t)*9/5 + 32 }
func (t Temperature) Kelvin() float64     { return float64(t) + 273.15 }

func (t Temperature) String() string {
    return fmt.Sprintf("%.1f°C", float64(t))   // float64(t), NOT t — avoids recursion
}
```

---

## What to read next

**Doc 07** — Interfaces: Go's superpower for polymorphism. This is where the *method set* rule (value vs pointer receiver) and the `Stringer` interface introduced above pay off — interfaces are satisfied implicitly by having the right methods, and embedding lets a struct satisfy an interface "for free."

```
→ Foundations/Programming/Go/07-interfaces.md
```

For deeper background while you're here:
- **The Go Tour — Methods and Interfaces:** https://go.dev/tour/methods/1
- **Effective Go — "Embedding" and "Pointers vs. Values":** https://go.dev/doc/effective_go#embedding
- **Go spec — "Struct types" and "Method sets":** https://go.dev/ref/spec#Struct_types
- Prior doc: `05-collections.md` (slices and maps — the reference-field behavior that makes struct copies shallow).

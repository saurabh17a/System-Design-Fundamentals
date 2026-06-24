# Inheritance — Python vs Go

> **Type:** Concept
> **Tags:** `[oop]` `[inheritance]` `[composition]` `[embedding]` `[python]` `[go]`

---

## The concept

**Inheritance** lets a new type (the *subclass/child*) reuse and extend an existing one (the *superclass/parent*), modeling an **"is-a"** relationship: a `Dog` *is an* `Animal`, so it gets `Animal`'s data and behavior for free and can add or override some.

This is the pillar where the two languages diverge most: **Python has full class inheritance (including *multiple* inheritance with an MRO); Go has *no* inheritance at all.** Go gives you **struct embedding** (a composition feature that *looks* a bit like inheritance but isn't), and steers you to [composition over inheritance](06-composition-over-inheritance.md). "Go has no inheritance — how do you reuse code?" is a guaranteed interview question.

## In Python

A subclass lists its parent(s) in parentheses; `super()` calls the parent's version; any method can be **overridden**:

```python
class Animal:
    def __init__(self, name):
        self.name = name
    def speak(self):
        return "..."
    def describe(self):
        return f"{self.name} says {self.speak()}"

class Dog(Animal):                 # Dog IS-A Animal
    def speak(self):               # override
        return "Woof"

class Puppy(Dog):
    def __init__(self, name, age):
        super().__init__(name)     # call parent initializer
        self.age = age

print(Dog("Rex").describe())       # Rex says Woof  (describe reused, speak overridden)
```

**Multiple inheritance** and the **MRO** (Method Resolution Order):

```python
class A:
    def who(self): return "A"
class B(A):
    def who(self): return "B"
class C(A):
    def who(self): return "C"
class D(B, C):                     # inherits from BOTH
    pass

print(D().who())                   # "B"  — by C3 linearization (MRO)
print([c.__name__ for c in D.__mro__])   # ['D', 'B', 'C', 'A', 'object']
```

Python specifics:

- **`super()`** follows the **MRO**, not a fixed parent — crucial with multiple inheritance and **cooperative** `super().__init__()` calls.
- **Multiple inheritance is allowed**; Python resolves the **diamond problem** with **C3 linearization** (a deterministic MRO). Often used for **mixins** (small behavior-only classes).
- **Everything overrides freely** — no `final`; any method can be replaced. `isinstance`/`issubclass` reflect the hierarchy.
- **`object`** is the implicit root of every class.

## In Go

**Go has no classes and no inheritance** — no subclassing, no `extends`, no `super`, no overriding. Code reuse comes from **embedding** a struct (or interface) inside another, which **promotes** the embedded type's fields and methods:

```go
package main

import "fmt"

type Animal struct{ Name string }

func (a Animal) Describe() string { return a.Name + " says " + a.Speak() }
func (a Animal) Speak() string    { return "..." }

type Dog struct {
    Animal          // EMBEDDED (no field name) — composition, not inheritance
    Breed string
}

func main() {
    d := Dog{Animal: Animal{Name: "Rex"}, Breed: "Lab"}
    fmt.Println(d.Name)        // "Rex"   — field promoted from Animal
    fmt.Println(d.Speak())     // "..."   — method promoted from Animal
}
```

The critical catch — **no virtual dispatch / no overriding**:

```go
func (d Dog) Speak() string { return "Woof" }   // Dog has its OWN Speak

d := Dog{Animal: Animal{Name: "Rex"}}
fmt.Println(d.Speak())        // "Woof"  — calling on Dog uses Dog.Speak
fmt.Println(d.Describe())     // "Rex says ..."  ← Animal.Describe calls Animal.Speak, NOT Dog.Speak!
```

`Animal.Describe()` always calls `Animal.Speak()` — embedding does **not** give you polymorphic override the way inheritance would. To get that behavior you use **interfaces** ([polymorphism](05-polymorphism.md)), not embedding.

Go specifics:

- **Embedding = "has-a" that reads like "is-a"** — it promotes fields/methods but is composition. The outer type can *shadow* a promoted method by defining its own, but there's **no upward virtual dispatch**.
- **Interfaces can be embedded too** (e.g. `io.ReadWriter` embeds `Reader` and `Writer`).
- **No `super`** — call the embedded type explicitly: `d.Animal.Speak()`.
- The idiom is to **prefer composition** and use **interfaces for polymorphism** — see [composition-over-inheritance](06-composition-over-inheritance.md).

## Key differences

| | Python | Go |
|---|---|---|
| Inheritance | yes (single + multiple) | **none** |
| Reuse mechanism | subclassing | struct embedding (composition) |
| Override / virtual dispatch | yes (any method) | **no** — embedded methods don't dispatch to outer |
| Call parent | `super()` (MRO-aware) | explicit: `outer.Embedded.Method()` |
| Multiple parents | yes (C3 MRO) | embed multiple structs (no diamond — names just collide) |
| Polymorphism via | inheritance *or* duck typing | interfaces only |

The mental shift: in Python you build **type hierarchies**; in Go you **compose** structs and get polymorphism from **interfaces**. Go's designers omitted inheritance on purpose to avoid fragile hierarchies.

## Commonly asked interview questions

- **"Go has no inheritance — how do you reuse code?"** — struct **embedding** promotes the embedded type's fields/methods (composition), and **interfaces** provide polymorphism. You compose behavior instead of subclassing.
- **"Is Go embedding the same as inheritance?"** — No. It promotes members but there's **no virtual dispatch**: an embedded method calling another method does *not* dispatch to an outer override. It's "has-a," not "is-a."
- **"What is the MRO / diamond problem?"** — with multiple inheritance, which parent's method wins? Python uses **C3 linearization** (`__mro__`) for a deterministic order; `super()` follows it. Go sidesteps it (no inheritance; ambiguous promoted names are a compile error you resolve explicitly).
- **"What does `super()` do?"** — calls the next class in the MRO (not necessarily the literal parent) — enables cooperative multiple inheritance.
- **"When is inheritance the wrong tool?"** — when the relationship isn't truly "is-a," when it creates a fragile base class, or when you only want code reuse (use composition). See LSP below.
- **"Method overriding vs overloading?"** — overriding = subclass replaces a parent method (runtime dispatch); overloading = same name, different signatures (compile-time) — **neither Python nor Go has overloading** ([polymorphism](05-polymorphism.md)).

## Gotchas

- **Fragile base class:** changing a parent silently breaks subclasses that depended on its internal behavior — a core argument for composition.
- **Liskov Substitution violations:** a subclass that breaks the parent's contract (the classic `Square extends Rectangle` where setting width changes height) is unusable polymorphically. See [SOLID — LSP](SOLID/03-liskov-substitution.md).
- **Deep hierarchies:** 4-level inheritance trees are hard to follow and change; prefer shallow + composition.
- **Go embedding ≠ override:** expecting `Animal.Describe()` to call `Dog.Speak()` is the #1 Go embedding mistake — it won't. Use an interface.
- **Python mutable state across MRO:** cooperative `super().__init__()` must be consistent or some initializers get skipped/double-run in diamonds.
- **Ambiguous promotion (Go):** embedding two structs with the same method name makes the call ambiguous — a compile error you resolve by qualifying (`x.A.M()`).

---

*Part of the [OOP overview](four-pillars.md). Prev: [Abstraction](03-abstraction.md) · Next: [Polymorphism](05-polymorphism.md). The "prefer composition" follow-up: [Composition over Inheritance](06-composition-over-inheritance.md), and [SOLID — LSP](SOLID/03-liskov-substitution.md).*

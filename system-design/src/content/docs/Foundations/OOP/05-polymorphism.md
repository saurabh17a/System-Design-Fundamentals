# Polymorphism — Python vs Go

> **Type:** Concept
> **Tags:** `[oop]` `[polymorphism]` `[duck-typing]` `[interfaces]` `[python]` `[go]`

---

## The concept

**Polymorphism** — "many forms" — lets one piece of code work with different types as long as they support the same operation. Write `render(shape)` once; pass a `Circle`, `Square`, or `Triangle`, and the right `area()`/`draw()` runs. The caller is **reused** across types: adding a new type doesn't change the caller.

The two languages reach this differently: **Python uses duck typing (and method overriding); Go uses interfaces (structural).** Notably, **neither has method overloading** (same name, different parameter types) — a common point of confusion.

## In Python

**Duck typing** — "if it walks like a duck…": no shared base needed; if the object has the method, it works:

```python
class Circle:
    def __init__(self, r): self.r = r
    def area(self): return 3.14159 * self.r ** 2

class Square:
    def __init__(self, s): self.s = s
    def area(self): return self.s ** 2

def total_area(shapes):            # works for ANY object with .area()
    return sum(s.area() for s in shapes)

print(total_area([Circle(1), Square(2)]))   # 7.14159  — no common base class
```

**Overriding** (subclass replaces a method) gives runtime dispatch:

```python
class Animal:
    def speak(self): return "..."
class Dog(Animal):
    def speak(self): return "Woof"

for a in (Animal(), Dog()):
    print(a.speak())               # "..." then "Woof" — dispatched by actual type
```

**Operator / protocol polymorphism via dunders** — implement `__len__`, `__eq__`, `__add__`, `__iter__`, `__str__` and your object works with `len()`, `==`, `+`, `for`, `print()`:

```python
class Vector:
    def __init__(self, x, y): self.x, self.y = x, y
    def __add__(self, o): return Vector(self.x + o.x, self.y + o.y)
    def __eq__(self, o):  return (self.x, self.y) == (o.x, o.y)
    def __repr__(self):   return f"Vector({self.x}, {self.y})"

print(Vector(1, 2) + Vector(3, 4))   # Vector(4, 6)
```

Python specifics:

- **Duck typing is the default** — polymorphism without declaring any contract; `Protocol`/ABC add *checkable* contracts ([abstraction](03-abstraction.md)).
- **No overloading** — you can't define two methods with the same name and different signatures; the last definition wins. Use default args, `*args`, or `functools.singledispatch`.
- **Dunder methods** make polymorphism extend to language operators — sometimes called *ad-hoc* polymorphism.

## In Go

Polymorphism comes through **interfaces** (satisfied structurally — see [abstraction](03-abstraction.md)). A function takes an interface; any type with the right methods can be passed:

```go
package main

import "fmt"

type Shape interface { Area() float64 }

type Circle struct{ R float64 }
func (c Circle) Area() float64 { return 3.14159 * c.R * c.R }

type Square struct{ S float64 }
func (s Square) Area() float64 { return s.S * s.S }

func TotalArea(shapes []Shape) float64 {   // works for any Shape
    var sum float64
    for _, s := range shapes {
        sum += s.Area()                    // dynamic dispatch via the interface
    }
    return sum
}

func main() {
    fmt.Println(TotalArea([]Shape{Circle{1}, Square{2}}))  // 7.14159
}
```

**Type switches / assertions** recover the concrete type when needed:

```go
func describe(s Shape) string {
    switch v := s.(type) {
    case Circle: return fmt.Sprintf("circle r=%v", v.R)
    case Square: return fmt.Sprintf("square s=%v", v.S)
    default:     return "unknown"
    }
}
```

Go specifics:

- **Interfaces are the only polymorphism mechanism** — no inheritance-based dispatch ([inheritance](04-inheritance.md)). Dynamic dispatch happens through the interface value.
- **No overloading** — Go forbids two functions with the same name, period; no default args either. Use distinct names or variadic params.
- **No operator overloading** — `+`, `==` work only on built-in types; you can't make `a + b` work for your struct (unlike Python's `__add__`).
- **`Stringer`** (`String() string`) is Go's `__str__` equivalent — the closest to a "dunder."

## Key differences

| | Python | Go |
|---|---|---|
| Main mechanism | duck typing + overriding | interfaces (structural) |
| Contract required? | no (duck typing) | yes — must satisfy the interface |
| Dispatch | by actual type at runtime | dynamic via interface value |
| Method overloading | **no** | **no** |
| Operator overloading | **yes** (dunders: `__add__`, `__eq__`…) | **no** |
| Recover concrete type | `isinstance` / `match` | type switch / assertion `v.(T)` |

Both reuse callers across types; Python is permissive (duck typing, rich operator hooks), Go is explicit and compile-checked (interfaces, no operator overloading).

## Commonly asked interview questions

- **"What is polymorphism, simply?"** — one interface/call working over many types; the caller doesn't change when you add a new type.
- **"Overriding vs overloading?"** — overriding: a subtype replaces a method, dispatched at runtime (Python yes; Go via interfaces, not embedding). Overloading: same name, different signatures, resolved at compile time — **neither Python nor Go supports it**.
- **"How does Go do polymorphism without inheritance?"** — interfaces: a function accepts an interface, and any type implementing its methods can be passed; dispatch is dynamic through the interface.
- **"What's duck typing?"** — Python's "if it has the method, it works" — no shared base or declared interface needed at runtime.
- **"Compile-time vs runtime polymorphism?"** — overloading/generics are compile-time (parametric/ad-hoc); overriding/interface dispatch are runtime (subtype polymorphism). Generics (Python `typing`/Go generics) add parametric polymorphism.
- **"Does Python have operator overloading? Go?"** — Python yes (dunder methods); Go no.
- **"Why is polymorphism better than `if isinstance(...)` chains?"** — push behavior into the types; the caller stays closed to modification as new types arrive ([Open/Closed](SOLID/02-open-closed.md)).

## Gotchas

- **Type-switch / isinstance sprawl:** a growing `switch type` or `if isinstance` chain is an anti-pattern — it means the caller knows every type. Prefer a method on the interface so new types don't touch the caller.
- **Expecting overloading:** defining two same-named methods (Python: last wins silently; Go: compile error). Use defaults/variadics/distinct names.
- **Python `__eq__` without `__hash__`:** defining `__eq__` makes the object unhashable unless you also define `__hash__` — breaks use in sets/dict keys.
- **Go nil interface:** an interface holding a `(*T)(nil)` is not equal to `nil` — a classic bug when returning errors/values via interfaces.
- **Narrowing in an override (LSP):** an override that accepts less or returns more than the base breaks polymorphic callers — see [LSP](SOLID/03-liskov-substitution.md).
- **Leaning on duck typing for critical contracts:** with no declared interface, a missing method fails only at call time; add a `Protocol`/ABC (Python) or interface (Go) where safety matters.

---

*Part of the [OOP overview](four-pillars.md). Prev: [Inheritance](04-inheritance.md) · Next: [Composition over Inheritance](06-composition-over-inheritance.md). Related: [SOLID — Open/Closed](SOLID/02-open-closed.md).*

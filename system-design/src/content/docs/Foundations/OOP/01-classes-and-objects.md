# Classes & Objects — Python vs Go

> **Type:** Concept
> **Tags:** `[oop]` `[classes]` `[objects]` `[python]` `[go]`

---

## The concept

A **class** is a blueprint that bundles **data** (fields/attributes) with the **behavior** (methods) that operates on it. An **object** (or *instance*) is a concrete value built from that blueprint. "Create a `BankAccount` with balance 100" gives you one object; you can make many, each with its own data.

The headline difference you must know for interviews: **Python has classes; Go does not.** Go achieves the same goal — data + behavior together — with **structs + methods + interfaces**, and deliberately omits the class machinery (inheritance hierarchies, constructors, `this`). So "how do you do OOP in Go without classes?" is a classic question, answered on this page and in [composition-over-inheritance](06-composition-over-inheritance.md).

## In Python

A `class` defines fields (set in `__init__`, the initializer) and methods (functions whose first parameter is `self`, the instance):

```python
class BankAccount:
    bank_name = "Acme"                  # class attribute — shared by ALL instances

    def __init__(self, owner, balance=0):
        self.owner = owner              # instance attributes — per object
        self.balance = balance

    def deposit(self, amount):          # instance method; `self` is the object
        self.balance += amount

    @classmethod
    def empty(cls, owner):              # class method; `cls` is the class
        return cls(owner, 0)            # alternative constructor

    @staticmethod
    def is_valid_amount(x):             # static method; no self/cls
        return x > 0


acct = BankAccount("Alice", 100)        # __init__ runs; `acct` is an instance
acct.deposit(50)
print(acct.balance, acct.bank_name)     # 150 Acme
empty = BankAccount.empty("Bob")        # via class method
```

Python specifics worth knowing:

- **`self` is explicit** — every instance method takes `self` as its first parameter (the object it's called on). `acct.deposit(50)` is sugar for `BankAccount.deposit(acct, 50)`.
- **`__init__` is an initializer, not a constructor** — the object already exists (created by `__new__`); `__init__` populates it. There's exactly one per class (no overloading — see [polymorphism](05-polymorphism.md)); use default args or `@classmethod` factories for alternatives.
- **Class vs instance attributes** — `bank_name` is shared by all instances (a common gotcha if it's mutable); `owner`/`balance` are per-instance.
- **Everything is an object** — classes themselves are objects (instances of `type`); functions, modules — all objects.
- **Dunder methods** (`__init__`, `__str__`, `__eq__`, `__len__`…) hook into language operators — covered in [polymorphism](05-polymorphism.md).

## In Go

Go has **no `class` keyword**. You define a **struct** (the data) and attach **methods** via *receivers* (the behavior):

```go
package main

import "fmt"

type BankAccount struct {           // struct = the data
    Owner   string
    Balance int
}

// Method with a POINTER receiver — can mutate the struct.
func (a *BankAccount) Deposit(amount int) {
    a.Balance += amount
}

// Method with a VALUE receiver — gets a copy, can't mutate the original.
func (a BankAccount) Describe() string {
    return fmt.Sprintf("%s: %d", a.Owner, a.Balance)
}

// No constructors in Go — use a factory function by convention.
func NewBankAccount(owner string, balance int) *BankAccount {
    return &BankAccount{Owner: owner, Balance: balance}
}

func main() {
    acct := NewBankAccount("Alice", 100) // factory returns *BankAccount
    acct.Deposit(50)
    fmt.Println(acct.Describe())          // Alice: 150

    // You can also build a struct literal directly:
    b := BankAccount{Owner: "Bob", Balance: 0}
    b.Deposit(10)
}
```

Go specifics worth knowing:

- **The receiver replaces `self`** — `func (a *BankAccount) Deposit(...)` — `a` is the receiver. Methods are defined *outside* the struct body.
- **Value vs pointer receivers** — a **pointer receiver** (`*BankAccount`) can mutate the struct and avoids copying; a **value receiver** (`BankAccount`) operates on a copy. **Rule of thumb: use pointer receivers when you mutate or the struct is large; be consistent across a type's methods.** This distinction has no Python analogue and is a frequent interview point.
- **No constructors** — Go has no special constructor. The convention is a `NewT(...)` factory function returning `*T`. A plain `T{}` literal is also valid (zero-valued fields).
- **Zero values** — an uninitialized struct isn't `null`; every field gets its type's zero value (`0`, `""`, `nil`). Well-designed Go types are "useful at their zero value."
- **No class-level (static) state built in** — package-level variables/functions play that role.

## Key differences

| | Python | Go |
|---|---|---|
| Construct | `class` | `struct` + methods |
| Behavior attach | methods inside class, `self` | methods with a receiver, outside the struct |
| Constructor | `__init__` (initializer) | none — `NewT()` factory convention |
| Mutation control | all methods can mutate `self` | pointer receiver mutates; value receiver copies |
| "Static" members | `@classmethod` / `@staticmethod`, class attrs | package-level funcs/vars |
| Uninitialized | must set in `__init__` | zero values, no null |
| Multiple constructors | no (use classmethods/defaults) | no (use multiple `NewX` funcs) |

The deeper theme: **Python models OOP with rich class machinery; Go models it with plain data (structs) + functions (methods) + contracts (interfaces)**, pushing you toward [composition](06-composition-over-inheritance.md) instead of hierarchies.

## Commonly asked interview questions

- **"Class vs object?"** — class is the blueprint/type; object is a concrete instance with its own data. One class, many objects.
- **"Does Go have classes/OOP?"** — Go has no classes or inheritance, but it *is* object-oriented in spirit: structs hold data, methods attach behavior, interfaces provide polymorphism. It favors composition over inheritance.
- **"Value vs pointer receiver in Go — which and why?"** — pointer receiver to mutate or avoid copying large structs; value receiver for small, immutable-style types. Be consistent per type (mixing causes subtle method-set issues with interfaces).
- **"What's `self` / why is it explicit in Python?"** — it's the instance the method was called on; explicit `self` makes the binding obvious (`obj.m()` ≡ `Class.m(obj)`).
- **"`__init__` vs `__new__`?"** — `__new__` creates the instance, `__init__` initializes it; you almost always override only `__init__`.
- **"Class attribute vs instance attribute?"** — class attribute is shared across all instances; instance attribute is per-object. Mutable class attributes are a shared-state trap.
- **"How do you do alternative constructors?"** — Python: `@classmethod` factories or default args; Go: multiple `NewX` functions.

## Gotchas

- **Mutable default / class attributes (Python):** `class C: items = []` shares one list across all instances; likewise `def f(self, x=[])`. Use `None` + assign in `__init__`.
- **Forgetting `self` (Python):** omitting `self` in a method signature, or forgetting `self.` when accessing a field, is a top beginner error.
- **Value receiver that "mutates" (Go):** a value receiver mutates a *copy* — the original is unchanged. Silent bug; use a pointer receiver.
- **Comparing structs vs identity:** Go compares structs field-by-field with `==` (if all fields comparable); Python `==` uses `__eq__` (identity by default unless overridden — see [polymorphism](05-polymorphism.md)).
- **Assuming Go zero value is null:** it isn't — design types to be valid at zero value, and check for `nil` only on pointers/slices/maps/interfaces.

---

*Part of the [OOP overview](four-pillars.md). Next: [Encapsulation](02-encapsulation.md). Language basics: [Python classes](../Programming/Python/06-classes-and-objects.md), [Go structs & methods](../Programming/Go/06-structs-and-methods.md).*

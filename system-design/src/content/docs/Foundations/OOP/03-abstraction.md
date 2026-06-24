# Abstraction — Python vs Go

> **Type:** Concept
> **Tags:** `[oop]` `[abstraction]` `[interfaces]` `[python]` `[go]`

---

## The concept

**Abstraction** is exposing *what* something does while hiding *how* it does it. You program against a **contract** (a set of operations) rather than a concrete implementation, so you can swap implementations without touching callers. A `PaymentGateway` contract says "I can `charge(amount)`"; whether it's Stripe, PayPal, or a fake for tests is hidden behind that promise.

Where [encapsulation](02-encapsulation.md) hides *state*, abstraction hides *decisions and mechanism*. The mechanisms differ notably: **Python uses Abstract Base Classes (ABCs) and Protocols; Go uses interfaces with implicit, structural satisfaction** — a difference interviewers love because it changes how decoupling works.

## In Python

Two ways to express a contract:

**1. Abstract Base Class (ABC)** — explicit, nominal ("you must declare you implement it"):

```python
from abc import ABC, abstractmethod

class PaymentGateway(ABC):
    @abstractmethod
    def charge(self, amount: int) -> bool:
        ...

class StripeGateway(PaymentGateway):          # explicitly subclasses
    def charge(self, amount: int) -> bool:
        # ... real Stripe call ...
        return True

class FakeGateway(PaymentGateway):            # test double
    def charge(self, amount: int) -> bool:
        return True

def checkout(gateway: PaymentGateway, amount: int):
    if gateway.charge(amount):                # depends on the abstraction
        print("paid")

checkout(StripeGateway(), 100)   # prod
checkout(FakeGateway(), 100)     # tests — same caller
# PaymentGateway()  → TypeError: can't instantiate abstract class
# A subclass that forgets charge() also can't be instantiated.
```

**2. `Protocol`** — structural ("if it has `charge`, it qualifies"), no explicit inheritance, checked by type-checkers:

```python
from typing import Protocol

class Chargeable(Protocol):
    def charge(self, amount: int) -> bool: ...

# Any class with a matching charge() satisfies Chargeable — no subclassing.
```

Python specifics:

- **ABCs** enforce at *instantiation* — you can't create a class with unimplemented `@abstractmethod`s. Nominal: you must subclass.
- **`Protocol`** (PEP 544) gives *structural* typing like Go — duck typing the type-checker understands — without inheritance.
- **Duck typing** is the runtime default: if it has the method, it works; no declared contract needed (see [polymorphism](05-polymorphism.md)). ABC/Protocol add *checkable* contracts on top.

## In Go

Go has one mechanism — the **interface** — and it's satisfied **implicitly and structurally**: a type implements an interface simply by having the right methods. No `implements` keyword, no subclassing.

```go
package main

import "fmt"

type PaymentGateway interface {     // the contract
    Charge(amount int) (bool, error)
}

type StripeGateway struct{}
func (s StripeGateway) Charge(amount int) (bool, error) {
    return true, nil                // real call would go here
}

type FakeGateway struct{}
func (f FakeGateway) Charge(amount int) (bool, error) {
    return true, nil                // test double
}

// checkout depends only on the interface, never the concrete type.
func checkout(g PaymentGateway, amount int) {
    if ok, _ := g.Charge(amount); ok {
        fmt.Println("paid")
    }
}

func main() {
    checkout(StripeGateway{}, 100)  // StripeGateway implements PaymentGateway
    checkout(FakeGateway{}, 100)    // ...just by having Charge()
}
```

Go specifics:

- **Implicit satisfaction** — `StripeGateway` never declares it implements `PaymentGateway`; having `Charge(int) (bool, error)` is enough. This decouples implementations from the interfaces that consume them.
- **Define interfaces where they're *used*, not where types are defined** — the consumer declares the small contract it needs. "Accept interfaces, return structs."
- **Small interfaces are idiomatic** — often one method (`io.Reader`, `io.Writer`, `Stringer`). This is [interface segregation](SOLID/04-interface-segregation.md) baked into the culture.
- **The empty interface** `interface{}` / `any` accepts anything (use sparingly; you lose type safety).

## Key differences

| | Python | Go |
|---|---|---|
| Mechanism | ABC (nominal) or Protocol (structural) | interface (structural) |
| Declaring implementation | ABC: explicit subclass; Protocol: none | none — implicit |
| Enforcement | ABC: at instantiation (runtime); Protocol: type-checker | compile time |
| Where defined | with the base class | idiomatically with the *consumer* |
| Typical size | varies | small, often single-method |
| Runtime fallback | duck typing always works | must satisfy the interface to pass |

Big idea: **Go's implicit interfaces invert the dependency** — a type can satisfy an interface defined in a package it doesn't even import, so consumers own their contracts. Python's ABCs are explicit/nominal; `Protocol` brings Go-style structural typing to Python's type-checker.

## Commonly asked interview questions

- **"Abstraction vs encapsulation?"** — abstraction hides *how/decisions* behind a contract (the interface); encapsulation hides *state* via access control. You use encapsulation to *enforce* the boundaries abstraction *draws*.
- **"Abstract class vs interface?"** — an abstract class (Python ABC) can carry *state and shared implementation* and is inherited explicitly; an interface (Go, or a pure-abstract ABC/Protocol) is a *pure contract* with no implementation, satisfied by having the methods. Go has only interfaces.
- **"How does Go satisfy an interface?"** — implicitly and structurally: a type implements an interface just by having its methods; no `implements`.
- **"Why define Go interfaces at the consumer?"** — keeps contracts small and decouples implementations; the package that *uses* a behavior declares the minimal interface it needs ("accept interfaces, return structs").
- **"ABC vs Protocol in Python?"** — ABC = nominal, runtime-enforced, can share code; Protocol = structural, type-checker-only, no inheritance (Go-like duck typing).
- **"Why abstract at all?"** — to swap implementations (prod vs fake-for-tests, vendor A vs B) without changing callers; it's the basis of [dependency inversion](SOLID/05-dependency-inversion.md) and testability.

## Gotchas

- **Leaky abstraction:** a contract that exposes implementation details (a `getSQLConnection()` on a generic `Repository`) defeats the purpose; callers couple to the "how."
- **Over-abstraction:** an interface with one implementation and no test/seam need is speculative complexity (YAGNI). In Go especially, don't add an interface until a second implementation or a test demands it.
- **Fat interfaces:** large multi-method interfaces force implementers to stub methods they don't need — violates [ISP](SOLID/04-interface-segregation.md). Prefer small ones.
- **Python ABC not enforcing:** forgetting `@abstractmethod` means subclasses can skip the method silently; and ABCs only check at instantiation, not definition.
- **Go `any`/`interface{}` overuse:** accepting `any` discards type safety and pushes errors to runtime type assertions; use concrete interfaces.
- **Nil interface trap (Go):** an interface holding a nil pointer is *not* `== nil` — a notorious bug when returning errors via interfaces.

---

*Part of the [OOP overview](four-pillars.md). Prev: [Encapsulation](02-encapsulation.md) · Next: [Inheritance](04-inheritance.md). Related: [SOLID — DIP](SOLID/05-dependency-inversion.md).*

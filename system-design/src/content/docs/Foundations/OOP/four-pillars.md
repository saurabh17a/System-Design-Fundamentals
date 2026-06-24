# The Four Pillars of OOP — Overview

> **Type:** Guide
> **Tags:** `[oop]` `[foundations]` `[python]` `[go]`

---

Object-Oriented Programming organizes code by bundling **data** with the **operations on that data**. This page is the **map** — a quick mental model and one-paragraph summary of each idea — with links to deep, language-by-language pages (Python vs Go, with code and common interview questions) for each.

> **Prerequisites:** a little Python or Go — [Python classes](../Programming/Python/06-classes-and-objects.md) / [Go structs & methods](../Programming/Go/06-structs-and-methods.md).

## A 30-second mental model

Imagine a coffee machine.

- **Encapsulation:** the tank, heater, and grinder are sealed in the box. You press buttons, not wires.
- **Abstraction:** the "Espresso" button is a *promise* — "press me, get espresso." You don't know the pump-pressure curve.
- **Inheritance:** a "DeluxeMachine" is *a kind of* coffee machine that also froths milk — it reuses the base and adds one thing.
- **Polymorphism:** hand *any* machine to the same `make_morning_coffee(machine)` routine and it just works, because they all respond to "press espresso."

If you remember nothing else: **encapsulation hides state, abstraction hides decisions, inheritance reuses code, polymorphism reuses callers.**

## The big Python ↔ Go theme

The single most important thing to internalize: **Python and Go realize OOP very differently**, and the differences are favorite interview material.

- **Python** has classes, single + multiple **inheritance** (with an MRO), method **overriding**, **operator overloading** (dunder methods), and `@property`. Privacy is by **convention**.
- **Go** has **no classes and no inheritance.** It uses **structs + methods**, **composition via embedding**, and **interfaces** (implicit, structural) for polymorphism. Privacy is **compiler-enforced** by capitalization. No overloading, no operator overloading.

Each deep page below shows *both* and calls out exactly where they diverge.

## The topics (deep dives)

| Topic | What it covers |
|---|---|
| **[Classes & Objects](01-classes-and-objects.md)** | Blueprints vs instances; Python classes vs Go structs+methods; constructors vs `NewT()` factories; value vs pointer receivers. |
| **[Encapsulation](02-encapsulation.md)** | Hiding state & protecting invariants; Python `_`/`__`/`@property` (convention) vs Go capitalization (compiler-enforced, per-package). |
| **[Abstraction](03-abstraction.md)** | Programming to contracts; Python ABCs/Protocols vs Go interfaces (implicit, structural). |
| **[Inheritance](04-inheritance.md)** | "is-a" reuse, overriding, `super`, MRO/diamond — and why **Go has none** (embedding instead). |
| **[Polymorphism](05-polymorphism.md)** | One caller, many types; Python duck typing + dunders vs Go interfaces; why neither has overloading. |
| **[Composition over Inheritance](06-composition-over-inheritance.md)** | "has-a" design; why to favor it; Go enforces it by omitting inheritance. |

Then build on these with the **[SOLID principles](SOLID/01-single-responsibility.md)** and **[design patterns](../DesignPatterns/strategy.md)**.

## Encapsulation vs abstraction (the easy confusion)

- **Encapsulation** hides **state** — access control so callers can't break your invariants. ([deep dive](02-encapsulation.md))
- **Abstraction** hides **decisions/how** — a contract callers depend on instead of the implementation. ([deep dive](03-abstraction.md))

You use encapsulation to *enforce* the boundaries abstraction *draws*.

## Quick cross-questions

- **"Is Go object-oriented?"** — Yes in spirit (data+behavior, polymorphism via interfaces), but it has no classes or inheritance; it favors composition. ([classes](01-classes-and-objects.md), [inheritance](04-inheritance.md))
- **"Inheritance feels powerful — why avoid it?"** — fragile base class, rigid hierarchies, "is-a" that's often wrong; prefer [composition](06-composition-over-inheritance.md).
- **"Abstract class vs interface?"** — abstract class can hold state + shared code and is inherited; an interface is a pure contract satisfied by having the methods. ([abstraction](03-abstraction.md))
- **"Why does Python/Go lack method overloading?"** — both resolve a name to one function; use defaults/variadics/distinct names. ([polymorphism](05-polymorphism.md))
- **"Encapsulation vs abstraction vs information hiding?"** — encapsulation = mechanism (access control); abstraction = exposing a simplified contract; information hiding = the goal both serve.

## What's next

1. Read the six topic pages above in order (they build on each other).
2. Then the **[SOLID principles](SOLID/01-single-responsibility.md)** — design rules built on these pillars.
3. Then **[design patterns](../DesignPatterns/strategy.md)** and the **[Low-Level Design](../../LLD/Python/parking-lot.md)** problems that apply them.

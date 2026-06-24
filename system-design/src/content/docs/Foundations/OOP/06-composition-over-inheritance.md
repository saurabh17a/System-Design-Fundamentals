# Composition over Inheritance — Python vs Go

> **Type:** Concept
> **Tags:** `[oop]` `[composition]` `[inheritance]` `[embedding]` `[design]` `[python]` `[go]`

---

## The concept

**Composition** builds behavior by *combining* objects ("has-a") rather than *subclassing* them ("is-a"). Instead of `Car extends Engine`, a `Car` *has an* `Engine`. The principle **"favor composition over inheritance"** is one of the most-repeated pieces of OOP design advice — and Go elevates it to a language decision by **omitting inheritance entirely**.

Why the bias against inheritance? Inheritance couples a child to a parent's *implementation* (the **fragile base class** problem), forces an "is-a" relationship that's often wrong, and produces rigid, deep hierarchies. Composition keeps pieces small, swappable, and testable. This is a frequent interview discussion — see also [inheritance](04-inheritance.md) and [SOLID — LSP](SOLID/03-liskov-substitution.md).

## In Python

Inheritance is available, but composition is often the better design. Compare:

```python
# Inheritance — rigid: every combination needs a new class, behavior is baked in.
class Animal:
    def speak(self): ...
class Dog(Animal):
    def speak(self): return "Woof"
# Want a RobotDog? GuideDog? A new subclass for each combination...

# Composition — flexible: assemble behavior from parts, swap at runtime.
class Dog:
    def __init__(self, sound_maker, mover):
        self._sound = sound_maker          # HAS-A sound behavior
        self._mover = mover                # HAS-A movement behavior
    def speak(self): return self._sound.make()
    def move(self):  return self._mover.move()

class Bark:
    def make(self): return "Woof"
class Walk:
    def move(self): return "trots"

dog = Dog(Bark(), Walk())                  # mix and match — no new class
print(dog.speak(), dog.move())             # Woof trots
```

Python's **mixins** are a middle ground — small, behavior-only classes combined via multiple inheritance — but plain composition (holding collaborators as attributes) is usually clearer and avoids MRO complexity ([inheritance](04-inheritance.md)).

The litmus test: use **inheritance only for a genuine, stable "is-a"** with a substitutable contract ([LSP](SOLID/03-liskov-substitution.md)); use **composition for "has-a" / "uses-a" / code reuse.**

## In Go

Go *forces* this style: there is **no inheritance**. You compose with struct fields, and **embedding** promotes a collaborator's methods so the outer type can expose them directly:

```go
package main

import "fmt"

// Small, focused behaviors.
type Engine struct{ HP int }
func (e Engine) Start() string { return fmt.Sprintf("vroom (%d hp)", e.HP) }

type GPS struct{}
func (g GPS) Route(to string) string { return "routing to " + to }

// Car HAS-A Engine and GPS — composed, not inherited.
type Car struct {
    Engine          // embedded: Car.Start() is promoted
    nav GPS         // plain field: accessed as car.nav.Route(...)
    Model string
}

func main() {
    c := Car{Engine: Engine{HP: 200}, Model: "Coupe"}
    fmt.Println(c.Start())            // "vroom (200 hp)" — promoted from Engine
    fmt.Println(c.nav.Route("home"))  // explicit field access
}
```

Combine with **interfaces** for polymorphism: a function depends on a small interface ([abstraction](03-abstraction.md)), and you compose concrete types that satisfy it. "Accept interfaces, compose structs" is the whole Go design philosophy in a sentence — and there's no `extends` to misuse. Remember embedding gives **no virtual dispatch** ([inheritance](04-inheritance.md)).

## Why composition wins (concretely)

- **Flexibility:** swap a part at runtime (inject a `FakeEngine` in tests, a `TurboEngine` in prod) without new subclasses.
- **No fragile base class:** parts communicate through small interfaces, so changing one doesn't silently break "children."
- **Avoids combinatorial explosion:** N behaviors compose into many combinations without N×M subclasses.
- **Better testing:** inject fakes for collaborators (dependency injection) — the basis of [DIP](SOLID/05-dependency-inversion.md).
- **Shallower graphs:** flat "has-a" wiring is easier to follow than deep "is-a" trees.

## Key differences

| | Python | Go |
|---|---|---|
| Inheritance available? | yes — but prefer composition | **no** — composition only |
| Reuse via | attributes (composition) or subclassing/mixins | struct fields + embedding |
| Polymorphism | duck typing / overriding / interfaces | interfaces only |
| Risk to avoid | overusing inheritance/mixins (MRO complexity) | expecting embedding to override (it doesn't) |
| "is-a" hierarchies | possible (use sparingly) | not expressible — by design |

Same lesson, enforced differently: Python *recommends* composition; Go *requires* it.

## Commonly asked interview questions

- **"Why favor composition over inheritance?"** — looser coupling (no fragile base class), runtime flexibility, avoids combinatorial subclassing, easier testing via injection, shallower graphs. Inheritance ties you to a parent's implementation and an "is-a" that's often wrong.
- **"When IS inheritance appropriate?"** — a true, stable "is-a" with a substitutable contract (passes [LSP](SOLID/03-liskov-substitution.md)) and genuine shared behavior — e.g. framework base classes you extend as intended.
- **"How does Go reuse code without inheritance?"** — composition via struct fields + embedding (method promotion), plus interfaces for polymorphism. See [inheritance](04-inheritance.md).
- **"Is Go embedding inheritance?"** — no; it's composition with promotion and **no virtual dispatch** — the outer type can't override what the embedded type calls internally.
- **"Composition vs aggregation vs association?"** — composition: owned, lifecycle-bound parts (a `House` *has* `Room`s); aggregation: references to independently-living objects; association: a looser "knows-about." Interviewers mostly want the composition-vs-inheritance contrast.
- **"How does this relate to dependency injection?"** — DI *is* composition: you pass collaborators in (constructor/field) rather than hard-coding/subclassing them — enabling test doubles ([DIP](SOLID/05-dependency-inversion.md)).

## Gotchas

- **Inheritance for code reuse only:** subclassing just to grab a few methods (not a real "is-a") is the classic misuse — compose instead.
- **Deep hierarchies:** more than ~2 levels gets fragile and hard to trace; flatten with composition.
- **Go embedding ≠ override:** relying on an embedded method to call an "overridden" outer method silently fails — use an interface ([inheritance](04-inheritance.md), [polymorphism](05-polymorphism.md)).
- **Over-composition:** wiring dozens of tiny objects can add indirection; balance — not every two-line behavior needs its own injected collaborator.
- **Python mixin soup:** stacking many mixins reintroduces MRO/diamond complexity inheritance was supposed to avoid; prefer explicit composition when it gets confusing.

---

*Part of the [OOP overview](four-pillars.md). Prev: [Polymorphism](05-polymorphism.md). Foundations: [Inheritance](04-inheritance.md), and the [SOLID principles](SOLID/01-single-responsibility.md) that build on these ideas.*

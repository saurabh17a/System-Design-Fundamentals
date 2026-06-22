# LSP — Liskov Substitution Principle

> **The L in SOLID.**
> **Prerequisites:** `02-open-closed.md`.
> **Time to read:** 15 minutes.

> *"Subtypes must be substitutable for their base types."* — Barbara Liskov

---

## What it means

If `B` is a subtype of `A`, then anywhere code expects an `A`, you can pass a `B` and **everything still works correctly**.

If a function accepts `Bird` and you pass it `Penguin`, the function shouldn't break — even though penguins can't fly.

This is what gives polymorphism its power. Without LSP, polymorphism is unreliable.

### Plain-English version (read this first)

Imagine you hire a temp worker through an agency. The agency promises: "anyone we send can do everything the job posting lists." You write your daily plan assuming that promise. If the agency sometimes sends someone who refuses half the tasks — or who quietly does them wrong — your whole plan breaks, even though on paper they have the right job title.

LSP is that promise applied to types. A **base type** is the job posting. A **subtype** (subclass, interface implementation) is a worker the agency might send. LSP says: *every worker must honor the full job posting, with no nasty surprises.* If you can't honor it, you don't belong under that job title — pick a different one.

The trap is that the type name (`Square is-a Rectangle`, `Penguin is-a Bird`) *feels* true in English, so we model it as inheritance. But the type system only checks the **shape** (method names and signatures). It does **not** check the **behavior**. LSP is the human discipline of making sure the behavior matches the shape too.

### The precise/technical version

Liskov & Wing (1994) stated it formally. Let `φ(x)` be a property provable about objects `x` of type `A`. Then `φ(y)` must be true for objects `y` of type `B` where `B` is a subtype of `A`.

In plain terms, this is **behavioral subtyping**, and it imposes three families of rules on an overriding method in the subtype:

| Rule | Direction allowed | Mnemonic |
| --- | --- | --- |
| **Preconditions** (what the method demands of callers) | can only be **weakened** (accept more) | "be liberal in what you accept" |
| **Postconditions** (what the method guarantees on return) | can only be **strengthened** (promise more) | "be conservative in what you return" |
| **Invariants** (facts true before and after every call) | must be **preserved** | "don't break what was always true" |

Plus two structural rules from the type theory of subtyping:

- **Contravariance of method arguments** — a subtype's method may accept a *wider* (super) type for a parameter. (Most languages restrict to identical parameter types; Python/Go don't enforce contravariance, so it's a discipline, not a compiler check.)
- **Covariance of return types** — a subtype's method may return a *narrower* (sub) type for its result.

And one rule about failure:

- **History / exception constraint** — the subtype must not throw checked exceptions outside the set the supertype declared, and must not put the object into a state the supertype's clients couldn't have produced.

If you remember nothing else: **a subtype must be usable wherever its supertype is, with the caller never needing to know which one it got.**

---

## The classic violation — Square is-a Rectangle?

```python
class Rectangle:
    def __init__(self, w, h):
        self._w = w
        self._h = h

    def set_width(self, w): self._w = w
    def set_height(self, h): self._h = h

    def area(self): return self._w * self._h


class Square(Rectangle):
    def __init__(self, side):
        super().__init__(side, side)

    def set_width(self, w):
        self._w = w
        self._h = w    # square: width=height

    def set_height(self, h):
        self._w = h
        self._h = h
```

Looks reasonable: Square IS-A Rectangle, right?

Now write a function that uses Rectangle:

```python
def double_width(r: Rectangle):
    original_height = r._h
    r.set_width(r._w * 2)
    assert r._h == original_height    # height should be unchanged
```

Pass a Rectangle: works.
Pass a Square: **assertion fails**! Setting width also changed height.

`Square` violates LSP. Code written against `Rectangle` breaks when given a `Square`. The "is-a" relationship lied.

### Which rule did it break, exactly?

It broke an **invariant** that `Rectangle`'s clients relied on: *width and height are independent — changing one leaves the other alone.* `Square.set_width` strengthens the coupling between the two fields. The compiler/interpreter is happy because the **shape** matches (`set_width(self, w)` exists), but the **behavior** silently differs.

### Runnable proof

```python
def double_width(r):
    original_height = r._h
    r.set_width(r._w * 2)
    return r._h == original_height    # True means invariant held

class Rectangle:
    def __init__(self, w, h): self._w, self._h = w, h
    def set_width(self, w): self._w = w
    def set_height(self, h): self._h = h
    def area(self): return self._w * self._h

class Square(Rectangle):
    def __init__(self, side): super().__init__(side, side)
    def set_width(self, w): self._w = self._h = w
    def set_height(self, h): self._w = self._h = h

print("Rectangle:", double_width(Rectangle(3, 4)))
print("Square:   ", double_width(Square(5)))
```

Expected output:

```
Rectangle: True
Square:    False
```

> **Takeaway:** A subtype that quietly changes state its parent promised to leave alone breaks every caller written against the parent.

---

## The fix

Different things; don't force a hierarchy.

```python
class Shape(ABC):
    @abstractmethod
    def area(self) -> float: ...

class Rectangle(Shape):
    def __init__(self, w, h): self.w, self.h = w, h
    def area(self): return self.w * self.h

class Square(Shape):
    def __init__(self, side): self.side = side
    def area(self): return self.side ** 2
```

Now there's no false claim about substitutability.

### Why this works

`Rectangle` and `Square` now share only the contract they can *both* honor: "I can compute an `area()`." They are **siblings**, not **parent/child**. There is no `set_width` to lie about, because `Shape` never promised one. Any function written against `Shape` (e.g. `total_area(shapes: list[Shape])`) works for both, forever.

This is the LSP fix pattern in one sentence: **factor the shared, honorable contract into a common supertype; leave the divergent behavior in the leaves.**

---

## What does "still work correctly" mean?

LSP requires subtypes to:

1. **Accept the same inputs.** A subtype can't tighten preconditions. (If parent accepts any int, child can't reject negative ones.)
2. **Produce compatible outputs.** A subtype can't loosen postconditions. (If parent guarantees a positive return, child must too.)
3. **Preserve invariants.** A subtype can't violate guarantees the parent gave. (If `Rectangle.set_width` is supposed to leave height alone, `Square` violates LSP by changing height.)
4. **Not throw new exceptions** that weren't part of the parent's contract.

These rules together = **behavioral subtyping**.

### Each rule with a tiny example

**Rule 1 — don't tighten preconditions (accept at least as much).**

```python
class Parser:
    def parse(self, text: str) -> dict:
        return {"len": len(text)}        # accepts ANY string, including ""

class StrictParser(Parser):
    def parse(self, text: str) -> dict:
        if not text:
            raise ValueError("empty not allowed")   # WRONG: rejects input parent accepted
        return {"len": len(text)}
```

A caller holding a `Parser` reference may legitimately pass `""`. With a `StrictParser` underneath, it now blows up.
*Fix:* `StrictParser` must accept everything `Parser` accepts. If empty strings are genuinely invalid for your use case, that validation belongs in the caller or in a *different* type, not in an override that narrows the parent's promise.

> **Takeaway:** A subtype may accept *more* than its parent, never *less*.

**Rule 2 — don't loosen postconditions (guarantee at least as much).**

```python
class AccountStore:
    def balance(self) -> float:
        return 0.0          # postcondition: returns a non-negative number

class BuggyStore(AccountStore):
    def balance(self) -> float:
        return -1.0         # WRONG: parent's clients assume >= 0
```

> **Takeaway:** A subtype may promise *more* (e.g. always positive), never *less*.

**Rule 3 — preserve invariants.** Covered by the Square example above (width/height independence).

**Rule 4 — no surprise exceptions.** Covered by the Penguin example below (`NotImplementedError` where the parent threw nothing).

---

## A subtler violation

```python
class Bird:
    def fly(self): print("flying")


class Penguin(Bird):
    def fly(self):
        raise NotImplementedError("penguins can't fly")
```

```python
def make_birds_fly(birds: list[Bird]):
    for b in birds:
        b.fly()
```

Pass a list with a Penguin: explosion. The base type promised "all birds can fly," and Penguin breaks that promise.

### Fix: re-think the hierarchy

```python
class Bird(ABC):
    @abstractmethod
    def eat(self): ...

class FlyingBird(Bird):
    def fly(self): ...

class Penguin(Bird):    # not a FlyingBird
    def swim(self): ...
```

The hierarchy now tells the truth. `make_birds_fly` should take `list[FlyingBird]`.

### Runnable before/after

```python
# BEFORE — the lie
class Bird:
    def fly(self): return "flap flap"
class Penguin(Bird):
    def fly(self): raise NotImplementedError("penguins can't fly")

def airshow(birds):
    return [b.fly() for b in birds]

try:
    print(airshow([Bird(), Penguin()]))
except NotImplementedError as e:
    print("crashed:", e)
```

Expected output:

```
crashed: penguins can't fly
```

```python
# AFTER — the truth
from abc import ABC, abstractmethod

class Bird(ABC):
    @abstractmethod
    def eat(self): ...

class FlyingBird(Bird):
    def eat(self): return "seeds"
    def fly(self): return "flap flap"

class Penguin(Bird):
    def eat(self): return "fish"
    def swim(self): return "glide"

def airshow(birds: list[FlyingBird]):
    return [b.fly() for b in birds]

print(airshow([FlyingBird(), FlyingBird()]))   # Penguin simply isn't a valid argument
```

Expected output:

```
['flap flap', 'flap flap']
```

> **Takeaway:** If a subtype can't do a thing the parent promised, it isn't that subtype — split the capability into its own type.

---

## More small examples

### Example A — the "refused gift" override (NULL object done wrong)

```python
class EventLog:
    def append(self, event: str) -> None:
        self._events.append(event)
    def __init__(self): self._events = []
    def all(self): return list(self._events)

class ReadOnlyLog(EventLog):
    def append(self, event: str) -> None:
        raise PermissionError("read-only")   # caller of EventLog never expects this
```

Any function that takes an `EventLog` and calls `append` is a landmine for `ReadOnlyLog`.

*Fix:* read-only is a **narrower** capability, so it belongs **above** the writable type, not below it.

```python
from abc import ABC, abstractmethod

class ReadableLog(ABC):
    @abstractmethod
    def all(self) -> list[str]: ...

class WritableLog(ReadableLog):          # adds capability; never removes
    def __init__(self): self._events = []
    def append(self, event: str) -> None: self._events.append(event)
    def all(self) -> list[str]: return list(self._events)
```

Functions that only read take `ReadableLog`; functions that write take `WritableLog`. A read-only view simply doesn't expose `append`.

> **Takeaway:** Subtypes *add* abilities going down the tree. Removing an ability means you modeled the tree upside-down.

### Example B — strengthening a postcondition (this is allowed!)

```python
class NumberSource:
    def next(self) -> int:
        return 7          # contract: returns an int

class PositiveSource(NumberSource):
    def next(self) -> int:
        return abs(7) or 1   # always >= 1: a STRONGER promise, still an int

def consume(src: NumberSource) -> int:
    n = src.next()
    return n * 2          # only relies on "it's an int"

print(consume(NumberSource()))     # works
print(consume(PositiveSource()))   # works — caller's assumptions still hold
```

Expected output:

```
14
2
```

> **Takeaway:** Promising *more* than the parent is fine and LSP-safe. Promising *less* is the violation.

### Example C — Go: honoring an interface contract, not just its shape

```go
package main

import (
	"errors"
	"fmt"
)

// Account models a contract: Withdraw must reject overdrafts with an error,
// and on success the balance decreases by exactly amount.
type Account interface {
	Withdraw(amount int) error
	Balance() int
}

type Checking struct{ bal int }

func (c *Checking) Withdraw(amount int) error {
	if amount > c.bal {
		return errors.New("insufficient funds")
	}
	c.bal -= amount
	return nil
}
func (c *Checking) Balance() int { return c.bal }

// Sneaky satisfies the SHAPE of Account but breaks the CONTRACT:
// it lets the balance go negative instead of returning an error.
type Sneaky struct{ bal int }

func (s *Sneaky) Withdraw(amount int) error {
	s.bal -= amount // no overdraft check — LSP violation
	return nil
}
func (s *Sneaky) Balance() int { return s.bal }

func payRent(a Account) {
	if err := a.Withdraw(1000); err != nil {
		fmt.Println("declined:", err)
		return
	}
	fmt.Println("paid, balance now", a.Balance())
}

func main() {
	payRent(&Checking{bal: 500}) // expects a decline
	payRent(&Sneaky{bal: 500})   // silently overdraws
}
```

Expected output:

```
declined: insufficient funds
paid, balance now -500
```

`Sneaky` compiles as an `Account` because Go only checks method signatures. But it violates the **behavioral** contract every `Account` consumer relies on.

> **Takeaway:** In Go, "implements the interface" is a compiler fact; "honors the interface" is your job.

---

## Go has fewer LSP traps

Go's interfaces are duck-typed and often tiny (one method). You don't get deep hierarchies, so the most common LSP traps don't even arise. But the principle still applies to interface satisfaction:

```go
type Writer interface {
    Write(p []byte) (int, error)
}

type LossyWriter struct{}
func (LossyWriter) Write(p []byte) (int, error) {
    if len(p) > 100 {
        return 100, nil    // silently drops the rest
    }
    return len(p), nil
}
```

Code expects `Writer.Write(p) -> (n, err)` to write all bytes or return an error. `LossyWriter` lies. Anyone using it as a `Writer` is in trouble.

LSP rule: implement the interface's **contract**, not just its **shape**.

### What the real `io.Writer` contract says

The standard library spells the contract out in the doc comment, and it's a great example of *why* contracts are written in prose, not types:

> `Write` writes `len(p)` bytes from `p` to the underlying data stream. It returns the number of bytes written `n` (`0 <= n <= len(p)`) and any error encountered that caused the write to stop early. `Write` **must return a non-nil error if it returns `n < len(p)`.**

That last sentence is the part `LossyWriter` breaks: it returns `n=100 < len(p)` with a `nil` error. The type signature can't express "must error on short write" — only the documented contract can. LSP is about honoring *that prose*, which is why interface comments in Go libraries are load-bearing, not decoration.

---

## How to spot LSP violations

- **`isinstance` checks** in code that already received an instance — usually means the substitutability is broken.
  ```python
  def process(animal):
      if isinstance(animal, Penguin):
          # special case
          ...
  ```
- **Subtype overrides that throw**.
- **Subtype overrides that change visible state in unexpected ways.**
- **Comments like "don't pass X here, it'll break."**

### A few more smells

- **Empty / no-op overrides** that "disable" a parent method (`def save(self): pass`) — the parent promised it would persist; this one silently doesn't.
- **`NotImplementedError` in a concrete subclass.** That's the parent saying "all my children do this" and a child saying "not me."
- **A subtype whose constructor secretly ignores arguments** the parent uses (e.g. `Square(side)` collapsing `Rectangle(w, h)`), so the object can never reach states the parent's clients assume are reachable.
- **Tests for the parent that you have to skip or weaken for the subtype.** If `Square` can't pass `Rectangle`'s test suite, it isn't a `Rectangle`. This is the single most reliable mechanical detector — see below.
- **Downcasting in callers** (`r.(*Square)` in Go, `cast` in Python). Needing to recover the concrete type means polymorphism already failed.

### The mechanical test: run the parent's tests against the child

The cleanest way to *prove* LSP for a hierarchy is to make the supertype's test suite reusable and feed it every subtype:

```python
import unittest
from abc import ABC, abstractmethod

class Account:
    def __init__(self): self._bal = 100
    def withdraw(self, amt):
        if amt > self._bal: raise ValueError("insufficient")
        self._bal -= amt
        return self._bal

class SavingsAccount(Account):
    pass   # inherits behavior unchanged

# One test base; every subtype reuses it by overriding make().
class AccountContract:
    def make(self): raise NotImplementedError
    def test_withdraw_reduces_balance(self):
        a = self.make()
        self.assertEqual(a.withdraw(40), 60)
    def test_overdraft_raises(self):
        a = self.make()
        with self.assertRaises(ValueError):
            a.withdraw(1000)

class TestAccount(AccountContract, unittest.TestCase):
    def make(self): return Account()

class TestSavings(AccountContract, unittest.TestCase):
    def make(self): return SavingsAccount()   # MUST pass the same suite

if __name__ == "__main__":
    unittest.main(verbosity=2)
```

Expected output (abridged):

```
test_overdraft_raises (...TestAccount...) ... ok
test_withdraw_reduces_balance (...TestAccount...) ... ok
test_overdraft_raises (...TestSavings...) ... ok
test_withdraw_reduces_balance (...TestSavings...) ... ok
```

If you swapped in a subtype that violated the contract, the *parent's own tests* would fail against it. That failing test is LSP catching the bug for you.

---

## Common mistakes / gotchas

### Mistake 1 — modeling with "is-a" from English instead of "behaves-as" from the contract

`Square is-a Rectangle`, `Penguin is-a Bird`, `Circle is-an Ellipse` all read fine in English and all blow up under mutation or capability differences. **Fix:** ask "can this subtype pass every test written for the parent?" not "is this true in a dictionary?"

### Mistake 2 — "fixing" a violation with a type check instead of a redesign

```python
# WRONG: papering over the violation
def make_birds_fly(birds):
    for b in birds:
        if isinstance(b, Penguin):
            continue            # the override that throws is still there, waiting
        b.fly()
```

```python
# RIGHT: the type system enforces it
def make_birds_fly(birds: list[FlyingBird]):
    for b in birds:
        b.fly()                 # a Penguin can't even be in this list
```

The type check version scatters special cases across the codebase and breaks again the moment someone adds an `Ostrich`. The redesign makes the bad call impossible to write.

### Mistake 3 — overriding to throw "not supported"

```python
# WRONG
class ImmutableList(list):
    def append(self, x):
        raise TypeError("immutable")   # every list consumer is now a hazard
```

```python
# RIGHT — don't claim to be a list; expose only the read contract
class ImmutableList:
    def __init__(self, items): self._items = tuple(items)
    def __getitem__(self, i): return self._items[i]
    def __len__(self): return len(self._items)
    def __iter__(self): return iter(self._items)
```

(This is also exactly why Python's standard library gives you `tuple` instead of a frozen subclass of `list`.)

### Mistake 4 — covariant *parameters* (looks safe, isn't)

A subtype that *narrows* a parameter type breaks substitutability, because a caller holding the parent reference may pass the wider type the subtype can't handle.

```python
class Handler:
    def handle(self, msg: object): ...        # accepts anything

class JsonHandler(Handler):
    def handle(self, msg: dict): ...          # WRONG: narrower than parent
```

A caller with a `Handler` may call `handle("a string")`; `JsonHandler` can't honor that. Parameters may be **widened** (contravariant), never **narrowed**. Most teaching examples get this backwards because narrowing *feels* like specialization.

### Mistake 5 — confusing LSP (behavior) with ISP (interface size)

A fat interface that forces implementers to stub methods they can't support often *causes* LSP violations (those stubs throw or no-op). They're related but distinct: ISP says "don't make me depend on methods I don't use"; LSP says "if you claim a method, honor it." Fix the ISP problem and the LSP problem frequently disappears with it. See `04-interface-segregation.md`.

---

## Idioms and best practices

- **Prefer composition over inheritance** when the relationship is "uses-a" or "has-a" rather than a genuine behavioral substitution. A `Stack` that holds a `list` (composition) is safer than a `Stack` that *is* a `list` (inheritance), because the `Stack` exposes only the operations it actually guarantees.
- **Make types immutable when you can.** Most classic LSP traps (Square/Rectangle, Circle/Ellipse) only exist because of mutating setters. Remove the mutation and the hierarchy becomes sound.
- **Write the contract down.** Use docstrings (Python) / interface doc comments (Go) to state preconditions, postconditions, and invariants explicitly. LSP is a contract discipline; you can't honor a contract nobody wrote.
- **Reuse the parent's test suite for every subtype** (the "contract test" pattern above). This turns LSP from a code-review opinion into an automated check.
- **Keep interfaces small** (Go's `io.Writer`, `io.Reader`). The fewer promises a type makes, the fewer it can break.
- **Push capabilities down, never up.** Subtypes should *add* methods/guarantees, not remove or weaken them.

### When NOT to worry about LSP (or inheritance at all)

- **There is no supertype.** A single concrete class with no subclasses and no interface can't violate LSP. Don't introduce an abstract base "for the future" just to have one — that's speculative generality.
- **You're using inheritance purely for code reuse with no polymorphic dispatch**, and the subclass is never passed where the parent is expected. It's still usually better to use composition, but LSP itself isn't being tested if substitution never happens. (Languages like Kotlin force you to opt in with `open`/`final` precisely to make this distinction explicit.)
- **Genuinely immutable value hierarchies** where every subtype trivially satisfies every parent method. LSP holds for free; no extra vigilance needed.
- **You control both the base and all subtypes and the base has no external clients.** The risk is lower (though refactors can still introduce a hidden client). Once a base type is *published* to other teams, LSP becomes non-negotiable.

---

## Cross-questions

### "If I can't subclass safely, what do I do?"

Composition. Or extract an interface that captures only what's truly shared.

### "Isn't this just nitpicky?"

It's not. LSP violations cause **subtle**, **hard-to-debug** bugs because the type system says everything is fine. Future devs trust the type and get burned.

### "What about defensive type checks?"

If a subtype can't do what its parent promised, it's a sign the type isn't really a subtype. Extracting an interface for what IS shared is cleaner than runtime checks.

### "How does LSP relate to OCP?"

OCP says: extend the system without modifying existing code.
LSP says: when you do extend, the new code must keep the contract.

Together: extensions stay sound and don't bring regressions.

### "Is `Square is-a Rectangle` actually wrong in math?"

Mathematically, yes — every square IS a rectangle. The issue is **mutability**. If `Rectangle` is immutable (no `set_width`), then `Square extends Rectangle` is fine. The trouble is the mutating operation, not the geometric relationship.

A reminder that OOP design depends on what the code DOES, not what the type NAMES suggest.

### "Why preconditions weakened but postconditions strengthened — why not the other way around?"

Think about who relies on what. A **caller** must satisfy the method's preconditions and then trusts its postconditions. For substitution to be transparent:
- The subtype must accept *at least* every input the caller was allowed to send → preconditions can only **weaken** (accept more). If the subtype demanded *more*, a previously-valid call would now be rejected.
- The subtype must deliver *at least* every guarantee the caller relied on → postconditions can only **strengthen** (promise more). If the subtype promised *less*, code depending on the guarantee would break.
"Be liberal in what you accept, conservative in what you produce" (Postel's Law) is the same idea.

### "Why not just use duck typing and skip the whole hierarchy?"

Duck typing removes the *compiler's* shape check but not the *behavioral* contract — that's exactly the `LossyWriter`/`Sneaky` case. Whether the language is structurally typed (Go interfaces), dynamically typed (Python), or nominally typed (Java), LSP is about behavior, and behavior isn't enforced by any of them. Duck typing changes *how* you declare conformance, not *whether* you must honor the contract.

### "Does LSP apply to interfaces and protocols, or only class inheritance?"

Both. Anywhere there's polymorphic substitution — a class implementing a `Protocol`, a struct satisfying a Go interface, a function passed where a `Callable` is expected, even an HTTP service implementing an OpenAPI spec — LSP applies. The "subtype" is whatever you can substitute for the declared type.

### "How is this different from simple method overriding gone wrong?"

A bad override is a bug in one place. An LSP violation is a *category* of bug: it makes the type itself untrustworthy, so the failure shows up at every call site that ever receives the subtype, often far from where the override lives. That distance between cause and symptom is what makes LSP violations so expensive.

### "Why does it matter if I'll never actually substitute the subtype?"

Because someone will — the whole point of declaring an inheritance/interface relationship is to advertise "you may substitute me." If you never intend that, you've used the wrong tool (use composition or a `final`/sealed class). The relationship is a promise to *future* code, including code other teams write against your published type.

---

## What's next

```
→ Foundations/OOP/SOLID/04-interface-segregation.md
```

`04-interface-segregation.md` is the natural sequel: many LSP violations are *caused* by fat interfaces that force a type to implement methods it can't honor. ISP shrinks the interface so each implementer can keep every promise — fixing the upstream design problem that made LSP hard to satisfy in the first place. For the mathematical statement, see Liskov & Wing, *"A Behavioral Notion of Subtyping"* (ACM TOPLAS, 1994).

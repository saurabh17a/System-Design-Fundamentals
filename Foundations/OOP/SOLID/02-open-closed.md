# OCP — Open/Closed Principle

> **The O in SOLID.**
> **Prerequisites:** `01-single-responsibility.md`.
> **Time to read:** 15 minutes.

> *"Software entities should be open for extension, but closed for modification."* — Bertrand Meyer

---

## What it means

You should be able to **add new behavior** without **changing existing code**.

When you add a new feature, you write *new* code. You don't modify code that already worked. Old tests still pass; new tests cover the new behavior.

This protects what works and makes the system safer to extend.

### Plain-English version (read this first)

Imagine a wall with light switches. Each switch controls one device. When you buy a new lamp, you want to **add a new switch** — not rip open the wall and re-wire every existing switch. Rewiring the whole wall every time you buy a lamp is dangerous: you might accidentally disconnect the fridge.

Good software is like a wall with a **spare slot** where new switches plug in. The act of "adding a lamp" becomes "snap in a new module," not "open up and edit the things that already work."

- **Open for extension** = there is a clean place to plug in new behavior.
- **Closed for modification** = the existing, tested code does not get touched when you do.

The two halves sound contradictory ("how is something both open and closed?"), but they describe *different things*: the **behavior** is open (you can add more), while the **source code** of the existing pieces is closed (you don't edit it).

### Technical version (the precise statement)

A module obeys OCP with respect to a specific **axis of change** when new requirements along that axis are satisfied by **adding** new artifacts (subclasses, interface implementations, registered handlers, plugins, functions) rather than **editing** existing ones.

The enabling mechanism is **abstraction + late binding**:

1. Callers depend on a stable **abstraction** (an interface, abstract base class, or function type), not on concrete implementations.
2. Concrete behavior is **bound at runtime** (dynamic dispatch, dependency injection, a lookup table) rather than hard-coded at the call site.

Two important refinements engineers get wrong:

- **OCP is always relative to an axis.** No module is closed against *all* possible changes — that would require infinite foresight. You pick the axis you expect to vary (e.g. "more discount types") and close against *that*. A design closed against new discount types is wide open to, say, a change in the discount *function signature*. That is fine and expected.
- **OCP is about source-level and binary-level dependency direction**, not about literally never editing a file. The deeper formulation (Robert C. Martin's) is that the **dependencies point toward the abstraction**: the high-level policy (`final_price`) and the new low-level detail (`PlatinumDiscount`) both depend on `DiscountStrategy`, and neither depends on the other. This is the seed of the Dependency Inversion Principle (the **D** in SOLID).

---

## A violation — `if/elif` ladder

```python
# BAD
class Discount:
    def calculate(self, customer_type, amount):
        if customer_type == "regular":
            return amount * 0.0
        elif customer_type == "premium":
            return amount * 0.10
        elif customer_type == "vip":
            return amount * 0.20
        else:
            raise ValueError(f"unknown: {customer_type}")
```

To add a new customer type "platinum", you must **edit** this class. You risk breaking the others. Tests for `regular`/`premium`/`vip` must be re-run.

**Why this hurts in practice.** Three independent forces collide in one method:

- Every new type re-opens a file that other types live in, so a typo in the `platinum` branch can break `vip` — and your version-control diff/blame now mixes unrelated changes.
- The branches tend to grow tails (logging, A/B flags, currency rules). A 4-line method becomes a 200-line method that no single person fully understands.
- The same `customer_type` string ladder usually appears in *more than one place* (pricing, invoicing, reporting). Adding `platinum` means hunting down every ladder. Miss one and you ship a bug.

---

## Open/closed via polymorphism

```python
from abc import ABC, abstractmethod

class DiscountStrategy(ABC):
    @abstractmethod
    def calculate(self, amount: float) -> float: ...


class RegularDiscount(DiscountStrategy):
    def calculate(self, amount): return 0.0


class PremiumDiscount(DiscountStrategy):
    def calculate(self, amount): return amount * 0.10


class VIPDiscount(DiscountStrategy):
    def calculate(self, amount): return amount * 0.20


# Adding "platinum" later:
class PlatinumDiscount(DiscountStrategy):
    def calculate(self, amount): return amount * 0.30


# The caller doesn't change at all
def final_price(amount: float, discount: DiscountStrategy) -> float:
    return amount - discount.calculate(amount)
```

Adding `PlatinumDiscount` requires **no modification** to existing classes or to `final_price`. The system is **open for extension**, **closed for modification**.

### Run it — expected output

```python
if __name__ == "__main__":
    for d in (RegularDiscount(), PremiumDiscount(), VIPDiscount(), PlatinumDiscount()):
        print(type(d).__name__, "->", final_price(100.0, d))
```

```
RegularDiscount -> 100.0
PremiumDiscount -> 90.0
VIPDiscount -> 80.0
PlatinumDiscount -> 70.0
```

**Takeaway:** new behavior arrived by *adding a class*; `final_price` never changed.

---

## Go example

```go
type Discount interface {
    Calculate(amount float64) float64
}

type Regular struct{}
func (Regular) Calculate(a float64) float64 { return 0 }

type Premium struct{}
func (Premium) Calculate(a float64) float64 { return a * 0.10 }

type VIP struct{}
func (VIP) Calculate(a float64) float64 { return a * 0.20 }

func FinalPrice(amount float64, d Discount) float64 {
    return amount - d.Calculate(amount)
}

// Adding Platinum:
type Platinum struct{}
func (Platinum) Calculate(a float64) float64 { return a * 0.30 }
```

`FinalPrice` and the existing types are untouched.

### Run it — expected output

```go
package main

import "fmt"

func main() {
    discounts := []Discount{Regular{}, Premium{}, VIP{}, Platinum{}}
    for _, d := range discounts {
        fmt.Printf("%T -> %.1f\n", d, FinalPrice(100, d))
    }
}
```

```
main.Regular -> 100.0
main.Premium -> 90.0
main.VIP -> 80.0
main.Platinum -> 70.0
```

**Note the Go idiom:** Go has no `implements` keyword. `Platinum` satisfies `Discount` **structurally** — purely by having a `Calculate(float64) float64` method. This is *duck typing checked at compile time*, and it is OCP's best friend: you can make a **type you don't own** satisfy an interface you define, without editing that type, as long as you can declare the method in your package (or wrap it). Existing code that takes a `Discount` keeps working.

---

## Worked example — Shape area

Coupled-design version (violates OCP):

```python
def total_area(shapes):
    total = 0
    for s in shapes:
        if isinstance(s, Circle):
            total += math.pi * s.r ** 2
        elif isinstance(s, Square):
            total += s.side ** 2
        elif isinstance(s, Triangle):
            total += 0.5 * s.base * s.height
    return total
```

Adding `Pentagon` → modify `total_area`. Risk regression.

OCP version:

```python
class Shape(ABC):
    @abstractmethod
    def area(self): ...

class Circle(Shape):
    def area(self): return math.pi * self.r ** 2

class Square(Shape):
    def area(self): return self.side ** 2

# Add a Pentagon — total_area below NEVER changes
class Pentagon(Shape):
    def area(self): ...

def total_area(shapes):
    return sum(s.area() for s in shapes)
```

`total_area` is closed; new shapes are extensions.

### Run it — expected output

```python
import math
from abc import ABC, abstractmethod

class Shape(ABC):
    @abstractmethod
    def area(self) -> float: ...

class Circle(Shape):
    def __init__(self, r): self.r = r
    def area(self): return math.pi * self.r ** 2

class Square(Shape):
    def __init__(self, side): self.side = side
    def area(self): return self.side ** 2

def total_area(shapes):
    return sum(s.area() for s in shapes)

print(round(total_area([Circle(1), Square(2)]), 4))
```

```
7.1416
```

**Takeaway:** `total_area` knows only `Shape.area()`. The shapes carry their own geometry — the loop is closed.

---

## More small examples

Short, runnable, one idea each. Each shows the OCP "seam" — the single place new behavior plugs in.

### Example A — Registry / table dispatch (Python)

Sometimes you don't even want a class hierarchy; a dictionary of functions is enough and is the most lightweight OCP seam there is.

```python
HANDLERS = {}

def handler(event_type):
    def register(fn):
        HANDLERS[event_type] = fn
        return fn
    return register

@handler("signup")
def on_signup(payload): return f"welcome {payload['user']}"

@handler("purchase")
def on_purchase(payload): return f"charged {payload['amount']}"

def dispatch(event_type, payload):
    return HANDLERS[event_type](payload)   # closed: never edited per new event

# Extension: add a NEW file with @handler("refund") — dispatch() is untouched.
@handler("refund")
def on_refund(payload): return f"refunded {payload['amount']}"

print(dispatch("signup", {"user": "ada"}))
print(dispatch("refund", {"amount": 9.99}))
```

```
welcome ada
refunded 9.99
```

**Takeaway:** a registry turns "edit the `if/elif`" into "add a decorated function" — the dispatcher stays closed. Plugin systems work exactly this way.

### Example B — Strategy injected at construction (Python)

```python
from abc import ABC, abstractmethod

class SortStrategy(ABC):
    @abstractmethod
    def sort(self, data: list) -> list: ...

class Ascending(SortStrategy):
    def sort(self, data): return sorted(data)

class Descending(SortStrategy):
    def sort(self, data): return sorted(data, reverse=True)

class Report:
    def __init__(self, strategy: SortStrategy):
        self.strategy = strategy
    def render(self, rows):
        return self.strategy.sort(rows)

print(Report(Ascending()).render([3, 1, 2]))
print(Report(Descending()).render([3, 1, 2]))
```

```
[1, 2, 3]
[3, 2, 1]
```

**Takeaway:** `Report` is closed to *how* sorting happens; new orderings (e.g. `ByLength`) are new classes injected in, not edits to `Report`.

### Example C — Decoration / wrapping to add behavior (Go)

OCP isn't only about swapping implementations; you can also **wrap** an existing one to layer behavior, leaving both the wrapped type and the caller untouched. This is the Decorator pattern.

```go
package main

import "fmt"

type Greeter interface {
    Greet(name string) string
}

type Plain struct{}
func (Plain) Greet(name string) string { return "Hi " + name }

// LoudGreeter adds behavior by wrapping ANY Greeter — Plain is not edited.
type LoudGreeter struct{ inner Greeter }
func (l LoudGreeter) Greet(name string) string { return l.inner.Greet(name) + "!!!" }

func main() {
    var g Greeter = Plain{}
    fmt.Println(g.Greet("Ada"))
    g = LoudGreeter{inner: g}          // extension by composition
    fmt.Println(g.Greet("Ada"))
}
```

```
Hi Ada
Hi Ada!!!
```

**Takeaway:** composition (wrapping) extends behavior without touching the wrapped type *or* the call site — often a cleaner OCP seam than inheritance.

### Example D — Closing a frozen function against new cases (Python)

Picture `total_area` shipped inside a library you cannot edit. A consumer adds a `Pentagon`. Because the library depends on the `Shape` abstraction, the consumer's new class **slots into the library's loop** without the library ever being recompiled or re-released.

```python
import math
# (Shape, total_area imported from the frozen library)
class Pentagon(Shape):
    def __init__(self, side): self.side = side
    def area(self):
        return (5 * self.side ** 2) / (4 * math.tan(math.pi / 5))

print(round(total_area([Pentagon(2)]), 3))
```

```
6.882
```

**Takeaway:** the real payoff of OCP is *cross-boundary* extension — your code can extend a third party's, and theirs can extend yours, with no source edits on either side.

---

## How to make code OCP-friendly

1. **Identify what varies.** Discount %? Pricing? Sorting algorithm? That's your axis of change.
2. **Capture variability behind an abstraction** (interface, abstract class, function).
3. **Inject** the implementation at runtime (constructor, parameter, registry).

This is the heart of the **Strategy** pattern.

### The mechanisms, ranked from lightest to heaviest

You do not always need an abstract base class. Pick the lightest mechanism that closes your axis of change:

| Mechanism | When it fits | Cost |
| --- | --- | --- |
| **First-class function / callback** | One behavior varies, no shared state | Lowest |
| **Dictionary/table dispatch (registry)** | Many small handlers keyed by a value | Low |
| **Interface + injection (Strategy)** | Behavior has state or several methods | Medium |
| **Decorator / wrapper (composition)** | Adding layers around existing behavior | Medium |
| **Plugin / entry-point system** | Third parties extend you at runtime | Highest |

A useful smell-to-fix table:

| Smell you see | OCP fix |
| --- | --- |
| `if/elif` on a *type* or *kind* string | Polymorphism or registry dispatch |
| `isinstance(...)` chains | A method on the abstraction each subtype overrides |
| `switch`/`match` repeated in several files | One dispatch table all callers share |
| Editing a class every release to add a "mode" | Inject a strategy; add modes as new classes |

---

## When NOT to apply OCP

OCP costs upfront. Don't apply it speculatively.

If a class has 2 cases and you're sure it'll always have 2, an `if/else` is **fine**. OCP shines when the number of cases grows or when third-party code wants to extend yours.

YAGNI ("you aren't gonna need it") and OCP work together: only generalize when the second or third case forces you.

### Concrete "do NOT abstract yet" cases

- **The axis is genuinely binary and stable.** `is_admin` vs `is_not_admin`, `enabled`/`disabled`. An `if` is clearer than a two-class hierarchy that will never grow.
- **You have exactly one implementation and no evidence of a second.** An interface with a single implementer is *speculative generality* — it adds an indirection that obscures the code and helps no one. Add the abstraction when the **second** case actually arrives (the "Rule of Three": refactor on the third occurrence).
- **The variation is in data, not behavior.** If "platinum" differs from "vip" only by a number, a config map `{ "platinum": 0.30 }` beats four classes. Reach for polymorphism when each case has *different logic*, not just a different constant.
- **The cases must be exhaustively known and checked.** In Go, a `switch` over a closed enum that the compiler/linter can verify is *exhaustive* is sometimes safer than an open interface, because adding a case forces every `switch` to be revisited on purpose. Open extension is a feature only when you *want* extension; sometimes you want the compiler to shout.

> Rule of thumb: **one case → write it; two cases → consider it; three cases → abstract it.** Premature OCP is as harmful as no OCP.

---

## Common mistakes

**1. Inheritance for code reuse.**
OCP is about extension via subtypes — not about making a tall inheritance tree to share code.

**2. "Pluggable everything."**
Don't make every method virtual just because. Pick the axis of change that matters.

**3. Forgetting the framework.**
OCP requires that your callers depend on the abstraction (`DiscountStrategy`), not the concrete (`PremiumDiscount`). If they `import PremiumDiscount` directly, you lose the benefit.

### Gotchas with the wrong code and the fix

**Gotcha A — The "closed" function still switches on type.**
You introduced an interface but the caller still inspects concrete types. You've paid for the abstraction and kept the violation.

```python
# WRONG — abstraction exists, but the call site still branches
def final_price(amount, discount):
    if isinstance(discount, VIPDiscount):
        return amount - amount * 0.20      # logic leaked back into the caller
    return amount - discount.calculate(amount)
```

```python
# FIX — caller talks ONLY to the abstraction
def final_price(amount, discount: DiscountStrategy):
    return amount - discount.calculate(amount)
```

**Takeaway:** if a new subtype still forces you to edit the caller, you haven't actually closed it.

**Gotcha B — A leaky base class that new subtypes must edit.**
The base class hard-codes a list of known children, so every new child re-opens the base.

```python
# WRONG — base "knows" its subclasses; adding Platinum edits the base
class DiscountStrategy(ABC):
    KNOWN = ["regular", "premium", "vip"]   # must edit this every time
    @abstractmethod
    def calculate(self, amount): ...
```

```python
# FIX — the base stays ignorant of who extends it; discovery is dynamic
class DiscountStrategy(ABC):
    @abstractmethod
    def calculate(self, amount): ...

def all_strategies():
    return DiscountStrategy.__subclasses__()   # no hard-coded list to maintain
```

**Takeaway:** if extending the abstraction requires editing the abstraction, it isn't closed.

**Gotcha C — Default that swallows new cases silently (Go).**
An exhaustive-looking `switch` with a permissive default hides the fact that a new case was never handled.

```go
// WRONG — new PaymentMethod values silently fall through to 0 fee
func fee(m PaymentMethod) float64 {
    switch m {
    case Card:
        return 0.029
    case ACH:
        return 0.008
    default:
        return 0 // a new "Crypto" method ships with NO fee, no error
    }
}
```

```go
// FIX — let polymorphism carry the fee; new methods bring their own.
type PaymentMethod interface{ Fee() float64 }

type Card struct{}
func (Card) Fee() float64 { return 0.029 }

type ACH struct{}
func (ACH) Fee() float64 { return 0.008 }

// New method = new type with its own Fee(); fee() callers never change.
type Crypto struct{}
func (Crypto) Fee() float64 { return 0.015 }
```

**Takeaway:** a silent `default` turns "I forgot to handle the new case" into a production bug instead of a compile error or explicit failure.

**Gotcha D — Abstracting the wrong axis.**
You made *currency* pluggable but the thing that actually keeps changing is *tax rules*. Now every tax change still edits core code, and you carry a useless `CurrencyStrategy`. Fix: instrument what actually varies (look at your git history — the file that changes every sprint *is* your axis of change) and close against that.

---

## Idioms and best practices

- **Program to the abstraction at the boundary.** Functions accept the interface (`DiscountStrategy`, `io.Reader`); only the composition root (`main`, a factory, a DI container) names concretes.
- **Prefer composition over inheritance** for adding behavior (Decorator, Strategy). Inheritance couples you to the parent's internals; composition keeps the seam clean.
- **Keep the abstraction narrow.** A small interface (one or two methods) is easy to implement and easy to keep stable — which is the whole point, since the abstraction is the *closed* part. (This dovetails with the **I**nterface Segregation Principle.)
- **Let new code register itself** (decorators, plugin entry points, `__init_subclass__`, Go `init()` registration) so adding a case is genuinely *add a file*, never *edit a file*.
- **Write a test that asserts the seam.** A test that loops over *all* discovered strategies and checks the contract (e.g. "discount never exceeds the amount") will automatically cover future strategies — the test is itself open for extension.
- **Stop when it stops paying.** OCP that nobody extends is just indirection tax. If after a year only one implementation exists, inline it.

---

## Cross-questions

### "Isn't the if/else version simpler?"

For 2-3 cases, yes. But the cost of one `if/else` chain is small; the cost of refactoring 50 of them when requirements explode is huge. OCP is a hedge against future change.

### "What if I really need to modify existing code?"

Then do it — OCP is a guideline, not a law. But pause: are you modifying because requirements changed, or because the original design didn't anticipate the new case? If it's the latter, refactoring toward OCP first is wise.

### "Doesn't this just hide the if/else inside polymorphic dispatch?"

Yes — but the runtime dispatch is the OS/language's job, not yours. The point is that the **call site** doesn't change. New types add themselves; callers stay the same.

### "Does OCP apply to data?"

Sort of. Adding a field to a struct is a "modification." But if old code keeps working with the old fields, you've extended in spirit. Schema migrations — backwards-compat columns, versioned APIs — are OCP applied to data.

### "Why polymorphism and not a big `switch`/`match`?"

Two reasons. First, **locality of change**: with polymorphism the knowledge of "how a VIP discount works" lives in one class; with a `switch` it's smeared across however many files contain that `switch`. Second, **diff safety**: adding a class touches only new lines, so code review and `git blame` stay meaningful, and you can't accidentally break a sibling case. A `switch` is acceptable when the set of cases is *closed and exhaustively checked* — that's the inverse situation, where you *want* the compiler to force a revisit.

### "Why an interface and not just inheritance from a concrete base class?"

A concrete base class invites two problems: subclasses depend on (and can break against) the parent's implementation details, and you can only inherit from one parent. An **interface / abstract method** says only "you must provide this behavior" without dictating how — so implementers stay decoupled, and a type can satisfy several interfaces. Use a base class only to share genuinely common *implementation*, and even then prefer composing a helper over inheriting one.

### "OCP says 'closed for modification' — does that mean I can never touch the file again?"

No. It means you shouldn't have to touch it *to satisfy the change you designed the seam for*. Bug fixes, refactors, and changes along a *different* axis are all fair game. "Closed" is relative to one axis of variation, never absolute.

### "How is this different from the Strategy / Decorator / Plugin patterns?"

It isn't different — those patterns are *implementations* of OCP. OCP is the principle (the "why"); Strategy/Decorator/Template-Method/registry/plugins are the mechanisms (the "how"). If someone asks "which pattern gives me OCP here?", the answer is "whichever one cleanly captures the axis that varies."

### "How does OCP relate to the other SOLID letters?"

It sits in the middle of the chain. **SRP** tells you *where* the seam goes (one axis of change per module). **LSP** keeps the seam *safe* (any new subtype must be substitutable, or `final_price` breaks for some types). **DIP** describes the *dependency direction* OCP relies on (both caller and new implementation depend on the abstraction). In short: SRP finds the seam, OCP installs it, LSP keeps it honest, DIP names the direction.

---

## What's next

```
→ Foundations/OOP/SOLID/03-liskov-substitution.md
```

Read `03-liskov-substitution.md` next: OCP lets you add new subtypes freely, and LSP is the rule that keeps those subtypes from quietly breaking the callers that trusted the abstraction. After the SOLID set, see any notes on the **Strategy**, **Decorator**, and **Template Method** patterns for the concrete designs that realize OCP, and `Foundations/OOP/SOLID/05-dependency-inversion.md` for the dependency-direction story OCP depends on.

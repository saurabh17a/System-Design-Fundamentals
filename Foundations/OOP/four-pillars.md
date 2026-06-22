# The Four Pillars of OOP

> **Prerequisites:** A bit of Python or Go (`Foundations/Programming/{Python,Go}/06-classes...`).
> **Time to read:** 35 minutes.

Object-Oriented Programming is a way of organizing code where you bundle **data** and the **operations on that data** into objects. The "four pillars" are the core ideas that make OOP work:

1. **Encapsulation** — bundling data and behavior, controlling access
2. **Abstraction** — exposing what something does, hiding how it does it
3. **Inheritance** — building new types from existing ones
4. **Polymorphism** — different types behaving like the same thing

Let's go through each with code in **both Python and Go**, plus when each pillar earns its keep.

### A 30-second mental model (plain English)

Imagine a coffee machine.

- **Encapsulation:** the water tank, heating element, and grinder are sealed inside the box. You interact with buttons, not wires.
- **Abstraction:** the "Espresso" button is a *promise* — "press me, get espresso." You don't know (or care) about pump pressure curves.
- **Inheritance:** a "DeluxeMachine" is *a kind of* coffee machine that also froths milk. It reuses everything the base machine does and adds one thing.
- **Polymorphism:** you hand any machine — basic or deluxe — to the same `make_morning_coffee(machine)` routine, and it just works because they all respond to "press the espresso button."

If you remember nothing else: **encapsulation hides state, abstraction hides decisions, inheritance reuses code, polymorphism reuses callers.**

---

## 1. Encapsulation

### What it is

Encapsulation = grouping related data and the methods that act on it into a single unit, and **controlling access** to its internals.

Think of a TV remote. Buttons (public interface). Wires and circuits (private internals). You can change the channel without knowing how the IR signal is encoded. The remote *encapsulates* its complexity.

#### Plain-English version

You put the *stuff* (data) and the *rules for changing the stuff* (methods) in the same box, and you only let the outside world touch the stuff through those rules. Nobody reaches into your wallet and edits the number directly; they hand you cash and you update the balance yourself, applying your own checks.

#### Precise/technical version

Encapsulation is the bundling of state and the operations on that state into a single construct (a class, struct, or module), combined with **access control** that restricts which parts of the program can read or mutate that state. The set of operations exposed forms the type's *public interface*; everything else is an *implementation detail* protected by an *invariant* — a condition the type guarantees is always true (e.g. "balance is never negative"). Access control is what lets the type *enforce* its invariants, because all state transitions funnel through code the type controls.

### Why bother?

- **Reduce bugs.** If only `BankAccount.Withdraw()` can change the balance, you can't accidentally set `balance = -1000000` from somewhere random.
- **Keep changing easy.** If the internals change but the interface stays the same, callers don't break.
- **Reason locally.** A class with 5 methods is easier to understand than 50 free functions sharing 50 variables.
- **Enforce invariants in one place.** "Balance never goes negative" is checked inside `withdraw`, not re-checked at all 40 call sites.

### Python

```python
class BankAccount:
    def __init__(self, owner, balance=0):
        self.owner = owner
        self._balance = balance      # convention: _ means "private"

    def deposit(self, amount):
        if amount <= 0:
            raise ValueError("amount must be positive")
        self._balance += amount

    def withdraw(self, amount):
        if amount > self._balance:
            raise ValueError("insufficient funds")
        self._balance -= amount

    @property
    def balance(self):
        return self._balance         # read-only access


acct = BankAccount("Alice", 100)
acct.deposit(50)
acct.withdraw(30)
print(acct.balance)    # 120

# acct._balance = -1_000_000     ← Python allows it but the _ says "don't"
```

Python doesn't enforce private. The `_balance` convention says "internal — don't touch." This is "we're all adults here" — trust the convention.

### Go

```go
package main

import (
    "errors"
    "fmt"
)

type BankAccount struct {
    Owner   string
    balance int    // lowercase = unexported (package-private)
}

func NewBankAccount(owner string, balance int) *BankAccount {
    return &BankAccount{Owner: owner, balance: balance}
}

func (a *BankAccount) Deposit(amount int) error {
    if amount <= 0 {
        return errors.New("amount must be positive")
    }
    a.balance += amount
    return nil
}

func (a *BankAccount) Withdraw(amount int) error {
    if amount > a.balance {
        return errors.New("insufficient funds")
    }
    a.balance -= amount
    return nil
}

func (a *BankAccount) Balance() int {
    return a.balance
}

func main() {
    acct := NewBankAccount("Alice", 100)
    acct.Deposit(50)
    acct.Withdraw(30)
    fmt.Println(acct.Balance())    // 120
}
```

Go enforces visibility through capitalization: `Owner` is public, `balance` is private to the package.

### More small examples

**Example A — the invariant you can't break (Python).** A name-and-double `_` triggers name-mangling, which makes accidental access harder (not impossible).

```python
class Temperature:
    def __init__(self, celsius=0):
        self.__celsius = celsius          # __ → name-mangled to _Temperature__celsius

    @property
    def celsius(self):
        return self.__celsius

    @celsius.setter
    def celsius(self, value):
        if value < -273.15:
            raise ValueError("below absolute zero")
        self.__celsius = value

    @property
    def fahrenheit(self):
        return self.__celsius * 9 / 5 + 32


t = Temperature(25)
print(t.celsius)        # 25
print(t.fahrenheit)     # 77.0
t.celsius = 100
print(t.fahrenheit)     # 212.0
try:
    t.celsius = -300
except ValueError as e:
    print(e)            # below absolute zero
```

Expected output:
```
25
77.0
212.0
below absolute zero
```

**Takeaway:** A property setter is the cleanest place to enforce an invariant — the field looks like a plain attribute to callers but is guarded.

**Example B — encapsulating a derived value so it can't drift (Go).** Keep the source of truth private and expose only a computed view.

```go
package main

import "fmt"

type Cart struct {
    items []int // prices in cents; unexported so callers can't desync the total
}

func (c *Cart) Add(priceCents int) {
    c.items = append(c.items, priceCents)
}

func (c *Cart) TotalCents() int {
    sum := 0
    for _, p := range c.items {
        sum += p
    }
    return sum
}

func main() {
    var c Cart
    c.Add(199)
    c.Add(450)
    fmt.Println(c.TotalCents()) // 649
}
```

Expected output:
```
649
```

**Takeaway:** Don't store a redundant `total` field that callers might forget to update — encapsulate the items and *derive* the total. One source of truth, zero drift.

### Common mistakes

- **Making everything private.** Then nothing's testable or composable. Default to as private as the use case allows, no more.
- **Making everything public.** Then changing internals breaks every caller.
- **Adding getters/setters everywhere just because.** If a getter just returns the field and a setter just assigns, you've added boilerplate without encapsulation. Use them when there's actually a check or transformation.

**Gotcha 1 — leaking a mutable internal (Python).** Returning your internal list hands callers a key to your private state.

```python
# WRONG — caller can mutate your internals behind your back
class Playlist:
    def __init__(self):
        self._songs = []
    def add(self, song):
        self._songs.append(song)
    def songs(self):
        return self._songs          # leaks the live list!

p = Playlist()
p.add("A")
p.songs().append("B")               # bypassed add()!
print(p._songs)                     # ['A', 'B'] — invariant violated
```

```python
# FIX — return a copy (or a read-only view)
class Playlist:
    def __init__(self):
        self._songs = []
    def add(self, song):
        self._songs.append(song)
    def songs(self):
        return list(self._songs)    # defensive copy
    def __iter__(self):
        return iter(self._songs)    # or expose iteration, not the container
```

**Gotcha 2 — exporting a struct field in Go because "it's easier".** Once `balance int` becomes `Balance int`, *any* code in the program can write `acct.Balance = -999` and your `Withdraw` checks are pointless. Keep the field unexported and expose a `Balance()` method.

**Gotcha 3 — confusing `_name` with enforcement (Python).** A single underscore is a *hint*, not a wall. `acct._balance = -1` runs fine. If you truly want to discourage access, use `__name` (name-mangling). Even that is not security — it's a speed bump.

### Idioms and best practices

- **Python:** start fields public; promote to `@property` only when you need a check, a computed value, or backwards-compatible access after refactoring a plain attribute. This is the "uniform access principle" — callers write `obj.x` whether `x` is stored or computed.
- **Go:** unexported fields + a constructor (`NewXxx`) + small exported methods is the standard recipe. Constructors are where you validate inputs so a struct can never exist in an invalid state.
- **When NOT to bother:** plain data holders (DTOs, config structs, value records) with no invariants. A `struct Point{X, Y int}` or a Python `@dataclass` with public fields is *fine* — adding getters/setters there is pure ceremony.

---

## 2. Abstraction

### What it is

Abstraction = exposing the **essential** behavior, hiding implementation details.

If encapsulation is "don't touch my internals," abstraction is "don't even *think* about my internals."

A car's pedals are an abstraction. You press the gas → car goes. You don't need to know about fuel injection, ignition timing, transmission. The interface is small and stable; the engine has changed dramatically over a century.

In code: define an **interface** (the contract) separate from the **implementation** (how the contract is fulfilled).

#### Plain-English version

Abstraction is naming *what* you can do without saying *how* it's done. "Send this email" is an abstraction; the SMTP handshake is the implementation. You program against the verb, and someone (maybe future-you) supplies the machinery.

#### Precise/technical version

Abstraction defines a **contract** — a named set of operations with input/output types and documented behavior — independent of any concrete realization. Callers depend on the contract (the abstract type), not on a specific implementing type. This is the foundation of the **Dependency Inversion Principle**: high-level policy depends on an abstraction; low-level details implement that abstraction. The payoff is *substitutability* — any conforming implementation can be plugged in without recompiling or rewriting the caller.

### Why bother?

- **Swap implementations** without changing callers. (See: dependency injection.)
- **Build to contracts.** Two teams can work in parallel: one writes against the interface, another implements it.
- **Test with fakes.** Pass a fake email-sender to your code; assert it was called.

### Python

```python
from abc import ABC, abstractmethod

class PaymentGateway(ABC):
    @abstractmethod
    def charge(self, amount_cents: int, card_token: str) -> str:
        """Return a receipt id, raise on failure."""
        ...


class StripeGateway(PaymentGateway):
    def charge(self, amount_cents, card_token):
        # ...real Stripe API call
        return "stripe_txn_xyz"


class FakeGateway(PaymentGateway):    # for tests
    def __init__(self):
        self.calls = []
    def charge(self, amount_cents, card_token):
        self.calls.append((amount_cents, card_token))
        return "fake_txn_1"


def checkout(gateway: PaymentGateway, total_cents: int, token: str):
    receipt = gateway.charge(total_cents, token)
    return f"Paid! Receipt: {receipt}"

# Production
print(checkout(StripeGateway(), 1000, "tok_real"))
# Tests
fake = FakeGateway()
checkout(fake, 1000, "tok_fake")
assert fake.calls == [(1000, "tok_fake")]
```

`checkout` doesn't care which gateway. The abstraction is the contract — `charge(amount, token) -> receipt`.

### Go

```go
type PaymentGateway interface {
    Charge(amountCents int, cardToken string) (string, error)
}

type StripeGateway struct{}
func (StripeGateway) Charge(amount int, token string) (string, error) {
    return "stripe_txn_xyz", nil
}

type FakeGateway struct {
    Calls []struct{ Amount int; Token string }
}
func (f *FakeGateway) Charge(amount int, token string) (string, error) {
    f.Calls = append(f.Calls, struct{ Amount int; Token string }{amount, token})
    return "fake_txn_1", nil
}

func Checkout(g PaymentGateway, total int, token string) (string, error) {
    return g.Charge(total, token)
}
```

Go's interfaces are duck-typed: anything with a matching `Charge` method satisfies `PaymentGateway` automatically.

### More small examples

**Example A — `Protocol`: abstraction with zero inheritance (Python).** Since 3.8, `typing.Protocol` gives you Go-style structural typing — a class conforms by *shape*, not by inheriting an ABC.

```python
from typing import Protocol

class Notifier(Protocol):
    def send(self, msg: str) -> None: ...

class SlackNotifier:                 # does NOT inherit Notifier
    def send(self, msg: str) -> None:
        print(f"[slack] {msg}")

class EmailNotifier:                 # also does NOT inherit
    def send(self, msg: str) -> None:
        print(f"[email] {msg}")

def alert(n: Notifier, msg: str) -> None:
    n.send(msg)

alert(SlackNotifier(), "deploy done")   # [slack] deploy done
alert(EmailNotifier(), "deploy done")   # [email] deploy done
```

Expected output:
```
[slack] deploy done
[email] deploy done
```

**Takeaway:** Use `Protocol` when you want the duck-typing freedom of Go interfaces in Python; a type checker like `mypy` verifies conformance without forcing a base class.

**Example B — accept an interface you don't own (Go).** The standard library's `io.Writer` is the textbook small abstraction: one method, used everywhere.

```go
package main

import (
    "fmt"
    "os"
    "strings"
)

// Report depends on the abstraction io.Writer, not on a file or a buffer.
func WriteReport(w fmt.Stringer) {} // (illustrative — see real version below)

func Report(w *strings.Builder) {} // not this either

// The idiomatic version:
func PrintReport(w interface{ Write([]byte) (int, error) }, line string) {
    w.Write([]byte(line + "\n"))
}

func main() {
    PrintReport(os.Stdout, "to the console")   // goes to terminal
    var buf strings.Builder
    PrintReport(&buf, "to a buffer")           // goes to memory
    fmt.Print(buf.String())                    // to a buffer
}
```

Expected output:
```
to the console
to a buffer
```

**Takeaway:** Define abstractions as the *smallest* method set a caller needs (Go: "accept interfaces, return structs"). A one-method interface is easy to satisfy and easy to fake in tests.

### Common mistakes

- **Premature/over-abstraction.** Introducing an interface with exactly one implementation that will never have another adds indirection for no benefit. Wait for the *second* implementation (or a test fake) before extracting the interface.
- **Fat interfaces.** A 12-method interface forces every implementer (and every fake) to implement all 12. This violates the **Interface Segregation Principle**. Prefer several small interfaces.

**Gotcha — forgetting to implement an abstract method (Python).** ABCs catch this at *instantiation* time, which is nice; but only if you actually inherit the ABC.

```python
from abc import ABC, abstractmethod

class Repo(ABC):
    @abstractmethod
    def get(self, id: int) -> str: ...

# WRONG — forgot to implement get
class BrokenRepo(Repo):
    pass

# BrokenRepo()  → TypeError: Can't instantiate abstract class BrokenRepo
#                 with abstract method get

# FIX
class MemoryRepo(Repo):
    def __init__(self): self._data = {}
    def get(self, id): return self._data.get(id, "")
```

In Go the analogous mistake is caught at *compile* time — if `MemoryRepo` is passed where a `Repo` interface is expected but lacks a method, the build fails.

### Idioms and best practices

- **Depend on abstractions at boundaries** (DB, network, clock, filesystem), so the rest of your code is testable without I/O.
- **Keep interfaces tiny.** Go's `io.Reader`/`io.Writer` (one method each) are the gold standard.
- **When NOT to abstract:** internal helpers, leaf code, and anything with a single stable implementation. Concrete is simpler than abstract; only pay for indirection when you'll spend the substitutability.

### Encapsulation vs Abstraction — easy to confuse

- **Encapsulation** = bundling data + methods, hiding internals.
- **Abstraction** = exposing only essential behavior via a stable interface.

A class can encapsulate without abstracting (single concrete class, no interface). It rarely abstracts without encapsulating. Abstraction is a design choice; encapsulation is a structural one.

One-liner to keep them apart: **encapsulation hides the *data*; abstraction hides the *implementation decisions* behind a contract.**

---

## 3. Inheritance

### What it is

Inheritance = a new type **reuses** the data and behavior of an existing type, optionally extending or overriding.

```
       Animal
      /      \
    Dog      Cat
```

`Dog` and `Cat` are Animals. They get whatever `Animal` provides, plus extras of their own.

#### Plain-English version

A child type says "I'm just like my parent, plus/minus a few things." You write the shared parts once in the parent; each child gets them for free and tweaks what's different.

#### Precise/technical version

Inheritance establishes an **is-a** relationship and creates a subtype: instances of the child are usable wherever the parent type is expected. The child inherits the parent's fields and methods; it may **add** new members, **override** existing methods (replace the implementation while keeping the signature), and — in some languages — call the overridden parent version via `super`. Inheritance couples the child to the parent's *implementation*, not just its interface, which is the root of most of its problems.

### Why bother?

When two types share a lot of logic, inheriting from a common parent saves repetition and expresses the "is-a" relationship.

### Python

```python
class Animal:
    def __init__(self, name):
        self.name = name

    def describe(self):
        return f"{self.name} is a {type(self).__name__}"


class Dog(Animal):
    def speak(self):
        return f"{self.name} says Woof!"


class Puppy(Dog):
    def speak(self):                 # override
        return f"{self.name} says Yip!"


d = Dog("Rex")
print(d.describe())    # Rex is a Dog
print(d.speak())       # Rex says Woof!
p = Puppy("Buddy")
print(p.speak())       # Buddy says Yip!
```

`Puppy` inherits everything from `Dog` and overrides `speak`.

### Go — inheritance via composition

Go has no `extends` keyword. Instead, you **embed** one struct in another:

```go
type Animal struct {
    Name string
}
func (a Animal) Describe() string {
    return fmt.Sprintf("%s is an Animal", a.Name)
}

type Dog struct {
    Animal    // embedded
    Breed string
}
func (d Dog) Speak() string {
    return d.Name + " says Woof!"
}
```

Now `Dog` has access to `Animal.Name` and `Animal.Describe()` automatically:

```go
d := Dog{Animal: Animal{Name: "Rex"}, Breed: "Lab"}
fmt.Println(d.Describe())    // Rex is an Animal
fmt.Println(d.Speak())       // Rex says Woof!
```

### More small examples

**Example A — calling the parent with `super()` (Python).** Extend behavior instead of fully replacing it.

```python
class Account:
    def __init__(self, balance):
        self.balance = balance
    def withdraw(self, amount):
        if amount > self.balance:
            raise ValueError("insufficient funds")
        self.balance -= amount
        return amount

class FeeAccount(Account):
    FEE = 1
    def withdraw(self, amount):
        # reuse the parent's checks/logic, then add a fee
        total = super().withdraw(amount + self.FEE)
        return total - self.FEE

a = FeeAccount(100)
got = a.withdraw(30)
print(got)            # 30
print(a.balance)      # 69  (100 - 30 - 1 fee)
```

Expected output:
```
30
69
```

**Takeaway:** `super().method()` lets a child *augment* a parent's behavior rather than copy-paste it; the parent's invariant check still runs.

**Example B — overriding a promoted method in Go embedding.** Embedding promotes the parent's method, but the child can shadow it.

```go
package main

import "fmt"

type Logger struct{ Prefix string }
func (l Logger) Log(msg string) { fmt.Println(l.Prefix + msg) }

type TimestampLogger struct {
    Logger          // embedded; Log is promoted
}
func (t TimestampLogger) Log(msg string) {   // shadows Logger.Log
    t.Logger.Log("[ts] " + msg)              // call the embedded version explicitly
}

func main() {
    t := TimestampLogger{Logger{Prefix: "APP: "}}
    t.Log("started")    // APP: [ts] started
}
```

Expected output:
```
APP: [ts] started
```

**Takeaway:** Go embedding *looks* like inheritance (methods are promoted), but you can override by defining a same-named method and still reach the embedded one via the field name. It is composition with a syntactic shortcut, not subtyping of the outer struct.

### The dark side of inheritance

Inheritance is **easy to overuse**. Common pitfalls:

**1. Deep hierarchies.**
```
Animal → Mammal → Carnivore → Cat → DomesticCat → PersianCat → ...
```
You get rigid coupling and "what was that method" confusion.

**2. The fragile base class.**
Change the parent → break all children. Children depend on parent's *implementation*, not just its interface.

**3. Forced fit.**
Trying to make `Square` extend `Rectangle` and discovering `setWidth()` breaks invariants.

**4. Multiple inheritance complications.**
Diamond problem: `D` inherits from both `B` and `C`, both of which inherit from `A`. What does `D.method()` use?

#### The fragile base class, made concrete

This is the classic trap — a base class that calls its own method, which a subclass overrides, silently breaking the base's internal assumption:

```python
class Counter:
    def __init__(self):
        self._items = []
    def add(self, item):
        self._items.append(item)
    def add_all(self, items):
        for it in items:
            self.add(it)        # base calls its own add()

class DedupCounter(Counter):
    def add(self, item):        # override
        if item not in self._items:
            self._items.append(item)

c = DedupCounter()
c.add_all([1, 1, 2])
print(c._items)                 # [1, 2]  — works, but ONLY because add_all
                                # happens to route through add(). If a future
                                # refactor of the BASE inlines append() into
                                # add_all, dedup silently breaks.
```

Expected output:
```
[1, 2]
```

**Takeaway:** When a base class calls its own overridable methods, subclasses become coupled to the base's *internal call sequence* — an undocumented contract that breaks on refactor. This is exactly why "composition over inheritance" exists.

#### The Square/Rectangle Liskov violation, in code

```python
class Rectangle:
    def __init__(self, w, h):
        self._w, self._h = w, h
    def set_width(self, w):  self._w = w
    def set_height(self, h): self._h = h
    def area(self): return self._w * self._h

class Square(Rectangle):          # "a square is-a rectangle"... right?
    def set_width(self, w):
        self._w = self._h = w     # must keep sides equal
    def set_height(self, h):
        self._w = self._h = h

def stretch_and_check(r: Rectangle):
    r.set_width(5)
    r.set_height(4)
    assert r.area() == 20, f"expected 20, got {r.area()}"

stretch_and_check(Rectangle(1, 1))   # OK
stretch_and_check(Square(1, 1))      # AssertionError: expected 20, got 16
```

**Takeaway:** `Square` *is-a* `Rectangle` in geometry but **not** in behavior — it can't honor the substitutability the base promises (independent width/height). This violates the **Liskov Substitution Principle**. The fix is usually: don't inherit; model `Shape` with an `area()` contract and make `Square` and `Rectangle` siblings.

### "Composition over inheritance"

Modern advice — not "never inherit," but "default to composition."

```python
# Instead of Dog(Animal):
class Dog:
    def __init__(self, name):
        self.animal = Animal(name)    # has-a, not is-a

    def describe(self):
        return self.animal.describe()
```

Cumbersome in trivial cases — but as systems grow, composition's flexibility wins.

In Go, the language nudges you this direction by making inheritance unavailable (you only have embedding, which is composition with a method-promotion shortcut).

#### Why composition wins, concretely

Suppose you need behaviors that combine independently: a logger can be *timestamped* and/or *buffered*. With inheritance you'd face a combinatorial explosion of subclasses (`TimestampedLogger`, `BufferedLogger`, `TimestampedBufferedLogger`, ...). With composition you assemble them:

```python
class Writer:
    def write(self, msg): print(msg)

class Timestamped:
    def __init__(self, inner): self.inner = inner
    def write(self, msg):      self.inner.write("[ts] " + msg)

class Uppercased:
    def __init__(self, inner): self.inner = inner
    def write(self, msg):      self.inner.write(msg.upper())

# Mix and match at runtime — no new classes needed:
w = Timestamped(Uppercased(Writer()))
w.write("hello")            # [ts] HELLO
```

Expected output:
```
[ts] HELLO
```

**Takeaway:** Composition lets behaviors combine N×M without N×M classes. This is the Decorator pattern — see `Foundations/DesignPatterns`.

### Idioms and best practices

- **Use inheritance only for genuine "is-a" with a stable base and shallow depth (1–2 levels).**
- **Prefer interfaces/protocols + composition** for "can-do" or "has-a" relationships.
- **Make base classes either abstract or final-by-intent.** A base meant to be subclassed should document which methods are overridable and how they interact; otherwise mark it `@final` (Python `typing.final`) / keep its struct unembedded.
- **When NOT to use it:** to share unrelated utility code (use a free function or a helper object), or to bolt on optional behaviors (use composition/decorators).

---

## 4. Polymorphism

### What it is

Polymorphism = the **same call** does **different things** depending on the actual type behind it.

"Poly" = many. "Morphism" = forms. Many forms.

#### Plain-English version

You write one instruction — "everybody, speak!" — and each object answers in its own voice. The caller doesn't branch on type; the object knows what to do.

#### Precise/technical version

The pillar usually called "polymorphism" in OOP is **subtype (runtime) polymorphism**: a value of a static type (the interface/base) dispatches a method call to the implementation of its *dynamic* (actual) type at runtime — "dynamic dispatch." There are other kinds worth naming so you can answer the interview question:

- **Ad-hoc polymorphism** — overloading: the same name, different implementations chosen by argument types (Go and Python lack true overloading; Python uses default args / `functools.singledispatch`).
- **Parametric polymorphism** — generics: one implementation that works for many types uniformly (Python type vars / Go generics with `[T any]`).
- **Subtype polymorphism** — the four-pillars kind, via interfaces or base classes.

When this doc says "polymorphism" unqualified, it means subtype polymorphism.

### Why bother?

You can write code once that works for many types:

```python
def make_them_speak(animals):
    for a in animals:
        print(a.speak())
```

Pass it a list of `Dog`, `Cat`, `Cow`, `Robot` — all work, as long as each has `speak()`.

The deeper payoff: **it kills `if/elif` type-switching.** Instead of `if isinstance(a, Dog): ... elif isinstance(a, Cat): ...`, each type carries its own behavior, and adding a new type doesn't touch the caller.

### Python — duck typing

```python
class Dog:
    def speak(self): return "Woof"

class Cat:
    def speak(self): return "Meow"

class Robot:
    def speak(self): return "Beep"

for animal in [Dog(), Cat(), Robot()]:
    print(animal.speak())
```

Python doesn't care that `Robot` isn't an `Animal`. **If it walks like a duck and quacks like a duck, it's a duck.** As long as it has `speak()`, it works.

### Python — with explicit base class

```python
from abc import ABC, abstractmethod

class Animal(ABC):
    @abstractmethod
    def speak(self): ...

class Dog(Animal):
    def speak(self): return "Woof"

class Cat(Animal):
    def speak(self): return "Meow"
```

More explicit; catches missing implementations at instantiation time.

### Go — interfaces

```go
type Speaker interface {
    Speak() string
}

type Dog struct{}
func (Dog) Speak() string { return "Woof" }

type Cat struct{}
func (Cat) Speak() string { return "Meow" }

func MakeNoise(s Speaker) {
    fmt.Println(s.Speak())
}

MakeNoise(Dog{})    // Woof
MakeNoise(Cat{})    // Meow
```

Same idea, structural — `Dog` is a `Speaker` because it has the right method.

### Worked example — Shape area

This is the canonical polymorphism example.

**Python:**

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
    def __init__(self, s): self.s = s
    def area(self): return self.s ** 2

class Triangle(Shape):
    def __init__(self, base, height):
        self.base, self.height = base, height
    def area(self): return 0.5 * self.base * self.height


shapes = [Circle(3), Square(4), Triangle(5, 6)]
total = sum(s.area() for s in shapes)
print(f"Total area: {total:.2f}")
```

Expected output:
```
Total area: 59.27
```
(28.27 + 16 + 15 = 59.27)

**Go:**

```go
type Shape interface {
    Area() float64
}

type Circle struct{ R float64 }
func (c Circle) Area() float64 { return math.Pi * c.R * c.R }

type Square struct{ S float64 }
func (s Square) Area() float64 { return s.S * s.S }

type Triangle struct{ Base, Height float64 }
func (t Triangle) Area() float64 { return 0.5 * t.Base * t.Height }

func TotalArea(shapes []Shape) float64 {
    total := 0.0
    for _, s := range shapes {
        total += s.Area()
    }
    return total
}
```

Adding a new shape (e.g., `Pentagon`) doesn't change `TotalArea`. **Open for extension, closed for modification** — see SOLID/OCP.

### More small examples

**Example A — polymorphism replaces a type switch (Python).** Watch the smell disappear.

```python
# SMELL — the caller must know every type, and grows on each new one:
def describe_bad(shape):
    if isinstance(shape, Circle):
        return "round"
    elif isinstance(shape, Square):
        return "boxy"
    # ...add an elif for every new shape forever

# BETTER — push the behavior into the types:
class Circle:
    def describe(self): return "round"
class Square:
    def describe(self): return "boxy"

def describe_good(shape):
    return shape.describe()

print(describe_good(Circle()))   # round
print(describe_good(Square()))   # boxy
```

Expected output:
```
round
boxy
```

**Takeaway:** A growing `isinstance`/`type ==` chain is a sign you want polymorphism — move the behavior onto the objects so the caller stays closed to modification.

**Example B — the `error` interface is polymorphism you already use (Go).** Anything with `Error() string` is an `error`.

```go
package main

import "fmt"

type NotFound struct{ ID int }
func (e NotFound) Error() string { return fmt.Sprintf("id %d not found", e.ID) }

type Timeout struct{ Seconds int }
func (e Timeout) Error() string { return fmt.Sprintf("timed out after %ds", e.Seconds) }

func handle(err error) {
    fmt.Println("handling:", err) // err.Error() called polymorphically
}

func main() {
    handle(NotFound{ID: 7})    // handling: id 7 not found
    handle(Timeout{Seconds: 30}) // handling: timed out after 30s
}
```

Expected output:
```
handling: id 7 not found
handling: timed out after 30s
```

**Takeaway:** Go's built-in `error` is a one-method interface; every custom error type you write is subtype polymorphism in action.

### Common mistakes

**Gotcha 1 — overriding with an incompatible signature (Python).** Python won't stop you, but you've broken substitutability.

```python
class Renderer:
    def render(self, data): ...

# WRONG — narrows what callers can pass; breaks polymorphic use
class JsonRenderer(Renderer):
    def render(self, data, *, pretty):   # now REQUIRES pretty
        ...

# A caller that does r.render(data) works for Renderer but crashes for JsonRenderer.
# FIX — keep the contract; make additions optional with a default:
class JsonRenderer(Renderer):
    def render(self, data, *, pretty=False):
        ...
```

**Gotcha 2 — the nil-interface trap (Go).** A non-nil interface can hold a nil pointer, so `err != nil` is true even when the underlying value is nil.

```go
type MyErr struct{}
func (*MyErr) Error() string { return "boom" }

func do() error {
    var p *MyErr = nil
    return p          // returns a non-nil error holding a nil *MyErr!
}

// if err := do(); err != nil {  // TRUE — surprising
//     ...
// }
// FIX: return a literal nil, not a typed nil pointer:
func doFixed() error {
    return nil
}
```

**Takeaway:** In Go, an interface is nil only when *both* its type and value are nil. Don't return typed nil pointers as errors.

### Idioms and best practices

- **Program to the interface, not the implementation.** Accept `Shape`/`Speaker`/`io.Writer`, not the concrete type.
- **Keep polymorphic methods cohesive.** Every implementer should be able to satisfy the contract meaningfully; if one implementer has to `raise NotImplementedError`, your interface is too wide (split it — ISP).
- **When NOT to reach for it:** when there's exactly one behavior and never will be another. A single `if` is clearer than an interface + one implementation. Add the abstraction when the *second* case appears.

---

## Putting it together — A small game

A worked example that uses all four pillars:

```python
from abc import ABC, abstractmethod

# Abstraction: contract for any "Combatant"
class Combatant(ABC):
    @abstractmethod
    def attack(self) -> int: ...

    @abstractmethod
    def take_damage(self, amount: int): ...


# Encapsulation: HP is private; only take_damage modifies it
class Character(Combatant):
    def __init__(self, name, hp, strength):
        self.name = name
        self._hp = hp
        self._strength = strength

    @property
    def is_alive(self):
        return self._hp > 0

    def take_damage(self, amount):
        self._hp = max(0, self._hp - amount)

    def attack(self):
        return self._strength


# Inheritance: Warrior IS-A Character with extra ability
class Warrior(Character):
    def attack(self):
        return self._strength * 2    # warriors hit harder


class Mage(Character):
    def attack(self):
        return self._strength + 5    # mages add spell bonus


# Polymorphism: same `fight` works for any Combatant pair
def fight(a: Combatant, b: Combatant):
    while a.is_alive and b.is_alive:
        b.take_damage(a.attack())
        if not b.is_alive: break
        a.take_damage(b.attack())


w = Warrior("Conan", hp=100, strength=10)
m = Mage("Gandalf", hp=80, strength=8)
fight(w, m)
print(f"{w.name}: alive={w.is_alive}")
print(f"{m.name}: alive={m.is_alive}")
```

- **Encapsulation:** `_hp` and `_strength` are internal; only methods modify HP.
- **Abstraction:** `Combatant` is the contract — `fight` doesn't know what's behind it.
- **Inheritance:** `Warrior` and `Mage` extend `Character`.
- **Polymorphism:** `attack()` returns different damage for different classes.

### Tracing the output

Let's hand-simulate so the example isn't a black box. Warrior attack = 20/turn, Mage attack = 13/turn.

| Turn | Action | Conan HP | Gandalf HP |
|------|--------|---------:|-----------:|
| start |       |     100 |        80 |
| 1 | Conan hits Gandalf for 20 |  100 |  60 |
| 1 | Gandalf hits Conan for 13 |   87 |  60 |
| 2 | Conan hits for 20 |           87 |  40 |
| 2 | Gandalf hits for 13 |         74 |  40 |
| 3 | Conan hits for 20 |           74 |  20 |
| 3 | Gandalf hits for 13 |         61 |  20 |
| 4 | Conan hits for 20 |           61 |   0 |

Gandalf reaches 0 on turn 4; the loop `break`s before Gandalf retaliates. Final state:

```
Conan: alive=True
Gandalf: alive=False
```

**Takeaway:** Because `fight` depends only on the `Combatant` *contract*, you can drop in a brand-new class (say, `Archer`) with its own `attack()` and `fight` needs zero changes — all four pillars cooperating.

---

## Common cross-questions

### "When should I use OOP vs functional?"

OOP shines when **data and behavior coevolve** — the operations naturally cluster around the same data. Inventory items, users, orders.

Functional shines when **data flows through transformations** — pipelines, ETL, math. Each transformation is a pure function.

Most real systems are mixed. Don't be religious.

### "Is Go object-oriented?"

Yes-ish. Go has methods, interfaces, encapsulation (via package boundaries), polymorphism (via interfaces), and composition (via embedding). It lacks classical inheritance. So Go does OOP — minus the heavy hierarchies. Most modern OOP advice ("composition over inheritance," "favor interfaces") matches Go's defaults.

### "Inheritance feels powerful — why avoid it?"

Inheritance creates **strong coupling** between parent and child. Changes ripple. Tests get harder. The hierarchy locks in early decisions. Composition gives you the same reuse with less coupling.

Use inheritance for genuine "is-a" relationships with **stable** parents and limited depth (1–2 levels). Use composition for everything else.

### "Why is encapsulation important if I'm the only one writing the code?"

Future you. In 6 months you'll forget exactly how `_balance` was supposed to be modified, and accidentally bypass `withdraw()`. Encapsulation is a note to your future self.

### "What's the difference between abstract class and interface?"

- **Interface** (Python `Protocol` or ABC, Go `interface`) = a set of method signatures, no implementation.
- **Abstract class** = a partial class with some methods implemented, some abstract. Children must implement the abstract ones.

Use interface when there's no shared logic to give. Use abstract class when there's reusable logic plus required overrides. (Go has no abstract class.)

### "Why prefer duck typing (or Go structural interfaces) over a base class?"

Both decouple the caller from concrete types, but structural/duck typing also decouples the *implementer*: a type can satisfy `Notifier` or `io.Writer` **without importing it or inheriting from it**. That means you can make types you don't own (or stdlib types) fit your abstraction, and you avoid forcing every implementer into one inheritance tree. The cost is that conformance is implicit — a type checker (`mypy` with `Protocol`, the Go compiler) restores the safety net.

### "Is overloading polymorphism? Why don't Python and Go have it?"

Overloading (same name, different parameter types resolved at compile time) is *ad-hoc* polymorphism — a different kind from the subtype polymorphism this doc focuses on. Python resolves names at runtime on a single object, so it uses default arguments, `*args`, or `functools.singledispatch` instead. Go deliberately omits overloading to keep dispatch rules simple and code unambiguous; you use distinct names (`Print`, `Printf`, `Println`) or generics for type-uniform code.

### "Encapsulation vs abstraction vs information hiding — aren't these the same?"

They overlap but aren't identical. **Information hiding** is the design *principle* (hide decisions likely to change). **Encapsulation** is the *mechanism* that enforces it (access control bundling state with methods). **Abstraction** is the *result you expose* (a simplified contract). You encapsulate *in order to* hide information *so you can* present a clean abstraction.

### "Does using interfaces/polymorphism hurt performance?"

Usually negligibly, but know the mechanism. Dynamic dispatch costs an indirect call (a vtable/itable lookup) versus a direct call the compiler could inline. In hot inner loops in Go this can matter; profile before optimizing. In Python everything is dynamic anyway, so polymorphism adds no extra cost over normal method calls. Rule of thumb: **design for clarity first; optimize dispatch only when a profiler points at it.**

---

## What's next

Now that you've got the four pillars, layer the **SOLID principles** on top:

```
→ Foundations/OOP/SOLID/01-single-responsibility.md
```

Or jump to design patterns and see the pillars in action:

```
→ Foundations/DesignPatterns/strategy.md
```

### What to read next (deeper dives)

- **Liskov Substitution in depth** — why `Square`/`Rectangle` breaks: `Foundations/OOP/SOLID/03-liskov-substitution.md`
- **Open/Closed Principle** — the "add a shape without touching `TotalArea`" idea formalized: `Foundations/OOP/SOLID/02-open-closed.md`
- **Interface Segregation** — why fat interfaces hurt: `Foundations/OOP/SOLID/04-interface-segregation.md`
- **Dependency Inversion / Injection** — the payoff behind the `PaymentGateway` example: `Foundations/OOP/SOLID/05-dependency-inversion.md`
- **Decorator & Strategy patterns** — composition-over-inheritance made into reusable patterns: `Foundations/DesignPatterns/`
- **Generics** — parametric polymorphism, the kind this doc only mentioned: `Foundations/Programming/Go/generics.md`, `Foundations/Programming/Python/typing.md`

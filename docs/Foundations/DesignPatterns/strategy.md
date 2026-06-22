# Strategy Pattern

> **Category:** Behavioral
> **Difficulty:** ⭐ (easiest pattern; start here)
> **Prerequisites:** OOP four pillars; ideally SOLID OCP + DIP.
> **Time to read:** 18 minutes.

---

## In one sentence (plain English)

Strategy lets you **swap out one step of an algorithm at runtime** the way you swap a drill bit. The drill (your code) stays the same; you pop in the bit (the strategy) that fits the job in front of you — wood, metal, masonry — and pull the trigger. The drill doesn't need to know which bit is loaded; it just spins.

Translate that into code: you have a piece of behavior that comes in **several interchangeable flavors** (how to pay, how to sort, how to compress). Instead of hard-coding all the flavors inside one function with a big `if/else`, you give each flavor its own small object that all share the **same method name**. Your main code holds one of those objects and just calls the method, never caring which flavor it actually got.

### The precise / technical version

Strategy is a **behavioral design pattern** that defines a family of algorithms, encapsulates each one in a separate type, and makes them interchangeable behind a common interface. It lets the algorithm **vary independently** from the client that uses it.

Formally there are three roles:

1. **Strategy** — the interface (or abstract base / protocol / single-method interface) declaring the operation, e.g. `pay(amount)`.
2. **Concrete Strategy** — each implementation: `CreditCardPayment`, `PayPalPayment`, …
3. **Context** — the object that holds a reference to a Strategy and delegates to it. It exposes its own API (`checkout()`) and calls `strategy.execute()` internally. The Context **does not** know which concrete strategy it holds.

The key property the strategies must satisfy is **substitutability (Liskov)**: same kind of input, same kind of output, no surprising side effects. If you can't swap one for another without the Context noticing, it isn't really Strategy.

---

## The problem

You have an algorithm that varies. Different customers want **different** versions of the same operation:

- Discount calculation: regular / premium / VIP / new-year promo.
- Sorting: by price / by rating / by popularity.
- Compression: gzip / lz4 / none.

A naive `if/elif` chain handles 2-3 cases. By case 7, the function is a mess and you're scared to add case 8.

### What the naive version looks like (and why it rots)

```python
def checkout(cart, method):
    total = sum(p for _, p in cart.items)
    if method == "card":
        return f"Charged ${total} to card"
    elif method == "paypal":
        return f"Charged ${total} via PayPal"
    elif method == "crypto":
        return f"Sent ${total} of BTC"
    # ...and every new method edits THIS function forever
    else:
        raise ValueError("unknown method")
```

Every new payment method forces you to **open and edit `checkout` again**. That violates the Open/Closed Principle (open for extension, closed for modification). The function grows unbounded, mixes unrelated concerns (card validation, PayPal redirects, BTC wallet checks) in one body, and becomes hard to unit-test in isolation — to test the crypto path you must construct a whole cart and hit the right branch. Strategy turns each `elif` body into its own testable, independently shippable object.

---

## The pattern

Encapsulate each algorithm in its own class, behind a common interface. The client picks **which** algorithm at runtime by holding a reference to the strategy object.

### Structure (ASCII)

```
        ┌──────────────────────┐
        │    <<interface>>     │
        │      Strategy        │
        │  + execute(...)      │
        └──────────┬───────────┘
                   │
        ┌──────────┼──────────┐
        ▼          ▼          ▼
  ┌─────────┐ ┌─────────┐ ┌─────────┐
  │Strategy │ │Strategy │ │Strategy │
  │   A     │ │   B     │ │   C     │
  └─────────┘ └─────────┘ └─────────┘

  ┌─────────────┐
  │  Context    │ ──holds──► Strategy
  │             │
  │ doWork() →  │   delegates to strategy.execute(...)
  └─────────────┘
```

The **Context** doesn't know which concrete strategy it has; it just calls `execute()`.

### How control flows at runtime (sequence)

```
Client            Context              ConcreteStrategyB
  │  setStrategy(B)  │                        │
  │─────────────────►│  (stores reference)    │
  │                  │                        │
  │  doWork()        │                        │
  │─────────────────►│   execute(args)        │
  │                  │───────────────────────►│
  │                  │      result            │
  │                  │◄───────────────────────│
  │   result         │                        │
  │◄─────────────────│                        │
```

Read it top to bottom: the client first **injects** a strategy, then calls the Context's own method, and the Context **delegates** the variable step to whatever strategy it happens to hold. Swap `B` for `C` and the diagram is identical — that sameness is the whole point.

---

## Python

```python
from abc import ABC, abstractmethod

class PaymentStrategy(ABC):
    @abstractmethod
    def pay(self, amount: float) -> str: ...


class CreditCardPayment(PaymentStrategy):
    def __init__(self, card_number, cvv):
        self.card_number = card_number
        self.cvv = cvv

    def pay(self, amount):
        return f"Charged ${amount} to card ending {self.card_number[-4:]}"


class PayPalPayment(PaymentStrategy):
    def __init__(self, email):
        self.email = email

    def pay(self, amount):
        return f"Charged ${amount} via PayPal account {self.email}"


class CryptoPayment(PaymentStrategy):
    def __init__(self, wallet):
        self.wallet = wallet

    def pay(self, amount):
        return f"Sent ${amount} worth of BTC to {self.wallet}"


class Cart:
    def __init__(self):
        self.items = []
        self.payment_strategy: PaymentStrategy | None = None

    def add(self, item, price):
        self.items.append((item, price))

    def set_payment(self, strategy: PaymentStrategy):
        self.payment_strategy = strategy

    def checkout(self):
        total = sum(p for _, p in self.items)
        if not self.payment_strategy:
            raise ValueError("no payment method")
        return self.payment_strategy.pay(total)


# Use:
cart = Cart()
cart.add("Book", 20)
cart.add("Pen", 3)

cart.set_payment(CreditCardPayment("4111111111111111", "123"))
print(cart.checkout())    # Charged $23 to card ending 1111

cart.set_payment(PayPalPayment("alice@x.com"))
print(cart.checkout())    # Charged $23 via PayPal
```

`Cart` doesn't know about cards or PayPal — it just calls `pay()`. Adding `ApplePay` requires zero changes to `Cart`.

---

## Go

```go
package main

import "fmt"

type PaymentStrategy interface {
    Pay(amount float64) string
}

type CreditCard struct{ Number, CVV string }
func (c CreditCard) Pay(a float64) string {
    return fmt.Sprintf("Charged $%.2f to card ending %s", a, c.Number[len(c.Number)-4:])
}

type PayPal struct{ Email string }
func (p PayPal) Pay(a float64) string {
    return fmt.Sprintf("Charged $%.2f via PayPal %s", a, p.Email)
}

type Crypto struct{ Wallet string }
func (c Crypto) Pay(a float64) string {
    return fmt.Sprintf("Sent $%.2f worth of BTC to %s", a, c.Wallet)
}

type Cart struct {
    Items   []struct{ Name string; Price float64 }
    Payment PaymentStrategy
}

func (c *Cart) Add(name string, price float64) {
    c.Items = append(c.Items, struct{ Name string; Price float64 }{name, price})
}

func (c *Cart) Checkout() (string, error) {
    if c.Payment == nil {
        return "", fmt.Errorf("no payment method")
    }
    total := 0.0
    for _, i := range c.Items {
        total += i.Price
    }
    return c.Payment.Pay(total), nil
}

func main() {
    cart := &Cart{}
    cart.Add("Book", 20)
    cart.Add("Pen", 3)

    cart.Payment = CreditCard{Number: "4111111111111111", CVV: "123"}
    if r, err := cart.Checkout(); err == nil {
        fmt.Println(r)
    }

    cart.Payment = PayPal{Email: "alice@x.com"}
    if r, err := cart.Checkout(); err == nil {
        fmt.Println(r)
    }
}
```

In Go, with single-method interfaces, you can also pass a function:

```go
type PaymentFunc func(float64) string

func (f PaymentFunc) Pay(a float64) string { return f(a) }

cart.Payment = PaymentFunc(func(a float64) string {
    return fmt.Sprintf("paid %f as cash", a)
})
```

> **Why `func (f PaymentFunc) Pay` works:** in Go you can attach methods to *any* named type, including a function type. `PaymentFunc` is "a function that takes a `float64` and returns a `string`"; giving it a `Pay` method that just calls itself (`f(a)`) makes a bare function satisfy the `PaymentStrategy` interface. This is the same trick the standard library uses for `http.HandlerFunc`. It lets callers supply a one-off strategy without declaring a whole struct.

---

## More small runnable examples

Each example is self-contained. The **takeaway** at the end is the single thing to remember.

### Example 1 — Sorting strategy (Python, idiomatic via `key`)

In Python the cleanest Strategy is often just a function passed as `key`. The "context" is `sorted`.

```python
products = [
    {"name": "Pen",   "price": 3,  "rating": 4.5},
    {"name": "Book",  "price": 20, "rating": 4.9},
    {"name": "Mug",   "price": 8,  "rating": 4.1},
]

by_price  = lambda p: p["price"]
by_rating = lambda p: -p["rating"]   # negative → descending

def show(items, strategy):
    return [p["name"] for p in sorted(items, key=strategy)]

print(show(products, by_price))    # ['Pen', 'Mug', 'Book']
print(show(products, by_rating))   # ['Book', 'Pen', 'Mug']
```

Expected output:

```
['Pen', 'Mug', 'Book']
['Book', 'Pen', 'Mug']
```

**Takeaway:** in Python a "strategy" is frequently just a function — don't build a class hierarchy when a `key=` callable will do.

### Example 2 — Strategy that carries configuration (Python)

A strategy can hold state/config in its constructor — something a bare function pointer can't do cleanly.

```python
from abc import ABC, abstractmethod

class Discount(ABC):
    @abstractmethod
    def apply(self, total: float) -> float: ...

class NoDiscount(Discount):
    def apply(self, total): return total

class PercentOff(Discount):
    def __init__(self, percent: float):
        self.percent = percent
    def apply(self, total):
        return round(total * (1 - self.percent / 100), 2)

class FlatOff(Discount):
    def __init__(self, amount: float):
        self.amount = amount
    def apply(self, total):
        return max(0.0, total - self.amount)

for d in (NoDiscount(), PercentOff(10), FlatOff(5)):
    print(f"{type(d).__name__:12} -> {d.apply(50)}")
```

Expected output:

```
NoDiscount   -> 50
PercentOff   -> 45.0
FlatOff      -> 45.0
```

**Takeaway:** reach for a Strategy *class* (not a plain function) the moment the algorithm needs configuration or remembered state.

### Example 3 — Compression strategy in Go

```go
package main

import "fmt"

type Compressor interface {
    Compress(data string) string
    Name() string
}

type NoCompression struct{}
func (NoCompression) Compress(d string) string { return d }
func (NoCompression) Name() string             { return "none" }

type RunLength struct{}
func (RunLength) Compress(d string) string {
    if d == "" { return "" }
    out, prev, count := "", rune(d[0]), 0
    for _, c := range d {
        if c == prev {
            count++
        } else {
            out += fmt.Sprintf("%d%c", count, prev)
            prev, count = c, 1
        }
    }
    return out + fmt.Sprintf("%d%c", count, prev)
}
func (RunLength) Name() string { return "rle" }

func archive(data string, c Compressor) {
    fmt.Printf("[%s] %q -> %q\n", c.Name(), data, c.Compress(data))
}

func main() {
    payload := "aaabbbbcc"
    archive(payload, NoCompression{})
    archive(payload, RunLength{})
}
```

Expected output:

```
[none] "aaabbbbcc" -> "aaabbbbcc"
[rle] "aaabbbbcc" -> "3a4b2c"
```

**Takeaway:** the calling function `archive` never branches on compression type — adding `gzip` later means writing one new struct, touching nothing else.

### Example 4 — Choosing a strategy from data (a small dispatch table)

A common idiom: map a string key to a strategy. This is Strategy + a tiny registry, and it kills the `if/elif` switch entirely.

```python
strategies = {
    "card":   lambda amt: f"Charged ${amt} to card",
    "paypal": lambda amt: f"Charged ${amt} via PayPal",
    "crypto": lambda amt: f"Sent ${amt} of BTC",
}

def checkout(total, method):
    try:
        return strategies[method](total)
    except KeyError:
        raise ValueError(f"unknown method: {method}")

print(checkout(23, "paypal"))   # Charged $23 via PayPal
print(checkout(23, "card"))     # Charged $23 to card
```

Expected output:

```
Charged $23 via PayPal
Charged $23 to card
```

**Takeaway:** a `dict` of `key -> strategy` is the most Pythonic way to do runtime selection; new methods register themselves instead of editing a switch.

### Example 5 — Stateful strategy: retry/backoff (Python)

A strategy that *remembers* across calls. This is the case a plain function literal struggles with.

```python
from abc import ABC, abstractmethod

class BackoffStrategy(ABC):
    @abstractmethod
    def next_delay(self) -> float: ...

class FixedBackoff(BackoffStrategy):
    def __init__(self, delay: float):
        self.delay = delay
    def next_delay(self):
        return self.delay

class ExponentialBackoff(BackoffStrategy):
    def __init__(self, base: float = 1.0):
        self.base = base
        self.attempt = 0
    def next_delay(self):
        delay = self.base * (2 ** self.attempt)
        self.attempt += 1
        return delay

exp = ExponentialBackoff(base=1)
print([exp.next_delay() for _ in range(4)])   # [1, 2, 4, 8]

fixed = FixedBackoff(delay=3)
print([fixed.next_delay() for _ in range(4)]) # [3, 3, 3, 3]
```

Expected output:

```
[1, 2, 4, 8]
[3, 3, 3, 3]
```

**Takeaway:** when the algorithm has internal state that evolves between calls, a Strategy *object* is the right tool — and you must give each caller its own instance (see Common Mistake #3).

---

## When to use Strategy

- You have multiple ways to do the same task.
- The choice is made at runtime, not compile time.
- You want to add new algorithms without modifying existing code.
- Each algorithm is **substitutable** — same input, same kind of output.

If the variants share state and behavior, classes are right. If they're just functions of a value (no state), passing a function literal is enough — that's "Strategy with extra steps" disguised as a higher-order function.

### A quick decision checklist

Use Strategy when you can answer "yes" to most of these:

1. Do I have (or expect) **3+ interchangeable variants** of one operation?
2. Is the variant chosen **at runtime** (user input, config, A/B flag)?
3. Do the variants take the **same input shape** and return the **same output shape**?
4. Do I want to add a variant **without editing** the code that uses it?
5. Is each variant **independently testable** and meaningful on its own?

If most answers are "no," a plain `if/else` or a single function is probably better — see the next section.

---

## When NOT to use Strategy

- **Just 2 variants forever.** A simple `if/else` is fine.
- **Variants need totally different inputs.** Then they aren't substitutable; Strategy is the wrong fit.
- **The "strategy" is one line.** A function pointer is enough; no class needed.

### More anti-patterns to watch for

- **The set of variants never changes and is tiny.** Strategy buys you *extensibility*; if nothing will ever be added, you've paid the abstraction cost for no benefit. A `match`/`switch` is more readable.
- **The variant choice is made once at startup and never again.** That's often plain **dependency injection / configuration**, not runtime strategy switching. You can still use the Strategy shape, but don't over-engineer a registry for a value set in `main()`.
- **The branches don't actually share a contract.** If `payCard` returns a receipt but `payCrypto` returns a transaction future and a confirmation callback, forcing them behind one interface produces a leaky, lowest-common-denominator API. Keep them separate.
- **You only need it to satisfy a test.** Don't introduce a Strategy interface solely to inject a mock when a simple function parameter or fake would do.

---

## Common mistakes

### 1. Strategy with too much shared logic

If 80% of every strategy is the same, you've got a **template method** problem, not a strategy problem. Use a base class with hooks instead.

```python
# SMELL: every strategy repeats validation + logging, only the middle differs.
class CardPayment:
    def pay(self, amount):
        self._validate(amount)          # duplicated
        self._log("card", amount)       # duplicated
        result = f"charged {amount} to card"   # the ONLY real difference
        self._record(result)            # duplicated
        return result

# FIX: Template Method — shared skeleton in the base, hook for the varying bit.
from abc import ABC, abstractmethod

class Payment(ABC):
    def pay(self, amount):              # the invariant skeleton
        self._validate(amount)
        self._log(type(self).__name__, amount)
        result = self._charge(amount)   # the single variable step
        self._record(result)
        return result

    @abstractmethod
    def _charge(self, amount) -> str: ...

    def _validate(self, amount):
        if amount <= 0:
            raise ValueError("amount must be positive")
    def _log(self, kind, amount):  print(f"[{kind}] paying {amount}")
    def _record(self, result):     pass

class CardPayment(Payment):
    def _charge(self, amount): return f"charged {amount} to card"
```

**Why:** Strategy varies the *whole* algorithm; Template Method varies *one step* inside a fixed skeleton. If the strategies are 80% identical, you actually wanted Template Method.

### 2. Passing context-specific data into the strategy

```python
class WeirdStrategy:
    def pay(self, amount, user, cart, order_id, ...):    # explosion
```

If the strategy needs all that, it's not really substitutable. Maybe split responsibilities.

```python
# FIX: pass a small, stable context object — same signature for every strategy.
from dataclasses import dataclass

@dataclass(frozen=True)
class PaymentContext:
    amount: float
    user_id: str
    order_id: str

class CardPayment(PaymentStrategy):
    def pay(self, ctx: PaymentContext) -> str:
        return f"charged {ctx.amount} for order {ctx.order_id}"
```

**Why:** if every strategy needs a different ad-hoc bag of arguments, the interface isn't uniform and the Context ends up knowing each strategy's needs — defeating the pattern. A single immutable context keeps one signature for all of them.

### 3. Singleton strategy with mutable state

If two callers share the same strategy instance, mutable state inside it leaks across them. Either:
- Make strategies immutable (preferred).
- Construct fresh instances per call.

```python
# WRONG: one shared ExponentialBackoff — two callers corrupt each other's attempt count.
shared = ExponentialBackoff(base=1)
def make_request_a(): return shared.next_delay()   # 1
def make_request_b(): return shared.next_delay()   # 2 (!) — A's progress leaked into B

# FIX: each caller gets its own instance...
def make_request_a(): return ExponentialBackoff(base=1).next_delay()
def make_request_b(): return ExponentialBackoff(base=1).next_delay()

# ...or make the strategy stateless and pass the attempt in:
class ExponentialBackoff(BackoffStrategy):
    def __init__(self, base: float = 1.0):
        self.base = base
    def delay_for(self, attempt: int) -> float:     # no internal mutation
        return self.base * (2 ** attempt)
```

**Why:** stateful strategies look fine in single-threaded tests and then fail under concurrency or reuse. Immutable strategies are safe to share; stateful ones must be per-call.

### 4. Selecting the strategy *inside* the Context with an `if`

```python
# SMELL: the Context decides which strategy — you've just hidden the switch, not removed it.
class Cart:
    def checkout(self, method):
        if method == "card":    return CreditCardPayment(...).pay(self.total)
        elif method == "paypal": return PayPalPayment(...).pay(self.total)
        # ...back to square one
```

**Fix:** the *client* (or a Factory/registry) chooses the strategy and injects it; the Context only delegates.

```python
cart.set_payment(CreditCardPayment(card, cvv))   # caller decides
cart.checkout()                                   # Context just calls pay()
```

**Why:** if the Context contains the selection logic, every new method still edits the Context — you haven't gained Open/Closed at all. Selection belongs *outside* the Context.

---

## Idioms and best practices

- **Prefer functions over classes when there's no state.** In Python pass a callable (`key=`, a `lambda`, or a top-level function); in Go pass a func or use a func-type-with-method (`http.HandlerFunc` style). Reserve classes/structs for strategies that need configuration or remembered state.
- **Keep one uniform signature.** Every concrete strategy should accept the same inputs and return the same shape. If they diverge, the abstraction is wrong.
- **Make strategies immutable when you can.** Stateless strategies are trivially safe to cache, share, and reuse across threads.
- **Pair Strategy with a registry/Factory for selection.** A `dict[str, Strategy]` (Python) or `map[string]Strategy` (Go) turns "pick by name" into a table lookup and lets new strategies self-register.
- **Default strategy / Null Object.** Provide a `NoDiscount` / `NoCompression` "do nothing" strategy instead of allowing `None`/`nil`; it removes null checks from the Context.
- **Name strategies by behavior, not implementation detail.** `PercentOff` not `Strategy2`; `LeastConnections` not `Algo3`.
- **Inject, don't construct.** The Context receives its strategy from outside (constructor or setter); it never `new`s a concrete strategy itself.
- **Go specifics:** keep strategy interfaces small (often one method) so any func type can satisfy them; accept interfaces and return concrete types; store the strategy as an interface-typed field on the Context.
- **Python specifics:** `typing.Protocol` gives you structural ("duck") typing — a class satisfies the strategy just by having the right method, no explicit subclassing or `ABC` required:

```python
from typing import Protocol

class PaymentStrategy(Protocol):
    def pay(self, amount: float) -> str: ...

class ApplePay:                       # no inheritance needed
    def pay(self, amount): return f"Apple Pay {amount}"

def run(s: PaymentStrategy, amt): return s.pay(amt)
print(run(ApplePay(), 9.99))          # Apple Pay 9.99
```

---

## Cross-questions

### "Why use Strategy and not a function pointer?"

If the algorithm is one function, a function pointer is fine — it's a simpler form. Use full Strategy classes when:
- The algorithm has its own state (e.g., a `RetryStrategy` with attempt counts).
- It needs configuration (e.g., `DiscountStrategy(percent=10)`).
- You want to group multiple related operations (e.g., `SortStrategy.compare` + `SortStrategy.partition`).

### "Strategy vs State?"

Strategy: client picks the algorithm. The algorithm is "interchangeable parts."
State: the object's state changes its own behavior over time. Like Strategy but the **object itself** decides when to switch.

A vending machine's behavior depends on its state (idle, accepting coins, dispensing). That's State.
A sorter that can sort by price or rating? Strategy.

> Deeper: both patterns have *identical UML* (a context delegating to an interface). The difference is **who triggers the swap and why**. In Strategy the swap is external and the strategies are typically independent of each other and stable for the duration of an operation. In State the object transitions itself between states (often the current state object decides the next one), and the states are aware of each other.

### "How does Strategy relate to OCP?"

Strategy is the canonical OCP pattern. Adding `BitcoinPayment` doesn't change `Cart` — only adds a new type. Closed for modification, open for extension.

### "Strategy vs Factory?"

Factory makes the **right object**. Strategy uses the object to **vary behavior**.

Often combined: a `PaymentFactory` returns a `PaymentStrategy` based on user choice.

### "Isn't this just dependency injection?"

Strategy is a flavor of DI. The Cart's "dependency" is the payment strategy. DI is the mechanism (passing it in); Strategy is the design (interchangeable algorithms).

### "Strategy vs polymorphism — aren't they the same thing?"

Strategy is *built on* polymorphism, but they're not synonyms. Plain subtype polymorphism is when an object's *own* type determines behavior (`Dog.speak()` vs `Cat.speak()`). Strategy is when you **extract** the varying behavior into a *separate* object and **compose** it into a host object that delegates. The mantra is "favor composition over inheritance": instead of subclassing `Cart` into `CardCart`, `PayPalCart`, … (an inheritance explosion), you keep one `Cart` and plug a payment object into it. Strategy = composition; the inheritance alternative blows up combinatorially when you have two varying axes (payment × shipping).

### "Strategy vs Command — both wrap behavior in an object?"

Yes, but the intent differs. A **Command** packages a request — *what to do* plus *its arguments* — usually so it can be queued, logged, undone, or executed later (think a button's action, an undo stack). A **Strategy** packages *how to do* one step of an algorithm so it can be swapped. Command emphasizes "do this thing (maybe later, maybe undoably)"; Strategy emphasizes "do this *interchangeable* step now." A Command often has no return value and side-effects; a Strategy typically transforms input to output.

### "How do I test code that uses Strategy?"

Two angles, both easy — which is part of the appeal:
1. **Test each concrete strategy in isolation** — they're small, pure-ish, and need no Context. `assert PercentOff(10).apply(50) == 45.0`.
2. **Test the Context with a fake strategy** — inject a trivial stub that records its calls, and assert the Context delegated correctly without touching real payment/network code.

```python
def test_cart_delegates_to_strategy():
    calls = []
    class FakePayment:
        def pay(self, amount): calls.append(amount); return "ok"
    cart = Cart(); cart.add("x", 23); cart.set_payment(FakePayment())
    assert cart.checkout() == "ok"
    assert calls == [23]      # Context passed the right total
```

The injection seam is exactly what makes Strategy-using code pleasant to unit test.

### "Where does Strategy show up in real standard libraries?"

- Python: `sorted(data, key=...)` and `list.sort(key=...)` — `key` is a strategy. `functools.reduce`, `heapq.nsmallest(..., key=...)`, `re` flags, and `logging.Formatter` are all strategy-shaped.
- Go: `sort.Slice(s, less func(i, j int) bool)` takes a comparison strategy; `http.Handler`/`http.HandlerFunc` is a request-handling strategy; `io.Reader`/`io.Writer` let you swap data sources/sinks.
- Java (for cross-reference): `Comparator`, `ThreadPoolExecutor`'s `RejectedExecutionHandler`, `Collections.sort`.

Naming these in an interview signals you recognize the pattern in the wild, not just in textbook UML.

---

## What's next

```
→ Foundations/DesignPatterns/factory.md       (how to choose/build the strategy object)
→ Foundations/DesignPatterns/state.md          (same shape, object drives its own transitions)
→ Foundations/DesignPatterns/template_method.md (when 80% is shared — Common Mistake #1)
→ Foundations/SOLID/open_closed.md             (the principle Strategy embodies)
```

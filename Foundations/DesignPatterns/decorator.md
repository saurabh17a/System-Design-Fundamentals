# Decorator Pattern

> **Category:** Structural
> **Difficulty:** ⭐⭐
> **Time to read:** 18 minutes.

> Note: This is the **classic OO Decorator pattern**. Python also has a language feature called "decorators" (`@something`) — they're related but distinct. We'll touch on both.

---

## Plain-English explanation (start here)

Imagine you order a plain coffee. The barista doesn't reach for a different cup labeled "coffee-with-milk" — they take your **existing** coffee and *add* milk to it. Then add sugar. Then add whipped cream. The thing in your hand is still "a coffee you can drink and pay for," it just does a little more now. Each topping **wraps** what came before and adds its own bit.

That's the Decorator pattern in one sentence: **wrap an object in another object that has the same shape, do a little extra, then hand the work off to the thing inside.**

A useful mental image is a set of **Russian nesting dolls** (matryoshka). The innermost doll is the real object. Each outer doll looks like a doll from the outside (same interface) but, when you open it, it just contains the next doll. When you ask the outer doll to do something, it does its bit and then asks the doll inside.

Three things make it a decorator and not just "some wrapper":

1. **Same interface.** The wrapper looks identical to the thing it wraps. Callers can't tell the difference — they just call `cost()` or `serve(request)`.
2. **Holds a reference to the inner object.** The wrapper keeps the thing it decorates and delegates to it.
3. **Adds behavior before and/or after delegating.** It does its extra work, then forwards.

Because every layer has the same interface, you can stack them in any order and any number — that's the superpower.

### The precise / technical version

The Decorator pattern attaches additional responsibilities to an object **dynamically** (at runtime), providing a flexible alternative to subclassing for extending functionality (GoF, *Design Patterns*, 1994). Structurally:

- A **Component** interface declares the operations (`Beverage.cost()`).
- A **ConcreteComponent** implements the base behavior (`Espresso`).
- A **Decorator** also implements the Component interface *and* holds a reference to a Component (`has-a` + `is-a`). It forwards requests to its wrapped component and optionally performs work before/after the forward.
- **ConcreteDecorators** (`Milk`, `Sugar`, `Whip`) override operations to add behavior, calling `super`/the wrapped instance to delegate.

The key invariant: a decorator is **substitutable** for the component it wraps (Liskov substitution holds), so wrappers and wrapped objects are interchangeable from a client's point of view. This is composition over inheritance: behavior is assembled by **nesting objects** rather than by building a class hierarchy.

---

## The problem

You have an object with some behavior. You want to **add** behavior to it without modifying its class.

Examples:
- A logger that should also write to disk *and* send to a remote server.
- A web request that should be cached *and* rate-limited *and* logged.
- A coffee that has milk *and* sugar *and* whipped cream.

Subclassing for every combination explodes:
`Coffee`, `MilkCoffee`, `SugarCoffee`, `MilkSugarCoffee`, `MilkSugarWhipCoffee`, ...

We want **composability**.

### Why subclassing explodes (the math)

With `N` independent, optional add-ons, the number of distinct combinations is `2^N` (each add-on is either present or absent). For 3 toppings that's 8 classes; for 10 toppings it's **1024** classes. If order matters (milk-then-sugar differs from sugar-then-milk), it becomes a permutation count and is even worse. You also cannot pick combinations at runtime — the class is chosen at compile time — so "let the customer choose toppings from a form" becomes impossible without reflection hacks.

Decorator replaces this `2^N` class explosion with `N` decorator classes (one per add-on) that you **combine at runtime**. The combinations live in *data/object graphs*, not in the type system.

---

## The pattern

A Decorator wraps another object **of the same interface**, adds behavior before/after, then forwards the call.

```
   ┌──────────────┐         ┌──────────────┐
   │   Coffee     │ ◄──wrap─│  MilkCoffee  │ ◄── wrap ── SugarCoffee
   │              │         │              │
   │ + cost()     │         │ + cost()     │
   │ + describe() │         │ + describe() │
   └──────────────┘         └──────────────┘
```

You stack as many decorators as you want.

### A fuller UML-ish view

```
            ┌────────────────────┐
            │   «interface»       │
            │     Component       │
            │  + operation()      │
            └─────────▲──────────┘
                      │ implements
          ┌───────────┴────────────┐
          │                        │
┌─────────────────┐      ┌────────────────────────┐
│ ConcreteComponent│     │      Decorator          │
│  + operation()   │     │  - wrapped: Component   │  ◄── holds a Component
└─────────────────┘      │  + operation()          │      (has-a)
                         └───────────▲────────────┘
                                     │ extends
                    ┌────────────────┴───────────────┐
            ┌───────────────┐               ┌───────────────┐
            │ ConcreteDecoratorA │          │ ConcreteDecoratorB │
            │  + operation()      │          │  + operation()      │
            │  + addedBehavior()  │          └───────────────┘
            └───────────────┘
```

The crucial relationship: `Decorator` both **is-a** `Component` (so it's substitutable) and **has-a** `Component` (so it can delegate). That dual relationship is what lets layers stack indefinitely.

---

## Python — coffee shop example

```python
from abc import ABC, abstractmethod

class Beverage(ABC):
    @abstractmethod
    def cost(self) -> float: ...
    @abstractmethod
    def describe(self) -> str: ...


class Espresso(Beverage):
    def cost(self): return 3.0
    def describe(self): return "Espresso"


# Base decorator — wraps any Beverage
class Decorator(Beverage):
    def __init__(self, drink: Beverage):
        self._drink = drink


class Milk(Decorator):
    def cost(self): return self._drink.cost() + 0.5
    def describe(self): return self._drink.describe() + ", milk"

class Sugar(Decorator):
    def cost(self): return self._drink.cost() + 0.2
    def describe(self): return self._drink.describe() + ", sugar"

class Whip(Decorator):
    def cost(self): return self._drink.cost() + 0.7
    def describe(self): return self._drink.describe() + ", whip"


# Use:
order = Whip(Sugar(Milk(Espresso())))
print(order.describe())    # Espresso, milk, sugar, whip
print(f"${order.cost():.2f}")    # $4.40
```

Each decorator is a `Beverage` AND wraps a `Beverage`. You compose them like Russian dolls.

**How the cost actually adds up** (reading from the inside out): `Espresso` = 3.0 → `Milk` = 3.0 + 0.5 = 3.5 → `Sugar` = 3.5 + 0.2 = 3.7 → `Whip` = 3.7 + 0.7 = **4.4**. Each layer asks the layer inside for *its* answer, then adds its own contribution. No layer knows or cares how many layers are inside it.

**Takeaway:** the base `Decorator` class exists only to hold the wrapped object; concrete decorators add the behavior.

---

## More small runnable examples

### Example A — runtime composition from a list (the real payoff)

This is what subclassing cannot do cleanly: choose decorators at runtime from user input.

```python
from abc import ABC, abstractmethod

class Beverage(ABC):
    @abstractmethod
    def cost(self) -> float: ...
    @abstractmethod
    def describe(self) -> str: ...

class Espresso(Beverage):
    def cost(self): return 3.0
    def describe(self): return "Espresso"

class Decorator(Beverage):
    def __init__(self, drink): self._drink = drink

class Milk(Decorator):
    def cost(self): return self._drink.cost() + 0.5
    def describe(self): return self._drink.describe() + ", milk"

class Sugar(Decorator):
    def cost(self): return self._drink.cost() + 0.2
    def describe(self): return self._drink.describe() + ", sugar"

ADDONS = {"milk": Milk, "sugar": Sugar}

def build(base: Beverage, addons: list[str]) -> Beverage:
    drink = base
    for name in addons:
        drink = ADDONS[name](drink)   # wrap one more layer
    return drink

order = build(Espresso(), ["milk", "sugar", "sugar"])  # double sugar!
print(order.describe())          # Espresso, milk, sugar, sugar
print(f"${order.cost():.2f}")    # $3.90
```

Expected output:
```
Espresso, milk, sugar, sugar
$3.90
```

**Takeaway:** decorators let you assemble behavior from a runtime list — including the same decorator twice — which `2^N` subclasses can't.

### Example B — a timing decorator (before/after work around the call)

```python
import time
from abc import ABC, abstractmethod

class Task(ABC):
    @abstractmethod
    def run(self) -> int: ...

class RealTask(Task):
    def run(self):
        total = sum(range(1_000_00))
        return total

class Timed(Task):
    def __init__(self, inner): self._inner = inner
    def run(self):
        start = time.perf_counter()
        result = self._inner.run()          # delegate
        elapsed = time.perf_counter() - start
        print(f"[timed] took {elapsed*1000:.2f} ms")
        return result

print(Timed(RealTask()).run())
# [timed] took ~X ms     (exact ms varies by machine)
# 4999950000
```

Expected output (timing varies):
```
[timed] took 1.20 ms
4999950000
```

**Takeaway:** a decorator can wrap *time/log/retry* logic around any object's call without that object knowing.

### Example C — composing two functional decorators in Python

```python
def shout(fn):
    def wrapper(*a, **k):
        return fn(*a, **k).upper()
    return wrapper

def exclaim(fn):
    def wrapper(*a, **k):
        return fn(*a, **k) + "!"
    return wrapper

@shout
@exclaim                 # applied first (closest to def)
def greet(name):
    return f"hello {name}"

print(greet("ada"))
```

Expected output:
```
HELLO ADA!
```

Why? `@exclaim` runs closest to `def`, so `greet` becomes `exclaim(greet)` → returns `"hello ada!"`; then `@shout` wraps that → `"HELLO ADA!"`. Decorators stack **bottom-up** in source, **top-down** at call time.

**Takeaway:** with `@`-syntax, the decorator nearest the `def` is the innermost wrapper.

### Example D — Go: a `Reader` decorator that counts bytes

```go
package main

import (
	"fmt"
	"io"
	"strings"
)

// CountingReader wraps any io.Reader and counts bytes read.
type CountingReader struct {
	inner io.Reader
	N     int
}

func (c *CountingReader) Read(p []byte) (int, error) {
	n, err := c.inner.Read(p) // delegate to the wrapped reader
	c.N += n
	return n, err
}

func main() {
	cr := &CountingReader{inner: strings.NewReader("hello decorator")}
	buf, _ := io.ReadAll(cr)
	fmt.Printf("%q\n", buf) // "hello decorator"
	fmt.Println(cr.N)       // 15
}
```

Expected output:
```
"hello decorator"
15
```

**Takeaway:** Go's standard library is full of decorators — `CountingReader` *is* an `io.Reader` and *wraps* an `io.Reader`, exactly like `bufio.Reader` or `gzip.Reader` do.

---

## Go

```go
package main

import "fmt"

type Beverage interface {
    Cost() float64
    Describe() string
}

type Espresso struct{}
func (Espresso) Cost() float64 { return 3.0 }
func (Espresso) Describe() string { return "Espresso" }

type Milk struct{ b Beverage }
func (m Milk) Cost() float64 { return m.b.Cost() + 0.5 }
func (m Milk) Describe() string { return m.b.Describe() + ", milk" }

type Sugar struct{ b Beverage }
func (s Sugar) Cost() float64 { return s.b.Cost() + 0.2 }
func (s Sugar) Describe() string { return s.b.Describe() + ", sugar" }

func main() {
    order := Sugar{Milk{Espresso{}}}
    fmt.Println(order.Describe())    // Espresso, milk, sugar
    fmt.Printf("$%.2f\n", order.Cost())
}
```

In Go, decorators are common for HTTP middleware:

```go
type Handler func(req string) string

func WithLogging(h Handler) Handler {
    return func(req string) string {
        fmt.Println("BEFORE:", req)
        res := h(req)
        fmt.Println("AFTER:", res)
        return res
    }
}

func WithAuth(h Handler) Handler {
    return func(req string) string {
        if !authorized(req) {
            return "401"
        }
        return h(req)
    }
}

handler := WithLogging(WithAuth(myHandler))
```

Same pattern, function-flavored.

### Go note: struct-embedding to avoid forwarding boilerplate

In the struct-based version above, if `Beverage` had ten methods and `Milk` only wanted to change one, you'd have to hand-write nine forwarding methods. Go's **embedding** forwards them for you:

```go
package main

import "fmt"

type Beverage interface {
	Cost() float64
	Describe() string
}

type Espresso struct{}
func (Espresso) Cost() float64    { return 3.0 }
func (Espresso) Describe() string { return "Espresso" }

// Embed the Beverage interface. Unoverridden methods auto-forward.
type Milk struct{ Beverage }
func (m Milk) Cost() float64 { return m.Beverage.Cost() + 0.5 } // override one
// Describe() is inherited from the embedded Beverage automatically.

func main() {
	order := Milk{Espresso{}}
	fmt.Println(order.Describe()) // Espresso   (forwarded, not "..., milk")
	fmt.Printf("$%.2f\n", order.Cost())
}
```

Expected output:
```
Espresso
$3.50
```

Embedding promotes the inner object's methods, so you only write the ones you change. (Note the gotcha: here `Describe()` is *not* decorated because we didn't override it — embedding gives you forwarding by default, decoration only where you opt in.)

---

## Decorator vs subclassing

Subclassing for combinations:
- `Coffee`, `MilkCoffee`, `SugarCoffee`, `MilkSugarCoffee`...
- 2^N subclasses for N options. Doesn't scale.

Decorator:
- N decorators. Combine at runtime.
- Can change combinations per request without new classes.

| Axis | Subclassing | Decorator |
|---|---|---|
| When behavior is fixed | compile time | runtime |
| Classes needed for N add-ons | up to `2^N` | `N` |
| Same add-on twice (e.g. double sugar) | needs a special class | just wrap twice |
| Change combo per request | impossible without new types | trivial |
| Coupling | tight (child knows parent internals) | loose (only the interface) |
| Best for | a small, fixed set of variations | combinatorial, runtime-chosen features |

---

## A real-world example: HTTP middleware

Most web frameworks use Decorator/middleware patterns.

```python
def with_logging(handler):
    def wrapped(request):
        print(f"REQ: {request.path}")
        response = handler(request)
        print(f"RES: {response.status}")
        return response
    return wrapped

def with_auth(handler):
    def wrapped(request):
        if not request.authorized():
            return Response(401)
        return handler(request)
    return wrapped


def my_handler(request):
    return Response(200, "ok")

# Stack them:
app = with_logging(with_auth(my_handler))
```

This is decorator pattern with functions instead of classes.

### Why middleware ordering is the same idea as topping ordering

`with_logging(with_auth(my_handler))` means: on the way *in*, logging runs first, then auth, then the handler; on the way *out*, the handler returns, then auth's after-code (none here), then logging's after-code. The request travels **inward** through the layers and the response travels **outward** — an "onion." If you swap to `with_auth(with_logging(my_handler))`, you'd log requests even for unauthorized callers (auth now runs *after* logging starts). Same wrapping mechanics as `Whip(Sugar(...))`; the order encodes the policy.

---

## Other real-world decorators you already use

You've almost certainly used these without naming them:

- **Python I/O:** `gzip.open(...)` wraps a file object; `io.BufferedReader` wraps a raw stream; `csv.reader(f)` wraps an iterable of lines. Each adds behavior (decompress, buffer, parse) while still being "a thing you read from."
- **Java I/O (the canonical teaching example):** `new BufferedReader(new InputStreamReader(new FileInputStream("f")))` — three decorators, each an input stream that wraps another input stream.
- **Go stdlib:** `bufio.NewReader`, `gzip.NewReader`, `io.LimitReader`, `httputil.NewSingleHostReverseProxy` with wrapped `http.RoundTripper`s — all decorators.
- **HTTP clients:** wrapping an `http.RoundTripper` (Go) or a `requests.Session` adapter (Python) to add retries, auth headers, or tracing.
- **GUI toolkits:** a `ScrollDecorator` or `BorderDecorator` around a visual component — the original GoF motivating example was windowing toolkits.

Recognizing the pattern in the wild is half the value: when you see "X wraps a Y and is itself a Y," it's a decorator.

---

## Python's `@decorator` syntax

Python's `@` decorators are essentially function decorators with sugar:

```python
def with_logging(fn):
    def wrapper(*args, **kwargs):
        print(f"calling {fn.__name__}")
        return fn(*args, **kwargs)
    return wrapper

@with_logging        # equivalent to: greet = with_logging(greet)
def greet(name):
    print(f"hello {name}")

greet("Alice")
# calling greet
# hello Alice
```

The `@with_logging` line above `def greet` is just `greet = with_logging(greet)`. It IS the decorator pattern, just shorter.

Common decorators:
- `@functools.cache` — memoizes results
- `@functools.wraps(fn)` — preserves metadata when writing your own decorator
- `@property` — turns a method into an attribute access

### Classic OO decorator vs Python `@`-decorator — same idea, different grain

They share the structural idea (wrap, add, delegate) but differ:

| | Classic OO Decorator | Python `@`-decorator |
|---|---|---|
| Decorates | an **object instance** | usually a **function/method/class** (a callable) |
| Stacking | nest objects: `Whip(Sugar(x))` | stack `@`s above a `def` |
| Interface | must match the wrapped object's full interface | the wrapper must be callable like the original |
| Runtime swap | trivially per-instance | fixed at definition (though you can re-assign manually) |

So: every `@`-decorator is a decorator-pattern application, but not every decorator-pattern use is a `@`-decorator (e.g. the coffee/`io.Reader` examples decorate *objects*).

---

## Common mistakes

### 1. Order matters

```python
order = Sugar(Whip(Milk(Espresso())))
# vs
order = Whip(Sugar(Milk(Espresso())))
```

The describe output and (sometimes) behavior differs. Document the conventional order if it matters.

### 2. Decorators changing the interface

A decorator must be **the same type** as what it wraps. If `Sugar.cost()` returned `(float, str)` instead of `float`, you'd break callers.

### 3. Deep stacks slow performance

Each decorator adds a function call. 50 layers = 50 hops. Usually negligible; in hot loops, profile.

### 4. State across decorators

If `Logger` decorator counts calls and `Auth` decorator short-circuits on failure, the call count differs from intent. Be careful with stateful decorators that interact.

### 5. Forgetting `functools.wraps` (Python) — losing identity and docs

**Wrong** — the decorated function lies about its name and loses its docstring:

```python
def with_logging(fn):
    def wrapper(*args, **kwargs):
        return fn(*args, **kwargs)
    return wrapper

@with_logging
def greet(name):
    "Say hello."
    return f"hi {name}"

print(greet.__name__)   # wrapper   ← wrong, should be "greet"
print(greet.__doc__)    # None      ← wrong, lost the docstring
```

**Fix** — copy metadata with `functools.wraps`:

```python
import functools

def with_logging(fn):
    @functools.wraps(fn)            # <-- copies __name__, __doc__, __wrapped__, etc.
    def wrapper(*args, **kwargs):
        return fn(*args, **kwargs)
    return wrapper

@with_logging
def greet(name):
    "Say hello."
    return f"hi {name}"

print(greet.__name__)   # greet
print(greet.__doc__)    # Say hello.
```

This matters for debuggers, `help()`, framework introspection (FastAPI/Flask read signatures), and stack traces.

### 6. Decorator that forgets to delegate (drops the inner object)

**Wrong** — `cost()` ignores the wrapped drink, so the price is just the add-on:

```python
class Milk(Decorator):
    def cost(self): return 0.5          # BUG: never calls self._drink.cost()
```

```python
print(Milk(Espresso()).cost())   # 0.5   ← espresso vanished!
```

**Fix** — always delegate, then add:

```python
class Milk(Decorator):
    def cost(self): return self._drink.cost() + 0.5   # 3.0 + 0.5 = 3.5
```

The whole point of a decorator is to *call through* to what it wraps. Forgetting that turns a decorator into a replacement.

### 7. Mutating the wrapped object instead of wrapping it

**Wrong** — reaching in and mutating shared state defeats composability:

```python
class Sugar(Decorator):
    def __init__(self, drink):
        super().__init__(drink)
        drink.base_price += 0.2   # BUG: mutates the inner object's state
```

Now the inner `Espresso` is permanently changed; if two orders share it, both get sugar. **Fix:** keep decorators stateless about the inner object and compute on the fly (`return self._drink.cost() + 0.2`). Decorators should *add a layer*, never *edit the thing underneath*.

### 8. Diamond / equality surprises with deep stacks

`Whip(Sugar(x)) == Sugar(Whip(x))`? Almost certainly not, and you usually don't want decorators to define `__eq__`/`__hash__` across layers. If you need to ask "does this order contain sugar?", don't introspect the wrapper chain with `isinstance` ladders — that's brittle. Add an explicit method (`has_addon("sugar")`) or track ingredients in a set. Relying on `isinstance(order, Sugar)` only catches the *outermost* layer.

---

## Idioms and best practices

- **Keep decorators thin and single-purpose.** One decorator = one concern (logging, retry, caching, auth). Stack them to combine; don't build a "does five things" mega-decorator.
- **Always delegate.** The body should do its extra work and then call the wrapped component. A decorator that never calls through is a replacement, not a decorator.
- **Preserve the contract.** Same return type, same exceptions where reasonable, same side-effect expectations. Substitutability (LSP) is what makes stacking safe.
- **Make decorators order-tolerant where you can**, and document the required order where you can't (e.g. "auth must wrap before logging," "decompress before parse").
- **In Python, use `functools.wraps`** on every function decorator. In Go, prefer **embedding** to auto-forward methods you don't override.
- **Prefer functional decorators for cross-cutting concerns** (`with_retry`, `with_timeout`) and object decorators when you're wrapping a rich object with many methods or per-instance state.
- **Name by effect, not by mechanism:** `RetryingClient`, `CachingRepo`, `with_auth` read better than `ClientWrapper2`.

### When NOT to use it

- **Only one or two fixed variations exist.** Just write the variant directly or use a parameter/flag. A decorator framework for "coffee with optional milk" is over-engineering.
- **The added behavior needs to change the interface.** If you must expose new methods or a different return shape, you want an **Adapter** or a **Facade**, not a decorator.
- **Layers must share or coordinate complex state.** Decorators are at their best when each layer is independent. Heavy inter-layer state is a smell — consider an explicit pipeline object or a mediator.
- **Hot loops where the per-call indirection dominates.** Measure; if 50 wrapper hops show up in a profiler, flatten the chain or inline.
- **Debuggability matters and the stack is deep.** A 12-layer onion produces 12-frame stack traces and confusing names; weigh that against the flexibility you gain.

---

## Cross-questions

### "Decorator vs Inheritance for adding features?"

Inheritance: static, compile-time, fixed combination.
Decorator: dynamic, runtime, swap any layer.

For 2-3 fixed extensions, inheritance might be simpler. For combinatorial features, decorator wins.

### "Decorator vs Strategy?"

Strategy swaps **the algorithm**. Decorator wraps **adds before/after**.

A `SortStrategy` chooses how to sort. A `LoggingDecorator(sortStrategy)` logs around the sort.

### "Decorator vs Adapter?"

Adapter changes **the interface** (X looks like Y).
Decorator keeps **the same interface** but adds behavior.

### "Decorator vs Proxy — they both wrap one object of the same interface, so what's the difference?"

This is the trickiest cross-question because structurally they're nearly identical. The difference is **intent**:

- **Decorator** adds *behavior/responsibilities* — you stack several, each enriching the result (logging + caching + retry).
- **Proxy** *controls access* to the real object — lazy creation, access checks, remoting, reference counting. A proxy usually wraps *one* subject and often eventually creates or talks to it; you don't typically stack proxies to "add features."

Rule of thumb: if you're enriching the output, it's a decorator; if you're guarding or deferring access to the real thing, it's a proxy.

### "Decorator vs Composite?"

Composite builds **trees** (one node, many children) so clients treat individual objects and groups uniformly. Decorator builds a **linear chain** (one wrapper, one wrapped) to add behavior. Both implement the component interface, but Composite is about *part-whole hierarchies*; Decorator is about *layered behavior*. A decorator with exactly one child is the giveaway — Composite has many.

### "Decorator vs Chain of Responsibility?"

Both pass a request down a sequence. In **Chain of Responsibility**, each link *may handle and stop* the request (e.g. the first handler that matches). In **Decorator**, every layer normally *participates and delegates* — nobody "claims" the request to end the chain. Middleware blurs this (auth middleware *does* short-circuit on 401), which is why middleware is sometimes described as both. If short-circuiting is the defining feature, lean Chain-of-Responsibility; if enrichment-by-everyone is, lean Decorator.

### "What about middleware in web frameworks?"

It IS decorator. Each middleware wraps the next handler in a chain. Express, Flask, Gin, etc., all use this.

### "How does this relate to AOP (aspect-oriented programming)?"

AOP is decorator's grandchild. Where decorators target one object/function, AOP libraries weave behavior across many points based on rules ("log every method that starts with `Save`"). Same goal, more powerful tooling.

### "Does Decorator violate the Open/Closed Principle, or honor it?"

It *honors* it beautifully. You extend behavior (add a new `Caching` decorator) **without modifying** the `Component` or the `ConcreteComponent` — open for extension, closed for modification. That's one of the pattern's headline selling points.

### "Is a Python `@`-decorator the same as the GoF Decorator pattern?"

Related, not identical. The GoF pattern decorates *objects* and emphasizes runtime, per-instance composition with a shared interface. Python's `@` decorates *callables* (functions/classes) at definition time. The `@` syntax is a clean, common *application* of the pattern's idea — but the pattern is broader (see the coffee and `io.Reader` examples, which decorate objects, not functions).

---

## What to read next

```
→ Foundations/DesignPatterns/adapter.md      (changes interface — contrast with decorator)
→ Foundations/DesignPatterns/proxy.md        (same shape, different intent: access control)
→ Foundations/DesignPatterns/composite.md    (trees vs chains; shared component interface)
→ Foundations/DesignPatterns/strategy.md     (swap algorithm vs wrap behavior)
```

Further reading: Gamma, Helm, Johnson, Vlissides, *Design Patterns* (1994), the Decorator chapter; Python docs on `functools.wraps`; the Go standard library `io` package source for real, idiomatic decorators.

## What's next

```
→ Foundations/DesignPatterns/adapter.md
```

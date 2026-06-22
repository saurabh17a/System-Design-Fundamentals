# Factory Pattern

> **Category:** Creational
> **Difficulty:** ⭐⭐
> **Prerequisites:** OOP four pillars; ideally `strategy.md`.
> **Time to read:** 18 minutes.

---

## Plain-English first

Imagine you walk into a coffee shop and say "a latte, please." You do **not**
go behind the counter, grind the beans, steam the milk, and pull the espresso
shot yourself. You name *what* you want; the barista figures out *how* to make
it and hands you the finished drink. You don't even know (or care) which
machine they used.

A **factory** is that barista. Your code says "give me a `latte`" (or an
`email` notifier, or a `prod` logger) and the factory decides which concrete
class to build, builds it, and hands it back. The thing you get back behaves
the way you expect (it has a `.send()` or `.write()` method), but you never
typed the concrete class name yourself.

Why is that good? Because the day the shop buys a new espresso machine, *you*
don't change your order. Only the barista's routine changes. In code: the day
you add a new notification channel, only the factory changes — every caller
that said "give me a notifier" keeps working untouched.

**The precise/technical version:** the Factory pattern *encapsulates object
creation* behind a stable interface so that client code depends on an
**abstraction** (an interface / abstract base class) rather than on
**concrete constructors**. This decouples *what is created* from *who uses it*,
localizes construction logic to one place, and lets you add new concrete types
without editing call sites — an application of the Dependency Inversion
Principle ("depend on abstractions") and the Open/Closed Principle ("open for
extension, closed for modification").

Three terms you'll hear, in plain words:

- **Product** — the thing being created (`Notification`, `Logger`, `Button`).
- **Concrete product** — a specific kind (`EmailNotification`, `FileLogger`).
- **Factory** — the function/method/class that decides which concrete product
  to build and returns it as the abstract product type.

---

## The problem

Creating objects is sometimes **complicated**:
- The class to instantiate depends on input ("if it's an admin, give me an `AdminUser`, else `User`").
- Construction has steps the caller shouldn't worry about.
- You want a single place to control creation (logging, metrics, caching).

If every caller does `User(...)` directly, you've leaked construction logic into many places. Change the construction → change every caller.

### Concretely, what "leaked construction" looks like

Picture this scattered across 30 files in a codebase:

```python
# file: signup.py
if user.is_admin:
    notifier = EmailNotification(user.email)
else:
    notifier = SMSNotification(user.phone)

# file: billing.py  (same logic, copy-pasted)
if user.is_admin:
    notifier = EmailNotification(user.email)
else:
    notifier = SMSNotification(user.phone)

# file: alerts.py   (subtly different — forgot the admin case!)
notifier = SMSNotification(user.phone)
```

Now product says "admins should get Slack messages, not email." You must find
and edit *every* one of these blocks, and `alerts.py` was already wrong. This
is the pain a factory removes: the decision lives in **one** function, called
everywhere, so changing it changes the whole system at once.

---

## The pattern (variants)

There are several "factory" patterns that all share one idea: **encapsulate object creation**.

1. **Simple Factory** (most common in practice): a function or static method that returns a chosen concrete type behind an interface.
2. **Factory Method**: a method on a base class, overridden in subclasses to return different types.
3. **Abstract Factory**: a factory of factories — produces families of related objects.

We'll cover all three, starting with the simplest.

> **Naming note for interviews:** "Simple Factory" is *not* one of the original
> Gang of Four (GoF) patterns — it's an everyday idiom. The GoF book formally
> names only **Factory Method** and **Abstract Factory**. Saying this out loud
> signals you know the literature.

A quick map of "who decides what gets built":

| Variant | Who picks the concrete type? | Typical trigger |
|---|---|---|
| Simple Factory | A runtime argument (`channel="email"`) | a discriminator value / config string |
| Factory Method | The chosen *subclass* (overrides the method) | which subclass you instantiated |
| Abstract Factory | The chosen *factory object* | needing a consistent family of products |

---

## Simple Factory — Python

```python
from abc import ABC, abstractmethod

class Notification(ABC):
    @abstractmethod
    def send(self, msg: str): ...


class EmailNotification(Notification):
    def __init__(self, address): self.address = address
    def send(self, msg): print(f"Email to {self.address}: {msg}")

class SMSNotification(Notification):
    def __init__(self, phone): self.phone = phone
    def send(self, msg): print(f"SMS to {self.phone}: {msg}")

class PushNotification(Notification):
    def __init__(self, device_id): self.device_id = device_id
    def send(self, msg): print(f"Push to {self.device_id}: {msg}")


def make_notification(channel: str, target: str) -> Notification:
    if channel == "email":
        return EmailNotification(target)
    elif channel == "sms":
        return SMSNotification(target)
    elif channel == "push":
        return PushNotification(target)
    else:
        raise ValueError(f"unknown channel: {channel}")


# Use:
n = make_notification("email", "alice@x.com")
n.send("Hello!")
```

**Expected output:**

```
Email to alice@x.com: Hello!
```

**Takeaway:** the caller names a *channel string*, never a class — so the set of
classes can change without touching the caller.

The caller asks for "email" without knowing about `EmailNotification`. Adding `SlackNotification` only changes the factory + class — nowhere else.

A registry-based variant for OCP:

```python
_REGISTRY = {
    "email": EmailNotification,
    "sms": SMSNotification,
    "push": PushNotification,
}

def make_notification(channel: str, target: str) -> Notification:
    cls = _REGISTRY.get(channel)
    if not cls:
        raise ValueError(f"unknown channel: {channel}")
    return cls(target)

# To add Slack: just register it
_REGISTRY["slack"] = SlackNotification
```

### Self-registering plugins (the registry, leveled up)

The registry really shines when each product *registers itself* via a
decorator, so the factory file never imports the concrete classes at all. This
is exactly how plugin systems work.

```python
from abc import ABC, abstractmethod

_REGISTRY: dict[str, type["Notification"]] = {}

def register(channel: str):
    """Decorator: associate a channel name with a Notification subclass."""
    def deco(cls):
        _REGISTRY[channel] = cls
        return cls
    return deco

class Notification(ABC):
    @abstractmethod
    def send(self, msg: str): ...

@register("email")
class EmailNotification(Notification):
    def __init__(self, address): self.address = address
    def send(self, msg): print(f"Email to {self.address}: {msg}")

@register("slack")
class SlackNotification(Notification):
    def __init__(self, webhook): self.webhook = webhook
    def send(self, msg): print(f"Slack via {self.webhook}: {msg}")

def make_notification(channel: str, target: str) -> Notification:
    try:
        return _REGISTRY[channel](target)
    except KeyError:
        raise ValueError(f"unknown channel: {channel!r}; "
                         f"known: {sorted(_REGISTRY)}") from None

make_notification("slack", "https://hooks.slack/x").send("Deploy done")
print(sorted(_REGISTRY))
```

**Expected output:**

```
Slack via https://hooks.slack/x: Deploy done
['email', 'slack']
```

**Takeaway:** with self-registration the factory has **zero** `if/elif` and
never names a concrete class — adding a channel is purely additive (Open/Closed).

> **Gotcha:** a class only registers itself when its module is actually
> imported. If `SlackNotification` lives in `plugins/slack.py` and nobody
> imports it, `_REGISTRY` won't contain `"slack"`. Real plugin systems solve
> this by scanning a package (e.g. `pkgutil.iter_modules`) or via entry points.

---

## Simple Factory — Go

```go
type Notification interface {
    Send(msg string)
}

type Email struct{ Address string }
func (e Email) Send(m string) { fmt.Printf("Email to %s: %s\n", e.Address, m) }

type SMS struct{ Phone string }
func (s SMS) Send(m string) { fmt.Printf("SMS to %s: %s\n", s.Phone, m) }

func NewNotification(channel, target string) (Notification, error) {
    switch channel {
    case "email":
        return Email{Address: target}, nil
    case "sms":
        return SMS{Phone: target}, nil
    default:
        return nil, fmt.Errorf("unknown channel: %s", channel)
    }
}
```

Idiomatic Go: factories named `New<Type>`. Sometimes a function that returns an interface; sometimes a `*Concrete` if there's only one type.

### A full, runnable Go program

Here is the same idea as a complete `main` you can paste into the
[Go Playground](https://go.dev/play/) or `go run`:

```go
package main

import (
    "errors"
    "fmt"
)

type Notification interface {
    Send(msg string)
}

type Email struct{ Address string }

func (e Email) Send(m string) { fmt.Printf("Email to %s: %s\n", e.Address, m) }

type SMS struct{ Phone string }

func (s SMS) Send(m string) { fmt.Printf("SMS to %s: %s\n", s.Phone, m) }

var ErrUnknownChannel = errors.New("unknown channel")

func NewNotification(channel, target string) (Notification, error) {
    switch channel {
    case "email":
        return Email{Address: target}, nil
    case "sms":
        return SMS{Phone: target}, nil
    default:
        return nil, fmt.Errorf("%w: %q", ErrUnknownChannel, channel)
    }
}

func main() {
    n, err := NewNotification("sms", "+1-555-0100")
    if err != nil {
        fmt.Println("error:", err)
        return
    }
    n.Send("Your code is 4242")

    if _, err := NewNotification("carrier-pigeon", "x"); err != nil {
        fmt.Println("error:", err)
        fmt.Println("is ErrUnknownChannel?", errors.Is(err, ErrUnknownChannel))
    }
}
```

**Expected output:**

```
SMS to +1-555-0100: Your code is 4242
error: unknown channel: "carrier-pigeon"
is ErrUnknownChannel? true
```

**Takeaway:** Go factories return `(T, error)` — the error path *is* the API.
Wrapping a sentinel with `%w` lets callers branch with `errors.Is`, which beats
matching on error strings.

### Registry variant in Go

Go has no decorators, but `func`-valued maps give the same self-registration:

```go
var registry = map[string]func(target string) Notification{
    "email": func(t string) Notification { return Email{Address: t} },
    "sms":   func(t string) Notification { return SMS{Phone: t} },
}

func NewNotification(channel, target string) (Notification, error) {
    ctor, ok := registry[channel]
    if !ok {
        return nil, fmt.Errorf("%w: %q", ErrUnknownChannel, channel)
    }
    return ctor(target), nil
}

// Elsewhere (e.g. an init() in slack.go) to add a channel without editing above:
//   func init() { registry["slack"] = func(t string) Notification { return Slack{Hook: t} } }
```

**Takeaway:** a `map[string]constructorFunc` is Go's registry; package `init()`
functions are Go's "auto-register on import" mechanism.

---

## Factory Method — when subclasses choose

The factory method is a method on a base class, overridden in subclasses to control which concrete type is created.

```python
class Logger(ABC):
    @abstractmethod
    def write(self, msg): ...

class FileLogger(Logger):
    def write(self, msg): print(f"FILE: {msg}")

class CloudLogger(Logger):
    def write(self, msg): print(f"CLOUD: {msg}")


class Application(ABC):
    @abstractmethod
    def make_logger(self) -> Logger: ...      # factory method

    def run(self):
        log = self.make_logger()
        log.write("application starting")


class DevApp(Application):
    def make_logger(self): return FileLogger()

class ProdApp(Application):
    def make_logger(self): return CloudLogger()


DevApp().run()    # FILE: application starting
ProdApp().run()   # CLOUD: application starting
```

**Expected output:**

```
FILE: application starting
CLOUD: application starting
```

**Takeaway:** the *choice of subclass* (`DevApp` vs `ProdApp`) decides the
product — the shared `run()` algorithm never changes.

The base `Application.run()` doesn't know which logger; it just calls `make_logger()`. Each subclass overrides to pick the type.

This is useful when you want to **template** an algorithm with a customizable creation step.

### Why not just pass the logger in?

A fair beginner question: "Why subclass `Application` instead of writing
`Application(logger=FileLogger())`?" Often you *should* — that's plain
dependency injection and it's simpler. Factory Method earns its keep when the
**creation step is part of a larger fixed workflow** that the base class owns,
and subclasses need to vary *only* that one step. Think framework code:

```python
class Migration(ABC):
    def execute(self):                 # fixed workflow, owned by the base
        conn = self.open_connection()  # <-- factory method, subclasses vary it
        try:
            self.apply(conn)
        finally:
            conn.close()               # base guarantees cleanup

    @abstractmethod
    def open_connection(self): ...
    @abstractmethod
    def apply(self, conn): ...
```

Subclasses choose *which* connection to open, but can't forget the
open/try/close skeleton — the base enforces it. That guarantee is what you'd
lose by injecting the connection from outside.

### Go note: there is no inheritance

Go has no class inheritance, so the classic "override a method in a subclass"
shape doesn't translate directly. The Go-idiomatic equivalent is to pass the
varying creation step as a **function field** or an interface:

```go
type App struct {
    NewLogger func() Logger // the "factory method", supplied at construction
}

func (a App) Run() {
    a.NewLogger().Write("application starting")
}

// dev := App{NewLogger: func() Logger { return FileLogger{} }}
// prod := App{NewLogger: func() Logger { return CloudLogger{} }}
```

**Takeaway:** in Go, "subclass overrides the factory method" becomes "struct
holds a constructor function" — composition instead of inheritance.

---

## Abstract Factory — families of objects

When you need a coordinated **family** of products: e.g., a UI toolkit where buttons, checkboxes, and menus all need to match Mac/Windows style.

```python
class Button(ABC):
    @abstractmethod
    def render(self): ...

class Checkbox(ABC):
    @abstractmethod
    def render(self): ...


class MacButton(Button):
    def render(self): print("Mac button")
class MacCheckbox(Checkbox):
    def render(self): print("Mac checkbox")

class WinButton(Button):
    def render(self): print("Windows button")
class WinCheckbox(Checkbox):
    def render(self): print("Windows checkbox")


class UIFactory(ABC):
    @abstractmethod
    def create_button(self) -> Button: ...
    @abstractmethod
    def create_checkbox(self) -> Checkbox: ...

class MacFactory(UIFactory):
    def create_button(self): return MacButton()
    def create_checkbox(self): return MacCheckbox()

class WinFactory(UIFactory):
    def create_button(self): return WinButton()
    def create_checkbox(self): return WinCheckbox()


def render_form(factory: UIFactory):
    factory.create_button().render()
    factory.create_checkbox().render()


render_form(MacFactory())    # All Mac
render_form(WinFactory())    # All Windows
```

**Expected output:**

```
Mac button
Mac checkbox
Windows button
Windows checkbox
```

**Takeaway:** one factory object produces a *whole matched set* — you can't
accidentally pair a `MacButton` with a `WinCheckbox`.

`render_form` doesn't mix Mac and Win widgets. The factory enforces consistency.

### The "diagonal" you're protecting against

The reason Abstract Factory exists is to make an invalid combination
*unrepresentable*. Without it, a caller might write:

```python
# The bug Abstract Factory prevents:
button = MacButton()
checkbox = WinCheckbox()   # oops — mismatched theme, looks broken
```

With Abstract Factory the caller only ever holds *one* `UIFactory`, so every
product it hands out belongs to the same family. Other classic "families" where
this matters: cross-platform file dialogs, database drivers (a Postgres factory
makes Postgres connections *and* Postgres-flavored query builders *and*
Postgres type mappers), or themes (dark/light) in a design system.

### Abstract Factory — Go

```go
type Button interface{ Render() string }
type Checkbox interface{ Render() string }

type UIFactory interface {
    NewButton() Button
    NewCheckbox() Checkbox
}

type macButton struct{}
func (macButton) Render() string { return "Mac button" }
type macCheckbox struct{}
func (macCheckbox) Render() string { return "Mac checkbox" }

type MacFactory struct{}
func (MacFactory) NewButton() Button     { return macButton{} }
func (MacFactory) NewCheckbox() Checkbox { return macCheckbox{} }

func RenderForm(f UIFactory) {
    fmt.Println(f.NewButton().Render())
    fmt.Println(f.NewCheckbox().Render())
}

// RenderForm(MacFactory{})
```

**Takeaway:** Go expresses Abstract Factory cleanly — `UIFactory` is just an
interface with multiple `New*` methods; each concrete factory is a struct that
implements them.

---

## When to use which

- **Simple Factory**: most common need. "Pick the right type by name/condition."
- **Factory Method**: when a class wants to defer construction to subclasses (template-method-like).
- **Abstract Factory**: when you need families of related products and must keep them consistent.

If you're not sure, start with Simple Factory. You'll know if you need more.

### A decision flowchart

```
Do you even have >1 concrete type to choose between?
        │ no
        ├──────────────► Just call the constructor. No factory.
        │ yes
        ▼
Do the created objects come in matched SETS that must stay consistent?
        │ yes
        ├──────────────► Abstract Factory
        │ no
        ▼
Is the creation step one customizable hole inside a fixed base-class workflow?
        │ yes
        ├──────────────► Factory Method
        │ no
        ▼
Simple Factory (a function/registry keyed by a discriminator)
```

---

## More worked examples

### Example A: factory that parses + validates (real construction logic)

This is a factory that *earns its existence* — it does work a bare constructor
shouldn't.

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class Money:
    cents: int
    currency: str

def money_from_string(s: str) -> Money:
    """'USD 19.99' -> Money(1999, 'USD'). Centralizes parsing + validation."""
    try:
        cur, amount = s.split()
        whole, _, frac = amount.partition(".")
        cents = int(whole) * 100 + int((frac + "00")[:2])
    except (ValueError, TypeError):
        raise ValueError(f"bad money string: {s!r}") from None
    if cents < 0:
        raise ValueError("money cannot be negative")
    return Money(cents, cur)

print(money_from_string("USD 19.99"))
print(money_from_string("EUR 5"))
```

**Expected output:**

```
Money(cents=1999, currency='USD')
Money(cents=500, currency='EUR')
```

**Takeaway:** when a factory adds parsing/validation/normalization, it pulls
that logic out of every call site — that's the payoff a plain constructor can't
give.

### Example B: caching factory (flyweight-ish)

A factory is a natural place to add caching, because all creation flows through
it.

```python
from functools import lru_cache

class DBConnectionPool:
    def __init__(self, dsn): self.dsn = dsn

@lru_cache(maxsize=None)
def get_pool(dsn: str) -> DBConnectionPool:
    print(f"opening pool for {dsn}")   # side effect: only runs on a miss
    return DBConnectionPool(dsn)

a = get_pool("postgres://db/app")
b = get_pool("postgres://db/app")
print(a is b)                          # same object reused
```

**Expected output:**

```
opening pool for postgres://db/app
True
```

**Takeaway:** because creation is centralized, you can make repeated requests
share one instance — callers don't change at all.

### Example C: enum-keyed factory (typo-proof discriminator)

Strings as keys invite typos (`"emial"`). An enum makes the key set explicit and
catchable by tooling.

```python
from enum import Enum

class Channel(Enum):
    EMAIL = "email"
    SMS = "sms"

def make(channel: Channel, target: str) -> Notification:
    return {
        Channel.EMAIL: EmailNotification,
        Channel.SMS: SMSNotification,
    }[channel](target)

make(Channel.EMAIL, "a@x.com").send("hi")
# make(Channel.PUSH, ...)  -> AttributeError at the call site, before runtime
```

**Expected output:**

```
Email to a@x.com: hi
```

**Takeaway:** prefer an `Enum` (or Go typed constants) over raw strings when the
discriminator set is fixed — you trade a little ceremony for compile-time/IDE
safety.

---

## Common mistakes

### 1. Factory that's just a constructor

```python
def make_user(name, email):
    return User(name, email)
```

If there's no logic in the factory beyond instantiation, **don't write the factory**. Direct construction is clearer.

**The fix:** delete the wrapper and call `User(name, email)` directly. Add the
factory back *only* when a real decision or extra step appears (choosing a
subclass, validation, caching, logging).

### 2. God factory

A factory that knows about every type in the system. Splits SRP. Either split factories by domain (UserFactory, OrderFactory) or use a registry.

**Wrong:**

```python
def make_anything(kind, **kw):     # 400-line if/elif touching every module
    if kind == "user": ...
    elif kind == "order": ...
    elif kind == "invoice": ...
    elif kind == "email": ...
    # ...30 more...
```

**Fix:** one registry per domain, or self-registration so the factory file
never grows:

```python
_REGISTRY: dict[str, type] = {}
def register(name):
    def deco(cls): _REGISTRY[name] = cls; return cls
    return deco

def make(name, **kw):
    return _REGISTRY[name](**kw)
```

### 3. Factory returning concrete types

```go
func NewEmail(addr string) Email {
    return Email{Address: addr}
}
```

If the caller only ever uses `Email`, returning `Email` is fine. If the factory is supposed to abstract over multiple types, return the **interface**.

> **Go-specific nuance — return concrete, accept interfaces.** The idiomatic Go
> guideline is the opposite of what beginners expect: a *constructor* like
> `NewEmail` should usually return the **concrete** `*Email` (or `Email`) so
> callers keep full access to its methods and fields; functions that *consume*
> it should accept the `Notification` **interface**. You return an interface
> from a factory specifically when the *choice of concrete type is dynamic*
> (the `NewNotification(channel, ...)` case). Returning `interface{}`-style
> abstractions "just in case" is an anti-pattern in Go.

### 4. Side effects in factories

A factory that opens a database connection, registers a global, etc., is doing too much. Construction should be cheap and side-effect free where possible.

**Why it bites:** a factory with hidden I/O makes objects slow and dangerous to
create in tests. If `make_service()` silently dials a network, your unit tests
need a network. **Fix:** keep the factory pure (assemble objects, no I/O), and
do connecting in an explicit `.connect()` / `.start()` step the caller controls.

### 5. Mutable default registry / shared state (Python gotcha)

```python
# Wrong: every call shares and mutates the SAME dict
def make(name, registry={}):       # mutable default argument!
    ...
```

**Fix:** never use a mutable default argument; use a module-level constant or
pass it explicitly. (See `Foundations/Python/gotchas.md` if present.)

### 6. Swallowing the "unknown kind" case

```python
def make(channel, target):
    cls = _REGISTRY.get(channel)
    return cls(target)            # if channel is unknown, cls is None -> TypeError later
```

A `None` slips through and explodes far from the cause. **Fix:** fail fast with
a clear message listing valid keys (as shown in the self-registering example).

---

## Idioms and best practices

- **Name it for the language.** Python: `make_x` / `x_from_y` /
  `X.from_string()` classmethods. Go: `NewX`. Java/C#: `createX` /
  `X.of(...)` / `X.valueOf(...)`.
- **Prefer a classmethod for "alternative constructors."** Python idiom:

  ```python
  class User:
      def __init__(self, id, name): self.id, self.name = id, name
      @classmethod
      def from_row(cls, row): return cls(row["id"], row["name"])
  ```

  `from_row`, `from_json`, `from_env` are factories that keep the type and its
  creation logic together. (`datetime.fromtimestamp`, `dict.fromkeys`,
  `Path.cwd` are standard-library examples.)
- **Return the abstraction only when the type is dynamic.** Static single type →
  return the concrete type.
- **Keep factories pure and fast.** No network, no disk, no global mutation.
- **Centralize the discriminator.** One enum/registry, not strings scattered
  around.
- **Fail loudly on unknown inputs**, listing valid options.

### When NOT to use a factory

- There's exactly one concrete type and construction is trivial → just call the
  constructor. (Adding a factory here is "speculative generality" — complexity
  paying for flexibility you don't have.)
- The "choice" never varies at runtime and is known at the call site → an
  `if/else` right there can be clearer than indirection.
- You reach for Abstract Factory but the products don't actually form a *family*
  that must stay consistent → you've over-engineered; a couple of Simple
  Factories are lighter.
- In Go, when you're tempted to return an interface "to be flexible" but there's
  only one implementation → return the struct.

---

## Cross-questions

### "Why bother with a factory? Just call the constructor."

For one type, you're right. Factories pay off when:
- The choice of type depends on input.
- Construction has multiple steps or dependencies.
- You want to centralize creation for testing or logging.

### "Factory vs Builder?"

- **Factory**: pick a class and create it (one shot).
- **Builder**: assemble a complex object step by step (many calls before final `build()`).

If you have 10 optional parameters → Builder. If you have a discriminator + fixed shape → Factory.

### "Can a factory return any object, like a `dict`?"

Yes — factories aren't required to return a class instance. They return whatever the API contract says. If the contract is "anything that responds to `.send()`", a function-with-bound-state works.

### "Is the registry pattern OCP-friendly?"

Yes — strongly. Registering new types doesn't modify the factory. The factory becomes a lookup; types self-register at import time. Plugin systems are factories with auto-registering registries.

### "Factory vs Dependency Injection?"

Factories build objects; DI provides them. Often paired:
- Factory builds a `PaymentStrategy` based on user input.
- DI passes the constructed strategy into the service.

### "Factory Method vs Abstract Factory — what's the real difference?"

Factory Method creates **one** product and the choice comes from *which subclass
overrode the method*. Abstract Factory creates a **family** of products and the
choice comes from *which factory object you hold*. Rule of thumb: one product →
Factory Method; matched set of products → Abstract Factory. An Abstract Factory
is often *implemented* using several Factory Methods (one per `create_*`).

### "Why return an interface instead of the concrete type?"

So the caller depends on *behavior* (`.send()`), not on a specific class. That's
the Dependency Inversion Principle. You only need this when the concrete type
varies at runtime; if it's fixed and singular, returning the concrete type is
fine (and in Go, preferred).

### "Isn't a factory just extra indirection that hurts readability?"

It can be, if added speculatively. The honest answer in a review: a factory is
worth its indirection exactly when the creation decision is (a) non-trivial and
(b) needed in more than one place, *or* you must be able to add types without
editing callers. Below that bar, prefer the constructor.

### "How do you test code that uses a factory?"

Two angles. (1) Test the factory directly: feed each discriminator, assert the
returned object is the right type / behaves right, and assert unknown inputs
raise. (2) Test the *consumer* by injecting a fake factory or a fake product, so
you don't exercise the real concrete types. The whole point of returning an
abstraction is that a test double satisfying the same interface drops right in.

### "What's the relationship to the Strategy pattern?"

They're complementary and frequently confused. **Strategy** is about *swapping
behavior* (interchangeable algorithms behind one interface). **Factory** is
about *choosing/creating* which object you get. You very often use a factory to
*select a strategy*: `make_compressor("gzip")` returns a `Compressor` strategy.
Factory = creation; Strategy = behavior.

---

## What's next

```
→ Foundations/DesignPatterns/singleton.md
```

Related reading once you've digested this:
- `Foundations/DesignPatterns/strategy.md` — the behavior counterpart factories
  often select between.
- `Foundations/DesignPatterns/builder.md` — for step-by-step construction of
  complex objects (the "Factory vs Builder" question above).
- SOLID principles, especially **Dependency Inversion** and **Open/Closed**, which
  are the *why* behind returning abstractions and using registries.

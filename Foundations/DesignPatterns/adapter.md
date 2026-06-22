# Adapter Pattern

> **Category:** Structural
> **Difficulty:** ⭐
> **Aliases:** Wrapper
> **Time to read:** 12 minutes.

---

## In plain English (start here)

Imagine you bought a laptop in the US and flew to the UK. Your charger has flat US prongs; the wall has round UK holes. You don't rewire the laptop, and you don't rewire the building. You buy a **travel adapter** — a little block that plugs into the UK wall on one side and accepts your US plug on the other. It does no real work; it just makes two incompatible things talk to each other.

That is the Adapter pattern, exactly. In code:

- The **wall socket** = the thing you already have (a library, an old API, a vendor SDK). Its shape is fixed; you can't change it.
- The **laptop plug** = the shape your own code is built to expect (`pay(amount)`, `read(file)`).
- The **travel adapter** = a small class you write that has the shape your code expects on one side, and forwards the call to the library on the other.

You write the adapter once. After that, your application code never knows or cares that there's a foreign plug behind it. If you fly to a third country (swap to a different vendor), you buy a new adapter — the laptop is untouched.

The whole point: **you change the connector, not the things being connected.**

### Now the precise version

An **Adapter** is a class (or, in Go, a struct) that **implements the interface the client expects** (the *Target*) and holds a reference to an object whose interface is incompatible (the *Adaptee*). Each Target method is implemented by translating the call — argument shapes, units, naming, error conventions, return types — into one or more Adaptee calls and translating the result back. The client is statically coupled only to the Target; the Adaptee is a hidden implementation detail.

Four roles, by their textbook names:

| Role | What it is | In the payment example below |
| --- | --- | --- |
| **Target** | The interface the client programs against | `PaymentProcessor` |
| **Adaptee** | The existing, incompatible class | `ThirdPartyStripe` |
| **Adapter** | Implements Target, delegates to Adaptee | `StripeAdapter` |
| **Client** | Uses the Target, unaware of the Adaptee | Your app code calling `processor.pay(...)` |

---

## The problem

You have code that expects one interface. The thing you want to use has a **different** interface.

Examples:
- Your code expects `pay(amount)`. The 3rd-party library has `chargeWithCurrency(amount, currency, customer_id, ...)`.
- Your code expects `read(file)`. The library has `loadFromS3(bucket, key)`.
- Old API expects XML; new client speaks JSON.

You can't (or don't want to) change either side. You need a translator.

---

## The pattern

An **Adapter** is a class that conforms to the interface your code expects, while internally calling the API of the thing you want to use.

```
   ┌────────────────┐         ┌────────────────┐         ┌─────────────────┐
   │   Client       │ ──use──►│   Adapter      │ ──call─►│ Adaptee         │
   │ wants Target   │         │ (implements    │         │ (incompatible   │
   │ interface      │         │  Target)       │         │  interface)     │
   └────────────────┘         └────────────────┘         └─────────────────┘
```

The adapter **looks like** what the client wants but **delegates** to the adaptee.

---

## Python — payment example

Suppose your app expects:

```python
from abc import ABC, abstractmethod

class PaymentProcessor(ABC):
    @abstractmethod
    def pay(self, amount: float) -> str: ...
```

A 3rd-party library has:

```python
class ThirdPartyStripe:
    """Pretend this is a real library we can't change."""
    def make_charge(self, amount_cents: int, currency: str = "USD") -> dict:
        return {"id": "ch_xxx", "status": "succeeded", "amount": amount_cents}
```

The adapter:

```python
class StripeAdapter(PaymentProcessor):
    def __init__(self, stripe: ThirdPartyStripe):
        self._stripe = stripe

    def pay(self, amount):
        result = self._stripe.make_charge(int(amount * 100))
        if result["status"] != "succeeded":
            raise RuntimeError("payment failed")
        return result["id"]


# Use:
processor: PaymentProcessor = StripeAdapter(ThirdPartyStripe())
print(processor.pay(19.99))    # ch_xxx
```

Your app code uses `PaymentProcessor.pay`. The adapter handles the unit conversion, error mapping, etc.

### What the adapter actually translated here

It is worth naming each mismatch the adapter ironed out, because *these mismatches are the entire reason the pattern exists*:

1. **Units.** Your code thinks in dollars (`19.99`); Stripe thinks in cents (`1999`). The adapter does `int(amount * 100)`.
2. **Method name.** `pay` vs `make_charge`.
3. **Return type.** You want a plain receipt id `str`; Stripe returns a `dict`. The adapter extracts `result["id"]`.
4. **Error convention.** Stripe signals failure with a `"status"` field; your code expects an exception. The adapter raises `RuntimeError`.

A real adapter is mostly these four kinds of translation and nothing else. The moment it starts making *decisions* (retry policy, fraud checks, picking which provider), it has stopped being an adapter — see Common Mistakes #1.

> One-line takeaway: an adapter's body is a translation table, not a brain.

---

## Go

```go
package main

import "fmt"

type PaymentProcessor interface {
    Pay(amount float64) (string, error)
}

// 3rd-party library (we can't change)
type ThirdPartyStripe struct{}

func (ThirdPartyStripe) MakeCharge(amountCents int, currency string) (map[string]any, error) {
    return map[string]any{"id": "ch_xxx", "status": "succeeded"}, nil
}

// Adapter
type StripeAdapter struct {
    stripe ThirdPartyStripe
}

func (a StripeAdapter) Pay(amount float64) (string, error) {
    res, err := a.stripe.MakeCharge(int(amount*100), "USD")
    if err != nil {
        return "", err
    }
    if res["status"] != "succeeded" {
        return "", fmt.Errorf("payment failed")
    }
    return res["id"].(string), nil
}

func main() {
    var processor PaymentProcessor = StripeAdapter{stripe: ThirdPartyStripe{}}
    id, err := processor.Pay(19.99)
    fmt.Println(id, err) // ch_xxx <nil>
}
```

Expected output:

```
ch_xxx <nil>
```

> One-line takeaway: in Go the adapter is just a struct with the methods the interface names; satisfying the interface is implicit.

### A note on Go's structural typing — adapters are often "free"

Go interfaces are satisfied **structurally**: any type that has the right methods *is* the interface, with no `implements` keyword and no inheritance. This changes when you need an explicit adapter.

Suppose the library already happens to expose a method with the exact signature your interface wants:

```go
type Reader interface {
    Read(p []byte) (n int, err error)
}
```

If a library type already has a `Read([]byte) (int, error)` method, it satisfies `Reader` automatically — **no adapter needed**. You only write an adapter when the signatures *differ* (different name, different argument order, different return shape). In nominally-typed languages (Java, C#) you'd be forced to write a trivial adapter even when the methods line up by accident; in Go you are not.

### The function adapter idiom (`http.HandlerFunc`)

Go's standard library ships one of the most elegant adapters in any language. The `http.Handler` interface wants a *type with a method*:

```go
type Handler interface {
    ServeHTTP(ResponseWriter, *Request)
}
```

But most handlers are naturally plain functions. The adapter is one type and one method:

```go
type HandlerFunc func(ResponseWriter, *Request)

// ServeHTTP adapts a function value into a Handler.
func (f HandlerFunc) ServeHTTP(w ResponseWriter, r *Request) {
    f(w, r)
}
```

Now an ordinary function can masquerade as a `Handler`:

```go
func hello(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintln(w, "hi")
}

var h http.Handler = http.HandlerFunc(hello) // adapt func -> interface
```

> One-line takeaway: an adapter doesn't have to wrap an object — it can adapt a *function value* into an *interface*, which is the cleanest adapter Go has.

---

## A tiny, fully-runnable Python example (units adapter)

The shortest adapter worth showing: a thermometer library that only speaks Celsius, behind an interface your UI wants in Fahrenheit.

```python
from abc import ABC, abstractmethod

class Thermometer(ABC):           # Target: what the UI wants
    @abstractmethod
    def temperature_f(self) -> float: ...

class CelsiusSensor:              # Adaptee: vendor library, Celsius only
    def read_celsius(self) -> float:
        return 25.0

class FahrenheitAdapter(Thermometer):
    def __init__(self, sensor: CelsiusSensor):
        self._sensor = sensor
    def temperature_f(self) -> float:
        return self._sensor.read_celsius() * 9 / 5 + 32

t: Thermometer = FahrenheitAdapter(CelsiusSensor())
print(t.temperature_f())   # 77.0
```

Expected output:

```
77.0
```

> One-line takeaway: even a single unit conversion is a legitimate adapter — the value is that the UI never learns the sensor is Celsius.

---

## Adapting a class you don't control by composition (Python `dict` -> object API)

Sometimes the adaptee isn't a fancy SDK — it's just a data shape. Suppose downstream code wants an object with attributes, but the upstream gives you a raw dict from JSON.

```python
from abc import ABC, abstractmethod

class User(ABC):                          # Target
    @property
    @abstractmethod
    def display_name(self) -> str: ...
    @property
    @abstractmethod
    def is_active(self) -> bool: ...

# Adaptee: a raw dict decoded from some legacy JSON API
legacy = {"first": "Ada", "last": "Lovelace", "status": "ENABLED"}

class LegacyUserAdapter(User):
    def __init__(self, raw: dict):
        self._raw = raw
    @property
    def display_name(self) -> str:
        return f'{self._raw["first"]} {self._raw["last"]}'
    @property
    def is_active(self) -> bool:
        return self._raw["status"] == "ENABLED"

u: User = LegacyUserAdapter(legacy)
print(u.display_name, u.is_active)   # Ada Lovelace True
```

Expected output:

```
Ada Lovelace True
```

> One-line takeaway: adapters frequently translate *data shapes* (dict keys, casing, enums), not just method calls.

---

## When to use

- Integrating with libraries you can't modify.
- Migrating between two APIs (old → new): write an adapter so old callers keep working.
- Wrapping legacy code with a clean interface for new code.
- Standardizing across multiple vendors (each gets its own adapter to your common interface).

### A concrete migration timeline

The "old → new" case deserves a picture, because it's the one you'll meet most at work. Say you're replacing `LegacyMailer` with `NewMailer` across a codebase with 400 call sites:

```
Phase 0  All 400 sites call LegacyMailer directly.
Phase 1  Introduce Target interface `Mailer`. Write `LegacyMailerAdapter`.
         Flip the 400 sites to depend on `Mailer` (mechanical, low-risk).
         Behaviour identical — adapter just forwards to LegacyMailer.
Phase 2  Write `NewMailerAdapter` against the same `Mailer` interface.
         Swap the injected instance behind a flag for 1% of traffic.
Phase 3  Ramp to 100%. Delete `LegacyMailer` and its adapter.
```

The adapter is the seam that lets you move from "everyone calls the old thing" to "everyone calls an abstraction" *without* a big-bang rewrite. Each phase is independently shippable and reversible.

---

## Object adapter vs class adapter

Two flavors:

**Object adapter** (most common, what we did above): adapter HOLDS an instance of the adaptee (composition).

**Class adapter** (only in languages with multiple inheritance): adapter inherits from both the target interface and the adaptee.

In Python and Go, just use object adapter. It's simpler and works.

### Why object adapter is the default — the trade-offs spelled out

| Aspect | Object adapter (composition) | Class adapter (inheritance) |
| --- | --- | --- |
| Mechanism | Holds a reference to the adaptee | Subclasses the adaptee |
| Languages | Works everywhere | Needs multiple inheritance (C++, Python; **not** Go/Java) |
| Adapt subclasses of adaptee | Yes — pass any instance | No — bound to the one class you extended |
| Override adaptee behaviour | No (and you shouldn't want to) | Yes (tempting, and a trap) |
| Coupling | Loose; adaptee is swappable | Tight; you inherit the adaptee's whole surface |

Go has **no inheritance at all**, so the class-adapter variant simply doesn't exist there — composition (an embedded or held field) is your only tool, which is the right one anyway. Python *technically* supports multiple inheritance, so a class adapter is possible:

```python
# Class adapter in Python — possible, but usually a bad idea.
class StripeClassAdapter(PaymentProcessor, ThirdPartyStripe):
    def pay(self, amount):
        res = self.make_charge(int(amount * 100))  # inherited method
        return res["id"]
```

Avoid it. You now expose *all* of `ThirdPartyStripe`'s methods (`make_charge`, plus anything else) through your `PaymentProcessor`, leaking the adaptee's surface and inviting callers to bypass your translation. The object adapter hides the adaptee completely. Prefer composition.

> One-line takeaway: "prefer composition over inheritance" is exactly why the object adapter is the default.

---

## Worked example — Multiple SMS providers

```python
from abc import ABC, abstractmethod

class SMSProvider(ABC):
    @abstractmethod
    def send_sms(self, to: str, msg: str): ...


# Provider 1
class TwilioAPI:
    def messages_create(self, to_phone, body): ...


# Provider 2
class AWSSNSAPI:
    def publish(self, phone, content): ...


class TwilioAdapter(SMSProvider):
    def __init__(self, client: TwilioAPI):
        self.client = client
    def send_sms(self, to, msg):
        self.client.messages_create(to_phone=to, body=msg)


class AWSSNSAdapter(SMSProvider):
    def __init__(self, client: AWSSNSAPI):
        self.client = client
    def send_sms(self, to, msg):
        self.client.publish(phone=to, content=msg)


def send_alert(provider: SMSProvider, phone: str):
    provider.send_sms(phone, "ALERT!")


# Configure once, code never changes
send_alert(TwilioAdapter(TwilioAPI()), "+1234")
send_alert(AWSSNSAdapter(AWSSNSAPI()), "+5678")
```

Now switching providers is a config change, not a code change. The rest of the app uses `SMSProvider`.

### The same idea in Go

The N-vendors-one-interface case is the most common adapter shape in production code. Here it is structurally typed in Go, with a tiny fake so it runs:

```go
package main

import "fmt"

// Target: what the rest of the app depends on.
type SMSProvider interface {
    SendSMS(to, msg string) error
}

// Adaptee 1: Twilio's shape.
type TwilioAPI struct{}
func (TwilioAPI) MessagesCreate(toPhone, body string) error {
    fmt.Printf("[twilio] -> %s: %s\n", toPhone, body)
    return nil
}

// Adaptee 2: AWS SNS's shape.
type SNSAPI struct{}
func (SNSAPI) Publish(phone, content string) error {
    fmt.Printf("[sns] -> %s: %s\n", phone, content)
    return nil
}

type TwilioAdapter struct{ c TwilioAPI }
func (a TwilioAdapter) SendSMS(to, msg string) error { return a.c.MessagesCreate(to, msg) }

type SNSAdapter struct{ c SNSAPI }
func (a SNSAdapter) SendSMS(to, msg string) error { return a.c.Publish(to, msg) }

func sendAlert(p SMSProvider, phone string) { _ = p.SendSMS(phone, "ALERT!") }

func main() {
    sendAlert(TwilioAdapter{}, "+1234")
    sendAlert(SNSAdapter{}, "+5678")
}
```

Expected output:

```
[twilio] -> +1234: ALERT!
[sns] -> +5678: ALERT!
```

> One-line takeaway: one Target interface plus one adapter per vendor turns "swap providers" into a one-line wiring change.

---

## Common mistakes

### 1. Adapter that's a half-rewrite

If the adapter has more lines of business logic than translation, it's not an adapter — it's a wrapper with logic. Move the logic out.

**Wrong** — the adapter has grown a brain (retry policy, fraud rules, logging decisions):

```python
class StripeAdapter(PaymentProcessor):
    def pay(self, amount):
        if amount > 10_000:                       # business policy — not translation
            raise ValueError("manual review required")
        for attempt in range(3):                  # retry policy — not translation
            res = self._stripe.make_charge(int(amount * 100))
            if res["status"] == "succeeded":
                return res["id"]
        raise RuntimeError("gave up")
```

**Fix** — keep the adapter to pure translation; put policy in its own layer that *uses* the adapter:

```python
class StripeAdapter(PaymentProcessor):
    def pay(self, amount) -> str:
        res = self._stripe.make_charge(int(amount * 100))   # translate only
        if res["status"] != "succeeded":
            raise RuntimeError("payment failed")
        return res["id"]

class PaymentService:                                       # policy lives here
    def __init__(self, processor: PaymentProcessor):
        self._processor = processor
    def pay_with_retries(self, amount: float) -> str:
        if amount > 10_000:
            raise ValueError("manual review required")
        for _ in range(3):
            try:
                return self._processor.pay(amount)
            except RuntimeError:
                continue
        raise RuntimeError("gave up")
```

Why: keeping the adapter dumb means you can swap Stripe for Adyen without rewriting the retry/fraud logic, and you can unit-test the policy with a fake `PaymentProcessor`.

### 2. Leaking adaptee details

```python
def pay(self, amount):
    return self._stripe.make_charge(...)    # returns Stripe's dict directly
```

Now the caller sees Stripe's data shape. The abstraction's gone.

Translate the response too:

```python
def pay(self, amount) -> str:    # just the receipt id
    res = self._stripe.make_charge(...)
    return res["id"]
```

### 3. One mega-adapter for many things

Don't conflate adapters. One per concept. If you need both payment and shipping adapters, write two.

### 4. Adapting things that don't need it

If both interfaces match closely, you may not need an adapter. Sometimes a simple type alias or direct usage is fine.

### 5. Letting adaptee exceptions leak through untranslated

The adapter's job includes translating the *error* convention, not just the happy path. If the adaptee throws `stripe.error.CardError` and your code is built to handle a domain `PaymentDeclined`, the adapter must catch and re-raise.

**Wrong** — caller is now coupled to Stripe's exception types:

```python
def pay(self, amount) -> str:
    res = self._stripe.make_charge(int(amount * 100))  # may raise stripe.error.CardError
    return res["id"]
```

**Fix** — map the foreign exception to your own domain error:

```python
class PaymentDeclined(Exception): ...

def pay(self, amount) -> str:
    try:
        res = self._stripe.make_charge(int(amount * 100))
    except StripeCardError as e:          # the adaptee's exception type
        raise PaymentDeclined(str(e)) from e
    return res["id"]
```

Why: an exception type is part of an interface. If you don't translate it, every `except` block in your app silently depends on Stripe, and the abstraction leaks just as badly as a leaked return type (#2).

### 6. Holding the wrong direction of dependency

A subtle one: the adapter should depend on (import) both the Target and the Adaptee. Your *application core* should depend only on the Target. If you find your core importing the adapter's module (or worse, the adaptee), the seam has collapsed.

```
GOOD:  core ──► Target (interface)      adapter ──► Target, Adaptee
BAD:   core ──► Adapter ──► Adaptee     (core now transitively knows the vendor)
```

Wire the concrete adapter in at the composition root (`main`, a factory, a DI container) and pass it down as the Target type. See the dependency-inversion cross-question below.

---

## Cross-questions

### "Adapter vs Decorator?"

- **Adapter**: changes interface (X → Y).
- **Decorator**: keeps the same interface, adds behavior.

A decorator wraps to enhance; an adapter wraps to translate.

Concretely: a `LoggingPaymentProcessor` that implements `PaymentProcessor`, logs, then calls another `PaymentProcessor` is a **decorator** — same interface in, same interface out, behaviour added. A `StripeAdapter` that implements `PaymentProcessor` by calling Stripe's `make_charge` is an **adapter** — different interface in (`make_charge`), Target interface out (`pay`). Same wrapping mechanism, opposite intent.

### "Adapter vs Facade?"

- **Adapter**: makes one thing look like another (translation).
- **Facade**: makes a complex subsystem easy to use (simplification).

Facade hides multiple things behind one easy API. Adapter just maps one API to another. Rule of thumb: a facade exists to *reduce* the number of things you call (it wraps *many* objects behind one convenient front); an adapter exists to *reshape* a call (it usually wraps exactly *one* adaptee to a pre-existing target shape). A facade invents a new, convenient interface; an adapter conforms to an interface that already exists because the client demanded it.

### "Adapter vs Proxy?"

- **Adapter**: translates interface.
- **Proxy**: same interface, controls access (lazy load, security, remote, etc.).

A proxy is interface-preserving like a decorator, but its purpose is *access control / indirection* (caching, lazy init, remoting, authorization) rather than adding visible behaviour. If the wrapper exposes a *different* interface, it's an adapter; if it exposes the *same* interface, it's a proxy or decorator depending on intent.

### "Adapter vs Bridge?"

This one trips people up. Both involve an interface plus an implementation.

- **Adapter** is *retrofitted*: two interfaces already exist and are incompatible, so you glue them together after the fact. It's reactive.
- **Bridge** is *designed up front*: you deliberately split an abstraction from its implementation so the two can vary independently, before either is locked in. It's proactive.

Same shape on a diagram, opposite life story: an adapter reconciles things that were *not* designed to fit; a bridge separates things *so that* they'll fit any combination.

### "Why not just modify the library?"

Sometimes you can. Often you can't (vendor library, frozen contract, multiple consumers).

Even when you can, an adapter keeps the boundary clean — your code depends on the adapter, not the library directly. Easier to swap later.

### "Is dependency inversion using adapter?"

Sort of. DIP says depend on abstractions. The adapter is often where you implement the abstraction by wrapping the concrete library. The combination is very common: define an abstraction, write adapters for each backend, inject one at runtime.

Spelled out as the classic "ports and adapters" (hexagonal) architecture:

```
        ┌────────────────────────┐
        │     Application core    │   depends only on the PORT (Target interface)
        │  uses PaymentProcessor  │
        └───────────▲─────────────┘
                    │ implements
        ┌───────────┴─────────────┐
        │   StripeAdapter (an      │   the ADAPTER lives at the edge
        │   "adapter" in hexagonal)│
        └───────────┬─────────────┘
                    │ calls
        ┌───────────▼─────────────┐
        │   ThirdPartyStripe SDK   │   the outside world
        └──────────────────────────┘
```

The "port" is your Target interface; the "adapter" is exactly this pattern. DIP is the *principle* ("core depends on the abstraction, not the vendor"); the Adapter pattern is one common *mechanism* that satisfies it at the boundary.

### "Does the adapter add runtime cost?"

Almost none worth worrying about: one extra method call (and in Python, one attribute lookup) per operation. That is negligible next to the network round-trip of the SMS/payment call it's wrapping. Don't avoid an adapter for performance; the indirection it buys (testability, swappability) is overwhelmingly worth one stack frame. The only place to think twice is an extremely hot in-process loop calling the adapter millions of times — and even then, measure before assuming.

### "How do I test code that uses an adapter?"

That's a feature, not a chore. Because your core depends on the **Target interface**, your tests inject a tiny fake implementing that interface — no Stripe account, no network:

```python
class FakeProcessor(PaymentProcessor):
    def __init__(self):
        self.calls = []
    def pay(self, amount) -> str:
        self.calls.append(amount)
        return "fake_receipt"

def test_checkout_pays_total():
    fake = FakeProcessor()
    checkout(fake, total=42.0)        # your code under test
    assert fake.calls == [42.0]
```

The real `StripeAdapter` gets its own small integration test (does it really translate to cents, etc.); everything *above* the seam is tested against the fake. The adapter is what makes that split possible.

### "When should I NOT use an adapter?"

- The two interfaces already match (Go: the type already satisfies your interface; Python: duck typing already works). Adding an adapter is then pure ceremony.
- You actually control both sides and there's exactly one consumer — just align the interfaces directly and skip the indirection.
- You're tempted to put logic, retries, or orchestration in it — that's a service/decorator, not an adapter (Common Mistake #1).
- You only need it once, throwaway, in a script. A two-line inline lambda/closure is fine; a named class is over-engineering.

---

## Quick reference / cheat sheet

| Question | Answer |
| --- | --- |
| Intent | Make an incompatible interface usable through the one the client expects |
| Category | Structural |
| Key mechanism | Composition (object adapter) — hold the adaptee, delegate |
| Translates | method names, argument shape, units, return types, **errors** |
| Must NOT contain | business logic, retries, orchestration, decisions |
| Go idiom | a struct with the interface's methods; or `func`-type adapters (`http.HandlerFunc`) |
| Python idiom | subclass the ABC / Protocol Target, hold the adaptee in `__init__` |
| Closest cousins | Decorator (same iface, +behaviour), Facade (simplify many), Proxy (same iface, control), Bridge (designed-in split) |
| Skip it when | interfaces already match, single consumer you control, throwaway script |

---

## What's next

```
→ Foundations/DesignPatterns/state.md
```

Related reading once you've got this:
- **Decorator** — same wrapping technique, different goal (add behaviour, keep the interface). The clearest contrast to Adapter.
- **Facade** — when the problem is "too many things to call" rather than "wrong shape".
- **Bridge** — the proactive cousin: split abstraction from implementation *before* they're incompatible.
- **Dependency Inversion / ports & adapters** — the architecture where adapters live at every boundary of your app.

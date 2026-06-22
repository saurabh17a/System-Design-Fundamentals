# Observer Pattern

> **Category:** Behavioral
> **Difficulty:** ⭐⭐
> **Aliases:** Pub/Sub, Listener
> **Time to read:** 20 minutes.

---

## Plain-English explanation (start here)

Imagine you subscribe to a YouTube channel. You don't phone the creator every hour asking "did you post anything new?" Instead, **you tell YouTube once that you care**, and whenever the creator uploads a video, YouTube **pushes a notification to everyone who subscribed**. The creator doesn't know or care who you are — they just hit "publish," and the platform fans the news out to every subscriber.

That's the Observer pattern in one breath:

- The **creator/channel** is the **Subject** (the thing that changes).
- **You and every other subscriber** are the **Observers** (the things that want to react).
- "Subscribe" registers your interest. "Publish" notifies everyone. "Unsubscribe" stops the notifications.

The whole point is **the thing that changes should not have to know, by name, every thing that reacts to the change.** A newspaper doesn't keep a list of its readers' home addresses hard-coded into the printing press; readers subscribe, and the distribution system handles the fan-out. New reader? They subscribe. The press doesn't change.

### The precise / technical version

Observer is a **behavioral** design pattern that defines a **one-to-many dependency** between objects so that when one object (the **Subject**, sometimes called *Observable* or *Publisher*) changes state, all its dependents (**Observers** / *Subscribers* / *Listeners*) are **notified and updated automatically**, without the Subject holding a compile-time reference to any concrete Observer type.

The Subject knows observers only through a narrow contract — an interface with a single method (classically `update()`), or in dynamic languages, simply "any callable." This inverts the dependency: instead of the Subject depending on concrete reactions, both Subject and Observers depend on an abstraction. That is the **Dependency Inversion Principle** at work, and it is what makes the reactions **open for extension, closed for modification** (the **Open/Closed Principle**).

Two roles, four operations:

| Role | Operations |
|------|-----------|
| Subject (Observable) | `subscribe(observer)`, `unsubscribe(observer)`, `notify(event)` |
| Observer (Subscriber) | `update(event)` (called *by* the Subject) |

---

## The problem

When something changes, **multiple** other things need to know:
- A button is clicked → update display, save state, log event, send analytics.
- A user posts a tweet → update timelines of followers.
- An order is placed → email customer, notify warehouse, update inventory.

Hard-coding all of this into the source ("button click handler") couples it to many concerns. Adding a new reaction means modifying the source.

Consider what the "naive" version looks like, so the pain is concrete:

```python
# WITHOUT Observer — the source knows every consumer by name.
class Order:
    def place(self):
        # ... save the order ...
        EmailService().send_confirmation(self)      # coupling #1
        Warehouse().reserve_stock(self)              # coupling #2
        Analytics().track("order_placed", self)      # coupling #3
        # Tomorrow: add loyalty points? Edit THIS method again.
```

Every new reaction edits `Order.place`. The class imports `EmailService`, `Warehouse`, `Analytics` — it can't be unit-tested without all three, and a junior who only owns analytics now has to touch the order code. Observer breaks this open.

---

## The pattern

A **Subject** maintains a list of **Observers** (subscribers). When something changes, the subject **notifies** all observers.

```
   ┌──────────┐
   │ Subject  │ ──notify──►  ┌──────────┐
   │          │              │ Observer │
   │ + add()  │              └──────────┘
   │ + del()  │ ──notify──►  ┌──────────┐
   │ + notify │              │ Observer │
   └──────────┘              └──────────┘
```

Observers don't know about each other. The subject doesn't know what observers do — only that they all have an `update()` method.

### The control flow, step by step

```
1. Observer  ──subscribe(self)──►  Subject      (registration: happens once)
2. (time passes; the world changes)
3. Subject state mutates  ──►  Subject.notify(event)
4. Subject loops its list  ──update(event)──►  Observer A
                           ──update(event)──►  Observer B
                           ──update(event)──►  Observer C
5. Each Observer reacts independently. The Subject moves on.
```

The arrows in step 1 and step 4 point in **opposite directions** — Observers reach *into* the Subject to register, then the Subject reaches *back out* to them to notify. This "call me back later" shape is why GUI frameworks call observers **listeners** and the registered functions **callbacks**.

---

## Python — basic version

```python
class Subject:
    def __init__(self):
        self._observers = []

    def subscribe(self, observer):
        self._observers.append(observer)

    def unsubscribe(self, observer):
        self._observers.remove(observer)

    def notify(self, event):
        for obs in self._observers:
            obs.update(event)


class EmailObserver:
    def update(self, event):
        print(f"[Email] sending notice: {event}")

class LogObserver:
    def update(self, event):
        print(f"[Log] {event}")


s = Subject()
s.subscribe(EmailObserver())
s.subscribe(LogObserver())
s.notify("user signed up")

# [Email] sending notice: user signed up
# [Log] user signed up
```

The Subject is decoupled from concrete reactions. To add a SlackObserver, just write it and `subscribe`. No changes to the Subject.

**Takeaway:** the Subject depends on the *shape* (`update(event)`), never on the concrete classes — that one indirection is the whole pattern.

---

## Python — with callbacks (Pythonic)

In Python, instead of mandating an `update()` method, often pass a **function**:

```python
class Subject:
    def __init__(self):
        self._handlers = []

    def subscribe(self, handler):    # any callable
        self._handlers.append(handler)

    def notify(self, event):
        for h in self._handlers:
            h(event)


s = Subject()
s.subscribe(lambda e: print(f"observer 1: {e}"))
s.subscribe(lambda e: print(f"observer 2: {e}"))
s.notify("hello")
```

Expected output:
```
observer 1: hello
observer 2: hello
```

Lighter. No interface to define.

**Takeaway:** in dynamic languages, "any callable" *is* the Observer interface — you rarely need a formal `Observer` class.

---

## More small runnable examples

### Example A — `subscribe` returns an `unsubscribe` function (idiomatic JS/Python)

A very common, ergonomic API: `subscribe` hands you a function that, when called, removes you. No need to keep a reference to the handler to unsubscribe later.

```python
class Emitter:
    def __init__(self):
        self._handlers = []

    def subscribe(self, handler):
        self._handlers.append(handler)
        def unsubscribe():
            # guard: only remove if still present (idempotent)
            if handler in self._handlers:
                self._handlers.remove(handler)
        return unsubscribe          # caller keeps THIS, not the handler


e = Emitter()
off = e.subscribe(lambda msg: print(f"got: {msg}"))
e.notify = lambda m: [h(m) for h in e._handlers]  # tiny inline notify

e.notify("first")     # got: first
off()                 # unsubscribe
e.notify("second")    # (silence — handler is gone)
```

Expected output:
```
got: first
```

**Takeaway:** returning the teardown closure from `subscribe` is the cleanest unsubscribe API — the caller never has to track the handler identity.

### Example B — typed events with an event name (a mini event emitter)

Real systems rarely have one global "something happened" channel; they have **named events** (`"login"`, `"logout"`, `"error"`). This is how Node's `EventEmitter` and browser `addEventListener` work.

```python
from collections import defaultdict

class EventEmitter:
    def __init__(self):
        self._listeners = defaultdict(list)   # event name -> [handlers]

    def on(self, event_name, handler):
        self._listeners[event_name].append(handler)

    def emit(self, event_name, *args):
        # copy the list so a handler that unsubscribes mid-emit is safe (see Gotcha #6)
        for handler in list(self._listeners[event_name]):
            handler(*args)


bus = EventEmitter()
bus.on("login",  lambda user: print(f"welcome, {user}"))
bus.on("login",  lambda user: print(f"audit: {user} logged in"))
bus.on("logout", lambda user: print(f"bye, {user}"))

bus.emit("login", "alice")
bus.emit("logout", "alice")
```

Expected output:
```
welcome, alice
audit: alice logged in
bye, alice
```

**Takeaway:** keying handlers by event name lets one Subject multiplex many independent channels — this is the shape you'll meet most often in real code.

### Example C — weak references so observers can be garbage-collected

This directly fixes the "memory leak" gotcha below. The Subject holds **weak** references, so an observer that nothing else points to is collected, and the Subject quietly drops it.

```python
import weakref

class Subject:
    def __init__(self):
        # WeakSet: entries vanish automatically when the object is GC'd
        self._observers = weakref.WeakSet()

    def subscribe(self, observer):
        self._observers.add(observer)

    def notify(self, event):
        for obs in list(self._observers):   # snapshot; set may shrink during GC
            obs.update(event)


class Widget:
    def update(self, event):
        print(f"widget reacting to {event}")


s = Subject()
w = Widget()
s.subscribe(w)
s.notify("a")          # widget reacting to a

del w                  # nothing else references the widget
import gc; gc.collect()
s.notify("b")          # (silence — the WeakSet dropped it automatically)
```

Expected output:
```
widget reacting to a
```

**Takeaway:** a `WeakSet`/`WeakValueDictionary` of observers prevents the classic "subject keeps a dead object alive forever" leak — but note bound methods need `weakref.WeakMethod`, not a plain `WeakSet`.

---

## Go

```go
package main

import "fmt"

type Observer interface {
    Update(event string)
}

type Subject struct {
    observers []Observer
}

func (s *Subject) Subscribe(o Observer) {
    s.observers = append(s.observers, o)
}

func (s *Subject) Notify(event string) {
    for _, o := range s.observers {
        o.Update(event)
    }
}

type Logger struct{ Prefix string }
func (l Logger) Update(e string) { fmt.Printf("[%s] %s\n", l.Prefix, e) }

func main() {
    s := &Subject{}
    s.Subscribe(Logger{Prefix: "EMAIL"})
    s.Subscribe(Logger{Prefix: "AUDIT"})
    s.Notify("order placed")
}
```

Expected output:
```
[EMAIL] order placed
[AUDIT] order placed
```

In Go, you can also use channels for a pub/sub pattern:

```go
type Bus struct {
    subscribers []chan string
}

func (b *Bus) Subscribe() <-chan string {
    ch := make(chan string, 10)
    b.subscribers = append(b.subscribers, ch)
    return ch
}

func (b *Bus) Publish(msg string) {
    for _, ch := range b.subscribers {
        ch <- msg
    }
}
```

### Go — function-value observers (the Go equivalent of "callbacks")

Just as Python passes any callable, Go can use a func type instead of an interface. This is lighter when the observer has no state.

```go
package main

import "fmt"

// ObserverFunc adapts a plain function to "the observer contract".
type ObserverFunc func(event string)

type Subject struct {
    handlers []ObserverFunc
}

func (s *Subject) Subscribe(h ObserverFunc) { s.handlers = append(s.handlers, h) }

func (s *Subject) Notify(event string) {
    for _, h := range s.handlers {
        h(event)
    }
}

func main() {
    s := &Subject{}
    s.Subscribe(func(e string) { fmt.Println("display:", e) })
    s.Subscribe(func(e string) { fmt.Println("log:", e) })
    s.Notify("temp=30")
}
```

Expected output:
```
display: temp=30
log: temp=30
```

**Takeaway:** Go gives you two grammars for the same pattern — `interface` (stateful, named observers) and `func` types (stateless callbacks). Pick by whether the observer carries state.

### Go — thread-safe Subject with unsubscribe (production-shaped)

The bare slice above is **not** safe under concurrent `Subscribe`/`Notify`, and it has no unsubscribe. Real Go code guards the list with a mutex and identifies subscribers by an opaque token so they can be removed.

```go
package main

import (
    "fmt"
    "sync"
)

type ObserverFunc func(event string)

type Subject struct {
    mu       sync.RWMutex
    handlers map[int]ObserverFunc
    nextID   int
}

func NewSubject() *Subject {
    return &Subject{handlers: make(map[int]ObserverFunc)}
}

// Subscribe returns an unsubscribe func — the idiomatic teardown handle.
func (s *Subject) Subscribe(h ObserverFunc) (unsubscribe func()) {
    s.mu.Lock()
    id := s.nextID
    s.nextID++
    s.handlers[id] = h
    s.mu.Unlock()

    return func() {
        s.mu.Lock()
        delete(s.handlers, id)
        s.mu.Unlock()
    }
}

func (s *Subject) Notify(event string) {
    // Copy under read-lock so a handler that (un)subscribes won't deadlock
    // or mutate the map mid-range.
    s.mu.RLock()
    snapshot := make([]ObserverFunc, 0, len(s.handlers))
    for _, h := range s.handlers {
        snapshot = append(snapshot, h)
    }
    s.mu.RUnlock()

    for _, h := range snapshot {
        h(event)
    }
}

func main() {
    s := NewSubject()
    off := s.Subscribe(func(e string) { fmt.Println("A:", e) })
    s.Subscribe(func(e string) { fmt.Println("B:", e) })

    s.Notify("event-1")
    off() // A leaves
    s.Notify("event-2")
}
```

Expected output (map iteration order means A/B may swap on event-1):
```
A: event-1
B: event-1
B: event-2
```

**Takeaway:** the moment a Subject is touched from multiple goroutines, guard the handler collection with a `sync.RWMutex` and **notify over a snapshot**, not the live map.

---

## Worked example — temperature sensor

```python
class TemperatureSensor:
    def __init__(self):
        self._observers = []
        self._temp = 0

    def subscribe(self, fn):
        self._observers.append(fn)

    def set_temperature(self, t):
        self._temp = t
        for fn in self._observers:
            fn(t)


sensor = TemperatureSensor()

sensor.subscribe(lambda t: print(f"Display: {t}°C"))
sensor.subscribe(lambda t: print(f"AC says: {'OFF' if t < 28 else 'ON'}"))
sensor.subscribe(lambda t: t > 100 and print("WARNING!"))

sensor.set_temperature(25)
sensor.set_temperature(30)
sensor.set_temperature(110)
```

Output:
```
Display: 25°C
AC says: OFF
Display: 30°C
AC says: ON
Display: 110°C
AC says: ON
WARNING!
```

The sensor doesn't know about displays, ACs, or warnings. They subscribed.

---

## Push vs Pull

Two flavors of Observer:

- **Push**: Subject sends data with the notification (`notify(event_data)`). Easy and common.
- **Pull**: Subject just says "something changed"; observers ask for what they need (`subject.get_value()`). Flexible if observers need different bits.

Pythonic / Go style usually favors push.

### When to choose which (with the tradeoff spelled out)

| | Push | Pull |
|---|------|------|
| What the Subject sends | The actual changed data | Just a "changed" signal (often `self`) |
| Coupling | Subject decides what every observer gets | Observer queries exactly what it needs |
| Best when | All observers want roughly the same payload | Observers want *different* slices of state |
| Cost | Subject may push data some observers ignore | Each observer re-reaches into the Subject (chattier, more coupling to Subject's API) |
| Risk | Payload bloats over time as observers' needs diverge | Observer may read inconsistent state if the Subject keeps mutating after notify |

```python
# PULL example: subject passes itself; observers query what they care about.
class Stock:
    def __init__(self, symbol):
        self.symbol, self.price, self.volume = symbol, 0.0, 0
        self._observers = []

    def subscribe(self, obs): self._observers.append(obs)

    def update_quote(self, price, volume):
        self.price, self.volume = price, volume
        for obs in self._observers:
            obs.update(self)        # PULL: hand over the whole subject

class PriceWatcher:
    def update(self, stock):        # reads only price
        print(f"{stock.symbol} price -> {stock.price}")

class VolumeWatcher:
    def update(self, stock):        # reads only volume
        print(f"{stock.symbol} volume -> {stock.volume}")

s = Stock("ACME")
s.subscribe(PriceWatcher())
s.subscribe(VolumeWatcher())
s.update_quote(101.5, 5000)
```

Expected output:
```
ACME price -> 101.5
ACME volume -> 5000
```

**Takeaway:** push by default; reach for pull only when observers genuinely need divergent slices of the Subject's state.

---

## Common mistakes

### 1. Memory leaks via stale subscribers

If observer A subscribes and then is "deleted" but never unsubscribed, the subject still holds a reference. A's memory can't be freed.

Fix: explicit unsubscribe; or use weak references; or short-lived observers.

```python
# WRONG — the GUI panel is closed, but the model still notifies it forever.
class Model:
    def __init__(self): self._observers = []
    def subscribe(self, o): self._observers.append(o)
    def notify(self, e):
        for o in self._observers: o.update(e)

class Panel:
    def update(self, e): print("repaint", e)

model = Model()
panel = Panel()
model.subscribe(panel)
# user closes the panel...
panel = None            # local ref gone — but model._observers STILL holds it.
# The Panel never dies; every notify still calls its update(). Leak + wasted work.
```

```python
# RIGHT — keep the unsubscribe handle and call it on teardown.
class Model:
    def __init__(self): self._observers = []
    def subscribe(self, o):
        self._observers.append(o)
        return lambda: self._observers.remove(o)   # teardown handle
    def notify(self, e):
        for o in list(self._observers): o.update(e)

model = Model()
panel = Panel()
off = model.subscribe(panel)
# user closes the panel:
off()                   # explicit cleanup — model forgets the panel
panel = None            # now it can actually be garbage-collected
```

(For the automatic version, see Example C with `weakref.WeakSet`.)

### 2. Order of notification dependencies

If two observers must run in a specific order, hidden coupling appears. Avoid; if order matters, the system probably needs orchestration, not pub/sub.

```python
# SMELL: this only works because B happens to be subscribed after A.
sensor.subscribe(write_to_db)        # A: must persist first
sensor.subscribe(send_email_summary) # B: reads what A wrote — fragile ordering!
```
The fix is not "carefully order the list." It is to recognize this is a **pipeline/workflow** (A then B), and model it as an explicit sequence (or have B observe a *new* event that A emits *after* it finishes), not as two peers reacting to the same event.

### 3. Reentrant notifications

Observer fires → modifies subject → triggers another notification → loops. Can deadlock or recurse infinitely. Defer modifications or detect re-entry.

```python
# WRONG — observer mutates the subject during notify, re-entering notify.
class Cell:
    def __init__(self): self._observers, self.value = [], 0
    def subscribe(self, fn): self._observers.append(fn)
    def set(self, v):
        self.value = v
        for fn in self._observers: fn(self)   # re-enters set() -> infinite loop

c = Cell()
c.subscribe(lambda cell: cell.set(cell.value + 1))   # boom: RecursionError
```

```python
# RIGHT — guard against re-entry (or queue the change for after the loop).
class Cell:
    def __init__(self): self._observers, self.value, self._notifying = [], 0, False
    def subscribe(self, fn): self._observers.append(fn)
    def set(self, v):
        self.value = v
        if self._notifying:        # someone changed us mid-notify; don't recurse
            return
        self._notifying = True
        try:
            for fn in list(self._observers):
                fn(self)
        finally:
            self._notifying = False
```

### 4. Synchronous notify in hot paths

If a subject calls 100 observers synchronously, a slow one blocks all the others. For decoupling, use queues / channels / async. A single observer that does a blocking network call turns your fast in-memory `notify()` into a request that takes as long as the slowest observer.

```python
# RISK: notify() is only as fast as the slowest handler.
subject.subscribe(update_local_cache)       # microseconds
subject.subscribe(post_to_remote_webhook)   # 800 ms of network — blocks everyone

# Mitigation: hand slow work to a queue / thread pool / async task,
# so notify() just enqueues and returns immediately.
```

### 5. Forgetting thread safety

Concurrent subscribe/unsubscribe with notify can corrupt the list. Lock or use immutable copies. (See the thread-safe Go Subject above for the canonical fix: mutex + snapshot.)

### 6. Mutating the observer list *while iterating* it

Distinct from re-entry: an observer that simply unsubscribes itself during `notify` mutates the list you're looping over.

```python
# WRONG — "unsubscribe me after I fire once" corrupts the loop.
def notify(self, event):
    for obs in self._observers:          # iterating the live list
        obs.update(event)                # update() may call unsubscribe(obs)
        # -> "list changed size during iteration" / skipped observers
```

```python
# RIGHT — iterate over a snapshot copy.
def notify(self, event):
    for obs in list(self._observers):    # copy first; safe to mutate original
        obs.update(event)
```

This is exactly why Example B and the Go snapshot above loop over `list(...)`/a copied slice — "fire once then unsubscribe" is an extremely common need.

### 7. Swallowed or cascading exceptions across observers

If observer #2 of 5 raises, do observers #3–#5 still run? With the naive loop, **no** — the exception propagates and the rest are skipped, and the Subject's own caller sees an error that came from unrelated subscriber code.

```python
# Decide deliberately. Common choice: isolate each observer.
def notify(self, event):
    for obs in list(self._observers):
        try:
            obs.update(event)
        except Exception as exc:           # one bad observer shouldn't sink the rest
            log.exception("observer %r failed on %r: %s", obs, event, exc)
```
**Takeaway:** the Subject must have an explicit policy for observer failures — isolate-and-log is the usual default; "fail fast" is valid only when observers are truly part of one transaction.

---

## Idioms & best practices

- **Return an unsubscribe handle from `subscribe`.** It's the cleanest teardown API and removes the "I lost the reference, now I can't unsubscribe" footgun (Examples A, B; Go thread-safe Subject).
- **Notify over a snapshot** (`list(observers)` / copied slice). Cheap insurance against gotchas #3, #6.
- **Key listeners by event name** when a Subject has more than one kind of change (Example B). One Subject, many channels beats one Subject per change type.
- **Isolate observer exceptions** unless they're genuinely transactional (gotcha #7).
- **Prefer push; reach for pull only on demand.** Keep payloads small and stable.
- **Make the Subject's notification semantics explicit:** sync vs async, ordered vs unordered, at-most-once vs replayable. Write it in the docstring — observers depend on it.
- **In Python, "any callable" is your interface;** in Go, choose `func` types for stateless observers, `interface` for stateful ones. Don't build a heavyweight `Observer` ABC unless multiple methods/state demand it.
- **For UI, use the framework's own observer machinery** (`addEventListener`, Qt signals/slots, `tkinter` `trace`, React state/effects) rather than hand-rolling — it already handles teardown and threading.

### When NOT to use Observer

- **Exactly one consumer that will never change.** A direct method call is clearer and easier to trace. Observer's indirection is a cost you only pay back when reactions vary or grow.
- **You need a guaranteed reaction order or a multi-step workflow.** That's a pipeline/saga/orchestration, not broadcast (gotcha #2).
- **You need durability / replay / "what did I miss while offline?"** In-memory Observer is fire-and-forget. Use a persistent log/queue (Kafka, a message broker, event sourcing).
- **Debuggability is paramount and the team is junior.** Observer makes control flow non-obvious ("who runs when I publish?" requires finding all subscribers). Sometimes an explicit call list is the kinder choice.
- **Cross-process / cross-machine fan-out.** That's true Pub/Sub with a broker, not the in-process Observer object pattern.

---

## Cross-questions

### "Observer vs Pub/Sub?"

They're flavors of the same idea. "Observer" is the in-process object pattern. "Pub/Sub" usually implies a **broker** (Kafka, Redis pub/sub) — observers might be on different machines. The deeper distinction: in classic Observer the **Subject holds the list of observers directly**, so publisher and subscriber know each other through that registration. In Pub/Sub a **message broker sits in the middle**, so publishers and subscribers are mutually anonymous and can come and go independently — and the broker can buffer, persist, and route.

### "Why not just call the methods directly?"

If only one thing needs to react, direct calls are fine. Observer earns its keep when:
- The reactions vary or grow.
- The source shouldn't know about its consumers (decoupling for testing, plugins, multi-tenant).
- You want runtime registration.

### "What's the diff with Mediator?"

Mediator centralizes communication between objects (objects → mediator → other objects). Observer broadcasts (subject → many subscribers). Mediator usually has logic; Observer subjects don't. Rule of thumb: **Mediator coordinates a known set of colleagues with rules** ("when the form's Submit is enabled, disable the spinner"); **Observer broadcasts a fact to an unknown, open-ended set** ("temperature changed; whoever cares, react").

### "How does this relate to events / event-driven architecture?"

Event-driven systems are basically Observer at scale. Events flow through queues/buses; consumers subscribe. Same conceptual shape, different implementation tools.

### "What if I need history (replay missed events)?"

Observer is fire-and-forget. If you need replayability, you want **event sourcing** or a **message queue with persistence** (Kafka), not in-memory Observer.

### "Why an interface/`update()` and not just store concrete observers?"

Because the entire value is the Subject **not knowing** the concrete types. If `Subject` imported `EmailObserver`, adding `SlackObserver` would edit `Subject` — re-introducing the coupling Observer exists to remove. The narrow `update(event)` contract is what lets a new observer be a pure *addition* (Open/Closed Principle).

### "Push or pull — which is 'correct'?"

Neither universally. Push is simpler and the right default; pull is for when observers need genuinely different slices of state and you don't want the Subject's payload to balloon. See the Push vs Pull table — the real answer in an interview is "I'd push by default, and switch a specific observer to pull only if its needs diverge."

### "How do you test code that uses Observer?"

Two angles. (1) Test the **Subject** by subscribing a fake/spy observer and asserting it received the expected event(s) — e.g. a list-appending lambda, then assert on the list. (2) Test each **Observer** in isolation by calling its `update()` directly; you never need the real Subject. This testability *is* one of Observer's selling points — the decoupling that helps production also helps tests.

### "Sync or async notification — when do you make `notify` asynchronous?"

Make it async when observers do slow/blocking work (I/O, network) and you don't want the Subject's caller to wait, or when you want fault isolation between Subject and observers. The cost: you lose simple ordering and immediate error propagation, and you take on a queue/executor to manage. Keep it synchronous when reactions are fast, in-memory, and you want a straightforward call stack for debugging (gotcha #4 is the trigger to switch).

### "What about ordering guarantees?"

Classic Observer guarantees **no** ordering you should rely on (Go's `map`-backed version literally randomizes it). If your handlers are independent, that's fine and even desirable. If you *think* you need order, that's usually gotcha #2 in disguise — model it as a pipeline instead.

---

## What to read next

```
→ Foundations/DesignPatterns/decorator.md   (next pattern in this track)
```

Closely related, in order of relevance to Observer:

- **Mediator** — the "centralized coordinator" contrast drawn above; read it to sharpen when to broadcast vs. when to orchestrate.
- **Publish/Subscribe & Message Brokers** (Kafka, RabbitMQ, Redis pub/sub) — Observer "at scale," across processes, with buffering and persistence.
- **Event Sourcing / Event-Driven Architecture** — what you graduate to when you need replay, audit, and durability that in-memory Observer can't give.
- **Reactive programming** (RxJS/RxPy, `Observable`/`Subscriber`) — Observer generalized into composable streams with operators (`map`, `filter`, `debounce`).

---

## What's next

```
→ Foundations/DesignPatterns/decorator.md
```

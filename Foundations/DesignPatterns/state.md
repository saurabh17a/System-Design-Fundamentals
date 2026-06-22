# State Pattern

> **Category:** Behavioral
> **Difficulty:** ⭐⭐⭐
> **Time to read:** 18 minutes.

---

## Plain-English first

Imagine a traffic light. It has a fixed set of **modes** — Red, Green, Yellow — and what it does when "time passes" depends entirely on which mode it's in:

- Red + tick → turn Green
- Green + tick → turn Yellow
- Yellow + tick → turn Red

The light is *one* physical object, but its behavior reshapes itself depending on its current mode. You don't rebuild the traffic light; you just change which mode it's "in," and the right rules kick in.

The **State pattern** is a way to write that in code so each mode is its own self-contained chunk of behavior. Instead of one giant function full of "if we're Red do this, if we're Green do that," you give each mode its own little object that knows exactly two things:

1. What to do when each event happens while in this mode.
2. Which mode to switch to next.

The traffic light (the "context") doesn't contain any of those rules. It just holds a pointer to "the mode I'm currently in" and forwards every event to it. Want to know what happens on a tick? Ask the current mode. Switching modes is as simple as repointing that pointer at a different mode object.

**Why this helps a beginner:** the alternative is one method per event, each stuffed with a long `if/elif` chain checking a string like `self.state == "red"`. That works for two modes. At ten modes and six events, you have sixty branches scattered across six functions, and adding a new mode means hunting through all six. The State pattern keeps everything about one mode in one place.

### The precise version

> The State pattern lets an object alter its behavior when its internal state changes; the object appears to change its class. (Gang of Four, 1994.)

Technically:

- **Context** — the object whose behavior varies. It holds a reference to a `State` object and exposes the public API (`insertCoin`, `pay`, `tick`). Each public method *delegates* to the current state object.
- **State** — an interface (abstract base class in Python, interface in Go) declaring one method per event the context handles.
- **Concrete States** — one class per state. Each implements the state interface, encoding (a) behavior for each event and (b) transitions by telling the context to swap to another state.

Transitions are encoded as `context.set_state(NextState())`. The set of states and their transitions together form a **finite state machine (FSM)**; the State pattern is one concrete way to *implement* an FSM in an object-oriented language.

---

## The problem

An object's behavior depends on its **state**, and the state changes over time.

Examples:
- A vending machine: idle → coin inserted → product selected → dispensing.
- A media player: stopped → playing → paused → stopped.
- An order: placed → paid → shipped → delivered.

Naive solution: `if/elif` based on a state field, in every method. Soon every method has 5+ branches and adding a state means editing every method.

---

## The pattern

Each state becomes its **own class** with its own version of the methods. The "context" object holds a reference to the current state and delegates to it. State transitions = swap the state object.

```
   ┌─────────────────────┐
   │      Context        │
   │ ─────────────────── │
   │ - state: State      │
   │ + insertCoin()      │ ──delegates──► state.insertCoin(this)
   │ + selectProduct()   │
   │ + dispense()        │
   └─────────────────────┘
            │ uses
            ▼
   ┌─────────────────────┐
   │     <<interface>>   │
   │       State         │
   │ + insertCoin(ctx)   │
   │ + selectProduct(ctx)│
   │ + dispense(ctx)     │
   └─────────────────────┘
       △       △       △
       │       │       │
   ┌──────┐ ┌──────┐ ┌──────┐
   │ Idle │ │CoinIn│ │Selct │ ...
   └──────┘ └──────┘ └──────┘
```

### Reading the diagram

- The arrow from `Context` to `State` labeled "uses" is **composition**: the context *has a* state, and that reference is swappable at runtime. This is the heart of the pattern — runtime polymorphism by object replacement.
- The hollow triangles (△) are **implements/inherits**: each concrete state *is a* `State`.
- Notice each state method takes `ctx` (the context). That back-reference is how a state triggers a transition — it calls `ctx.set_state(...)`. Without it, states could decide behavior but not transitions.

---

## Python — vending machine

```python
from abc import ABC, abstractmethod


class State(ABC):
    @abstractmethod
    def insert_coin(self, ctx): ...
    @abstractmethod
    def select_product(self, ctx): ...
    @abstractmethod
    def dispense(self, ctx): ...


class IdleState(State):
    def insert_coin(self, ctx):
        print("Coin accepted.")
        ctx.set_state(HasCoinState())

    def select_product(self, ctx):
        print("Insert a coin first!")

    def dispense(self, ctx):
        print("Insert a coin first!")


class HasCoinState(State):
    def insert_coin(self, ctx):
        print("Coin already inserted.")

    def select_product(self, ctx):
        print("Product selected.")
        ctx.set_state(DispensingState())

    def dispense(self, ctx):
        print("Select a product first!")


class DispensingState(State):
    def insert_coin(self, ctx):
        print("Wait — dispensing...")

    def select_product(self, ctx):
        print("Wait — dispensing...")

    def dispense(self, ctx):
        print("Product dispensed!")
        ctx.set_state(IdleState())


class VendingMachine:
    def __init__(self):
        self._state: State = IdleState()

    def set_state(self, s: State):
        self._state = s

    def insert_coin(self): self._state.insert_coin(self)
    def select_product(self): self._state.select_product(self)
    def dispense(self): self._state.dispense(self)


vm = VendingMachine()
vm.dispense()         # Insert a coin first!
vm.insert_coin()      # Coin accepted
vm.select_product()   # Product selected
vm.dispense()         # Product dispensed!
vm.dispense()         # Insert a coin first! (back to Idle)
```

Each method on the machine just calls the same on its state. The transitions live inside the state classes.

> **Note on forward references:** `IdleState.insert_coin` mentions `HasCoinState`, which is *defined later in the file*. This works because the name is only looked up *when the method runs*, not when the class is defined. By the time you call `vm.insert_coin()`, all three state classes exist. If you instead tried to reference `HasCoinState` at class-body level (e.g., a default argument), you'd get a `NameError`.

**One-line takeaway:** the context is a thin shell that forwards every call to "whatever state I'm in right now."

---

## Go — order state

```go
package main

import "fmt"

type State interface {
    Pay(o *Order)
    Ship(o *Order)
    Cancel(o *Order)
    Name() string
}

type Order struct {
    state State
}

func NewOrder() *Order {
    return &Order{state: PlacedState{}}
}

func (o *Order) SetState(s State) {
    o.state = s
    fmt.Println("→ now:", s.Name())
}

func (o *Order) Pay()    { o.state.Pay(o) }
func (o *Order) Ship()   { o.state.Ship(o) }
func (o *Order) Cancel() { o.state.Cancel(o) }


type PlacedState struct{}
func (PlacedState) Name() string { return "Placed" }
func (PlacedState) Pay(o *Order) { o.SetState(PaidState{}) }
func (PlacedState) Ship(o *Order) { fmt.Println("Pay first!") }
func (PlacedState) Cancel(o *Order) { o.SetState(CancelledState{}) }

type PaidState struct{}
func (PaidState) Name() string { return "Paid" }
func (PaidState) Pay(o *Order) { fmt.Println("Already paid.") }
func (PaidState) Ship(o *Order) { o.SetState(ShippedState{}) }
func (PaidState) Cancel(o *Order) { fmt.Println("Cannot cancel after payment.") }

type ShippedState struct{}
func (ShippedState) Name() string { return "Shipped" }
func (ShippedState) Pay(o *Order) { fmt.Println("Already paid.") }
func (ShippedState) Ship(o *Order) { fmt.Println("Already shipped.") }
func (ShippedState) Cancel(o *Order) { fmt.Println("Cannot cancel after shipping.") }

type CancelledState struct{}
func (CancelledState) Name() string { return "Cancelled" }
func (CancelledState) Pay(o *Order) { fmt.Println("Cancelled.") }
func (CancelledState) Ship(o *Order) { fmt.Println("Cancelled.") }
func (CancelledState) Cancel(o *Order) { fmt.Println("Already cancelled.") }


func main() {
    o := NewOrder()    // Placed
    o.Ship()           // Pay first!
    o.Pay()            // → Paid
    o.Cancel()         // Cannot cancel after payment.
    o.Ship()           // → Shipped
}
```

Adding a new state ("Refunded"?) is a new struct that implements `State`. Existing states don't change.

> **Go-specific detail:** the concrete states are **empty structs** (`struct{}`) with value receivers (`func (PlacedState) ...`, no pointer, no field name). An empty struct occupies **zero bytes** and `PlacedState{}` allocates nothing, so these states are effectively free, shareable singletons. The interface is satisfied *structurally* — Go has no `implements` keyword. Because `PlacedState` has the four methods `State` requires, it satisfies the interface automatically. If you forget one method, the compiler errors only at the point you try to assign it to a `State` variable (e.g., inside `SetState` or `NewOrder`), which is why a missing method can surprise you.

**One-line takeaway:** in Go you implement State with small (often field-less) structs and let structural typing wire them to the interface.

---

## More runnable examples

### Example A — Python media player (stopped / playing / paused)

This shows a state that's reachable from *two* others (you can pause from playing, resume from paused), which the vending machine didn't illustrate.

```python
from abc import ABC, abstractmethod


class PlayerState(ABC):
    @abstractmethod
    def play(self, p): ...
    @abstractmethod
    def pause(self, p): ...
    @abstractmethod
    def stop(self, p): ...


class Stopped(PlayerState):
    def play(self, p):
        print("▶ start playing")
        p.set_state(Playing())
    def pause(self, p):
        print("nothing to pause")
    def stop(self, p):
        print("already stopped")


class Playing(PlayerState):
    def play(self, p):
        print("already playing")
    def pause(self, p):
        print("⏸ paused")
        p.set_state(Paused())
    def stop(self, p):
        print("⏹ stopped")
        p.set_state(Stopped())


class Paused(PlayerState):
    def play(self, p):
        print("▶ resume")
        p.set_state(Playing())
    def pause(self, p):
        print("already paused")
    def stop(self, p):
        print("⏹ stopped")
        p.set_state(Stopped())


class Player:
    def __init__(self):
        self._state = Stopped()
    def set_state(self, s): self._state = s
    def play(self):  self._state.play(self)
    def pause(self): self._state.pause(self)
    def stop(self):  self._state.stop(self)


p = Player()
p.pause()   # nothing to pause
p.play()    # ▶ start playing
p.pause()   # ⏸ paused
p.play()    # ▶ resume
p.stop()    # ⏹ stopped
```

Expected output:
```
nothing to pause
▶ start playing
⏸ paused
▶ resume
⏹ stopped
```

**One-line takeaway:** `Playing` and `Paused` each transition into the other, showing that transitions form a graph, not just a straight line.

---

### Example B — Singleton states in Python (no per-event allocation)

In the vending machine above, every transition allocates a fresh `HasCoinState()`. That's wasteful when states hold no data. Make each state a cached singleton:

```python
from abc import ABC, abstractmethod


class TurnstileState(ABC):
    @abstractmethod
    def coin(self, t): ...
    @abstractmethod
    def push(self, t): ...


class _Locked(TurnstileState):
    def coin(self, t):
        print("unlock")
        t.set_state(UNLOCKED)
    def push(self, t):
        print("denied (locked)")


class _Unlocked(TurnstileState):
    def coin(self, t):
        print("thanks, already unlocked")
    def push(self, t):
        print("go through; relocking")
        t.set_state(LOCKED)


# Module-level singletons: created once, shared by every turnstile.
LOCKED = _Locked()
UNLOCKED = _Unlocked()


class Turnstile:
    def __init__(self):
        self._state = LOCKED
    def set_state(self, s): self._state = s
    def coin(self): self._state.coin(self)
    def push(self): self._state.push(self)


t = Turnstile()
t.push()   # denied (locked)
t.coin()   # unlock
t.push()   # go through; relocking
t.push()   # denied (locked)
```

Expected output:
```
denied (locked)
unlock
go through; relocking
denied (locked)
```

**One-line takeaway:** when states carry no per-instance data, make them module-level singletons so a million turnstiles share two state objects instead of allocating millions.

---

### Example C — Go with a transition guard and shared context data

States are pure behavior, but they read/write the *context's* data. Here a `Document` carries its content and an author, and the `Moderation` state checks who's acting before allowing a transition.

```go
package main

import "fmt"

type DocState interface {
	Publish(d *Document)
	Name() string
}

type Document struct {
	state   DocState
	content string
	isAdmin bool // is the current actor an admin?
}

func NewDocument(content string, isAdmin bool) *Document {
	return &Document{state: Draft{}, content: content, isAdmin: isAdmin}
}

func (d *Document) SetState(s DocState) { d.state = s }
func (d *Document) Publish()            { d.state.Publish(d) }
func (d *Document) State() string       { return d.state.Name() }

type Draft struct{}

func (Draft) Name() string { return "Draft" }
func (Draft) Publish(d *Document) {
	fmt.Println("submitted for moderation")
	d.SetState(Moderation{})
}

type Moderation struct{}

func (Moderation) Name() string { return "Moderation" }
func (Moderation) Publish(d *Document) {
	if !d.isAdmin {
		fmt.Println("only an admin can approve from moderation")
		return // guard: stay in Moderation
	}
	fmt.Println("approved & published")
	d.SetState(Published{})
}

type Published struct{}

func (Published) Name() string         { return "Published" }
func (Published) Publish(d *Document)  { fmt.Println("already published") }

func main() {
	d := NewDocument("hello world", false)
	d.Publish()             // submitted for moderation
	d.Publish()             // only an admin can approve from moderation
	fmt.Println(d.State())  // Moderation
	d.isAdmin = true
	d.Publish()             // approved & published
	fmt.Println(d.State())  // Published
}
```

Expected output:
```
submitted for moderation
only an admin can approve from moderation
Moderation
approved & published
Published
```

**One-line takeaway:** a state can *decline* to transition (a guard); the data it checks lives on the context, not on the state.

---

### Example D — Tiny self-test you can run to verify the FSM

It's good practice to assert the reachable states rather than eyeball print output. This Python snippet drives the turnstile from Example B and asserts the resulting state name:

```python
def state_name(t):
    return type(t._state).__name__

t = Turnstile()
assert state_name(t) == "_Locked"
t.coin()                       # prints "unlock"
assert state_name(t) == "_Unlocked"
t.push()                       # prints "go through; relocking"
assert state_name(t) == "_Locked"
print("all transitions OK")
```

Expected output:
```
unlock
go through; relocking
all transitions OK
```

**One-line takeaway:** treat the state machine like any other code — write transition tests so an invalid edge fails loudly instead of silently mis-behaving.

---

## State vs `if/elif`

`if/elif` version:
```python
def ship(self):
    if self.state == "placed":
        print("pay first")
    elif self.state == "paid":
        self.state = "shipped"
    elif self.state == "shipped":
        print("already shipped")
    ...
```

This works for tiny machines. Pain points as it grows:
- Every method has the same `if/elif` ladder.
- Adding "refunded" state means editing every method.
- Hard to reason about which transitions are valid from which state.

State pattern keeps each state's complete behavior co-located.

### A way to think about the trade

Picture a grid: **rows = states, columns = events**. Every cell is "what happens when event E fires in state S."

|             | pay        | ship        | cancel      |
|-------------|------------|-------------|-------------|
| **Placed**  | → Paid     | "pay first" | → Cancelled |
| **Paid**    | "paid"     | → Shipped   | "no cancel" |
| **Shipped** | "paid"     | "shipped"   | "no cancel" |

- The `if/elif` approach organizes code by **column** (one `ship()` method spanning all rows). Adding a row (state) edits every method.
- The State pattern organizes code by **row** (one `PaidState` class spanning all events). Adding a row is a new class; existing classes are untouched — this is the **Open/Closed Principle** in action.

Neither is "always right." If events change more often than states, the column organization (or a table) can be friendlier. State pattern bets that **states are the axis of change**, which is usually true for workflows.

---

## When to use State

- The number of states is bounded but > 2-3.
- The same operations apply in each state but mean different things.
- Transitions are clearly defined.
- The behavior matters more than just storing a label.

---

## When NOT to use State

- 2 states with simple branching: just use a boolean and `if/else`.
- The state is mostly **data** (fields), not **behavior**. Don't make a class hierarchy for "color = red/blue".
- The transitions are random/external. Then it's not really a state machine.
- **The states differ only in a single value, not in behavior.** If `Bronze`, `Silver`, `Gold` tiers only change a discount *percentage*, that's a lookup table or an enum with a field — not three classes.
- **You need to persist the object and reload it.** A class-per-state machine is harder to serialize than an enum/string. If the state must round-trip through a database or JSON, consider storing a string label and reconstructing the state object on load (see the persistence cross-question below).

---

## Idioms and best practices

- **Make states stateless and shared.** Concrete states should hold no mutable data; all data lives on the context. Then you can cache one instance per state (Python module-level singletons; Go zero-size structs) and never allocate during transitions. (See Examples B and the Go order machine.)
- **Centralize the transition print/log in `set_state`.** In the Go order example, `SetState` prints `→ now: <name>`. Putting logging/metrics in one place means every transition is observable for free, and individual states stay focused on *deciding*, not *announcing*.
- **Pass the context to state methods, don't store it.** Storing `self.ctx` in each state object couples a state instance to one context and breaks the singleton idiom. Passing `ctx` as an argument keeps states shareable. (Both Python and Go examples above do this.)
- **Name states as nouns/adjectives, events as verbs.** `IdleState` / `insert_coin`. This keeps the FSM readable: "in the *Idle* state, when *insert_coin* happens…".
- **Default invalid transitions to an explicit error or no-op with a message** — never silent. A common idiom is a base class implementing every method as `raise InvalidTransition(...)`, so each concrete state only overrides the events it actually supports.
- **Keep the context's public methods one-liners** that delegate. The moment a context method does real work *and* delegates, you've split the logic across two places (a listed gotcha below).
- **For data-driven machines, prefer a table.** If states/transitions come from config or rarely have behavior, the dict-of-transitions approach is simpler and serializable.

---

## Common mistakes

### 1. State classes accumulating data

If `PaidState` has its own data, you have two competing source-of-truth: the state class and the order. State classes should be **pure behavior**, ideally singletons.

```python
# WRONG — state carries data, so it can't be a shared singleton,
# and now "the amount" lives in two places.
class PaidState(State):
    def __init__(self, amount):
        self.amount = amount        # ← belongs on the order, not the state

# FIX — data lives on the context; the state reads it.
class PaidState(State):
    def refund(self, order):
        print(f"refunding {order.amount}")   # ← single source of truth
```

### 2. Allowing state to access too much of context

A state should know enough to do its job, no more. If `PlacedState.Pay()` needs to fiddle with 5 fields of the order, maybe the order has SRP problems.

### 3. Forgetting invalid transitions

Make sure every state has a sensible response (or error) for every operation. "Doing nothing silently" is rarely correct.

```python
# WRONG — abstract method left as `...`, so an unhandled event
# silently does nothing (returns None) and the bug hides.
class ShippedState(State):
    def dispense(self, ctx): ...   # oops, no behavior, no error

# FIX — a base class makes "unsupported" loud by default.
class State(ABC):
    def insert_coin(self, ctx): self._invalid("insert_coin")
    def select_product(self, ctx): self._invalid("select_product")
    def dispense(self, ctx): self._invalid("dispense")
    def _invalid(self, op):
        raise RuntimeError(f"{op} not allowed in {type(self).__name__}")

class ShippedState(State):
    pass   # inherits "everything is invalid" until you override an event
```

Now `ShippedState().dispense(ctx)` raises `RuntimeError: dispense not allowed in ShippedState` instead of failing silently.

### 4. State logic everywhere AND in the context

Pick one place. Either context defines transitions, or states do. Mixing is confusing.

```python
# WRONG — half the transition lives in the context, half in the state.
class VendingMachine:
    def insert_coin(self):
        if isinstance(self._state, IdleState):   # ← context inspecting state type
            self._state = HasCoinState()          #   AND deciding the transition
        self._state.insert_coin(self)             #   then ALSO delegating

# FIX — context only delegates; the state owns the transition.
class VendingMachine:
    def insert_coin(self):
        self._state.insert_coin(self)   # IdleState.insert_coin does set_state(...)
```

The wrong version means adding a state requires editing *both* the context's `isinstance` ladder and the new state class — exactly the duplication the pattern exists to remove.

### 5. Forward-reference / definition-order errors

Because Python states often reference one another, ordering and scope matter.

```python
# WRONG — referencing HasCoinState in the class body, before it exists.
class IdleState(State):
    next_state = HasCoinState   # NameError: HasCoinState is not defined yet

# FIX — reference it inside a method, which runs only at call time.
class IdleState(State):
    def insert_coin(self, ctx):
        ctx.set_state(HasCoinState())   # resolved when the method runs
```

In Go, the equivalent gotcha is forgetting a method on a concrete state; the compile error appears not at the struct definition but where you assign it to the `State` interface.

---

## Cross-questions

### "State vs Strategy?"

- **Strategy**: client picks the algorithm. The choice is generally external.
- **State**: object decides its own state transitions internally. Behavior changes over time as a function of past events.

Both swap an internal field. The difference is who's driving.

Sharper version for an interviewer: the two patterns have an *identical class diagram* (a context delegating to an interface with multiple implementations). They differ in **intent and who controls the swap**:

| | Strategy | State |
|---|---|---|
| Who chooses the implementation? | The client/caller, usually once | The states themselves, repeatedly, at runtime |
| Do the implementations know about each other? | No — strategies are independent | Yes — a state references the next state to transition to |
| Lifetime | Often set once and left alone | Changes throughout the object's life |
| Mental model | "pick how to sort" | "what mode am I in now" |

### "Why not enums + a transition table?"

Totally valid alternative:

```python
TRANSITIONS = {
    ("placed", "pay"): "paid",
    ("paid", "ship"): "shipped",
    ...
}
```

For data-driven state machines (e.g., loaded from config), tables are clearer than classes. For behavior-rich states (different actions per state, side effects), classes win.

Concretely, a runnable table-driven version:

```python
TRANSITIONS = {
    ("placed", "pay"):    "paid",
    ("placed", "cancel"): "cancelled",
    ("paid", "ship"):     "shipped",
}

def step(state, event):
    nxt = TRANSITIONS.get((state, event))
    if nxt is None:
        raise ValueError(f"can't {event} from {state}")
    return nxt

s = "placed"
s = step(s, "pay")     # -> "paid"
s = step(s, "ship")    # -> "shipped"
print(s)               # shipped
```

Expected output: `shipped`.

The table wins when: transitions come from config/JSON, you want to *visualize* the whole machine, or states have no real behavior beyond moving. The classes win when each state does substantial, *different* work (side effects, validation, distinct logging). Rule of thumb: **behavior-rich → classes; data-rich/declarative → table.**

### "What about Python's `match` statement?"

Python 3.10+ `match` lets you write the if/elif version more cleanly. For 3-4 states, that might be enough. For 10+ or growing, classes scale better.

### "How does this relate to finite state machines (FSMs) in CS?"

State pattern is one way to **implement** an FSM. Other implementations: tables, switch statements, dedicated FSM libraries. State pattern fits well when each state has rich behavior.

### "What if I need state history (back/forward)?"

Add a stack to the context. Or use the **Memento** pattern to snapshot. State pattern alone doesn't give you history.

### "How do I persist a State-pattern object to a database or send it over the wire?"

The class-per-state machine doesn't serialize directly — you can't JSON-encode an `IdleState()` instance meaningfully. The idiom is to store a **string/enum label** and rehydrate the state object on load:

```python
_REGISTRY = {
    "idle": IdleState,
    "has_coin": HasCoinState,
    "dispensing": DispensingState,
}

class VendingMachine:
    def to_label(self):
        # map the live state object back to a stable string
        return {v: k for k, v in _REGISTRY.items()}[type(self._state)]

    @classmethod
    def from_label(cls, label):
        vm = cls()
        vm.set_state(_REGISTRY[label]())   # reconstruct from the stored string
        return vm
```

The persisted form is a stable string (`"has_coin"`), decoupled from your class names; the registry is the single place that knows the mapping. This is also why a pure enum/table machine is sometimes preferred when persistence is central — the stored value *is* the state.

### "Isn't one class per state a lot of boilerplate?"

Yes, and that's the honest trade-off. For 3 states and 3 events you write ~9 small methods either way; the State pattern just spreads them across files. The payoff appears when (a) states grow distinct behavior and side effects, (b) you add states often, or (c) multiple people touch the machine and you want each state isolated. If none of those hold, a table or a `match` is less code. Don't reach for the pattern reflexively.

### "Does the context ever decide a transition?"

It can, but pick *one* owner (see Common Mistake #4). The two consistent designs are: states own all transitions (context is a pure delegator — the style used throughout this doc), or the context owns a transition table and states are just behavior. Splitting transition decisions across both is the configuration that bites you.

---

## What to read next

- `Foundations/DesignPatterns/strategy.md` — the look-alike pattern; understanding the *intent* difference cements both.
- `Foundations/DesignPatterns/memento.md` — pair with State when you need undo/history of state changes.
- Background reading: "finite state machine" (the CS concept State implements) and the **Open/Closed Principle** (why adding a state shouldn't edit existing ones).

```
→ Foundations/DesignPatterns/builder.md
```

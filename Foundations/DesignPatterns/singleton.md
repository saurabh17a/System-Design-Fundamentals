# Singleton Pattern

> **Category:** Creational
> **Difficulty:** ⭐
> **Reputation:** Most overused pattern in OO. Use carefully.
> **Time to read:** 15 minutes.

---

## In one sentence (plain English)

A **Singleton** is a class that promises: "no matter how many times you ask me for an
instance, you always get the *same* one." Think of it like a country's president: there
is exactly one at a time, and everyone who says "the president" is talking about the same
person. You don't get a fresh president every time you mention the office.

Contrast that with a normal class. Every time you write `Config()` you usually get a
**brand-new, independent** object — like minting a new coin each time. A Singleton breaks
that rule on purpose: the constructor (or factory function) hands back the one shared
object instead of building a new one.

Two promises are baked in:

1. **Single instance** — only one ever exists in the process.
2. **Global access** — there's a well-known way to reach it (`Config()`, `getInstance()`,
   `Instance()`, an imported module, etc.).

### The precise / technical version

A Singleton restricts instantiation of a class to a single object and provides a global
point of access to it. Mechanically this requires:

- **Controlling construction** so callers cannot freely create new objects (in Python:
  override `__new__`; in Java/C++: a private constructor; in Go: an unexported type plus a
  package-level accessor).
- **Holding the instance in static / class-level / package-level storage** so it survives
  across calls and is shared by all callers.
- **Guarding the "create exactly once" step against concurrency**, because in a
  multithreaded process two threads can both observe "no instance yet" and each build one,
  violating promise #1.

The pattern trades *flexibility* (you can no longer choose which object to use) for
*guaranteed uniqueness and convenience*. That trade-off is exactly why it is both popular
and frequently regretted — see [Where Singleton hurts](#where-singleton-hurts).

---

## The problem

Some things should exist exactly **once** in a process:
- A configuration registry.
- A connection pool.
- A logger.
- A device driver.

Multiple instances would cause inconsistency or wasted resources.

Concretely, here is what "wasted resources" and "inconsistency" look like:

- A connection pool that exists twice means you open, say, 20 + 20 = 40 sockets to the
  database when your DBA only provisioned 20. Half your requests start failing with
  "too many connections."
- Two logger instances each buffering to the same file can interleave half-written lines,
  producing corrupt logs.
- Two config registries can disagree: thread A toggles a feature flag on instance #1,
  thread B reads `False` from instance #2, and you ship inconsistent behavior.

The Singleton is one (not the only) answer to "make this thing exist once."

---

## The pattern

A **Singleton** is a class that:
1. Allows only **one** instance to exist.
2. Provides a **global access point** to that instance.

### Structure

```
┌────────────────────────┐
│       Singleton        │
├────────────────────────┤
│ - instance (static)    │
├────────────────────────┤
│ + getInstance()        │
│ + business methods     │
└────────────────────────┘
```

### How to read this diagram

- `instance` is **static** (class-level), not per-object. That's the storage slot holding
  the one-and-only instance. Because it is static it is shared by every caller.
- `getInstance()` is the **gatekeeper**. The first call builds the instance and stashes it
  in `instance`; every later call returns that same stored object. Callers are never
  allowed to use the constructor directly.
- "business methods" reminds you the Singleton is still a real object with real behavior —
  it is not just a namespace.

---

## Python — simplest version

```python
class Config:
    _instance = None

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._init_data()
        return cls._instance

    def _init_data(self):
        self.settings = {"theme": "dark"}


a = Config()
b = Config()
print(a is b)    # True — same instance
b.settings["theme"] = "light"
print(a.settings)    # {'theme': 'light'} — shared state
```

**Why this works:** Python calls `__new__` to *allocate* an object before `__init__`
*initializes* it. By overriding `__new__` we intercept allocation: the first call creates
and caches the object on `cls._instance`; later calls short-circuit and return the cached
one. `a is b` is `True` because both names point at the exact same object in memory.

**Takeaway:** Override `__new__` (not `__init__`) to control whether a *new* object is even
created.

> **Subtle gotcha with this exact version:** `_init_data()` runs only the first time, but
> `__init__` (if you had one) would run on *every* `Config()` call, re-initializing the
> shared object. See [Common mistakes #5](#5-__init__-re-runs-on-every-call-python) below.

In practice, Pythonistas often use a **module** as a singleton — modules are imported once and persist:

```python
# config.py
settings = {"theme": "dark"}

def set_theme(t):
    settings["theme"] = t

# elsewhere:
import config
config.set_theme("light")
```

Modules in Python are inherently singletons. Often the cleanest way.

**Why:** the import system caches every module in `sys.modules` the first time it's loaded.
The second `import config` anywhere in the process returns the *same* module object — no
re-execution of the module body. So module-level state is process-global and unique by
construction, with zero boilerplate and zero thread-safety code (import is already
serialized by the import lock).

### A runnable decorator-based variant

A reusable, readable Python idiom is a `@singleton` decorator. It keeps the boilerplate in
one place and makes the intent obvious at the class:

```python
import functools

def singleton(cls):
    instances = {}

    @functools.wraps(cls)
    def get_instance(*args, **kwargs):
        if cls not in instances:
            instances[cls] = cls(*args, **kwargs)
        return instances[cls]

    return get_instance


@singleton
class Logger:
    def __init__(self):
        self.lines = []
    def log(self, msg):
        self.lines.append(msg)


x = Logger()
y = Logger()
x.log("hello")
print(x is y)        # True
print(y.lines)       # ['hello'] — y sees x's write
```

Expected output:

```
True
['hello']
```

**Takeaway:** A decorator gives you a one-line, declarative Singleton with no `__new__`
trickery — but note it is **not** thread-safe as written (the `if cls not in instances`
check can race). Use the locked version below if multiple threads can call `Logger()`
during startup.

### Metaclass variant (advanced, but common in interviews)

```python
import threading

class SingletonMeta(type):
    _instances = {}
    _lock = threading.Lock()

    def __call__(cls, *args, **kwargs):
        # __call__ on the metaclass runs when you do MyClass(...)
        if cls not in cls._instances:
            with cls._lock:
                if cls not in cls._instances:        # double-check
                    cls._instances[cls] = super().__call__(*args, **kwargs)
        return cls._instances[cls]


class Settings(metaclass=SingletonMeta):
    def __init__(self):
        self.value = 0


s1 = Settings()
s2 = Settings()
s1.value = 42
print(s2.value)      # 42
print(s1 is s2)      # True
```

Expected output:

```
42
True
```

**Why a metaclass?** A class's *metaclass* `__call__` is what runs every time you call the
class like `Settings()`. By overriding it we control instance creation centrally and
inherit-ably: any class using `SingletonMeta` becomes a thread-safe singleton without
repeating logic. This is the most "production-grade" pure-Python approach and a frequent
interview talking point.

**Takeaway:** Metaclass `__call__` is the cleanest hook for "intercept every construction,"
and it composes via inheritance.

---

## Python — thread-safe version

```python
import threading

class DBPool:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:    # double-check
                    cls._instance = super().__new__(cls)
        return cls._instance
```

Double-checked locking — fast path skips the lock if instance already exists.

### Why double-checked locking, line by line

1. **Outer `if cls._instance is None`** — the *fast path*. Once the instance exists (the
   common case for the entire life of the program), every call sees it's not `None` and
   returns immediately **without** paying the cost of acquiring the lock. Lock acquisition
   is relatively expensive and serializes threads; we want to avoid it after init.
2. **`with cls._lock`** — only threads that arrive *during* the brief window before
   initialization contend here. The lock ensures only one of them proceeds at a time.
3. **Inner `if cls._instance is None`** — the *double check*. Suppose threads T1 and T2
   both passed the outer check (instance was `None`), then T1 grabbed the lock and created
   the instance. When T2 finally gets the lock, the inner check now sees a non-`None`
   instance and skips creation. Without this second check, T2 would clobber T1's object
   with a new one — breaking the singleton guarantee.

**Note on CPython specifically:** because of the GIL, simple attribute assignment is
atomic, so a *naive* check-then-set rarely double-creates in pure CPython today. But you
should still write the locked version, because (a) it is correct under free-threaded
Python (PEP 703) and other implementations, (b) the "create" step often runs arbitrary
code (`_init_data`, opening sockets) that is *not* atomic, and (c) interviewers expect it.

**Takeaway:** Check, lock, check again — the outer check is for speed, the inner check is
for correctness.

---

## Go

Go doesn't have classes, but `sync.Once` makes singletons easy:

```go
package config

import "sync"

type Config struct {
    Theme string
}

var (
    instance *Config
    once     sync.Once
)

func Instance() *Config {
    once.Do(func() {
        instance = &Config{Theme: "dark"}
    })
    return instance
}
```

`sync.Once` guarantees the function runs exactly once, even with many goroutines calling `Instance()` concurrently.

### Why `sync.Once` and not a hand-rolled mutex?

`sync.Once` *is* an optimized double-checked-locking primitive built into the standard
library. Internally it keeps an atomic `done` flag: after the first `Do` completes, every
later `Do` is a single cheap atomic load with no lock. It also guarantees a **happens-before**
relationship — when `Do` returns, all goroutines are guaranteed to see the fully
constructed `instance`, with no torn or partially-initialized reads. Writing this correctly
by hand with `sync.Mutex` + a `bool` is easy to get *subtly* wrong (memory visibility),
which is why idiomatic Go reaches for `sync.Once`.

Here is a fully runnable program that proves uniqueness under concurrency:

```go
package main

import (
	"fmt"
	"sync"
)

type Config struct {
	Theme string
}

var (
	instance *Config
	once     sync.Once
	created  int
)

func Instance() *Config {
	once.Do(func() {
		created++ // runs exactly once
		instance = &Config{Theme: "dark"}
	})
	return instance
}

func main() {
	var wg sync.WaitGroup
	ptrs := make([]*Config, 100)
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			ptrs[i] = Instance()
		}(i)
	}
	wg.Wait()

	allSame := true
	for _, p := range ptrs {
		if p != ptrs[0] {
			allSame = false
		}
	}
	fmt.Println("created count:", created) // 1
	fmt.Println("all same instance:", allSame) // true
}
```

Expected output:

```
created count: 1
all same instance: true
```

**Takeaway:** `once.Do` runs its function exactly once across all goroutines and publishes
the result safely — the canonical Go singleton.

Like Python, Go often uses **package-level variables** as singletons:

```go
package db

var Pool = newPool()    // initialized once at package load

func newPool() *ConnectionPool { ... }
```

**Why this is safe:** Go initializes package-level variables exactly once, before `main`
runs, in a single goroutine, in dependency order. So an eagerly-initialized package var is
inherently a thread-safe singleton — no `sync.Once` needed. Prefer this when the cost of
building the object at startup is acceptable and you don't need *lazy* initialization.
Reach for `sync.Once` when you want to defer the cost until first use (or until config is
known).

> **Go gotcha — value vs pointer:** if you return the struct by value (`func Instance()
> Config`) callers get *copies*, not the shared instance, and mutations won't be visible to
> others. Singletons in Go are almost always pointers (`*Config`). Returning a value
> silently breaks the "shared state" promise.

---

## Where Singleton hurts

Singletons get a bad rep because they're often **abused**:

### 1. Hidden global state

```python
def process_order(order):
    db = DBPool()      # hidden singleton — invisible dependency
    db.save(order)
```

Tests are hard. You can't pass a fake DB; you have to monkey-patch the global. The dependency isn't obvious from the function signature.

Why this is bad in plain terms: the function's signature `process_order(order)` *lies*. It
claims to need only an `order`, but it secretly also needs a working database. A reader, a
caller, and a test all get no warning. Compare this to `process_order(order, db)` which
tells the truth.

### 2. Coupling tests

If `Config` is a singleton modified by test 1, test 2 sees the modification. Tests stop being independent.

This produces the worst kind of flakiness: tests that pass alone but fail when run together,
or pass/fail depending on *order*. Debugging "works on my machine, fails in CI" often traces
back to shared singleton state leaking across tests.

### 3. Multiple Singletons interacting

When 5 singletons all call each other, you've built a global mess. Hard to reason about, hard to refactor.

This is effectively a return to global variables with object syntax. The dependency graph
becomes implicit and cyclic; you can no longer construct one piece in isolation, so unit
testing degrades into integration testing.

### 4. Subclassing / mocking pain

Want to swap `DBPool` for tests? You'll fight the singleton-ness. With dependency injection, you'd just pass a different object.

### 5. Initialization order & lifecycle bugs

Lazy singletons hide *when* expensive setup happens. The first caller — possibly deep in a
request handler, possibly under load — pays the cost of opening sockets or reading files,
turning a startup concern into a runtime latency spike. Eager package-level init makes the
cost predictable but can fail at import time in surprising ways (e.g., reading an env var
that isn't set yet).

---

## When Singleton is OK

- The thing genuinely is unique by **OS reason** (single hardware device, OS-level resource).
- It has **no behavior of its own**, just config — and tests don't care.
- The lifecycle perfectly matches the process lifecycle.

For most "I want one logger" / "I want one DB pool" — pass it in via DI. You get the benefits without the global pain.

### A decision checklist

Ask, in order:

1. **Is uniqueness a *correctness* requirement, or just convenient?** If two instances would
   merely be wasteful (not *wrong*), you probably want a shared instance via DI, not a
   hard singleton.
2. **Does it carry mutable state that tests will touch?** If yes, prefer DI so each test
   gets a fresh object.
3. **Could a module-level variable (Python) or package var (Go) do the job?** If yes, use
   that — it's the honest, low-ceremony form.
4. **Do you need to substitute behavior (fakes/mocks, A/B implementations)?** If yes,
   Singleton actively fights you; use an interface + DI.

If you answered "convenient / no mutable test state / a module would do / no substitution
needed," a Singleton (or module var) is fine. Otherwise, inject.

---

## Singleton vs Dependency Injection

```python
# Singleton (bad for testing)
class Service:
    def do(self):
        DB.instance().save(...)

# DI (good)
class Service:
    def __init__(self, db):
        self.db = db
    def do(self):
        self.db.save(...)
```

The DI version makes the dependency **visible**. You can pass a fake DB in tests. The singleton version hides it.

A common compromise: keep a singleton for the **production** wiring, but write code that accepts an instance via DI:

```python
def main():
    svc = Service(db=DB.instance())
    svc.do(...)
```

### Seeing the testing payoff concretely

```python
class FakeDB:
    def __init__(self):
        self.saved = []
    def save(self, row):
        self.saved.append(row)


def test_do_saves():
    fake = FakeDB()
    svc = Service(db=fake)         # inject the fake — no globals, no patching
    svc.do_with(row={"id": 1})     # imagine do() takes a row
    assert fake.saved == [{"id": 1}]
```

This test is **isolated** (its own `FakeDB`), **fast** (no real DB), and **honest** (the
dependency is right there in the constructor). None of that is easy with the singleton
form, where you'd have to `monkeypatch` `DB.instance`. This is the single strongest
argument for preferring DI by default.

---

## Common mistakes

### 1. Forgetting thread safety

A naive `if _instance is None: _instance = X()` can race in multi-threaded code. Use `sync.Once` (Go), `threading.Lock` (Python), or initialize at module load.

**Wrong:**

```python
class Cache:
    _instance = None
    def __new__(cls):
        if cls._instance is None:          # T1 and T2 can both pass here
            cls._instance = super().__new__(cls)
            cls._instance.data = load_huge_file()   # runs twice -> two objects
        return cls._instance
```

**Fix:** wrap the create step in a lock with a double-check (see
[thread-safe version](#python--thread-safe-version)), or just use a module-level variable so
import-time initialization (already serialized) does the work.

### 2. Singleton everywhere

If you find every class is a singleton, you're back to procedural with extra steps. Singletons should be rare.

### 3. Putting business logic in a Singleton

A `UserService` singleton couples your business logic to global state. Make services regular classes with injected dependencies.

### 4. Using Singleton to "share data"

If two things need to share data, pass it. Don't create a global to dodge the design problem.

### 5. `__init__` re-runs on every call (Python)

This is the most common *correctness* bug specific to the `__new__` approach.

**Wrong:**

```python
class Config:
    _instance = None
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    def __init__(self):
        self.settings = {}      # BUG: runs on EVERY Config(), wiping state


a = Config()
a.settings["theme"] = "dark"
b = Config()                    # __init__ runs again, resetting settings!
print(a.settings)              # {} — surprise, your data is gone
```

Expected (buggy) output:

```
{}
```

**Why:** `__new__` controls *creation*, but Python still calls `__init__` on the returned
object **every time** you write `Config()`, even when `__new__` returns the cached
instance. So `__init__` re-initializes the shared object on each call.

**Fix A — guard initialization:**

```python
class Config:
    _instance = None
    _ready = False
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    def __init__(self):
        if Config._ready:
            return
        self.settings = {}
        Config._ready = True
```

**Fix B — do the work in `__new__` (no `__init__`):** put one-time setup in `__new__` itself,
as the [simplest version](#python--simplest-version) does with `_init_data()`.

**Fix C — use the metaclass approach**, which calls `__init__` exactly once because
construction is intercepted at `__call__`.

**Takeaway:** With `__new__`-based singletons, remember `__init__` still fires every call —
guard it or avoid it.

### 6. Confusing "one instance" with "one per thread/process/import path"

A module imported under two different names (e.g., `import config` vs
`import pkg.config` if `sys.path` is misconfigured) can load *twice*, giving you two
"singletons." Likewise, forking a process (Python `multiprocessing`, Go after `os/exec`)
gives each child its *own* copy of the singleton — it is per-process, never truly global
across machines. Don't assume a Singleton spans threads-only when it might be copied.

**Takeaway:** A Singleton is unique *within one process and one import graph* — not across
processes, forks, or machines.

---

## Cross-questions

### "Are singletons an anti-pattern?"

Not always — but they're easy to misuse, so many senior engineers reach for DI first. A logging library or a connection pool can reasonably be a singleton; a `UserService` or `OrderProcessor` should not.

### "What about modules as singletons (Python) or package-level state (Go)?"

These are de facto singletons. They're more honest than the explicit Singleton pattern — no hidden lazy init, no thread-safety dance. If your singleton has no per-call config, a module-level var is usually fine.

### "How do I test code that uses a singleton?"

- Best: refactor to DI.
- OK: provide a `reset_singleton()` for tests.
- Worst: monkey-patch.

### "Singleton vs static class?"

Static methods can act like a stateless singleton, but you can't substitute behavior. If you need polymorphism or DI, use an instance.

### "How does Singleton interact with DIP?"

Poorly. DIP wants you to depend on an abstraction passed in. Singleton wants you to grab the global. A compromise: have a singleton instance that **implements** the abstraction; pass it via DI everywhere. Best of both.

### "Why override `__new__` and not `__init__` in Python?"

Because `__new__` controls whether a *new object is allocated at all*, while `__init__`
only initializes an already-allocated object. To return a *cached* instance you must
intercept allocation, which only `__new__` (or a metaclass's `__call__`) can do. Using only
`__init__` cannot prevent a second object from being created. (And as Common Mistake #5
shows, `__init__` will still re-run on the cached object unless you guard it.)

### "Why `sync.Once` and not a global `bool` flag in Go?"

A plain `if !done { done = true; instance = ... }` has a **data race**: two goroutines can
both read `done == false`, and there's no memory barrier guaranteeing other goroutines see
the fully-built `instance`. `sync.Once` provides both mutual exclusion for the init and the
happens-before guarantee that publishes the result safely. The race detector
(`go run -race`) will flag the hand-rolled version.

### "Is the Singleton lazy or eager — and does it matter?"

- **Lazy** (`sync.Once`, `__new__` on first call): built on first use. Pro: no startup cost
  if never used; can wait until config is available. Con: first caller pays latency; init
  can fail mid-request.
- **Eager** (module/package-level var): built at import/load. Pro: predictable, fails fast
  at startup, inherently thread-safe. Con: pays the cost even if unused; can't depend on
  runtime-only data.

Choose lazy when construction is expensive *and* sometimes skipped; choose eager when you
want fail-fast startup and simplicity.

### "How is Singleton different from a Borg / Monostate?"

The **Borg/Monostate** idiom (common in Python) allows *many instances* but makes them
*share the same state* by pointing every instance's `__dict__` at a shared class-level dict:

```python
class Borg:
    _shared = {}
    def __init__(self):
        self.__dict__ = Borg._shared
```

`Borg()` returns different objects (`a is b` is `False`) but `a.x = 1` is visible as `b.x`.
Singleton enforces *one identity*; Borg enforces *one state*. Borg sidesteps the
`__init__`-re-run problem and is friendlier to subclassing, at the cost of `is`-identity no
longer signaling shared-ness.

### "Can a Singleton be garbage collected / reset?"

In Python you can clear the class attribute (`Config._instance = None`) and the old object
becomes collectible once no references remain — handy for tests, dangerous in production. In
Go, a package-level instance lives for the program's lifetime and is never collected. Plan
for this: if you need teardown (closing the DB pool on shutdown), expose an explicit
`Close()` rather than relying on GC.

### "Does Singleton violate the Single Responsibility Principle?"

Often, yes. A Singleton typically takes on a second responsibility — *managing its own
lifecycle/uniqueness* — on top of its real job. Separating "who decides there's one of
these" (a factory / DI container) from "what the object does" keeps each responsibility in
one place, which is why DI containers exist.

---

## What's next

```
→ Foundations/DesignPatterns/observer.md
```

Also worth reading after this:

- `Foundations/DesignPatterns/factory.md` — factories and DI containers are the usual,
  more testable answer to "I want a controlled, shared instance."
- `Foundations/Principles/dependency-inversion.md` — the principle that most directly
  tensions with Singleton; understanding it tells you *when* to inject instead.

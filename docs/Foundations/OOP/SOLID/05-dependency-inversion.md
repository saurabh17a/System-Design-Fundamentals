# DIP — Dependency Inversion Principle

> **The D in SOLID.**
> **Prerequisites:** `04-interface-segregation.md`.
> **Time to read:** 18 minutes.

> *"High-level modules should not depend on low-level modules. Both should depend on abstractions."*
> *"Abstractions should not depend on details. Details should depend on abstractions."* — Robert C. Martin

---

## What it means

Don't let high-level business logic depend directly on low-level implementation classes. Have both depend on **abstractions** (interfaces, protocols, abstract classes).

This is the principle behind **Dependency Injection** (DI) and the reason testable code looks the way it does.

### Plain-English version (read this first)

Imagine you're writing a function that sends a notification when an order ships. The "what" is high-level: *notify the customer*. The "how" is low-level: *connect to Twilio and send an SMS*. The naive instinct is to write the SMS code right inside your order logic.

DIP says: **stop wiring the "what" directly to one specific "how."** Instead, the high-level code should say "I need *something* that can notify a customer" — and let whatever-it-is be plugged in from the outside. Today it's SMS. Tomorrow it's email. In a test, it's a fake that just records "I was called." Your order logic never changes, because it only ever talked to the idea of a notifier, not to Twilio.

A useful mental image: think of a **wall socket**. Your laptop charger doesn't care which power plant generates the electricity. It depends on the *shape of the socket* (the abstraction). The power company conforms to that socket shape too. Neither the charger nor the plant depends on the other — both depend on the agreed-upon socket. You can switch power providers and your charger keeps working. That socket is your interface.

Two everyday phrases capture the whole principle:
- **"Depend on what you need, not on how it's done."**
- **"Pass it in, don't reach out for it."** (You receive your dependencies; you don't construct them yourself.)

### The precise / technical version

Robert C. Martin's formulation has two clauses, and most people only remember the first:

1. **High-level modules should not depend on low-level modules. Both should depend on abstractions.**
   - *High-level module* = policy. The code that captures the important business decisions (e.g. `UserService.register`). It's the reason your application exists.
   - *Low-level module* = mechanism. The plumbing (MySQL driver, HTTP client, file system). Replaceable detail.
   - Before DIP, `policy → mechanism`. After DIP, `policy → abstraction ← mechanism`.

2. **Abstractions should not depend on details. Details should depend on abstractions.**
   - The interface must be written in terms of the *consumer's* needs, not the *implementer's* convenience. A `UserRepo` interface should expose `get`/`save` (what the business wants), never `executeRawSql` (a MySQL detail). If your "abstraction" leaks the concrete technology, it isn't an abstraction — it's a thin wrapper that re-couples you.

The word **"inversion"** refers to *ownership of the contract*. In a traditional layered architecture, the lower layer defines its own API and the upper layer is forced to consume it as-is. DIP inverts this: the **upper (high-level) layer defines the abstraction it wants**, and the lower layer must conform. Source-code dependency now points *against* the direction of runtime control flow. (At runtime, `UserService` still calls into `MySQLUserRepo`; but at compile/source time, `MySQLUserRepo` depends on the `UserRepo` interface, not the other way around.)

> Sharpen the distinction: DIP is about the **direction of source-code dependencies**. DI is about **how the object gets its collaborators**. They travel together but are not the same thing — see "Confusing DI and DIP" below.

---

## A violation

```python
# Low-level: knows about MySQL
class MySQLUserRepo:
    def get(self, id): ...
    def save(self, user): ...

# High-level: business logic
class UserService:
    def __init__(self):
        self.repo = MySQLUserRepo()    # hard dependency

    def register(self, name, email):
        u = User(name=name, email=email)
        self.repo.save(u)
        return u
```

Problems:
1. **Can't test** without a real MySQL. Slow, fragile.
2. **Can't swap** to PostgreSQL or in-memory store without editing `UserService`.
3. **High-level depends on low-level**. Changing the DB driver ripples upward.

> The smell to recognize: **the `new`/constructor call buried inside the high-level class.** `self.repo = MySQLUserRepo()` is the moment your policy reached out and grabbed a specific mechanism. Every DIP fix is, at its heart, "move that construction out to the edge of the system."

---

## DIP fix — invert the dependency

```python
from abc import ABC, abstractmethod

# The abstraction (high-level owns this)
class UserRepo(ABC):
    @abstractmethod
    def get(self, id): ...
    @abstractmethod
    def save(self, user): ...


# The detail (low-level depends on the abstraction)
class MySQLUserRepo(UserRepo):
    def get(self, id): ...
    def save(self, user): ...


# High-level depends on the abstraction
class UserService:
    def __init__(self, repo: UserRepo):
        self.repo = repo    # injected!

    def register(self, name, email):
        u = User(name=name, email=email)
        self.repo.save(u)
        return u
```

Now:
1. **Testable** — pass a fake `InMemoryUserRepo` in tests.
2. **Swappable** — pass `PostgresUserRepo` for a different deployment.
3. **High-level** owns the contract. Low-level conforms.

The dependency arrow **inverted**: `UserService → UserRepo ← MySQLUserRepo`. Both depend on the abstraction.

---

## In tests

```python
class InMemoryUserRepo(UserRepo):
    def __init__(self): self._data = {}
    def get(self, id): return self._data.get(id)
    def save(self, user): self._data[user.id] = user


def test_register_creates_user():
    repo = InMemoryUserRepo()
    svc = UserService(repo)
    u = svc.register("Alice", "a@x.com")
    assert repo.get(u.id) == u    # no DB needed
```

Fast, deterministic, isolated. This is **the** payoff of DIP.

---

## Go example

```go
type UserRepo interface {
    Get(id string) (*User, error)
    Save(*User) error
}

type UserService struct {
    repo UserRepo    // depends on the abstraction
}

func NewUserService(r UserRepo) *UserService {
    return &UserService{repo: r}
}

func (s *UserService) Register(name, email string) (*User, error) {
    u := &User{ID: uuid(), Name: name, Email: email}
    if err := s.repo.Save(u); err != nil {
        return nil, err
    }
    return u, nil
}
```

In `main.go`:

```go
func main() {
    repo := NewMySQLUserRepo(db)    // production
    svc := NewUserService(repo)
    ...
}
```

In tests:

```go
type fakeRepo struct{ users map[string]*User }
func (f *fakeRepo) Get(id string) (*User, error) { return f.users[id], nil }
func (f *fakeRepo) Save(u *User) error { f.users[u.ID] = u; return nil }
```

Service code never knows or cares about MySQL.

### Why Go is the cleanest DIP language

There's a structural reason Go feels so natural here, and it's worth understanding because it changes *where you put the interface*.

In Python/Java, `MySQLUserRepo` must *explicitly say* `class MySQLUserRepo(UserRepo)` — it declares "I implement this interface." The implementer points at the abstraction by name. This means interfaces tend to live near the implementation, and a junior dev's instinct is "put `UserRepo` in the repo package." That instinct *re-couples* you: the high-level package now imports the repo package to see the interface.

Go uses **structural (implicit) interface satisfaction**. `fakeRepo` and `MySQLUserRepo` satisfy `UserRepo` *just by having the right methods* — they never name the interface. So the idiomatic Go move is:

> **Define the interface in the package that consumes it (the high-level package), not the package that implements it.**

```go
// package user  (high-level — owns the contract)
package user

type Repo interface {            // small, defined by the consumer's need
    Get(id string) (*User, error)
    Save(*User) error
}

type Service struct{ repo Repo }

// package mysql (low-level — knows nothing about package user's interface)
package mysql

type UserRepo struct{ db *sql.DB }
func (r *UserRepo) Get(id string) (*user.User, error) { /* ... */ }
func (r *UserRepo) Save(u *user.User) error           { /* ... */ }
// no `import "user"` for the interface; it just happens to fit
```

This is the literal embodiment of clause 1 of DIP: the source-code import points *from* `mysql` *to* `user`, against the runtime call direction. The Go proverb **"accept interfaces, return structs"** is DIP advice in disguise — accept the *abstraction* you need; hand back the *concrete* thing you built.

---

## More small runnable examples

Each is self-contained. Run the Python ones with `python file.py`.

### Example A — a notifier you can swap and fake (Python)

```python
from abc import ABC, abstractmethod

class Notifier(ABC):                       # abstraction owned by high-level
    @abstractmethod
    def send(self, to: str, msg: str) -> None: ...

class ConsoleNotifier(Notifier):           # detail
    def send(self, to, msg):
        print(f"[console] -> {to}: {msg}")

class CollectingNotifier(Notifier):        # test double
    def __init__(self): self.sent = []
    def send(self, to, msg): self.sent.append((to, msg))

class OrderService:                        # high-level policy
    def __init__(self, notifier: Notifier):
        self.notifier = notifier
    def ship(self, order_id, customer):
        # ... business logic ...
        self.notifier.send(customer, f"Order {order_id} shipped!")

# production wiring
OrderService(ConsoleNotifier()).ship("A-100", "alice@x.com")

# test wiring
spy = CollectingNotifier()
OrderService(spy).ship("A-200", "bob@x.com")
assert spy.sent == [("bob@x.com", "Order A-200 shipped!")]
print("test passed:", spy.sent)
```

Expected output:
```
[console] -> alice@x.com: Order A-100 shipped!
test passed: [('bob@x.com', 'Order A-200 shipped!')]
```
**Takeaway:** the same `OrderService` runs against a real notifier in prod and a recording spy in tests — zero changes to the policy.

### Example B — DIP without an explicit ABC, using `typing.Protocol` (Python, idiomatic)

`Protocol` gives you Go-style structural typing: a class satisfies the interface by *shape*, without inheriting from it.

```python
from typing import Protocol

class Clock(Protocol):                     # structural — no inheritance needed
    def now(self) -> float: ...

class TokenBucket:                         # high-level depends on the Protocol
    def __init__(self, clock: Clock, capacity: int):
        self.clock, self.capacity, self.tokens = clock, capacity, capacity
        self.last = clock.now()
    def allow(self) -> bool:
        t = self.clock.now()
        self.tokens = min(self.capacity, self.tokens + (t - self.last))
        self.last = t
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False

class FakeClock:                           # never says ": Clock" — just fits
    def __init__(self): self.t = 0.0
    def now(self): return self.t
    def advance(self, secs): self.t += secs

clock = FakeClock()
bucket = TokenBucket(clock, capacity=2)
print(bucket.allow(), bucket.allow(), bucket.allow())  # drain the bucket
clock.advance(1.0)                                      # one token regenerates
print(bucket.allow())
```

Expected output:
```
True True False
True
```
**Takeaway:** injecting `Clock` makes time-dependent logic deterministically testable — and `Protocol` lets the fake conform by shape, no base class required.

### Example C — DIP with a plain function (you don't always need a class) (Python)

The dependency can be just a callable. The "interface" is the function signature.

```python
from typing import Callable

def process_payment(amount: int, charge: Callable[[int], bool]) -> str:
    return "ok" if charge(amount) else "declined"

def always_succeeds(amount): return True
def always_declines(amount): return False

print(process_payment(500, always_succeeds))   # ok
print(process_payment(500, always_declines))   # declined
```

Expected output:
```
ok
declined
```
**Takeaway:** in dynamic languages, a higher-order function is the lightest possible inversion — no `ABC`, no class, just "pass the behavior in."

### Example D — runnable Go program: swap dependencies at `main` (Go)

```go
package main

import "fmt"

// abstraction (owned by the high-level "greeter" policy)
type Translator interface {
	Greeting(name string) string
}

// two details
type English struct{}
func (English) Greeting(name string) string { return "Hello, " + name }

type Spanish struct{}
func (Spanish) Greeting(name string) string { return "Hola, " + name }

// high-level policy depends only on Translator
func Welcome(t Translator, name string) string {
	return t.Greeting(name) + "!"
}

func main() {
	fmt.Println(Welcome(English{}, "Ada"))
	fmt.Println(Welcome(Spanish{}, "Ada"))
}
```

Expected output:
```
Hello, Ada!
Hola, Ada!
```
**Takeaway:** the policy `Welcome` is closed against the choice of language; new translators plug in without touching it (DIP + OCP working together).

### Example E — the failure mode, made concrete (Python)

What "untestable because of a hard dependency" actually feels like:

```python
import time

class SlowReportBuilder:
    def build(self):
        time.sleep(3)          # hard dependency on the real wall clock
        return "report ready"

# A test for this MUST wait 3 real seconds. Multiply by 200 tests -> 10 min suite.
```

Fix by injecting a sleeper:

```python
from typing import Callable

class ReportBuilder:
    def __init__(self, sleep: Callable[[float], None] = time.sleep):
        self._sleep = sleep
    def build(self):
        self._sleep(3)
        return "report ready"

# test: inject a no-op, runs in microseconds
rb = ReportBuilder(sleep=lambda secs: None)
print(rb.build())              # report ready  (instantly)
```

Expected output:
```
report ready
```
**Takeaway:** any call to a slow/external thing (`sleep`, `requests.get`, `open`, `datetime.now`) is a hidden dependency; inject it and your tests stop being slow and flaky.

---

## DIP enables the dependency injection container

In larger systems, you have many components, each needing dependencies. Wiring them by hand:

```python
db = connect()
user_repo = MySQLUserRepo(db)
emailer = SMTPEmailer(...)
auth = AuthService()
user_svc = UserService(user_repo, emailer, auth)
```

That's **the composition root** — the one place that knows the concrete types. Everywhere else, code receives abstractions. DI containers (Spring, Guice, etc.) automate this wiring; in Go and Python, manual wiring is often clearer.

### The composition root in one picture

```
                 ┌─────────────────────────────────────┐
   main() /      │  COMPOSITION ROOT                    │
   wsgi.py /     │  - the ONLY place that says new/()    │
   cmd/server/   │  - knows MySQL, SMTP, Redis by name   │
                 │  - assembles the object graph         │
                 └───────────────┬─────────────────────┘
                                 │ injects concretes
                                 ▼
   ┌──────────────────────────────────────────────────────┐
   │  EVERYTHING ELSE (your whole app)                      │
   │  - sees only interfaces: UserRepo, Notifier, Clock     │
   │  - never constructs its own dependencies               │
   │  - therefore: testable, swappable, decoupled           │
   └──────────────────────────────────────────────────────┘
```

The size of the "knows-concrete-types" region shrinks to a single function. That is the entire architectural win.

### Three ways to inject (and when to use each)

| Style | What it looks like | Use when |
|---|---|---|
| **Constructor injection** | `def __init__(self, repo: UserRepo)` | Default choice. The dependency is required for the object to be valid. Makes missing deps a construction-time error. |
| **Setter / property injection** | `svc.repo = repo` after construction | The dependency is optional or swappable at runtime (rare). Risk: object exists in a half-built state. |
| **Method / parameter injection** | `def register(self, name, repo: UserRepo)` | The dependency varies per call, or is needed by only one method. |

Prefer **constructor injection**. It guarantees an object is fully wired the instant it exists, and the type signature documents every collaborator. Field/setter injection (common with annotation-based frameworks like Spring's `@Autowired` on a field) is convenient but hides dependencies and permits `null` collaborators — favor constructor injection even in framework code.

---

## DIP and OCP — siblings

OCP: extend without modifying.
DIP: depend on abstractions.

Together they enable the strategy pattern and most modern OO architecture. To extend (OCP), you implement a new concrete class. The high-level code, depending on an abstraction (DIP), uses it without knowing.

### How DIP relates to the other four SOLID principles

- **SRP (Single Responsibility):** SRP tells you *where the seams are* — each responsibility is a candidate dependency to invert. You can't inject a dependency you haven't first separated out.
- **OCP (Open/Closed):** as above — DIP is the *mechanism* that makes OCP achievable. You extend behavior by supplying a new implementation of an injected abstraction.
- **LSP (Liskov Substitution):** DIP is only *safe* if substitutes behave correctly. The whole value of "pass any `UserRepo`" collapses if some implementation violates the contract (e.g. `save` silently drops data). LSP guarantees the abstraction is honest.
- **ISP (Interface Segregation):** ISP keeps the injected abstractions *small*. A fat interface forces every test double and every implementer to stub methods they don't use. DIP + ISP = inject narrow, role-specific interfaces (`Reader`, `Saver`) rather than one giant `Repository`.

DIP is the principle that *ties the other four together* at runtime: small honest interfaces (ISP+LSP), separated by responsibility (SRP), wired so policy is closed to change (OCP).

---

## Common mistakes

### 1. "Just a small dependency"

```python
class OrderService:
    def total(self):
        from logging import getLogger    # secretly low-level
        getLogger().info(...)
```

Even logging is a dependency. For tests or to inject a fake logger, you need DIP. (For logging specifically, most teams accept a bit of leak — but the principle still applies.)

### 2. Fake interface

```python
class UserRepo(ABC):
    @abstractmethod
    def get(self, id): ...

class MySQLUserRepo(UserRepo):
    def get_with_join(self, id, joins): ...    # NOT in interface
```

If you keep adding concrete-only methods, you've defeated the abstraction. Code that uses `MySQLUserRepo.get_with_join` is back to depending on the concrete.

### 3. Over-abstraction

Don't introduce an interface "just in case." YAGNI. Wait until you have **two** real implementations or a clear test need before defining the abstraction.

### 4. Confusing DI and DIP

- **Dependency Injection** = passing dependencies in (constructor, parameter), not creating them.
- **Dependency Inversion** = depending on abstractions, not concrete types.

You can DI without DIP (pass a concrete `MySQLRepo`). You can DIP without DI (use a service locator). Doing both is the goal.

### 5. The leaky abstraction (clause 2 violation)

The interface exists, but it's shaped around the implementer, so callers still code to the technology.

```python
# WRONG — the "abstraction" leaks MySQL concepts
class UserRepo(ABC):
    @abstractmethod
    def execute_query(self, sql: str): ...     # callers must write SQL!
    @abstractmethod
    def begin_mysql_transaction(self): ...      # name screams MySQL

# A Mongo or in-memory impl can't honestly satisfy this without faking SQL.
```

```python
# RIGHT — the abstraction speaks the consumer's language
class UserRepo(ABC):
    @abstractmethod
    def get(self, id: str) -> "User | None": ...
    @abstractmethod
    def save(self, user: "User") -> None: ...
    @abstractmethod
    def find_by_email(self, email: str) -> "User | None": ...
```

**Rule:** if you can't write a clean in-memory implementation of your interface, the interface is leaking details. The in-memory fake is your litmus test for clause 2.

### 6. Service locator masquerading as DIP

```python
# WRONG — dependency is hidden, fetched from a global
class UserService:
    def register(self, name, email):
        repo = Registry.get("user_repo")   # reaches out to a global
        repo.save(User(name, email))
```

This *technically* depends on an abstraction, but the dependency is **invisible in the type signature** and global mutable state makes tests order-dependent and fragile. You "inverted" the dependency but smuggled in tight coupling to the locator. Prefer explicit constructor injection — the dependency should be readable from the signature.

### 7. Injecting a concrete by accident (Python type-hint trap)

```python
# WRONG — annotation lies; you can't substitute anything else
def __init__(self, repo: MySQLUserRepo): ...   # concrete in the signature
```

```python
# RIGHT
def __init__(self, repo: UserRepo): ...        # abstraction in the signature
```

The type hint *is the dependency declaration*. If it names a concrete class, you've DI'd without DIP — the fix is to hint the interface.

---

## Idioms and best practices

- **Construct at the edges, depend at the core.** Push every `new`/constructor of a concrete dependency out to `main`/`wsgi`/`cmd/server`. The deeper a module sits, the fewer concrete types it should know.
- **Accept interfaces, return concrete types** (Go proverb, but universally good). Take the narrowest abstraction you can use; hand back the specific thing you built.
- **Define the interface where it's *used*, not where it's *implemented*.** This keeps the source-dependency arrow pointing the right way (consumer owns the contract). Especially natural in Go; achievable in Python with `Protocol`.
- **Keep abstractions thin (ISP).** One method is fine. `Notifier.send(...)` beats a `MessagingPlatform` with twelve methods your test must stub.
- **Make the fake first.** When you can write a trivial in-memory/recording double, your abstraction is honest. If the fake is painful, the interface is wrong.
- **One composition root per process.** Web app, CLI, worker — each entry point has exactly one place that knows concretes.
- **Prefer constructor injection.** Required collaborators belong in the constructor so an object is never half-built.

### When NOT to use DIP

DIP is a cost (extra interface, extra indirection, harder to "jump to definition"). Skip it when the cost outweighs the benefit:

- **Scripts and one-offs.** A 100-line data-munging script with one obvious DB call doesn't need a repository interface.
- **Stable, ubiquitous, pure dependencies.** You don't inject `math.sqrt`, `len()`, or `json.dumps`. They're deterministic, fast, dependency-free, and will never be swapped or faked. Inverting them is pure noise.
- **Single implementation with no test need.** If there's exactly one impl, it's fast and in-process, and you have no reason to fake it, an interface is speculative generality (YAGNI). Add it the day you get a second implementation or a test that demands a double.
- **Value objects / data classes.** A `Point(x, y)` or a DTO has no behavior to invert.
- **Inside the composition root itself.** The root is *supposed* to know concretes — that's its job. Don't try to abstract it away.

The honest summary: **DIP earns its keep at boundaries** (DB, network, filesystem, clock, randomness, third-party SDKs, anything slow/external/non-deterministic). It is overkill in the pure, fast, single-implementation core.

---

## Cross-questions

### "Doesn't this just push the dependency to `main()`?"

Yes — and that's the point. Concentrate concrete-knowledge in one tiny composition root. The rest of the system is independent and testable.

### "Why is it called 'inversion'?"

Without DIP, the dependency goes top-down: business logic → DB code. The "natural" direction. With DIP, the DB code depends on the interface defined alongside (or by) the business logic. The arrow flipped.

### "When is DIP overkill?"

For a 100-line script, definitely. For a single function with one obvious implementation, definitely. DIP earns its keep when:
- The dependency is slow / external / unreliable (DB, network, filesystem).
- You need to test the dependent code without it.
- You expect multiple implementations.

### "Does Go without abstract classes still let me do DIP?"

Yes. Go's interfaces are the perfect DIP tool — small, implicit, defined where consumed. Go idiomatically does DIP by accepting interfaces in function signatures.

### "What about static-typed languages with dependency injection frameworks (Java/Spring)?"

Same principle, more ceremony. The framework wires concrete bindings to abstractions at boot time. The application code only knows interfaces.

### "Why depend on an abstraction at all — why not just pass the concrete `MySQLUserRepo` into the constructor? I'm already injecting it."

Because injecting a *concrete* type is DI without DIP — and you only get half the benefit. You've solved "who constructs it" but not "what can I substitute." With `def __init__(self, repo: MySQLUserRepo)`, your test is forced to instantiate (or subclass) the real MySQL class, and you cannot drop in an unrelated in-memory fake or a Postgres impl. The abstraction is what makes the *set of valid substitutes* open-ended. Pass the interface, and the door stays open.

### "Why an interface and not duck typing / just-call-the-method? Python lets me pass anything with a `.save()`."

You *can*, and Example C shows it's legitimate. But an explicit `ABC` or `Protocol` buys you three things duck typing doesn't: (1) **a name** for the contract that documents intent and shows up in type signatures; (2) **static checking** — `mypy`/IDEs flag a missing or mistyped method before runtime; (3) **discoverability** — `UserRepo.__subclasses__()` / "find implementations" reveals every conformer. For tiny, local, single-callsite seams, a bare callable is fine. For a contract used across modules, name it.

### "Why interfaces instead of inheritance to share behavior?"

DIP is about *substitutability of dependencies*, not *reuse of code*. Inheritance ("is-a") couples you to a base class's implementation and creates fragile hierarchies. DIP wants the loosest possible coupling: "I depend on *anything* shaped like this." Composition over inheritance is the same advice from a different angle — inject a collaborator (has-a) rather than inherit a base (is-a).

### "Isn't a DI framework (Spring/Guice/dependency-injector) required to do this properly?"

No. A framework only *automates the wiring* in the composition root; it does not grant the decoupling. The decoupling comes entirely from your code depending on abstractions. Manual wiring in `main()` is DIP done right and is often *clearer* than annotation magic for small/medium systems. Reach for a container when the object graph is large enough that hand-wiring becomes error-prone (dozens of services, scopes, lifecycles).

### "Why not a global singleton or a service locator instead of injecting?"

Both *technically* let high-level code avoid `new`-ing a concrete, but they reintroduce coupling to global state. The dependency vanishes from the type signature (you can't see what a class needs by reading its constructor), tests become order-dependent (shared mutable global), and parallel tests collide. DIP's intent is *explicit, visible, per-instance* dependencies. Injection delivers that; a locator quietly undoes it (see Common Mistake #6).

### "If everything depends on interfaces, doesn't navigation/'go to definition' get harder?"

Yes — that's the real, honest cost. One extra hop from `repo.save(...)` to "which implementation?" This is precisely why you *don't* invert pure/stable/single-impl dependencies. Pay the navigation tax only at boundaries where substitutability and testability are worth it.

### "Where exactly should the interface live — with the consumer or the implementer?"

With the **consumer** (the high-level module that needs it). That placement is what makes the source-code dependency point from the detail to the policy, which *is* the inversion. Putting the interface in the implementer's package (so the consumer must import the implementer to see the contract) silently re-couples policy to mechanism — a subtle but common mistake, especially in Java/Python where implementers name their interfaces.

### "Does DIP slow my program down at runtime?"

Negligibly. It's one virtual/dynamic dispatch (an interface method call) instead of a direct call — single-digit nanoseconds, routinely inlined by the JIT/compiler, and dwarfed by the I/O at the boundary you're abstracting (a DB round-trip is ~milliseconds, a million times larger). DIP is a *source-code* structuring tool; the runtime cost is in the noise.

---

## What's next

You've completed SOLID. To put it all together:

```
→ Foundations/DesignPatterns/strategy.md     ← uses OCP + DIP
→ LLD/Python/parking-lot.md                  ← real example using all 5
```

The principles will feel abstract until you apply them to a system. Build a small project applying SRP and DIP, and you'll feel the difference within a week of changes.

### What to read next (deeper dives)

- **`Foundations/DesignPatterns/strategy.md`** — the pattern that *is* DIP + OCP made concrete; injecting a behavior is exactly this principle.
- **`Foundations/DesignPatterns/factory.md`** (if present) — factories are how the composition root *builds* the concretes it injects.
- **`04-interface-segregation.md`** — re-read it now; DIP works best when the abstractions you invert are small (ISP), so the two principles are best learned as a pair.
- **Testing/test-doubles** — fakes, stubs, spies, and mocks are the consumers of every interface you invert; DIP exists largely to make these possible. Knowing *which* double to use sharpens *how* you shape the abstraction.
- **Robert C. Martin, *Clean Architecture*** — the chapters on DIP and "the dependency rule" generalize this principle to whole-system architecture (the famous concentric-circles diagram is DIP at scale).

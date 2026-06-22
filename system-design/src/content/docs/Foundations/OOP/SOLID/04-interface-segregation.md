# ISP — Interface Segregation Principle

> **The I in SOLID.**
> **Prerequisites:** `03-liskov-substitution.md`.
> **Time to read:** 12 minutes.

> *"Clients should not be forced to depend on methods they do not use."* — Robert C. Martin

---

## What it means

### Plain English (start here)

Imagine you order a coffee. The barista hands you a 40-button universal remote and says "use this to order." You only wanted to press *one* button — "large latte" — but now you're holding a device covered in buttons for a TV, a garage door, and a drone. You don't use 39 of them, but they're in your hand, you have to look past them, and if one of them changes you have to wonder whether it affects you.

That's a **fat interface**. It forces everyone who touches it to carry around capabilities they never asked for.

ISP says: **give each client a small, purpose-built remote with only the buttons it needs.** The coffee app gets a "drinks" remote. The TV app gets a "TV" remote. Nobody holds buttons they don't press.

A "client" here is *the code that calls the methods* — a function, another class, a test. The principle is about protecting *callers*, not implementers. You shrink the contract so a caller can say "I only depend on the ability to print" instead of "I depend on this whole multi-function machine."

### Technical version

If an interface (or abstract class) has many methods, classes that implement it must provide **all** of them — even ones they don't need. That's a smell.

Better: **many small, focused interfaces** than one fat one. Each interface should express a single *role* — a cohesive set of operations a particular kind of client needs. A type is then free to implement several role-interfaces, and each client depends only on the role(s) it actually uses.

The mechanism that makes this matter is **compile-time/import-time coupling**: when your function's signature says `def f(x: MultiFunctionDevice)`, your function now *depends on* every method `MultiFunctionDevice` declares. Change `fax`'s signature and `f` may need recompiling/retesting even though `f` never faxes. Narrow the parameter to `Printer` and that coupling disappears.

---

## A violation

```python
from abc import ABC, abstractmethod

class MultiFunctionDevice(ABC):
    @abstractmethod
    def print(self, doc): ...
    @abstractmethod
    def scan(self, doc): ...
    @abstractmethod
    def fax(self, doc): ...
```

Now I want to model an old-school **printer** that can only print:

```python
class OldPrinter(MultiFunctionDevice):
    def print(self, doc): ...
    def scan(self, doc):
        raise NotImplementedError    # ugly
    def fax(self, doc):
        raise NotImplementedError    # ugly
```

OldPrinter is forced to "implement" methods it can't actually do. Calling code that expects a real `MultiFunctionDevice` will break.

This also violates LSP — OldPrinter promises behaviors it can't deliver.

---

## ISP fix — separate interfaces

```python
from abc import ABC, abstractmethod

class Printer(ABC):
    @abstractmethod
    def print(self, doc): ...

class Scanner(ABC):
    @abstractmethod
    def scan(self, doc): ...

class Faxer(ABC):
    @abstractmethod
    def fax(self, doc): ...
```

Now classes implement only what they actually do:

```python
class OldPrinter(Printer):
    def print(self, doc): ...

class ModernMultiFunction(Printer, Scanner, Faxer):
    def print(self, doc): ...
    def scan(self, doc): ...
    def fax(self, doc): ...
```

A function that needs only printing takes `Printer`:

```python
def print_invoice(p: Printer, doc): ...
```

Both `OldPrinter` and `ModernMultiFunction` work. Neither is forced to lie.

---

## Runnable examples

Each example is self-contained — paste it into a file and run it. Expected output is shown.

### Example 1 — The full Python printer fix, end to end

```python
from abc import ABC, abstractmethod

class Printer(ABC):
    @abstractmethod
    def print(self, doc: str) -> None: ...

class Scanner(ABC):
    @abstractmethod
    def scan(self, doc: str) -> None: ...

class Faxer(ABC):
    @abstractmethod
    def fax(self, doc: str) -> None: ...

class OldPrinter(Printer):
    def print(self, doc: str) -> None:
        print(f"printing: {doc}")

class ModernMultiFunction(Printer, Scanner, Faxer):
    def print(self, doc: str) -> None:
        print(f"printing: {doc}")
    def scan(self, doc: str) -> None:
        print(f"scanning: {doc}")
    def fax(self, doc: str) -> None:
        print(f"faxing: {doc}")

# This function depends ONLY on the Printer role.
def print_invoice(p: Printer, doc: str) -> None:
    p.print(doc)

print_invoice(OldPrinter(), "INV-001")
print_invoice(ModernMultiFunction(), "INV-002")
```

**Expected output:**

```
printing: INV-001
printing: INV-002
```

**Takeaway:** `print_invoice` works with *both* devices because it asks for the smallest role it needs, not the fattest type available.

---

### Example 2 — Proof that the fat interface actually crashes

This shows *why* the violation is dangerous, not just inelegant. The fat version compiles fine and only blows up at runtime, deep inside a caller that never meant to scan.

```python
from abc import ABC, abstractmethod

class MultiFunctionDevice(ABC):
    @abstractmethod
    def print(self, doc): ...
    @abstractmethod
    def scan(self, doc): ...
    @abstractmethod
    def fax(self, doc): ...

class OldPrinter(MultiFunctionDevice):
    def print(self, doc): print(f"printing: {doc}")
    def scan(self, doc): raise NotImplementedError
    def fax(self, doc): raise NotImplementedError

def archive_document(dev: MultiFunctionDevice, doc):
    dev.print(doc)
    dev.scan(doc)   # caller assumes the fat contract is real

try:
    archive_document(OldPrinter(), "contract.pdf")
except NotImplementedError:
    print("BOOM: OldPrinter cannot scan, but the type said it could")
```

**Expected output:**

```
printing: contract.pdf
BOOM: OldPrinter cannot scan, but the type said it could
```

**Takeaway:** A fat interface pushes failures from compile time to runtime. The type system *said* `OldPrinter` could scan; ISP would have made that lie impossible to write.

---

### Example 3 — Structural duck typing with `typing.Protocol` (the Pythonic ISP)

In Python you often don't even need `ABC` inheritance. A `Protocol` (PEP 544) lets a client declare "I need *something* with a `print` method" — and any class with that method satisfies it, no base class required. This is ISP plus Go-style structural typing.

```python
from typing import Protocol

class SupportsPrint(Protocol):
    def print(self, doc: str) -> None: ...

class Receipt:                       # does NOT inherit anything
    def print(self, doc: str) -> None:
        print(f"receipt: {doc}")

class Label:
    def print(self, doc: str) -> None:
        print(f"label: {doc}")

def render(p: SupportsPrint, doc: str) -> None:
    p.print(doc)

render(Receipt(), "milk $3")
render(Label(), "FRAGILE")
```

**Expected output:**

```
receipt: milk $3
label: FRAGILE
```

**Takeaway:** With `Protocol`, the *interface lives at the call site*, sized exactly to what the caller uses — the strongest form of ISP. Run a static checker (`mypy`) to enforce it; at runtime it's pure duck typing.

---

### Example 4 — Go: the smallest interface that does the job

```go
package main

import (
	"fmt"
	"strings"
)

// Tiny role-interface — one method.
type Stringer interface {
	String() string
}

type User struct{ Name string }

func (u User) String() string { return "User(" + u.Name + ")" }

// describe depends on the Stringer role only — not on User.
func describe(s Stringer) string {
	return strings.ToUpper(s.String())
}

func main() {
	fmt.Println(describe(User{Name: "ada"}))
}
```

**Expected output:**

```
USER(ADA)
```

**Takeaway:** `describe` has zero knowledge of `User`. Any type with a `String() string` method drops in. Small interface, maximum reach.

---

### Example 5 — Go: accept the narrow role, not the concrete type

A common Go review note: *"take a `Reader`, not a `*bytes.Buffer`."* Here is why it pays off — the same function serves a file, a network socket, an in-memory buffer, or a test fake, because it only asks for `io.Reader`.

```go
package main

import (
	"fmt"
	"io"
	"strings"
)

// countBytes depends ONLY on the Read role.
func countBytes(r io.Reader) (int, error) {
	buf := make([]byte, 4)
	total := 0
	for {
		n, err := r.Read(buf)
		total += n
		if err == io.EOF {
			return total, nil
		}
		if err != nil {
			return total, err
		}
	}
}

func main() {
	n, _ := countBytes(strings.NewReader("hello"))
	fmt.Println(n)
}
```

**Expected output:**

```
5
```

**Takeaway:** Asking for `io.Reader` (one method) instead of `*strings.Reader` (a concrete type) makes `countBytes` reusable everywhere and trivial to test with a fake reader.

---

## Go's natural fit

Go's standard library lives by ISP. The classic example:

```go
type Reader interface { Read(p []byte) (int, error) }
type Writer interface { Write(p []byte) (int, error) }
type Closer interface { Close() error }

// Composed when you need more
type ReadWriter interface {
    Reader
    Writer
}

type ReadWriteCloser interface {
    Reader
    Writer
    Closer
}
```

Each method type lives separately. Code asks for the smallest interface it needs:

```go
func dump(r Reader) { ... }    // just needs Read
func copy(dst Writer, src Reader) { ... }    // both
```

Most types implement multiple small interfaces naturally. No "fat" interfaces, no forced empty methods.

> **Idiom — "The bigger the interface, the weaker the abstraction."** (Rob Pike, *Go Proverbs*). A one-method interface like `io.Reader` can be satisfied by almost anything and composed freely; a ten-method interface can be satisfied by almost nothing and couples every caller to all ten. Go's interfaces are also satisfied **structurally** — a type implements `Reader` simply by *having* a matching `Read` method, with no `implements` keyword — which is what makes splitting interfaces costless.

---

## Why ISP matters

- **Less coupling.** A class implementing `Printer` doesn't depend on the existence of `scan` or `fax`.
- **Easier mocks/fakes in tests.** Implement only what you need.
- **Cleaner refactoring.** Remove a method from a small interface; only relevant types are affected.

Two more, with the *why* spelled out:

- **Smaller recompile/retest blast radius.** In statically compiled or statically typed code, every method a contract declares is something its callers depend on. If `print_invoice` takes the fat `MultiFunctionDevice`, a change to `fax`'s signature forces `print_invoice` (and its tests) to be re-examined — even though it never faxes. Narrow the parameter to `Printer` and that change is invisible to it.
- **Honest types.** A type can only be substituted for what it actually implements. `OldPrinter: Printer` *cannot* be passed where a `Scanner` is required, so the "I promise to scan but throw `NotImplementedError`" lie becomes unwritable. ISP removes the *opportunity* to violate LSP.

---

## Common mistakes / gotchas

### Gotcha 1 — "Header interface": one big interface mirroring a class's whole API

The most common ISP failure isn't forgetting interfaces — it's creating *one* interface that lists every public method of a class. This is sometimes called a "header interface" (it reads like a C++ header). It gives you mock-ability but none of ISP's decoupling, because every caller still depends on the whole surface.

```python
# WRONG — one interface == the whole class, just with "I" in front
class IUserService(Protocol):
    def create(self, u): ...
    def delete(self, id): ...
    def reset_password(self, id): ...
    def export_to_csv(self): ...
    def send_welcome_email(self, id): ...
    def recalculate_billing(self, id): ...

def signup_flow(svc: IUserService): ...   # depends on billing + csv it never touches
```

```python
# RIGHT — split by role; each client takes only what it uses
class UserCreator(Protocol):
    def create(self, u): ...

class WelcomeMailer(Protocol):
    def send_welcome_email(self, id): ...

def signup_flow(creator: UserCreator, mailer: WelcomeMailer): ...
```

**Takeaway:** Don't mirror the implementation. Group methods by *who calls them together*, not by *what class happens to own them*.

### Gotcha 2 — Splitting into single methods that always travel together

Over-correcting produces interfaces so small they fragment a cohesive concept. If two methods are *never* useful apart, splitting them adds noise and forces every client to depend on two things instead of one.

```go
// WRONG — these never get used separately; the split is pure ceremony.
type HasNext interface{ HasNext() bool }
type Nexter  interface{ Next() any }

func iterate(h HasNext, n Nexter) { ... } // two params for one concept
```

```go
// RIGHT — one role, because a client that has one always wants the other.
type Iterator interface {
	HasNext() bool
	Next() any
}

func iterate(it Iterator) { ... }
```

**Takeaway:** The unit of an interface is a **role/use-case**, not a single method. Cohesion is the test: split when clients use the parts independently, keep together when they don't.

### Gotcha 3 — Defining interfaces beside the *provider* in Go

Newcomers from Java/C# tend to write the interface in the package that *implements* it and have callers import that package. That re-couples everyone to the provider and tends to grow the interface to cover every consumer at once.

```go
// WRONG — provider package owns a fat interface; every consumer imports it.
package storage
type Store interface {
	Get(id string) ([]byte, error)
	Put(id string, b []byte) error
	List() ([]string, error)
	Delete(id string) error
	Backup(w io.Writer) error
}
```

```go
// RIGHT — the consumer declares the tiny interface it needs, in its own package.
package report
type getter interface {
	Get(id string) ([]byte, error)   // report only reads
}
func Render(g getter, id string) ([]byte, error) { return g.Get(id) }
```

`storage.Store` (the concrete type, returned by `storage.New()`) satisfies `report.getter` automatically because it has a matching `Get`. **Takeaway:** in Go, *interfaces belong to the consumer*. That keeps each interface naturally minimal.

### Gotcha 4 — Faking ISP with `NotImplementedError` / `panic`

Throwing inside an unused method *looks* like it satisfies the type, but it just relocates the fat-interface problem to runtime (see Example 2). The fix is not a better exception message — it's removing the method from the contract this type claims to fulfill.

---

## Idioms and best practices

- **Name interfaces by capability, not by class.** `Printer`, `Reader`, `Validator`, `Closer` — not `IDeviceManager`. In Go, the `-er` suffix is idiomatic for single-method roles.
- **Define the interface at the consumer.** Especially in Go; in Python with `Protocol`, declare the `Protocol` in the module that *calls* it. This guarantees the interface stays sized to real needs and never grows to serve someone else's use case.
- **Accept interfaces, return concrete types.** A Go proverb that pairs with ISP: functions take the *narrowest* interface they can, but return the *full* concrete value so callers keep their options open.
- **Let composition build the big ones.** Compose small interfaces (`ReadWriteCloser = Reader + Writer + Closer`) instead of declaring a big one and decomposing later. Add capability by embedding, not by extending a god-interface.
- **In Python, prefer `Protocol` over `ABC` for client-facing contracts** when you don't need shared implementation — it gives you structural typing and keeps the interface at the call site.

### When NOT to apply ISP

- **Small, stable, single-implementation contracts.** If an interface has one implementer that genuinely uses all its methods and the API isn't shared across module boundaries, splitting it is premature abstraction. Don't manufacture three interfaces for a 30-line internal class.
- **When the methods are truly cohesive** (Gotcha 2). A role with five tightly-bound operations is *one* interface, and chopping it hurts.
- **Trivial scripts / throwaway code.** ISP's payoff is *change over time and across teams*. Code that won't change or be re-used doesn't need the ceremony.
- **When it would force a leaky split.** If two methods can only be implemented together (they share private state), separate interfaces can mislead callers into thinking they can mix-and-match implementations. Keep them together and document the coupling.

---

## Don't go too small

ISP doesn't mean "every interface = one method always." Some operations naturally cluster (e.g., `Iterator.HasNext` and `Iterator.Next` go together).

The rule of thumb: an interface should describe a single **role** that a client needs.

---

## Cross-questions

### "What if a class genuinely needs all the methods?"

Then it implements all the small interfaces. That's fine. ISP is about the **interface side**, not forcing classes to be small.

### "How is ISP different from SRP?"

SRP: a class has one responsibility.
ISP: an interface (the contract you depend on) has one role.

A class might have one responsibility but expose two interfaces, depending on how clients use it.

### "Doesn't ISP create lots of interfaces? Cluttered."

A bit, yes. The discipline is to make each interface meaningful — name them well, locate them near their consumers. Go's idiom helps: define interfaces in the package that **uses** them, not the package that **provides** them.

### "What about LSP and ISP together?"

ISP often **prevents** LSP violations. If `OldPrinter` only implements `Printer`, it can't lie about scanning — because there's no `scan` method to fake. Smaller interfaces → fewer ways to break the contract.

### "Why split the interface and not just split the class?"

Because the two solve different problems. Splitting the *class* changes who *owns* the behavior (that's SRP). Splitting the *interface* changes who *depends* on the behavior (that's ISP). You can have one well-factored class that still over-exposes itself through a fat interface: every caller is coupled to methods it never calls. ISP fixes the dependency edge without touching the implementation.

### "Why does ISP matter in dynamic languages like Python — there's no compiler to break?"

Three reasons even without a compiler. (1) *Readers* of `def f(svc: BigService)` must reason about the whole surface to understand `f`. (2) *Tests* must fake every method the type declares, even unused ones — a narrow `Protocol` lets a one-method stub suffice. (3) *Static checkers* (`mypy`, `pyright`) and IDEs do enforce the contract, so a fat type-hint still propagates change. ISP keeps the *cognitive* and *testing* coupling low, which is real cost even when runtime is forgiving.

### "Why interfaces at all — why not just pass the concrete object and rely on duck typing?"

Duck typing gives you the *flexibility* of ISP but not the *documentation* or the *checking*. An explicit `SupportsPrint`/`io.Reader` states the requirement in the signature, lets tooling verify it, and tells the next engineer exactly what the function depends on. ISP is the discipline of making that stated requirement as small as possible.

### "Isn't this the same as the Dependency Inversion Principle (next chapter)?"

They're complementary. DIP says *depend on abstractions, not concretions* (which direction the dependency points). ISP says *make those abstractions small and role-specific* (how big each one is). You typically apply both at once: a high-level module depends on an abstraction (DIP) that is narrow enough to express only what it needs (ISP).

---

## What's next

```
→ Foundations/OOP/SOLID/05-dependency-inversion.md
```

Read it next: DIP tells you which *direction* dependencies should point; ISP told you how *small* each one should be. Together they define how loosely-coupled, testable boundaries are drawn. For the structural-typing mechanics behind Example 3 and Go's interfaces, see PEP 544 (`typing.Protocol`) and the *Go Proverbs* on interface size.

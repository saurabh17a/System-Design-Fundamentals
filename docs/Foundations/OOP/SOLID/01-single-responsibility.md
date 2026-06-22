# SRP — Single Responsibility Principle

> **The S in SOLID.**
> **Prerequisites:** `Foundations/OOP/four-pillars.md`.
> **Time to read:** 15 minutes.

> *"A class should have one, and only one, reason to change."* — Robert C. Martin

---

## Plain-English version (start here)

Imagine a Swiss Army knife that is *also* your house key, your car key, and your credit card. Handy until you lose it — now you can't get into your house, your car, or buy lunch, all at once. And every time the bank reissues your card, the locksmith has to re-cut the whole tool. That is a class with too many jobs.

**The Single Responsibility Principle says: give each thing one job.** A spoon stirs. A knife cuts. If you want to change how cutting works, you sharpen the knife — you don't risk bending the spoon.

In code terms: a class (or function, or module) should be responsible for *one* coherent piece of behaviour. When you need to change that behaviour, you should be able to open exactly one file, change it, and be confident you didn't break anything unrelated.

### The precise / technical version

Uncle Bob later sharpened his famous one-liner into something more exact:

> *"A module should be responsible to one, and only one, **actor**."*

An **actor** is a person or group of people — a *source of change requests*. Examples of actors:

- The **DBA / persistence team** wants to change how data is stored.
- The **marketing team** wants to change the wording of a welcome email.
- The **finance team** wants to change how an invoice is formatted for an audit.

If the same class answers to *all three* actors, then a change requested by marketing forces a recompile/redeploy/retest of code that the DBA and finance teams depend on. Worse, two actors editing the same class can silently break each other's work — this is the real danger SRP guards against, not "files getting big."

So the formal restatement is:

> **Gather together the things that change for the same reason (the same actor). Separate the things that change for different reasons (different actors).**

This is just **cohesion** (keep related things together) and **decoupling** (keep unrelated things apart), applied at the granularity of a single source of change.

---

## What it means

A "responsibility" = a reason to change = an actor who can ask for a change.

If a class has multiple responsibilities, multiple things can cause it to change. Different stakeholders pulling at the same code mean every change risks breaking something unrelated.

### A class with too many responsibilities

```python
# BAD
class User:
    def __init__(self, name, email):
        self.name = name
        self.email = email

    def save_to_db(self):
        # SQL, connection management, retries
        ...

    def send_welcome_email(self):
        # SMTP, templates, retries
        ...

    def to_pdf(self):
        # PDF generation
        ...
```

Reasons this class might change:
1. The database schema changes.
2. The email provider changes.
3. The PDF library changes.
4. Email templates change.
5. The user model itself changes.

Five reasons. Five different teams might want different things. SRP says: **split**.

### Refactored

```python
class User:
    def __init__(self, name, email):
        self.name = name
        self.email = email


class UserRepository:
    def save(self, user: User): ...


class WelcomeEmailer:
    def send(self, user: User): ...


class UserPDFExporter:
    def export(self, user: User): ...
```

Each class now has **one** reason to change. Schema change → only `UserRepository` updated. New email template → only `WelcomeEmailer`.

---

## The classic trap: the accidental coupling (Uncle Bob's `Employee`)

The most instructive SRP example isn't the obvious "this class does DB + email + PDF" god class — it's a subtler one where two *separate* actors share a helper and break each other.

```python
# BAD — looks innocent, hides a landmine
class Employee:
    def __init__(self, hours, rate):
        self.hours = hours
        self.rate = rate

    # Owned by FINANCE (the CFO's team): payroll math
    def calculate_pay(self):
        return self._regular_hours() * self.rate

    # Owned by HR: hours-worked reports
    def report_hours(self):
        return f"Worked {self._regular_hours()} regular hours"

    # Shared helper — who owns THIS?
    def _regular_hours(self):
        return min(self.hours, 40)   # cap at 40
```

Here's the disaster scenario. Finance asks a developer to change overtime rules so that pay is computed on a 38-hour week. The developer edits `_regular_hours()` to `min(self.hours, 38)`. Tests pass. Ship it.

But `report_hours()` — owned by **HR**, a completely different actor — *also* called `_regular_hours()`. HR's reports silently start showing wrong numbers, and nobody notices until an audit. Two actors, one shared method, one accidental cross-contamination. **This is exactly the bug SRP exists to prevent.**

### The fix: separate the actors

```python
# GOOD — each actor owns its own calculation
class Employee:
    """Just the data."""
    def __init__(self, hours, rate):
        self.hours = hours
        self.rate = rate


class PayCalculator:          # owned by FINANCE
    def calculate(self, e: Employee) -> float:
        return min(e.hours, 38) * e.rate


class HoursReporter:          # owned by HR
    def report(self, e: Employee) -> str:
        return f"Worked {min(e.hours, 40)} regular hours"
```

```python
emp = Employee(hours=45, rate=20.0)
print(PayCalculator().calculate(emp))   # finance's rule (38h cap)
print(HoursReporter().report(emp))      # HR's rule (40h cap)
```

Expected output:

```
760.0
Worked 40 regular hours
```

**Takeaway:** SRP isn't about line count — it's about making sure a change requested by *one* actor can never silently corrupt behaviour another actor depends on.

---

## More small runnable examples

### Example 1 — A report generator that mixes computation and formatting

```python
# BAD: one method computes the data AND decides how it looks on screen
class SalesReport:
    def __init__(self, sales):
        self.sales = sales

    def render(self) -> str:
        total = sum(self.sales)
        return f"=== SALES ===\nTotal: ${total}\n============="
```

The problem: the *formula* (how to total sales) and the *presentation* (the ASCII box) change for different reasons. Finance owns the formula; the design team owns how it's displayed (HTML? CSV? JSON?). Split them:

```python
# GOOD
class SalesCalculator:
    def total(self, sales) -> float:
        return sum(sales)


class PlainTextFormatter:
    def format(self, total: float) -> str:
        return f"=== SALES ===\nTotal: ${total}\n============="
```

```python
sales = [100, 250, 75]
total = SalesCalculator().total(sales)
print(PlainTextFormatter().format(total))
```

Expected output:

```
=== SALES ===
Total: $425
=============
```

**Takeaway:** "what the numbers are" and "how the numbers look" are two responsibilities — keep them apart.

### Example 2 — Go: a logger that also decides where logs go

```go
package main

import (
	"fmt"
	"strings"
)

// BAD: formatting the message AND choosing the destination in one method.
type Logger struct{}

func (l *Logger) Log(level, msg string) {
	line := fmt.Sprintf("[%s] %s", strings.ToUpper(level), msg)
	fmt.Println(line) // hard-wired to stdout — what if we want a file?
}
```

Two responsibilities: *formatting* a log line and *delivering* it. Separate them so each can change independently.

```go
package main

import (
	"fmt"
	"io"
	"os"
	"strings"
)

// GOOD: Formatter owns the shape of a line; Sink owns where it goes.
type Formatter struct{}

func (f Formatter) Format(level, msg string) string {
	return fmt.Sprintf("[%s] %s", strings.ToUpper(level), msg)
}

type Sink struct{ out io.Writer }

func (s Sink) Write(line string) {
	fmt.Fprintln(s.out, line)
}

func main() {
	f := Formatter{}
	s := Sink{out: os.Stdout}
	s.Write(f.Format("info", "service started"))
}
```

Expected output:

```
[INFO] service started
```

**Takeaway:** swapping `os.Stdout` for a file or a network socket now touches only `Sink`; changing the line format touches only `Formatter`.

### Example 3 — Function-level SRP with verifiable output

```python
# GOOD: each function does exactly one thing, so each is trivially testable.
def parse_amounts(raw: str) -> list[float]:
    return [float(x) for x in raw.split(",")]

def apply_tax(amounts: list[float], rate: float) -> list[float]:
    return [round(a * (1 + rate), 2) for a in amounts]

def to_receipt(amounts: list[float]) -> str:
    return "\n".join(f"${a:.2f}" for a in amounts)


taxed = apply_tax(parse_amounts("10,20,30"), 0.10)
print(to_receipt(taxed))
```

Expected output:

```
$11.00
$22.00
$33.00
```

**Takeaway:** when each function has one job, you can unit-test `apply_tax` without parsing strings or building receipts — fewer moving parts per test.

---

## Smell: "and"

If you describe a class with "and" — "this class manages users AND sends emails AND..." — that's an SRP violation.

A good test: try to write the class's purpose in one sentence without "and."

> **Trick that works in practice:** force yourself to name the class. If the only honest name is `UserManager`, `OrderHelper`, `DataProcessor`, or `Utils`, you probably have a bag of unrelated responsibilities. Vague nouns (`Manager`, `Helper`, `Processor`, `Util`, `Service` with no qualifier) are a strong SRP smell because they describe *no single thing*.

---

## Go example

```go
// BAD: one struct does it all
type Order struct {
    ID    string
    Items []Item
    Total float64
}

func (o *Order) SaveToDB() error { ... }
func (o *Order) SendConfirmationEmail() error { ... }
func (o *Order) RenderInvoicePDF() ([]byte, error) { ... }
```

```go
// GOOD: split responsibilities
type Order struct {
    ID    string
    Items []Item
    Total float64
}

type OrderRepo struct{ db *sql.DB }
func (r *OrderRepo) Save(o *Order) error { ... }

type OrderEmailer struct{ smtp *SMTP }
func (e *OrderEmailer) SendConfirmation(o *Order) error { ... }

type InvoicePDF struct{}
func (p *InvoicePDF) Render(o *Order) ([]byte, error) { ... }
```

The `Order` is now just a piece of data. Operations on it live in their own types.

> **Go-specific note:** Go has no classes, but SRP maps cleanly onto **packages, structs, and interfaces**. Idiomatic Go pushes SRP at the *package* level: a package should have one coherent purpose (`net/http`, `encoding/json`). Small, single-method interfaces (`io.Reader`, `io.Writer`, `fmt.Stringer`) are SRP in its purest form — each describes exactly one capability, and types compose them. This is why the standard library favours `io.Reader` over a giant `File` interface with twenty methods.

---

## SRP at function level

SRP isn't only for classes. A function should also do **one thing**.

```python
# BAD
def process_user(form_data):
    # validate
    if "@" not in form_data["email"]:
        raise ValueError(...)
    # save
    db.execute("INSERT INTO users ...")
    # email
    send_email(...)
    # log
    log.info(...)
```

```python
# GOOD
def process_user(form_data):
    user = parse_user(form_data)
    validate_user(user)
    save_user(user)
    notify_user(user)
```

Each step is one reason to change. The orchestrator just sequences them.

> **Why this matters for testing:** the BAD version cannot be tested without a live database and a real SMTP server. The GOOD version lets you unit-test `validate_user` in isolation, and test `process_user` with the four steps stubbed. SRP and testability are two sides of the same coin — a function that's hard to test almost always does too much.

---

## When SRP goes too far

You can over-decompose. A `OneFieldAdder` class that just adds one field is silly. Heuristic: a class should be small but **cohesive** — its members should naturally belong together. SRP fights bloat; it doesn't demand 1-method classes.

If splitting forces you to pass the same 5 arguments around everywhere, the split is wrong — those things belong together.

### When NOT to apply SRP (or apply it lightly)

- **Throwaway scripts and spikes.** A 40-line script you'll delete tomorrow doesn't need a `Repository`/`Emailer`/`Formatter` trio. The cost of indirection outweighs the benefit when there's no second actor and no maintenance horizon.
- **Genuinely cohesive value objects.** A `Money` type with `add`, `subtract`, `multiply`, and `format` has *one* responsibility (representing and operating on an amount) even though it has several methods. Don't shatter it into `MoneyAdder`, `MoneyFormatter`, etc.
- **When the "responsibilities" never change independently.** If two concerns have *always* changed together for the same actor across the project's whole history, the data says they're one responsibility. SRP is about *anticipated independent change*, not theoretical purity.
- **Premature abstraction (YAGNI tension).** Splitting in anticipation of an actor who may never materialize adds indirection cost now for a benefit that may never arrive. Prefer to split *when the second reason to change actually shows up* (the "rule of three": refactor on the third occurrence). Over-eager SRP produces a maze of one-method classes that is *harder* to navigate than a single cohesive one.

The honest framing: SRP is a force you balance against **simplicity** and **YAGNI**. More classes = more decoupling but also more indirection. Split when a *real* second actor appears or a *real* pain (merge conflicts, accidental breakage, untestability) shows up.

---

## Common mistakes

**1. Confusing "one responsibility" with "one method."**
A class can have many methods that all serve one responsibility (e.g., a `Calculator` with `add`, `subtract`, etc.).

**2. Skipping SRP because "it's a small project."**
Small projects grow. By the time you notice, the god class has 1500 lines.

**3. Splitting by file, not by responsibility.**
Putting `User` and `UserRepository` in separate files but having the User class still do DB stuff doesn't help.

**4. Splitting by *layer* instead of by *actor*.**

```python
# WRONG SPLIT: organized by technical layer, but each class still
# answers to multiple actors.
class ValidationLayer:
    def validate_user(...): ...
    def validate_order(...): ...   # user-team change AND order-team change land here
    def validate_invoice(...): ...
```

The fix is to split by *who asks for the change*, not by *what kind of operation* it is:

```python
# RIGHT SPLIT: cohesive around a single subject/actor.
class UserValidator: ...      # changes when the user team's rules change
class OrderValidator: ...     # changes when the order team's rules change
class InvoiceValidator: ...   # changes when finance's rules change
```

**5. The "data + behaviour smeared together" anti-pattern.** Putting `calculate_pay()` and `report_hours()` on the same `Employee` because "they both use employee data" — see the `Employee` trap above. Shared *data* is fine; shared *behaviour owned by different actors* is the trap.

**6. Treating "Service" / "Manager" as a free pass.** A class named `OrderService` often quietly accumulates validation, persistence, notification, and reporting. The name hides the violation. Name the actual responsibility.

---

## Cross-questions

### "Doesn't splitting create more coupling?"

It creates **looser** coupling between concerns and **tighter** coupling within a concern. The total system is more flexible, not less. You trade *one* tightly-tangled blob for *several* loosely-connected pieces, each independently changeable and testable. The connections that remain are explicit (one class calls another) rather than implicit (one method secretly shared between two actors).

### "SRP vs. cohesion vs. coupling — aren't these the same idea?"

They're deeply related. **Cohesion** measures how strongly the members of a module belong together; **coupling** measures how much modules depend on each other. SRP is the *operational rule* that produces high cohesion (everything in the class serves one actor) and low coupling (different actors live in different classes). Think of SRP as cohesion/coupling expressed as an actionable design instruction.

### "Why 'reason to change' and not 'does one thing'?"

Because "does one thing" is hopelessly subjective — at one zoom level a web server "does one thing" (serve requests); at another it does parsing, routing, auth, and templating. "One *reason to change* / one *actor*" is sharper: it points at the *humans* and *events* that trigger edits, which is what actually causes regressions. Two pieces of code that always change together belong together regardless of whether they "feel" like one thing.

### "Where should validation logic go?"

Two reasonable answers:
- **In the model itself** if it's invariant (e.g., balance can't be negative — must be true at all times).
- **In a separate validator** if it's context-specific (e.g., "credit card valid for THIS payment processor").

### "How do I know when to split?"

When you change one thing and find yourself touching many unrelated things. Or when two reviewers fight over the same file. Or when the file > 500 lines and grows monthly. Or — the most reliable signal — when **two different teams keep editing the same file for unrelated reasons** (visible in `git blame` / merge-conflict frequency).

### "Isn't this just OOP? How does SRP apply to functional / procedural code?"

SRP is not OOP-specific. It applies to functions, modules, microservices, and even database schemas. In FP you express it as small composable functions (see the `parse → apply_tax → to_receipt` example). In a microservice architecture, "one service per business capability" is SRP at the deployment level. The *granularity* changes; the principle doesn't.

### "Doesn't SRP conflict with DRY?"

Sometimes — and SRP usually wins. The `Employee._regular_hours()` trap *looks* like good DRY (don't repeat the 40-hour cap), but it couples two actors. When deduplicating would merge code owned by different actors, **prefer a little duplication over the wrong coupling.** The two copies can — and should — evolve separately. (This is the "incidental duplication" caveat to DRY.)

### "How does SRP relate to the rest of SOLID?"

SRP is the foundation. Once each class has one reason to change, the **Open/Closed Principle** (extend without modifying) becomes achievable, because you have small focused units to extend. **Dependency Inversion** then lets the orchestrator depend on abstractions of those units rather than concretes. SRP keeps the pieces small enough that the other four principles have something clean to work with.

---

## Quick self-check

Before merging a class, ask:

1. Can I state its job in one sentence with no "and"?
2. Which *single* actor (team/role) requests changes to it?
3. If I `git blame` it in six months, will the edits cluster around one concern?
4. Can I unit-test it without standing up a database, network, or UI?

If any answer is shaky, you likely have more than one responsibility.

---

## What's next

```
→ Foundations/OOP/SOLID/02-open-closed.md
```

Further reading once you've internalized SRP:

- **Robert C. Martin, _Clean Architecture_ (2017), Ch. 7** — the canonical "actor" definition and the `Employee` example this doc expands on.
- **`Foundations/OOP/four-pillars.md`** — encapsulation and abstraction are the tools you use to *enforce* the boundaries SRP draws.
- **`Foundations/OOP/SOLID/05-dependency-inversion.md`** — how the small SRP-sized pieces get wired together without hard-coding dependencies.

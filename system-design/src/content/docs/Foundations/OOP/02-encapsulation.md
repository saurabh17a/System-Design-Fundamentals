# Encapsulation — Python vs Go

> **Type:** Concept
> **Tags:** `[oop]` `[encapsulation]` `[access-control]` `[python]` `[go]`

---

## The concept

**Encapsulation** is bundling state with the operations on that state, and **controlling access** so callers can't reach in and break your invariants. The exposed operations are the type's **public interface**; everything else is an **implementation detail**. Because all state changes funnel through code *you* control, you can guarantee invariants ("balance is never negative") in one place.

The Python-vs-Go difference is sharp and a favorite interview contrast: **Python enforces privacy by *convention* ("we're all adults"); Go enforces it by the *compiler* via capitalization.**

## In Python

Python has no true `private`. It uses naming conventions:

- `name` — public.
- `_name` — "internal, please don't touch" (a convention; nothing stops you).
- `__name` — **name-mangled** to `_ClassName__name`, making accidental access/override harder (still not truly private).

Control read/write with `@property` instead of exposing raw fields:

```python
class BankAccount:
    def __init__(self, owner, balance=0):
        self.owner = owner          # public
        self._balance = balance     # "private" by convention

    @property
    def balance(self):              # read-only computed access
        return self._balance

    def deposit(self, amount):
        if amount <= 0:
            raise ValueError("amount must be positive")
        self._balance += amount

    def withdraw(self, amount):
        if amount > self._balance:
            raise ValueError("insufficient funds")
        self._balance -= amount


acct = BankAccount("Alice", 100)
acct.deposit(50)
print(acct.balance)        # 150  (via the property getter)
# acct.balance = 999       # AttributeError — no setter, so it's read-only
acct._balance = -1         # allowed! Python only *discourages* this
```

Python specifics:

- **`@property`** turns a method into an attribute-style accessor, so you can add validation/computation without changing the call site (`acct.balance`, not `acct.balance()`). Add a matching `@balance.setter` to allow controlled writes.
- **Name mangling (`__x`)** is for avoiding *accidental* clashes in subclasses, not security.
- **Philosophy:** "we're all adults here" — the language trusts you to honor `_`. Encapsulation is a *design discipline*, not a lock.

## In Go

Go enforces visibility at the **package** level using **capitalization of the identifier**:

- **Capitalized** (`Owner`, `Deposit`) → **exported** = visible outside the package (public).
- **lowercase** (`balance`) → **unexported** = visible only within the same package (private).

```go
package bank

import "errors"

type Account struct {
    Owner   string   // exported (public)
    balance int      // unexported (private to package `bank`)
}

func NewAccount(owner string, balance int) *Account {
    return &Account{Owner: owner, balance: balance}
}

func (a *Account) Balance() int { return a.balance }   // controlled read

func (a *Account) Deposit(amount int) error {
    if amount <= 0 {
        return errors.New("amount must be positive")
    }
    a.balance += amount
    return nil
}
```

```go
// In another package:
acct := bank.NewAccount("Alice", 100)
acct.Deposit(50)
fmt.Println(acct.Balance())   // 150
// acct.balance = -1          // COMPILE ERROR: balance is unexported
```

Go specifics:

- **Visibility is per-package, not per-type.** Code *in the same package* can touch unexported fields of any type in that package — there's no `private`-to-the-struct. The package is the encapsulation boundary.
- **Compiler-enforced** — accessing an unexported field from outside the package fails to compile. Real enforcement, unlike Python.
- **No getters/setters by reflex.** Idiomatic Go exposes fields directly when there's no invariant to protect; add a `Balance()` method only when you need control. (Getters are *not* prefixed `Get`; it's `Balance()`, not `GetBalance()`.)

## Key differences

| | Python | Go |
|---|---|---|
| Enforcement | convention only (`_`, `__`) | compiler-enforced |
| Boundary | per-object (by discipline) | per-**package** (by capitalization) |
| Public/private marker | name prefix (`_`, `__`) | identifier case (`Upper`/`lower`) |
| Controlled access | `@property` / setter | accessor methods (`Balance()`) |
| Can callers bypass it? | yes (allowed, discouraged) | no (won't compile) |
| Getters/setters | properties, Pythonic | only when an invariant needs it |

Same goal — protect invariants behind a controlled interface — but Python relies on trust while Go relies on the compiler, and Go's unit of privacy is the *package*, not the object.

## Commonly asked interview questions

- **"Is anything truly private in Python?"** — No. `_x` is convention; `__x` is name-mangled (harder to hit by accident) but still reachable as `_Class__x`. Privacy is a discipline.
- **"How does Go do private/public?"** — Capitalization: exported (uppercase) is public across packages; lowercase is private to the package. Enforced by the compiler.
- **"`_x` vs `__x` in Python?"** — `_x`: "internal, don't touch" convention. `__x`: name-mangled to `_Class__x` to avoid subclass clashes; not security.
- **"When use `@property`?"** — to expose computed/validated access with attribute syntax, or to make a field read-only, without breaking callers who use `obj.x`.
- **"Why does encapsulation matter if I'm the only dev?"** — it localizes invariants and lets you change internals freely; "future you" and refactors benefit even solo.
- **"Encapsulation vs abstraction?"** — encapsulation hides *state* (access control); abstraction hides *decisions/how* (the interface). Related but distinct — see [abstraction](03-abstraction.md).
- **"Go: getters/setters everywhere?"** — no; expose fields directly unless an invariant requires a method. Don't prefix getters with `Get`.

## Gotchas

- **Treating Python `_`/`__` as security:** it's not; never rely on it to protect secrets or enforce hard guarantees.
- **Leaking internal mutable state:** returning a reference to an internal list/slice/map lets callers mutate your internals behind your back. Return a copy or an unmodifiable view (both languages).
- **Go same-package access:** another type in the *same package* can read your unexported fields — split packages if you need a harder boundary.
- **Property with side effects:** a Python `@property` that does expensive work or mutates is surprising (callers expect attribute-cheap access); keep getters cheap.
- **Over-encapsulating in Go:** wrapping every field in a `Get/Set` method is un-idiomatic and noisy; reserve methods for real invariants.

---

*Part of the [OOP overview](four-pillars.md). Prev: [Classes & Objects](01-classes-and-objects.md) · Next: [Abstraction](03-abstraction.md). Related: [SOLID — SRP](SOLID/01-single-responsibility.md).*

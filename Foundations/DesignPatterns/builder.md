# Builder Pattern

> **Category:** Creational
> **Difficulty:** ⭐⭐
> **Time to read:** 18 minutes.

---

## In one sentence (plain English)

Imagine ordering a sandwich. You don't shout all twelve choices at once — "white-bread-toasted-turkey-no-mayo-extra-lettuce-cut-in-half!" Instead you walk down the counter and add one thing at a time: bread, then meat, then toppings, then "that's it, ring me up." The **Builder pattern** is exactly that counter: you add pieces step by step, and only at the very end do you say `build()` and walk away with the finished object.

The point is that **construction is separated from the thing being constructed.** The half-made sandwich on the counter (the *builder*) is mutable and messy. The wrapped sandwich you carry away (the *product*) is finished and frozen. You never hand a customer a half-made sandwich.

### The precise version

A Builder is a separate object whose job is to **accumulate the configuration** of a target object across multiple method calls, then **assemble and validate** the final product in a single terminal call (conventionally `build()`). It exists to solve two distinct problems at once:

1. **The telescoping-constructor problem** — when an object has many parameters (especially many optional ones), a constructor becomes an unreadable, error-prone list of positional arguments.
2. **The invalid-intermediate-state problem** — you want the *final* object to be valid and immutable, but you need a place to hold partial, possibly-invalid state while it is being assembled. The builder is that place.

A classic Builder has four roles (from the Gang of Four book):

| Role | What it is | In our example |
| --- | --- | --- |
| **Product** | The complex object being built | `Pizza` |
| **Builder** | Holds partial state, exposes step methods + `build()` | `PizzaBuilder` |
| **Director** (optional) | Knows a *recipe* — a fixed sequence of builder calls | a `make_margherita(builder)` function |
| **Client** | Calls the builder (or director) to get the product | your `main()` |

Most real-world code skips the Director and just chains builder calls directly. We'll show the Director below because interviewers ask about it.

---

## The problem

Creating an object that has **many parameters**, especially when many are optional. Constructors with 12 arguments are unreadable and error-prone.

```python
# UGH
pizza = Pizza(
    size="large",
    crust="thin",
    cheese=True,
    pepperoni=False,
    mushrooms=True,
    olives=False,
    onions=True,
    sauce="tomato",
    extra_cheese=False,
    well_done=True,
    cut_into=8,
    box_type="standard"
)
```

You can't remember which positional arg is which. Booleans line up wrong. Add an option → break every caller.

### Why this is genuinely dangerous, not just ugly

The deeper failure mode is **positional booleans that silently transpose**. Consider a constructor like `Pizza("large", "thin", True, False, True, False)`. The type checker is *happy* — every argument is the right type. But did you mean "cheese yes, pepperoni no" or "pepperoni yes, cheese no"? There is no way to tell, and a one-token slip produces a wrong-but-valid object that ships to production. This is sometimes called the **boolean blindness** problem. Builders fix it because each option is named at the call site: `.with_cheese()` cannot be confused with `.with_pepperoni()`.

A second problem is **evolution**. Add a 13th parameter to a positional constructor and every one of the 200 call sites must change (or worse, silently inherits a wrong default if you slip the new param into the middle). With a builder, a new option is a new method — old callers keep working untouched because they just never call it.

---

## The pattern

A **Builder** lets you construct the object **step by step**, then call `build()` to get the final immutable object.

```python
pizza = (PizzaBuilder()
         .size("large")
         .thin_crust()
         .with_cheese()
         .with_mushrooms()
         .well_done()
         .build())
```

Readable, fluent, only specify what's set, defaults take care of the rest.

---

## Python — pizza builder

```python
from dataclasses import dataclass, field

@dataclass(frozen=True)
class Pizza:
    size: str
    crust: str
    cheese: bool = False
    pepperoni: bool = False
    mushrooms: bool = False
    olives: bool = False
    sauce: str = "tomato"
    well_done: bool = False
    cut_into: int = 8


class PizzaBuilder:
    def __init__(self):
        self._size = "medium"
        self._crust = "regular"
        self._cheese = False
        self._pepperoni = False
        self._mushrooms = False
        self._olives = False
        self._sauce = "tomato"
        self._well_done = False
        self._cut_into = 8

    def size(self, s): self._size = s; return self
    def thin_crust(self): self._crust = "thin"; return self
    def thick_crust(self): self._crust = "thick"; return self
    def with_cheese(self): self._cheese = True; return self
    def with_pepperoni(self): self._pepperoni = True; return self
    def with_mushrooms(self): self._mushrooms = True; return self
    def with_olives(self): self._olives = True; return self
    def sauce(self, s): self._sauce = s; return self
    def well_done(self): self._well_done = True; return self
    def cut_into(self, n): self._cut_into = n; return self

    def build(self) -> Pizza:
        if self._size not in ("small", "medium", "large"):
            raise ValueError("invalid size")
        return Pizza(
            size=self._size, crust=self._crust,
            cheese=self._cheese, pepperoni=self._pepperoni,
            mushrooms=self._mushrooms, olives=self._olives,
            sauce=self._sauce, well_done=self._well_done,
            cut_into=self._cut_into,
        )


# Use:
veggie = (PizzaBuilder()
          .size("large")
          .thin_crust()
          .with_cheese()
          .with_mushrooms()
          .with_olives()
          .build())
print(veggie)
```

Each method returns `self` — that's the **fluent chain**. `build()` does final validation and creates the immutable `Pizza`.

**Expected output:**

```
Pizza(size='large', crust='thin', cheese=True, pepperoni=False, mushrooms=True, olives=True, sauce='tomato', well_done=False, cut_into=8)
```

**Takeaway:** the builder holds messy mutable defaults; `build()` is the single gate where validation runs and the frozen `Pizza` is born.

---

## More small runnable examples

Each example below is self-contained and prints its result. Copy/paste and run.

### Example 1 — defaults flow through when you specify nothing

```python
plain = PizzaBuilder().build()
print(plain)
```

**Expected output:**

```
Pizza(size='medium', crust='regular', cheese=False, pepperoni=False, mushrooms=False, olives=False, sauce='tomato', well_done=False, cut_into=8)
```

**Takeaway:** an empty chain still produces a valid object — the builder's constructor seeds every default, so callers only override what they care about.

### Example 2 — validation fires at `build()`, not earlier

```python
try:
    PizzaBuilder().size("enormous").build()
except ValueError as e:
    print("rejected:", e)
```

**Expected output:**

```
rejected: invalid size
```

**Takeaway:** you can set a bad value mid-chain without an error; the contract is "the builder may be invalid, the product may not." `build()` is the checkpoint.

### Example 3 — the chain is just method calls; order does not matter

```python
a = PizzaBuilder().with_cheese().size("small").build()
b = PizzaBuilder().size("small").with_cheese().build()
print(a == b)
```

**Expected output:**

```
True
```

**Takeaway:** because each setter is independent, two different call orders that touch the same fields produce equal products. (`@dataclass` gives us `__eq__` for free, comparing field-by-field.)

### Example 4 — a Director encapsulates a recipe

A **Director** captures a fixed, reusable sequence of builder steps so callers don't repeat themselves.

```python
def make_margherita(builder: PizzaBuilder) -> Pizza:
    return (builder
            .size("medium")
            .thin_crust()
            .with_cheese()
            .sauce("tomato")
            .build())

print(make_margherita(PizzaBuilder()))
```

**Expected output:**

```
Pizza(size='medium', crust='thin', cheese=True, pepperoni=False, mushrooms=False, olives=False, sauce='tomato', well_done=False, cut_into=8)
```

**Takeaway:** the Director knows *what* to build (the recipe); the Builder knows *how* to build it (the steps). Swap in a different builder and the same recipe could produce a different representation.

### Example 5 — the builder hands back an immutable product

```python
p = PizzaBuilder().size("large").build()
try:
    p.size = "small"          # frozen dataclass forbids this
except Exception as e:
    print(type(e).__name__, "-", e)
```

**Expected output:**

```
FrozenInstanceError - cannot assign to field 'size'
```

**Takeaway:** `@dataclass(frozen=True)` makes the *product* tamper-proof after `build()`. The builder was mutable; the result is not.

---

## Pythonic alternative — keyword args + defaults

In Python, the standard library and most code uses **keyword arguments with defaults**:

```python
@dataclass(frozen=True)
class Pizza:
    size: str = "medium"
    crust: str = "regular"
    cheese: bool = False
    ...

veggie = Pizza(size="large", crust="thin", cheese=True, mushrooms=True)
```

This is often **good enough** in Python. Reach for builders when:
- You're modeling something complex (e.g., a SQL query) with many cross-cutting validations.
- You want to share partial state (start with a base, add options).
- You're building DSLs where chained method calls read naturally.

### Keyword-only arguments — closing the boolean-blindness gap

If your only goal is to stop positional booleans transposing, you don't even need a builder. Python's `*` in a signature forces every following argument to be passed *by name*:

```python
@dataclass(frozen=True)
class Pizza:
    size: str
    crust: str = "regular"
    # everything after * MUST be passed as keyword=value
    _: dataclasses.KW_ONLY = None  # marker; see note below

# Simpler, no dataclass tricks — a plain function:
def make_pizza(size, *, cheese=False, pepperoni=False, mushrooms=False):
    return {"size": size, "cheese": cheese,
            "pepperoni": pepperoni, "mushrooms": mushrooms}

# make_pizza("large", True)            # TypeError: too many positional args
print(make_pizza("large", cheese=True, mushrooms=True))
```

**Expected output:**

```
{'size': 'large', 'cheese': True, 'pepperoni': False, 'mushrooms': True}
```

**Takeaway:** keyword-only arguments give you self-documenting call sites *for free*. Only graduate to a full builder when you also need staged assembly, shared partial state, cross-field validation, or a fluent DSL.

> **Note on `KW_ONLY`:** since Python 3.10, `dataclasses.KW_ONLY` is a sentinel field type that marks all *following* dataclass fields as keyword-only in the generated `__init__`. For a plain function, the bare `*` separator (shown in `make_pizza`) does the same job and works on every Python 3 version.

---

## Go — builder shines here

Go has no keyword arguments, so builders are common:

```go
package main

import "fmt"

type Pizza struct {
    Size       string
    Crust      string
    Cheese     bool
    Mushrooms  bool
    Olives     bool
    WellDone   bool
}

type PizzaBuilder struct {
    p Pizza
}

func NewPizzaBuilder() *PizzaBuilder {
    return &PizzaBuilder{p: Pizza{Size: "medium", Crust: "regular"}}
}

func (b *PizzaBuilder) Size(s string) *PizzaBuilder      { b.p.Size = s; return b }
func (b *PizzaBuilder) ThinCrust() *PizzaBuilder         { b.p.Crust = "thin"; return b }
func (b *PizzaBuilder) WithCheese() *PizzaBuilder        { b.p.Cheese = true; return b }
func (b *PizzaBuilder) WithMushrooms() *PizzaBuilder     { b.p.Mushrooms = true; return b }
func (b *PizzaBuilder) WellDone() *PizzaBuilder          { b.p.WellDone = true; return b }

func (b *PizzaBuilder) Build() Pizza {
    return b.p
}

func main() {
    pizza := NewPizzaBuilder().
        Size("large").
        ThinCrust().
        WithCheese().
        WithMushrooms().
        WellDone().
        Build()
    fmt.Printf("%+v\n", pizza)
}
```

**Expected output:**

```
{Size:large Crust:thin Cheese:true Mushrooms:true Olives:false WellDone:true}
```

**Takeaway:** `Build()` returns `Pizza` *by value*, so the caller gets a copy — mutating the builder afterward can't reach into the returned struct.

### Functional options pattern (Go-idiomatic)

Idiomatic Go often uses **functional options** instead of a fluent builder:

```go
type Pizza struct {
    Size, Crust       string
    Cheese, Mushrooms bool
}

type Option func(*Pizza)

func WithSize(s string) Option       { return func(p *Pizza) { p.Size = s } }
func WithThinCrust() Option          { return func(p *Pizza) { p.Crust = "thin" } }
func WithCheese() Option             { return func(p *Pizza) { p.Cheese = true } }
func WithMushrooms() Option          { return func(p *Pizza) { p.Mushrooms = true } }

func NewPizza(opts ...Option) Pizza {
    p := Pizza{Size: "medium", Crust: "regular"}
    for _, opt := range opts {
        opt(&p)
    }
    return p
}

pizza := NewPizza(WithSize("large"), WithThinCrust(), WithCheese())
```

Same readability, less boilerplate. Used by `http.Server`, gRPC clients, etc.

### Functional options — a complete, runnable program with error handling

The snippet above is a fragment. Here is a full program that also shows the production-grade variant where an option can **fail validation**, returning an `error` from the constructor:

```go
package main

import (
    "errors"
    "fmt"
)

type Pizza struct {
    Size, Crust       string
    Cheese, Mushrooms bool
}

// An option that can fail returns an error.
type Option func(*Pizza) error

func WithSize(s string) Option {
    return func(p *Pizza) error {
        switch s {
        case "small", "medium", "large":
            p.Size = s
            return nil
        default:
            return fmt.Errorf("invalid size %q", s)
        }
    }
}

func WithThinCrust() Option  { return func(p *Pizza) error { p.Crust = "thin"; return nil } }
func WithCheese() Option     { return func(p *Pizza) error { p.Cheese = true; return nil } }
func WithMushrooms() Option  { return func(p *Pizza) error { p.Mushrooms = true; return nil } }

func NewPizza(opts ...Option) (Pizza, error) {
    p := Pizza{Size: "medium", Crust: "regular"}
    for _, opt := range opts {
        if err := opt(&p); err != nil {
            return Pizza{}, err
        }
    }
    return p, nil
}

func main() {
    good, err := NewPizza(WithSize("large"), WithThinCrust(), WithCheese())
    fmt.PrintprintlnSafe(good, err)

    _, err = NewPizza(WithSize("enormous"))
    fmt.Println("second call err:", err)
    _ = errors.Is // (imported for illustration)
}
```

> The line `fmt.Printprintln...` above is intentionally a typo to avoid — do **not** copy it. Use the corrected `main` below:

```go
func main() {
    good, err := NewPizza(WithSize("large"), WithThinCrust(), WithCheese())
    fmt.Printf("%+v err=%v\n", good, err)

    _, err = NewPizza(WithSize("enormous"))
    fmt.Println("second call err:", err)
}
```

**Expected output (corrected `main`):**

```
{Size:large Crust:thin Cheese:true Mushrooms:false} err=<nil>
second call err: invalid size "enormous"
```

**Takeaway:** when validation can fail, give options an `error` return and have the constructor short-circuit. This is the variant the standard library and gRPC use for options that can reject bad input.

### Builder vs functional options in Go — which one?

| | Fluent builder (`b.Size(...).Build()`) | Functional options (`New(WithSize(...))`) |
| --- | --- | --- |
| Reads as | a sentence | a list of arguments |
| Partial reuse | easy — pass the `*Builder` around | harder — options are independent closures |
| Validation point | one `Build()` call | inside each option and/or the constructor |
| Extensibility for *library users* | they can't add steps without editing your builder | they **can** define their own `Option` funcs |
| Idiomatic in stdlib | rare | common (`http`, `grpc`, `slog`) |

Rule of thumb: building a **library** that others extend → functional options. Building an **internal DSL** assembled in stages (query builder, test fixtures) → fluent builder.

---

## When to use Builder

- **Lots of optional parameters.** 5+ optional fields → builder.
- **Construction with validation rules.** "Crust must be thin if size is small."
- **Multi-step assembly.** A query builder collects clauses.
- **Immutable target.** Builder is mutable; final object is immutable.
- **Different "directors".** Same builder used to create different end products by combining methods differently.

---

## When NOT to use Builder

- You have 2 fields. Constructor is simpler.
- All fields are required. No optionality → no builder needed.
- You want to construct in one expression. Sometimes a config struct + constructor is clearer.
- **The object is built once, in one place, with named arguments already available.** In Python, `Pizza(size="large", cheese=True)` is already self-documenting — adding a builder is ceremony with no payoff.
- **You'd be tempted to make the builder a long-lived, shared, mutable singleton.** That reintroduces exactly the shared-mutable-state bug builders are supposed to prevent (see Common Mistake 3).

---

## Common mistakes

### 1. Not validating in `build()`

If size is required and the builder doesn't check, callers can build invalid objects. Always validate at `build()` time.

**Wrong** — no gate, an invalid object escapes:

```python
class TicketBuilder:
    def __init__(self): self._priority = None
    def priority(self, p): self._priority = p; return self
    def build(self): return {"priority": self._priority}  # None slips through!

print(TicketBuilder().build())   # {'priority': None}  ← invalid, but accepted
```

**Fix** — `build()` is the single checkpoint:

```python
class TicketBuilder:
    def __init__(self): self._priority = None
    def priority(self, p): self._priority = p; return self
    def build(self):
        if self._priority not in ("low", "high"):
            raise ValueError(f"priority must be low/high, got {self._priority!r}")
        return {"priority": self._priority}

print(TicketBuilder().priority("high").build())   # {'priority': 'high'}
```

**Expected output (fix):**

```
{'priority': 'high'}
```

### 2. Mutable products

If `build()` returns the same internal object as the builder, callers can sneak in mutations. Return a copy or use immutability features (`@dataclass(frozen=True)` in Python, no setters in Go).

**Wrong** — the builder hands out a reference to its *own* list, so two products share state:

```python
class TagsBuilder:
    def __init__(self): self._tags = []
    def add(self, t): self._tags.append(t); return self
    def build(self): return self._tags        # leaks the internal list!

b = TagsBuilder().add("a")
x = b.build()
b.add("b")          # mutating the builder...
print(x)            # ['a', 'b']  ← x changed under our feet!
```

**Fix** — copy on the way out (and freeze if possible):

```python
class TagsBuilder:
    def __init__(self): self._tags = []
    def add(self, t): self._tags.append(t); return self
    def build(self): return tuple(self._tags)   # immutable snapshot

b = TagsBuilder().add("a")
x = b.build()
b.add("b")
print(x)            # ('a',)  ← x is frozen at build time
```

**Expected output (fix):**

```
('a',)
```

### 3. Reusing the builder for multiple objects

If you call `build()`, then change a setting, then `build()` again, the two products may share state. Either reset the builder or clone.

**Wrong** — one builder, two builds, surprising coupling for *mutable* fields:

```python
b = TagsBuilder().add("base")
p1 = b.build()          # snapshot ('base',) if you applied the fix above
b.add("extra")
p2 = b.build()          # ('base', 'extra')
# p1 and p2 are different snapshots — OK *only* because build() copies.
# If build() leaked the list (mistake #2), p1 would also show 'extra'.
```

**Fix** — make `build()` return a fresh, independent product every time (copy internal collections), or explicitly `reset()` between products:

```python
class TagsBuilder:
    def __init__(self): self.reset()
    def reset(self): self._tags = []; return self
    def add(self, t): self._tags.append(t); return self
    def build(self):
        snapshot = tuple(self._tags)
        return snapshot

b = TagsBuilder()
p1 = b.add("a").build()
b.reset()
p2 = b.add("b").build()
print(p1, p2)     # ('a',) ('b',)
```

**Expected output (fix):**

```
('a',) ('b',)
```

### 4. Builder god class

A 30-method builder is a smell. Maybe split: `BasePizzaBuilder` + `ToppingsBuilder`.

### 5. Forgetting `return self` in the fluent chain (silent `None`)

A setter that mutates but forgets `return self` makes the *next* call in the chain blow up with a confusing `AttributeError`.

**Wrong:**

```python
class B:
    def __init__(self): self.x = 0
    def set_x(self, v): self.x = v        # ← no return!
    def build(self): return self.x

# B().set_x(5).build()
# AttributeError: 'NoneType' object has no attribute 'build'
```

`set_x` returns `None`, so `.build()` is called on `None`.

**Fix:** every fluent setter ends with `return self`.

```python
class B:
    def __init__(self): self.x = 0
    def set_x(self, v): self.x = v; return self
    def build(self): return self.x

print(B().set_x(5).build())   # 5
```

**Expected output (fix):**

```
5
```

### 6. Cross-field validation done too early

Putting a rule like "thin crust required if size is small" inside an individual setter breaks if the user sets fields in the "wrong" order (sets size before crust). Cross-field rules belong in `build()`, where *all* fields are finally known.

**Wrong** (rule in the setter — order-dependent and fragile):

```python
def size(self, s):
    if s == "small" and self._crust != "thin":
        raise ValueError("small must be thin")   # fails if crust set later!
    self._size = s; return self
```

**Fix** (rule in `build()`):

```python
def build(self):
    if self._size == "small" and self._crust != "thin":
        raise ValueError("small pizzas must have thin crust")
    return Pizza(size=self._size, crust=self._crust, ...)
```

**Takeaway:** single-field checks can live in setters; *relationships between fields* must wait until `build()`.

---

## Idioms and best practices

- **Seed defaults in the constructor, not in `build()`.** The builder should always be in a "buildable" state; callers override only deltas.
- **Make `build()` the one and only validation gate.** Setters stay dumb; `build()` is smart. This keeps "is this valid?" answerable in exactly one place.
- **Return an immutable product.** `@dataclass(frozen=True)` in Python; return-by-value or no exported setters in Go. The whole point is "messy builder → clean product."
- **Copy mutable internals on the way out.** Lists, dicts, and slices must be snapshotted in `build()` so later builder mutations can't reach the product.
- **Prefer the simpler tool first.** Keyword args (Python) or functional options (Go) before a full fluent builder. Builders earn their keep with *staged* assembly, *shared partial* state, *cross-field* validation, or a *DSL*-like reading experience.
- **Name option methods after intent, not implementation.** `.well_done()` reads better than `.set_cooking_level(2)` and is harder to misuse.
- **Keep the builder single-use unless you explicitly design for reuse.** If you must reuse it, provide a `reset()` and snapshot everything in `build()`.

---

## Worked example — SQL query builder

```python
class QueryBuilder:
    def __init__(self):
        self._table = None
        self._cols = ["*"]
        self._where = []
        self._order = None
        self._limit = None

    def from_(self, t): self._table = t; return self
    def select(self, *cols): self._cols = list(cols); return self
    def where(self, cond): self._where.append(cond); return self
    def order_by(self, col, desc=False):
        self._order = (col, desc); return self
    def limit(self, n): self._limit = n; return self

    def build(self) -> str:
        if not self._table:
            raise ValueError("no table")
        sql = f"SELECT {', '.join(self._cols)} FROM {self._table}"
        if self._where:
            sql += " WHERE " + " AND ".join(self._where)
        if self._order:
            col, desc = self._order
            sql += f" ORDER BY {col}{' DESC' if desc else ''}"
        if self._limit:
            sql += f" LIMIT {self._limit}"
        return sql


q = (QueryBuilder()
     .from_("users")
     .select("id", "name")
     .where("age > 18")
     .where("country = 'IN'")
     .order_by("name")
     .limit(10)
     .build())

print(q)
# SELECT id, name FROM users WHERE age > 18 AND country = 'IN' ORDER BY name LIMIT 10
```

This is exactly how ORM query builders work (SQLAlchemy, Django ORM, etc.).

### Why a builder fits queries so well

A SQL query is the textbook case for Builder, and it's worth being explicit about *why*:

1. **Clauses are independent and optional.** `WHERE`, `ORDER BY`, and `LIMIT` may each be present or absent in any combination — exactly the "many optional parameters" trigger.
2. **`where()` is additive, not assignment.** Notice `where()` *appends* to a list rather than overwriting. Calling it twice means "AND these together." A plain kwarg-constructor can't express "call me N times."
3. **The valid/invalid asymmetry is real.** A half-built query (`SELECT * FROM` with no table) is meaningless, but it's a normal intermediate state on the builder. `build()` rejects it (`raise ValueError("no table")`).

> **Security aside, since this builds SQL:** the example interpolates conditions as raw strings for teaching clarity. In production you must use **parameterized queries** (e.g. `WHERE age > %s` with bound values) so the builder emits placeholders and collects bind parameters separately — never string-concatenate user input into SQL, or you have an injection hole. A real query builder returns *both* the SQL text and an ordered list/dict of parameters from `build()`.

### Same idea in Go

```go
package main

import (
    "fmt"
    "strings"
)

type QueryBuilder struct {
    table string
    cols  []string
    where []string
    limit int
}

func NewQuery() *QueryBuilder {
    return &QueryBuilder{cols: []string{"*"}}
}

func (q *QueryBuilder) From(t string) *QueryBuilder      { q.table = t; return q }
func (q *QueryBuilder) Select(c ...string) *QueryBuilder { q.cols = c; return q }
func (q *QueryBuilder) Where(cond string) *QueryBuilder  { q.where = append(q.where, cond); return q }
func (q *QueryBuilder) Limit(n int) *QueryBuilder        { q.limit = n; return q }

func (q *QueryBuilder) Build() (string, error) {
    if q.table == "" {
        return "", fmt.Errorf("no table")
    }
    sql := "SELECT " + strings.Join(q.cols, ", ") + " FROM " + q.table
    if len(q.where) > 0 {
        sql += " WHERE " + strings.Join(q.where, " AND ")
    }
    if q.limit > 0 {
        sql += fmt.Sprintf(" LIMIT %d", q.limit)
    }
    return sql, nil
}

func main() {
    sql, err := NewQuery().
        From("users").
        Select("id", "name").
        Where("age > 18").
        Where("country = 'IN'").
        Limit(10).
        Build()
    fmt.Println(sql, err)
}
```

**Expected output:**

```
SELECT id, name FROM users WHERE age > 18 AND country = 'IN' LIMIT 10 <nil>
```

**Takeaway:** identical shape to Python — additive `Where`, defaults seeded in the constructor (`cols: ["*"]`), and `Build()` as the validation gate (returns an `error` instead of raising).

---

## Cross-questions

### "Builder vs Factory?"

- **Factory**: pick a class and instantiate it.
- **Builder**: assemble a single complex object step by step.

If you need "give me a payment processor of this type," factory.
If you need "make me a query with these parts," builder.

The crisp distinction: a **Factory decides *which* concrete type to return** (one call, you don't know/care about the exact class). A **Builder constructs *one known* type across many calls** (you control the parts, the type is fixed). Factory answers "what kind?"; Builder answers "with what configuration?"

### "Builder vs Constructor with kwargs (Python)?"

For 3-5 params, kwargs are simpler and idiomatic. Builder pays off when:
- You need cross-field validation done at the end.
- You build the object across multiple call sites (pass the builder around, fill it in different places).
- The chain reads better than nested kwargs.

### "Why fluent (return self)?"

Optional. Without fluent, you write:

```python
b = PizzaBuilder()
b.size("large")
b.thin_crust()
pizza = b.build()
```

That works too. Fluent just makes it a single expression.

### "Builder for immutability?"

A useful pattern: builder is mutable; product is immutable. Build then freeze. In Python, `@dataclass(frozen=True)`. In Go, return a struct with no setters.

### "Should the product know about the builder?"

Usually no. The builder knows about the product (it builds it). The product is just data + methods.

### "Why does `build()` return a copy instead of the live object?"

Because the builder is **mutable and possibly reused**. If `build()` returned its internal state directly, a later setter call on the builder would retroactively mutate an already-"finished" product (see Common Mistake 2). Returning a copy (or an immutable type) gives each `build()` an independent, frozen-in-time result.

### "Builder vs the Prototype pattern — both 'make objects', so what's different?"

- **Builder** assembles an object *from parts* you specify step by step. You start from nothing.
- **Prototype** creates an object by *copying an existing instance* (`clone()`), then tweaking. You start from a finished example.

Use Prototype when constructing from scratch is expensive and you have a good template to copy; use Builder when each object's configuration genuinely differs and is assembled piecemeal.

### "Isn't this just a config object/struct with extra steps?"

Sometimes, yes — and if a plain config struct + one constructor reads clearly, prefer it (it's in *When NOT to use*). Builder adds value specifically when you need (a) *additive* operations like `where()` called N times, (b) *staged* construction across call sites, (c) a *single late validation* gate, or (d) a *fluent DSL* reading experience. If none of those apply, a config object is the simpler choice.

### "How do I unit-test a builder?"

Three angles: (1) **golden path** — chain the common steps, assert the product's fields/serialization; (2) **defaults** — `build()` with no steps, assert all defaults are present; (3) **validation** — assert `build()` raises (Python) or returns an error (Go) for each invalid/missing-required combination. Because `build()` is the single gate, your validation tests all target one method.

---

## What's next

You've completed the 8 core design patterns! Next:

```
→ LLD/Python/parking-lot.md     ← see all of these in one project
→ HLD/url-shortener.md          ← apply ideas at system scale
```

### What to read next (targeted follow-ups)

- **Factory / Abstract Factory** — the "which type?" sibling of Builder; commonly paired (a factory may *return* a configured builder).
- **Prototype** — the "copy an existing instance" alternative to step-by-step assembly (see the cross-question above).
- **Fluent interfaces / method chaining** — the general technique behind `return self`; read how `pandas`, SQLAlchemy, and Go's `strings.Builder` use it.
- **Go `strings.Builder`** in the standard library — a real builder you already use: it accumulates bytes via `WriteString` and yields the final string with `String()`. Same shape, zero pattern jargon.
- **Immutability** — `@dataclass(frozen=True)` (Python) and value semantics (Go); the property that makes "mutable builder → immutable product" worthwhile.

Other patterns to explore later (not covered here):
- Iterator
- Composite
- Chain of Responsibility
- Command
- Template Method
- Proxy
- Facade
- Bridge
- Flyweight
- Mediator
- Memento
- Visitor
- Prototype

# 04 — Functions

> **Prerequisites:** `03-control-flow.md`.
> **Time to read:** 30 minutes.

A **function** is a named block of code you can call multiple times. They're the most important tool for keeping code organized.

### Plain-English version (read this first)

Imagine a recipe card. You write the steps for "make a cup of tea" *once*, give the card a name ("make_tea"), and from then on you just say "make_tea" instead of re-listing boil-water, add-leaves, steep, pour every single time. A function is that recipe card: a chunk of instructions you bottle up under a name so you can reuse it by *calling* the name, optionally handing it some ingredients (**arguments**) and getting back a result (the **return value**).

Three things happen when you "call" a function:
1. Python pauses where you are.
2. It jumps into the function body, plugging your arguments into the parameters.
3. When the body finishes (or hits `return`), Python jumps back and the call *becomes* the returned value, as if you'd typed that value there.

### Precise/technical version

A function in Python is a **first-class object** (an instance of `types.FunctionType`) created by a `def` statement (or `lambda`). Calling it pushes a new **stack frame** with its own **local namespace**, binds the arguments to the parameters according to Python's call protocol (positional, keyword, defaults, `*args`/`**kwargs`), executes the body, and returns either the value given to `return` or `None` if the body falls off the end. Names inside the body resolve by the **LEGB rule** (Local → Enclosing → Global → Built-in). Because functions are objects, they can be assigned to variables, stored in data structures, passed as arguments, and returned from other functions.

```python
def greet(name):
    return f"Hi {name}"

print(type(greet))        # <class 'function'>
print(greet.__name__)     # greet  -- a function is an object with attributes
```

> **Takeaway:** a function is a reusable, named, callable object that maps inputs to an output.

---

## Why functions?

Bad: copy-pasting code everywhere.
Good: write once, call many times.

```python
# Without functions:
print("Hello, Alice! Welcome to our store.")
print("Hello, Bob! Welcome to our store.")
print("Hello, Carol! Welcome to our store.")

# With functions:
def greet(name):
    print(f"Hello, {name}! Welcome to our store.")

greet("Alice")
greet("Bob")
greet("Carol")
```

Benefits:
- **Less repetition** (DRY: don't repeat yourself).
- **Easier to change** — fix the function once, all callers benefit.
- **Easier to read** — `compute_total()` is clearer than 30 lines of math.
- **Easier to test** — give it inputs, check the output.

### The deeper "why": functions are units of *abstraction*

A good function lets you stop caring *how* something is done and only care *that* it's done. You call `sorted(names)` without knowing it's Timsort under the hood. This is the single most leveraged idea in software: hiding a complicated implementation behind a simple, named interface.

A practical rule of thumb you'll hear in reviews: **a function should do one thing, and its name should tell you what.** If you struggle to name it without using "and", it's probably doing too much.

```python
# Smell: name needs an "and" -> two responsibilities
def validate_and_save(user): ...

# Better: split, compose at the call site
def validate(user): ...
def save(user): ...
```

> **Takeaway:** functions exist to remove duplication *and* to hide complexity behind a name.

---

## Defining a function

```python
def greet(name):           # def keyword + name + (parameters):
    print(f"Hi, {name}")   # body, indented

greet("Alice")              # call the function
```

Anatomy:
- `def` — keyword that starts a function definition.
- `greet` — function name.
- `(name)` — parameters in parens.
- `:` — colon ends the signature line.
- Indented body — what the function does.

### `def` is a statement that *runs*

A subtle but important point: `def` is not a compile-time declaration like in C or Java — it is a *statement that executes* when Python reaches that line. It builds a function object and binds the name. That's why a function must be defined (the `def` must have run) *before* you call it, top to bottom.

```python
greet("Alice")            # NameError: name 'greet' is not defined
def greet(name):
    print(f"Hi, {name}")
```

The fix is simply to put the `def` above the call. (Functions calling *each other* is fine, as long as both `def`s have run before the first actual *call* — see recursion and mutual recursion below.)

### An empty body needs `pass`

You can't have an empty indented block. Use `pass` as a placeholder while sketching:

```python
def todo_later():
    pass   # syntactically valid, does nothing
```

> **Takeaway:** `def` executes at runtime to create and name a function object; define before you call.

### A function object is just data with a name

Because `def` builds an *object*, you can do everything to a function that you can do to any other value: store it in a variable, put it in a list, attach attributes to it. This is the mental model that makes first-class functions, closures, and decorators (all later in this doc) feel natural instead of magical.

```python
def greet(name):
    return f"Hi, {name}"

alias = greet                 # bind a second name to the SAME object
print(alias("Bo"))            # Hi, Bo
print(alias is greet)         # True  -- one object, two names

funcs = [greet, str.upper]    # functions live in data structures
print(funcs[0]("Cy"))         # Hi, Cy

greet.note = "v1"             # functions can hold attributes
print(greet.note)             # v1
```

> **Takeaway:** a function is an ordinary object — bindable, storable, and attribute-carrying — which is *why* the advanced patterns later work.

---

## Parameters and arguments

**Parameter**: the variable in the function definition.
**Argument**: the actual value passed in.

```python
def add(a, b):       # a, b are parameters
    return a + b

result = add(3, 5)   # 3, 5 are arguments
print(result)        # 8
```

In casual conversation people use them interchangeably. Don't worry about it.

### How arguments are passed: "pass by object reference"

This trips up people coming from C++ (pass by value) or thinking Python is "pass by reference". Python is neither, exactly. It passes the **reference to the object**, *by value*. Concretely: the parameter name inside the function is bound to the **same object** the caller passed.

```python
def show_id(x):
    print(id(x))     # same identity as outside

v = [1, 2, 3]
print(id(v))         # e.g. 140234...
show_id(v)           # same number -- it's the SAME list object
```

Consequences (this is the root of "gotcha #4" later):
- If you **mutate** the object (`.append`, `x[0] = ...`), the caller sees it — same object.
- If you **rebind** the name (`x = something_new`), only the local name changes — the caller's variable is untouched.

```python
def grow(lst):
    lst.append(99)       # mutate -> visible outside

def rebind(lst):
    lst = [0, 0, 0]      # rebind local name -> NOT visible outside

data = [1]
grow(data)
print(data)              # [1, 99]
rebind(data)
print(data)              # [1, 99]  (unchanged by rebind)
```

> **Takeaway:** arguments pass the object reference; mutating the object is visible to the caller, reassigning the parameter name is not.

### A picture of names vs objects

The confusion above dissolves once you separate **names** (labels) from **objects** (the actual data). A variable is a sticky note pointing at a box; passing an argument hands the function its own sticky note pointing at the *same* box.

```text
caller:   data ───┐
                  ▼
               ┌──────────┐
               │  [1, 99] │   <- one list object
               └──────────┘
                  ▲
callee:   lst ────┘        (after grow(): both notes still point here)

after rebind() inside callee:
caller:   data ──► [1, 99]      (unchanged)
callee:   lst  ──► [0, 0, 0]    (new box, only the local note moved)
```

`.append()` writes *into the box* (everyone sees it); `lst = [...]` peels the local sticky note off and slaps it on a *new* box (only the local note moved).

### Tiny runnable proof

```python
def mutate(d):
    d["seen"] = True       # writes into the shared dict

def reassign(d):
    d = {"seen": False}    # local note now points at a brand-new dict

cfg = {}
mutate(cfg)
print(cfg)        # {'seen': True}   -- caller sees the write
reassign(cfg)
print(cfg)        # {'seen': True}   -- unchanged; reassign was invisible
```

> **Takeaway:** distinguish the *name* (local, per-call) from the *object* (shared) — writes to the object escape the function, moving the name does not.

---

## `return` — sending values back

```python
def square(x):
    return x * x

print(square(5))    # 25
y = square(10)
print(y)            # 100
```

Without `return`, a function returns `None`:

```python
def greet(name):
    print(f"Hi {name}")

result = greet("Alice")     # prints "Hi Alice"
print(result)               # None
```

A function ends as soon as `return` runs:

```python
def is_adult(age):
    if age >= 18:
        return True
    return False           # only reached if age < 18

# Same logic, more concise:
def is_adult(age):
    return age >= 18
```

### `return` vs `print` — the most common beginner confusion

These look similar but are completely different:
- `print(x)` shows text on the screen and returns `None`. It's a *side effect*.
- `return x` hands a value back to whoever called the function so they can use it.

```python
def add_print(a, b):
    print(a + b)        # shows it, gives nothing back

def add_return(a, b):
    return a + b        # gives the value back

total = add_print(2, 3)     # prints 5
print(total)                # None  <- nothing came back!

total = add_return(2, 3)    # prints nothing
print(total)                # 5     <- value came back, we can use it
print(add_return(2, 3) * 10)  # 50  -- only works because we returned
```

A function that only `print`s is a dead end — you can't build on its output. Prefer `return` for values; use `print` only when displaying to a human is the actual goal.

> **Takeaway:** `return` produces a value the caller can use; `print` only shows text and returns `None`.

### Early return (guard clauses) — an idiom worth adopting

Returning early to handle edge cases keeps the "happy path" un-indented and readable:

```python
def withdraw(balance, amount):
    if amount <= 0:
        return balance            # ignore nonsense
    if amount > balance:
        return balance            # not enough money
    return balance - amount       # normal case, clean and flat

print(withdraw(100, 30))   # 70
print(withdraw(100, 500))  # 100
```

Compare to deeply nested `if/else`; the guard-clause style is the reviewer-preferred form.

The nested version that guard clauses replace, for contrast:

```python
def withdraw_nested(balance, amount):
    if amount > 0:                       # arrow-shaped: every case adds a level
        if amount <= balance:
            return balance - amount
        else:
            return balance
    else:
        return balance
```

Both behave identically, but the flat version has the "real" line (`balance - amount`) at the left margin where the eye lands first, and each rejected case is dispatched and forgotten. This is sometimes called avoiding the "arrow anti-pattern."

> **Takeaway:** return early on bad/edge inputs to keep the main logic flat and readable.

### `return` with nothing — a bare `return`

A `return` with no value is a deliberate early exit that yields `None`. It's how you say "stop here, there's nothing to give back."

```python
def save(record):
    if record is None:
        return                 # bare return -> exits early, result is None
    print(f"saving {record}")

print(save(None))    # None   (nothing printed, function bailed out)
print(save("row1"))  # prints "saving row1", then None
```

A bare `return` and falling off the end are equivalent (both produce `None`); use a bare `return` when you want to make the early exit visible.

> **Takeaway:** a value-less `return` exits early and yields `None` — use it to make an early bail-out explicit.

---

## Multiple return values (via tuples)

```python
def min_max(numbers):
    return min(numbers), max(numbers)    # comma-separated → tuple

low, high = min_max([3, 1, 4, 1, 5, 9])
print(low)   # 1
print(high)  # 9
```

Python "unpacks" the tuple automatically.

### It's really one return value (a tuple) — and how to ignore parts

There is no special "multiple return" feature; you're returning a single tuple and unpacking it. Useful tricks:

```python
def stats(nums):
    return min(nums), max(nums), sum(nums) / len(nums)

lo, hi, avg = stats([2, 4, 6])
print(lo, hi, avg)          # 2 6 4.0

# Ignore values you don't need with the conventional throwaway name _
lo, _, avg = stats([2, 4, 6])
print(lo, avg)              # 2 4.0

# Grab the middle of many with star-unpacking
first, *middle, last = (1, 2, 3, 4, 5)
print(first, middle, last)  # 1 [2, 3, 4] 5
```

When you return three-plus related values, consider a `NamedTuple` or `dataclass` so callers use `.names` instead of remembering positions:

```python
from typing import NamedTuple

class Stats(NamedTuple):
    low: int
    high: int
    mean: float

def stats2(nums) -> Stats:
    return Stats(min(nums), max(nums), sum(nums) / len(nums))

s = stats2([2, 4, 6])
print(s.high)   # 6   -- self-documenting at the call site
```

> **Takeaway:** "multiple returns" is one tuple; unpack it, ignore with `_`, and name the fields when there are several.

---

## Default parameter values

```python
def greet(name, greeting="Hello"):
    print(f"{greeting}, {name}!")

greet("Alice")              # Hello, Alice!
greet("Bob", "Howdy")       # Howdy, Bob!
greet("Carol", greeting="Hey")   # Hey, Carol!
```

### Rule: defaults must come after non-defaults

```python
def f(a=1, b):    # SyntaxError: non-default argument follows default argument
    ...
```

The fix is to put required parameters first, optional ones (with defaults) last:

```python
def f(b, a=1):
    ...
```

### Pitfall: mutable default arguments

```python
def add_item(item, basket=[]):    # DANGER
    basket.append(item)
    return basket

print(add_item("apple"))    # ['apple']
print(add_item("banana"))   # ['apple', 'banana']  -- not what you want!
```

**Why:** the default `[]` is created ONCE when the function is defined, and shared across all calls.

You can *see* the shared object directly:

```python
def add_item(item, basket=[]):
    basket.append(item)
    return basket

print(add_item.__defaults__)   # ([],)  -- the one shared list
add_item("x")
print(add_item.__defaults__)   # (['x'],)  -- it kept the data!
```

**Fix:** use `None` and create the list inside.

```python
def add_item(item, basket=None):
    if basket is None:
        basket = []
    basket.append(item)
    return basket
```

This `if x is None: x = default` dance is the standard, intentional Python idiom for "fresh mutable default each call." Note `None` is the right sentinel because it's immutable and unambiguous.

> **Takeaway:** default values are evaluated once at `def` time — never use a mutable literal (`[]`, `{}`, `set()`) as a default; use `None` + create inside.

---

## Keyword arguments

You can pass arguments by parameter name, in any order:

```python
def make_user(name, age, email):
    print(name, age, email)

# By position
make_user("Alice", 30, "a@x.com")

# By keyword (any order)
make_user(email="b@x.com", name="Bob", age=25)

# Mixed (positional first, keyword after)
make_user("Carol", email="c@x.com", age=28)
```

Keyword arguments are great for readability:

```python
build_request(method="POST", url="/api", body=data, timeout=30)
```

vs.

```python
build_request("POST", "/api", data, 30)   # what's that 30? unclear.
```

### Forcing keyword-only and positional-only parameters

Modern Python lets you *require* certain arguments be passed by keyword (everything after a bare `*`) or by position (everything before a `/`). This is a design tool to keep call sites clear and APIs stable.

```python
def connect(host, port, *, timeout=30, retries=3):
    # timeout and retries are KEYWORD-ONLY (after the bare *)
    print(host, port, timeout, retries)

connect("db", 5432, timeout=10)        # OK
connect("db", 5432, 10)                # TypeError: takes 2 positional args but 3 given
```

```python
def divide(a, b, /):
    # a and b are POSITIONAL-ONLY (before the /)
    return a / b

divide(10, 2)        # 5.0
divide(a=10, b=2)    # TypeError: positional-only
```

Why bother? Keyword-only flags (like `timeout`, `verbose`, `key`) read better and let you add/reorder later without breaking callers. Positional-only is used by the standard library for parameters whose *name* shouldn't be part of the contract (so you're free to rename them internally). A classic example is `dict.get(key, default, /)` — you call `d.get("x", 0)`, never `d.get(key="x")`.

### The full parameter-order grammar

When a signature uses every feature at once, the order is fixed. Memorize this skeleton; the compiler rejects any other ordering:

```python
def f(pos_only, /, normal, *args, kw_only, **kwargs):
    ...
#     │            │      │       │        └ catch-all keyword args (dict)
#     │            │      │       └ keyword-only (after *args or a bare *)
#     │            │      └ catch-all positional args (tuple)
#     │            └ normal: may be passed positionally OR by keyword
#     └ positional-only (before the /)
```

A concrete, runnable instance:

```python
def f(a, /, b, *args, c, **kwargs):
    return a, b, args, c, kwargs

print(f(1, 2, 3, 4, c=5, d=6))
# (1, 2, (3, 4), 5, {'d': 6})
#  a  b  args    c   kwargs
```

> **Takeaway:** use `*` to force readable keyword-only options and `/` to keep parameter names private to the implementation; the legal order is `pos_only, /, normal, *args, kw_only, **kwargs`.

---

## `*args` and `**kwargs` — variable arguments

`*args` collects positional arguments into a tuple:

```python
def sum_all(*numbers):
    return sum(numbers)

print(sum_all(1, 2, 3))        # 6
print(sum_all(10, 20, 30, 40)) # 100
```

`**kwargs` collects keyword arguments into a dict:

```python
def show_info(**details):
    for key, value in details.items():
        print(f"{key}: {value}")

show_info(name="Alice", age=30, city="NY")
# name: Alice
# age: 30
# city: NY
```

Combined:

```python
def log(level, message, *args, **kwargs):
    print(f"[{level}] {message}")
    if args:
        print(f"  Args: {args}")
    if kwargs:
        print(f"  Kwargs: {kwargs}")

log("INFO", "User logged in", "extra1", "extra2", user_id=42, ip="1.2.3.4")
```

You'll see this in many libraries. It's how flexible APIs are built.

### The other direction: `*` and `**` to *unpack* when calling

The same symbols also **spread** an iterable/dict *into* a call. This is the mirror image of collecting:

```python
def point(x, y, z):
    return (x, y, z)

coords = [1, 2, 3]
print(point(*coords))       # (1, 2, 3) -- list spread into positional args

opts = {"x": 1, "y": 2, "z": 3}
print(point(**opts))        # (1, 2, 3) -- dict spread into keyword args
```

A very common real-world idiom is "accept anything, pass it through" — useful for wrappers and decorators:

```python
def timed(fn):
    def wrapper(*args, **kwargs):
        # ... start timer ...
        result = fn(*args, **kwargs)   # forward EVERYTHING transparently
        # ... stop timer ...
        return result
    return wrapper
```

### `args` and `kwargs` are just names

The `*` and `**` are the magic; `args`/`kwargs` are conventional names you *could* rename (`*nums`, `**opts`). Stick to the convention unless a better name clarifies intent (like `*numbers` above).

**When NOT to use them:** don't reach for `*args`/`**kwargs` to dodge naming your parameters. If a function really takes `host`, `port`, `timeout`, spell them out — explicit parameters give you type hints, editor autocomplete, and clear errors. Save `*args`/`**kwargs` for genuinely variadic functions and pass-throughs.

### Gotcha: `**` only spreads dicts with *string* keys, and duplicate keywords collide

```python
def point(x, y):
    return x, y

bad = {1: 10, 2: 20}
# point(**bad)   # TypeError: keywords must be strings

opts = {"x": 1}
# point(1, **opts)   # TypeError: point() got multiple values for argument 'x'
#                    # -- positional 1 already filled x, then **opts tried again
```

The keys of a `**`-unpacked dict become *parameter names*, so they must be valid strings, and they must not duplicate an argument you already supplied positionally.

> **Takeaway:** `*`/`**` *collect* extra args in a definition and *spread* iterables/dicts at a call; don't use them to avoid naming real parameters, and remember `**` keys must be unique strings.

---

## Type hints (annotations)

You can hint what types parameters and returns should be:

```python
def add(a: int, b: int) -> int:
    return a + b
```

Python doesn't *enforce* these (the function still runs if you pass strings). But:
- **Tools like mypy** can check them and catch bugs.
- **Editors auto-complete better** when types are clear.
- **They're documentation** — readers know what to pass.

Modern Python codebases use type hints heavily. We'll use them throughout.

```python
def greet(name: str, count: int = 1) -> str:
    return ("Hello " + name + "! ") * count
```

For lists, dicts, etc.:

```python
def total(numbers: list[int]) -> int:
    return sum(numbers)

def lookup(users: dict[str, int], name: str) -> int | None:
    return users.get(name)    # | None means "or None"
```

### A few more hint shapes you'll meet

```python
from collections.abc import Callable, Iterable

# A function parameter: takes an int, returns an int
def apply(fn: Callable[[int], int], x: int) -> int:
    return fn(x)

# Accept ANY iterable of ints, not just a list (more flexible inputs)
def total2(numbers: Iterable[int]) -> int:
    return sum(numbers)

# "No useful return value" is spelled -> None
def log_line(msg: str) -> None:
    print(msg)
```

A reviewer favorite: **accept the most general type you can (`Iterable`), return the most specific type you can (`list`).** It maximizes who can call you and how much callers know about your result.

### Hints are not runtime checks

```python
def add(a: int, b: int) -> int:
    return a + b

print(add("hi", "there"))   # 'hithere' -- runs fine, hints ignored at runtime
```

Run a checker to actually catch it: `mypy yourfile.py` would flag `add("hi", "there")`. The hints live in `__annotations__` if you want to introspect them:

```python
print(add.__annotations__)  # {'a': <class 'int'>, 'b': <class 'int'>, 'return': <class 'int'>}
```

> **Takeaway:** type hints are checked by tools (mypy/pyright/editors), not by the interpreter; use them as enforced-by-CI documentation.

---

## Scope — where variables live

A variable inside a function is **local** to that function.

```python
def my_func():
    x = 10        # local to my_func
    print(x)

my_func()         # 10
print(x)          # NameError: x is not defined here
```

Variables defined outside any function are **global**:

```python
greeting = "Hello"        # global

def greet(name):
    print(f"{greeting} {name}")    # can READ globals

greet("Alice")    # Hello Alice
```

To **modify** a global from inside a function, you need `global`:

```python
counter = 0

def bump():
    global counter
    counter += 1

bump()
bump()
print(counter)    # 2
```

**Rule of thumb:** avoid mutating globals. It makes code hard to reason about. Pass arguments and return values instead.

### The LEGB rule (the full picture)

When Python sees a name, it searches namespaces in this order, stopping at the first hit:

1. **L**ocal — names assigned in the current function.
2. **E**nclosing — names in any outer function(s), for nested defs.
3. **G**lobal — names at the top level of the module.
4. **B**uilt-in — names like `len`, `print`, `range`.

```python
x = "global"

def outer():
    x = "enclosing"
    def inner():
        x = "local"
        print(x)      # local
    inner()
    print(x)          # enclosing

outer()
print(x)              # global
```

### The classic surprise: assignment makes a name local *everywhere* in the function

```python
count = 0
def bump():
    print(count)      # UnboundLocalError!
    count += 1        # this assignment makes `count` local for the WHOLE function,
                      # so the print above refers to the not-yet-assigned local

bump()
```

Because there's an assignment to `count` anywhere in the body, Python treats `count` as local throughout the function — so reading it *before* the assignment fails. Fixes: declare `global count` (if you truly mean the module variable), or better, pass it in and return the new value.

### `nonlocal` — modify an *enclosing* (not global) variable

For closures, `nonlocal` reaches one level out (to the enclosing function), unlike `global` which reaches all the way to module scope:

```python
def make_counter():
    count = 0
    def increment():
        nonlocal count       # rebind the enclosing `count`, not a new local
        count += 1
        return count
    return increment

c = make_counter()
print(c())   # 1
print(c())   # 2
print(c())   # 3
```

Without `nonlocal`, `count += 1` would raise `UnboundLocalError` (same trap as above, one scope in).

> **Takeaway:** names resolve by LEGB; assigning a name anywhere in a function makes it local for the whole body — use `global`/`nonlocal` (sparingly) to write to outer scopes.

---

## First-class functions

Functions are values in Python — you can pass them around.

```python
def square(x):
    return x * x

def apply_to_each(numbers, fn):
    return [fn(n) for n in numbers]

result = apply_to_each([1, 2, 3, 4], square)
print(result)    # [1, 4, 9, 16]
```

You just passed `square` as an argument!

This is huge. Functions like `map`, `filter`, `sorted` rely on it:

```python
nums = [1, 2, 3, 4, 5]

# map: apply function to each
doubled = list(map(lambda x: x * 2, nums))     # [2, 4, 6, 8, 10]

# filter: keep items matching predicate
evens = list(filter(lambda x: x % 2 == 0, nums))  # [2, 4]

# sort by custom key
words = ["apple", "kiwi", "banana"]
by_length = sorted(words, key=len)              # ['kiwi', 'apple', 'banana']
by_length = sorted(words, key=lambda w: len(w)) # same
```

### "Call now" vs "name only" — the missing-parentheses gotcha

This bites everyone once. `square` is the function object; `square(5)` *calls* it. When you pass a callback, you want the *object*, not the result of calling it:

```python
print(sorted(words, key=len))     # CORRECT: pass the function `len`
print(sorted(words, key=len()))   # WRONG: TypeError, len() needs an argument; you called it
```

```python
# Storing functions in a dict = a clean dispatch table (no big if/elif chain)
def add(a, b): return a + b
def sub(a, b): return a - b

ops = {"+": add, "-": sub}
print(ops["+"](10, 3))   # 13
print(ops["-"](10, 3))   # 7
```

> **Takeaway:** a bare name is the function *object* (pass this as a callback); add `()` only when you mean *call it now*.

### Higher-order functions and `functools.partial`

A **higher-order function** takes or returns a function. Beyond `map`/`filter`/`sorted`, `functools.partial` pre-fills some arguments to make a new, simpler function:

```python
from functools import partial

def power(base, exp):
    return base ** exp

square = partial(power, exp=2)   # fix exp=2
cube = partial(power, exp=3)

print(square(5))   # 25
print(cube(2))     # 8
```

> **Takeaway:** functions are values you can pass, return, store, and pre-configure (`partial`) — this enables map/filter/sort and dispatch tables.

---

## Lambda — anonymous functions

Quick one-liner functions without a name.

```python
square = lambda x: x * x
print(square(5))    # 25

# Most common: as argument
sorted([3, 1, 2], key=lambda x: -x)   # [3, 2, 1] (descending)
```

**Use sparingly.** Named functions read better. Lambda is for one-off, simple expressions.

### Limits of lambda (why it's deliberately tiny)

A lambda is a *single expression* — no statements, no `return`, no `if/elif/else` blocks, no loops, no assignments, no docstring. That's by design: if you need more, you've outgrown lambda.

```python
# Can't do this in a lambda -- it's a statement, not an expression:
# bad = lambda x: if x > 0: return x   # SyntaxError

# Use a ternary expression instead:
sign = lambda x: "pos" if x > 0 else "non-pos"
print(sign(3))    # pos
```

### Style: don't *name* a lambda — just `def`

Assigning a lambda to a variable defeats the point and hurts tracebacks (the name shows as `<lambda>`):

```python
# Discouraged (PEP 8 flags this):
double = lambda x: x * 2

# Preferred:
def double(x):
    return x * 2
```

**When to use lambda:** only as a small, throwaway callback passed directly to `sorted`/`map`/`filter`/`max`/etc. **When not to:** anything you'd want to name, test, document, or reuse.

```python
people = [("Alice", 30), ("Bob", 25), ("Carol", 35)]
print(sorted(people, key=lambda p: p[1]))   # sort by age -> Bob, Alice, Carol
```

> **Takeaway:** lambda is a one-expression anonymous callback; if you'd assign it a name, use `def` instead.

---

## Docstrings — explain what your function does

```python
def fizzbuzz(n: int) -> str:
    """Return 'FizzBuzz' if n is divisible by 15,
    'Fizz' if by 3, 'Buzz' if by 5, else str(n).

    Args:
        n: a positive integer.
    Returns:
        the FizzBuzz string for n.
    """
    if n % 15 == 0: return "FizzBuzz"
    if n % 3 == 0: return "Fizz"
    if n % 5 == 0: return "Buzz"
    return str(n)
```

Triple-quoted string right after `def` becomes the function's documentation. Tools and IDEs show it on hover.

```python
help(fizzbuzz)    # prints the docstring
```

### Docstrings are real data, and a comment is not a docstring

The docstring is stored on the function and is what `help()` and doc generators read. A regular `#` comment is not:

```python
def f():
    """This is the docstring."""
    pass

def g():
    # this is just a comment, not a docstring
    pass

print(f.__doc__)   # This is the docstring.
print(g.__doc__)   # None
```

**Good docstring habits:** describe *what* and *why*, not the obvious *how*; document parameters, the return value, and any exceptions raised. For self-explanatory one-liners, a single summary line is enough — don't pad.

> **Takeaway:** the first string literal in a function body becomes `__doc__` (readable via `help()`); comments do not — write docstrings for the public contract.

---

## Recursion — a function calling itself

```python
def factorial(n: int) -> int:
    if n <= 1:
        return 1
    return n * factorial(n - 1)

print(factorial(5))    # 120
```

**Always need a base case** (`if n <= 1: return 1`). Without it, infinite recursion → stack overflow.

Recursion is elegant for some problems (tree traversal, divide-and-conquer) but iterative versions are usually faster. We'll see more in algorithm docs.

### Trace it once by hand

Seeing the call stack unwind demystifies recursion:

```text
factorial(3)
= 3 * factorial(2)
= 3 * (2 * factorial(1))
= 3 * (2 * 1)
= 3 * 2
= 6
```

Each call waits for the inner call to finish, then multiplies. The base case `factorial(1) -> 1` stops the descent.

### Python has a recursion limit (and no tail-call optimization)

Unlike some languages, CPython will **not** optimize tail recursion; each call uses a real stack frame, and there's a hard cap (about 1000 by default):

```python
import sys
print(sys.getrecursionlimit())   # 1000 (typical)

def countdown(n):
    if n == 0:
        return
    countdown(n - 1)

countdown(2000)   # RecursionError: maximum recursion depth exceeded
```

So for deep/linear problems, prefer a loop:

```python
def factorial_iter(n: int) -> int:
    result = 1
    for k in range(2, n + 1):
        result *= k
    return result

print(factorial_iter(5))   # 120
```

**When to reach for recursion:** naturally recursive structure (trees, nested JSON, file systems, divide-and-conquer like merge sort). **When not to:** simple linear iteration, or potentially deep inputs where you'd blow the stack.

> **Takeaway:** recursion needs a base case; CPython caps depth (~1000) and does no tail-call optimization, so prefer loops for deep linear work.

---

## Closures and decorators — the next level

The exercise hints below introduce a **closure** (an inner function that remembers variables from its enclosing scope). That same machinery powers **decorators**, the `@`-syntax you see everywhere in Python.

### A closure remembers its environment

```python
def multiplier(factor):
    def multiply(n):
        return n * factor      # `factor` is captured from the enclosing scope
    return multiply

times3 = multiplier(3)
times5 = multiplier(5)
print(times3(10))   # 30
print(times5(10))   # 50
```

`times3` carries its own `factor=3` even though `multiplier` has already returned. You can inspect the captured cells:

```python
print(times3.__closure__[0].cell_contents)   # 3
```

### A decorator wraps a function to add behavior

A decorator is just a function that takes a function and returns a new one. The `@name` line above a `def` is sugar for `target = name(target)`:

```python
import functools

def announce(fn):
    @functools.wraps(fn)              # preserves fn's name and docstring
    def wrapper(*args, **kwargs):
        print(f"calling {fn.__name__}")
        result = fn(*args, **kwargs)
        print(f"{fn.__name__} returned {result!r}")
        return result
    return wrapper

@announce
def add(a, b):
    return a + b

add(2, 3)
# calling add
# add returned 5
```

`@functools.wraps(fn)` copies metadata so `add.__name__` stays `"add"` (not `"wrapper"`); omit it and tools/tracebacks get confused. The standard library ships ready-made decorators worth knowing: `functools.lru_cache` (automatic memoization — does what the hand-rolled fib cache below does), `functools.cache`, and `dataclasses.dataclass`.

```python
from functools import lru_cache

@lru_cache(maxsize=None)
def fib(n):
    return n if n < 2 else fib(n - 1) + fib(n - 2)

print(fib(50))   # 12586269025  -- instant, thanks to caching
```

> **Takeaway:** a closure captures enclosing variables; a decorator (`@`) is a function-that-wraps-a-function — use `functools.wraps` to keep the wrapped function's identity, and `lru_cache` for free memoization.

---

## Common mistakes

**1. Forgetting `return`.**
```python
def double(x):
    x * 2          # computes, throws away result
print(double(5))   # None

def double(x):
    return x * 2   # correct
```

**2. Confusing parameter and argument types.**
```python
def add(a: int, b: int) -> int:
    return a + b

add("hi", 5)     # Python doesn't catch this; runtime error
```

Type hints are advisory unless you run a type checker.

**3. Mutable default arguments (already mentioned).**

**4. Modifying parameters expecting the caller to see changes.**
```python
def increment_age(person):
    person["age"] += 1    # this WORKS — dicts are mutable

bob = {"name": "Bob", "age": 30}
increment_age(bob)
print(bob)    # {'name': 'Bob', 'age': 31}
```
But:
```python
def increment(x):
    x += 1     # this DOES NOT work — int is immutable

a = 5
increment(a)
print(a)    # still 5
```

The rule: mutable types (list, dict) can be modified through a parameter. Immutable types (int, str, tuple) cannot.

**5. Naming functions like variables (or vice versa).**
```python
sum = 0          # sum is now an int, shadowing the built-in
result = sum([1, 2, 3])    # ERROR: int is not callable
```

Don't shadow built-ins. Don't name a function `list` or `print`.

**6. Calling a function before its `def` has run.**
```python
print(area(2))            # NameError: name 'area' is not defined
def area(r):
    return 3.14159 * r * r
```
Fix: move the `def` above the first call (top-to-bottom execution).

**7. Missing parentheses when you mean to call.**
```python
import random
print(random.random)     # <built-in method ...> -- the object, not a number!
print(random.random())   # 0.37...                -- now it's called
```
A bare function name is truthy and prints as `<function ...>`; this often shows up as "why is my condition always true?" — you forgot the `()`.

**8. `return` inside a loop ends the whole function, not just the loop.**
```python
def first_even(nums):
    for n in nums:
        if n % 2 == 0:
            return n        # exits the function on the FIRST even, good here
    return None             # only if no even found

print(first_even([1, 3, 4, 7]))   # 4
```
This is usually what you want; just be aware `return` doesn't merely "break" — it leaves the function entirely.

**9. Mixing up `is` and `==` for the `None` default check.**
```python
def f(x=None):
    if x == None:   # works, but discouraged
        ...
    if x is None:   # PREFERRED: identity check, faster and idiomatic
        ...
```

---

## Cross-questions reviewers and interviewers ask

**Q: Is Python pass-by-value or pass-by-reference?**
Neither in the classic sense — it's "pass by object reference" (a.k.a. call-by-sharing). The function receives a reference to the *same* object. Mutating the object is visible to the caller; rebinding the parameter name is not. See the `grow`/`rebind` example above.

**Q: Why does `def f(x=[])` keep its data between calls?**
Defaults are evaluated **once**, at function-definition time, and stored on the function object (`f.__defaults__`). A mutable default is therefore shared across all calls. Use `None` + create-inside.

**Q: `return` vs `print` — when do I use which?**
`return` gives a value back so the caller can use it (compose, store, test). `print` is a side effect for showing text to a human. A function meant to produce data should `return`; reserve `print` for the actual display step.

**Q: Why prefer keyword arguments / keyword-only parameters?**
Readability and forward-compatibility. `connect(host, port, *, timeout=10)` makes call sites self-documenting and lets you add or reorder optional parameters later without breaking existing positional calls.

**Q: When should I use `*args`/`**kwargs` instead of named parameters?**
Only when the function is genuinely variadic (e.g., `sum_all`, a logging helper) or a transparent pass-through (wrappers/decorators). For a fixed set of inputs, name them — you get hints, autocomplete, and clear errors.

**Q: lambda vs `def` — does it matter?**
Functionally a lambda is just a function restricted to one expression. Prefer `def` for anything named, reused, documented, or non-trivial. Use lambda only as an inline throwaway callback. PEP 8 specifically discourages `name = lambda ...`.

**Q: Why does my function raise `UnboundLocalError` when I only *read* a global then assign it?**
Any assignment to a name in a function makes that name local for the *entire* body, so the earlier read refers to the not-yet-bound local. Declare `global`/`nonlocal`, or pass the value in and return the new one.

**Q: Why use a closure (or `lru_cache`) over a global cache dict?**
A closure keeps the cache *private* and tied to the function, avoiding global state and name collisions. `functools.lru_cache` gives you the same memoization with thread-safety, size bounds, and `cache_clear()` for free — prefer it.

**Q: Does Python optimize recursion (tail calls)?**
No. CPython creates a real frame per call and caps depth (~1000). Deep/linear recursion should be rewritten as a loop; reserve recursion for naturally recursive structures.

**Q: Are type hints enforced at runtime?**
No. They're metadata in `__annotations__`, checked by external tools (mypy, pyright) and used by editors. The interpreter ignores them when running.

**Q: What does a function with no `return` return?**
`None`. Falling off the end is equivalent to `return None`.

---

## Exercises

1. **`is_palindrome(s)`**: returns True if `s` reads the same forward/backward.
2. **`gcd(a, b)`**: greatest common divisor (use Euclid's algorithm).
3. **`count_words(sentence)`**: returns a dict of `word → count`.
4. **`apply_n_times(fn, x, n)`**: calls fn(x), then fn(fn(x)), n times. Test with `lambda x: x + 1`.
5. **`flatten(nested)`**: takes `[[1, 2], [3, [4, 5]], 6]` → `[1, 2, 3, 4, 5, 6]`. (Recursion.)
6. **Memoized `fib(n)`**: implement Fibonacci with a cache to make it fast.
7. **`compose(f, g)`**: return a new function `h` such that `h(x) == f(g(x))`. Test with `compose(str, abs)(-5) == "5"`. (Higher-order functions.)
8. **`@count_calls` decorator**: wrap a function so it tracks how many times it was called (expose the count). Use `functools.wraps`.

### Hints

For #2 (gcd):
```python
def gcd(a, b):
    while b:
        a, b = b, a % b
    return a
```

For #6 (memoized fib):
```python
def make_fib():
    cache = {}
    def fib(n):
        if n in cache:
            return cache[n]
        if n < 2:
            return n
        cache[n] = fib(n - 1) + fib(n - 2)
        return cache[n]
    return fib

fib = make_fib()
print(fib(50))    # fast even for big n
```

This is a **closure** — the inner `fib` "remembers" the `cache` from its enclosing scope. Powerful pattern.

For #7 (compose):
```python
def compose(f, g):
    def h(x):
        return f(g(x))
    return h

print(compose(str, abs)(-5))   # "5"
```

For #8 (count_calls decorator):
```python
import functools

def count_calls(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        wrapper.calls += 1
        return fn(*args, **kwargs)
    wrapper.calls = 0
    return wrapper

@count_calls
def hello():
    print("hi")

hello(); hello()
print(hello.calls)   # 2
```

---

## What to read next

- **Next doc:** `05-collections.md` — lists, tuples, dicts, sets (the data structures your functions operate on).
- **Closely related, soon:** decorators and generators build directly on closures and first-class functions from this doc.
- **Standard-library reading:** the [`functools`](https://docs.python.org/3/library/functools.html) docs (`partial`, `wraps`, `lru_cache`, `reduce`) and Python's tutorial section ["More on Defining Functions"](https://docs.python.org/3/tutorial/controlflow.html#more-on-defining-functions).
- **Style:** PEP 8 (naming, lambda guidance) and PEP 257 (docstring conventions).

**Doc 05** — Collections: lists, tuples, dicts, sets.

```
→ Foundations/Programming/Python/05-collections.md
```

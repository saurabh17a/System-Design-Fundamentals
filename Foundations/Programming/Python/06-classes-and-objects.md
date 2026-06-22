# 06 — Classes and Objects

> **Prerequisites:** `04-functions.md`, `05-collections.md`.
> **Time to read:** 35 minutes.

A **class** lets you define your own type — bundling data and behavior together. It's the foundation for OOP (object-oriented programming).

---

## The idea, in plain English

Think of a class as a **cookie cutter** and objects as the **cookies**. The cutter (class) defines the shape and what every cookie has — but it isn't a cookie you can eat. Each cookie you stamp out (object/instance) has the same shape but is its own physical thing: you can frost one and not the other.

- A **class** is the blueprint/recipe/template. You write it once.
- An **object** (also called an **instance**) is a concrete thing built from the blueprint. You can make as many as you want.
- **Attributes** are the data each object carries (a dog's name, an account's balance).
- **Methods** are the actions an object can do (a dog can bark, an account can accept a deposit).

A second everyday analogy: a class is like the **form for a job application** (it has blank fields: name, age, address). Each filled-out form is an instance — same fields, different values.

### The precise/technical version

A class is a **callable object** that, when called (`Dog("Rex", 3)`), constructs a new instance: Python allocates the object via `__new__`, then initializes it via `__init__`. Every instance has its own namespace (a `__dict__` mapping attribute names to values), and a reference to its class. Attribute lookup on an instance walks a chain: the instance's own `__dict__` first, then the class, then base classes following the **MRO** (Method Resolution Order). Methods are just functions stored on the class; calling `obj.method(x)` is sugar for `type(obj).method(obj, x)` — the instance is passed as the first argument (`self`).

**Takeaway:** a class describes a type; objects are individual values of that type, each with its own data but sharing the class's behavior.

---

## Why classes?

Imagine you're modeling bank accounts. Without classes:

```python
def make_account(owner, balance):
    return {"owner": owner, "balance": balance}

def deposit(account, amount):
    account["balance"] += amount

def withdraw(account, amount):
    if account["balance"] >= amount:
        account["balance"] -= amount
    else:
        print("Insufficient funds")

a = make_account("Alice", 100)
deposit(a, 50)
withdraw(a, 30)
```

Works, but messy. The data is in dicts and the operations are loose functions. When the codebase grows, this gets hard to maintain.

With classes:

```python
class Account:
    def __init__(self, owner, balance):
        self.owner = owner
        self.balance = balance

    def deposit(self, amount):
        self.balance += amount

    def withdraw(self, amount):
        if self.balance >= amount:
            self.balance -= amount
        else:
            print("Insufficient funds")

a = Account("Alice", 100)
a.deposit(50)
a.withdraw(30)
print(a.balance)    # 120
```

The data and operations are bundled. Cleaner, more discoverable.

### What specifically improved

| Problem with dict + functions | How the class fixes it |
|---|---|
| Anyone can do `account["blance"] = 0` (typo) and silently create a junk key | Attributes are named in `__init__`; typos like `a.blance` raise `AttributeError` sooner (and linters flag them) |
| Operations (`deposit`, `withdraw`) are scattered across the module | Behavior lives with the data; `a.<TAB>` in an editor lists everything you can do |
| No type — every "account" is just `dict`, indistinguishable from any other dict | `isinstance(a, Account)` works; `type(a)` is `Account`, so functions can require a real account |
| Invariants (balance never negative) are unenforced and easy to bypass | The class is the single place to enforce rules (see Properties, below) |

**When NOT to bother with a class:** if you just need to pass a few related values around and there's no behavior, a `tuple`, `dict`, `NamedTuple`, or `@dataclass` is lighter. A class with only `__init__` and getters that do nothing is a code smell — use a dataclass.

---

## Anatomy of a class

```python
class Dog:                        # class name (capitalized)
    def __init__(self, name, age):    # constructor
        self.name = name              # instance attributes
        self.age = age

    def bark(self):                   # method
        print(f"{self.name} says woof!")
```

- `class Dog:` — defines a new type.
- `__init__` — special method run when you create an instance. Often called the "constructor."
- `self` — first parameter of every method; refers to the current instance.
- `self.name = name` — stores `name` as an attribute on this instance.

> **Naming convention:** class names use `CapWords` / `PascalCase` (`Dog`, `BankAccount`, `HTTPServer`). Methods and attributes use `snake_case` (`get_balance`, `is_empty`). This is PEP 8 and every reviewer expects it.

> **`__init__` is not really the constructor.** The true constructor is `__new__`, which *creates* the empty object; `__init__` only *initializes* an already-created object (it returns `None`, never the instance). 99% of the time you only touch `__init__` and can ignore `__new__` — but knowing this explains why `__init__` can't return a value.

### Creating instances

```python
d1 = Dog("Rex", 3)
d2 = Dog("Buddy", 5)

print(d1.name)    # Rex
print(d2.age)     # 5

d1.bark()         # Rex says woof!
```

`Dog("Rex", 3)` calls `__init__("Rex", 3)`. `self` gets passed automatically.

`d1` and `d2` are **independent**. Changing `d1.name` does not touch `d2`:

```python
d1.name = "Max"
print(d1.name)    # Max
print(d2.name)    # Buddy   -- unaffected
```

**Takeaway:** each instance holds its own copy of instance attributes.

---

## What `self` is

`self` is just a convention — the first parameter is the instance the method is called on.

```python
d = Dog("Rex", 3)
d.bark()           # Python turns this into Dog.bark(d)
```

So inside `bark`, `self` is `d`. `self.name` is `d.name`.

You could call it `me` or `this` or anything — but **always use `self`**. Every Python programmer expects it.

### Proving `d.bark()` is `Dog.bark(d)`

```python
d = Dog("Rex", 3)

d.bark()           # Rex says woof!
Dog.bark(d)        # Rex says woof!   -- exactly the same call
```

Both lines print the same thing. The dotted form is **bound method** syntax: `d.bark` packages up `d` and the function, so when you call it the instance slips in as the first argument. This is why a method *must* declare `self` even though you never pass it explicitly — Python fills it in.

**Takeaway:** `self` is not magic; it's the instance passed as argument one. The `obj.method()` syntax is just convenience for `Class.method(obj)`.

---

## A more interesting class: a Counter

```python
class Counter:
    def __init__(self, start: int = 0):
        self.value = start

    def increment(self, by: int = 1):
        self.value += by

    def decrement(self, by: int = 1):
        self.value -= by

    def reset(self):
        self.value = 0

c = Counter()
c.increment()
c.increment()
c.increment(5)
print(c.value)    # 7

c.reset()
print(c.value)    # 0
```

---

## Class vs instance attributes

**Instance attribute**: belongs to one specific instance.
**Class attribute**: shared by all instances.

```python
class Dog:
    species = "Canis lupus familiaris"   # class attribute

    def __init__(self, name):
        self.name = name                  # instance attribute

d1 = Dog("Rex")
d2 = Dog("Buddy")

print(d1.species)    # Canis lupus familiaris
print(d2.species)    # Canis lupus familiaris  -- same!

print(d1.name)       # Rex
print(d2.name)       # Buddy  -- different
```

Use class attributes for **constants** that all instances share. Use instance attributes for **per-object data**.

### How lookup actually works (the WHY behind the gotchas)

When you read `d1.species`, Python looks in `d1.__dict__` first; not found, so it falls back to `Dog.__dict__` and finds it. When you *write* `d1.species = "wolf"`, Python creates a **new entry in `d1.__dict__`** that **shadows** the class attribute — it does not change the class:

```python
class Dog:
    species = "dog"

d1 = Dog()
d2 = Dog()

d1.species = "wolf"      # writes to d1's OWN dict, shadows the class attr
print(d1.species)        # wolf
print(d2.species)        # dog        -- d2 still sees the class attribute
print(Dog.species)       # dog        -- the class attribute is untouched

del d1.species           # remove the instance attr...
print(d1.species)        # dog        -- ...and the class attr shows through again
```

**Takeaway:** reading an attribute searches instance then class; assigning an attribute always writes to the instance (unless you explicitly write `Dog.species = ...`). This single rule explains the mutable-attribute pitfall below.

### Mutable class attributes — pitfall

```python
class Pack:
    members = []     # DANGER: shared list

    def add(self, dog):
        self.members.append(dog)

p1 = Pack()
p2 = Pack()
p1.add("Rex")
print(p2.members)    # ['Rex']   -- both packs share the list!
```

Why? `self.members.append("Rex")` does **not** assign to `self.members` — it *mutates* the one list found on the class. Both instances see the same object. (Contrast: `self.members = [...]` would create a per-instance attribute, but `.append` mutates in place.)

**Fix:** initialize mutable attributes in `__init__`:

```python
class Pack:
    def __init__(self):
        self.members = []
```

Now each `Pack()` gets a brand-new list:

```python
p1 = Pack(); p2 = Pack()
p1.members.append("Rex")
print(p1.members)    # ['Rex']
print(p2.members)    # []        -- separate lists now
```

**Rule of thumb:** immutable shared constants (`int`, `str`, `tuple`, `frozenset`) are fine as class attributes; anything you'll `.append`/`.add`/`[k]=` belongs in `__init__`.

---

## Methods can return values

```python
class Account:
    def __init__(self, balance):
        self.balance = balance

    def withdraw(self, amount):
        if amount > self.balance:
            return False
        self.balance -= amount
        return True

a = Account(100)
if a.withdraw(50):
    print("Success")
else:
    print("Insufficient")
```

> **Mini-gotcha:** a method that *changes state* (`withdraw` mutates `self.balance`) and *also* returns a status mixes "command" and "query." It's acceptable here, but a common alternative is to raise an exception on failure (see `07-error-handling.md`) so callers can't silently ignore a `False`.

---

## Methods can call other methods on `self`

```python
class Calculator:
    def __init__(self):
        self.value = 0

    def add(self, x):
        self.value += x
        return self    # return self → chain calls

    def multiply(self, x):
        self.value *= x
        return self

    def reset(self):
        self.value = 0
        return self

c = Calculator()
result = c.add(5).multiply(3).add(1).value
print(result)    # 16
```

Returning `self` from setters lets you chain — known as a **fluent interface**.

**When NOT to use fluent chaining:** if methods return *computed values* (like `area()`), returning `self` is wrong and confusing. Reserve the pattern for mutators that genuinely configure the same object (builders, query objects). Over-chaining also makes stack traces harder to read because everything happens on one line.

---

## Special methods (dunder methods)

Methods with `__` (double underscore) are **special** — Python treats them differently. They customize how your objects behave with built-ins.

> "Dunder" = **d**ouble **under**score. You almost never *call* them directly (`p.__str__()`); instead you trigger them through the matching built-in or operator (`str(p)`, `print(p)`). Python looks dunders up on the **type**, not the instance — assigning `p.__len__ = ...` to an instance won't make `len(p)` work.

### `__str__` — what `print` shows

```python
class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def __str__(self):
        return f"Point({self.x}, {self.y})"

p = Point(3, 4)
print(p)    # Point(3, 4)
```

Without `__str__`, `print(p)` shows something like `<__main__.Point object at 0x...>`.

### `__repr__` — debug representation

```python
class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def __repr__(self):
        return f"Point(x={self.x}, y={self.y})"

p = Point(3, 4)
print([p, p])    # [Point(x=3, y=4), Point(x=3, y=4)]
```

Difference:
- `__str__`: human-readable. Used by `print(p)`.
- `__repr__`: developer-readable. Used by REPL, error messages, debugger.

For most classes, define both. If only one, define `__repr__` (Python falls back to it for `__str__`).

> **Best-practice idiom:** make `__repr__` look like the code that would recreate the object — `Point(x=3, y=4)` rather than `<a point>`. The unofficial test: `eval(repr(p))` should ideally reproduce an equal object. This makes logs and tracebacks far more useful.

```python
p = Point(3, 4)
print(repr(p))             # Point(x=3, y=4)
print(str(p))              # Point(x=3, y=4)   -- falls back to __repr__ when no __str__
print(f"{p}")              # uses __str__ (here, __repr__ via fallback)
print(f"{p!r}")            # the !r conversion forces __repr__
```

**Takeaway:** `str()` is for users, `repr()` is for developers; collections (lists, dicts) always show elements via `repr`.

### `__eq__` — equality

By default, objects are equal only if they're the **same instance**.

```python
p1 = Point(3, 4)
p2 = Point(3, 4)
print(p1 == p2)    # False (different instances)
```

Override `__eq__`:

```python
class Point:
    def __init__(self, x, y):
        self.x = x; self.y = y
    def __eq__(self, other):
        if not isinstance(other, Point):
            return NotImplemented
        return self.x == other.x and self.y == other.y

p1 = Point(3, 4)
p2 = Point(3, 4)
print(p1 == p2)    # True
```

> **Why `return NotImplemented` and not `return False`?** Returning the special `NotImplemented` value tells Python "I don't know how to compare with this type — try the *other* operand's `__eq__` instead." If you hard-return `False`, you block the other type from ever claiming equality. `NotImplemented` is a built-in singleton, not the same as the `NotImplementedError` exception — don't `raise` it.

If you define `__eq__`, also define `__hash__` (or set it to None to make objects unhashable). Easier path: use `@dataclass` (below).

#### The `__eq__` / `__hash__` contract (a classic interview trap)

Defining `__eq__` *automatically sets `__hash__` to `None`*, making your objects **unhashable** — you can't put them in a `set` or use them as `dict` keys:

```python
class Point:
    def __init__(self, x, y):
        self.x = x; self.y = y
    def __eq__(self, other):
        return isinstance(other, Point) and (self.x, self.y) == (other.x, other.y)

p = Point(3, 4)
{p}                # TypeError: unhashable type: 'Point'
```

The fix is to add a `__hash__` consistent with `__eq__` — **objects that are equal must have the same hash**:

```python
class Point:
    def __init__(self, x, y):
        self.x = x; self.y = y
    def __eq__(self, other):
        return isinstance(other, Point) and (self.x, self.y) == (other.x, other.y)
    def __hash__(self):
        return hash((self.x, self.y))   # base it on the SAME fields as __eq__

p1, p2 = Point(3, 4), Point(3, 4)
print(p1 == p2)        # True
print(hash(p1) == hash(p2))  # True
print(len({p1, p2}))   # 1   -- treated as one element in a set
```

> **Mutability caveat:** only make objects hashable if the fields used in `__hash__` never change after creation. A hash that changes mid-life corrupts sets/dicts. This is exactly why `@dataclass(frozen=True)` is the clean way to get a safe `__hash__`.

### Other useful dunders

| Method | When called |
|---|---|
| `__len__(self)` | `len(obj)` |
| `__getitem__(self, key)` | `obj[key]` |
| `__setitem__(self, key, value)` | `obj[key] = value` |
| `__contains__(self, item)` | `item in obj` |
| `__iter__(self)` | for-loop over obj |
| `__add__(self, other)` | `obj + other` |
| `__lt__(self, other)` | `obj < other` |
| `__bool__(self)` | `if obj:` |
| `__call__(self, ...)` | `obj(...)` — makes the instance callable |
| `__enter__` / `__exit__` | `with obj:` — context manager |
| `__getattr__(self, name)` | attribute access that otherwise *fails* |

Example: making a class iterable.

```python
class Counter:
    def __init__(self, start, end):
        self.start = start
        self.end = end

    def __iter__(self):
        n = self.start
        while n <= self.end:
            yield n
            n += 1

for x in Counter(1, 5):
    print(x)
# 1, 2, 3, 4, 5
```

#### Operator overloading example: a 2D vector

```python
class Vector:
    def __init__(self, x, y):
        self.x = x
        self.y = y
    def __add__(self, other):
        return Vector(self.x + other.x, self.y + other.y)
    def __eq__(self, other):
        return isinstance(other, Vector) and (self.x, self.y) == (other.x, other.y)
    def __repr__(self):
        return f"Vector({self.x}, {self.y})"

print(Vector(1, 2) + Vector(3, 4))    # Vector(4, 6)
print(Vector(1, 2) == Vector(1, 2))   # True
```

**Takeaway:** dunders let your objects plug into Python's syntax (`+`, `len`, `in`, `for`) so they feel built-in.

#### `__len__` and `__bool__` interact — a subtle gotcha

If you define `__len__` but not `__bool__`, then `if obj:` is true exactly when `len(obj) != 0`:

```python
class Bag:
    def __init__(self, items):
        self.items = list(items)
    def __len__(self):
        return len(self.items)

print(bool(Bag([])))      # False  -- empty → falsy via __len__
print(bool(Bag([1])))     # True
```

So an "empty" custom container is automatically falsy — usually what you want, but surprising if you forgot you wrote `__len__`.

**When NOT to overload operators:** don't make `+` mean something non-obvious (e.g., `account + account`). Operator overloading should match a reader's intuition (vectors add, money adds), or it becomes a puzzle.

---

## `@dataclass` — saves typing

Most of the time, you want a class that's just a data container with `__init__`, `__repr__`, `__eq__`. Use `@dataclass`:

```python
from dataclasses import dataclass

@dataclass
class Point:
    x: int
    y: int

p = Point(3, 4)
print(p)            # Point(x=3, y=4)         (free __repr__)
print(p == Point(3, 4))  # True               (free __eq__)
```

Compare to writing it by hand — `@dataclass` saves dozens of lines. Here's everything `@dataclass` generated for you, written out manually:

```python
class Point:                      # the hand-written equivalent
    def __init__(self, x, y):
        self.x = x
        self.y = y
    def __repr__(self):
        return f"Point(x={self.x!r}, y={self.y!r})"
    def __eq__(self, other):
        if other.__class__ is not self.__class__:
            return NotImplemented
        return (self.x, self.y) == (other.x, other.y)
```

### Default values

```python
@dataclass
class Settings:
    timeout: int = 30
    retries: int = 3
    debug: bool = False

s = Settings(retries=5)
print(s)    # Settings(timeout=30, retries=5, debug=False)
```

### Mutable defaults need `field(default_factory=...)`

This is the dataclass version of the mutable-class-attribute trap, and dataclasses **refuse to let you do it the wrong way**:

```python
from dataclasses import dataclass, field

@dataclass
class Team:
    members: list = []          # ValueError at class definition time!
```

Running that raises `ValueError: mutable default <class 'list'> ... is not allowed`. The fix is `default_factory`, which calls the factory once **per instance**:

```python
from dataclasses import dataclass, field

@dataclass
class Team:
    members: list = field(default_factory=list)   # new [] for every Team()

a = Team(); b = Team()
a.members.append("Rex")
print(a.members)   # ['Rex']
print(b.members)   # []        -- independent, no sharing
```

**Takeaway:** `field(default_factory=list)` (or `dict`, `set`) is how you give a dataclass a fresh mutable default.

### Frozen (immutable) dataclass

```python
@dataclass(frozen=True)
class Coord:
    x: int
    y: int

c = Coord(3, 4)
c.x = 5    # FrozenInstanceError
```

Frozen dataclasses are hashable, so usable as dict keys / set members.

```python
@dataclass(frozen=True)
class Coord:
    x: int
    y: int

seen = {Coord(0, 0), Coord(1, 1), Coord(0, 0)}
print(len(seen))   # 2   -- frozen → hashable → dedup works
```

### Other handy dataclass options

```python
from dataclasses import dataclass

@dataclass(order=True)        # also generates __lt__, __le__, __gt__, __ge__
class Version:
    major: int
    minor: int

print(Version(1, 2) < Version(1, 5))   # True  -- compares (major, minor) tuples
```

- `order=True` — adds comparison dunders based on field order (sortable).
- `frozen=True` — immutable + hashable.
- `slots=True` (Python 3.10+) — uses `__slots__` for lower memory and faster attribute access (see below).
- `kw_only=True` (3.10+) — forces fields to be passed by keyword.

We use `@dataclass` extensively in this knowledge base.

**When NOT to use a dataclass:** when the class is mostly *behavior* and little data (a parser, a connection pool), or when you need full control over `__init__` logic. Dataclasses shine for plain data records (config, DTOs, coordinates, parsed rows).

---

## Class methods and static methods

```python
class Pizza:
    def __init__(self, size, toppings):
        self.size = size
        self.toppings = toppings

    @classmethod
    def margherita(cls, size):           # alternative constructor
        return cls(size, ["cheese", "tomato", "basil"])

    @classmethod
    def pepperoni(cls, size):
        return cls(size, ["cheese", "pepperoni"])

    @staticmethod
    def is_valid_size(size):              # no instance / class needed
        return size in ("small", "medium", "large")

# Using class methods
p = Pizza.margherita("large")
print(p.toppings)    # ['cheese', 'tomato', 'basil']

# Using static method
print(Pizza.is_valid_size("small"))    # True
print(Pizza.is_valid_size("huge"))     # False
```

- `@classmethod`: receives the class (`cls`) as first argument. Used for alternative constructors.
- `@staticmethod`: receives nothing special. Just a function namespaced inside the class.

### Why `cls` (not `Pizza`) in a classmethod — the inheritance reason

Using `cls` instead of hard-coding `Pizza` means the alternative constructor **still works for subclasses**:

```python
class DeepDish(Pizza):
    pass

d = DeepDish.margherita("large")
print(type(d).__name__)    # DeepDish   -- cls was DeepDish, so we built a DeepDish
```

Had `margherita` written `return Pizza(...)`, `DeepDish.margherita("large")` would wrongly produce a plain `Pizza`. This is the whole point of `classmethod` over `staticmethod` for factory methods.

### Choosing between the three method kinds

| You need... | Use | First arg |
|---|---|---|
| Per-instance data (`self.x`) | regular method | `self` |
| The class itself (factories, registries, "count of all instances") | `@classmethod` | `cls` |
| A utility logically grouped with the class but using neither instance nor class | `@staticmethod` | none |

**When NOT to use `@staticmethod`:** if the function never touches the class conceptually, it's often clearer as a plain module-level function. Static methods are mainly for keeping a helper *namespaced* with its class.

---

## Inheritance

A class can inherit from another, gaining its attributes and methods.

```python
class Animal:
    def __init__(self, name):
        self.name = name

    def eat(self):
        print(f"{self.name} is eating.")

class Dog(Animal):                  # Dog inherits from Animal
    def bark(self):
        print(f"{self.name} says woof!")

d = Dog("Rex")
d.eat()      # Rex is eating.   (inherited from Animal)
d.bark()     # Rex says woof!    (Dog's own method)
```

### Override methods

```python
class Cat(Animal):
    def eat(self):
        print(f"{self.name} eats elegantly.")

c = Cat("Whiskers")
c.eat()    # Whiskers eats elegantly.
```

### Call parent's method via `super()`

```python
class Cat(Animal):
    def __init__(self, name, color):
        super().__init__(name)         # call Animal's __init__
        self.color = color

c = Cat("Whiskers", "black")
print(c.name, c.color)    # Whiskers black
```

### Extending (not just replacing) a parent method with `super()`

`super()` is also how you *add to* parent behavior instead of throwing it away:

```python
class LoudCat(Animal):
    def eat(self):
        super().eat()                 # do the normal thing first
        print(f"{self.name} burps loudly.")

LoudCat("Tom").eat()
# Tom is eating.
# Tom burps loudly.
```

### `isinstance` and `issubclass`

```python
d = Dog("Rex")
print(isinstance(d, Dog))      # True
print(isinstance(d, Animal))   # True   -- a Dog is-an Animal
print(isinstance(d, Cat))      # False
print(issubclass(Dog, Animal)) # True
```

> **Idiom:** prefer `isinstance(x, Animal)` over `type(x) == Animal`. `isinstance` respects subclasses (a `Dog` counts as an `Animal`); `type(x) == Animal` would reject the `Dog`. It also accepts a tuple: `isinstance(x, (int, float))`.

### MRO and `super()` — the technical detail

When a class has multiple parents, Python computes a **Method Resolution Order** (a linearized list of classes) to decide which method wins. `super()` follows the MRO, not just "the parent." You can inspect it:

```python
print(Dog.__mro__)
# (<class 'Dog'>, <class 'Animal'>, <class 'object'>)
```

Every class ultimately inherits from `object` — that's where the default `__str__`, `__eq__`, etc. come from. You rarely need multiple inheritance early on; just know `super()` is "the next class in the MRO," which is why it composes correctly even in diamond-shaped hierarchies.

### Inheritance is powerful, use sparingly

OOP guidelines (more in `Foundations/OOP/` later):
- Use inheritance for "is-a" relationships (Dog is-a Animal).
- Don't inherit just to reuse code. Composition is often better.
- Deep hierarchies (4+ levels) usually mean trouble.

#### "is-a" vs "has-a" — composition over inheritance

A `Car` is **not** an `Engine` — it **has** an engine. Modeling that with inheritance is a classic mistake:

```python
# WRONG: a Car is not a kind of Engine
class Engine:
    def start(self): print("vroom")

class Car(Engine):     # "is-a" lie
    pass

# RIGHT: a Car HAS an Engine (composition)
class Engine:
    def start(self): print("vroom")

class Car:
    def __init__(self):
        self.engine = Engine()     # composition
    def start(self):
        self.engine.start()

Car().start()    # vroom
```

**Reviewer's rule:** say the relationship out loud. "A `Dog` is-a `Animal`" sounds right → inheritance. "A `Car` is-a `Engine`" sounds wrong → composition.

---

## Encapsulation — hiding internals

By convention, attributes starting with `_` are "private" (Python doesn't enforce, but tools and developers respect it):

```python
class Account:
    def __init__(self, balance):
        self._balance = balance        # private by convention

    def deposit(self, amount):
        self._balance += amount

    def get_balance(self):
        return self._balance

a = Account(100)
a.deposit(50)
print(a.get_balance())    # 150
print(a._balance)         # works, but you shouldn't use _balance directly
```

Two underscores `__name` triggers **name mangling** — Python prefixes the class name. Avoid unless you really know why.

### Seeing name mangling in action

```python
class Account:
    def __init__(self):
        self.__pin = 1234          # becomes _Account__pin

a = Account()
print(a.__pin)        # AttributeError: 'Account' object has no attribute '__pin'
print(a._Account__pin)  # 1234   -- mangled name still reachable
```

Name mangling exists to prevent **accidental name clashes between a class and its subclasses**, *not* to provide real security — the data is still reachable (`_Account__pin`). Use a single `_` for "internal, please don't touch" and reserve `__` for the rare case where a subclass might define an attribute with the same name.

**Takeaway:** Python's privacy is "we're all adults here" — a convention enforced by discipline and linters, not the interpreter.

---

## Properties — controlled attribute access

Sometimes you want validation when an attribute is set. Use `@property`:

```python
class Temperature:
    def __init__(self, celsius):
        self._celsius = celsius

    @property
    def celsius(self):
        return self._celsius

    @celsius.setter
    def celsius(self, value):
        if value < -273.15:
            raise ValueError("Below absolute zero!")
        self._celsius = value

    @property
    def fahrenheit(self):
        return self._celsius * 9 / 5 + 32

t = Temperature(25)
print(t.celsius)        # 25
print(t.fahrenheit)     # 77.0

t.celsius = 100         # uses setter
print(t.fahrenheit)     # 212.0

t.celsius = -300        # ValueError
```

The user writes `t.celsius = X` like it's a regular attribute, but the setter validates.

### Why properties beat `get_x()` / `set_x()` — and when to add them

In many languages you'd write `get_celsius()` / `set_celsius()` from day one "just in case." In Python you **don't**: start with a plain attribute (`self.celsius = celsius`), and only *upgrade* to a property if/when you need validation or a computed value. The call site never changes — `t.celsius` works whether it's a plain attribute or a property. This is the famous "uniform access principle," and it's why Python style says **don't write getters/setters preemptively**.

```python
# Day 1: plain attribute, no ceremony
class Temperature:
    def __init__(self, celsius):
        self.celsius = celsius

# Later: needs validation. Callers' code (t.celsius = 5) is UNCHANGED.
class Temperature:
    def __init__(self, celsius):
        self.celsius = celsius          # this now runs through the setter
    @property
    def celsius(self):
        return self._celsius
    @celsius.setter
    def celsius(self, value):
        if value < -273.15:
            raise ValueError("Below absolute zero!")
        self._celsius = value
```

> **Read-only property (no setter):** omit the setter and the attribute becomes read-only — assigning raises `AttributeError`. Great for derived values like `fahrenheit` above, which intentionally has no setter.

**When NOT to use a property:** if the getter does heavy work (a network call, a slow computation), a property is misleading — `t.celsius` *looks* free. Use an explicit method like `t.fetch_temperature()` so the cost is visible.

---

## `__slots__` — optional memory/speed optimization

By default every instance stores attributes in a per-instance `__dict__`, which is flexible (you can add any attribute) but uses extra memory. For classes you'll create in huge numbers, `__slots__` declares a fixed set of attributes and skips the dict:

```python
class PointSlim:
    __slots__ = ("x", "y")      # no per-instance __dict__
    def __init__(self, x, y):
        self.x = x
        self.y = y

p = PointSlim(3, 4)
print(p.x)          # 3
p.z = 5             # AttributeError: 'PointSlim' object has no attribute 'z'
```

Trade-offs: lower memory and slightly faster attribute access, but you **can't add new attributes** at runtime and it complicates multiple inheritance. Don't reach for it until profiling shows millions of instances matter. `@dataclass(slots=True)` (3.10+) gives the same benefit with less typing.

**Takeaway:** `__slots__` is a niche optimization, not a default — most classes should keep their flexible `__dict__`.

---

## Common mistakes

**1. Forgetting `self` in method calls.**
```python
class Counter:
    def increment():       # missing self!
        self.value += 1
```
Fix:
```python
class Counter:
    def increment(self):   # self restored
        self.value += 1
```
Calling `Counter().increment()` without `self` raises `TypeError: increment() takes 0 positional arguments but 1 was given` — Python tried to pass the instance and there was no parameter to receive it.

**2. Forgetting `__init__`.**
```python
class Account:
    balance = 100      # this is a CLASS attribute, shared!

a1 = Account()
a2 = Account()
a1.balance += 50
print(a2.balance)    # 100 -- but write/read is confusing
```

Always set instance attributes in `__init__`.

**3. Mutable class attributes (covered earlier).**

**4. Using `==` to test for None — works but `is None` is preferred.**
```python
if x is None:    # preferred
if x == None:    # works but discouraged
```
`is` checks identity (there is exactly one `None` object), which is faster and can't be fooled by a class that overrides `__eq__` to return True for everything.

**5. Not calling `super().__init__()`.**
```python
class Cat(Animal):
    def __init__(self, name, color):
        self.color = color    # forgot super().__init__(name)
        # now self.name doesn't exist!
```
Fix: call the parent initializer first, then add your own fields:
```python
class Cat(Animal):
    def __init__(self, name, color):
        super().__init__(name)
        self.color = color
```

**6. Mutable default *arguments* in `__init__` (cousin of mistake 3).**
```python
class Basket:
    def __init__(self, items=[]):     # BUG: one shared list across all baskets
        self.items = items

b1 = Basket(); b2 = Basket()
b1.items.append("egg")
print(b2.items)    # ['egg']   -- surprise!
```
Fix — use `None` as the sentinel and build a fresh list inside:
```python
class Basket:
    def __init__(self, items=None):
        self.items = items if items is not None else []
```

**7. Comparing objects with `==` and expecting value equality without `__eq__`.**
```python
class P:
    def __init__(self, x): self.x = x

print(P(1) == P(1))    # False -- default __eq__ is identity
```
Fix: define `__eq__` (and `__hash__`), or use `@dataclass`.

**8. Shadowing a method with an instance attribute.**
```python
class Dog:
    def name(self):
        return "Rex"

d = Dog()
d.name = "Buddy"      # instance attr now shadows the method
print(d.name())       # TypeError: 'str' object is not callable
```
Keep attribute names and method names distinct.

---

## Cross-questions an interviewer or reviewer will ask

**Q: What's the difference between a class and an instance?**
A class is the template (defined once, with `class`); an instance is a concrete object built by calling the class. The class lives in memory once; you can make unlimited instances, each with its own attribute values.

**Q: Why does every method take `self`? Can I rename it?**
`self` is the instance the method is invoked on; `obj.m()` is `type(obj).m(obj)`, so the instance must be received as the first parameter. You *can* rename it, but `self` is universal convention — renaming it will confuse every reader and linter.

**Q: `__init__` vs `__new__` — which is the constructor?**
`__new__` actually creates and returns the new (empty) object; `__init__` only initializes it and must return `None`. You override `__init__` ~always and `__new__` almost never (mainly for immutable types or metaclass tricks).

**Q: `@classmethod` vs `@staticmethod` vs regular method?**
Regular methods get the instance (`self`); classmethods get the class (`cls`) and are ideal for alternative constructors that should respect subclasses; staticmethods get neither and are just namespaced helpers.

**Q: Why `__repr__` *and* `__str__`? Which should I implement if only one?**
`__str__` is the friendly view for end users (`print`); `__repr__` is the unambiguous developer view (REPL, logs, container display). If you implement only one, implement `__repr__` — `str()` falls back to it.

**Q: I defined `__eq__` and now my objects can't go in a set. Why?**
Defining `__eq__` sets `__hash__` to `None`, making instances unhashable. Either add a `__hash__` based on the same fields, or make the class a `frozen=True` dataclass.

**Q: When do I use inheritance vs composition?**
Inheritance for genuine "is-a" relationships where the subtype can stand in for the base type. Composition ("has-a") when you just want to *reuse* another class's functionality — it's more flexible and avoids brittle deep hierarchies.

**Q: Are `_x` and `__x` really private?**
No. `_x` is a *convention* meaning "internal." `__x` triggers name mangling (`_Class__x`) to avoid subclass clashes, but the data is still reachable. Python has no truly private attributes.

**Q: Why prefer `is None` over `== None`?**
`None` is a singleton; identity (`is`) is the correct, faster, and safer test — `==` could be overridden by a malicious or buggy `__eq__`.

**Q: Why not just write getters/setters everywhere like in Java?**
Python's `@property` lets you start with a plain attribute and add validation later without changing any call site (uniform access). Writing getters/setters up front is un-Pythonic boilerplate.

**Q: What does `@dataclass` actually generate?**
By default `__init__`, `__repr__`, and `__eq__` based on the annotated fields. With options it can also add ordering dunders (`order=True`), immutability + hashing (`frozen=True`), and `__slots__` (`slots=True`, 3.10+).

---

## Exercises

1. **`Rectangle`**: class with `width`, `height`. Methods: `area()`, `perimeter()`, `is_square()`.
2. **`BankAccount` with overdraft**: `deposit`, `withdraw`. Allow withdrawal up to `overdraft_limit` (passed in constructor) below zero.
3. **`Stack`** using a list: `push`, `pop`, `peek`, `is_empty`. Use `__len__`.
4. **`Vector` (2D)**: with `x`, `y`. Implement `__add__`, `__sub__`, `__eq__`, `__repr__`. Method `magnitude()`.
5. **`Person` with property** for `email`. Setter validates that email contains `@`.
6. **`Shape` hierarchy**: base `Shape` with `area()` (abstract). Subclasses: `Circle`, `Square`, `Triangle`. Each computes area.
7. **`Temperature` round-trip**: extend the property example so you can also set `fahrenheit` (and have it update `_celsius`). Verify `t.fahrenheit = 212` makes `t.celsius == 100`.
8. **`Money` value object**: a `frozen=True` dataclass with `amount` and `currency`; confirm two equal `Money` objects share a hash and dedupe in a `set`.
9. **`InstanceCounter`**: a class that tracks how many instances have been created, using a class attribute incremented in `__init__` and exposed via a `@classmethod` `count()`.

### Hint for #6

```python
import math
from abc import ABC, abstractmethod

class Shape(ABC):
    @abstractmethod
    def area(self) -> float: ...

class Circle(Shape):
    def __init__(self, radius):
        self.radius = radius
    def area(self):
        return math.pi * self.radius ** 2

class Square(Shape):
    def __init__(self, side):
        self.side = side
    def area(self):
        return self.side ** 2

shapes = [Circle(5), Square(4)]
for s in shapes:
    print(s.area())
```

`ABC` (abstract base class) ensures subclasses implement `area`. If you try to instantiate `Shape()` directly, or a subclass that forgot to implement `area`, Python raises `TypeError: Can't instantiate abstract class ...` — the error happens at construction, catching the mistake early.

### Hint for #9

```python
class InstanceCounter:
    _count = 0                       # class attribute, shared

    def __init__(self):
        type(self)._count += 1       # increment the class's counter

    @classmethod
    def count(cls):
        return cls._count

InstanceCounter(); InstanceCounter()
print(InstanceCounter.count())    # 2
```

---

## What to read next

- **Doc 07 — Error handling:** try/except and how to write robust programs. Pairs naturally with classes (custom exception classes are just classes that inherit from `Exception`).

```
→ Foundations/Programming/Python/07-error-handling.md
```

- **Iterators & generators** (`05-collections.md` recap + advanced): you saw `__iter__`/`yield` here; that doc goes deeper on lazy iteration.

- **The four pillars of OOP** — encapsulation, abstraction, inheritance, polymorphism — formalized with design guidance:

```
→ Foundations/OOP/four-pillars.md
```

- **Python docs to bookmark:** the [Data model](https://docs.python.org/3/reference/datamodel.html) reference (every dunder), the [`dataclasses`](https://docs.python.org/3/library/dataclasses.html) module, and [PEP 8](https://peps.python.org/pep-0008/) for naming.

After that, you'll know enough to read the OOP and design pattern docs.

```
→ Foundations/OOP/four-pillars.md
```

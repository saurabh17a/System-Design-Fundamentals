# 12 — Generics, Typing, and Iterators

> **Prerequisites:** `11-stdlib-tour.md`. Type hints from doc 04.
> **Time to read:** 30 minutes.

This doc covers three related topics that beginner Python tutorials often skip:

1. **Generics** — code that works with many types, type-safely.
2. **Advanced typing** — `Protocol`, `TypeVar`, `Optional`, `Literal`, etc.
3. **Iterators and generators** — Python's lazy evaluation engine, the secret behind `for` loops.

You don't need these on day 1. But to read library code (and the LLD/MC docs in this bank), you'll meet them constantly.

---

## Type hints — quick recap

From doc 04:

```python
def add(a: int, b: int) -> int:
    return a + b

name: str = "Alice"
count: int = 0
```

Hints are **optional** — Python doesn't enforce them at runtime. They're for IDE autocomplete, documentation, and tools like `mypy`.

---

## Common types from `typing`

Modern Python (3.9+) supports built-in generics:

```python
nums: list[int] = [1, 2, 3]
mapping: dict[str, int] = {"a": 1}
pair: tuple[int, str] = (1, "one")
```

Older Python or older code uses `typing`:

```python
from typing import List, Dict, Tuple, Optional, Union

nums: List[int] = [1, 2, 3]
```

Both work. Built-ins are preferred in 3.9+.

### `Optional` and `Union`

```python
from typing import Optional

def find_user(id: int) -> Optional[str]:
    """Returns name or None."""
    if id == 1:
        return "Alice"
    return None
```

`Optional[X]` = `X | None`. In 3.10+ you can write:

```python
def find_user(id: int) -> str | None:    # nicer
    ...
```

`Union` for "this OR that":

```python
def parse(x: int | str) -> int:
    if isinstance(x, str):
        return int(x)
    return x
```

### `Any` — escape hatch

```python
from typing import Any

def loose(x: Any) -> Any:
    ...    # type checker says "OK whatever"
```

Use sparingly — if everything is `Any`, you've turned off type checking.

### `Literal` — exact values

```python
from typing import Literal

def fetch(method: Literal["GET", "POST", "PUT"], url: str): ...

fetch("GET", "...")     # OK
fetch("DELETE", "...")  # type error: "DELETE" not in Literal
```

Great for fixed sets of strings/ints.

### `Final` and `ClassVar`

```python
from typing import Final, ClassVar

PI: Final = 3.14159    # can't reassign

class Counter:
    instances: ClassVar[int] = 0    # class attribute, not instance
```

---

## Generics — `TypeVar`

Suppose you write:

```python
def first(items: list) -> ?:
    return items[0]
```

What's the return type? Whatever's in the list. That's a **generic** — it depends on the input.

```python
from typing import TypeVar

T = TypeVar("T")

def first(items: list[T]) -> T:
    return items[0]


nums = [1, 2, 3]
n = first(nums)              # type checker knows this is int

names = ["Alice", "Bob"]
s = first(names)             # str
```

`T` is a placeholder. The checker sees `list[int]` going in, infers `T = int`, returns `int`.

### Constraining a TypeVar

```python
from typing import TypeVar

# Only accepts int or float
Number = TypeVar("Number", int, float)

def double(x: Number) -> Number:
    return x + x

double(5)          # OK
double(2.5)        # OK
double("hi")       # type error
```

### Bounded TypeVar

```python
class Animal: ...
class Dog(Animal): ...
class Cat(Animal): ...

# Accepts Animal or any subclass
A = TypeVar("A", bound=Animal)

def describe(a: A) -> A:
    return a
```

---

## Generic classes

```python
from typing import Generic, TypeVar

T = TypeVar("T")

class Stack(Generic[T]):
    def __init__(self):
        self._items: list[T] = []

    def push(self, item: T) -> None:
        self._items.append(item)

    def pop(self) -> T:
        return self._items.pop()


s: Stack[int] = Stack()
s.push(1)
s.push(2)
n = s.pop()        # type: int

names: Stack[str] = Stack()
names.push("hello")
```

Without `Generic[T]`, the class wouldn't know that `pop()` should return whatever `push()` accepted.

In Python 3.12+, simpler syntax:

```python
class Stack[T]:        # built-in generic syntax
    def __init__(self):
        self._items: list[T] = []
    ...
```

---

## `Protocol` — structural typing

Sometimes you want "anything that has these methods" — duck typing with type-checker support.

```python
from typing import Protocol

class Speaker(Protocol):
    def speak(self) -> str: ...

class Dog:
    def speak(self) -> str: return "Woof"

class Cat:
    def speak(self) -> str: return "Meow"


def announce(s: Speaker):
    print(s.speak())

announce(Dog())     # OK — Dog has speak()
announce(Cat())     # OK
```

Notice `Dog` and `Cat` don't inherit from `Speaker`. They just *have the methods*. This is structural / duck typing — like Go's interfaces.

Compare to ABC (abstract base class):

```python
from abc import ABC, abstractmethod

class Speaker(ABC):    # nominal — must inherit
    @abstractmethod
    def speak(self) -> str: ...

class Dog(Speaker):    # MUST inherit
    def speak(self): return "Woof"
```

Both work. Protocols are looser (any matching shape) and don't require the producer to know about the protocol. Useful when you can't modify the class (e.g., a 3rd-party library).

---

## Type narrowing with `isinstance`

```python
def process(x: int | str) -> int:
    if isinstance(x, str):
        return int(x)         # type checker now knows x is str
    return x * 2              # here x is int
```

The type checker "narrows" `x` based on the `isinstance` check. Same with `is None`:

```python
def maybe(x: int | None) -> int:
    if x is None:
        return 0
    return x + 1              # x narrowed to int
```

---

## Iterators — what `for` actually does

```python
for item in [1, 2, 3]:
    print(item)
```

Under the hood, this is:

```python
it = iter([1, 2, 3])         # get an iterator
while True:
    try:
        item = next(it)      # get next value
    except StopIteration:
        break
    print(item)
```

Anything that supports `iter()` and returns an object with `__next__()` is iterable.

### Build your own iterator

```python
class Countdown:
    def __init__(self, n):
        self.n = n

    def __iter__(self):
        return self

    def __next__(self):
        if self.n <= 0:
            raise StopIteration
        self.n -= 1
        return self.n + 1


for x in Countdown(3):
    print(x)
# 3
# 2
# 1
```

---

## Generators — iterators with less code

A function with `yield` is a **generator** — it produces values lazily:

```python
def countdown(n):
    while n > 0:
        yield n
        n -= 1

for x in countdown(3):
    print(x)
# 3, 2, 1
```

Way shorter than the iterator class. Each `yield` pauses the function and gives a value; the next `next()` call resumes from there.

### Generator vs list

```python
def squares(n):
    return [i*i for i in range(n)]    # builds the whole list

def squares_gen(n):
    for i in range(n):
        yield i*i                      # one at a time

# Memory:
squares(1_000_000)        # 1M ints in memory
squares_gen(1_000_000)    # tiny — values are computed on demand

# Both work the same in a for loop
for s in squares_gen(5):
    print(s)
```

Use generators when the sequence is huge or infinite, or you only need one pass.

### Generator expressions

Like list comprehensions but lazy:

```python
total = sum(i*i for i in range(1_000_000))    # no list built
nums = (x for x in big_data if x > 0)         # generator
```

Note the parens instead of brackets.

### Sending and receiving

Generators can also receive values via `send()`, but this is rare in practice — used heavily in old-style coroutines (now `async`/`await` is preferred).

---

## Iterating in chunks

```python
def chunks(it, n):
    """Yield n-sized chunks from iterator."""
    chunk = []
    for item in it:
        chunk.append(item)
        if len(chunk) == n:
            yield chunk
            chunk = []
    if chunk:
        yield chunk

for batch in chunks(range(10), 3):
    print(batch)
# [0, 1, 2]
# [3, 4, 5]
# [6, 7, 8]
# [9]
```

Useful for batching API requests, DB inserts, etc.

---

## Lazy file processing

```python
def grep(pattern, path):
    """Yield matching lines."""
    with open(path) as f:
        for line in f:
            if pattern in line:
                yield line.strip()

for hit in grep("ERROR", "huge.log"):
    print(hit)
```

Memory: a few KB at most, even for a 100GB log file.

---

## `itertools` recap

Most `itertools` functions return iterators. They compose:

```python
from itertools import islice, count

# First 5 even squares of natural numbers
result = (i*i for i in count(1) if i % 2 == 0)
print(list(islice(result, 5)))    # [4, 16, 36, 64, 100]
```

`count(1)` is infinite. `islice(it, 5)` takes the first 5. Without lazy iterators, `count()` would hang trying to build a list.

---

## Worked example — generic LRU cache

A type-safe LRU using TypeVars:

```python
from collections import OrderedDict
from typing import Generic, TypeVar

K = TypeVar("K")
V = TypeVar("V")

class LRUCache(Generic[K, V]):
    def __init__(self, capacity: int):
        self.capacity = capacity
        self._data: OrderedDict[K, V] = OrderedDict()

    def get(self, key: K) -> V | None:
        if key not in self._data:
            return None
        self._data.move_to_end(key)
        return self._data[key]

    def put(self, key: K, value: V) -> None:
        if key in self._data:
            self._data.move_to_end(key)
        else:
            if len(self._data) >= self.capacity:
                self._data.popitem(last=False)
        self._data[key] = value


cache: LRUCache[int, str] = LRUCache(2)
cache.put(1, "one")
cache.put(2, "two")
print(cache.get(1))    # "one" — type checker knows this is str | None
```

The cache is fully type-aware; `LRUCache[int, str]` and `LRUCache[str, dict]` are different types as far as the checker is concerned.

---

## Common mistakes

### 1. `T` without `Generic[T]`

```python
T = TypeVar("T")

class Box:
    def __init__(self, val: T):    # T is unbound here
        self.val = val
```

The type checker won't infer correctly. Inherit from `Generic[T]`:

```python
class Box(Generic[T]):
    def __init__(self, val: T):
        self.val = val
```

### 2. Using `Any` everywhere

```python
def my_function(data: Any) -> Any:
    ...
```

Equivalent to no types. Be specific.

### 3. Modifying a generator twice

```python
g = (x*2 for x in range(5))
list(g)    # [0, 2, 4, 6, 8]
list(g)    # [] — generator is exhausted
```

Generators are one-shot. If you need to iterate twice, make a list — or call the generator function again.

### 4. Confusing `Iterator` and `Iterable`

- **Iterable**: anything you can `for x in` (lists, sets, generators, files).
- **Iterator**: the thing returned by `iter()` — has `__next__()`.

A list is iterable but not an iterator. A generator is both.

```python
my_list = [1, 2, 3]
next(my_list)         # ERROR — not an iterator
it = iter(my_list)
next(it)              # 1
```

### 5. Type hints lying to you

Type hints aren't enforced at runtime. This compiles and runs:

```python
def add(a: int, b: int) -> int:
    return a + b

add("hello", "world")    # returns "helloworld" — runs!
```

A type checker (`mypy`) would catch it. Run `mypy myfile.py` periodically.

---

## Exercises

1. **Generic stack.** Build `Stack[T]` with `push`, `pop`, `peek`, `size`. Use it for `Stack[int]` and `Stack[str]`.
2. **Lazy fibonacci.** Write `fib_gen()` that yields fibonacci numbers forever. Use `islice` to take the first 20.
3. **Filter generator.** Write `take_while(predicate, iterable)` that yields items while `predicate(item)` is true, then stops.
4. **Protocol example.** Define `Comparable` protocol with `__lt__`. Write `find_max(items)` that takes any iterable of `Comparable` and returns the largest.

### Hint for #2

```python
from itertools import islice

def fib_gen():
    a, b = 0, 1
    while True:
        yield a
        a, b = b, a + b

print(list(islice(fib_gen(), 20)))
```

---

## What's next

You've finished the Python Foundations track! 12 docs covering everything from "Hello, World" to generics.

Where to next:
- **Concepts**: `Foundations/OOP/four-pillars.md` and the SOLID/Patterns docs.
- **Apply it**: `LLD/Python/parking-lot.md` uses much of this.
- **Cross-train**: read the equivalent Go docs.

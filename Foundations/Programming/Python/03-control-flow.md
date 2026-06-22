# 03 — Control Flow

> **Prerequisites:** `02-data-types.md`.
> **Time to read:** 25 minutes.

**Control flow** = how your program decides what to do next. Without it, programs run line-by-line top-to-bottom. With it, they branch and loop.

### Plain-English version (read this first)

Imagine you're following a recipe. Most of the time you do steps in order: chop, mix, bake. But sometimes the recipe says "*if* the batter is too thick, add a splash of milk" — that's a **branch**. And sometimes it says "stir *until* smooth" — that's a **loop** (keep doing the same thing while a condition holds). Control flow is just those two ideas: **branching** (choose between paths) and **looping** (repeat a path). Everything in this doc is a variation on those two.

### Precise version

Python programs execute statements sequentially unless a **control-flow statement** redirects execution. There are three categories:

1. **Conditional branching** — `if` / `elif` / `else`, the conditional (ternary) expression, and `match` (structural pattern matching, 3.10+). These choose *which* block runs based on a boolean test.
2. **Iteration** — `for` (iterate over an iterable) and `while` (repeat while a condition is truthy). These choose *how many times* a block runs.
3. **Loop control** — `break`, `continue`, and the loop `else` clause modify the normal iteration sequence.

A key Python-specific detail: **blocks are defined by indentation**, not braces. The colon (`:`) ends the header line; the indented lines below it form the block. By convention the indent is **4 spaces** (never mix tabs and spaces — Python 3 raises `TabError`).

```python
if True:
    print("indented 4 spaces -> this is the body")
print("not indented -> outside the if")
# indented 4 spaces -> this is the body
# not indented -> outside the if
```

**Takeaway:** colon + indentation = a block; the indentation level *is* the syntax.

---

## `if` / `elif` / `else`

The `if` statement runs code only when a condition is true.

```python
age = 18

if age >= 18:
    print("You can vote.")
```

If the condition is false, the indented block is skipped.

### Two-way branching: `else`

```python
age = 16

if age >= 18:
    print("You can vote.")
else:
    print("Too young to vote.")
```

### Multiple cases: `elif`

```python
score = 75

if score >= 90:
    print("A")
elif score >= 80:
    print("B")
elif score >= 70:
    print("C")
elif score >= 60:
    print("D")
else:
    print("F")
```

Python tries each `if`/`elif` in order. The **first** match runs and the rest are skipped.

> **Why order matters here:** the conditions overlap. A score of 95 satisfies `>= 90`, `>= 80`, `>= 70`, and `>= 60` — *all four* are true. Because Python stops at the first match, you must list the **strictest** condition first. Reverse the order (check `>= 60` first) and *every* passing student gets a "D".

### Nested ifs

```python
age = 20
has_id = True

if age >= 18:
    if has_id:
        print("Welcome to the bar.")
    else:
        print("ID required.")
else:
    print("Too young.")
```

### Simplification: combine with `and` / `or`

```python
if age >= 18 and has_id:
    print("Welcome to the bar.")
elif age >= 18 and not has_id:
    print("ID required.")
else:
    print("Too young.")
```

### Truthiness: what counts as "true"?

`if` doesn't require an actual `True`/`False`. It evaluates the **truthiness** of any object. These values are **falsy** (treated as false): `False`, `None`, `0`, `0.0`, `0j`, `""` (empty string), `[]`, `()`, `{}`, `set()`, and `range(0)`. Almost everything else is **truthy**.

```python
name = ""
if name:
    print(f"Hello, {name}")
else:
    print("No name given")     # printed -- "" is falsy
```

**Takeaway:** `if items:` is the idiomatic way to ask "is this non-empty?" — you rarely need `if len(items) > 0:`.

### Comparison chaining (a Python superpower)

Unlike most languages, Python lets you chain comparisons the way math does:

```python
x = 5
if 0 < x < 10:                 # reads like "0 < x AND x < 10"
    print("single digit positive")
# single digit positive

# Equivalent, more verbose:
if 0 < x and x < 10:
    print("single digit positive")
```

`0 < x < 10` evaluates `x` **once** and is exactly `(0 < x) and (x < 10)`. This is clearer and avoids re-typing `x`.

**Takeaway:** prefer `low <= x <= high` over the two-condition `and` form.

### The ternary operator (one-line if)

```python
status = "adult" if age >= 18 else "minor"
print(status)
```

Read as: "status is 'adult' if age >= 18, else 'minor'."

Use sparingly. For complex logic, regular `if`/`else` is clearer.

> **Why does Python put the condition in the middle** (`value_if_true if cond else value_if_false`) instead of C's `cond ? a : b` ordering? Guido's stated reasoning is readability: the common case (the `if`-true value) reads first and left-to-right like English. The cost is that you can't tell it's a conditional until you hit the `if`, so deeply nested ternaries become unreadable — which is exactly why you should keep them to a single, simple choice.

### `and` / `or` return values, not just booleans

A subtle but important point: `and` and `or` **return one of their operands**, not necessarily `True`/`False`. They also **short-circuit** (stop evaluating as soon as the answer is known).

- `a and b` → returns `a` if `a` is falsy, otherwise returns `b`.
- `a or b` → returns `a` if `a` is truthy, otherwise returns `b`.

```python
print(0 and 99)        # 0   (left side falsy, returned immediately)
print(2 and 99)        # 99  (left side truthy, so result is the right side)
print("" or "default") # default
print("hi" or "default") # hi

# Idiom: supply a fallback for a possibly-empty value
username = input_name or "guest"
```

Short-circuiting also guards against errors:

```python
data = None
if data is not None and len(data) > 0:   # len(None) never runs
    print("non-empty")
```

If you wrote `len(data) > 0 and data is not None`, the `len(None)` would raise `TypeError` *before* the safety check — order matters with short-circuit guards.

**Takeaway:** `x or default` is a clean fallback idiom; put the cheap/safe check on the left of `and`.

### `is` vs `==` (a classic gotcha)

`==` asks "do these have the same **value**?" `is` asks "are these the **same object** in memory?" Use `is` only for singletons: `None`, `True`, `False`.

```python
a = [1, 2, 3]
b = [1, 2, 3]
print(a == b)   # True  -- same contents
print(a is b)   # False -- two different list objects

x = None
print(x is None)   # True  -- correct, idiomatic
print(x == None)   # True but discouraged; can be fooled by custom __eq__
```

**Takeaway:** always write `if x is None:`, never `if x == None:`.

---

## `match` (Python 3.10+)

For multiple discrete cases:

```python
status = "active"

match status:
    case "active":
        print("Account is active")
    case "suspended":
        print("Account suspended")
    case "deleted":
        print("Account gone")
    case _:                       # default
        print("Unknown status")
```

`_` is the wildcard. `match` is great when comparing one value against many possibilities.

### `match` is *structural* — it destructures, not just compares

`match` is far more than a `switch` statement. It can match the **shape** of data and bind variables in one step. This is its real power.

```python
def describe(point):
    match point:
        case (0, 0):
            return "origin"
        case (0, y):              # binds y
            return f"on the y-axis at {y}"
        case (x, 0):              # binds x
            return f"on the x-axis at {x}"
        case (x, y):
            return f"point ({x}, {y})"
        case _:
            return "not a 2D point"

print(describe((0, 0)))    # origin
print(describe((0, 5)))    # on the y-axis at 5
print(describe((3, 4)))    # point (3, 4)
print(describe("nope"))    # not a 2D point
```

You can also guard a case with `if`, match class shapes, and combine patterns with `|`:

```python
def http_message(code):
    match code:
        case 200 | 201 | 204:          # OR-pattern
            return "Success"
        case n if 400 <= n < 500:      # guard
            return "Client error"
        case n if 500 <= n < 600:
            return "Server error"
        case _:
            return "Other"

print(http_message(201))   # Success
print(http_message(404))   # Client error
print(http_message(503))   # Server error
```

### `match` gotcha: a bare name is a *capture*, not a comparison

This trips up everyone. A `case` with a plain variable name does **not** compare against that variable — it **always matches and rebinds** the name.

```python
RED = "red"
color = "blue"

match color:
    case RED:          # WRONG if you meant "compare to the RED constant"
        print("matched red")
    case _:
        print("other")
# Output: matched red   <-- RED got *overwritten* with "blue"!
```

The fix is to use a **dotted** name (an attribute), which Python treats as a value to compare:

```python
import enum

class Color(enum.Enum):
    RED = "red"
    BLUE = "blue"

color = Color.BLUE
match color:
    case Color.RED:        # dotted -> compared, not captured
        print("matched red")
    case Color.BLUE:
        print("matched blue")   # printed
```

**Takeaway:** in `match`, only *literals* and *dotted names* are compared; a bare lowercase name is a capture variable.

> **Why use `match` and not a chain of `if`/`elif`?** When you're testing *equality of one value against many literals*, `match` is more readable. When you're **destructuring** nested data (tuples, dataclasses, dicts), `match` replaces a pile of manual indexing/`isinstance` checks. When your branches test *unrelated* conditions (`if user.is_admin … elif file.exists() …`), keep `if`/`elif` — `match` only inspects one subject.

---

## `for` loops

Repeat code for each item in a sequence.

```python
for fruit in ["apple", "banana", "cherry"]:
    print(fruit)

# apple
# banana
# cherry
```

The loop variable (`fruit`) takes each value in turn.

> **What can you loop over?** Any **iterable**: lists, tuples, strings (character by character), sets, dict keys, files (line by line), generators, `range`, and more. A `for` loop calls `iter()` on the object to get an iterator, then repeatedly calls `next()` until `StopIteration` is raised. You don't see this machinery, but it's why the same `for x in ...` syntax works on everything.

```python
for char in "hi":
    print(char)
# h
# i
```

### Looping numbers: `range`

```python
for i in range(5):
    print(i)
# 0
# 1
# 2
# 3
# 4
```

`range(n)` produces 0, 1, ..., n-1. (Stops *before* n.)

```python
for i in range(1, 6):       # 1, 2, 3, 4, 5
    print(i)

for i in range(0, 20, 2):   # 0, 2, 4, ..., 18 (step of 2)
    print(i)

for i in range(10, 0, -1):  # 10, 9, 8, ..., 1 (countdown)
    print(i)
```

> **`range` is lazy.** `range(1_000_000)` does **not** build a million-element list — it stores only start, stop, and step, and computes each value on demand. So it costs the same tiny, constant amount of memory whether you loop to 5 or to a billion. (In Python 2, `range` *did* build a list and `xrange` was lazy; Python 3 merged them, so just use `range`.)

```python
import sys
print(sys.getsizeof(range(1_000_000)))   # 48  (bytes -- constant, tiny)
```

**Takeaway:** `range(start, stop, step)` — start is inclusive, stop is exclusive, step can be negative.

### Looping with index: `enumerate`

```python
for i, name in enumerate(["Alice", "Bob", "Carol"]):
    print(f"{i}: {name}")
# 0: Alice
# 1: Bob
# 2: Carol
```

`enumerate` also takes a `start` argument when you want 1-based numbering:

```python
for rank, name in enumerate(["Alice", "Bob"], start=1):
    print(f"{rank}. {name}")
# 1. Alice
# 2. Bob
```

> **Why not `for i in range(len(names)):` and then `names[i]`?** It works, but it's noisier, easy to get wrong (off-by-one, wrong list), and slower to read. `enumerate` is the idiom; reviewers will flag `range(len(...))` when you only needed the items (or items + index).

### Looping two lists together: `zip`

```python
names = ["Alice", "Bob"]
ages = [30, 25]

for name, age in zip(names, ages):
    print(f"{name} is {age}")
# Alice is 30
# Bob is 25
```

`zip` stops at the **shortest** input — extra items in the longer one are silently dropped:

```python
for a, b in zip([1, 2, 3], ["x", "y"]):
    print(a, b)
# 1 x
# 2 y          (the 3 is dropped)
```

If silently dropping is a bug for you, Python 3.10+ has `zip(..., strict=True)` which raises `ValueError` on length mismatch:

```python
list(zip([1, 2, 3], ["x", "y"], strict=True))   # ValueError: lengths differ
```

**Takeaway:** `zip` walks several iterables in lockstep; it truncates to the shortest unless you pass `strict=True`.

### Looping a dict

```python
person = {"name": "Alice", "age": 30, "city": "NY"}

for key in person:                # keys
    print(key)

for value in person.values():
    print(value)

for key, value in person.items():
    print(f"{key} = {value}")
```

> **Order:** since Python 3.7, dicts iterate in **insertion order** (this is a language guarantee, not an implementation accident). So the loops above print keys in the order `name`, `age`, `city`.

### Unpacking in the loop header

The `for name, age in ...` and `for k, v in items()` forms above are **tuple unpacking** applied to each element. You can unpack deeper structures too:

```python
points = [(1, 2), (3, 4), (5, 6)]
for x, y in points:
    print(x + y)
# 3
# 7
# 11

# Star-unpacking grabs "the rest"
records = [("Alice", 90, 85, 95), ("Bob", 70, 75, 80)]
for name, *scores in records:
    print(name, sum(scores) / len(scores))
# Alice 90.0
# Bob 75.0
```

**Takeaway:** unpack right in the `for` header instead of indexing inside the loop body.

---

## `while` loops

Repeat as long as a condition is true.

```python
count = 0

while count < 5:
    print(count)
    count += 1
```

Use `while` when you don't know in advance how many iterations.

> **`for` vs `while` — which one?** Use `for` when you're iterating over a *collection* or a *known count* of steps (most loops). Use `while` when continuation depends on a *condition that changes at runtime*: reading until end-of-input, polling until a server responds, retrying until success, game loops. Rule of thumb: if you find yourself manually maintaining an index counter in a `while`, a `for` with `range`/`enumerate` is probably cleaner.

### Common pattern: input until valid

```python
while True:
    pin = input("Enter PIN: ")
    if pin.isdigit() and len(pin) == 4:
        break
    print("Try again — must be 4 digits.")

print("Welcome!")
```

`break` exits the loop immediately.

> **`while True` + `break` is idiomatic**, not a smell, for "loop forever until some mid-loop condition." It's clearer than trying to cram the exit test into the `while` header when the natural place to check it is *after* you've read the input.

### `while` with `else`

Like `for`, a `while` loop can have an `else` that runs only if the loop ended *without* `break` (i.e. the condition became false naturally):

```python
attempts = 3
while attempts > 0:
    guess = "wrong"            # pretend this is user input
    if guess == "secret":
        print("Unlocked!")
        break
    attempts -= 1
else:
    print("Account locked.")   # runs because we never broke out
# Account locked.
```

**Takeaway:** `while ... else` is the "we exhausted all tries without success" hook.

---

## `break` and `continue`

```python
for i in range(10):
    if i == 5:
        break       # exit loop entirely
    print(i)
# Output: 0 1 2 3 4

for i in range(10):
    if i % 2 == 0:
        continue    # skip rest of this iteration; go to next
    print(i)
# Output: 1 3 5 7 9
```

Use `break` to stop early. Use `continue` to skip an iteration.

### `break` only exits ONE loop

A very common surprise: in nested loops, `break` exits only the **innermost** loop it's in.

```python
for i in range(3):
    for j in range(3):
        if j == 1:
            break          # breaks the j-loop only
        print(i, j)
# 0 0
# 1 0
# 2 0     <-- outer loop keeps going
```

Python has **no** labelled `break` (unlike Java). To break out of *both* loops, the cleanest fix is to move the loops into a function and `return`, or use a flag:

```python
def find_pair(grid, target):
    for row in grid:
        for value in row:
            if value == target:
                return True    # exits BOTH loops at once
    return False

print(find_pair([[1, 2], [3, 4]], 3))   # True
```

**Takeaway:** to escape nested loops, prefer a function + `return` over flags.

### `continue` skips to the next iteration of its own loop

`continue` is often used as a "guard clause" to flatten deeply-nested bodies:

```python
# Nested (harder to read)
for user in users:
    if user.is_active:
        if user.email:
            send(user)

# Flat with continue (often clearer)
for user in users:
    if not user.is_active:
        continue
    if not user.email:
        continue
    send(user)
```

> **When NOT to use `break`/`continue`:** if a simple loop condition or comprehension expresses the same logic clearly, prefer that. Sprinkling many `continue`s and `break`s through a long loop can hide the actual flow. They shine for *early exit* and *guard clauses*, not as a substitute for thinking about the loop's shape.

---

## `else` on loops (rare but useful)

`else` runs after a loop **if it didn't `break`**.

```python
for n in [1, 2, 3, 4, 5]:
    if n == 6:
        print("Found 6!")
        break
else:
    print("6 not in list")    # this runs if break didn't fire
# Output: 6 not in list
```

Useful for "search for X; do something if not found".

> **Why is it called `else`?** Honestly, the name is widely considered a wart — most people misread it as "else if the loop body didn't run." A more accurate mental model is `nobreak:`. Read loop `else` as **"if we finished the loop without breaking out."** Because it's so easily misread, many teams prefer the function + `return` pattern (below) for searches, reserving loop `else` for cases where it genuinely reads cleanly.

The same search expressed without loop `else`:

```python
def contains(seq, target):
    for n in seq:
        if n == target:
            return True
    return False     # only reached if the loop completed without returning

print(contains([1, 2, 3, 4, 5], 6))   # False
```

---

## List comprehensions (a Python superpower)

Build a new list by transforming each item.

```python
# Old way
squares = []
for n in range(1, 6):
    squares.append(n * n)
# [1, 4, 9, 16, 25]

# Pythonic way
squares = [n * n for n in range(1, 6)]
# [1, 4, 9, 16, 25]
```

### With filter

```python
evens = [n for n in range(20) if n % 2 == 0]
# [0, 2, 4, ..., 18]

# Even squares of numbers 1-10
even_squares = [n * n for n in range(1, 11) if n % 2 == 0]
# [4, 16, 36, 64, 100]
```

### filter + transform with a conditional expression

The `if` at the **end** of a comprehension *filters* (keeps or drops items). To *transform* differently per item, put a ternary at the **front**:

```python
# Filter: keep only evens
[n for n in range(6) if n % 2 == 0]          # [0, 2, 4]

# Transform: label every item (no dropping)
["even" if n % 2 == 0 else "odd" for n in range(6)]
# ['even', 'odd', 'even', 'odd', 'even', 'odd']
```

**Takeaway:** ternary *before* `for` = transform each item; `if` *after* `for` = filter items. They can coexist:

```python
[n * 10 if n % 2 == 0 else n for n in range(6) if n != 3]
# n != 3 filters out 3; the ternary scales evens
# [0, 1, 20, 40, 5]
```

### Nested

```python
# Cartesian product
pairs = [(x, y) for x in [1, 2] for y in ['a', 'b']]
# [(1, 'a'), (1, 'b'), (2, 'a'), (2, 'b')]
```

The two `for` clauses read **left to right, outer to inner** — same order you'd write nested `for` loops. Flattening a list of lists is the most common use:

```python
matrix = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
flat = [value for row in matrix for value in row]
# [1, 2, 3, 4, 5, 6, 7, 8, 9]
```

### Dict comprehensions

```python
squares = {n: n * n for n in range(5)}
# {0: 0, 1: 1, 2: 4, 3: 9, 4: 16}
```

A common pattern is **inverting** or **building** a dict from pairs:

```python
names = ["alice", "bob", "carol"]
index = {name: i for i, name in enumerate(names)}
# {'alice': 0, 'bob': 1, 'carol': 2}
```

### Set comprehensions

```python
unique_lower = {c.lower() for c in "Hello"}
# {'h', 'e', 'l', 'o'}
```

### Generator expressions — the lazy cousin

Swap the square brackets for **parentheses** and you get a **generator expression**: it produces items one at a time instead of building the whole list in memory. Ideal for big or infinite sequences, and for feeding straight into `sum`, `any`, `all`, `max`, etc.

```python
# List comp: builds the entire list (10 million ints) in RAM first
total = sum([n * n for n in range(10_000_000)])   # high memory

# Generator expr: computes one value at a time, near-zero extra memory
total = sum(n * n for n in range(10_000_000))      # low memory
#               ^ no brackets needed when it's the sole argument

# any / all short-circuit -- they stop at the first decisive item
has_negative = any(x < 0 for x in [3, -1, 7, 2])   # True (stops at -1)
all_positive = all(x > 0 for x in [3, 1, 7, 2])    # True
```

> **List comprehension vs generator expression:** use a **list comp** when you need the result more than once, need its length, or need to index into it. Use a **generator expression** when you'll consume it exactly once (often as an argument to an aggregating function) and want to avoid materializing a big list. A generator is single-use: once exhausted, looping it again yields nothing.

> **When to use comprehensions:** for short, clear transformations. If your comprehension has more than ~3 conditions or nests deeply, write a regular `for` loop — readability wins.

> **When NOT to use a comprehension:** (1) if you only want the *side effect* (e.g. printing) and not the resulting list — write a plain `for` loop, never `[print(x) for x in xs]` (it builds a throwaway list of `None`s). (2) If the per-item logic needs multiple statements, `try/except`, or is hard to read on one line. (3) If you'd have to repeat an expensive call — though Python 3.8+ lets you reuse a value with the walrus operator:

```python
import math
# Compute sqrt once, filter and keep it -- needs the walrus (:=)
data = [16, -4, 25, 9]
roots = [r for n in data if (r := n) >= 0 and (r := math.sqrt(n)) > 3]
# Cleaner: just write a small loop when it gets this fiddly.
```

---

## A larger example: FizzBuzz

The classic. Print 1-100, but for multiples of 3 print "Fizz", multiples of 5 print "Buzz", multiples of both print "FizzBuzz".

```python
for n in range(1, 101):
    if n % 15 == 0:
        print("FizzBuzz")
    elif n % 3 == 0:
        print("Fizz")
    elif n % 5 == 0:
        print("Buzz")
    else:
        print(n)
```

**Watch the ordering** — check `n % 15` before `n % 3`, otherwise multiples of 15 are caught by the `% 3` branch first.

> **An alternative that scales** — build the output by concatenation, which avoids the `% 15` special case and extends naturally to a "% 7 = Bazz" rule:

```python
for n in range(1, 101):
    out = ""
    if n % 3 == 0:
        out += "Fizz"
    if n % 5 == 0:
        out += "Buzz"
    print(out or n)        # `out or n` -> if out is "" (falsy), print the number
```

This reuses the truthiness idiom (`out or n`): an empty string is falsy, so the number prints; otherwise the accumulated "Fizz"/"Buzz"/"FizzBuzz" prints. Two `if`s (not `elif`) because a number can be a multiple of both.

---

## Common mistakes

**1. Off-by-one on `range`.**
```python
range(10)         # 0-9 (NOT 1-10)
range(1, 11)      # 1-10
range(0, 10)      # same as range(10)
```

**2. Modifying a list while looping over it.**
```python
items = [1, 2, 3, 4, 5]
for item in items:
    if item % 2 == 0:
        items.remove(item)  # BUG: messes up iteration!
print(items)  # [1, 3, 5] -- but only by luck
```

Better: build a new list:
```python
items = [item for item in items if item % 2 != 0]
```

> **Why it breaks:** the loop holds an internal index into the list. When you delete element at index 1, everything shifts left, and the index advances to 2 — so it *skips* the element that slid into position 1. With `[2, 2, 4]` you'd actually leave a `2` behind. Never mutate a collection's size while iterating it. Either build a new list (above), or iterate a **copy** with `for item in items[:]:` / `for item in list(items):` if you must mutate the original.

**3. Infinite loops.**
```python
n = 10
while n > 0:
    print(n)        # forgot to decrement n; loops forever!
```

Always make sure your loop variable is changing. (To stop a runaway loop in a terminal, press **Ctrl+C**.)

**4. Using `==` when you mean `in`.**
```python
fruit = "apple"

if fruit == "apple" or fruit == "banana" or fruit == "cherry":  # ugly
    print("ok")

if fruit in ["apple", "banana", "cherry"]:  # better
    print("ok")
```

> **Tip:** for a membership test you only read (never mutate), use a **set** or **tuple** literal: `if fruit in {"apple", "banana", "cherry"}:`. A set lookup is O(1) average vs O(n) for a list, which matters when the collection is large or the check is in a hot loop.

**5. Empty list / dict considered True?** No — they're **falsy**.
```python
items = []
if items:
    print("have items")  # not printed
else:
    print("empty")       # printed
```

**6. `elif` vs separate `if`s — accidentally running multiple branches.**
```python
n = 15
# WRONG: these are independent ifs, so 15 prints BOTH lines
if n % 3 == 0:
    print("Fizz")
if n % 5 == 0:
    print("Buzz")
# Fizz
# Buzz
```
If the cases are meant to be **mutually exclusive** (only one should fire), use `elif`. If a value can legitimately trigger several, separate `if`s are correct — be deliberate about which you want.

**7. Mutable default / late-binding in loops (closures).** A subtle classic: a function defined inside a loop captures the loop *variable*, not its value at definition time.
```python
funcs = []
for i in range(3):
    funcs.append(lambda: i)      # all capture the SAME i
print([f() for f in funcs])      # [2, 2, 2]  -- not [0, 1, 2]!

# Fix: bind the current value as a default argument
funcs = []
for i in range(3):
    funcs.append(lambda i=i: i)  # i=i snapshots the value now
print([f() for f in funcs])      # [0, 1, 2]
```

**8. Comparing floats with `==` in a loop.**
```python
x = 0.0
# This may NEVER hit exactly 1.0 due to floating-point rounding
while x != 1.0:
    x += 0.1
    if x > 5: break              # safety valve so the doc doesn't hang
# Prefer: loop an integer count, or use math.isclose
import math
x = 0.0
for _ in range(10):
    x += 0.1
print(math.isclose(x, 1.0))      # True
```

**Takeaway:** never gate a loop on exact float equality; iterate integers or use `math.isclose`.

---

## Cross-questions an interviewer or reviewer will ask

**Q: Does Python have a `switch`/`case` statement?**
Not historically. Before 3.10, people used `if`/`elif` chains or a **dict dispatch** (`{"a": handler_a, "b": handler_b}[key]()`). Python 3.10 added `match`, which is *structural pattern matching* — strictly more powerful than C's `switch`.

**Q: Why use a dict dispatch instead of a long `if`/`elif`?**
When you're mapping a key to an action, `handlers[key]()` is O(1), open for extension (just add a key), and reads as data rather than branching logic. Use `if`/`elif`/`match` when branches test *ranges* or *shapes*, not a single key equality.

```python
def dispatch(op, a, b):
    return {
        "add": lambda: a + b,
        "sub": lambda: a - b,
        "mul": lambda: a * b,
    }[op]()                       # KeyError if op unknown -- often what you want
print(dispatch("mul", 6, 7))     # 42
```

**Q: Is `for ... else` worth using, or should I avoid it?**
It's correct and occasionally elegant for "search, with a not-found fallback," but it's *frequently misread*. Many style guides say: if a function-and-`return` reads clearly, prefer that. Reserve loop `else` for tight search loops where the intent is obvious.

**Q: Why doesn't `break` take a label to exit multiple loops?**
A deliberate design choice — Guido rejected labelled breaks as rarely needed and a readability hazard. The Pythonic answer is to **extract the nested loops into a function and `return`**, which also names the operation. Flags work but are noisier.

**Q: List comprehension or `for` loop — which is faster, and does it matter?**
Comprehensions are usually a bit faster (the iteration runs in C and avoids repeated `.append` attribute lookups), but the real reason to prefer them is **readability for simple transforms**. Don't contort a comprehension for speed; if it's unclear, the loop is the right call. Premature micro-optimization here rarely matters.

**Q: Why does `0.1 + 0.2 == 0.3` return `False`?**
Floats are binary approximations of decimal fractions; `0.1` can't be represented exactly. This is a property of IEEE-754 floating point in *every* language, not a Python bug. Use `math.isclose()` or integer arithmetic (work in cents, not dollars) when exactness matters.

**Q: Does `range` create a list? What's its memory cost?**
No — `range` is a lazy sequence object holding only `start`, `stop`, `step`. Memory is constant (~48 bytes) regardless of length. You *can* materialize it with `list(range(n))` if you actually need a list.

**Q: What's the difference between `if x:` and `if x is not None:`?**
`if x:` tests *truthiness* — it's also false for `0`, `""`, `[]`, etc. `if x is not None:` tests *specifically* for `None`. If `0` or `""` are valid values you must keep, use the explicit `is not None` check, or you'll silently drop legitimate data.

---

## Exercises

1. **Multiplication table**: print the multiplication table for any number n (n × 1 through n × 10).
2. **Sum of digits**: input a number, print sum of its digits. e.g. 1234 → 10.
3. **Print primes**: print all primes from 1 to 100.
4. **Factorial**: input n, print n!. (Hint: loop multiplying.)
5. **Fibonacci**: print the first 10 Fibonacci numbers (1, 1, 2, 3, 5, 8, 13...).
6. **Reverse a number**: input 12345, print 54321 (using arithmetic, not strings).
7. **Count vowels**: in a sentence, count vowels.
8. **Largest of three**: read 3 numbers, print the largest. (Don't use `max`.)
9. **Grade with `match`**: rewrite the score→letter-grade logic using `match` and guard patterns (`case n if n >= 90`).
10. **Flatten**: given `[[1, 2], [3, 4], [5]]`, produce `[1, 2, 3, 4, 5]` with a single comprehension.
11. **Word frequency**: given a sentence, build a dict of `{word: count}` (loop or `dict`/`collections.Counter`-free version with a plain loop first).
12. **Collatz length**: for a starting number, count how many steps to reach 1 under the rule "if even, halve; if odd, 3n+1" — a natural `while` exercise.

### Hints

For #3 (primes): `n` is prime if no number from 2 to √n divides it.

```python
import math
def is_prime(n):
    if n < 2: return False
    for i in range(2, int(math.sqrt(n)) + 1):
        if n % i == 0:
            return False
    return True
```

For #5 (Fibonacci):
```python
a, b = 1, 1
for _ in range(10):
    print(a)
    a, b = b, a + b
```

The `a, b = b, a + b` is **tuple unpacking** — both assignments happen at once. The right-hand side `(b, a + b)` is fully evaluated *first* using the old values, then unpacked into `a` and `b`. That's why you don't need a temporary variable.

For #9 (`match` grade):
```python
def grade(score):
    match score:
        case n if n >= 90: return "A"
        case n if n >= 80: return "B"
        case n if n >= 70: return "C"
        case n if n >= 60: return "D"
        case _:            return "F"
print(grade(75))   # C
```

For #12 (Collatz): use `while n != 1:` and a counter; this is the textbook case for `while` because you genuinely don't know the iteration count up front.

---

## What's next

**Doc 04** — Functions: how to write reusable blocks of code.

```
→ Foundations/Programming/Python/04-functions.md
```

**Related reading once you're comfortable here:**
- `02-data-types.md` — revisit truthiness and the falsy values that drive `if`.
- The `itertools` module (`chain`, `product`, `islice`, `count`) — industrial-strength looping tools that build on the iteration model described above.
- The official tutorial: "More Control Flow Tools" in the Python docs, and PEP 636 (the `match` pattern-matching tutorial).

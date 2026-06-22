# 02 — Data Types

> **Prerequisites:** `01-getting-started.md`.
> **Time to read:** 25 minutes.

---

## What is a "type"?

**Plain English:** Imagine you have a bunch of labeled boxes. One box is labeled "words", one is labeled "whole numbers", one is labeled "yes/no answers". You can do different things with each box: you can add two number boxes together, but adding two yes/no boxes makes no obvious sense. A **type** is the label on the box. It tells Python *what kind of thing* a value is and *what operations are legal* on it.

Every value in Python has a **type**. The type tells Python what the value is and what you can do with it.

```python
name = "Alice"      # type: str (string)
age = 30            # type: int (integer)
height = 5.5        # type: float (decimal)
is_student = True   # type: bool (boolean)
nothing = None      # type: NoneType (special "no value")
```

Find out the type of any value:

```python
print(type("hello"))   # <class 'str'>
print(type(42))        # <class 'int'>
print(type(3.14))      # <class 'float'>
print(type(True))      # <class 'bool'>
```

### The precise version

Technically, Python is **dynamically typed** and **strongly typed**:

- **Dynamically typed** means a *variable* does not have a fixed type — the *value* does. You can rebind the same name to a different type at any time:

  ```python
  x = 42        # x points at an int
  x = "hello"   # now x points at a str — perfectly legal
  print(type(x))  # <class 'str'>
  ```
  *Takeaway:* in Python, names are sticky notes you attach to values, not typed containers.

- **Strongly typed** means Python will *not* silently coerce unrelated types for you. `"5" + 5` is an error, not `"55"` or `10`. (Contrast with JavaScript, where `"5" + 5` is `"55"`.)

  ```python
  print("5" + 5)
  # TypeError: can only concatenate str (not "int") to str
  ```
  *Takeaway:* strong typing turns silent bugs into loud, catchable errors.

Everything in Python is an **object** — even integers and `None`. An object carries (1) a type, (2) a value, and (3) an identity (its address in memory, which you can see with `id(x)`). We will lean on this object model later when we discuss `is` vs `==`.

```python
print(id(42))          # some big number — the object's identity
print(isinstance(42, int))   # True — prefer isinstance() over type() == for checks
```

*Takeaway:* `isinstance(x, int)` is the idiomatic way to ask "is this an int?", because it also accepts subclasses.

---

## Integers (`int`)

Whole numbers, positive or negative.

```python
x = 42
y = -17
z = 1_000_000   # underscores allowed for readability; Python ignores them
```

**Plain English:** an `int` is a counting number — no decimal point. Unlike many languages (C, Java), Python integers have **no fixed size limit**. They grow as large as your memory allows, so you never get "integer overflow."

```python
huge = 2 ** 1000
print(len(str(huge)))   # 302  → a 302-digit number, no overflow
```
*Takeaway:* Python `int` is arbitrary-precision ("bignum"); you will never silently wrap around to a negative number.

### Math operations

```python
a = 10
b = 3

print(a + b)   # 13
print(a - b)   # 7
print(a * b)   # 30
print(a / b)   # 3.333...  (always float, even on whole numbers)
print(a // b)  # 3         (integer division — drops decimal)
print(a % b)   # 1         (modulo — remainder)
print(a ** b)  # 1000      (exponent: 10^3)
```

**Important:** `/` always gives a float. Use `//` if you want an integer.

#### Floor division and modulo with negatives (gotcha)

`//` is **floor** division (rounds toward negative infinity), not "chop off the decimal". This surprises people with negative numbers:

```python
print(7 // 2)     # 3
print(-7 // 2)    # -4   (NOT -3 — it rounds DOWN, toward -infinity)
print(-7 % 2)     # 1    (the result of % has the sign of the divisor)
print(7 % -2)     # -1
```
*Takeaway:* in Python the identity `(a // b) * b + (a % b) == a` always holds; `//` rounds toward minus infinity, so `%` follows the sign of the right-hand side.

#### `divmod` — quotient and remainder in one call

```python
q, r = divmod(17, 5)
print(q, r)   # 3 2
```
*Takeaway:* `divmod(a, b)` returns `(a // b, a % b)` as a tuple — handy for "X groups of N with R left over".

### Increment / shorthand

```python
x = 10
x = x + 5   # 15
x += 5      # shorthand for x = x + 5; now 20
x -= 3      # 17
x *= 2      # 34
x //= 4     # 8
```

> **Note — no `++`:** Python has *no* `++` or `--` operator. Writing `++x` parses as "positive of (positive of x)" and does nothing useful; `x++` is a syntax error. Always use `x += 1`.
> ```python
> x = 5
> print(++x)   # 5  (two unary plusses — a no-op, NOT incremented!)
> ```

### Other integer bases and conversions

```python
print(0b1010)   # 10   (binary literal)
print(0o17)     # 15   (octal literal)
print(0xff)     # 255  (hex literal)

print(bin(10))  # '0b1010'
print(hex(255)) # '0xff'
print(int("1010", 2))   # 10   (parse a base-2 string)
print(int("ff", 16))    # 255  (parse a base-16 string)
```
*Takeaway:* `int(s, base)` parses a string in any base from 2–36; `bin`/`oct`/`hex` go the other way.

---

## Floats (`float`)

Decimal numbers.

```python
pi = 3.14159
mass = 0.001
big = 1.5e10   # 1.5 × 10^10 (scientific notation)
```

**Plain English:** a `float` ("floating-point number") is how computers store numbers with decimals. The catch: computers store them in **binary** (base 2), and just like `1/3 = 0.3333...` never ends in base 10, many simple decimals like `0.1` never end in base 2. So the computer keeps an *approximation*, and tiny errors creep in.

Under the hood, a Python `float` is an IEEE 754 64-bit "double": about **15–17 significant decimal digits** of precision.

### Float gotcha — precision

Floats have rounding errors:

```python
print(0.1 + 0.2)     # 0.30000000000000004
print(0.1 + 0.2 == 0.3)   # False!
```

**Why:** floats use binary representation; 0.1 has no exact binary form. Same as 1/3 has no exact decimal form.

You can *see* the stored approximation:

```python
print(f"{0.1:.20f}")   # 0.10000000000000000555
```
*Takeaway:* never compare floats with `==`; the value you typed and the value stored may differ in the 17th digit.

#### Special float values

```python
print(float("inf"))    # inf   (positive infinity)
print(float("-inf"))   # -inf
print(float("nan"))    # nan   ("not a number")

import math
print(math.isnan(float("nan")))   # True
print(float("nan") == float("nan"))  # False! NaN is never equal to anything, even itself
```
*Takeaway:* `nan != nan` is by design (IEEE 754). Test for it with `math.isnan`, never `== nan`.

**For money or precision-critical math, use `Decimal`:**

```python
from decimal import Decimal

a = Decimal("0.1")
b = Decimal("0.2")
print(a + b)         # 0.3 (exact)
```

> **Critical:** pass `Decimal` a **string**, not a float. `Decimal(0.1)` inherits the float's error (`0.1000000000000000055...`); `Decimal("0.1")` is exact.
> ```python
> print(Decimal(0.1))     # 0.1000000000000000055511151231257827021181583404541015625
> print(Decimal("0.1"))   # 0.1
> ```

For fractions where you want exact rational arithmetic, there is also `Fraction`:

```python
from fractions import Fraction
print(Fraction(1, 3) + Fraction(1, 3))   # 1/3 + 1/3 == 2/3
```

(More on this in `07-error-handling.md` when we discuss money.)

---

## Strings (`str`)

Text. Single or double quotes — both work.

```python
name = "Alice"
greeting = 'Hello'
```

**Plain English:** a string is a sequence of characters — letters, digits, spaces, symbols. In Python a string is an *immutable* sequence of Unicode characters, which means (1) you can index and slice it like a list, and (2) you can never change it in place — every "edit" actually builds a brand-new string.

Pick single or double quotes by convenience — choose the one that avoids escaping:

```python
print("She said \"hi\"")   # escaping needed
print('She said "hi"')      # no escaping — cleaner
print("it's fine")          # double quotes dodge the apostrophe
```

Triple quotes for multi-line strings:

```python
poem = """Roses are red,
violets are blue,
Python is great,
and so are you."""
```

### Escape sequences and raw strings

```python
print("a\tb")      # a    b   (\t = tab)
print("line1\nline2")   # newline
print("back\\slash")    # back\slash  (\\ = one backslash)

# Raw strings: prefix r"" — backslashes are literal. Great for regex & Windows paths.
print(r"C:\new\table")  # C:\new\table  (without r, \n and \t would be interpreted!)
```
*Takeaway:* reach for `r"..."` whenever backslashes should mean themselves (regex patterns, Windows paths).

### String operations

```python
first = "Hello"
second = "World"

# Concatenate (join with +)
greeting = first + " " + second
print(greeting)   # Hello World

# Repeat
print("ha" * 3)   # hahaha

# Length
print(len("hello"))   # 5

# Access individual character (zero-indexed)
print("hello"[0])     # h
print("hello"[4])     # o
print("hello"[-1])    # o (last)
print("hello"[-2])    # l (second-to-last)

# Slice (substring)
print("hello"[0:3])   # hel
print("hello"[2:])    # llo (from index 2 to end)
print("hello"[:3])    # hel (start to index 3)
```

#### Slicing in depth: `[start:stop:step]`

Slicing takes up to three numbers. The `stop` index is **exclusive** (not included). A negative `step` walks backwards.

```python
s = "abcdef"
print(s[1:4])    # bcd   (indices 1,2,3 — 4 is excluded)
print(s[::2])    # ace   (every 2nd char)
print(s[::-1])   # fedcba (reverse — the famous palindrome trick)
print(s[-3:])    # def   (last three)
print(s[10:20])  # ''    (out-of-range slices are SAFE — return empty, no error)
```

> **Half-open intervals — why `stop` is excluded:** with `s[a:b]`, the slice has exactly `b - a` characters, and `s[:k] + s[k:] == s` for any `k`. This "split anywhere" property is the design reason Python (and C, and most languages) use half-open ranges.

*Takeaway:* `s[a:b]` always yields `b - a` items (when in range); indexing a *single* out-of-range position raises `IndexError`, but *slicing* out of range never does.

### Useful string methods

```python
s = "Hello, World!"

print(s.upper())          # HELLO, WORLD!
print(s.lower())          # hello, world!
print(s.replace("World", "Python"))   # Hello, Python!
print(s.split(", "))      # ['Hello', 'World!']
print("   spaces   ".strip())   # 'spaces'
print(s.startswith("Hello"))    # True
print(s.endswith("?"))    # False
print("hello".find("l"))   # 2 (index of first 'l')

# Capitalize
print("alice".title())    # 'Alice'

# Check what's in a string
print("ello" in "hello")  # True
```

#### More string methods worth knowing

```python
# split() with no argument splits on ANY run of whitespace (great for messy input)
print("  a   b\tc\n".split())   # ['a', 'b', 'c']

# join() — the inverse of split. Call it on the SEPARATOR, pass the list.
print("-".join(["2026", "06", "22"]))   # 2026-06-22

# find vs index: find returns -1 if missing; index RAISES ValueError
print("hello".find("z"))    # -1
# "hello".index("z")        # ValueError: substring not found

# count occurrences
print("banana".count("a"))  # 3

# strip variants
print("xxhixx".strip("x"))   # 'hi'
print("  hi  ".lstrip())     # 'hi  '   (left only)
print("  hi  ".rstrip())     # '  hi'   (right only)

# Checks (all return bool)
print("12345".isdigit())     # True
print("abc123".isalnum())    # True
print("   ".isspace())       # True

# Padding / alignment
print("7".zfill(3))          # '007'
print("hi".center(6, "*"))   # '**hi**'
```
*Takeaway:* `"sep".join(list)` is the right way to glue strings — building a result with `+=` in a loop is O(n²) because each step copies the whole growing string.

> **The `+=` in a loop trap:**
> ```python
> # SLOW: each += rebuilds the entire string (strings are immutable)
> out = ""
> for word in words:
>     out += word
> # FAST: collect, then join once
> out = "".join(words)
> ```

### F-strings (formatted strings) — your favorite tool

```python
name = "Alice"
age = 30

# F-string: prefix with f and use {}
msg = f"My name is {name} and I am {age} years old."
print(msg)

# Inside {} you can put any expression
print(f"In 5 years: {age + 5}")

# Format numbers
pi = 3.14159265
print(f"{pi:.2f}")        # 3.14 (2 decimals)
print(f"{1000000:,}")     # 1,000,000 (with commas)
print(f"{0.85:.1%}")      # 85.0% (percentage)
```

F-strings are introduced in Python 3.6+. Use them. They're the cleanest way to combine values and text.

#### More f-string power

```python
val = 42
# = sign: print the expression AND its value (Python 3.8+) — superb for debugging
print(f"{val=}")          # val=42
print(f"{val * 2 = }")    # val * 2 = 84

# Alignment & width: <left  >right  ^center, with a fill char
print(f"|{'hi':<8}|")     # |hi      |
print(f"|{'hi':>8}|")     # |      hi|
print(f"|{'hi':^8}|")     # |   hi   |

# Combine: comma grouping + 2 decimals
print(f"{1234567.891:,.2f}")   # 1,234,567.89

# Hex / binary inside an f-string
print(f"{255:#x}")        # 0xff
print(f"{10:08b}")        # 00001010  (binary, zero-padded to 8)

# Dynamic precision using a nested {}
digits = 3
print(f"{3.14159:.{digits}f}")   # 3.142
```
*Takeaway:* `f"{expr=}"` is the fastest "what is this value right now?" debugging tool in the language.

#### The three string-formatting styles (and which to use)

```python
name, age = "Alice", 30
# 1. f-string (3.6+)  — PREFER THIS
print(f"{name} is {age}")
# 2. str.format()      — useful when the template is separate from the data
print("{} is {}".format(name, age))
# 3. % operator        — legacy / C-style; still seen in old code & logging
print("%s is %d" % (name, age))
```
> **When NOT to use f-strings:** in the `logging` module, prefer `logger.info("user %s logged in", name)` (lazy `%`-style) over `logger.info(f"user {name} logged in")`. The lazy form skips building the string entirely when the log level is disabled.

---

## Booleans (`bool`)

`True` or `False`. (Capital first letter — Python is case-sensitive.)

```python
is_alive = True
is_done = False
```

**Plain English:** a boolean answers a yes/no question. `True` means yes, `False` means no. Most comparisons (`>`, `==`, `in`) produce a boolean.

> **`bool` is a subclass of `int`:** under the hood `True` is `1` and `False` is `0`. This is occasionally surprising and occasionally useful.
> ```python
> print(True + True)        # 2
> print(sum([True, False, True, True]))   # 3  → count Trues by summing!
> print(isinstance(True, int))            # True
> ```
> *Takeaway:* `sum(condition for x in data)` counts how many items satisfy a condition.

### Comparison operators (return bool)

```python
print(5 > 3)    # True
print(5 < 3)    # False
print(5 == 5)   # True (equal)
print(5 != 3)   # True (not equal)
print(5 >= 5)   # True
print(5 <= 4)   # False
```

#### Chained comparisons (a Python superpower)

```python
x = 5
print(1 < x < 10)        # True  — reads like math; means (1 < x) and (x < 10)
print(0 <= x <= 4)       # False
```
*Takeaway:* `a < b < c` is real Python and evaluates `b` only once — clearer and safer than `a < b and b < c`.

### Logical operators

```python
a = True
b = False

print(a and b)   # False (both must be True)
print(a or b)    # True (either is True)
print(not a)     # False
```

#### Short-circuiting and the "real" return value of `and`/`or`

`and`/`or` do **not** return `True`/`False` — they return one of their **operands**, and they stop early ("short-circuit") as soon as the answer is known.

```python
print(0 or "default")     # 'default'  (0 is falsy, so return the right side)
print("Alice" or "default")  # 'Alice'   (left is truthy, returned immediately)
print(5 and 9)            # 9   (left truthy → return right)
print(0 and 9)            # 0   (left falsy → return it, right NEVER evaluated)
```

This enables two famous idioms:

```python
# Default value (pre-3.8 style)
name = user_input or "Anonymous"

# Guard against errors via short-circuit (right side runs only if left is truthy)
items = []
if items and items[0] == "x":   # items[0] is safe — only checked when items is non-empty
    ...
```
*Takeaway:* `x or default` gives a fallback; `obj and obj.method()` calls the method only when `obj` is truthy — both rely on short-circuiting.

> **Modern alternative — walrus & `or`:** for a *true* default-only-when-`None` (not "when falsy"), prefer being explicit so `0` and `""` aren't replaced:
> ```python
> qty = 0
> result = qty if qty is not None else 10   # keeps 0; `qty or 10` would wrongly give 10
> ```

### "Truthy" and "falsy"

In Python, many values are treated as `True` or `False` even if they're not `bool`:

**Falsy** (treated as False):
- `False`
- `None`
- `0`
- `""` (empty string)
- `[]`, `{}`, `()` (empty collections)

Also falsy: `0.0`, `0j`, `Decimal(0)`, `set()`, `range(0)`.

**Truthy** (treated as True):
- Anything else.

```python
if "":            # falsy → doesn't run
    print("hi")

if "anything":    # truthy → runs
    print("hi")

if 0:             # falsy
    print("not run")

if [1, 2, 3]:     # truthy (non-empty list)
    print("yes")
```

This lets you write:

```python
name = input("Name? ")
if name:                        # checks if not empty
    print(f"Hello {name}")
else:
    print("No name given")
```

#### Force a real bool with `bool()`

```python
print(bool(""))       # False
print(bool("no"))     # True   (any non-empty string is truthy — even "False"!)
print(bool([]))       # False
print(bool([0]))      # True   (one element, which happens to be 0)
```

> **Gotcha — `"False"` is truthy.** Reading a config value as text? `bool("False")` is `True` because the string is non-empty. Compare explicitly:
> ```python
> raw = "False"
> # WRONG: enabled = bool(raw)         # True!
> enabled = raw.strip().lower() == "true"   # correct
> print(enabled)   # False
> ```

*Takeaway:* truthiness checks the *container/value*, not its *contents*; a non-empty string is always truthy regardless of what it spells.

---

## `None` — the absence of a value

```python
result = None
print(result)        # None
print(type(result))  # <class 'NoneType'>
```

**Plain English:** `None` is Python's way of saying "nothing here yet" or "no answer." It is not `0`, not `""`, not `False` — it is its own distinct "empty" value. There is exactly **one** `None` object in a running program (a singleton).

Use `None` when something hasn't been set yet, or a function "doesn't return anything useful".

```python
# Check for None — use `is`, not ==
if result is None:
    print("no result yet")
```

`is None` (rather than `== None`) is the Python convention.

#### Why `is None` and not `== None`?

`None` is a singleton, so identity (`is`) is both correct and fast — it is one pointer comparison. Worse, `==` can be *overridden* by a class, so `obj == None` could lie or even raise:

```python
class Weird:
    def __eq__(self, other):
        return True          # claims to equal everything!

w = Weird()
print(w == None)    # True  — misleading!
print(w is None)    # False — the truth
```
*Takeaway:* always test `x is None` / `x is not None`; identity can't be faked and can't be slow.

#### Functions with no `return` give back `None`

```python
def greet(name):
    print(f"Hi {name}")      # prints, but does not return

x = greet("Ada")             # Hi Ada
print(x)                     # None  — there was no `return`
```
*Takeaway:* a function that "does something" but has no `return` statement returns `None`; don't assign its result expecting data.

> **Mutable default argument trap (uses `None` as the fix):** never use a list/dict as a default parameter — it is created *once* and shared across calls.
> ```python
> # BUGGY: the default list is shared between calls
> def add(item, bag=[]):
>     bag.append(item)
>     return bag
> print(add("a"))   # ['a']
> print(add("b"))   # ['a', 'b']   ← surprise! same list
>
> # FIX: default to None, create fresh inside
> def add(item, bag=None):
>     if bag is None:
>         bag = []
>     bag.append(item)
>     return bag
> ```

---

## Type conversion

Converting between types is common.

```python
# String to int
age_str = "30"
age = int(age_str)
print(age + 5)    # 35

# Int to string (concatenation)
score = 99
print("Score: " + str(score))   # Score: 99

# Float to int (truncates, doesn't round)
print(int(3.99))   # 3
print(int(-3.99))  # -3

# Round to nearest int
print(round(3.5))    # 4
print(round(3.49))   # 3

# Bool to int
print(int(True))   # 1
print(int(False))  # 0
```

**Plain English:** type conversion (a.k.a. "casting") asks Python to remake a value as a different type. Some conversions are lossy (`int(3.99)` throws away the `.99`), some can fail (`int("abc")`), and a few are surprising (see banker's rounding below).

### Beware: invalid conversions

```python
int("abc")         # ValueError: invalid literal for int()
int("3.14")        # ValueError: not a valid int (use float first)
float("3.14")      # works fine
int(float("3.14")) # works (3)
```

#### `round()` uses "banker's rounding" (round-half-to-even)

This is the single most-asked-about rounding surprise in Python:

```python
print(round(0.5))    # 0   (not 1!)
print(round(1.5))    # 2
print(round(2.5))    # 2   (not 3!)
print(round(3.5))    # 4
```
Ties (`.5`) round to the nearest **even** number. This is intentional (it removes statistical bias when rounding many numbers) and matches the IEEE 754 standard. If you need always-up-on-half, use `Decimal` with an explicit rounding mode:

```python
from decimal import Decimal, ROUND_HALF_UP
print(Decimal("2.5").quantize(Decimal("1"), rounding=ROUND_HALF_UP))   # 3
```
*Takeaway:* `round()` rounds halves to even, not always up; reach for `Decimal.quantize` when you need predictable financial rounding.

#### `int()` truncates toward zero; floor/ceil go a fixed direction

```python
import math
print(int(-3.9))      # -3   (truncates toward zero)
print(math.floor(-3.9))  # -4 (always down)
print(math.ceil(-3.1))   # -3 (always up)
print(math.trunc(-3.9))  # -3 (same as int())
```
*Takeaway:* `int()` chops toward zero; use `math.floor`/`math.ceil` when you specifically need down/up regardless of sign.

#### Safe conversion pattern

```python
def to_int(text, default=0):
    try:
        return int(text)
    except (ValueError, TypeError):
        return default

print(to_int("42"))    # 42
print(to_int("oops"))  # 0
print(to_int(None))    # 0
```
*Takeaway:* wrap user-supplied conversions in `try/except (ValueError, TypeError)` — never trust input to be convertible.

---

## A quick tour of other built-ins

### `len`
```python
len("hello")     # 5
len([1, 2, 3])   # 3
```

### `min` and `max`
```python
min(3, 7, 2)             # 2
max([10, 20, 30])        # 30
max("abc", "abd")        # 'abd' (lexicographic)
```

`min`/`max` also take a `key` function and a `default` (for possibly-empty input):

```python
words = ["pear", "fig", "banana"]
print(max(words, key=len))        # 'banana'  (longest, not alphabetical)
print(max([], default=None))      # None      (no ValueError on empty input)
```
*Takeaway:* `key=` chooses *what to compare by*; `default=` saves you from `ValueError: max() arg is an empty sequence`.

### `sum` (numbers only)
```python
sum([1, 2, 3, 4])   # 10
sum(range(1, 11))   # 55 (1+2+...+10)
sum([1.5, 2.5], 10) # 14.0  (optional start value, here 10)
```

### `abs`
```python
abs(-7)    # 7
abs(3.14)  # 3.14
```

### `round`
```python
round(3.7)        # 4
round(3.14159, 2) # 3.14 (round to 2 decimals)
```

### `repr` vs `str` (how a value prints)
```python
s = "hi\tthere"
print(str(s))    # hi    there      (human-friendly — tab rendered)
print(repr(s))   # 'hi\tthere'      (developer-friendly — quotes + escapes visible)
print(repr(42))  # 42
```
*Takeaway:* `str()` is what users should see; `repr()` is the unambiguous, debugger-friendly form (and what the REPL shows you automatically).

---

## Mutable vs immutable — the idea that ties the types together

**Plain English:** some values can be *changed in place* (mutable), others can *never* be changed once made (immutable). Every "edit" to an immutable value secretly creates a new value.

| Type | Mutable? |
|------|----------|
| `int`, `float`, `bool`, `str`, `tuple`, `frozenset`, `bytes`, `None` | **Immutable** |
| `list`, `dict`, `set`, `bytearray` | **Mutable** |

```python
# str is immutable: methods return NEW strings, the original is untouched
s = "hello"
print(s.upper())   # HELLO
print(s)           # hello  — unchanged

# list is mutable: it changes under your feet
nums = [1, 2, 3]
nums.append(4)
print(nums)        # [1, 2, 3, 4]  — the same list object, now longer
```

This single distinction explains the immutable-string gotcha, the mutable-default-argument trap, and `is` vs `==`. We will go deep on lists/dicts/sets in `04-collections.md`.

*Takeaway:* if a "modify" method returns a value but the original looks unchanged, you are holding an immutable type — reassign to keep the result.

---

## Common mistakes

**1. Comparing strings to numbers.**
```python
"5" == 5      # False! Different types.
int("5") == 5 # True
```

**2. Forgetting that `/` returns float.**
```python
result = 10 / 2          # 5.0 (float)
result = 10 // 2         # 5 (int)
```

**3. Mutating strings expecting them to change.**
```python
s = "hello"
s.upper()
print(s)        # "hello" — strings are IMMUTABLE
s = s.upper()   # to actually change s, reassign
print(s)        # "HELLO"
```

**4. Comparing floats with `==`.**
```python
0.1 + 0.2 == 0.3   # False (precision)
abs((0.1 + 0.2) - 0.3) < 1e-9   # safer
```
Even better, use the standard-library helper:
```python
import math
math.isclose(0.1 + 0.2, 0.3)    # True  (handles relative & absolute tolerance for you)
```

**5. Confusing `==` with `is`.**
- `==`: values equal?
- `is`: same object in memory?
For small ints / strings / `None`: behavior may match. For others: `==` is what you want.

```python
[1, 2] == [1, 2]   # True (values match)
[1, 2] is [1, 2]   # False (different list objects)
```

The "small int / string" overlap is a CPython **caching** detail, not a rule you should rely on:

```python
a = 256
b = 256
print(a is b)   # True  — CPython pre-caches small ints (-5..256)

a = 257
b = 257
print(a is b)   # often False — outside the cache, two separate objects

# So NEVER use `is` to compare values:
x = 1000
print(x == 1000)   # True  — correct way to compare values
print(x is 1000)   # SyntaxWarning in 3.8+, and unreliable — don't
```
*Takeaway:* use `is` only for singletons (`None`, `True`, `False`); use `==` for every value comparison.

**6. `input()` always returns a string.**
```python
age = input("Age? ")     # user types 30
# print(age + 1)         # TypeError: can only concatenate str (not "int") to str
age = int(input("Age? "))  # convert first
```
*Takeaway:* `input()` gives you `str` no matter what the user types; convert before doing math.

**7. Chained `is` on truthiness.**
```python
flag = True
# WRONG, redundant, and fragile:
if flag == True:
    ...
# RIGHT — just test the value:
if flag:
    ...
```
*Takeaway:* write `if flag:` / `if not flag:`, never `== True` / `== False`.

---

## Cross-questions an interviewer or reviewer will ask

**Q: Why does `/` always return a float, even `4 / 2`?**
For consistency and to avoid silent precision loss. In Python 2, `/` did integer division when both sides were ints (`5 / 2 == 2`), which caused countless bugs. Python 3 made `/` always "true division" (→ `float`) and gave us `//` for explicit floor division. So `4 / 2` is `2.0`.

**Q: Why is `0.1 + 0.2 != 0.3`? Is Python broken?**
No — every language using IEEE 754 doubles behaves identically. `0.1` cannot be represented exactly in binary, so the stored value is slightly off, and the error survives the addition. Compare with `math.isclose` or use `Decimal`.

**Q: `is` vs `==` — when do they differ and why?**
`==` compares *values* (and can be customized via `__eq__`); `is` compares *identity* (same object in memory). They *happen* to agree for cached small ints and interned strings, but that is a CPython optimization. Rule: `is` only for `None`/`True`/`False`; `==` for everything else.

**Q: Why use `is None` instead of `== None`?**
`None` is a unique singleton, so `is` is correct, fast (one pointer compare), and immune to a class overriding `__eq__` to misbehave.

**Q: Is `bool` really a kind of `int`?**
Yes — `bool` subclasses `int`, with `True == 1` and `False == 0`. That is why `sum([True, True, False])` is `2`. It also means `True + 1 == 2`, which is legal but rarely good style.

**Q: Why are strings immutable? Isn't that wasteful?**
Immutability makes strings (a) safe to share without defensive copies, (b) usable as `dict` keys / `set` members (they can be hashed once and cached), and (c) thread-safe to read. The cost — every "edit" makes a new string — is why you `"".join(list)` instead of `+=` in a loop.

**Q: Why does `round(2.5) == 2` instead of `3`?**
Banker's rounding (round-half-to-even), mandated by IEEE 754. Over many values it cancels out upward and downward bias. Use `Decimal(...).quantize(..., ROUND_HALF_UP)` if you need school-style rounding.

**Q: What's the difference between `int("3.14")` and `int(3.14)`?**
`int(3.14)` truncates the float to `3`. `int("3.14")` raises `ValueError` because `"3.14"` is not a valid *integer* literal — you must go `int(float("3.14"))`. `int()` only parses strings that look like whole numbers.

**Q: How big can a Python `int` get?**
Arbitrarily big — limited only by memory. There is no 32/64-bit overflow. (Since Python 3.11 there is a *string-conversion* safety limit of ~4300 digits to prevent denial-of-service, adjustable via `sys.set_int_max_str_digits`.)

---

## Idioms and best practices (quick reference)

- Build strings with `"".join(parts)`, not `+=` in a loop.
- Format with f-strings; use `%`-style only for `logging`.
- Test emptiness with truthiness: `if not items:` not `if len(items) == 0:`.
- Test for nothing with `x is None`, not `x == None`.
- Compare floats with `math.isclose`, never `==`.
- Prefer `isinstance(x, int)` over `type(x) == int`.
- Convert user input explicitly and defensively (`try/except ValueError`).
- Use `Decimal("...")` (string arg!) for money.
- Don't write `== True`/`== False`; test the value directly.
- Remember: `int`/`float`/`str`/`tuple` are immutable; `list`/`dict`/`set` are mutable.

---

## Exercises

1. **Temperature converter**: ask for Celsius, print Fahrenheit. `F = C * 9/5 + 32`.
2. **Word count**: ask for a sentence, print number of words. (Hint: `.split()`.)
3. **Initials**: from "John Adam Doe", produce "J.A.D." (use `.split()` and a loop or list comprehension).
4. **Check palindrome**: read a word, print whether it reads the same forward and backward. (Hint: `word == word[::-1]`.)
5. **Hours to days/hours**: input total hours, print "X days and Y hours" using `//` and `%`.
6. **Safe average**: read a comma-separated list of numbers (e.g. `3, 5, 8`), print their average to 2 decimals with an f-string. Handle the empty-input case without crashing.
7. **Money math**: compute `0.10 + 0.20` twice — once with `float`, once with `Decimal("...")` — and print both. Explain in a comment why they differ.
8. **Truthiness quiz**: predict (then verify) the output of `bool("False")`, `bool(0.0)`, `bool([0])`, `bool(" ")`. Were any surprising?

---

## What to read next

- **Doc 03** — Control flow: `if`, `elif`, `else`, `for`, `while` (builds directly on truthiness and comparisons from this doc).
- **Doc 04** — Collections: `list`, `dict`, `set`, `tuple` (where mutable vs immutable really matters).
- **Doc 07** — Error handling & money (deeper `Decimal`, `try/except` patterns hinted at above).
- Python docs: [Built-in Types](https://docs.python.org/3/library/stdtypes.html) and [`string` formatting spec](https://docs.python.org/3/library/string.html#format-specification-mini-language).

```
→ Foundations/Programming/Python/03-control-flow.md
```

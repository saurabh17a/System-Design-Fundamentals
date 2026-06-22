# 07 — Error Handling

> **Prerequisites:** `04-functions.md`, `06-classes-and-objects.md` (briefly).
> **Time to read:** 25 minutes.

Real programs fail. Networks drop. Files don't exist. Users type "abc" when you ask for a number. Robust code handles failure gracefully.

---

## What is an "exception"?

**Plain English:** an *exception* is Python's way of saying "I can't keep going the normal way — something unexpected happened." Instead of returning a value, the function (or operator) *interrupts* and shouts upward: "Help! I'm stuck!" If nobody catches that shout, the program stops and prints a red error message (the *traceback*).

Think of it like a fire alarm. The alarm (exception) goes off somewhere deep in a building (your call stack). It travels up floor by floor until either someone hits the "I'll handle it" button (an `except` block) or it reaches the roof and the whole building evacuates (your program crashes).

**Precise version:** when an error condition occurs, Python constructs an *exception object* (an instance of a class deriving from `BaseException`) and *raises* it. Raising unwinds the call stack — each function that doesn't handle it is abandoned mid-execution — until a matching `except` clause is found. If none is found, the default handler prints the traceback to `stderr` and exits with a non-zero status code.

When something goes wrong, Python **raises an exception**. If you don't handle it, your program **crashes**.

```python
result = 10 / 0    # ZeroDivisionError: division by zero
```

```python
n = int("abc")     # ValueError: invalid literal for int()
```

```python
my_list = [1, 2, 3]
print(my_list[10])    # IndexError: list index out of range
```

You can **catch** exceptions and decide what to do.

### Reading a traceback (your most important debugging skill)

When an uncaught exception crashes a program, Python prints a *traceback*. Read it **bottom-up**: the last line is *what* went wrong; the lines above are *where*.

```python
def a():
    return b()

def b():
    return 1 / 0

a()
```

Expected output:

```
Traceback (most recent call last):
  File "demo.py", line 7, in <module>
    a()
  File "demo.py", line 2, in a
    return b()
  File "demo.py", line 5, in b
    return 1 / 0
           ~~^~~
ZeroDivisionError: division by zero
```

The bottom line `ZeroDivisionError: division by zero` is the *type* and *message*. The frame just above it (`line 5, in b`) is where it actually happened. **Takeaway:** the last line tells you the error; the deepest (bottom) frame tells you the exact line.

---

## `try` / `except`

```python
try:
    n = int(input("Enter a number: "))
    print(f"Doubled: {n * 2}")
except ValueError:
    print("That wasn't a number!")
```

Flow:
1. Run the `try` block.
2. If it raises a `ValueError`, run the `except` block.
3. Otherwise (no error or different error type), `except` is skipped.

Without `try`/`except`, typing "abc" crashes the program. With it, we recover.

**Minimal runnable demo** (no input needed):

```python
def doubled(text):
    try:
        return int(text) * 2
    except ValueError:
        return "not a number"

print(doubled("21"))    # 42
print(doubled("abc"))   # not a number
```

Expected output:
```
42
not a number
```

**Takeaway:** `try`/`except` turns a crash into a controlled, recoverable path.

### How matching works

An `except SomeError` clause matches `SomeError` **and any subclass of it**. Clauses are checked **top to bottom**; the *first* one that matches wins. This is why you order specific exceptions before general ones (see below).

```python
try:
    raise FileNotFoundError("nope")
except OSError as e:          # FileNotFoundError IS-A OSError, so this matches
    print(f"caught as OSError: {e}")
```

Expected output:
```
caught as OSError: nope
```

**Takeaway:** catching a parent class also catches its children — useful, but easy to over-catch.

---

## Catching multiple exception types

```python
try:
    n = int(input("Number: "))
    print(10 / n)
except ValueError:
    print("Not a number!")
except ZeroDivisionError:
    print("Can't divide by zero!")
```

You can catch several in one `except`:

```python
try:
    ...
except (ValueError, ZeroDivisionError) as e:
    print(f"Bad input: {e}")
```

`as e` binds the exception to a variable. `e` has details (message, traceback).

### Order matters: specific before general

```python
# WRONG — the broad clause shadows the specific one
try:
    int("abc")
except Exception:
    print("generic")
except ValueError:        # unreachable! ValueError IS-A Exception
    print("value error")
```

```python
# RIGHT — specific first, then fall back to general
try:
    int("abc")
except ValueError:
    print("value error")
except Exception:
    print("generic")
```

Expected output of the RIGHT version:
```
value error
```

**Takeaway:** put the most specific exception types first; Python stops at the first match.

### Inspecting the bound exception object

```python
try:
    {"a": 1}["b"]
except KeyError as e:
    print(type(e).__name__)   # KeyError
    print(e.args)             # ('b',)
    print(str(e))             # 'b'
```

Expected output:
```
KeyError
('b',)
'b'
```

**Takeaway:** `e.args` holds the raw arguments passed to the exception; `str(e)` is the human message.

### The `as e` variable is deleted after the block

A subtle but real gotcha: in Python 3 the name bound by `as e` is *unbound* when the `except` block exits, to break a reference cycle (the exception holds the traceback, which holds the frame, which holds the exception). If you need the value later, copy it.

```python
err = None
try:
    1 / 0
except ZeroDivisionError as e:
    err = e          # save it before the block ends
# print(e)           # NameError: name 'e' is not defined
print(repr(err))     # ZeroDivisionError('division by zero')
```

Expected output:
```
ZeroDivisionError('division by zero')
```

**Takeaway:** `e` only lives inside the `except` block; assign it elsewhere if you need it afterward.

---

## `else` and `finally`

```python
try:
    f = open("data.txt")
    contents = f.read()
except FileNotFoundError:
    print("File not found!")
else:
    # runs if NO exception
    print(f"Read {len(contents)} chars")
finally:
    # ALWAYS runs (success, exception, or `return` mid-try)
    print("Closing up.")
```

- `else`: runs if `try` succeeds without exception. (Why not just put in try? Reduces what's "watched" for errors.)
- `finally`: cleanup. Runs no matter what.

Common use: closing files / network connections / locks.

### Why `else` instead of just more lines in `try`?

The `try` block should contain *only* the line(s) that can raise the exception you're catching. Everything that should run *only on success* belongs in `else`. This keeps the `except` from accidentally catching errors raised by your follow-up code.

```python
# Subtle bug: the print's own error would be swallowed as "not a number"
try:
    n = int("5")
    print(undefined_name)   # NameError, but we'd blame the int()
except ValueError:
    print("not a number")   # misleading if NameError sneaks in here

# Cleaner: only the risky parse is "watched"
try:
    n = int("5")
except ValueError:
    print("not a number")
else:
    print(undefined_name)   # NameError surfaces honestly, not disguised
```

**Takeaway:** keep `try` tiny; push success-only logic into `else` so you don't catch errors you didn't mean to.

### `finally` runs even when you `return`

```python
def f():
    try:
        return "from try"
    finally:
        print("finally still runs")

print(f())
```

Expected output:
```
finally still runs
from try
```

**Takeaway:** `finally` executes before the function actually returns — perfect for guaranteed cleanup.

### Gotcha: `return` in `finally` overrides everything

```python
def surprising():
    try:
        return 1
    finally:
        return 2     # this wins, and it even swallows exceptions!

print(surprising())   # 2
```

Expected output:
```
2
```

A `return` (or `break`/`continue`) inside `finally` discards any pending return value *and any in-flight exception*. This is almost always a bug. **Takeaway:** never `return` from `finally` — use it only for cleanup.

---

## `raise` — throw your own exceptions

```python
def divide(a, b):
    if b == 0:
        raise ValueError("Divisor cannot be zero")
    return a / b

try:
    print(divide(10, 0))
except ValueError as e:
    print(e)    # Divisor cannot be zero
```

Use `raise` when your function is given invalid input. Tell the caller something's wrong.

### Raise the *right* type

Picking the correct built-in type means callers can catch precisely. Rough guide:

- Bad *value* of the right type → `ValueError` (e.g. `int("abc")`, age of `-5`).
- Wrong *type* entirely → `TypeError` (e.g. passing a `str` where an `int` is required).
- Missing dict key / set member → `KeyError`.
- Out-of-range sequence index → `IndexError`.
- "This operation makes no sense in the current state" → `RuntimeError` or a custom type.
- "I haven't built this yet" → `NotImplementedError`.

```python
def set_speed(value):
    if not isinstance(value, (int, float)):
        raise TypeError(f"speed must be a number, got {type(value).__name__}")
    if value < 0:
        raise ValueError(f"speed must be >= 0, got {value}")
    return value

try:
    set_speed("fast")
except TypeError as e:
    print(e)   # speed must be a number, got str
```

Expected output:
```
speed must be a number, got str
```

**Takeaway:** match the exception type to the *kind* of problem so callers can catch the right thing.

### `raise` vs `assert`

`assert cond, msg` raises `AssertionError` if `cond` is falsy — but **assertions are stripped when Python runs with `-O` (optimized mode)**, so they must never guard real program logic or validate untrusted input. Use `assert` only for internal invariants and tests.

```python
# WRONG — vanishes under `python -O`, security/validation bypassed
def withdraw(amount):
    assert amount > 0, "amount must be positive"   # do not rely on this!
    ...

# RIGHT — always enforced
def withdraw(amount):
    if amount <= 0:
        raise ValueError("amount must be positive")
    ...
```

**Takeaway:** `raise` for things that can happen in production; `assert` only for "this should be logically impossible" checks during development.

### Re-raising

Catch, log, then re-raise:

```python
try:
    risky_operation()
except Exception as e:
    print(f"Logging error: {e}")
    raise    # passes it up the call stack
```

Useful when you want to log but not swallow.

A bare `raise` (no arguments) inside an `except` block re-raises the *original* exception with its *original* traceback intact. Writing `raise e` also works but is subtly worse — it can reset the traceback's starting point. Prefer bare `raise`.

```python
def load():
    try:
        return 1 / 0
    except ZeroDivisionError:
        print("load() saw an error, re-raising")
        raise          # bare raise keeps the full original traceback

try:
    load()
except ZeroDivisionError as e:
    print(f"caller handled: {e}")
```

Expected output:
```
load() saw an error, re-raising
caller handled: division by zero
```

**Takeaway:** bare `raise` re-throws the current exception untouched — best for "log and let it keep going up."

---

## Common built-in exceptions

| Exception | When it occurs |
|---|---|
| `ValueError` | Bad value passed. `int("abc")` |
| `TypeError` | Wrong type. `"a" + 5` |
| `KeyError` | Missing dict key. `d["missing"]` |
| `IndexError` | Out-of-range list index. `lst[100]` |
| `FileNotFoundError` | File doesn't exist |
| `PermissionError` | Can't read/write file |
| `ZeroDivisionError` | Division by zero |
| `AttributeError` | Object has no such attribute |
| `ImportError` | Can't import module |
| `OverflowError` | Number too large |
| `RuntimeError` | Generic runtime issue |
| `StopIteration` | An iterator has no more items (`next()` exhausted) |
| `KeyboardInterrupt` | User pressed Ctrl-C (subclass of `BaseException`, *not* `Exception`) |
| `Exception` | Catch-all (use sparingly) |

There's a hierarchy: `ValueError` is a subclass of `Exception`. Catching `Exception` catches everything (usually too broad).

### The hierarchy you must know

```
BaseException
 ├── SystemExit            (raised by sys.exit())
 ├── KeyboardInterrupt     (Ctrl-C)
 ├── GeneratorExit
 └── Exception             ← catch THIS, not BaseException
      ├── ArithmeticError
      │    └── ZeroDivisionError
      ├── LookupError
      │    ├── KeyError
      │    └── IndexError
      ├── OSError
      │    ├── FileNotFoundError
      │    ├── PermissionError
      │    └── ... (also aliased as IOError)
      ├── ValueError
      ├── TypeError
      └── ... many more
```

Why this matters: `except Exception` deliberately **does not** catch `KeyboardInterrupt` or `SystemExit`, because those are how the user/OS tells your program to stop. A bare `except:` *does* catch them — which is why bare `except:` can make a program impossible to Ctrl-C out of.

```python
try:
    raise KeyboardInterrupt
except Exception:
    print("this does NOT print")   # KeyboardInterrupt is not an Exception
```

Expected output: *(nothing prints; the `KeyboardInterrupt` propagates and stops the program)*

**Takeaway:** catch `Exception`, never `BaseException` or bare `except:`, so Ctrl-C and clean exits still work.

### `LookupError`: catch `KeyError` and `IndexError` together

```python
def get(container, key, default=None):
    try:
        return container[key]
    except LookupError:        # parent of both KeyError and IndexError
        return default

print(get({"a": 1}, "a"))      # 1
print(get({"a": 1}, "z", 0))   # 0
print(get([10, 20], 5, -1))    # -1
```

Expected output:
```
1
0
-1
```

**Takeaway:** parent classes like `LookupError` and `OSError` let you handle a family of related errors in one clause when that's genuinely what you mean.

---

## Custom exceptions

Define your own exception types for your domain:

```python
class InsufficientFundsError(Exception):
    """Raised when withdrawal exceeds balance."""
    pass

class Account:
    def __init__(self, balance):
        self.balance = balance

    def withdraw(self, amount):
        if amount > self.balance:
            raise InsufficientFundsError(
                f"Tried to withdraw {amount}; balance is {self.balance}"
            )
        self.balance -= amount

a = Account(100)
try:
    a.withdraw(150)
except InsufficientFundsError as e:
    print(e)
```

Custom exceptions make your code self-documenting. The caller knows exactly what went wrong.

### Always subclass `Exception`, never `BaseException`

```python
# WRONG — callers who do `except Exception` will MISS this
class MyError(BaseException):
    pass

# RIGHT
class MyError(Exception):
    pass
```

**Takeaway:** custom exceptions should derive from `Exception` (directly or via a base you define) so normal handlers can catch them.

### Build a base class for your library/app

A single base lets callers catch "anything from my module" with one clause, while still allowing fine-grained catches.

```python
class AppError(Exception):
    """Base for all errors this app raises."""

class NotFoundError(AppError):
    """A requested resource does not exist."""

class ValidationError(AppError):
    """Input failed validation."""

def lookup(db, key):
    if key not in db:
        raise NotFoundError(f"no such key: {key!r}")
    return db[key]

db = {"x": 1}
# Caller who only cares "did the app fail?":
try:
    lookup(db, "missing")
except AppError as e:
    print(f"{type(e).__name__}: {e}")
```

Expected output:
```
NotFoundError: no such key: 'missing'
```

**Takeaway:** a shared base exception per package gives callers both a broad net and precise hooks.

### Carrying data on the exception

```python
class ValidationError(Exception):
    def __init__(self, field, message):
        super().__init__(f"{field}: {message}")
        self.field = field
        self.message = message

try:
    raise ValidationError("email", "must contain @")
except ValidationError as e:
    print(e.field)        # email
    print(e.message)      # must contain @
```

Calling `super().__init__(...)` is what makes `str(e)` and `e.args` work correctly — don't skip it. Carry structured data (the field, an error code, a retry-after hint) as attributes so handlers can act programmatically instead of parsing the message string.

```python
class ApiError(Exception):
    def __init__(self, status_code, message):
        super().__init__(f"[{status_code}] {message}")
        self.status_code = status_code

try:
    raise ApiError(503, "service unavailable")
except ApiError as e:
    if e.status_code >= 500:
        print("server error — safe to retry")
```

Expected output:
```
server error — safe to retry
```

**Takeaway:** attach machine-readable attributes to custom exceptions; let handlers branch on data, not on string-matching the message.

---

## Exception chaining

You can catch one exception and raise another, preserving context:

```python
class ConfigurationError(Exception):
    pass

try:
    config = open("config.json").read()
except FileNotFoundError as e:
    raise ConfigurationError("config missing") from e
```

The traceback shows BOTH errors. Helps debugging.

Use `raise X from None` to suppress the chain (rarely needed).

### Implicit vs explicit chaining

If you raise a new exception *inside* an `except` block without `from`, Python still chains it automatically and the traceback says **"During handling of the above exception, another exception occurred."** Adding `from e` changes the wording to **"The above exception was the direct cause of the following exception,"** which signals intent ("I deliberately translated this error").

```python
class ConfigurationError(Exception):
    pass

try:
    int("not a number")
except ValueError as e:
    raise ConfigurationError("bad config value") from e
```

Expected output (abridged):
```
Traceback (most recent call last):
  ...
ValueError: invalid literal for int() with base 10: 'not a number'

The above exception was the direct cause of the following exception:

Traceback (most recent call last):
  ...
ConfigurationError: bad config value
```

`from None` hides the original — use it only when the lower-level error is noise the caller should never see:

```python
try:
    int("x")
except ValueError:
    raise ConfigurationError("invalid config") from None   # original suppressed
```

**Takeaway:** use `raise NewError(...) from original` to translate a low-level error into a domain error while keeping the trail; reach for `from None` only to deliberately hide implementation noise.

---

## When NOT to use exceptions

**Don't use exceptions for control flow.** They're for *exceptional* situations.

Bad:
```python
def find(items, target):
    try:
        return items.index(target)
    except ValueError:
        return -1
```

Better:
```python
def find(items, target):
    if target in items:
        return items.index(target)
    return -1
```

Or, even better, return None or use a sentinel.

**Don't catch overly broad exceptions.**

```python
try:
    risky()
except Exception:    # catches everything, including programming bugs
    pass
```

This **hides bugs**. You won't know your code is broken.

Catch specific exceptions you can actually handle:

```python
try:
    risky()
except (NetworkError, TimeoutError):
    retry()    # I know how to retry these
```

### "Look before you leap" (LBYL) vs "Easier to ask forgiveness than permission" (EAFP)

Python idiomatically *prefers* EAFP — just try the operation and catch the failure — over checking conditions first. The reason is correctness under concurrency: between an LBYL check and the action, the world can change (a file can be deleted, a key can be removed). EAFP has no such race.

```python
import os

# LBYL — has a TOCTOU (time-of-check to time-of-use) race:
# the file can vanish between exists() and open().
if os.path.exists("data.txt"):
    with open("data.txt") as f:
        data = f.read()
else:
    data = ""

# EAFP — Pythonic and race-free:
try:
    with open("data.txt") as f:
        data = f.read()
except FileNotFoundError:
    data = ""
```

**But** EAFP is wrong when the operation has side effects you can't undo, or when "the thing failing" is the *normal, expected* case (then it's control flow — use a check or `dict.get`). **Takeaway:** prefer try/except (EAFP) for genuinely exceptional, side-effect-free probes; prefer a plain check when failure is the common, expected path.

---

## Pattern: validate at boundaries

The "boundary" of your program is where untrusted input enters: user input, API requests, file contents.

**Validate at the boundary; trust internals.**

```python
def parse_age(input_str: str) -> int:
    """Validates user input."""
    try:
        age = int(input_str)
    except ValueError:
        raise ValueError(f"Age must be a number, got {input_str!r}")
    if age < 0 or age > 150:
        raise ValueError(f"Age must be 0-150, got {age}")
    return age

def calculate_birth_year(age: int) -> int:
    """Internal — trust the int is valid."""
    from datetime import date
    return date.today().year - age
```

`parse_age` does heavy validation. `calculate_birth_year` doesn't — it trusts the caller.

**Why this works:** if every external value is sanitized once, at the door, then the entire interior of your program can assume its data is well-formed. You stop sprinkling defensive `if`-checks through every function, which makes internal code shorter and faster. The boundary functions are the only ones that need exhaustive validation and tests for bad input.

**Takeaway:** validate once at the edge and convert messy input into clean, typed values; everything inside trusts those types.

---

## Pattern: clean up with `with`

Many resources need cleanup (closing files, releasing locks). The `with` statement does it automatically.

```python
# Old way:
f = open("data.txt")
try:
    data = f.read()
finally:
    f.close()

# Pythonic way:
with open("data.txt") as f:
    data = f.read()
# f is closed automatically, even if an exception occurs
```

Many objects support `with` (called **context managers**): files, locks, network connections, database transactions.

You can write your own:

```python
class Timer:
    def __enter__(self):
        import time
        self.start = time.time()
        return self
    def __exit__(self, exc_type, exc_value, traceback):
        elapsed = time.time() - self.start
        print(f"Took {elapsed:.3f}s")

with Timer():
    # ... slow operation ...
    [x*x for x in range(10**6)]
# prints: Took 0.123s
```

`__exit__` runs even on exceptions. Returning True from `__exit__` suppresses the exception (rarely a good idea).

### Writing a context manager the easy way: `contextlib.contextmanager`

For simple cases you don't need a class — a generator with `@contextmanager` is enough. Code before `yield` is the "enter"; code after is the "exit". Put the exit in a `finally` so it runs even on errors.

```python
from contextlib import contextmanager

@contextmanager
def tag(name):
    print(f"<{name}>")
    try:
        yield
    finally:
        print(f"</{name}>")

with tag("p"):
    print("hello")
```

Expected output:
```
<p>
hello
</p>
```

**Takeaway:** `@contextmanager` turns a single-`yield` generator into a context manager — the cleanup after `yield` is your `finally`.

### Multiple resources and `contextlib.suppress`

```python
from contextlib import suppress

# Acquire two resources at once; both are released in reverse order.
with open("a.txt") as fa, open("b.txt") as fb:
    ...

# suppress is a clean way to ignore a specific, expected error:
import os
with suppress(FileNotFoundError):
    os.remove("maybe_missing.tmp")   # no-op if the file isn't there
```

`with suppress(X):` is the readable, intentional version of `try: ... except X: pass`. Use it only when ignoring the error is genuinely correct. **Takeaway:** combine resources in one `with`, and use `suppress` to deliberately (and visibly) ignore an expected exception.

---

## Idioms and best practices

- **Catch the narrowest type you can act on.** If you can only sensibly handle `KeyError`, don't catch `Exception`.
- **Catch close to where you can recover, raise close to where the problem is detected.** Low-level code detects and raises; high-level code (request handler, CLI loop) catches and decides the user-facing response.
- **Log with the traceback, not just the message.** `logging.exception(...)` (or `logger.error(..., exc_info=True)`) inside an `except` block records the full stack, which `print(e)` throws away.

```python
import logging
logging.basicConfig(level=logging.ERROR)
logger = logging.getLogger(__name__)

try:
    1 / 0
except ZeroDivisionError:
    logger.exception("computation failed")   # logs message AND traceback
```

Expected output (abridged):
```
ERROR:__main__:computation failed
Traceback (most recent call last):
  ...
ZeroDivisionError: division by zero
```

- **Prefer `dict.get(key, default)` over try/except `KeyError`** when a missing key is normal.
- **Don't let `finally` or `__exit__` return values or raise new errors** unless you mean to mask the original.
- **Fail fast on programmer errors; recover only from environmental errors.** A `TypeError` usually means *your* code is wrong (fix the code); a `ConnectionError` means *the world* misbehaved (retry / fall back).

---

## Common mistakes

**1. Catching too broadly.**
```python
try:
    do_thing()
except:           # catches EVERYTHING including KeyboardInterrupt!
    pass
```

Never use bare `except:`. At minimum: `except Exception:` (excludes `KeyboardInterrupt`).

**2. Swallowing exceptions silently.**
```python
try:
    risky()
except Exception:
    pass    # bug factory!
```

At least log:
```python
try:
    risky()
except Exception as e:
    logger.error(f"risky() failed: {e}")
    # decide: re-raise? continue? return default?
```

**3. Catching where you can't fix.**

If you can't handle an error, don't catch it. Let it propagate to someone who can.

**4. Using `Exception` when there's a specific type.**
```python
try:
    int(s)
except Exception:    # too broad
    ...

try:
    int(s)
except ValueError:    # specific, clear
    ...
```

**5. Putting too much in `try`.**
```python
# Bad
try:
    data = fetch_user(uid)
    name = data["name"]            # might raise
    age = int(data["age"])         # might raise
    print(f"{name}: {age}")
except Exception:
    print("error")
```

The `except Exception` is hiding 3 different errors. Be granular.

**6. Mutating the loop variable but losing the exception you wanted.**
```python
# Bug: `e` is gone after the loop because the name unbinds per-except
errors = []
for x in ["1", "2", "x"]:
    try:
        int(x)
    except ValueError as e:
        errors.append(e)        # OK — we copy it INTO the list while it's live
print([str(e) for e in errors])
```
Expected output:
```
["invalid literal for int() with base 10: 'x'"]
```
The fix is already shown: capture the exception (here, by appending) *inside* the block. Referencing `e` after the loop would be a `NameError`. **Takeaway:** save exception objects while still inside the `except` block.

**7. Comparing exceptions by message string.**
```python
# Fragile — breaks if the wording changes across Python versions
try:
    int("x")
except ValueError as e:
    if "invalid literal" in str(e):    # DON'T branch on the message text
        ...
```
Branch on the exception *type* (or a custom attribute like an error code), never on the human-readable message. **Takeaway:** messages are for humans; types and attributes are for code.

---

## Cross-questions an interviewer or reviewer will ask

**Q: Why catch `Exception` and not bare `except:`?**
Bare `except:` also catches `KeyboardInterrupt` (Ctrl-C) and `SystemExit` (`sys.exit()`), which derive from `BaseException`, not `Exception`. Swallowing those can make a program un-killable and hide intentional shutdowns. `except Exception:` catches ordinary errors while letting those control signals through.

**Q: Why use a bare `raise` to re-raise instead of `raise e`?**
A bare `raise` re-raises the *currently handled* exception with its original traceback unchanged. `raise e` re-raises the object but can truncate/reset the traceback's origin, making the stack trace less useful for debugging.

**Q: Why is EAFP preferred over LBYL in Python?**
EAFP ("try it, catch failure") avoids time-of-check-to-time-of-use races: a file or key checked first can disappear before you use it. It's also often faster on the happy path since you skip a redundant membership/existence test. LBYL is still better when the failing case is the *normal* case (then it's control flow, not an exception).

**Q: When would you create a custom exception versus using a built-in?**
Use a built-in when it accurately describes the failure (`ValueError`, `KeyError`). Create a custom type when callers need to distinguish *your* domain failure from generic ones (`InsufficientFundsError` vs a random `ValueError`), or when you want to attach structured data (status codes, the offending field). Give your package a single base exception so callers can catch broadly or narrowly.

**Q: What's the difference between `assert` and `raise`, and why can't I use `assert` for validation?**
`raise` is always executed; `assert` is removed when Python runs with `-O`. So `assert` is only for internal "can't-happen" invariants and tests — never for validating user input or enforcing security, because in optimized builds the check simply vanishes.

**Q: What does `raise X from Y` do that a plain `raise X` doesn't?**
`from Y` records `Y` as the explicit cause (`__cause__`) and prints "the direct cause of the following exception." A plain raise inside an `except` chains implicitly (`__context__`) with "during handling of the above exception." `from None` suppresses the chain entirely.

**Q: Does `finally` always run? Can it change the result?**
It runs on success, on exception, and even when the `try` body executes `return`/`break`/`continue`. And yes — a `return` or `raise` inside `finally` will *override* the pending return value and *swallow* an in-flight exception, which is almost always a bug.

**Q: What's the cost of try/except when no exception is raised?**
Setting up a `try` block in modern CPython is effectively free on the no-exception path (zero-cost exceptions since 3.11). The cost is paid only when an exception is actually raised and unwound. This is part of why EAFP is reasonable for the common-success case.

---

## Exercises

1. **Safe int parser**: `parse_int(s, default)` returns `int(s)`, or `default` if invalid.
2. **Retry wrapper**: a function that calls another function up to N times until it succeeds.
3. **`SafeDivide(a, b)`**: returns `a / b`, or `None` if b is zero.
4. **Custom exception hierarchy**: `AppError` base, `NotFoundError`, `ValidationError`, `PermissionError` subclasses.
5. **File reader**: read a file; if not found, return empty string. If permission denied, log and re-raise.
6. **Context manager**: write a `@contextmanager` called `changed_dir(path)` that `os.chdir`s into `path` and always restores the original directory on exit (even on error). Verify cleanup runs by raising inside the `with`.
7. **Error translation**: wrap a function that may raise `KeyError`/`IndexError` so it raises your own `NotFoundError("...") from original`, and confirm the traceback shows both.

### Hint for #2

```python
def retry(fn, max_attempts=3):
    last_err = None
    for attempt in range(1, max_attempts + 1):
        try:
            return fn()
        except Exception as e:
            last_err = e
            print(f"Attempt {attempt} failed: {e}")
    raise last_err

# Use:
result = retry(lambda: risky_network_call())
```

### Hint for #6

```python
import os
from contextlib import contextmanager

@contextmanager
def changed_dir(path):
    original = os.getcwd()
    os.chdir(path)
    try:
        yield
    finally:
        os.chdir(original)   # restored even if the body raised
```

---

## What to read next

- **Doc 08 — Concurrency:** doing multiple things at once. Errors in threads, processes, and `asyncio` propagate differently (e.g. exceptions raised in a worker may surface only when you `.result()` a future, or be wrapped in an `ExceptionGroup`). Understanding single-threaded exceptions first is the foundation.
- **Python docs — Errors and Exceptions:** the official tutorial chapter (`docs.python.org/3/tutorial/errors.html`).
- **`contextlib` standard library:** `suppress`, `closing`, `ExitStack` for managing many resources, and `@contextmanager`.
- **Logging (a later doc / the `logging` module):** pairs with this chapter — `logger.exception()` is how you record failures in real services.

```
→ Foundations/Programming/Python/08-concurrency.md
```

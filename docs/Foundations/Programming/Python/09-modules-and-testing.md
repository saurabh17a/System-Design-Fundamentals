# 09 — Modules, Packages, and Testing

> **Prerequisites:** `08-concurrency.md` (or any earlier doc).
> **Time to read:** 25 minutes.

So far every example has been one file. Real programs are many files, share code, install libraries, and have tests. This doc covers all of that.

---

## The big picture (plain English first)

Imagine your kitchen. A **module** is a single drawer of tools (the whisk, the spatula). A **package** is a whole cabinet with labelled drawers inside it. **pip** is the store where you buy new tools. A **virtual environment** is a separate toolbox per project, so your baking project's tools don't get mixed up with your barbecue project's tools. And **tests** are the little checks you run — "does the oven actually reach 200°C when I set it to 200?" — so you find problems before your guests do, not during dinner.

Now the precise version, one concept at a time.

---

## What is a module?

A **module** is just a `.py` file. The filename (without `.py`) is the module name.

Make a file `math_utils.py`:

```python
# math_utils.py
def square(x):
    return x * x

def cube(x):
    return x * x * x

PI = 3.14159
```

Now in another file `main.py` in the **same directory**:

```python
# main.py
import math_utils

print(math_utils.square(5))    # 25
print(math_utils.PI)           # 3.14159
```

You imported the module, then used it via `module_name.thing`.

### What actually happens when you `import`

Plain English: the first time you import a module, Python *runs the whole file top to bottom*, stashes the result in a cache, and hands you a reference. The second, third, hundredth time you import it (anywhere in the program), Python skips re-running it and gives you the cached copy.

Technical version: every imported module becomes an object in the dictionary `sys.modules`, keyed by its name. Import is roughly "if name not in `sys.modules`: find the file, execute it in a fresh namespace, store the resulting module object; then bind the name in the importer's namespace."

```python
import sys
import math_utils
print(type(math_utils))                 # <class 'module'>
print("math_utils" in sys.modules)      # True
print(math_utils.__name__)              # math_utils
print(math_utils.__file__)              # /path/to/math_utils.py
```

Expected output (path will differ):

```
<class 'module'>
True
math_utils
/path/to/math_utils.py
```

**Takeaway:** a module is an object; importing runs the file *once* and caches it.

### Tiny demo: import runs the file once

```python
# greeter.py
print("greeter is being set up")
GREETING = "hi"
```

```python
# run.py
import greeter      # prints "greeter is being set up"
import greeter      # prints NOTHING the second time
print(greeter.GREETING)
```

Expected output:

```
greeter is being set up
hi
```

**Takeaway:** the body of a module executes exactly once per process, no matter how many times you import it. (This is *why* import side effects, covered later, are dangerous.)

---

## Three import styles

```python
# Style 1: import the whole module
import math_utils
math_utils.square(5)

# Style 2: import specific names
from math_utils import square, PI
square(5)

# Style 3: rename
import math_utils as mu
mu.square(5)
```

All work. Use **Style 2** for things you'll call a lot. Use **Style 1** when there are name conflicts (e.g., your code has a `square` already).

### What `from x import y` actually binds

Plain English: `from math_utils import square` makes a *new local name* `square` that points at the same function object. It does **not** import "less" of the module — Python still runs the entire `math_utils.py` file. It just chooses what names land in *your* namespace.

```python
from math_utils import square
import math_utils

print(square is math_utils.square)   # True — same object, two names
```

Expected output:

```
True
```

**Takeaway:** `from x import y` is about *which names you see*, not *how much code runs*. The whole module always executes.

### Gotcha: `from x import y` snapshots a name, it does not "live-link"

```python
# counter.py
count = 0
def bump():
    global count
    count += 1
```

```python
# wrong.py
from counter import count, bump
bump()
print(count)          # 0  — NOT 1! Surprising.
```

Expected output:

```
0
```

`from counter import count` copied the *value* `0` into your local `count`. When `bump()` rebinds `counter.count` to `1`, your local name still points at the old `0`. The fix is to import the module and read through it:

```python
# right.py
import counter
counter.bump()
print(counter.count)  # 1  — correct
```

Expected output:

```
1
```

**Takeaway:** import the *module* (Style 1) when you need to see values that change over time; `from x import value` freezes a snapshot.

### Aliasing idioms you'll see constantly

```python
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
```

These aren't arbitrary — they're community conventions. A reader who sees `pd.DataFrame` instantly knows it's pandas. Stick to the standard aliases; don't invent your own.

**Takeaway:** use the well-known alias for well-known libraries; readability is a feature.

### Avoid `from module import *`

```python
from math_utils import *    # imports EVERYTHING
```

You don't know what got pulled in. Hard to read; can clobber existing names. Don't.

A concrete disaster:

```python
from os import *            # brings in open, getcwd, system, ...
open = "my file handle"     # you just shadowed the builtin open()!
```

Now `open("data.txt")` fails because `open` is a string. Star-imports make this kind of silent collision easy and the source impossible to grep for.

If you are *writing* a module and want to control what `import *` exposes (e.g., for a small, deliberate public API), define `__all__`:

```python
# shapes.py
__all__ = ["Circle", "Square"]   # only these are exported by `import *`

class Circle: ...
class Square: ...
class _InternalHelper: ...        # leading underscore = private by convention
```

**Takeaway:** never use `import *` in your own code; if you maintain a library, use `__all__` and leading underscores to signal what's public.

---

## Built-in modules

Python ships with hundreds. Some you'll use constantly:

```python
import math
print(math.sqrt(16))          # 4.0
print(math.pi)                # 3.141592...

import random
print(random.randint(1, 10))  # random int

import os
print(os.getcwd())            # current directory

import sys
print(sys.argv)               # command-line args
```

We'll tour more in `11-stdlib-tour.md`.

### Gotcha: never name your file the same as a stdlib module

This is the single most common beginner trap. Create a file called `random.py` and then:

```python
# random.py  (your file!)
import random
print(random.randint(1, 10))
```

You get:

```
AttributeError: module 'random' has no attribute 'randint'
```

Why? Python found *your* `random.py` first (the current directory is searched before the standard library) and imported that instead of the real one. Your file has no `randint`. The same happens with `email.py`, `string.py`, `test.py`, `queue.py`, etc.

**The fix:** rename your file (e.g., `my_random.py`). To debug, check `random.__file__` — if it points at your project instead of Python's `lib/`, you've shadowed it.

**Takeaway:** don't name your scripts after standard-library modules; the import system searches your folder first.

---

## How Python finds modules (`sys.path`)

Plain English: when you write `import foo`, Python looks for `foo` in an ordered list of folders, stopping at the first hit. That list is `sys.path`.

```python
import sys
for p in sys.path:
    print(p)
```

The list is, in order: (1) the directory of the script you ran (or the current directory in the REPL), (2) directories in the `PYTHONPATH` environment variable, (3) the standard library, (4) the `site-packages` folder where pip installs things.

This explains two things you already saw:

- Your `random.py` wins because entry (1) comes before entry (3).
- `import requests` works after `pip install requests` because it lands in entry (4).

**Takeaway:** import resolution is just "first match in `sys.path` wins" — most surprises trace back to this order.

---

## Packages — directories of modules

A **package** is a directory containing modules. Mark it with an empty (or special) file `__init__.py`:

```
my_app/
├── __init__.py
├── math_utils.py
├── string_utils.py
└── data/
    ├── __init__.py
    └── loader.py
```

Imports use dots:

```python
from my_app import math_utils
from my_app.data import loader
from my_app.data.loader import load_csv
```

The `__init__.py` runs once when the package is first imported. Often empty; sometimes used to expose a clean API:

```python
# my_app/__init__.py
from .math_utils import square, cube
from .string_utils import slugify

# Now users can:
# from my_app import square     (cleaner)
```

### Absolute vs relative imports

Plain English: an **absolute import** spells out the full path from the project root (`from my_app.data import loader`). A **relative import** uses dots to mean "relative to the package I'm in" (`.` = this package, `..` = parent package).

```python
# inside my_app/data/loader.py

# absolute (preferred, explicit, works when run from project root)
from my_app.math_utils import square

# relative (handy inside a package; reads as "go up one level to my_app")
from ..math_utils import square
from . import otherthing_in_data
```

The official style guide (PEP 8) recommends absolute imports for clarity. Relative imports are fine inside a cohesive package, but they break the moment someone tries to run that file directly as a script.

**Takeaway:** prefer absolute imports; reach for relative (`.`/`..`) only *inside* a package, never in a top-level script.

### Do I still need `__init__.py`?

Since Python 3.3, a folder without `__init__.py` can still be imported as a "namespace package." But for ordinary projects keep the `__init__.py` — it's explicit, it lets you expose a clean API, and it avoids subtle surprises with tools and test runners.

**Takeaway:** add `__init__.py` to every package directory; it's cheap insurance.

---

## The `if __name__ == "__main__":` idiom

You'll see this everywhere:

```python
def main():
    print("running...")

if __name__ == "__main__":
    main()
```

When you run `python my_file.py`, Python sets `__name__ = "__main__"`.
When another file does `import my_file`, `__name__ = "my_file"`.

So this idiom means: "run `main()` if this file was executed directly, but not if it was imported." Lets you both run a file as a script and reuse it as a module.

### See it for yourself

```python
# dual.py
print(f"__name__ is {__name__!r}")

def main():
    print("doing the script thing")

if __name__ == "__main__":
    main()
```

Run it directly:

```bash
$ python dual.py
__name__ is '__main__'
doing the script thing
```

Import it from another file:

```python
# importer.py
import dual
```

```bash
$ python importer.py
__name__ is 'dual'
```

Notice `main()` did **not** run on import — exactly what we wanted.

**Takeaway:** the guard separates "run as a program" from "be imported as a library"; without it, importing a file would fire off its script code.

### Cross-question: "Why not just put the code at the bottom of the file with no guard?"

Because then merely *importing* the file (which your test suite does, and which any other module that depends on you does) would execute that bottom-of-file code: it might prompt for input, hit the network, or print. The guard makes the file safe to import. It's also what makes `python -m pytest` able to import your modules without side effects.

---

## pip — installing libraries

Python's standard library is huge, but for many tasks (HTTP, ML, web frameworks) you'll use third-party packages from **PyPI**.

```bash
pip install requests
pip install pandas
pip install pytest
```

Then:

```python
import requests
r = requests.get("https://example.com")
print(r.status_code)
```

### `pip list` and `pip show`

```bash
pip list                       # see all installed
pip show requests              # see version, location, deps
pip uninstall requests         # remove
```

### Prefer `python -m pip` over bare `pip`

Plain English: on many machines you have more than one Python (system Python, a venv, Homebrew Python...). Bare `pip` might belong to a *different* Python than the one you run code with — so you install a package and then `import` can't find it. Spelling it `python -m pip` guarantees you're installing into the exact interpreter you're about to use.

```bash
python -m pip install requests   # installs into THIS python's site-packages
python -c "import requests; print(requests.__version__)"
```

To see which interpreter and pip you're actually using:

```bash
which python      # macOS/Linux
python -m pip --version   # shows pip version AND the python path it's tied to
```

**Takeaway:** if "I installed it but Python can't import it" ever bites you, switch to `python -m pip install ...` — the pip and the python were mismatched.

### `requirements.txt`

A common convention: list your project's dependencies in a file.

```
# requirements.txt
requests==2.31.0
pandas>=2.0
pytest
```

Install all of them:

```bash
pip install -r requirements.txt
```

When you share your project, others run `pip install -r requirements.txt` to set up.

### Version pinning: `==` vs `>=` vs nothing

| Spec | Meaning | When to use |
|------|---------|-------------|
| `requests==2.31.0` | exactly this version | apps you deploy — reproducible builds |
| `requests>=2.0` | this version or newer | libraries — let users get bug fixes |
| `requests~=2.31.0` | `>=2.31.0, <2.32.0` (compatible release) | want patch updates, not minor bumps |
| `requests` | any version | quick experiments only |

Generate a fully-pinned snapshot of *everything currently installed* (including transitive deps) with:

```bash
pip freeze > requirements.txt
```

`pip freeze` differs from a hand-written `requirements.txt`: freeze records the *exact* resolved versions of all packages, so anyone who installs from it gets a byte-for-byte identical environment. Hand-written files list only your *direct* dependencies and intent.

**Takeaway:** pin exact versions (`==` or `pip freeze`) for apps you ship; use looser bounds (`>=`, `~=`) for libraries you publish.

---

## Virtual environments — isolating projects

If you run two projects, one needs `requests==2.20` and another needs `requests==2.31`, you'll fight forever. Solution: each project gets its own **virtual environment** (venv), an isolated set of packages.

```bash
# In your project directory:
python3 -m venv .venv          # create venv folder
source .venv/bin/activate      # macOS/Linux
# or
.venv\Scripts\activate         # Windows

# Now pip install puts packages here, not globally
pip install requests

# When done:
deactivate
```

Add `.venv/` to your `.gitignore` — don't commit dependencies.

**Modern alternatives:** `uv`, `poetry`, `pipenv`, `pdm`. Same idea, more features. Start with venv; switch when you need to.

### What "activating" actually does

Plain English: a venv is just a folder with its own copy/link of Python and its own empty `site-packages`. "Activating" it edits your shell's `PATH` so that typing `python` or `pip` runs the *venv's* copies instead of the system ones. That's the entire trick — nothing magical, just `PATH` manipulation.

You can prove it:

```bash
$ which python
/usr/bin/python3            # before activating

$ source .venv/bin/activate
(.venv) $ which python
/path/to/project/.venv/bin/python   # after — now it's the venv's python

(.venv) $ pip list
Package    Version
---------- -------
pip        24.0
setuptools 69.0
# a brand-new venv starts almost empty — your global packages are NOT here
```

**Takeaway:** a venv is an isolated `site-packages` plus a `PATH` switch; activation just makes `python`/`pip` point at the venv.

### Gotcha: forgetting to activate

A classic confusion:

```bash
$ python3 -m venv .venv
$ pip install requests        # OOPS: no activate — installed GLOBALLY
$ source .venv/bin/activate
(.venv) $ python -c "import requests"
ModuleNotFoundError: No module named 'requests'
```

You installed into global Python, then activated an empty venv. Fix: activate *first*, then install. (Or use `python -m pip` from inside the activated venv.)

**Takeaway:** activate the venv *before* you `pip install`, or the package lands in the wrong place.

### Cross-question: "Why not just install everything globally and avoid the hassle?"

Three reasons. (1) **Conflicts:** two projects needing different versions of the same package cannot coexist globally. (2) **Reproducibility:** a teammate (or your CI server, or future-you) can recreate the *exact* environment from `requirements.txt`; a polluted global install is a mystery. (3) **Cleanliness:** delete the `.venv/` folder and the project's dependencies vanish — no residue. Global installs are forever.

---

## Testing — why bother

Tests are code that runs your code and checks it does what you expect. Why?

- Catch regressions when you change something.
- Document the expected behavior.
- Refactor with confidence.
- Run a thousand checks in a second; manual testing scales like 100x worse.

If you've never written tests, this is the highest-ROI thing to learn.

### The mental model

Plain English: a test is a tiny experiment. You set up a known situation (the **arrange**), run the thing you're testing (the **act**), and check the result matches what you expected (the **assert**). This "Arrange-Act-Assert" shape keeps tests readable.

```python
def test_add_handles_negatives():
    a, b = -2, 5          # arrange
    result = add(a, b)    # act
    assert result == 3    # assert
```

**Takeaway:** structure each test as Arrange → Act → Assert; one clear behavior per test.

---

## `assert` — the dirt-simple test

```python
def add(a, b):
    return a + b

assert add(2, 3) == 5
assert add(0, 0) == 0
assert add(-1, 1) == 0
print("All passed!")
```

Run with `python tests.py`. If any assert fails, you get an `AssertionError` and the program stops.

This is fine for tiny scripts but doesn't scale. You want a **test framework**.

### Add a message to a bare assert

```python
total = add(2, 3)
assert total == 5, f"expected 5 but got {total}"
```

If it fails you see `AssertionError: expected 5 but got 6` instead of a blank `AssertionError`.

### Gotcha: never put `assert` in production logic

`assert` statements are *stripped out* when Python runs with the `-O` (optimize) flag:

```bash
python -O myscript.py    # all assert statements are skipped!
```

So this is a security bug, not a check:

```python
def withdraw(account, amount):
    assert amount <= account.balance   # DISAPPEARS under -O — overdraft allowed!
    account.balance -= amount
```

Use a real `if ... raise` for runtime validation; reserve `assert` for tests and internal "this should never happen" sanity checks.

```python
def withdraw(account, amount):
    if amount > account.balance:
        raise ValueError("insufficient funds")   # always runs
    account.balance -= amount
```

**Takeaway:** `assert` is for tests and developer sanity checks only; it can be compiled away, so never gate real behavior on it.

---

## pytest — the friendly framework

Install:

```bash
pip install pytest
```

Convention: tests live in files named `test_*.py` or `*_test.py`. Functions start with `test_`.

```python
# test_math_utils.py
from math_utils import square

def test_square_positive():
    assert square(3) == 9

def test_square_zero():
    assert square(0) == 0

def test_square_negative():
    assert square(-4) == 16
```

Run:

```bash
pytest
```

Output:

```
collected 3 items

test_math_utils.py ...                                          [100%]

============== 3 passed in 0.01s ==============
```

A `.` per passing test. `F` for failure, with full stack trace.

### Why pytest beats `assert`

- Auto-discovers tests.
- Pretty error messages: shows actual vs expected.
- Fixtures (shared setup).
- Parametrize (run same test on many inputs).
- Plugins for everything.

### Handy command-line flags

```bash
pytest -v                       # verbose: one line per test with its name
pytest -q                       # quiet: minimal output
pytest test_math_utils.py       # run one file
pytest test_math_utils.py::test_square_zero   # run one specific test
pytest -k "zero or negative"    # run tests whose name matches the expression
pytest -x                       # stop at the FIRST failure
pytest --lf                     # re-run only the tests that failed last time
pytest -s                       # don't capture stdout (let your print()s show)
```

`-k` and `--lf` are the two that save the most time during day-to-day debugging: narrow to the failing test, fix, re-run just that one.

**Takeaway:** learn `-v`, `-k`, `-x`, and `--lf` early — they turn a slow whole-suite cycle into a tight focused loop.

### Cross-question: "Why does pytest let me use plain `assert`? Don't other frameworks need `assertEqual`?"

Yes — Python's built-in `unittest` makes you write `self.assertEqual(a, b)`, `self.assertTrue(x)`, etc. pytest performs *assertion rewriting*: it inspects the bytecode of your `assert a == b` and reconstructs a rich failure message showing both sides. So you get readable failures *and* plain, readable test code. That's the headline reason most of the ecosystem standardized on pytest over `unittest`.

---

## Better assertions

```python
def test_strange():
    result = compute(input)
    assert result == expected_value
```

If it fails, pytest shows you both sides:

```
>   assert result == expected_value
E   assert {'a': 1, 'b': 3} == {'a': 1, 'b': 2}
E     Differing items:
E     {'b': 3} != {'b': 2}
```

vs. `assert` from a script which just says `AssertionError`. pytest is way better at telling you what went wrong.

### Comparing floats — don't use `==`

Floating-point math is inexact, so `0.1 + 0.2 == 0.3` is `False`. Use `pytest.approx`:

```python
import pytest

def test_float_math():
    assert 0.1 + 0.2 == pytest.approx(0.3)     # passes
    # assert 0.1 + 0.2 == 0.3                   # would FAIL: 0.30000000000000004
```

**Takeaway:** compare floating-point results with `pytest.approx`, never bare `==`.

---

## Parametrize — same test, many inputs

```python
import pytest

@pytest.mark.parametrize("inp,expected", [
    (0, 0),
    (1, 1),
    (2, 4),
    (3, 9),
    (-4, 16),
])
def test_square(inp, expected):
    assert square(inp) == expected
```

5 test cases from one function. pytest reports each separately. If `(2, 4)` fails, you see it immediately.

### Why not just a loop inside one test?

You *could* write:

```python
def test_square_loop():
    for inp, expected in [(0,0),(1,1),(2,4),(3,9),(-4,16)]:
        assert square(inp) == expected   # stops at the FIRST bad case
```

But this is worse: the loop **stops at the first failure**, so if cases `2` and `4` are both broken you only learn about one. It also reports as a single test. `parametrize` runs each case independently — you see *all* failures, each with its own name like `test_square[2-4]`.

**Takeaway:** prefer `@pytest.mark.parametrize` over an in-test loop; you get independent cases, individual names, and all failures reported.

### Labelling cases with `ids`

```python
@pytest.mark.parametrize(
    "text,expected",
    [("racecar", True), ("hello", False)],
    ids=["palindrome", "not-palindrome"],
)
def test_is_palindrome(text, expected):
    assert is_palindrome(text) == expected
```

Now failures read `test_is_palindrome[not-palindrome]` instead of cryptic auto-generated ids.

---

## Fixtures — shared setup

A fixture is a function that produces something a test needs (a database, a file, an object).

```python
import pytest

@pytest.fixture
def sample_user():
    return {"name": "Alice", "age": 30}


def test_user_name(sample_user):
    assert sample_user["name"] == "Alice"

def test_user_age(sample_user):
    assert sample_user["age"] == 30
```

pytest sees a parameter called `sample_user`, finds the fixture with that name, calls it, passes the result. Each test gets a fresh value.

### Fixture with cleanup

```python
@pytest.fixture
def temp_file(tmp_path):
    path = tmp_path / "test.txt"
    path.write_text("hello")
    yield path                # value handed to the test
    # after `yield`: cleanup
    if path.exists():
        path.unlink()
```

`yield` splits the fixture: setup before, cleanup after. Combined with `tmp_path` (a pytest built-in fixture giving a temp dir), tests don't pollute disk.

### Fixture scope — how often does setup run?

By default a fixture runs *once per test function*. For expensive setup (spin up a database, start a server) you can widen the scope so it runs once per module or once per whole session:

```python
@pytest.fixture(scope="session")
def db_connection():
    conn = connect_to_test_db()    # runs ONCE for the entire test run
    yield conn
    conn.close()
```

| scope | created... |
|-------|-----------|
| `function` (default) | before each test function |
| `class` | once per test class |
| `module` | once per test file |
| `session` | once for the whole `pytest` run |

Wider scope is faster but riskier: if a session-scoped object holds mutable state, one test can leak into the next. Keep mutable fixtures function-scoped.

**Takeaway:** widen fixture scope only for expensive, read-only setup; keep anything mutable at the default `function` scope so tests stay independent.

### `conftest.py` — fixtures shared across files

If several test files need the same fixture, put it in a file named `conftest.py` at the test directory root. pytest discovers it automatically — no import needed.

```python
# tests/conftest.py
import pytest

@pytest.fixture
def sample_user():
    return {"name": "Alice", "age": 30}
```

Every test in `tests/` (and subfolders) can now request `sample_user` without importing anything.

**Takeaway:** `conftest.py` is the shared-fixture cupboard; pytest finds it for you.

---

## Testing exceptions

```python
def divide(a, b):
    if b == 0:
        raise ValueError("can't divide by zero")
    return a / b


def test_divide_by_zero():
    with pytest.raises(ValueError, match="zero"):
        divide(10, 0)
```

`pytest.raises` makes the test pass if (and only if) the exception is raised, with optional message check.

### Gotcha: testing that something does NOT raise

There is no `pytest.does_not_raise` by default — you simply *call it without a `with` block*. If it raises, the test fails naturally:

```python
def test_divide_normal():
    assert divide(10, 2) == 5.0    # if divide() raised, the test fails on its own
```

Also note `match` is a **regex**, not a substring — special characters matter:

```python
with pytest.raises(ValueError, match=r"can't divide by zero"):  # '.' etc. are regex
    divide(1, 0)
```

**Takeaway:** wrap *only* the line that should raise inside `pytest.raises`; for "should not raise," just call it plainly. Remember `match` is regex.

---

## Worked example — small project structure

```
calc_project/
├── README.md
├── requirements.txt
├── .gitignore
├── calc/
│   ├── __init__.py
│   ├── ops.py
│   └── cli.py
└── tests/
    ├── __init__.py
    ├── test_ops.py
    └── test_cli.py
```

`calc/ops.py`:

```python
def add(a, b): return a + b
def sub(a, b): return a - b
def mul(a, b): return a * b

def div(a, b):
    if b == 0:
        raise ZeroDivisionError("div by zero")
    return a / b
```

`tests/test_ops.py`:

```python
import pytest
from calc.ops import add, sub, mul, div

def test_add():
    assert add(2, 3) == 5

@pytest.mark.parametrize("a,b,expected", [
    (10, 3, 7),
    (0, 0, 0),
    (-5, 5, -10),
])
def test_sub(a, b, expected):
    assert sub(a, b) == expected

def test_div_by_zero():
    with pytest.raises(ZeroDivisionError):
        div(1, 0)
```

Run from the project root:

```bash
pytest
```

That's the shape of essentially every Python project.

### Gotcha: "ModuleNotFoundError: No module named 'calc'" when running tests

This is the number-one beginner pytest snag. It happens when you run `pytest` from *inside* the `tests/` folder, or your project root isn't on `sys.path`. Three robust fixes, in order of preference:

1. **Run from the project root** (the folder that *contains* `calc/` and `tests/`):
   ```bash
   cd calc_project
   python -m pytest          # `python -m` puts the current dir on sys.path
   ```
2. **Install your package in editable mode** so `calc` is importable everywhere:
   ```bash
   pip install -e .          # needs a pyproject.toml / setup.py
   ```
3. Keep the `tests/__init__.py` consistent with how you invoke pytest (mixing presence/absence of `__init__.py` across folders confuses discovery).

`python -m pytest` (note the `python -m`) is the most reliable one-liner because it prepends the current directory to `sys.path`, so `import calc` resolves.

**Takeaway:** run tests with `python -m pytest` from the project root; the import error almost always means the root wasn't on `sys.path`.

---

## Common mistakes

### 1. Circular imports

```python
# a.py
from b import foo

# b.py
from a import bar
```

Each tries to import the other before finishing — explosion. Restructure: pull the shared bits into a third module.

What you actually see is something like:

```
ImportError: cannot import name 'bar' from partially initialized module 'a'
(most likely due to a circular import)
```

Plain English: `a` starts running, hits `from b import foo`, so Python pauses `a` and runs `b`. But `b` immediately does `from a import bar` — and `a` hasn't finished defining `bar` yet (it's still stuck on line 1). Deadlock.

Fixes, in order of preference:
- **Extract** the shared thing both need into a third module `c.py`; have `a` and `b` both import `c`.
- **Import inside the function** instead of at module top, deferring it until both modules are fully loaded:
  ```python
  # a.py
  def use_foo():
      from b import foo   # imported lazily, only when called
      return foo()
  ```

**Takeaway:** circular imports are a *design smell*; fix the structure (extract a shared module) rather than papering over it, but a lazy in-function import is a valid escape hatch.

### 2. Mutating module-level state

```python
# config.py
settings = {}    # module-level dict

# main.py
import config
config.settings["debug"] = True

# other_file.py
import config
print(config.settings["debug"])    # True (shared!)
```

This is sometimes useful (singleton-style config) but causes order-dependent bugs. Be aware.

### 3. Import side effects

```python
# bad_module.py
print("loaded!")    # prints every time anyone imports it
DB = connect()      # connects on import
```

Don't do significant work at import time. Wrap in `if __name__ == "__main__":` or in a function.

Why this hurts in practice: your test suite *imports* your modules to test them. If importing `bad_module` opens a database connection, then *collecting* the tests (before any test even runs) tries to hit the database — slow, flaky, and impossible to run offline. Keep import time cheap and side-effect-free; do real work inside functions you call explicitly.

### 4. Tests touching real services

A test that hits real Stripe / real DB is slow and flaky. Mock external calls:

```python
def test_charge(mocker):    # pytest-mock plugin
    mock_stripe = mocker.patch("myapp.stripe_client.charge")
    mock_stripe.return_value = {"id": "ch_test"}

    result = my_function()
    assert result == "ch_test"
```

Same idea using only the standard library (no plugin):

```python
from unittest.mock import patch

def test_charge_stdlib():
    with patch("myapp.stripe_client.charge") as mock_charge:
        mock_charge.return_value = {"id": "ch_test"}
        result = my_function()
    assert result == "ch_test"
    mock_charge.assert_called_once()
```

**Gotcha — patch where it's *used*, not where it's defined.** This trips up almost everyone:

```python
# myapp/billing.py
from myapp.stripe_client import charge   # billing imported its OWN reference

def run():
    return charge(100)
```

```python
# WRONG — patches the original, but billing already grabbed its own name
patch("myapp.stripe_client.charge")

# RIGHT — patch the name in the module that USES it
patch("myapp.billing.charge")
```

Because `billing.py` did `from ... import charge`, it has a local name `billing.charge`; patching the source module doesn't touch that local binding (this is the same "snapshot" behavior from the import section earlier).

**Takeaway:** mock external services so tests are fast and offline; always patch the name in the *consuming* module, not where the function was originally defined.

### 5. Tests depending on each other

If test A needs to run before test B, you have a bug. Tests should run in any order. Use fixtures for shared setup, not test ordering.

You can flush out hidden ordering dependencies by shuffling:

```bash
pip install pytest-randomly
pytest                       # now runs tests in a random order each run
```

If a green suite suddenly goes red under random order, you had a hidden inter-test dependency.

---

## Idioms and best practices (and when NOT to)

- **One assert per behavior, not per line.** It's fine to have several `assert`s in a test if they verify *one* behavior; split into separate tests when they verify *different* behaviors.
- **Test names describe the scenario:** `test_divide_by_zero_raises`, not `test_divide_2`. The name should read like a sentence about what's guaranteed.
- **Keep imports at the top of the file** (PEP 8), grouped: standard library, then third-party, then your own modules, with a blank line between groups. The exception is the lazy in-function import to break a circular dependency.
- **Don't over-mock.** Mocking your *own* code usually means you're testing the mock, not the logic. Mock the *boundary* (network, disk, clock, third-party API); test your real code against it.
- **Don't chase 100% coverage as a goal.** Coverage tells you what *ran*, not what's *correct*. A test that calls a function but asserts nothing scores 100% coverage and catches zero bugs. Aim for tests that would fail if the behavior broke.
- **When NOT to write a test:** truly throwaway one-off scripts, or trivial getters with no logic. Everything you'll run more than twice, or that others depend on, deserves tests.
- **When NOT to make a package:** a single 50-line utility doesn't need a folder with `__init__.py`. Reach for packages when a flat pile of modules gets hard to navigate.

---

## Quick reference

```bash
# environment
python3 -m venv .venv && source .venv/bin/activate   # create + activate (macOS/Linux)
python -m pip install -r requirements.txt            # install deps reliably
pip freeze > requirements.txt                        # snapshot exact versions
deactivate                                           # leave the venv

# testing
python -m pytest                 # run all tests from project root
pytest -v                        # verbose
pytest -k "name_fragment"        # filter by name
pytest -x --lf                   # stop on first failure; re-run last failures
```

```python
# the four pytest features you'll use daily
def test_value():                       # 1. plain assert
    assert f(2) == 4

@pytest.mark.parametrize("x,y", [...])   # 2. many inputs
def test_many(x, y): ...

@pytest.fixture                          # 3. shared setup
def thing(): yield make_thing()

with pytest.raises(ValueError):          # 4. expected errors
    f(bad_input)
```

---

## Exercises

1. **Build a `temperature` package.** Create `temperature/__init__.py` and `temperature/converters.py` with `c_to_f`, `f_to_c`. Write tests covering a few values and edge cases.
2. **Set up a venv** for a project. Install `requests` in it. Verify `pip list` only shows packages in this venv.
3. **Fixture-based tests.** Write a `Counter` class with `inc()` and `value()` methods. Use a fixture to produce a fresh counter for each test.
4. **Parametrize a tricky function.** Write `is_palindrome(s)` and write at least 6 parametrized cases (empty, single char, "racecar", "Racecar", with spaces, not a palindrome).
5. **Reproduce the shadowing bug.** Create a file `random.py` that does `import random; print(random.randint(1, 10))`, run it, observe the `AttributeError`, then rename the file and confirm it works. Explain (one sentence) why `sys.path` order caused it.
6. **Break and fix a circular import.** Make `a.py` and `b.py` import each other at top level, observe the error, then fix it by extracting the shared piece into `c.py`. Confirm both import cleanly.

### Hint for #1

```
temperature/
├── __init__.py
└── converters.py

tests/
└── test_converters.py
```

```python
# temperature/converters.py
def c_to_f(c): return c * 9/5 + 32
def f_to_c(f): return (f - 32) * 5/9
```

```python
# tests/test_converters.py
from temperature.converters import c_to_f, f_to_c

def test_c_to_f_zero(): assert c_to_f(0) == 32
def test_c_to_f_boil(): assert c_to_f(100) == 212
def test_roundtrip(): assert abs(f_to_c(c_to_f(50)) - 50) < 0.01
```

### Hint for #3

```python
# counter.py
class Counter:
    def __init__(self):
        self._n = 0
    def inc(self):
        self._n += 1
    def value(self):
        return self._n
```

```python
# test_counter.py
import pytest
from counter import Counter

@pytest.fixture
def counter():
    return Counter()          # a FRESH counter for every test

def test_starts_at_zero(counter):
    assert counter.value() == 0

def test_inc(counter):
    counter.inc()
    counter.inc()
    assert counter.value() == 2   # independent of the test above
```

The point of the fixture: each test gets its own counter, so `test_inc` leaving the counter at `2` can never affect `test_starts_at_zero`.

---

## What to read next

- Next in this track: `Foundations/Programming/Python/10-file-io-json-http.md` — reading/writing files, JSON, and making HTTP requests with the `requests` library you just learned to install.
- Then `11-stdlib-tour.md` for a guided tour of the batteries-included standard-library modules.
- Official docs worth bookmarking: the Python tutorial section on [Modules](https://docs.python.org/3/tutorial/modules.html), the [`venv`](https://docs.python.org/3/library/venv.html) module, and the [pytest documentation](https://docs.pytest.org/) (start with "Get Started" and "How to use fixtures").

```
→ Foundations/Programming/Python/10-file-io-json-http.md
```

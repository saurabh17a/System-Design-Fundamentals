# 11 — Standard Library Tour

> **Prerequisites:** `10-file-io-json-http.md`.
> **Time to read:** 30 minutes (skim; come back when needed).

Python ships with hundreds of modules. This is a tour of the ones you'll actually use. Bookmark this doc.

---

## `datetime` — dates and times

```python
from datetime import datetime, date, time, timedelta

now = datetime.now()              # 2026-05-17 14:30:00.123
today = date.today()              # 2026-05-17

# Specific datetimes
d = datetime(2026, 12, 25, 10, 0)

# Math
tomorrow = today + timedelta(days=1)
five_hours_ago = now - timedelta(hours=5)

# Comparisons
if d > today:
    print("future")

# Format → string
print(now.strftime("%Y-%m-%d %H:%M:%S"))    # 2026-05-17 14:30:00
print(now.isoformat())                       # 2026-05-17T14:30:00.123

# Parse string → datetime
parsed = datetime.strptime("2026-12-25", "%Y-%m-%d")

# UTC vs local
from datetime import timezone
now_utc = datetime.now(timezone.utc)
```

**Common gotcha:** `datetime.now()` returns a *naive* datetime (no timezone). Use `datetime.now(timezone.utc)` for anything serious.

### Format codes (cheatsheet)

| Code | Meaning | Example |
|---|---|---|
| `%Y` | year (4 digits) | 2026 |
| `%m` | month (01-12) | 05 |
| `%d` | day (01-31) | 17 |
| `%H` | hour 24h (00-23) | 14 |
| `%M` | minute (00-59) | 30 |
| `%S` | second (00-59) | 45 |
| `%A` | weekday name | Saturday |
| `%B` | month name | May |

---

## `os` — operating system interface

```python
import os

os.getcwd()                       # current working directory
os.chdir("/tmp")                  # change dir
os.listdir(".")                   # list files (just names)
os.makedirs("a/b/c", exist_ok=True)    # mkdir -p
os.remove("file.txt")             # delete file
os.rmdir("empty_dir")             # delete empty dir

# Environment variables
os.environ["HOME"]                # /Users/alice
os.environ.get("DEBUG", "0")      # default if not set
os.environ["MY_VAR"] = "value"    # set

# Run a shell command (prefer subprocess for real work)
os.system("ls -la")
```

For paths, prefer **pathlib** (covered in doc 10) over `os.path`. But `os.environ` is the standard way to read env vars.

---

## `pathlib` — paths done right

Already covered in doc 10. Quick recap:

```python
from pathlib import Path

Path.cwd()                                # current dir
Path.home()                               # home dir

p = Path("data") / "file.txt"             # join
p.exists(), p.is_file(), p.is_dir()
p.read_text(); p.write_text("hello")
p.read_bytes(); p.write_bytes(b"...")

p.parent, p.name, p.stem, p.suffix
p.with_suffix(".bak")                     # data/file.bak

# Glob
list(Path(".").glob("*.py"))              # all .py in current dir
list(Path(".").rglob("*.py"))             # recursive
```

---

## `re` — regular expressions

```python
import re

# Search
m = re.search(r"\d+", "abc 123 def 456")
print(m.group())                  # 123

# Find all matches
re.findall(r"\d+", "abc 123 def 456")    # ['123', '456']

# Replace
re.sub(r"\d+", "X", "abc 123 def 456")    # 'abc X def X'

# Split on a pattern
re.split(r"\s+", "  hello  world  ")      # ['', 'hello', 'world', '']

# Match groups
m = re.match(r"(\w+)@(\w+\.\w+)", "alice@example.com")
print(m.group(0))    # alice@example.com (whole match)
print(m.group(1))    # alice
print(m.group(2))    # example.com
```

### Common patterns

| Pattern | Matches |
|---|---|
| `\d` | digit (0-9) |
| `\w` | word char (letter, digit, underscore) |
| `\s` | whitespace |
| `.` | any char (except newline) |
| `^` | start |
| `$` | end |
| `*` | 0 or more |
| `+` | 1 or more |
| `?` | 0 or 1 |
| `{n}` | exactly n |
| `{n,m}` | n to m |
| `[abc]` | a, b, or c |
| `[^abc]` | NOT a, b, or c |
| `(...)` | group |
| `\|` | or |

### Tip

Regex is powerful but easy to overuse. For "starts with X" or "contains Y", string methods (`startswith`, `in`) are simpler and faster.

---

## `collections` — better data structures

### `Counter`

```python
from collections import Counter

c = Counter("mississippi")
print(c)                              # Counter({'i': 4, 's': 4, 'p': 2, 'm': 1})
print(c.most_common(2))               # [('i', 4), ('s', 4)]

# Words in text
words = "the quick brown fox the lazy dog".split()
Counter(words).most_common()          # [('the', 2), ('quick', 1), ...]
```

### `defaultdict`

A dict that creates a default value on missing key:

```python
from collections import defaultdict

groups = defaultdict(list)
for word in ["apple", "ant", "banana", "berry"]:
    groups[word[0]].append(word)
# {'a': ['apple', 'ant'], 'b': ['banana', 'berry']}

counts = defaultdict(int)
for c in "hello":
    counts[c] += 1                     # no KeyError
```

### `deque` — double-ended queue

```python
from collections import deque

q = deque([1, 2, 3])
q.append(4)         # add to right
q.appendleft(0)     # add to left
q.pop()             # remove from right
q.popleft()         # remove from left

# O(1) on both ends. list.pop(0) is O(n).
```

Use `deque` when you need a queue (FIFO).

### `OrderedDict`

In Python 3.7+, regular `dict` already preserves insertion order. `OrderedDict` is rarely needed; sometimes used for explicit semantics or `move_to_end()`:

```python
from collections import OrderedDict
od = OrderedDict([("a", 1), ("b", 2), ("c", 3)])
od.move_to_end("a")    # OrderedDict([('b', 2), ('c', 3), ('a', 1)])
```

---

## `itertools` — iterator utilities

Lazy iterators — they generate values on demand. Great for memory.

### Counting and infinite

```python
from itertools import count, cycle, repeat

# Infinite — take what you need
for i in count(10, 2):    # 10, 12, 14, 16, ...
    if i > 20: break
    print(i)

# Cycle through values forever
for c in cycle("ABC"):    # A, B, C, A, B, C, ...
    ...

# Repeat n times
list(repeat("x", 5))      # ['x', 'x', 'x', 'x', 'x']
```

### Chain — flatten

```python
from itertools import chain

list(chain([1, 2], [3, 4], [5]))    # [1, 2, 3, 4, 5]
```

### Pair-wise

```python
from itertools import pairwise    # 3.10+

list(pairwise([1, 2, 3, 4]))      # [(1, 2), (2, 3), (3, 4)]
```

### Combinations and permutations

```python
from itertools import combinations, permutations

list(combinations("ABC", 2))      # [('A','B'), ('A','C'), ('B','C')]
list(permutations("ABC", 2))      # [('A','B'), ('A','C'), ('B','A'), ('B','C'), ('C','A'), ('C','B')]
```

### Group consecutive equal elements

```python
from itertools import groupby

data = [("a", 1), ("a", 2), ("b", 3), ("a", 4)]
for key, group in groupby(data, key=lambda x: x[0]):
    print(key, list(group))
# a [('a', 1), ('a', 2)]
# b [('b', 3)]
# a [('a', 4)]
```

`groupby` only groups *consecutive* elements. Sort first if you want all groups together.

### `accumulate` — running sums (or any reduction)

```python
from itertools import accumulate
import operator

list(accumulate([1, 2, 3, 4]))                   # [1, 3, 6, 10]
list(accumulate([1, 2, 3, 4], operator.mul))      # [1, 2, 6, 24]
```

---

## `functools` — function utilities

### `lru_cache` — memoize a function

```python
from functools import lru_cache

@lru_cache(maxsize=None)
def fib(n):
    if n < 2: return n
    return fib(n-1) + fib(n-2)

print(fib(100))    # fast, results cached
```

### `cache` — newer, no max size (3.9+)

```python
from functools import cache

@cache
def expensive_call(x):
    ...
```

### `partial` — pre-fill arguments

```python
from functools import partial

def greet(greeting, name):
    return f"{greeting}, {name}!"

hi = partial(greet, "Hi")
hello = partial(greet, "Hello")

print(hi("Alice"))      # Hi, Alice!
print(hello("Bob"))     # Hello, Bob!
```

### `reduce` — fold a sequence

```python
from functools import reduce

# Sum (use sum() for this; reduce shown for illustration)
total = reduce(lambda a, b: a + b, [1, 2, 3, 4])    # 10

# Find max
maxv = reduce(lambda a, b: a if a > b else b, [3, 7, 2, 9])    # 9
```

### `wraps` — preserve metadata in decorators

```python
from functools import wraps

def my_decorator(fn):
    @wraps(fn)    # copies __name__, __doc__ from fn
    def wrapper(*args, **kwargs):
        return fn(*args, **kwargs)
    return wrapper
```

Without `@wraps`, decorated functions lose their original name/docstring.

---

## `csv` — read/write CSV

```python
import csv

# Read
with open("data.csv") as f:
    reader = csv.DictReader(f)
    for row in reader:
        print(row)    # {'name': 'Alice', 'age': '30'}

# Write
with open("out.csv", "w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=["name", "age"])
    writer.writeheader()
    writer.writerow({"name": "Alice", "age": 30})
    writer.writerow({"name": "Bob", "age": 25})
```

For tabular data, also consider `pandas` (3rd party).

---

## `argparse` — command-line arguments

```python
import argparse

parser = argparse.ArgumentParser(description="My tool")
parser.add_argument("input_file")
parser.add_argument("--verbose", "-v", action="store_true")
parser.add_argument("--limit", type=int, default=10)
args = parser.parse_args()

print(args.input_file, args.verbose, args.limit)
```

Run:
```bash
python tool.py file.txt --verbose --limit 50
```

argparse generates `--help` automatically. Real-world tools use `click` or `typer` for fancier CLIs.

---

## `logging` — proper logs

```python
import logging

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(levelname)s] %(message)s")

logging.debug("detailed: x = %s", 42)    # not shown (DEBUG below INFO)
logging.info("hello")                     # shown
logging.warning("watch out")
logging.error("uh oh")
logging.exception("an exception")         # logs full traceback
```

Levels: `DEBUG < INFO < WARNING < ERROR < CRITICAL`. Set the level once; only messages at that level or higher show.

Use `logging` instead of `print()` for anything you might run in production. You can change verbosity, route to files, format consistently.

---

## `random` — randomness

```python
import random

random.random()                          # float in [0, 1)
random.randint(1, 6)                     # int in [1, 6] inclusive
random.choice(["a", "b", "c"])
random.sample([1, 2, 3, 4, 5], 3)        # 3 distinct choices
random.shuffle(my_list)                  # in-place

random.seed(42)                          # reproducibility for tests
```

For cryptography use `secrets`, not `random`:

```python
import secrets
token = secrets.token_hex(16)            # secure random hex string
```

---

## `subprocess` — run shell commands

```python
import subprocess

# Run and get output
result = subprocess.run(
    ["ls", "-la"],
    capture_output=True,
    text=True,
)
print(result.stdout)
print(result.returncode)

# Raise on failure
subprocess.run(["false"], check=True)    # raises CalledProcessError
```

Avoid `shell=True` unless you trust the input — it's a command-injection risk.

---

## Exercises

1. **Daily log analyzer.** Read a log file. Use `re` to extract timestamps. Use `Counter` to find the busiest hour. Print top 5.
2. **CSV → JSON converter.** Use `csv` and `json` to convert a CSV file to JSON. Use `argparse` for `--input` and `--output` paths.
3. **Combination iterator.** Use `itertools.combinations` to find all 3-card hands from a deck of 52 cards. Print the first 10.
4. **Memoized factorial.** Use `lru_cache` to make a recursive factorial. Time it before and after caching.

### Hint for #1

```python
from pathlib import Path
from collections import Counter
import re

hours = []
for line in Path("app.log").read_text().splitlines():
    m = re.search(r"(\d{2}):\d{2}:\d{2}", line)
    if m:
        hours.append(m.group(1))

for hour, count in Counter(hours).most_common(5):
    print(f"{hour}:00 — {count}")
```

---

## What's next

```
→ Foundations/Programming/Python/12-generics-typing-iterators.md
```

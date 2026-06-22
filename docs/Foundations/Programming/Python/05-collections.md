# 05 — Collections: Lists, Tuples, Dicts, Sets

> **Prerequisites:** `04-functions.md`.
> **Time to read:** 35 minutes.

You've used variables for single values. **Collections** hold multiple values. Python has 4 main built-in collections.

### Plain-English version first

Imagine you're organising stuff in your room:

- A **list** is like a numbered shelf. Things sit in order, you can add or remove books, and you can have two copies of the same book. You find a book by its shelf position (index 0, 1, 2, …).
- A **tuple** is like a *sealed* gift box with slots — `(name, age)`. Once packed, you can't swap what's inside. It's perfect for things that naturally come as a fixed group and shouldn't change.
- A **dict** (dictionary) is like a real dictionary or a phone book: you look up a *word* (the **key**) to get its *definition* (the **value**). You never search page by page — you jump straight to the entry.
- A **set** is like a bag of unique stickers. Duplicates collapse into one, there's no "first" or "second" sticker, and the only question you usually ask is "is this sticker in the bag?"

The precise version: lists and tuples are **sequences** (indexed by integer position). Dicts and sets are backed by a **hash table** — they trade ordering and "search by position" for near-instant lookup. We'll unpack what "hashable" means and why it matters, because it's the single idea that explains most of the rules below.

---

## Quick comparison

| Type | Ordered | Mutable | Duplicates | Use when… |
|---|---|---|---|---|
| `list` | yes | yes | yes | sequence of items, may grow/shrink |
| `tuple` | yes | **no** | yes | fixed group of items, e.g. coordinates |
| `dict` | yes (insertion) | yes | keys unique | key → value lookups |
| `set` | no | yes | **no** | unique items, fast membership tests |

> **"Ordered" subtlety.** As of **Python 3.7** (guaranteed by the language spec; it was a 3.6 implementation detail in CPython), `dict` preserves *insertion order* — the order you added keys is the order you iterate them. It is **not** sorted order. A `set` has **no** reliable order at all; never rely on the order items print in. If you need a dict-like structure but want explicit ordering control (e.g. move-to-end), `collections.OrderedDict` still exists and adds `move_to_end()`/`popitem(last=...)`.

> **Mental rule of thumb for the whole table:** *mutable means it can change after creation; hashable means it can be a dict key or a set member.* `list`, `dict`, and `set` are mutable, therefore unhashable, therefore can't be dict keys or set members. `tuple` (of hashable things), `str`, `int`, `frozenset` are hashable.

---

## `list` — ordered, mutable sequence

**Plain English:** a list is your everyday "bunch of things in a row." You reach for a list ~80% of the time.

**Technical:** an ordered, mutable, heterogeneous (mixed-type) sequence implemented as a **dynamic array** (a contiguous block of pointers that grows as needed). Indexing and `append` are O(1) on average; inserting/removing at the front is O(n) because everything shifts.

```python
fruits = ["apple", "banana", "cherry"]
print(fruits[0])     # apple
print(fruits[-1])    # cherry (last)
print(len(fruits))   # 3
```

*Takeaway: index from `0`; negative indices count from the end.*

### Modifying a list

```python
fruits = ["apple", "banana"]

# Add to end
fruits.append("cherry")
# ['apple', 'banana', 'cherry']

# Insert at index
fruits.insert(0, "kiwi")
# ['kiwi', 'apple', 'banana', 'cherry']

# Replace
fruits[0] = "mango"
# ['mango', 'apple', 'banana', 'cherry']

# Remove by value
fruits.remove("apple")
# ['mango', 'banana', 'cherry']

# Remove by index
del fruits[0]
# ['banana', 'cherry']

# Remove and return last
last = fruits.pop()
# fruits is now ['banana']; last = 'cherry'
```

#### `append` vs `extend` vs `+` — a classic mix-up

```python
a = [1, 2]
a.append([3, 4])      # adds ONE item (the list itself)
print(a)              # [1, 2, [3, 4]]

b = [1, 2]
b.extend([3, 4])      # adds EACH item
print(b)              # [1, 2, 3, 4]

c = [1, 2] + [3, 4]   # makes a NEW list, leaves originals alone
print(c)              # [1, 2, 3, 4]
```

*Takeaway: `append` adds one element; `extend` (and `+`) splices in many.*

### Slicing

```python
nums = [10, 20, 30, 40, 50]

print(nums[1:4])    # [20, 30, 40]   (indexes 1, 2, 3)
print(nums[:3])     # [10, 20, 30]
print(nums[2:])     # [30, 40, 50]
print(nums[:])      # [10, 20, 30, 40, 50] -- shallow copy
print(nums[::-1])   # [50, 40, 30, 20, 10] -- reversed
print(nums[::2])    # [10, 30, 50] -- every other
```

Slicing **does not modify** the original. It returns a new list.

The full slice form is `seq[start:stop:step]`. `start` is inclusive, `stop` is **exclusive**, and slices never raise `IndexError` even if they run off the end:

```python
nums = [10, 20, 30, 40, 50]
print(nums[2:100])   # [30, 40, 50]  -- clamped, no error
print(nums[100:])    # []            -- empty, no error
print(nums[-2:])     # [40, 50]      -- last two
```

*Takeaway: `stop` is exclusive, slices are forgiving, and `[:]` / `list(x)` make a (shallow) copy.*

You can also **assign to a slice** to splice content in or out — something indexing alone can't do:

```python
nums = [10, 20, 30, 40, 50]
nums[1:3] = [99]          # replace 2 items with 1
print(nums)               # [10, 99, 40, 50]

nums[1:1] = [7, 8]        # insert without removing anything
print(nums)               # [10, 7, 8, 99, 40, 50]
```

*Takeaway: slice assignment can grow or shrink a list in place.*

### Other useful list operations

```python
nums = [3, 1, 4, 1, 5, 9, 2, 6]

# Sort in place (modifies the list)
nums.sort()
# [1, 1, 2, 3, 4, 5, 6, 9]

# Sort but return a new list (original unchanged)
sorted_nums = sorted(nums, reverse=True)

# Reverse in place
nums.reverse()

# Find index of first occurrence
nums.index(4)       # 4 (or ValueError if not found)

# Count occurrences
nums.count(1)       # 2

# Membership test
3 in nums          # True
99 in nums         # False

# Concatenate
[1, 2] + [3, 4]    # [1, 2, 3, 4]

# Repeat
[0] * 5            # [0, 0, 0, 0, 0]
```

#### `sort()` vs `sorted()` — and the `key` argument

This trips up almost everyone once.

```python
data = [3, 1, 2]

result = data.sort()      # returns None! sorts data in place
print(result)             # None  <-- the bug
print(data)               # [1, 2, 3]

result = sorted(data)     # returns a NEW sorted list
print(result)             # [1, 2, 3]
```

`.sort()` mutates and returns `None` (the convention for in-place mutators in Python). `sorted()` leaves the input alone and hands back a new list, so it works on *any* iterable (tuples, dict keys, generators), not just lists.

The `key=` argument controls *what to sort by* — give it a function applied to each element:

```python
words = ["banana", "kiwi", "apple", "fig"]

print(sorted(words, key=len))            # ['fig', 'kiwi', 'apple', 'banana'] (by length)
print(sorted(words, key=str.lower))      # case-insensitive alphabetical

people = [("Alice", 30), ("Bob", 25), ("Carol", 35)]
print(sorted(people, key=lambda p: p[1]))
# [('Bob', 25), ('Alice', 30), ('Carol', 35)]   -- by age
```

Python's sort is **stable**: items that compare equal keep their original relative order. This lets you sort by multiple criteria with successive sorts (sort by the *least* significant key first), or with a tuple key:

```python
people = [("Bob", 30), ("Alice", 30), ("Carol", 25)]
# sort by age, then name as tiebreaker
print(sorted(people, key=lambda p: (p[1], p[0])))
# [('Carol', 25), ('Alice', 30), ('Bob', 30)]
```

*Takeaway: `x.sort()` returns `None` and mutates; `sorted(x)` returns a new list. Use `key=` to sort by a derived value.*

### Pitfall: shallow copy with `*`

```python
matrix = [[0] * 3] * 3      # DON'T DO THIS
# [[0, 0, 0], [0, 0, 0], [0, 0, 0]]   -- looks fine

matrix[0][0] = 1
print(matrix)
# [[1, 0, 0], [1, 0, 0], [1, 0, 0]]   -- ALL rows changed!
```

`* 3` creates 3 references to the same inner list. Use a list comprehension instead:

```python
matrix = [[0] * 3 for _ in range(3)]
matrix[0][0] = 1
# [[1, 0, 0], [0, 0, 0], [0, 0, 0]]   -- correct
```

> **Why?** `[[0] * 3] * 3` makes the *outer* list hold the *same inner list object* three times. Mutating through one "row" mutates the one and only list. The comprehension runs `[0] * 3` afresh on each loop, producing three distinct inner lists. `[0] * 3` itself is safe because integers are immutable — there's nothing shared to corrupt. The rule generalises: **`*` repetition is dangerous only when the repeated element is mutable.**

### Shallow vs deep copy (the next layer of the same trap)

`list(x)`, `x[:]`, and `x.copy()` all make a **shallow** copy: a new outer list, but the *inner* objects are shared.

```python
import copy

original = [[1, 2], [3, 4]]
shallow = original[:]          # or list(original) / original.copy()
shallow[0][0] = 99
print(original)                # [[99, 2], [3, 4]]  -- inner list was shared!

deep = copy.deepcopy(original) # recursively copies everything
deep[0][0] = 0
print(original)                # [[99, 2], [3, 4]]  -- untouched this time
```

*Takeaway: shallow copies share nested objects; reach for `copy.deepcopy` when the nesting matters.*

### List comprehensions (the Pythonic loop)

You'll see these constantly. A comprehension is a compact way to build a list from an iterable.

```python
# Long form
squares = []
for n in range(5):
    squares.append(n * n)

# Comprehension — same result
squares = [n * n for n in range(5)]
print(squares)                 # [0, 1, 4, 9, 16]

# With a filter (the "if" at the end keeps items)
evens = [n for n in range(10) if n % 2 == 0]
print(evens)                   # [0, 2, 4, 6, 8]

# Transform + filter together
labels = [f"#{n}" for n in range(6) if n % 2]
print(labels)                  # ['#1', '#3', '#5']
```

When **not** to use a comprehension: if it has side effects (printing, writing files), or if it's so long/nested you'd need a comment to read it — use a plain `for` loop instead. Comprehensions are for *building a collection*, not for *doing things*.

*Takeaway: `[expr for x in iterable if cond]` builds a list; prefer a loop when there are side effects or it stops being readable.*

---

## `tuple` — ordered, immutable

**Plain English:** a tuple is a list that's been frozen. Use it when the group of values is fixed and shouldn't be edited — that "can't change" guarantee is a feature, not a limitation.

**Technical:** an immutable ordered sequence. Because it can't change, it's **hashable** (if its contents are), slightly more memory-efficient than a list, and safe to share without fear of mutation.

```python
point = (3, 4)
print(point[0])       # 3

# Tuples can't be changed
point[0] = 10         # TypeError: 'tuple' object does not support item assignment
```

> **"Immutable" has a sharp edge.** A tuple's *structure* is frozen — you can't reassign its slots. But if a slot holds a *mutable* object, that object can still change:
> ```python
> t = (1, [2, 3])
> t[1].append(4)
> print(t)           # (1, [2, 3, 4])   -- the list inside mutated
> # t[1] = [9]       # TypeError -- but you still can't replace the slot
> ```
> This is also why a tuple containing a list is **not** hashable and can't be a dict key.

### When to use a tuple

- **Fixed-length records:** `(name, age)`, `(x, y)`, `(red, green, blue)`.
- **Multiple return values:** `min, max = min_max(nums)`.
- **Dict keys** (lists can't be dict keys, tuples can):
  ```python
  cache = {}
  cache[("alice", 2026)] = some_value
  ```

### Tuple unpacking

```python
point = (3, 4)
x, y = point
print(x, y)    # 3 4

# Swap variables — classic
a, b = 1, 2
a, b = b, a    # a=2, b=1

# Unpack with star
first, *rest = [1, 2, 3, 4, 5]
# first=1, rest=[2, 3, 4, 5]

first, *middle, last = [1, 2, 3, 4, 5]
# first=1, middle=[2, 3, 4], last=5
```

Unpacking also powers clean loops over pairs — especially with `enumerate` and `zip`:

```python
names = ["Alice", "Bob", "Carol"]

# enumerate gives (index, value) pairs
for i, name in enumerate(names, start=1):
    print(i, name)
# 1 Alice
# 2 Bob
# 3 Carol

# zip pairs up two iterables, stopping at the shorter one
ages = [30, 25, 35]
for name, age in zip(names, ages):
    print(f"{name} is {age}")
# Alice is 30
# Bob is 25
# Carol is 35
```

*Takeaway: unpacking turns "index juggling" into readable names; `enumerate`/`zip` are its best friends.*

> **Unpacking gotcha:** the number of names must match the number of values, or you get `ValueError: too many values to unpack` (or `not enough values`). The starred form `*rest` is the escape hatch when the count is variable.

### Single-element tuple — watch out

```python
not_a_tuple = (5)        # this is just an int in parens
yes_a_tuple = (5,)       # comma makes it a tuple
print(type(not_a_tuple)) # <class 'int'>
print(type(yes_a_tuple)) # <class 'tuple'>
```

> It's the **comma**, not the parentheses, that makes a tuple. `1, 2, 3` is a tuple even without brackets — the parentheses are just for grouping/readability. This is exactly why `return a, b` returns a tuple and `a, b = b, a` works.

### `namedtuple` — tuples with readable field names

When a tuple's positions start to mean something (`p[0]` is x, `p[1]` is y), reaching by index gets cryptic. `collections.namedtuple` keeps tuple behaviour but adds names:

```python
from collections import namedtuple

Point = namedtuple("Point", ["x", "y"])
p = Point(3, 4)

print(p.x, p.y)        # 3 4   -- readable
print(p[0])            # 3     -- still indexable like a tuple
print(p)               # Point(x=3, y=4)  -- nice repr

x, y = p               # still unpacks
```

It's immutable and hashable like a normal tuple, costs no extra memory per instance, and makes code self-documenting. For mutable records or richer behaviour, you'd reach for a `@dataclass` (covered in doc 06).

*Takeaway: `namedtuple` is a free upgrade when tuple positions carry meaning.*

---

## `dict` — key-value store

**Plain English:** a dict answers "given this label, what's the value?" instantly — like looking up a contact by name instead of scrolling the whole phone.

**Technical:** a mapping from **hashable** keys to arbitrary values, backed by a hash table. Average-case lookup, insert, and delete are **O(1)**. Keys are unique (assigning to an existing key overwrites). Insertion order is preserved since 3.7.

```python
person = {
    "name": "Alice",
    "age": 30,
    "city": "NY",
}

print(person["name"])    # Alice
person["age"] = 31       # update
person["email"] = "a@x.com"  # add new
```

### Safe lookup with `get`

```python
print(person.get("name"))         # Alice
print(person.get("phone"))        # None (no error)
print(person.get("phone", "—"))   # — (default)
```

`person["phone"]` would raise `KeyError`. Use `get` when key may be missing.

> **`get` vs `[]` — which when?** Use `[]` when a missing key is genuinely a *bug* (you want it to blow up loudly). Use `get(key, default)` when "missing" is a normal, expected case you want to handle gracefully. Reaching for `get` everywhere can hide real errors — the loud `KeyError` is often the friend that saves you debugging time.

### `setdefault` — get-or-insert in one step

```python
prefs = {"theme": "dark"}

# If "lang" is missing, set it to "en" and return it
lang = prefs.setdefault("lang", "en")
print(lang)            # en
print(prefs)           # {'theme': 'dark', 'lang': 'en'}

# If it already exists, the default is ignored
theme = prefs.setdefault("theme", "light")
print(theme)           # dark  -- existing value kept
```

A common (older) grouping idiom uses `setdefault`, though `defaultdict` below is usually cleaner:

```python
groups = {}
for word in ["ant", "bee", "ape", "bat"]:
    groups.setdefault(word[0], []).append(word)
print(groups)          # {'a': ['ant', 'ape'], 'b': ['bee', 'bat']}
```

*Takeaway: `setdefault` inserts a default only if the key is absent, then returns the live value.*

### Iterating

```python
for key in person:
    print(key)    # iterates keys

for key, value in person.items():
    print(f"{key}: {value}")

for value in person.values():
    print(value)
```

> **Default iteration yields keys.** `for x in some_dict` gives you keys, not values and not pairs. To get pairs, use `.items()`; for values, `.values()`. Forgetting this and writing `for k, v in person:` raises `ValueError: too many values to unpack` (because each key is a single string, not a pair).

> **Don't mutate a dict's size while iterating it.** Adding or deleting keys mid-loop raises `RuntimeError: dictionary changed size during iteration`. Iterate over a snapshot instead: `for k in list(person.keys()): ...`.

### Useful methods

```python
person.keys()     # dict_keys(['name', 'age', 'city', 'email'])
person.values()   # dict_values(['Alice', 31, 'NY', 'a@x.com'])
person.items()    # dict_items([('name', 'Alice'), ...])

# Remove by key
person.pop("city")    # 'NY' (returns removed value)

# Check key
"name" in person      # True
"phone" in person     # False

# Merge another dict
person.update({"phone": "555-1234", "age": 32})
```

> **`in` on a dict checks keys, not values.** `"name" in person` is `True`; `"Alice" in person` is `False` (it's a value). To test values: `"Alice" in person.values()`.

The views returned by `.keys()`, `.values()`, `.items()` are **live** — they reflect later changes to the dict — and `.keys()`/`.items()` even support set operations:

```python
a = {"x": 1, "y": 2}
b = {"y": 9, "z": 3}
print(a.keys() & b.keys())   # {'y'}   -- keys in both
print(a.keys() - b.keys())   # {'x'}   -- keys only in a
```

### Merging dicts: `update`, `{**a, **b}`, and `|`

```python
defaults = {"color": "blue", "size": "M"}
overrides = {"size": "L"}

# 1) update() mutates in place
merged = defaults.copy()
merged.update(overrides)
print(merged)               # {'color': 'blue', 'size': 'L'}

# 2) unpacking makes a new dict (works in all modern Pythons)
merged = {**defaults, **overrides}
print(merged)               # {'color': 'blue', 'size': 'L'}

# 3) the | operator (Python 3.9+) — cleanest for a new dict
merged = defaults | overrides
print(merged)               # {'color': 'blue', 'size': 'L'}
```

In all three, **later wins** on key collisions (`size` becomes `"L"`).

*Takeaway: rightmost/last source wins; use `|` (3.9+) for a fresh merged dict, `update` to mutate in place.*

### Dict comprehensions

```python
nums = [1, 2, 3, 4]
squared = {n: n*n for n in nums}
# {1: 1, 2: 4, 3: 9, 4: 16}

# Invert a dict (swap keys/values)
original = {"a": 1, "b": 2, "c": 3}
inverted = {v: k for k, v in original.items()}
# {1: 'a', 2: 'b', 3: 'c'}
```

> **Inverting only works cleanly if values are unique and hashable.** If two keys share a value, the inverted dict keeps only the last one (earlier collisions are silently overwritten). If a value is unhashable (e.g. a list), inversion raises `TypeError`.

### `defaultdict` — auto-init missing keys

```python
from collections import defaultdict

# Default value for missing key
counter = defaultdict(int)    # default = 0
for word in ["apple", "banana", "apple", "cherry", "banana", "apple"]:
    counter[word] += 1
print(dict(counter))
# {'apple': 3, 'banana': 2, 'cherry': 1}
```

Without `defaultdict`, you'd need `if word not in counter: counter[word] = 0`.

You pass a **factory** (a zero-argument callable) that produces the default: `int` → `0`, `list` → `[]`, `set` → `set()`, `lambda: "N/A"` → `"N/A"`.

```python
groups = defaultdict(list)
groups["fruit"].append("apple")   # key auto-created with []
print(dict(groups))               # {'fruit': ['apple']}
```

> **Subtle gotcha:** *reading* a missing key from a `defaultdict` **creates** it. `print(groups["veg"])` prints `[]` but also leaves a permanent empty `"veg"` entry behind. If you only want to check membership, use `in` or convert to a plain dict first.

*Takeaway: `defaultdict(factory)` removes the "first time I see this key" boilerplate — but touching a key creates it.*

### `Counter` — even simpler

```python
from collections import Counter

words = "the cat sat on the mat the cat".split()
c = Counter(words)
print(c)
# Counter({'the': 3, 'cat': 2, 'sat': 1, 'on': 1, 'mat': 1})

print(c.most_common(2))
# [('the', 3), ('cat', 2)]
```

`Counter` is a `dict` subclass purpose-built for tallying. It does more than count:

```python
from collections import Counter

a = Counter("aabbbc")          # Counter({'b': 3, 'a': 2, 'c': 1})
print(a["z"])                  # 0   -- missing keys return 0, no KeyError

b = Counter("abbz")
print(a + b)                   # Counter({'b': 5, 'a': 3, 'c': 1, 'z': 1})  -- add counts
print(a - b)                   # Counter({'b': 1, 'a': 1, 'c': 1})  -- subtract (drops <= 0)
print(a & b)                   # Counter({'b': 2, 'a': 1})  -- min of each
print(a | b)                   # Counter({'b': 3, 'a': 2, 'c': 1, 'z': 1})  -- max of each

print(list(a.elements()))      # ['a', 'a', 'b', 'b', 'b', 'c']  -- expand back out
```

*Takeaway: reach for `Counter` whenever the task is "count how many of each"; it never raises `KeyError` and supports arithmetic.*

---

## `set` — unique items, fast lookup

**Plain English:** a set is a bag where duplicates can't survive and order doesn't matter. You use it to dedupe and to ask "is X in here?" really fast.

**Technical:** an unordered collection of **unique, hashable** elements, backed by a hash table. Membership, add, and remove are **O(1)** average. There is no indexing — `my_set[0]` raises `TypeError`.

```python
fruits = {"apple", "banana", "cherry"}
print("apple" in fruits)    # True

fruits.add("kiwi")
fruits.discard("apple")     # remove (no error if missing)
fruits.remove("banana")     # remove (KeyError if missing)
```

> **Empty set gotcha:** `{}` is an empty **dict**, not a set. Use `set()` for an empty set. `{1, 2}` is a set, but `{}` alone is always a dict.

> **Set members must be hashable.** `{[1, 2]}` raises `TypeError: unhashable type: 'list'`. Use tuples or `frozenset` for compound members.

### Set from list (deduplicate)

```python
nums = [1, 2, 2, 3, 3, 3, 4]
unique = set(nums)        # {1, 2, 3, 4}
unique_list = list(set(nums))   # back to list, no dups
```

> **Caution:** `list(set(nums))` does **not** preserve original order (a set isn't ordered). If order matters, see "Removing duplicates while preserving order" below.

### Set operations

```python
a = {1, 2, 3, 4}
b = {3, 4, 5, 6}

print(a | b)   # union: {1, 2, 3, 4, 5, 6}
print(a & b)   # intersection: {3, 4}
print(a - b)   # difference: {1, 2}
print(a ^ b)   # symmetric diff: {1, 2, 5, 6}
```

These shine for real questions: "which users are in both groups?" (`&`), "who's new this week?" (`thisweek - lastweek`), "everyone across both lists?" (`|`). There are also relationship tests:

```python
print({1, 2} <= {1, 2, 3})   # True  -- subset
print({1, 2, 3} >= {1, 2})   # True  -- superset
print({1, 2}.isdisjoint({3, 4}))  # True  -- no overlap
```

*Takeaway: set algebra replaces nested loops for membership/overlap questions, and reads like the problem statement.*

### Set vs list — performance

Membership tests on a set are **O(1)** on average. On a list, **O(n)**.

```python
big_list = list(range(1_000_000))
big_set = set(big_list)

# Slow:
500_000 in big_list    # walks ~half a million items

# Fast:
500_000 in big_set     # ~constant time
```

If you'll do many `in` checks, convert to set first.

Concretely, you can time the difference:

```python
import timeit

big_list = list(range(1_000_000))
big_set = set(big_list)

t_list = timeit.timeit(lambda: 999_999 in big_list, number=100)
t_set  = timeit.timeit(lambda: 999_999 in big_set,  number=100)
print(f"list: {t_list:.4f}s   set: {t_set:.6f}s")
# Roughly:  list: 0.6–1.0s   set: 0.00001s
# The set is thousands of times faster for the worst-case lookup.
```

> **When NOT to bother:** building the set costs O(n) and uses extra memory. For a *single* membership test on a small list, a plain `in` on the list is fine — converting to a set first would be slower overall. The set wins when you do **many** lookups against the **same** collection.

*Takeaway: convert to a set when membership testing dominates; skip it for one-off checks on small data.*

### Frozen set (immutable)

```python
fs = frozenset([1, 2, 3])
# fs.add(4)   # AttributeError

# Use frozenset as a dict key
my_map = {frozenset([1, 2]): "ab", frozenset([3, 4]): "cd"}
```

A `frozenset` is to `set` what `tuple` is to `list`: same data, but immutable and therefore **hashable**. That's why it can be a dict key or an element of another set — a regular `set` cannot (`{ {1,2} }` raises `TypeError`).

*Takeaway: need a set inside a set, or a set as a dict key? Use `frozenset`.*

---

## The one idea behind half the rules: *hashability*

Many "why can't I do that?" errors come from one concept. A dict and a set store items by computing a **hash** (a number derived from the value) and using it to jump to a storage slot. For this to work, an item's hash must never change while it's stored — so Python only allows **hashable** (effectively, immutable) objects as dict keys and set members.

```python
hash("hello")     # some stable int
hash((1, 2))      # works -- tuple of hashables
hash([1, 2])      # TypeError: unhashable type: 'list'
hash({1: 2})      # TypeError: unhashable type: 'dict'
```

Rules that all follow from this single fact:

- **Dict keys / set members** must be hashable → `str`, `int`, `float`, `bool`, `tuple`-of-hashables, `frozenset`, `None` work; `list`, `dict`, `set` don't.
- A `tuple` is hashable **only if everything inside it is** — `(1, [2])` is not hashable.
- Custom classes are hashable by default (by identity), but become unhashable if you define `__eq__` without `__hash__` (you'll see this in doc 06).

*Takeaway: "unhashable type" almost always means you tried to use a mutable container as a key or set element — wrap it in a tuple/frozenset.*

---

## Choosing the right collection

```
Need ordered, may change?           → list
Fixed group, never changes?         → tuple
Need unique items?                  → set
Lookup by key?                      → dict
```

A few finer cuts:

```
Fixed group but positions have names?       → namedtuple (or dataclass, doc 06)
Counting how many of each?                  → Counter
Grouping items under keys?                  → defaultdict(list)
Many membership tests on the same data?     → set
Need a set as a key / set-of-sets?          → frozenset
FIFO queue with fast pops from the front?   → collections.deque (lists are O(n) at the front)
```

> **`deque` teaser:** `list.pop(0)` and `list.insert(0, x)` are O(n) because every other element shifts. `collections.deque` gives O(1) `appendleft`/`popleft`, so it's the right tool for queues and sliding windows. You'll meet it again in the data-structures docs.

---

## Real-world examples

### Counting word frequencies

```python
text = "the cat sat on the mat. the cat is on the mat."
words = text.lower().replace(".", "").split()

from collections import Counter
counts = Counter(words)
print(counts.most_common(3))
# [('the', 4), ('cat', 2), ('mat', 2)]
```

### Group items by attribute

```python
from collections import defaultdict

people = [
    {"name": "Alice", "city": "NY"},
    {"name": "Bob", "city": "SF"},
    {"name": "Carol", "city": "NY"},
]

by_city = defaultdict(list)
for p in people:
    by_city[p["city"]].append(p["name"])

print(dict(by_city))
# {'NY': ['Alice', 'Carol'], 'SF': ['Bob']}
```

### Removing duplicates while preserving order

```python
nums = [1, 2, 1, 3, 4, 2, 5]
seen = set()
result = []
for n in nums:
    if n not in seen:
        seen.add(n)
        result.append(n)
print(result)    # [1, 2, 3, 4, 5]
```

(Or in modern Python: `list(dict.fromkeys(nums))`.)

`dict.fromkeys` works because dicts keep insertion order and reject duplicate keys, so the keys come out deduplicated *and* in first-seen order:

```python
nums = [1, 2, 1, 3, 4, 2, 5]
print(list(dict.fromkeys(nums)))   # [1, 2, 3, 4, 5]
```

*Takeaway: `set` dedupes but loses order; `dict.fromkeys` dedupes and keeps first-seen order.*

### Indexing records for fast lookup

```python
# Turn a list of records into a dict keyed by id — O(1) lookups afterwards
users = [
    {"id": 1, "name": "Alice"},
    {"id": 2, "name": "Bob"},
    {"id": 3, "name": "Carol"},
]
by_id = {u["id"]: u for u in users}     # dict comprehension

print(by_id[2]["name"])                 # Bob   -- no scanning the list
```

*Takeaway: if you repeatedly look something up by a field, build a dict keyed by that field once.*

---

## Common mistakes

**1. Treating dicts/lists as immutable.**
```python
def add_user(user, all_users):
    all_users.append(user)    # modifies caller's list!

users = []
add_user("alice", users)
print(users)    # ['alice']
```

This is fine if you intend it. Dangerous if you don't.

**2. Default mutable in function (already covered).**

For completeness, the classic trap from the functions doc:
```python
def add(item, bucket=[]):     # BUG: the default list is shared across calls
    bucket.append(item)
    return bucket

print(add(1))    # [1]
print(add(2))    # [1, 2]   -- not [2]! same list reused
```
Fix with the sentinel pattern:
```python
def add(item, bucket=None):
    if bucket is None:
        bucket = []
    bucket.append(item)
    return bucket
```

**3. Iterating + modifying.**
```python
for item in my_list:
    if some_condition(item):
        my_list.remove(item)    # bug
```

Build a new list:
```python
my_list = [item for item in my_list if not some_condition(item)]
```

Why it's a bug: removing an item shifts everything after it left by one, so the loop's internal index *skips* the next element. The comprehension (or iterating over a copy, `for item in my_list[:]`) sidesteps the issue entirely.

**4. Wrong type for keys.**
- Dict keys must be **hashable** (immutable).
- Lists, dicts, sets cannot be dict keys.
- Tuples (of hashables) and strings work.

**5. Forgetting that `dict.get` returns None for missing.**
```python
config = {"timeout": 30}
limit = config.get("max_limit")    # None
print(limit + 5)    # TypeError: NoneType + int
```

Use a default: `config.get("max_limit", 100)`.

**6. Comparing across types expecting numeric equality.**
```python
print(1 == 1.0)            # True  -- numeric values compare equal
print(1 in {1.0, 2.0})     # True  -- and hash equal, so set membership matches
print("1" == 1)            # False -- str vs int never equal
print({1, True})           # {1}   -- True == 1 and hash(True) == hash(1)!
```
The last line surprises people: because `True == 1` and they hash identically, a set treats them as the *same* element. Same reason `{1: "a", True: "b"}` ends up as `{1: 'b'}`.

**7. Assuming `set`/`dict` order is sorted.**
```python
s = {3, 1, 2}
print(s)                   # may print {1, 2, 3} OR {2, 1, 3} -- DON'T rely on it
```
Sets have no guaranteed order; dicts preserve *insertion* order, not sorted order. If you need sorted output, call `sorted(...)` explicitly.

---

## Cross-questions reviewers and interviewers ask

**Q: Why is a `tuple` faster / lighter than a `list` if they hold the same data?**
A tuple is immutable, so the interpreter can allocate it once at a fixed size with no room to grow, and can cache/optimise it (small constant tuples are even interned). A list over-allocates spare capacity so `append` is amortised O(1), which costs memory and a layer of indirection. The difference is small — choose tuple for *meaning* (this won't change), not micro-optimisation.

**Q: Dicts are O(1) lookups — why not always use a dict instead of a list?**
A dict needs hashable keys, uses more memory per element (it stores hashes plus key and value), and is the wrong shape when you just need an ordered sequence you iterate front-to-back. Use a list when position/order is the point and you mostly iterate; use a dict when you look things up by key.

**Q: Why can a `tuple` be a dict key but a `list` can't?**
Dict keys must be hashable, and hashability requires the value (and thus its hash) to be stable for life. Lists are mutable, so their contents — and a sensible hash — could change while stored, breaking the table. Tuples are immutable, so Python allows them (provided their contents are also hashable).

**Q: `sorted()` vs `list.sort()` — when do you use each?**
`list.sort()` when you have a list and want to sort it in place (no extra copy, returns `None`). `sorted()` when you want a new sorted list, want to keep the original, or are sorting a non-list iterable (tuple, set, dict keys, generator). Both accept `key=` and `reverse=`.

**Q: `defaultdict` vs `dict.setdefault` vs `dict.get` — pick one for counting.**
`Counter` is best for counting. Between the others: `defaultdict(int)` is cleanest for accumulation (`d[k] += 1`); `setdefault` is handy when you want a one-off default without changing the dict type; `get(k, 0)` is read-only and won't create the key. The footgun with `defaultdict` is that merely reading a missing key inserts it.

**Q: Is membership (`in`) the same speed on a list and a set?**
No. `in` on a list is O(n) (linear scan); on a set or dict it's O(1) average (hash lookup). For repeated checks against the same data, build a set/dict once.

**Q: How do I make a deep copy, and when do I need one?**
`copy.deepcopy(x)` recursively copies nested objects. You need it when you have nested mutable structures (list of lists, dict of dicts) and must mutate the copy without touching the original. Shallow copies (`x[:]`, `list(x)`, `x.copy()`, `dict(x)`) copy only the top level and share the nested objects.

**Q: Why is `{}` a dict but `{1, 2}` a set?**
Dict literal syntax (`{}`, `{k: v}`) came first and owns the empty braces. A set literal needs at least one element so the parser can tell them apart; for an empty set you must write `set()`.

---

## Exercises

1. **Group anagrams**: given list of words, group those that are anagrams. e.g. `["eat", "tea", "tan", "ate", "nat", "bat"]` → `[["eat", "tea", "ate"], ["tan", "nat"], ["bat"]]`.
2. **Top 3 frequent**: from a list, return the 3 most common items.
3. **Two-sum**: given a list of nums and target, return indices of two numbers that sum to target. Use a dict for O(n).
4. **Longest unique substring**: in a string, find the longest substring without repeating characters.
5. **Inventory**: dict of {product: quantity}. Implement `restock(product, n)`, `sell(product, n)` (raises if not enough), `low_stock(threshold)` returns products below threshold.
6. **Merge two leaderboards**: given two dicts `{player: score}`, produce one dict where each player's score is the sum across both. (Hint: `Counter` supports `+`.)
7. **Common interests**: given `{user: set_of_hobbies}`, find hobbies shared by *all* users. (Hint: `set.intersection` over the values.)

### Hints

For #1 (anagrams): use sorted-string as the dict key.
```python
from collections import defaultdict
groups = defaultdict(list)
for word in words:
    key = "".join(sorted(word))
    groups[key].append(word)
return list(groups.values())
```

For #2 (top 3): `Counter(items).most_common(3)` returns `(item, count)` pairs; take `[item for item, _ in ...]` if you only want the items.

For #3 (two-sum):
```python
def two_sum(nums, target):
    seen = {}
    for i, n in enumerate(nums):
        if (target - n) in seen:
            return [seen[target - n], i]
        seen[n] = i
    return None
```

For #6 (merge leaderboards): `Counter(board_a) + Counter(board_b)` sums matching keys and keeps the rest.

For #7 (common interests): `set.intersection(*hobbies_by_user.values())` — the `*` spreads each user's set as a separate argument.

---

## What to read next

**Doc 06** — Classes and objects: how to build your own types (and learn where `__hash__` / `__eq__` come from, closing the loop on hashability above).

```
→ Foundations/Programming/Python/06-classes-and-objects.md
```

**Also worth a look:**
- The official [Python docs on `collections`](https://docs.python.org/3/library/collections.html) — `Counter`, `defaultdict`, `namedtuple`, `deque`, `OrderedDict`.
- The [Data Structures tutorial](https://docs.python.org/3/tutorial/datastructures.html) for comprehensions, the `del` statement, and looping techniques.
- Later in this track: data-structure docs covering `deque`, heaps (`heapq`), and Big-O of each operation in depth.

# 01 — Getting Started with Python

> **Prerequisites:** none. This is the very beginning.
> **Time to read:** 20 minutes.
> **Time to do exercises:** 1-2 hours.

---

## What is Python and why should I care?

**Python** is a programming language. You write text instructions in a `.py` file, and the Python *interpreter* reads them and makes the computer do things.

Why Python is great for beginners:
- **Reads like English.** Less syntax noise than other languages.
- **Huge ecosystem.** Millions of free libraries. Need to read a CSV? Process an image? Build a website? Someone wrote a library.
- **Works everywhere.** Mac, Windows, Linux, web browsers, microcontrollers.
- **Used everywhere.** Web apps (Instagram, Reddit), AI/ML (PyTorch, TensorFlow), data science, scripting, automation, DevOps.

If you can read this paragraph, you can learn Python.

### Plain-English: what does "interpreter" even mean?

Imagine you wrote a recipe in English and handed it to a friend who follows it step by step, one line at a time, doing exactly what each line says. The Python **interpreter** is that friend. It reads your `.py` file from top to bottom and *executes* each instruction as it goes.

Contrast this with a **compiler** (used by languages like C, Go, or Rust). A compiler is more like a translator who reads your *entire* recipe first and rewrites it into a different language (machine code the CPU speaks directly) before anyone cooks anything. You get a separate "build" artifact, then you run that.

### The precise/technical version

Python is a **high-level, dynamically-typed, garbage-collected, interpreted** language. Unpacking those words:

- **High-level:** you don't manage memory addresses or CPU registers by hand. Python abstracts the hardware away.
- **Dynamically typed:** a variable's type is determined at runtime, not declared up front. `x = 5` makes `x` an int; `x = "hi"` later makes it a str. No type declaration is required (though you *can* add optional type hints — covered in a later doc).
- **Garbage-collected:** Python automatically frees memory you're no longer using (primarily via *reference counting*, with a cycle detector for objects that reference each other). You never call `free()`.
- **Interpreted:** strictly, the reference implementation (called **CPython**, written in C) first *compiles* your source to an intermediate **bytecode** (`.pyc` files in `__pycache__/`), then a **virtual machine** executes that bytecode. So "interpreted" is shorthand — there is a compile step, it's just automatic and invisible. Other implementations exist: **PyPy** (a JIT compiler, often much faster), **Jython** (runs on the JVM), and others.

> **Takeaway:** When people say "Python is interpreted," they mean you don't run a manual build step. Under the hood CPython compiles to bytecode and runs it on a VM.

---

## Installing Python

You need **Python 3.10 or newer** for everything in this knowledge base.

**Mac:**
```bash
brew install python3
```

**Windows:**
Go to [python.org/downloads](https://python.org/downloads) and click the big download button. During install, check "Add Python to PATH".

**Linux:**
Probably already installed:
```bash
python3 --version
```

If not: `sudo apt install python3` (Ubuntu/Debian) or your distro's equivalent.

### Verify install

```bash
python3 --version
# Should print: Python 3.10.x or newer
```

If you see this, you're set.

### `python` vs `python3` vs `py`

A frequent source of confusion:

- **macOS / Linux:** the command is almost always `python3`. Historically `python` pointed at the ancient Python 2; on many systems `python` is now absent or also points at 3, but typing `python3` is the safe habit.
- **Windows:** the official installer gives you a launcher called `py`. So `py --version`, `py hello.py`. The `python` command also works if you ticked "Add Python to PATH".

To find *which* Python you're actually running:

```bash
which python3      # macOS/Linux: prints the path, e.g. /usr/bin/python3
where py           # Windows (cmd): prints the launcher path
```

> **Takeaway:** If a tutorial says `python` and your terminal says "command not found," try `python3` (Mac/Linux) or `py` (Windows).

### A word on virtual environments (you'll need this soon)

The moment you install a third-party library, you should do it inside a **virtual environment** — an isolated folder of packages just for one project, so Project A's libraries can't conflict with Project B's. You don't need this for the single-file programs in this doc, but here's the one-liner for when you do:

```bash
python3 -m venv .venv          # create an isolated environment in ./.venv
source .venv/bin/activate      # activate it (macOS/Linux)
# .venv\Scripts\activate       # activate it (Windows PowerShell/cmd)
# ...now `pip install <thing>` only affects this project...
deactivate                     # leave the environment when done
```

A full treatment lives in a later doc; just know the concept exists and **never `sudo pip install` system-wide** — it can break your OS's own Python.

---

## Your first program

Open any text editor (VS Code, Notepad, TextEdit, even nano). Make a new file called `hello.py` with this content:

```python
print("Hello, world!")
```

In your terminal:

```bash
python3 hello.py
```

You should see:

```
Hello, world!
```

**You just ran a program.** The interpreter read your file, saw the `print` instruction, and outputted text.

### What each piece is doing

- `print` is a **built-in function** — a reusable instruction that ships with Python.
- The `( )` parentheses mean "call this function." Anything inside is an **argument** you hand to it.
- `"Hello, world!"` is a **string** — text wrapped in quotes. The quotes are not part of the text; they tell Python "this is text, not code."

```python
print("Hello, world!")
# │     └── argument: the string to display
# └── the function being called
```

> **Takeaway:** `name(stuff)` means "run the function `name`, giving it `stuff`."

---

## How a Python program runs

```
Your file (hello.py)
       │
       ▼
Python interpreter
       │
       ▼
Computer does the thing
       │
       ▼
You see output
```

Unlike some languages, Python doesn't need a separate compile step. You write code, you run it.

### Slightly more accurate diagram

The "no compile step" statement is true *for you* but the machinery underneath has one more box:

```
Your file (hello.py)
       │
       ▼
Compile to bytecode  ──►  cached in __pycache__/hello.cpython-312.pyc
       │
       ▼
Python Virtual Machine (PVM) executes bytecode
       │
       ▼
You see output
```

The `.pyc` cache is why the *second* run of a large program starts a hair faster — Python skips recompiling unchanged files. You can ignore `__pycache__/` folders; they're safe to delete and Python regenerates them. (They are commonly added to `.gitignore`.)

> **Takeaway:** "Python is not compiled" is a useful simplification, not the literal truth. The compile step is automatic and cached.

---

## Variables: storing values

A **variable** is a labeled container for a value. You give it a name, and put a value in it.

```python
name = "Alice"
age = 30
is_student = True

print(name)       # Alice
print(age)        # 30
print(is_student) # True
```

Three rules for variable names:
1. Letters, digits, and underscores only. Must start with a letter or underscore.
2. Convention: lowercase with underscores. `user_name`, not `userName` or `UserName`.
3. Avoid using Python's reserved words (`if`, `for`, `class`, etc.) — Python will reject them.

### Variables can be reassigned

```python
score = 10
print(score)   # 10

score = 20
print(score)   # 20
```

### Plain-English: a variable is a *name tag*, not a *box*

A lot of beginners picture a variable as a box that physically holds a value. A more accurate Python mental model: a variable is a **sticky label (name) attached to an object** that lives somewhere in memory. Assignment (`=`) sticks the label onto an object; it does not copy the object.

This matters the moment two names point at the *same* object:

```python
a = [1, 2, 3]   # 'a' is a label on a list object
b = a           # 'b' is a SECOND label on the SAME list object
b.append(4)     # we change the one shared object...
print(a)        # [1, 2, 3, 4]   <-- 'a' sees the change too!
print(a is b)   # True           <-- same object, not a copy
```
Expected output:
```
[1, 2, 3, 4]
True
```

> **Takeaway:** `=` binds a name to an object; it never makes a copy. Two names can refer to one object.

### `=` is assignment, not "equals"

Read `x = 5` as "let `x` refer to `5`," not "x equals 5." It's a command (do this), not a fact (this is true). The right-hand side is evaluated first, then the result is bound to the name on the left.

```python
total = 0
total = total + 10   # evaluate (0 + 10) = 10, THEN bind 'total' to 10
print(total)         # 10
```
Expected output:
```
10
```

> **Takeaway:** In `name = expression`, Python computes the expression first, then attaches the name to the result.

### Augmented assignment: `+=` and friends

`total = total + 10` is so common that Python gives you a shorthand:

```python
count = 0
count += 1     # same as: count = count + 1
count += 5     # now 6
count *= 2     # now 12  (count = count * 2)
print(count)   # 12
```
Expected output:
```
12
```

The same pattern works with `-=`, `/=`, `//=`, `%=`, `**=`, and even string concatenation:

```python
greeting = "Hi"
greeting += " there"
print(greeting)   # Hi there
```
Expected output:
```
Hi there
```

> **Takeaway:** `x op= y` means `x = x op y` — less typing, same result.

### Multiple assignment and swapping

Python lets you assign several names at once, and the famous "no temp variable" swap:

```python
x, y = 1, 2     # x is 1, y is 2
x, y = y, x     # swap! right side is built first, then unpacked
print(x, y)     # 2 1
```
Expected output:
```
2 1
```

The right-hand side `y, x` is bundled into a temporary pair `(2, 1)` *before* anything is reassigned, so there's no clobbering. This is **tuple unpacking** (more in the collections doc).

> **Takeaway:** `a, b = b, a` swaps two values without a temp variable because the right side is fully evaluated first.

---

## Output: `print`

You've seen `print`. Some tricks:

```python
# Multiple values: separated by spaces by default
print("Hello", "world")
# Output: Hello world

# F-strings (formatted strings) — most useful tool
name = "Alice"
age = 30
print(f"Hi {name}, you are {age} years old.")
# Output: Hi Alice, you are 30 years old.

# Print to a new line by default; use end="" to suppress
print("hello", end="")
print(" world")
# Output: hello world
```

**F-strings are your friend.** Use them whenever you want to combine variables and text.

### More `print` control: `sep` and `end`

`print` separates its arguments with a space and ends with a newline *by default*. Both are tunable:

```python
print("2024", "01", "15", sep="-")    # join with dashes
# Output: 2024-01-15

print("a", "b", "c", sep="")           # no separator
# Output: abc

print("loading", end="...")            # custom ending instead of newline
print("done")
# Output: loading...done
```
Expected output:
```
2024-01-15
abc
loading...done
```

> **Takeaway:** `sep` controls what goes *between* arguments; `end` controls what goes *after* the last one.

### F-strings can do real work inside `{ }`

The braces in an f-string take *any expression*, not just a bare variable name:

```python
price = 19.5
qty = 3
print(f"Total: ${price * qty}")          # arithmetic inside the braces
print(f"Name in caps: {'alice'.upper()}")# method call inside the braces

# Format specifiers after a colon control display:
pi = 3.14159265
print(f"Pi to 2 decimals: {pi:.2f}")     # round to 2 decimal places
print(f"Padded: {7:03d}")                # zero-pad an int to width 3
print(f"Percent: {0.25:.0%}")            # show a fraction as a percentage
```
Expected output:
```
Total: $58.5
Name in caps: ALICE
Pi to 2 decimals: 3.14
Padded: 007
Percent: 25%
```

A handy debugging trick — `{var=}` prints both the name and value:

```python
score = 42
print(f"{score=}")   # shows the expression text and its value
# Output: score=42
```
Expected output:
```
score=42
```

> **Takeaway:** F-strings evaluate expressions and support `:format` specs like `.2f` (decimals), `03d` (zero-pad), and `.0%` (percent). `f"{x=}"` is the fastest way to print "what is x right now?"

### Why f-strings over older styles

You will see two older string-formatting styles in old code. Know them so you can *read* them, but write f-strings:

```python
name, age = "Alice", 30

# Modern (do this):
print(f"{name} is {age}")

# .format() (older, still valid):
print("{} is {}".format(name, age))

# %-formatting (oldest, C-style):
print("%s is %d" % (name, age))
```
All three print `Alice is 30`. F-strings win because the variable sits *right where it appears* in the text, so they're the easiest to read and the hardest to get out of order.

> **Takeaway:** Prefer f-strings; they're the most readable. Recognize `.format()` and `%` so you can maintain older code.

---

## Input: `input`

Read a line of text from the user:

```python
name = input("What's your name? ")
print(f"Nice to meet you, {name}!")
```

Note: `input()` always returns a **string**. If you need a number, convert it:

```python
age_str = input("Your age? ")
age = int(age_str)         # convert to integer
print(age + 5)             # 5 years from now
```

### Plain-English: why is `input` *always* text?

Whatever someone types at a keyboard arrives as characters: `"4"`, `"2"` — the *symbols* four-two, not the *number* forty-two. Python can't know whether you meant the number 42, the string "42", or part of a phone number, so it plays it safe and hands you a **string** every time. *You* decide what it means by converting.

```python
n = input("Enter a number: ")   # suppose the user types 42
print(n + n)                    # "4242"  <-- string repetition, not 84!
print(int(n) + int(n))          # 84      <-- now it's math
```
If the user typed `42`, the output is:
```
4242
84
```

> **Takeaway:** `input()` returns a `str`. Convert with `int(...)` or `float(...)` before doing math, or you'll get string behavior (concatenation/repetition).

### Guarding against bad input

If the user types `"abc"` and you call `int("abc")`, Python raises a `ValueError` and your program crashes. A beginner-friendly guard:

```python
raw = input("Your age? ")
if raw.isdigit():                 # True only if every char is 0-9
    age = int(raw)
    print(f"In 5 years you'll be {age + 5}.")
else:
    print("That wasn't a whole number.")
```
If the user types `30`:
```
In 5 years you'll be 35.
```
If the user types `thirty`:
```
That wasn't a whole number.
```

(`.isdigit()` rejects negatives and decimals — for those you'd reach for `try/except`, covered in the errors doc. For now, `isdigit()` is a fine first guard.)

> **Takeaway:** Never assume input is valid. `int("abc")` crashes; check first (`.isdigit()`) or handle the error.

---

## Comments: notes for humans

Python ignores anything after `#` on a line.

```python
# This is a comment. Python ignores it.

x = 5  # inline comment after code

# Use comments to explain WHY (not WHAT — the code shows what).
# Bad:  x = x + 1  # increment x
# Good: x = x + 1  # advance to next page
```

### Docstrings: the "official" comment

There's a second kind of human-facing text: the **docstring** — a string literal placed as the very first line inside a function, class, or file. Unlike a `#` comment, it's attached to the object and readable at runtime via `help()`.

```python
def area(width, height):
    """Return the area of a rectangle (width * height)."""
    return width * height

help(area)   # prints the docstring
```
Running `help(area)` shows:
```
Help on function area in module __main__:

area(width, height)
    Return the area of a rectangle (width * height).
```

> **Takeaway:** Use `#` for inline notes; use `"""triple-quoted docstrings"""` as the first line of a function to document what it does — tools and `help()` can read those.

### Commenting out code temporarily

To disable a line while debugging, prefix it with `#`. Many editors do this for a whole selection with `Ctrl+/` (or `Cmd+/`).

```python
print("step 1")
# print("step 2")   # disabled for now
print("step 3")
```
Expected output:
```
step 1
step 3
```

> **Takeaway:** A `#` in front of code "turns it off" without deleting it — useful for isolating a bug.

---

## Indentation matters

Most languages use `{}` to group code. Python uses **indentation**.

```python
if age >= 18:
    print("You can vote.")     # 4 spaces in
    print("You're an adult.")  # 4 spaces in
print("Done.")                  # back at column 0
```

The two `print`s are *inside* the `if`. The third `print` runs always. **Use 4 spaces, never tabs.** Most editors do this automatically.

If you mix spaces and tabs, Python complains. Be consistent.

### Why indentation instead of braces?

This is a deliberate design choice (in fact, the very first item in *The Zen of Python* — try `import this`). The argument: in brace languages, indentation is *optional cosmetics* that can lie about the structure. In Python the indentation **is** the structure, so what you see is always what runs — no class of bug where the braces and the spacing disagree.

```python
# In a brace language this misleads the reader (the second line is NOT in the if):
# if (x > 0)
#     doA();
#     doB();   <-- looks nested, actually always runs

# Python makes that ambiguity impossible — nesting is the indentation.
```

> **Takeaway:** Python made indentation mandatory so the layout you read is guaranteed to match what executes.

### The error you'll see, and how to read it

```python
if 5 > 0:
print("inside")    # forgot to indent
```
Python raises:
```
IndentationError: expected an indented block after 'if' statement on line 1
```
The fix is to indent the body by 4 spaces. A *mismatched* indent (e.g. 4 spaces on one line, 3 on the next within the same block) gives a slightly different message:
```
IndentationError: unindent does not match any outer indentation level
```

> **Takeaway:** `IndentationError` almost always means "this line should be indented (or should line up with its siblings) and it isn't." Set your editor to insert 4 spaces for the Tab key.

---

## Running code interactively (the REPL)

Type just `python3` in your terminal:

```
$ python3
Python 3.12.0 ...
>>>
```

You're now in the **REPL** (Read-Eval-Print Loop). Try:

```
>>> 2 + 2
4
>>> name = "Bob"
>>> print(name)
Bob
>>> exit()
```

The REPL is great for trying things out. Don't write whole programs here, but quick experiments — yes.

### The REPL auto-prints; a script does not

A subtle thing that trips people up: in the REPL, typing a bare expression *shows its value*. In a script, that same line does nothing visible — you must `print` it.

```
>>> 3 * 7        # REPL echoes the result
21
>>> "hi".upper()
'HI'
```
But in a `.py` file:
```python
3 * 7            # computed, then thrown away — NO output
print(3 * 7)     # this one shows: 21
```

The REPL's "P" (Print) is why `2 + 2` shows `4` without `print`. Scripts only show what you explicitly print.

> **Takeaway:** The REPL prints the value of each expression you type; scripts don't. In a file, wrap things in `print(...)` to see them.

### Useful REPL helpers

```
>>> help(str)        # documentation for the str type (press q to quit)
>>> dir("hi")        # list everything a string can do
>>> type(42)         # <class 'int'>
>>> exit()           # or Ctrl-D (Mac/Linux), Ctrl-Z then Enter (Windows)
```

`help()` and `dir()` mean you rarely need to leave the REPL to look something up.

> **Takeaway:** `type(x)` tells you *what* something is; `dir(x)` tells you *what it can do*; `help(x)` explains it. These three turn the REPL into a built-in tutor.

---

## Idioms and best practices

A short list of habits that mark code as "written by someone who knows Python":

- **Use f-strings** for combining text and values. Reach for `.format()`/`%` only when maintaining old code.
- **Use 4-space indentation, no tabs.** Configure your editor once and forget it.
- **`snake_case` for variables and functions**, `UPPER_CASE` for constants, `PascalCase` for classes. This is *PEP 8*, the community style guide; tools like **Black** auto-format to it and **Ruff/flake8** flag violations.
- **Names should say what they hold.** `n` is fine for a tiny loop counter; `customer_age` beats `ca` everywhere else.
- **Convert input at the boundary.** Turn the string from `input()` into an `int`/`float` immediately, so the rest of your code works with the right type.
- **Comment the *why*, not the *what*.** The code already states what it does; comments earn their keep by explaining intent, trade-offs, or surprises.
- **Prefer `is None` / `is not None`** for null checks (not `== None`). `is` checks identity, which is exactly what you want for the single `None` object.

### When NOT to reach for a feature

- **Don't use the REPL for real programs.** It's for experiments; nothing is saved. Write `.py` files for anything you'll run twice.
- **Don't over-comment.** `x += 1  # add one to x` is noise. Delete it.
- **Don't micro-optimize at this stage.** Readable beats clever. The `.pyc` cache, JIT, and so on are not yours to worry about yet.
- **Don't sprinkle type conversions everywhere "to be safe."** Convert once, deliberately, where data enters your program.

> **Takeaway:** Idiomatic Python optimizes for the *reader*. When in doubt, choose the clearer line.

---

## Common mistakes for beginners

**1. Calling `print` without parentheses.**
```python
print "hello"  # ERROR (this was Python 2; we use Python 3)
print("hello") # correct
```

**2. Forgetting the colon.**
```python
if x > 0       # ERROR: missing :
    print(x)

if x > 0:      # correct
    print(x)
```

**3. Inconsistent indentation.**
```python
if x > 0:
    print(x)
   print(y)   # ERROR: 3 spaces (should be 4)
```

**4. Using `=` for comparison.**
```python
if x = 5:    # ERROR: = is assignment
if x == 5:   # correct: == is comparison
```

**5. Trying to do math with strings.**
```python
age = input("age? ")  # this is a STRING
age + 5               # ERROR: can't add int to str
int(age) + 5          # correct
```

**6. Concatenating a string with a number.**
```python
age = 30
print("You are " + age)   # ERROR: can only concatenate str to str
```
The fix — convert the number, or just use an f-string (which converts for you):
```python
print("You are " + str(age))   # works
print(f"You are {age}")        # cleaner
```
Both print `You are 30`.

> **Takeaway:** `"text" + number` is a `TypeError`. Use `str(number)` or an f-string.

**7. Quotes that don't match (or aren't closed).**
```python
greeting = "hello'    # ERROR: SyntaxError, opened with " but closed with '
sentence = "He said "hi""  # ERROR: the inner " ends the string early
```
Fixes:
```python
greeting = "hello"                 # matching quotes
sentence = 'He said "hi"'          # use the OTHER quote on the outside
sentence = "He said \"hi\""        # or escape the inner quotes
```

> **Takeaway:** Quotes must match and be closed. To include a quote *inside* a string, wrap with the other quote type or escape it with `\`.

**8. Re-using a built-in name as a variable.**
```python
list = [1, 2, 3]     # works, but now you've SHADOWED the built-in 'list'
x = list("abc")      # TypeError: 'list' object is not callable — 'list' is your list now
```
The fix — don't name variables after built-ins (`list`, `str`, `dict`, `sum`, `id`, `type`, `input`, `print`, ...):
```python
items = [1, 2, 3]
x = list("abc")      # ['a', 'b', 'c'] — the real built-in still works
```

> **Takeaway:** Naming a variable `list` (or `str`, `sum`, `input`, ...) quietly overwrites the built-in for the rest of that scope. Pick a different name.

**9. `NameError`: using a name before you create it.**
```python
print(total)         # NameError: name 'total' is not defined
total = 5
```
Python reads top to bottom; define before you use. Often this is just a typo:
```python
user_name = "Alice"
print(usre_name)     # NameError: typo — 'usre_name' was never defined
```

> **Takeaway:** `NameError` means "I've never heard of that name here" — usually a typo or using a variable before assigning it.

**10. The leftover-from-Python-2 traps.**
```python
print 2 + 2          # SyntaxError — Python 2 syntax
xrange(10)           # NameError — Python 2 only; use range(10)
raw_input("name? ")  # NameError — Python 2 only; use input(...)
```
If a tutorial uses any of these, it's outdated. Translate to `print(...)`, `range(...)`, `input(...)`.

> **Takeaway:** `print` statements without parens, `xrange`, and `raw_input` are Python 2. You're on Python 3 — use the parenthesized / renamed versions.

---

## Cross-questions an interviewer or reviewer might ask

These are the "why X and not Y" questions that probe whether you *understand* the basics, not just memorized them.

**Q: Is Python compiled or interpreted?**
Both, depending on how you slice it. CPython compiles your source to **bytecode** automatically (cached in `__pycache__/*.pyc`), then a **virtual machine** interprets that bytecode. You never run a manual build step, so colloquially it's "interpreted," but there is a real, automatic compile phase.

**Q: Why does `input()` return a string even when the user types a number?**
Because keystrokes are characters; Python can't know your *intent* (number? zip code? part of an ID?). Returning text and letting you convert with `int()`/`float()` is unambiguous and safe.

**Q: What's the difference between `=` and `==`?**
`=` **assigns** (binds a name to a value): `x = 5`. `==` **compares** for equality and yields a `bool`: `x == 5` is `True` or `False`. Using `=` where a condition is expected is a `SyntaxError` in Python (a helpful guardrail other languages lack).

**Q: `==` vs `is`?**
`==` asks "do these have the same *value*?" `is` asks "are these the *same object* in memory?" Use `==` for value checks and `is` only for singletons like `None` (`if x is None`). Don't use `is` to compare numbers or strings — equal values aren't guaranteed to be the same object.

**Q: Why does Python use indentation instead of `{}`?**
To make the visual structure and the executed structure identical — eliminating the bug class where braces and indentation disagree. It also forces consistent formatting. (See `import this` for the design philosophy.)

**Q: Why prefer f-strings over `+` concatenation or `.format()`?**
Readability and safety. With `+` you must manually `str()`-convert numbers (`TypeError` if you forget). With `.format()`/`%` the values sit far from where they appear in the text, which is error-prone to reorder. F-strings put the value right where it reads, convert automatically, and support format specs.

**Q: Does `b = a` copy the list?**
No. It creates a *second name* for the *same* object, so mutating through one name is visible through the other (`a is b` is `True`). To get an independent copy you'd use `a.copy()` or `list(a)` (covered in the collections doc).

**Q: What does `4` print versus `print(4)` in a script vs the REPL?**
In the REPL, a bare `4` echoes `4` (the REPL prints every expression's value). In a `.py` script, a bare `4` produces no output; you need `print(4)`.

**Q: Why 4 spaces and not tabs?**
PEP 8 (the style guide) standardizes on 4 spaces. Mixing tabs and spaces causes `TabError`/`IndentationError` because the two look identical but mean different widths. Pick spaces, configure your editor, never think about it again.

---

## Try this yourself (exercises)

1. **Greeter**: ask the user for their name and age, print "Hi NAME, in 10 years you'll be AGE+10."
2. **Tip calculator**: ask for a bill amount, compute 15% tip, print bill + tip + total.
3. **Even or odd**: ask for a number; print "even" or "odd". (Hint: `n % 2 == 0`.)
4. **Hours to minutes**: ask for a number of hours, print how many minutes that is.
5. **Username generator**: ask for first name + last name; print `firstinitial + lastname` lowercased. E.g. "John Doe" → "jdoe".

You're not stuck. Get them all working before moving on.

### Hints

For #5:
```python
first = "John"
last = "Doe"
username = (first[0] + last).lower()
print(username)   # jdoe
```

`first[0]` is the first character. `.lower()` lowercases the string.

### Stretch exercises (optional)

6. **Rounded tip**: extend the tip calculator to print the total to exactly 2 decimal places using an f-string format spec (`{total:.2f}`). For a `$23.40` bill at 15% it should print `Total: $26.91`.
7. **Initials**: ask for a full name like `ada lovelace` and print the uppercase initials `A.L.`. (Hint: `name.split()` gives you `['ada', 'lovelace']`; index `[0]` of each, `.upper()`, join with `.`.)
8. **Safe age**: redo the Greeter but use `.isdigit()` so that typing `forty` prints a friendly message instead of crashing.
9. **Temperature**: ask for Celsius, print Fahrenheit (`F = C * 9/5 + 32`). For `100` it should print `212.0`.

### Worked solution for #1 (Greeter) — check yourself

```python
name = input("Your name? ")
age = int(input("Your age? "))     # convert immediately at the boundary
print(f"Hi {name}, in 10 years you'll be {age + 10}.")
```
If the user types `Alice` then `30`:
```
Hi Alice, in 10 years you'll be 40.
```

> **Takeaway:** The shape of almost every small program is: read input → convert it → compute → print with an f-string.

---

## What to read next

**Doc 02** — Data Types: numbers, strings, booleans, and how to convert between them.

```
→ Foundations/Programming/Python/02-data-types.md
```

If you're feeling ambitious, also bookmark:

```
→ Foundations/Programming/Python/05-collections.md  (lists, dicts)
```

You'll need that as soon as you outgrow single variables.

### Where the topics above are covered in depth

- **Type conversion & numbers (`int`, `float`, `str`, `bool`)** → Doc 02 (Data Types).
- **`if` / `else`, comparisons, `and`/`or`/`not`** → the control-flow doc.
- **`try` / `except` for handling bad input gracefully** → the errors/exceptions doc.
- **Lists, dicts, `.split()`, copying, `tuple unpacking`** → Doc 05 (Collections).
- **Functions, parameters, `return`, docstrings** → the functions doc.
- **Virtual environments, `pip`, project layout** → the tooling/packaging doc.

### External references (authoritative, free)

- The official tutorial: <https://docs.python.org/3/tutorial/> — the canonical first read.
- *The Zen of Python*: run `import this` in the REPL for the design philosophy in 19 lines.
- PEP 8 (style guide): <https://peps.python.org/pep-0008/> — why `snake_case`, 4 spaces, etc.

> **Takeaway:** You now have variables, `print`, `input`, comments, indentation, and the REPL — enough to write small interactive programs. Next stop: the *types* of values those variables hold.

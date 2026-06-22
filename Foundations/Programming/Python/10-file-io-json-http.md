# 10 — File I/O, JSON, and HTTP

> **Prerequisites:** `09-modules-and-testing.md`.
> **Time to read:** 30 minutes.

The three things every real Python program eventually does:
1. Read or write a file.
2. Talk JSON to other systems.
3. Make an HTTP request, or serve one.

This doc gives you the basics for all three.

---

## Reading files — `open()`

```python
f = open("notes.txt", "r")    # "r" = read mode
text = f.read()
f.close()
print(text)
```

Mode strings:
- `"r"` read (default)
- `"w"` write — **erases** existing content
- `"a"` append
- `"r+"` read AND write
- Add `"b"` for binary: `"rb"`, `"wb"` (images, zips)

### Forgetting `close()` is a bug magnet

If your program crashes between `open()` and `close()`, the file stays open. The OS may not flush data. Resources leak.

### Always use `with`

```python
with open("notes.txt", "r") as f:
    text = f.read()
# file is automatically closed here, even if an error happened
print(text)
```

`with` guarantees cleanup. Make this the only way you open files.

---

## Reading line-by-line

For big files, don't `read()` everything into memory. Loop:

```python
with open("huge.log") as f:
    for line in f:
        if "ERROR" in line:
            print(line.strip())
```

This reads one line at a time. Works for files bigger than RAM.

### Read all lines as a list

```python
with open("notes.txt") as f:
    lines = f.readlines()    # list[str]
```

OK for small files.

---

## Writing files

```python
with open("output.txt", "w") as f:
    f.write("hello\n")
    f.write("world\n")
```

`"w"` **clears** the file first. Use `"a"` to append:

```python
with open("log.txt", "a") as f:
    f.write(f"{datetime.now()}: app started\n")
```

### Multi-line write

```python
lines = ["line 1\n", "line 2\n", "line 3\n"]
with open("output.txt", "w") as f:
    f.writelines(lines)
```

`writelines` doesn't add newlines for you — include them yourself.

---

## Text vs binary

Default mode is **text**. Python decodes bytes → strings using your locale (usually UTF-8).

For images, audio, etc., use binary:

```python
with open("photo.jpg", "rb") as f:
    data = f.read()    # bytes
print(type(data))      # <class 'bytes'>
```

Writing bytes:

```python
with open("output.bin", "wb") as f:
    f.write(b"\x89PNG\r\n...")
```

The `b` prefix on a string literal makes it a `bytes` object.

---

## `pathlib` — the modern way to handle paths

`open("data/file.txt")` works, but path manipulation gets ugly fast:

```python
import os
path = os.path.join("data", "users", "2024", "alice.txt")    # cross-platform
```

`pathlib` is cleaner:

```python
from pathlib import Path

p = Path("data") / "users" / "2024" / "alice.txt"
print(p)                            # data/users/2024/alice.txt

p.parent                            # data/users/2024
p.name                              # alice.txt
p.stem                              # alice
p.suffix                            # .txt

p.exists()                          # True / False
p.is_file()
p.is_dir()
p.read_text()                       # reads the whole file as text
p.write_text("hello")               # writes (creates if needed)
p.read_bytes()                      # binary version

# Iterate a directory
for f in Path(".").glob("*.py"):    # all .py files in current dir
    print(f)
```

Use `pathlib` for new code. `os.path` works but is more verbose.

---

## JSON — talking to the world

JSON is a text format for data. It looks like:

```json
{
  "name": "Alice",
  "age": 30,
  "hobbies": ["reading", "hiking"],
  "is_active": true,
  "score": null
}
```

Almost every web API uses JSON. Python ↔ JSON is straightforward.

### Python types ↔ JSON types

| Python | JSON |
|---|---|
| dict | object `{...}` |
| list, tuple | array `[...]` |
| str | string |
| int, float | number |
| True / False | true / false |
| None | null |

### Convert Python → JSON

```python
import json

data = {"name": "Alice", "age": 30, "active": True}
text = json.dumps(data)
print(text)
# {"name": "Alice", "age": 30, "active": true}
```

Pretty print:

```python
text = json.dumps(data, indent=2)
print(text)
```

### Convert JSON → Python

```python
text = '{"name": "Alice", "age": 30}'
data = json.loads(text)
print(data["name"])    # Alice
```

### Read JSON from a file

```python
with open("config.json") as f:
    config = json.load(f)    # note: load (no s) for files
```

### Write JSON to a file

```python
with open("out.json", "w") as f:
    json.dump(config, f, indent=2)    # dump (no s) for files
```

### Custom types

`json.dumps` doesn't know about your classes:

```python
from dataclasses import dataclass, asdict

@dataclass
class User:
    name: str
    age: int

u = User("Alice", 30)
json.dumps(u)               # ERROR
json.dumps(asdict(u))       # works: {"name": "Alice", "age": 30}
```

`asdict` converts a dataclass to a dict.

For more complex types (datetime, etc.), pass `default`:

```python
from datetime import datetime

def encode(obj):
    if isinstance(obj, datetime):
        return obj.isoformat()
    raise TypeError

data = {"when": datetime.now()}
print(json.dumps(data, default=encode))
# {"when": "2026-05-17T14:23:00.123456"}
```

---

## HTTP requests — the `requests` library

Standard library has `urllib`, but it's clunky. Everyone uses `requests`:

```bash
pip install requests
```

```python
import requests

# GET
r = requests.get("https://api.github.com/users/torvalds")
print(r.status_code)          # 200
print(r.json())               # parsed JSON as dict

# POST with JSON
r = requests.post(
    "https://example.com/api/users",
    json={"name": "Alice", "age": 30},
    headers={"Authorization": "Bearer xyz"},
)
print(r.status_code)
print(r.text)                 # raw response body
```

### Common patterns

```python
# Query parameters
r = requests.get("https://api.example.com/search", params={"q": "python", "limit": 10})
# URL becomes: https://api.example.com/search?q=python&limit=10

# Custom headers
r = requests.get(url, headers={"User-Agent": "MyBot/1.0"})

# Timeout (DO use this — never let a request hang forever)
r = requests.get(url, timeout=5)    # seconds

# File upload
r = requests.post(url, files={"file": open("photo.jpg", "rb")})

# Form data (not JSON)
r = requests.post(url, data={"username": "alice", "password": "secret"})
```

### Status codes you should know

| Code | Meaning |
|---|---|
| 200 | OK |
| 201 | Created (POST succeeded) |
| 204 | No content |
| 301/302 | Redirect |
| 400 | Bad request (your fault) |
| 401 | Unauthorized (no auth) |
| 403 | Forbidden (auth, but not allowed) |
| 404 | Not found |
| 429 | Too many requests (rate-limited) |
| 500 | Server error (their fault) |
| 502/503/504 | Server is having a bad day |

```python
r = requests.get(url)
if r.status_code == 200:
    data = r.json()
elif r.status_code == 404:
    print("not found")
else:
    r.raise_for_status()    # raise an exception
```

### Sessions — reuse connections

For many requests to the same host:

```python
session = requests.Session()
session.headers.update({"Authorization": "Bearer xyz"})

r1 = session.get("https://api.example.com/users")
r2 = session.get("https://api.example.com/orders")
# Faster: reuses TCP connection
```

---

## A tiny HTTP server

The standard library has `http.server` for quick file serving:

```bash
python3 -m http.server 8000
# now visit http://localhost:8000 — serves the current directory
```

For a real API, use a framework. The simplest is `Flask`:

```bash
pip install flask
```

```python
# app.py
from flask import Flask, request, jsonify

app = Flask(__name__)

users = []

@app.route("/users", methods=["GET"])
def list_users():
    return jsonify(users)

@app.route("/users", methods=["POST"])
def add_user():
    body = request.get_json()
    users.append(body)
    return jsonify(body), 201

if __name__ == "__main__":
    app.run(port=8000)
```

Run:

```bash
python app.py
```

Test in another terminal:

```bash
curl localhost:8000/users
# []

curl -X POST localhost:8000/users -H "Content-Type: application/json" -d '{"name":"Alice"}'
# {"name":"Alice"}

curl localhost:8000/users
# [{"name":"Alice"}]
```

For more serious projects: **FastAPI** (modern, async, auto-docs), **Django** (full-featured framework).

---

## Worked example — read a CSV-like file, transform, write JSON

```python
from pathlib import Path
import json

def parse_users(path: Path):
    """Read a TSV file with name<TAB>age, return list of dicts."""
    users = []
    for line in path.read_text().strip().split("\n"):
        name, age = line.split("\t")
        users.append({"name": name, "age": int(age)})
    return users


def main():
    # Setup test input
    Path("input.tsv").write_text(
        "Alice\t30\n"
        "Bob\t25\n"
        "Carol\t40\n"
    )

    users = parse_users(Path("input.tsv"))
    adults = [u for u in users if u["age"] >= 30]

    Path("adults.json").write_text(json.dumps(adults, indent=2))
    print(f"Wrote {len(adults)} adults")


if __name__ == "__main__":
    main()
```

Run, then `cat adults.json` shows:

```json
[
  {
    "name": "Alice",
    "age": 30
  },
  {
    "name": "Carol",
    "age": 40
  }
]
```

---

## Testing code that does HTTP

You don't want tests that hit the real network. Mock the response:

```python
# my_app.py
import requests

def get_user_name(user_id):
    r = requests.get(f"https://api.example.com/users/{user_id}")
    return r.json()["name"]
```

```python
# test_my_app.py
from unittest.mock import patch, MagicMock
from my_app import get_user_name

def test_get_user_name():
    with patch("my_app.requests.get") as mock_get:
        mock_get.return_value = MagicMock(
            json=lambda: {"name": "Alice"}
        )
        assert get_user_name(123) == "Alice"
```

Or use `responses` / `httpx-mock` libraries that mock at a higher level.

---

## Common mistakes

### 1. Forgetting to close files (without `with`)

```python
f = open("file.txt")
data = f.read()
# crash here → file leaks
f.close()
```

Always `with`.

### 2. `json.dumps` on non-JSON types

```python
import datetime
json.dumps({"now": datetime.datetime.now()})    # ERROR
```

Convert to ISO string first, or pass a `default=` function.

### 3. No timeout on requests

```python
r = requests.get(url)    # could hang forever
```

A misbehaving server can lock your program. **Always set a timeout** in production.

### 4. Reading huge files into memory

```python
data = open("100GB.log").read()    # boom
```

Iterate line-by-line for big files.

### 5. Confusing `dump` vs `dumps`

- `dump(data, file)` writes to a file.
- `dumps(data)` returns a string. (`s` for "string".)

Same for `load` vs `loads`.

### 6. Encoding issues

```python
with open("data.txt") as f:    # uses system default encoding
    text = f.read()
```

Be explicit on Windows or for non-English text:

```python
with open("data.txt", encoding="utf-8") as f:
    text = f.read()
```

UTF-8 is the right default in 99% of cases.

---

## Exercises

1. **Word count.** Read a text file, count word frequency (use `collections.Counter`), write top 10 to JSON.
2. **API fetcher.** Use `requests` to fetch `https://jsonplaceholder.typicode.com/users`, write each user to a separate JSON file: `user_1.json`, `user_2.json`, etc.
3. **CSV transformer.** Use the standard library `csv` module to read a CSV with columns `name,score`, filter rows where score ≥ 50, write to a new CSV.
4. **Mini server.** Use Flask to serve a `/echo` endpoint that returns the JSON body of any POST request, plus a server-side timestamp.

### Hint for #1

```python
from pathlib import Path
from collections import Counter
import json
import re

text = Path("input.txt").read_text().lower()
words = re.findall(r"\w+", text)
top = Counter(words).most_common(10)
Path("top.json").write_text(json.dumps(top, indent=2))
```

---

## What's next

```
→ Foundations/Programming/Python/11-stdlib-tour.md
```

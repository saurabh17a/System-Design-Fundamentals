# 01 — Getting Started with Go

> **Prerequisites:** none, but knowing any language helps.
> **Time to read:** 25 minutes.

---

## What is Go?

**Go** (or **Golang**) is a statically-typed, compiled language created at Google in 2009. It was designed for:
- **Servers and infrastructure**: Docker, Kubernetes, Terraform are written in Go.
- **Concurrency**: built-in `goroutines` make running 10,000 things at once trivial.
- **Fast compilation**: a million-line program compiles in seconds.
- **Simplicity**: only ~25 keywords. Easy to learn quickly.

If you know Python, Go feels different:
- **Static typing** — types declared up front; the compiler catches errors before you run.
- **Compiled** — produces a single binary, runs fast.
- **No classes** — Go uses structs + interfaces (similar idea, simpler).
- **Explicit error handling** — no exceptions; errors are return values.

Companies using Go: Google, Uber, Twitch, DoorDash, Stripe, Cloudflare, Dropbox, Discord.

### In plain English (read this first)

Imagine you're writing a recipe. In some languages (like Python) the kitchen lets you start cooking immediately and only complains *while you're cooking* if you grabbed salt instead of sugar. Go is the kitchen that reads your *entire* recipe before you turn on the stove and says: "Line 12 says add 3 cups of a thing that doesn't exist — fix it before you cook." That up-front check is **static typing + compilation**. It feels stricter at first, but it means whole categories of "oops" are impossible by the time the program actually runs.

Three plain-English ideas to hold onto:
1. **Compiled, not interpreted.** You first turn your source code into a single machine-runnable file (a *binary*), then you run that file. Python and JavaScript instead read and run your text line-by-line each time.
2. **One binary, no dependencies.** When Go finishes building, you get *one* file. You can copy it to another computer (same OS/CPU) and it just runs — no "install Go first," no `pip install`, no `node_modules`.
3. **Boring on purpose.** Go deliberately has few features and one obvious way to do most things. That's a design choice to make large teams' code look the same and read easily, not a limitation you'll "grow out of."

### The precise / technical version

- **Statically typed:** every variable has a type known at compile time. Type errors are caught by the compiler (`go build`), not at runtime.
- **Compiled, ahead-of-time (AOT):** `go build` produces a native machine-code executable. There is no separate VM or interpreter at runtime (unlike the JVM or CPython). The Go *runtime* (garbage collector, goroutine scheduler) is statically linked **into** the binary, which is why the binary is self-contained.
- **Garbage collected:** you don't manually `free` memory; a concurrent, low-latency GC reclaims it. You still control *allocation* heavily through value vs. pointer semantics (covered in later docs).
- **Structurally typed interfaces:** a type satisfies an interface by having the right methods — no `implements` declaration (more in `07-interfaces.md`).
- **CSP-style concurrency:** goroutines (cheap, runtime-scheduled functions) communicate over channels, following Tony Hoare's *Communicating Sequential Processes* model. The mantra: *"Don't communicate by sharing memory; share memory by communicating."*

**Takeaway:** Go trades a little up-front strictness for fast builds, fast programs, easy deployment, and code that stays readable as teams grow.

---

## Installing Go

Need **Go 1.21 or newer** for everything in this knowledge base.

**Mac:**
```bash
brew install go
```

**Windows:**
[go.dev/doc/install](https://go.dev/doc/install) — download the installer.

**Linux:**
```bash
# Most package managers have it
sudo apt install golang
# or download from go.dev for latest
```

> **Gotcha — distro packages are often old.** `apt`, `yum`, etc. frequently ship a Go release that's a year or two behind. If `go version` shows something older than 1.21, uninstall it and grab the official tarball from [go.dev/dl](https://go.dev/dl). Modern Go also lets you pin a version per project via a `go` directive in `go.mod` (e.g. `go 1.22`) and will auto-download a matching toolchain.

### Verify

```bash
go version
# go version go1.21.x ...
```

### Two environment values worth knowing

Run `go env` to see Go's configuration. Two values matter early:

```bash
go env GOROOT   # where Go itself is installed (you rarely touch this)
go env GOPATH   # default: ~/go — where 'go install' drops binaries and caches modules
```

- **GOROOT** is the Go installation. Leave it alone; the installer sets it.
- **GOPATH** (default `~/go`) is your workspace cache. Binaries you install with `go install some/tool@latest` land in `$GOPATH/bin`. **Add that to your `PATH`** so installed tools are runnable:

```bash
# add to ~/.zshrc or ~/.bashrc
export PATH="$PATH:$(go env GOPATH)/bin"
```

> **Beginner confusion, cleared up:** Old tutorials (pre-2018) insist you must put *all your code* inside `$GOPATH/src`. **That is obsolete.** Since Go modules (Go 1.11+), your project can live anywhere on disk. If a tutorial tells you to `mkdir -p $GOPATH/src/github.com/you/proj`, it's out of date — ignore it and use `go mod init` (shown below).

---

## Your first program

Make a file called `hello.go`:

```go
package main

import "fmt"

func main() {
    fmt.Println("Hello, world!")
}
```

Run it:

```bash
go run hello.go
# Hello, world!
```

That's it. Go *compiles* and runs in one step (`go run`). You can also build a standalone binary:

```bash
go build hello.go
./hello
# Hello, world!
```

The binary is portable — no Go install needed on the target machine.

### `go run` vs `go build` — which, when, and why

| Command | What it does | Leaves a file? | Use it when |
|---|---|---|---|
| `go run hello.go` | Compiles to a *temp* location, runs it, deletes it | No | Quick iteration / experimenting |
| `go build` | Compiles to a binary in the current dir | Yes (`./hello`) | You want an artifact to run/ship |
| `go install` | Builds and copies the binary into `$GOPATH/bin` | Yes (on PATH) | Installing a CLI tool you'll reuse |

> **Why does `go run` feel "interpreted" if Go is compiled?** It isn't interpreted — `go run` *does* compile, but to a throwaway temp file it runs and discards. The first run of a fresh project may be slightly slower (compiling) and subsequent runs are fast because Go caches compiled packages under `$GOPATH/pkg` / the build cache. To prove it compiled, run `go build` and inspect the real binary with `ls -lh hello` (it'll be a few MB — that's your code *plus* the Go runtime baked in).

**Takeaway:** `go run` for tinkering, `go build` for a shippable artifact, `go install` for CLI tools.

---

## Anatomy of a Go program

```go
package main          // every file belongs to a package; main is the executable

import "fmt"          // import a library

func main() {         // entry point of the program
    fmt.Println("Hi")
}
```

- `package main`: declares this file as part of the `main` package. The `main` package gives an executable.
- `import "fmt"`: bring in the `fmt` (format) package — for printing.
- `func main()`: the function that runs when you start the program.

Every Go program has exactly one `main` function in package `main`.

### Why a `main` package *and* a `main` function?

Beginners often ask "why both?" They're different things:
- A **package** is a *unit of code organization* — a folder of `.go` files that share scope. `package main` is the one special package name that tells the linker "build an executable, not a library."
- The **`main` function** is the *entry point* — the single function the runtime calls after startup.

A library package (e.g. `package strings`) has **no** `main` function and cannot be run directly — only imported.

### `import` blocks (the form you'll see most)

A single import is fine, but real files group them:

```go
import (
    "fmt"
    "os"
    "strings"
)
```

`gofmt` sorts these alphabetically for you. Standard-library imports and third-party imports are conventionally separated by a blank line (tools like `goimports` do this automatically):

```go
import (
    "fmt"
    "net/http"

    "github.com/google/uuid"
)
```

> **Cross-question — "Why is `fmt` not built into the language like Python's `print`?"** Go keeps the *language* tiny (~25 keywords, a handful of builtins like `len`, `make`, `append`). Almost everything else — printing, files, HTTP — lives in the **standard library**, which you opt into via `import`. This keeps the language stable and the runtime small, and means printing isn't magic: `fmt.Println` is just a normal exported function in a normal package.

---

## Variables

Three ways to declare a variable:

```go
var name string = "Alice"   // explicit type
var age = 30                // type inferred (still "var")
city := "NYC"               // short form: type inferred, declares variable
```

`:=` is the most common in function bodies. `var` is used at package level (outside functions).

### The mental model: `:=` is *declare + assign*, `=` is *assign only*

```go
count := 0   // ":=" : "this name is NEW; create it and give it a value"
count = 5    // "="  : "this name already EXISTS; just change its value"
```

This is the #1 syntax tripwire for newcomers. `:=` may only appear when you are introducing **at least one new** variable on the left.

### Zero values — there is no "uninitialized" variable

Plain English: in Go, a variable you declare but don't assign is **not** garbage and **not** null-in-the-crashy-sense — it gets a sensible default called the **zero value**.

```go
var (
    i int        // 0
    f float64    // 0
    b bool        // false
    s string     // ""  (empty string, NOT nil)
    p *int        // nil (pointers, slices, maps, channels, funcs, interfaces zero to nil)
)
fmt.Printf("%d %g %t %q %v\n", i, f, b, s, p)
// 0 0 false "" <nil>
```

**Why this matters:** you can almost always declare a value and start using it without worrying about "did I forget to initialize it?" A `var sum int` is immediately a usable `0`. This is a deliberate Go feature — it removes a whole class of "uninitialized variable" bugs.

**Takeaway:** every Go type has a well-defined zero value; declaring is enough to get a safe default.

### Multi-variable declaration

```go
var x, y, z int = 1, 2, 3
a, b := 5, 10
```

The grouped `var (...)` form is idiomatic for several related declarations:

```go
var (
    host = "localhost"
    port = 8080
    tls  = false
)
```

### Reassigning

```go
score := 50
score = 75       // works — same type
// score = "high"  // ERROR: can't change type
```

Go is strictly typed. Once `score` is `int`, it stays `int`.

### Constants

```go
const Pi = 3.14159
const MaxRetries = 5
const Greeting = "Hello"
```

Constants can't change. Convention: `PascalCase` for exported, `camelCase` for internal.

#### Grouped constants and `iota`

Related constants are grouped, and `iota` auto-generates incrementing values — perfect for enums:

```go
const (
    StatusActive   = iota  // 0
    StatusInactive         // 1  (iota increments, expression repeats)
    StatusBanned           // 2
)

const (
    _  = iota             // skip 0
    KB = 1 << (10 * iota) // 1 << 10 = 1024
    MB                    // 1 << 20
    GB                    // 1 << 30
)

func main() {
    fmt.Println(StatusBanned, KB, MB, GB)
    // 2 1024 1048576 1073741824
}
```

> **Untyped constants are a superpower.** `const Pi = 3.14159` has no fixed type until it's used; it's an *untyped* constant. That's why `const big = 1 << 62` works and why `var x float64 = Pi` and `var y float32 = Pi` both compile from the same constant. Constants also have *arbitrary precision* at compile time, so `const huge = 1 << 100` is legal as long as you don't assign it to a too-small type.

**Takeaway:** use `const` + `iota` for enum-like sets; untyped constants adapt to whatever numeric type uses them.

---

## Output and input

### `fmt.Println` — print line

```go
fmt.Println("Hello", "world", 2026)
// Hello world 2026
```

`Println` inserts a space between arguments and a newline at the end. Its sibling `fmt.Print` does **neither extra newline nor reliable spacing** — it only puts spaces between operands when *neither* is a string:

```go
fmt.Print("a", "b", "\n")  // ab           (no spaces: both strings)
fmt.Print(1, 2, "\n")      // 1 2          (space: neither is a string)
```

> **Gotcha:** that asymmetry surprises people. When in doubt, use `Println` (predictable) or `Printf` (you control spacing explicitly).

### `fmt.Printf` — formatted print

```go
name := "Alice"
age := 30
fmt.Printf("Hi %s, you are %d.\n", name, age)
// Hi Alice, you are 30.
```

> **Don't forget the `\n`.** `Printf` does **not** add a trailing newline. Omitting `\n` is the most common "why is my output on one line?" beginner bug.

Common verbs:
- `%s` — string
- `%d` — integer (decimal)
- `%f` — float
- `%v` — any value, default format
- `%+v` — struct with field names
- `%T` — type
- `%t` — boolean

```go
fmt.Printf("%v\n", []int{1, 2, 3})       // [1 2 3]
fmt.Printf("%T\n", "hello")              // string
fmt.Printf("%.2f\n", 3.14159)            // 3.14
```

A few more verbs you'll reach for constantly:

```go
fmt.Printf("%q\n", "hi")                 // "hi"        (double-quoted string)
fmt.Printf("%#v\n", []int{1, 2})         // []int{1, 2} (Go-syntax representation)
fmt.Printf("%b %o %x\n", 255, 255, 255)  // 11111111 377 ff (binary, octal, hex)
fmt.Printf("%5d|%-5d|\n", 42, 42)        //    42|42   |     (width + left-align)
fmt.Printf("%p\n", &name)                // 0xc0000... (pointer address)
```

> **Mismatched verb = silent-ish bug.** If the verb and the value disagree, Go doesn't crash — it prints an error *into the output*:
> ```go
> fmt.Printf("%d\n", "hello")  // %!d(string=hello)
> ```
> Seeing `%!d(...)` in your output means "wrong verb for this type." `go vet` (covered below) catches many of these at build time.

### Sprintf — return a string instead of printing

```go
msg := fmt.Sprintf("Score: %d", 99)
fmt.Println(msg)
```

The whole `fmt` print family is symmetric — pick by *destination*:

| Want to... | Function |
|---|---|
| Print to stdout | `fmt.Print` / `Println` / `Printf` |
| Build a string | `fmt.Sprint` / `Sprintln` / `Sprintf` |
| Write to a file / buffer / socket | `fmt.Fprint` / `Fprintln` / `Fprintf` |
| Print to **stderr** | `fmt.Fprintln(os.Stderr, "oops")` |

```go
import (
    "fmt"
    "os"
)
// Logs/errors belong on stderr so they don't pollute piped stdout:
fmt.Fprintln(os.Stderr, "warning: config missing, using defaults")
```

### Reading input

```go
var name string
fmt.Print("Name: ")
fmt.Scanln(&name)
fmt.Println("Hello,", name)
```

`&name` passes the address (pointer) so `Scanln` can write into it. (More on pointers later.)

> **Why `&name` and not just `name`?** Go passes arguments **by value** — `Scanln` would receive a *copy* and any change would be thrown away. Passing `&name` (the variable's address) lets `Scanln` write back into *your* variable. This is the same reason `Scanln` returns nothing useful you'd act on for the value itself.

> **Gotcha — `Scanln` stops at whitespace.** `fmt.Scanln(&name)` reads only up to the first space, so typing `Mary Jane` puts only `Mary` in `name`. To read a whole line, use `bufio`:
> ```go
> import "bufio"
> reader := bufio.NewReader(os.Stdin)
> line, _ := reader.ReadString('\n')   // includes the trailing '\n'
> line = strings.TrimSpace(line)        // strip it
> ```
> Always check the error from input functions in real programs; the `_` here is just to keep the snippet short.

**Takeaway:** input needs `&` (a pointer) so the function can fill your variable; use `bufio` when you need whole lines.

---

## Comments

```go
// Single-line comment.

/*
Multi-line comment.
Less common in Go.
*/
```

### Doc comments (the kind tooling reads)

A comment placed *directly above* a package, function, type, or constant — with **no blank line** between — becomes its documentation, surfaced by `go doc` and on [pkg.go.dev](https://pkg.go.dev). Convention: start with the name being described.

```go
// Package mathutil provides small numeric helpers.
package mathutil

// Add returns the sum of a and b.
func Add(a, b int) int {
    return a + b
}
```

```bash
go doc mathutil.Add
# Add returns the sum of a and b.
```

**Takeaway:** doc comments aren't decoration — they're the actual, tool-rendered docs for your code. Write them for every exported name.

---

## A complete first program

```go
package main

import "fmt"

func main() {
    var name string
    fmt.Print("What's your name? ")
    fmt.Scanln(&name)

    age := 25
    futureAge := age + 10

    fmt.Printf("Hi %s! In 10 years you'll be %d.\n", name, futureAge)
}
```

Save as `greet.go`, run:

```bash
go run greet.go
What's your name? Alice
Hi Alice! In 10 years you'll be 35.
```

---

## Visibility (exported vs unexported)

In Go, capitalization matters!

- **Capitalized name** (e.g. `Println`, `Counter`): **exported** — visible outside the package.
- **lowercase name** (e.g. `print`, `counter`): **unexported** — only visible inside the package.

```go
package mypkg

func PublicFunc() {}    // can be called from other packages
func privateFunc() {}   // only visible within mypkg
```

This replaces explicit `public`/`private` keywords. Simpler, fewer ways to get it wrong.

> **Cross-question — "Why tie visibility to the *first letter* instead of a keyword?"** Two reasons. (1) It's *visible at the call site*: when you read `user.Name` vs `user.age` you instantly know which is public API and which is internal — no jumping to the declaration. (2) It collapses Java's four-way `public/protected/private/package-private` into a clear two-way split (package-private vs exported), which matches Go's "fewer ways to do it" philosophy. The unit of encapsulation is the **package**, not the type — code in the same package can touch each other's lowercase names freely.

**Takeaway:** capital = public across packages, lowercase = private to the package. The package is the privacy boundary.

---

## Project structure (briefly)

A simple Go project:

```
myproject/
├── go.mod          ← module file (like Python's requirements.txt + setup.py)
├── main.go
└── helpers/
    └── util.go
```

To start a project:

```bash
mkdir myproject && cd myproject
go mod init myproject

# Make main.go
go run .
```

`go mod init` creates `go.mod` declaring the module name. Then you can split code into multiple files / sub-packages.

We'll use single-file programs in early docs.

### What `go.mod` actually contains

```go
module github.com/you/myproject

go 1.22

require github.com/google/uuid v1.6.0
```

- **`module`** — the import path other code uses to reference your package. For libraries you publish, use the repo URL (`github.com/you/myproject`); for throwaway local programs any name works.
- **`go`** — the minimum/intended Go language version (and toolchain selector).
- **`require`** — your direct dependencies and their *exact, pinned* versions.

Two everyday commands:
```bash
go get github.com/google/uuid@latest   # add or upgrade a dependency
go mod tidy                              # add missing + remove unused deps, sync go.sum
```

A companion file, **`go.sum`**, records cryptographic checksums of every dependency version so builds are verifiable and reproducible. Commit both `go.mod` and `go.sum`.

> **`go run .` vs `go run main.go` — subtle but important.** `go run .` compiles the *whole package in the current directory* (all its `.go` files together), so it sees helper functions defined in sibling files. `go run main.go` compiles **only that one file** — if `main.go` calls a function defined in `util.go`, it fails with "undefined." Once your program is more than one file, prefer `go run .` / `go build .`.

**Takeaway:** `go.mod` + `go.sum` pin your dependencies reproducibly; build the whole package with `go run .`, not a single file.

---

## Go's philosophy

Some quirks you'll notice:

### "There's only one way to do it"

Unlike Python's "there's many ways," Go aims for one obvious way. Less debate, less style debate.

### Strict formatting

Run `gofmt` (or your editor on save). Go has ONE canonical format. No tabs vs spaces debates.

```bash
gofmt -w main.go
```

In practice you'll use `go fmt ./...` (formats every package in the tree) and lean on your editor's format-on-save. CI commonly *fails the build* if code isn't gofmt-clean:

```bash
gofmt -l .            # lists files that are NOT formatted (empty output = all good)
go fmt ./...          # formats everything
```

> **Cross-question — "Isn't a forced formatter restrictive?"** The opposite, in practice: because *all* Go code looks the same, diffs are about logic (not style churn), code review never argues about brace placement, and reading an unfamiliar codebase is frictionless. Go's authors consider gofmt one of the language's most valuable features precisely because it ended formatting debates permanently.

### `go vet` — catch suspicious code the compiler allows

The compiler proves your program is *type-correct*; `go vet` catches things that compile but are probably wrong — like the `Printf` verb mismatch above, unreachable code, or copying a lock.

```bash
go vet ./...
```

Run `gofmt`/`go fmt`, then `go vet`, then your tests — that's the standard local check loop.

### Errors are values

No exceptions. Functions that can fail return an `error`:

```go
data, err := os.ReadFile("config.txt")
if err != nil {
    fmt.Println("error:", err)
    return
}
fmt.Println(string(data))
```

You'll write `if err != nil` a lot. It's not pretty, but it's explicit.

Plain-English version: in Python you might write `try: ... except: ...` and errors *fly upward* until something catches them. Go has no such throwing. A function that can fail simply *returns* the error alongside its result, and **you** decide right there whether to handle it, wrap it, or pass it up. Nothing is hidden; the failure path is in your face on the line where it can happen.

The canonical multi-return shape:

```go
func half(n int) (int, error) {
    if n%2 != 0 {
        return 0, fmt.Errorf("%d is not even", n)
    }
    return n / 2, nil   // nil error == success
}

func main() {
    h, err := half(7)
    if err != nil {
        fmt.Println("failed:", err)   // failed: 7 is not even
        return
    }
    fmt.Println(h)
}
```

> **Cross-question — "Why no exceptions? Isn't `if err != nil` everywhere just noise?"** The trade is *explicitness over brevity*. Exceptions create invisible control-flow: any line might jump elsewhere, and it's easy to forget to handle a failure. Go makes every fallible call's error a visible value you must acknowledge (or explicitly discard with `_`). The cost is verbosity; the benefit is that you can read a function top-to-bottom and see exactly where and how it can fail. Go *does* have `panic`/`recover`, but those are reserved for truly unrecoverable situations (programming bugs), not ordinary errors like "file not found."

**Takeaway:** errors are ordinary return values you handle inline; reserve `panic` for "this should never happen" bugs.

### Unused things are errors

```go
import "fmt"
import "os"     // unused → compile error

func main() {
    x := 5      // x unused → compile error
    fmt.Println("hi")
}
```

The compiler forces you to clean up. Pythonic "lazy" code doesn't compile.

> **Important nuance — only *local variables* and *imports* trip this.** Unused **package-level** variables, unused constants, and unused struct fields are all allowed. The rule targets the two things that most often signal a real mistake: an import you no longer need, and a local you declared but forgot to use (often a typo or half-finished edit). If you genuinely need to ignore a value, use the blank identifier `_`:
> ```go
> _, err := fmt.Println("hi")   // explicitly discard the byte count
> ```

### Strict interfaces, but implicit

You don't `implements Stringer` like Java. If your type has the right methods, it's a Stringer. We'll cover this in `07-interfaces.md`.

---

## Idioms & best practices (and when NOT to)

- **Prefer `:=` inside functions, `var` at package scope.** `:=` is concise and only legal inside functions; package-level declarations must use `var`/`const`.
- **Use the grouped `import (...)`, `var (...)`, `const (...)` blocks** for related declarations — gofmt aligns them and it reads cleanly.
- **Name things short in small scopes, descriptive in large ones.** A loop index is `i`; a long-lived exported value is `MaxConnections`. Go style favors `i`, `r` (reader), `buf`, `n` over `theCurrentLoopIndexCounter`.
- **Don't ignore errors silently.** `data, _ := os.ReadFile(...)` is occasionally fine in a throwaway script but a smell in real code. Handle it or wrap it with context: `fmt.Errorf("reading config: %w", err)`.
- **Return early on errors** (guard clauses) instead of deep `if/else` nesting — the happy path stays un-indented at the bottom.
- **Let tooling format and vet your code.** Format-on-save + `go vet ./...` in CI. Don't hand-align code.
- **When NOT to reach for advanced features yet:** you do *not* need goroutines, channels, generics, or interfaces to write your first programs. Those are powerful but easy to overuse. Beginners should write plain, sequential, single-file programs first — Go reads fine that way, and premature concurrency is a classic source of bugs.

---

## Common mistakes for beginners

**1. Forgetting `package main`.**
Every executable file needs `package main` at the top.

**2. Forgetting to import.**
Used `fmt.Println` but didn't `import "fmt"`? Compile error. Most editors auto-add.

**3. Wrong indentation = wrong code.**
Python uses indentation as syntax. Go uses braces. Indentation is for humans only — `gofmt` enforces it.

**4. Using `=` for declaration.**
```go
x := 5    // declare AND assign
y = 5     // ERROR: y not declared
```

**5. Importing but not using.**
```go
import "os"   // ERROR if you don't use os.X
```

Tooling tip: most editors auto-remove unused imports.

**6. Capitalization mismatch.**
```go
import "fmt"
fmt.println("hi")   // ERROR: it's Println, capital P
```

**7. Putting the opening brace on its own line.**
Go's automatic semicolon insertion *requires* the `{` on the same line as `func`/`if`/`for`:
```go
// WRONG — does not compile
func main()
{
    fmt.Println("hi")
}
// RIGHT
func main() {
    fmt.Println("hi")
}
```
*Why:* the Go lexer inserts a semicolon after `main()`, ending the statement before the brace. The fix is always "brace on the same line" — and `gofmt` won't even let you write it the other way.

**8. Using `:=` when you meant to assign to an existing variable.**
```go
total := 0
for i := 0; i < 3; i++ {
    total := total + i   // BUG: ":=" makes a NEW total scoped to the loop body
}
fmt.Println(total)        // 0  — outer total never changed!
```
Fix: use `=` to update the outer variable:
```go
total = total + i        // or: total += i
```
This "shadowing" bug is subtle because it compiles fine. `go vet`'s shadow checks and good editors flag it.

**9. Reading multi-word input with `Scanln`.**
```go
fmt.Scanln(&name)   // typing "Mary Jane" stores only "Mary"
```
Fix: use `bufio.NewReader(os.Stdin).ReadString('\n')` for whole lines (see the input section).

**10. Forgetting `\n` in `Printf` / wrong format verb.**
```go
fmt.Printf("Hi %s", name)   // no newline; next output runs on the same line
fmt.Printf("%d", "oops")    // prints %!d(string=oops)
```
Fix: add `\n`; match the verb to the type; run `go vet`.

---

## Exercises

1. **Greeter**: ask name and age; print a personalized message including age in 10 years.
2. **Tip calculator**: read a bill amount (float); print 10%, 15%, 20% tips and totals.
3. **Even or odd**: read a number; print "even" or "odd". (`n % 2 == 0`.)
4. **Hours/minutes**: read total minutes; print as `HH:MM`. e.g. 130 → `02:10`.
5. **Initials**: read first and last name; print initials like `J.D.`.
6. **Unit converter**: read kilometers (float); print miles (`* 0.621371`) formatted to 2 decimals with `%.2f`.
7. **Temperature**: read Celsius (float); print Fahrenheit (`c*9/5 + 32`). Watch integer-vs-float division — make the literals floats.

### Hints

For #2 — reading a float:
```go
var bill float64
fmt.Scanln(&bill)
```

For #4:
```go
hours := total / 60
mins := total % 60
fmt.Printf("%02d:%02d\n", hours, mins)
```

`%02d` pads with leading zero to 2 digits.

For #7 — the float-division trap:
```go
c := 100.0
f := c*9/5 + 32      // 212  — works because c is float64
// If c were an int, c*9/5 would do integer division. Convert: float64(c)*9/5 + 32
```

### One worked solution (Exercise 3: even or odd)

```go
package main

import "fmt"

func main() {
    var n int
    fmt.Print("Enter a number: ")
    fmt.Scanln(&n)

    if n%2 == 0 {
        fmt.Printf("%d is even\n", n)
    } else {
        fmt.Printf("%d is odd\n", n)
    }
}
```

```bash
go run evenodd.go
Enter a number: 7
7 is odd
```

**Takeaway:** `%` is the modulo operator; `n % 2 == 0` is the canonical even test.

---

## What's next

**Doc 02** — Types and Variables: int, string, bool, and Go's type system.

```
→ Foundations/Programming/Go/02-types-and-variables.md
```

### Further reading (official, free)

- **[A Tour of Go](https://go.dev/tour/)** — interactive, in-browser, the canonical first walkthrough. Do this alongside these docs.
- **[Effective Go](https://go.dev/doc/effective_go)** — the style/idiom bible referenced throughout this knowledge base.
- **[Go by Example](https://gobyexample.com/)** — short, runnable snippets for nearly every feature.
- **[pkg.go.dev/std](https://pkg.go.dev/std)** — the standard library reference (start with `fmt`, `os`, `strings`, `strconv`).
- **`go doc`** — read docs offline from your terminal: `go doc fmt.Printf`, `go doc strings`.

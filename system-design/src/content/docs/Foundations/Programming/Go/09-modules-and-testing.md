# 09 — Modules, Packages, and Testing

> **Prerequisites:** `08-goroutines-and-channels.md` (or any earlier doc).
> **Time to read:** 30 minutes.

So far we've put everything in `package main`. Real Go programs are split across many files and packages, depend on external libraries, and have tests. Time to learn how.

---

## Packages — Go's organizational unit

A **package** is a directory of `.go` files that share a `package <name>` declaration at the top.

```
greetings/
├── greetings.go         (package greetings)
└── helpers.go           (package greetings)
```

Both files are in the same directory and declare `package greetings`. They share names: a function in `greetings.go` can call any non-method function in `helpers.go`.

### Visibility — capital = exported

```go
// greetings.go
package greetings

func Hello(name string) string {        // exported (Capital)
    return "Hello, " + format(name)
}

func format(s string) string {           // unexported (lowercase)
    return s
}
```

Outside the package, only `Hello` is visible. `format` is private.

This is Go's encapsulation: by capitalization, not keyword.

---

## Modules — Go's dependency unit

A **module** is a collection of related packages that's versioned together. Every Go project starts by creating one:

```bash
mkdir my-app
cd my-app
go mod init github.com/alice/my-app
```

This creates `go.mod`:

```
module github.com/alice/my-app

go 1.21
```

The module path (`github.com/alice/my-app`) becomes the prefix for all imports of code in this module.

### Project structure

```
my-app/
├── go.mod
├── go.sum
├── main.go              (package main)
├── greetings/
│   ├── greetings.go     (package greetings)
│   └── helpers.go       (package greetings)
└── math/
    └── ops.go            (package math)
```

In `main.go`:

```go
package main

import (
    "fmt"
    "github.com/alice/my-app/greetings"
)

func main() {
    fmt.Println(greetings.Hello("World"))
}
```

Imports use the module path + the relative path to the package directory.

---

## Adding dependencies

```bash
go get github.com/google/uuid
```

This:
1. Downloads the package.
2. Adds it to `go.mod`.
3. Records its hash in `go.sum`.

Use it:

```go
import "github.com/google/uuid"

id := uuid.New()
```

### Updating

```bash
go get -u github.com/google/uuid    # latest
go get github.com/google/uuid@v1.5.0    # specific version
```

### Cleanup

```bash
go mod tidy    # removes unused, adds missing
```

Run this periodically. CI usually checks that `go mod tidy` produces no diff.

---

## `go.sum` — checksum file

Records cryptographic hashes of every module version your project depends on (transitively). Commit it. Go verifies hashes match before building, so a swapped-out dependency is detected.

---

## Standard library

Like Python, Go ships with a lot. Some you'll use constantly:

- `fmt` — formatted I/O
- `strings` — string ops
- `strconv` — string ↔ number
- `os` — operating system
- `io` — Reader/Writer interfaces
- `bufio` — buffered I/O
- `encoding/json` — JSON
- `net/http` — HTTP
- `time` — clocks and durations
- `sort` — sorting
- `errors` — error utilities
- `context` — cancellation

We'll tour these in `11-stdlib-tour.md`.

---

## The `internal/` convention

```
my-app/
├── internal/
│   └── secret/
│       └── crypto.go
└── main.go
```

Anything under `internal/` can only be imported by code **within the same module**. External users can't import `github.com/alice/my-app/internal/secret`. Useful to keep implementation details private.

---

## Testing — first-class in Go

Go has testing built into the language and toolchain. No installs, no separate runner.

### Convention

- Test files end in `_test.go`.
- Test functions start with `Test` and take `*testing.T`.

```go
// math/ops.go
package math

func Add(a, b int) int { return a + b }
```

```go
// math/ops_test.go
package math

import "testing"

func TestAdd(t *testing.T) {
    got := Add(2, 3)
    want := 5
    if got != want {
        t.Errorf("Add(2,3) = %d; want %d", got, want)
    }
}
```

Run:

```bash
go test ./math
go test ./...    # all packages
```

Output:

```
ok  github.com/alice/my-app/math    0.123s
```

### `t.Errorf` vs `t.Fatalf`

- `t.Errorf` records the failure but **continues** running the test.
- `t.Fatalf` records the failure and **stops** the test immediately.

Use `Fatalf` when the rest of the test can't continue (e.g., a setup step failed).

---

## Table-driven tests

The Go idiom: run the same logic on a list of inputs:

```go
func TestAdd(t *testing.T) {
    tests := []struct {
        name       string
        a, b, want int
    }{
        {"positive", 2, 3, 5},
        {"with zero", 0, 7, 7},
        {"negative", -1, 1, 0},
        {"both negative", -3, -4, -7},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := Add(tt.a, tt.b)
            if got != tt.want {
                t.Errorf("got %d, want %d", got, tt.want)
            }
        })
    }
}
```

`t.Run(name, fn)` makes a subtest. They show up individually in output, and you can run one with `-run`:

```bash
go test -run TestAdd/with_zero ./math
```

---

## Test fixtures

For setup that all tests in a file share, use `TestMain`:

```go
func TestMain(m *testing.M) {
    setup()
    code := m.Run()
    teardown()
    os.Exit(code)
}
```

For per-test setup, use a helper or `t.Cleanup`:

```go
func TestSomething(t *testing.T) {
    f, err := os.CreateTemp("", "test")
    if err != nil { t.Fatal(err) }
    t.Cleanup(func() { os.Remove(f.Name()) })

    // test using f
}
```

`t.Cleanup` runs even if the test fails.

---

## Helper functions

Mark utilities with `t.Helper()` so failure messages point to the test, not the helper:

```go
func mustOK(t *testing.T, err error) {
    t.Helper()
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
}

func TestThing(t *testing.T) {
    err := DoThing()
    mustOK(t, err)
    ...
}
```

Without `t.Helper()`, the failure says "line 42 of test_helpers.go". With it, it points to the actual call site.

---

## Benchmarks

Functions starting with `Benchmark` and taking `*testing.B`:

```go
func BenchmarkAdd(b *testing.B) {
    for i := 0; i < b.N; i++ {
        Add(2, 3)
    }
}
```

Run:

```bash
go test -bench=. ./math
```

Output:

```
BenchmarkAdd-8   1000000000   0.32 ns/op
```

Go runs your function `b.N` times (auto-calibrated) and reports the per-op time.

For benchmarks measuring memory:

```bash
go test -bench=. -benchmem ./math
```

---

## Race detector

Go can detect data races at runtime:

```bash
go test -race ./...
go run -race main.go
```

If two goroutines access the same memory with at least one writing, the race detector logs it. Use this **always** for concurrent code in tests.

---

## Coverage

```bash
go test -cover ./...
```

```
ok  github.com/alice/my-app/math    0.123s    coverage: 87.5% of statements
```

For a detailed HTML report:

```bash
go test -coverprofile=cov.out ./...
go tool cover -html=cov.out
```

Opens a browser showing which lines are/aren't covered.

---

## Worked example — full project

```
calc/
├── go.mod
├── main.go
├── ops/
│   ├── ops.go
│   └── ops_test.go
└── README.md
```

`go.mod`:
```
module github.com/alice/calc
go 1.21
```

`ops/ops.go`:
```go
package ops

import "errors"

var ErrDivByZero = errors.New("division by zero")

func Add(a, b int) int { return a + b }
func Sub(a, b int) int { return a - b }
func Mul(a, b int) int { return a * b }

func Div(a, b int) (int, error) {
    if b == 0 {
        return 0, ErrDivByZero
    }
    return a / b, nil
}
```

`ops/ops_test.go`:
```go
package ops

import (
    "errors"
    "testing"
)

func TestAdd(t *testing.T) {
    tests := []struct {
        a, b, want int
    }{
        {2, 3, 5},
        {0, 0, 0},
        {-1, 1, 0},
    }
    for _, tt := range tests {
        if got := Add(tt.a, tt.b); got != tt.want {
            t.Errorf("Add(%d,%d) = %d; want %d", tt.a, tt.b, got, tt.want)
        }
    }
}

func TestDiv(t *testing.T) {
    if _, err := Div(1, 0); !errors.Is(err, ErrDivByZero) {
        t.Errorf("expected ErrDivByZero")
    }
    if got, _ := Div(10, 2); got != 5 {
        t.Errorf("got %d; want 5", got)
    }
}
```

`main.go`:
```go
package main

import (
    "fmt"
    "github.com/alice/calc/ops"
)

func main() {
    fmt.Println("2 + 3 =", ops.Add(2, 3))
}
```

Build & run:
```bash
go run .
go test ./...
```

This is the shape of essentially every Go project.

---

## Common mistakes

### 1. Wrong module path

If your repo is at `github.com/alice/calc` but `go.mod` says `module calc`, imports break. Make the module path match the actual repo location.

### 2. Forgetting `go mod tidy`

Manually adding imports without `go get` or `tidy` may leave `go.mod` out of date. Build will fail or fetch transitively wrong versions.

### 3. Tests in wrong package

By default tests live in the same package they test (`package ops` in `ops_test.go`). They can access unexported identifiers.

For black-box testing, use `package ops_test`:

```go
package ops_test    // separate package

import (
    "testing"
    "github.com/alice/calc/ops"    // import the package
)

func TestAddBlackBox(t *testing.T) {
    if ops.Add(2, 3) != 5 { t.Fail() }
}
```

Black-box tests can only use the public API. Useful for testing how external users see the package.

### 4. Tests that depend on each other

Each test must work in isolation. If TestA modifies a global that TestB reads, you have a brittle suite.

### 5. Not using `t.Run`

```go
for _, tt := range tests {
    if got := Add(tt.a, tt.b); got != tt.want {
        t.Errorf(...)
    }
}
```

If something fails, you can't easily run JUST that case. Use `t.Run` so subtests are addressable.

---

## Exercises

1. **Build a `temperature` package.** Functions `CtoF`, `FtoC`. Set up a module, write table-driven tests.
2. **Race detector.** Write a test for the `Counter` from doc 08 (with mutex). Run with `-race`. Then remove the mutex and watch the detector fire.
3. **Dependency.** Create a project that uses `github.com/google/uuid` to generate a UUID. Verify it appears in `go.mod` and `go.sum`.
4. **Benchmark.** Write a benchmark for fibonacci both recursive and iterative. Compare ns/op.

### Hint for #1

```bash
mkdir temp && cd temp
go mod init github.com/alice/temp
```

```go
// temp.go
package temp

func CtoF(c float64) float64 { return c*9/5 + 32 }
func FtoC(f float64) float64 { return (f - 32) * 5 / 9 }
```

```go
// temp_test.go
package temp

import "testing"

func TestCtoF(t *testing.T) {
    tests := []struct {
        c, want float64
    }{
        {0, 32},
        {100, 212},
        {-40, -40},
    }
    for _, tt := range tests {
        if got := CtoF(tt.c); got != tt.want {
            t.Errorf("CtoF(%.1f) = %.1f; want %.1f", tt.c, got, tt.want)
        }
    }
}
```

---

## What's next

```
→ Foundations/Programming/Go/10-file-io-json-http.md
```

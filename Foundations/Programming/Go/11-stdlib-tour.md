# 11 — Standard Library Tour

> **Prerequisites:** `10-file-io-json-http.md`.
> **Time to read:** 30 minutes (skim; come back when needed).

Go's stdlib is famously good. This is a tour of what you'll use most. Bookmark this.

---

## `time` — clocks and durations

```go
import "time"

now := time.Now()                           // current time
fmt.Println(now)                            // 2026-05-17 14:30:00 +0000 UTC

// Components
now.Year()    // 2026
now.Month()   // May (a time.Month, not int)
now.Day()
now.Hour()

// Math with durations
later := now.Add(2 * time.Hour)
diff  := later.Sub(now)                     // 2h0m0s

// Sleep
time.Sleep(500 * time.Millisecond)

// Measure how long something took
start := time.Now()
doWork()
fmt.Println("took", time.Since(start))
```

### Format and parse

Go's date format is **the most confusing** part of the language. The reference time is:

```
Mon Jan 2 15:04:05 MST 2006
```

That literal date is the template. Each component is a specific number:

```go
fmt.Println(now.Format("2006-01-02"))                  // 2026-05-17
fmt.Println(now.Format("Monday, January 2, 2006"))     // Saturday, May 17, 2026
fmt.Println(now.Format(time.RFC3339))                  // 2026-05-17T14:30:00Z

// Parse
t, _ := time.Parse("2006-01-02", "2026-12-25")
```

It's weird but consistent. Memorize `2006-01-02 15:04:05` and you're 90% there.

### Timezones

```go
loc, _ := time.LoadLocation("America/New_York")
nowNY := time.Now().In(loc)

utc := time.Now().UTC()
```

---

## `strings` — text manipulation

```go
import "strings"

strings.Contains("hello world", "world")    // true
strings.HasPrefix("foobar", "foo")          // true
strings.HasSuffix("file.txt", ".txt")       // true
strings.Index("abcdef", "cd")               // 2
strings.Count("banana", "a")                // 3

strings.ToUpper("hello")                    // "HELLO"
strings.ToLower("HELLO")                    // "hello"
strings.TrimSpace("  hi  ")                 // "hi"
strings.Trim("...hi...", ".")               // "hi"
strings.TrimPrefix("Mr. Smith", "Mr. ")     // "Smith"

strings.Replace("a-b-c", "-", "/", -1)      // "a/b/c"
strings.ReplaceAll("a-b-c", "-", "/")       // same
strings.Split("a,b,c", ",")                 // []string{"a","b","c"}
strings.Join([]string{"a","b","c"}, "-")    // "a-b-c"

strings.Fields("  hello   world  ")          // []string{"hello","world"}
strings.Repeat("ab", 3)                      // "ababab"
```

### Building strings — `strings.Builder`

For many concatenations, `+` is slow (creates many strings). Use a `Builder`:

```go
var b strings.Builder
for i := 0; i < 1000; i++ {
    fmt.Fprintf(&b, "line %d\n", i)
}
result := b.String()
```

---

## `strconv` — string ↔ number

```go
import "strconv"

n, err := strconv.Atoi("42")              // string → int
s := strconv.Itoa(42)                      // int → string

f, err := strconv.ParseFloat("3.14", 64)   // string → float64
strconv.FormatFloat(3.14, 'f', 2, 64)      // "3.14"

b, err := strconv.ParseBool("true")
```

`fmt.Sprintf("%d", n)` works too but `strconv` is faster and clearer.

---

## `sort` — sorting

```go
import "sort"

ints := []int{3, 1, 4, 1, 5, 9, 2, 6}
sort.Ints(ints)            // ascending
fmt.Println(ints)          // [1 1 2 3 4 5 6 9]

strs := []string{"banana", "apple", "cherry"}
sort.Strings(strs)         // alphabetical

floats := []float64{3.14, 1.41, 2.71}
sort.Float64s(floats)
```

### Custom sort with `sort.Slice`

```go
type Person struct {
    Name string
    Age  int
}

people := []Person{
    {"Alice", 30}, {"Bob", 25}, {"Carol", 35},
}

sort.Slice(people, func(i, j int) bool {
    return people[i].Age < people[j].Age
})
// Now sorted by age ascending
```

For descending, flip the comparison:

```go
sort.Slice(people, func(i, j int) bool {
    return people[i].Age > people[j].Age
})
```

### Sort and search

```go
ints := []int{1, 2, 3, 5, 7, 11}
i := sort.SearchInts(ints, 5)    // index of 5 (or where it would go)
```

---

## `errors` — error utilities

```go
import "errors"

var ErrNotFound = errors.New("not found")

func get(id int) error {
    if id < 0 {
        return fmt.Errorf("invalid id: %d", id)
    }
    if id > 100 {
        return fmt.Errorf("get %d: %w", id, ErrNotFound)    // wrap
    }
    return nil
}

if err := get(101); err != nil {
    if errors.Is(err, ErrNotFound) {
        fmt.Println("definitely not found")
    }
}
```

- `%w` wraps an error (preserves the chain).
- `errors.Is(err, target)` checks if any wrapped error matches.
- `errors.As(err, &target)` extracts a typed error from the chain.

### `errors.Join` (Go 1.20+)

Combine multiple errors:

```go
err := errors.Join(err1, err2, err3)
```

---

## `regexp` — regular expressions

```go
import "regexp"

re := regexp.MustCompile(`\d+`)
re.MatchString("abc 123")             // true
re.FindString("abc 123 def 456")      // "123"
re.FindAllString("abc 123 def 456", -1)    // ["123", "456"]
re.ReplaceAllString("abc 123", "X")   // "abc X"

// Capture groups
re2 := regexp.MustCompile(`(\w+)@(\w+\.\w+)`)
m := re2.FindStringSubmatch("alice@example.com")
fmt.Println(m[0])    // alice@example.com
fmt.Println(m[1])    // alice
fmt.Println(m[2])    // example.com
```

Go's regex is **RE2** — guaranteed linear time, no backtracking, no lookbehind. Fast and safe.

---

## `log` and `log/slog` — logging

The classic:

```go
import "log"

log.Println("server started")
log.Printf("user %s connected", name)
log.Fatal("can't continue")              // logs and calls os.Exit(1)
```

Go 1.21+ has structured logging (`log/slog`):

```go
import "log/slog"

slog.Info("user connected", "name", "alice", "ip", "127.0.0.1")
// time=2026-05-17T... level=INFO msg="user connected" name=alice ip=127.0.0.1

slog.Error("db down", "err", err)
```

Structured logs are machine-parseable. Prefer `slog` for new projects.

```go
// JSON output
handler := slog.NewJSONHandler(os.Stdout, nil)
logger := slog.New(handler)
logger.Info("event", "key", "value")
// {"time":"...","level":"INFO","msg":"event","key":"value"}
```

---

## `os` and `os/exec` — operating system

```go
import "os"

os.Args                 // command-line args (slice)
os.Getenv("HOME")       // env var (empty string if unset)
os.Setenv("KEY", "v")
os.Hostname()
os.Exit(0)              // exit with code

// Files (covered in doc 10):
os.Open, os.Create, os.ReadFile, os.WriteFile
os.Mkdir, os.MkdirAll, os.Remove, os.RemoveAll
os.Stat                 // info about a file
```

### Run a shell command — `os/exec`

```go
import "os/exec"

cmd := exec.Command("ls", "-la")
out, err := cmd.Output()
if err != nil { panic(err) }
fmt.Println(string(out))
```

Combined output (stdout + stderr):

```go
out, err := cmd.CombinedOutput()
```

---

## `context` — cancellation and deadlines

Already shown in doc 08. Quick recap:

```go
import "context"

// With timeout
ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
defer cancel()

// With cancellation
ctx, cancel := context.WithCancel(context.Background())
go func() {
    time.Sleep(1 * time.Second)
    cancel()
}()

// Pass values (rarely; for request-scoped data)
ctx = context.WithValue(ctx, "userID", 42)
id := ctx.Value("userID")
```

`context.Context` is the first arg of any function that may take time or be cancellable.

---

## `flag` — command-line flags

```go
import "flag"

var (
    name = flag.String("name", "World", "your name")
    n    = flag.Int("n", 1, "how many times")
    verb = flag.Bool("v", false, "verbose")
)

func main() {
    flag.Parse()
    for i := 0; i < *n; i++ {
        fmt.Println("Hello,", *name)
    }
}
```

```bash
./hello -name=Alice -n=3 -v
```

`flag.Parse` reads `os.Args`. Built-in `-h` shows usage.

For more advanced CLIs, use `cobra` or `urfave/cli`.

---

## `math` — math functions

```go
import "math"

math.Pi                                     // 3.141592...
math.Sqrt(16)                                // 4
math.Pow(2, 10)                              // 1024
math.Floor(3.7); math.Ceil(3.2); math.Round(3.5)
math.Abs(-5)
math.Max(3, 7); math.Min(3, 7)               // also generic min/max in 1.21+
```

For randomness:

```go
import "math/rand"

rand.Intn(100)             // 0-99
rand.Float64()             // 0.0-1.0
rand.Shuffle(len(s), func(i, j int) { s[i], s[j] = s[j], s[i] })
```

For cryptographic randomness, use `crypto/rand`:

```go
import "crypto/rand"

bytes := make([]byte, 16)
rand.Read(bytes)           // secure random
```

---

## `bytes` — like `strings` but for `[]byte`

```go
import "bytes"

bytes.Contains([]byte("hello"), []byte("ell"))
bytes.Equal(a, b)           // compare two byte slices
var buf bytes.Buffer
buf.WriteString("hello")
buf.Write([]byte(" world"))
buf.String()                // "hello world"
```

`bytes.Buffer` implements `io.Reader` and `io.Writer` — useful as an in-memory file.

---

## `crypto` family

```go
import (
    "crypto/sha256"
    "encoding/hex"
)

sum := sha256.Sum256([]byte("hello"))
fmt.Println(hex.EncodeToString(sum[:]))
// 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
```

For passwords, use `golang.org/x/crypto/bcrypt`:

```go
import "golang.org/x/crypto/bcrypt"

hashed, _ := bcrypt.GenerateFromPassword([]byte("pw"), bcrypt.DefaultCost)
err := bcrypt.CompareHashAndPassword(hashed, []byte("pw"))
```

---

## Exercises

1. **Log filter.** Read a log file, use `regexp` to find lines with timestamps, count by hour using a `map[int]int`, sort, and print.
2. **CLI tool.** Build a tool that takes `-input` (file path) and `-output` (file path) flags, JSON-loads the input, transforms, writes to output.
3. **Concurrent file hash.** Given N file paths, compute SHA256 of each in parallel goroutines. Print results sorted by hash.
4. **Run external program.** Use `os/exec` to run `git log --oneline`, parse the output with `bufio.Scanner`, and print just the commit messages.

### Hint for #1

```go
re := regexp.MustCompile(`\b(\d{2}):\d{2}:\d{2}\b`)
counts := make(map[int]int)

f, _ := os.Open("app.log")
defer f.Close()
scanner := bufio.NewScanner(f)
for scanner.Scan() {
    if m := re.FindStringSubmatch(scanner.Text()); m != nil {
        h, _ := strconv.Atoi(m[1])
        counts[h]++
    }
}

hours := make([]int, 0, len(counts))
for h := range counts { hours = append(hours, h) }
sort.Ints(hours)
for _, h := range hours {
    fmt.Printf("%02d:00 — %d\n", h, counts[h])
}
```

---

## What's next

```
→ Foundations/Programming/Go/12-generics-iterators.md
```

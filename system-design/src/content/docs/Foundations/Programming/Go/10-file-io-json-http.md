# 10 — File I/O, JSON, and HTTP

> **Prerequisites:** `09-modules-and-testing.md`.
> **Time to read:** 30 minutes.

This doc covers practical I/O: reading and writing files, JSON encoding, and HTTP both as client and server.

---

## File I/O — basics

Go's I/O is built around two interfaces: `io.Reader` and `io.Writer`. Files implement both.

### Read a whole file

```go
package main

import (
    "fmt"
    "os"
)

func main() {
    data, err := os.ReadFile("notes.txt")
    if err != nil {
        fmt.Println("error:", err)
        return
    }
    fmt.Println(string(data))
}
```

`os.ReadFile` returns the whole file as `[]byte`. Convert to string for text.

### Write a whole file

```go
err := os.WriteFile("output.txt", []byte("hello\nworld\n"), 0644)
if err != nil {
    fmt.Println("error:", err)
}
```

The `0644` is the file mode (permissions). `0644` = owner read/write, group/others read.

`WriteFile` truncates the file first; you don't need to delete it.

---

## File handles — `os.Open` and `os.Create`

For finer control, use `os.Open` (read) or `os.Create` (write):

```go
f, err := os.Open("data.txt")
if err != nil { ... }
defer f.Close()    // ensure cleanup

buf := make([]byte, 1024)
n, err := f.Read(buf)
fmt.Println(string(buf[:n]))
```

```go
f, err := os.Create("out.txt")
if err != nil { ... }
defer f.Close()

f.Write([]byte("line 1\n"))
f.Write([]byte("line 2\n"))
```

`defer f.Close()` is critical — runs when the function exits, even on error.

### Append mode

```go
f, err := os.OpenFile("log.txt",
    os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
if err != nil { ... }
defer f.Close()
f.Write([]byte("appended line\n"))
```

The flags are bit fields:
- `O_RDONLY`, `O_WRONLY`, `O_RDWR` — direction
- `O_APPEND` — append, don't truncate
- `O_CREATE` — create if missing
- `O_TRUNC` — truncate to 0 length

Combine with `|`.

---

## Line-by-line — `bufio.Scanner`

For big files, don't read it all. Stream line-by-line:

```go
package main

import (
    "bufio"
    "fmt"
    "os"
    "strings"
)

func main() {
    f, _ := os.Open("huge.log")
    defer f.Close()

    scanner := bufio.NewScanner(f)
    for scanner.Scan() {
        line := scanner.Text()
        if strings.Contains(line, "ERROR") {
            fmt.Println(line)
        }
    }
    if err := scanner.Err(); err != nil {
        fmt.Println("scan error:", err)
    }
}
```

`Scanner` is buffered and stops on EOF. Don't forget to check `scanner.Err()` — it catches read errors.

### Scanner has a default 64KB line limit

For longer lines:

```go
scanner := bufio.NewScanner(f)
scanner.Buffer(make([]byte, 1024*1024), 1024*1024)    // 1MB
```

---

## Buffered writing — `bufio.Writer`

Many small writes? Buffer them:

```go
f, _ := os.Create("out.txt")
defer f.Close()

w := bufio.NewWriter(f)
defer w.Flush()    // flush before file closes!

for i := 0; i < 1000; i++ {
    fmt.Fprintln(w, "line", i)
}
```

`Flush()` ensures buffered data is written to the file. **Always defer it**.

---

## `io.Reader` and `io.Writer` — the universal interfaces

Almost everything that reads or writes implements these:

```go
type Reader interface {
    Read(p []byte) (n int, err error)
}

type Writer interface {
    Write(p []byte) (n int, err error)
}
```

Files. Network connections. Byte buffers. HTTP bodies. Compressed streams. They all match.

This means generic operations like `io.Copy` work on **any** pair:

```go
src, _ := os.Open("input.txt")
dst, _ := os.Create("output.txt")
n, err := io.Copy(dst, src)    // copies all of src to dst
```

Internalize this — it's one of Go's most useful abstractions.

---

## Working with paths — `filepath`

```go
import "path/filepath"

p := filepath.Join("data", "users", "alice.txt")
// data/users/alice.txt   (or data\users\alice.txt on Windows)

filepath.Dir(p)    // "data/users"
filepath.Base(p)   // "alice.txt"
filepath.Ext(p)    // ".txt"
```

Use `filepath` for OS-portable paths.

### Walking a directory

```go
filepath.WalkDir(".", func(path string, d fs.DirEntry, err error) error {
    if err != nil { return err }
    if !d.IsDir() && filepath.Ext(path) == ".go" {
        fmt.Println(path)
    }
    return nil
})
```

---

## JSON — encoding and decoding

JSON in Go uses `encoding/json`. You define **struct tags** to map field names.

```go
package main

import (
    "encoding/json"
    "fmt"
)

type User struct {
    Name  string `json:"name"`
    Age   int    `json:"age"`
    Email string `json:"email,omitempty"`    // omit if empty
}

func main() {
    u := User{Name: "Alice", Age: 30}
    data, _ := json.Marshal(u)
    fmt.Println(string(data))
    // {"name":"Alice","age":30}

    pretty, _ := json.MarshalIndent(u, "", "  ")
    fmt.Println(string(pretty))
    // {
    //   "name": "Alice",
    //   "age": 30
    // }
}
```

### Decode JSON → struct

```go
text := `{"name": "Bob", "age": 25}`
var u User
if err := json.Unmarshal([]byte(text), &u); err != nil {
    panic(err)
}
fmt.Printf("%+v\n", u)    // {Name:Bob Age:25 Email:}
```

### Struct tag options

- `json:"name"` — use this name in JSON
- `json:"name,omitempty"` — omit if zero/empty
- `json:"-"` — never include
- `json:",string"` — encode number as string

### Unknown shape — use `map` or `any`

```go
var data map[string]any
json.Unmarshal([]byte(text), &data)

fmt.Println(data["name"])    // works, but type asserted later
```

Each value is `any`. Type-assert as needed:

```go
if name, ok := data["name"].(string); ok {
    fmt.Println(name)
}
```

Prefer structs when the shape is known.

### Read JSON from a file

```go
f, _ := os.Open("config.json")
defer f.Close()

var config Config
if err := json.NewDecoder(f).Decode(&config); err != nil {
    panic(err)
}
```

`Decoder` reads from any `io.Reader` — file, HTTP body, etc.

### Write JSON to a file

```go
f, _ := os.Create("out.json")
defer f.Close()

enc := json.NewEncoder(f)
enc.SetIndent("", "  ")
enc.Encode(myData)
```

---

## HTTP client — `net/http`

### GET

```go
resp, err := http.Get("https://api.github.com/users/torvalds")
if err != nil { panic(err) }
defer resp.Body.Close()

body, _ := io.ReadAll(resp.Body)
fmt.Println(string(body))
fmt.Println("status:", resp.StatusCode)
```

**Always `defer resp.Body.Close()`** — even if you read all of it. Otherwise connections leak.

### Decode JSON response directly

```go
var user struct {
    Login string `json:"login"`
    Name  string `json:"name"`
}
resp, err := http.Get("https://api.github.com/users/torvalds")
if err != nil { panic(err) }
defer resp.Body.Close()

if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
    panic(err)
}
fmt.Printf("%+v\n", user)
```

### POST with JSON

```go
payload, _ := json.Marshal(map[string]any{
    "name": "Alice",
    "age":  30,
})

resp, err := http.Post(
    "https://example.com/api/users",
    "application/json",
    bytes.NewBuffer(payload),
)
defer resp.Body.Close()
```

### Custom client with timeout

```go
client := &http.Client{
    Timeout: 5 * time.Second,
}

resp, err := client.Get(url)
```

**Always set a timeout for production HTTP clients.** Default has none.

---

## HTTP server

The simplest server:

```go
package main

import (
    "fmt"
    "net/http"
)

func hello(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintf(w, "Hello, %s!\n", r.URL.Query().Get("name"))
}

func main() {
    http.HandleFunc("/hello", hello)
    fmt.Println("Listening on :8080")
    http.ListenAndServe(":8080", nil)
}
```

Visit `http://localhost:8080/hello?name=Alice` → prints "Hello, Alice!"

### A more realistic server

```go
package main

import (
    "encoding/json"
    "net/http"
    "sync"
)

type User struct {
    Name string `json:"name"`
}

var (
    mu    sync.Mutex
    users []User
)

func usersHandler(w http.ResponseWriter, r *http.Request) {
    switch r.Method {
    case http.MethodGet:
        mu.Lock()
        defer mu.Unlock()
        json.NewEncoder(w).Encode(users)

    case http.MethodPost:
        var u User
        if err := json.NewDecoder(r.Body).Decode(&u); err != nil {
            http.Error(w, "bad json", http.StatusBadRequest)
            return
        }
        mu.Lock()
        users = append(users, u)
        mu.Unlock()
        w.WriteHeader(http.StatusCreated)
        json.NewEncoder(w).Encode(u)

    default:
        http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
    }
}

func main() {
    http.HandleFunc("/users", usersHandler)
    http.ListenAndServe(":8080", nil)
}
```

Try:

```bash
curl -X POST localhost:8080/users -d '{"name":"Alice"}' -H "Content-Type: application/json"
curl localhost:8080/users
```

For more advanced routing, use `chi`, `gin`, or `echo`. Or in Go 1.22+, the stdlib router supports patterns like `/users/{id}`:

```go
http.HandleFunc("GET /users/{id}", func(w http.ResponseWriter, r *http.Request) {
    id := r.PathValue("id")
    fmt.Fprintf(w, "user %s", id)
})
```

---

## Testing HTTP code — `httptest`

```go
import (
    "net/http"
    "net/http/httptest"
    "testing"
)

func TestUsersHandler(t *testing.T) {
    server := httptest.NewServer(http.HandlerFunc(usersHandler))
    defer server.Close()

    resp, err := http.Get(server.URL + "/users")
    if err != nil { t.Fatal(err) }
    defer resp.Body.Close()

    if resp.StatusCode != 200 {
        t.Errorf("got %d, want 200", resp.StatusCode)
    }
}
```

`httptest.NewServer` spins up a real HTTP server on a random port. No network roundtrip.

For unit tests, even cheaper: `httptest.NewRecorder` + call the handler directly:

```go
func TestHello(t *testing.T) {
    req := httptest.NewRequest("GET", "/hello?name=Alice", nil)
    w := httptest.NewRecorder()
    hello(w, req)
    if w.Code != 200 {
        t.Errorf("got %d", w.Code)
    }
    if !strings.Contains(w.Body.String(), "Alice") {
        t.Errorf("body missing 'Alice': %q", w.Body.String())
    }
}
```

---

## Worked example — fetch & save users

```go
package main

import (
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "os"
    "time"
)

type User struct {
    ID    int    `json:"id"`
    Name  string `json:"name"`
    Email string `json:"email"`
}

func main() {
    client := &http.Client{Timeout: 5 * time.Second}

    resp, err := client.Get("https://jsonplaceholder.typicode.com/users")
    if err != nil { panic(err) }
    defer resp.Body.Close()

    var users []User
    if err := json.NewDecoder(resp.Body).Decode(&users); err != nil {
        panic(err)
    }

    f, err := os.Create("users.json")
    if err != nil { panic(err) }
    defer f.Close()

    enc := json.NewEncoder(f)
    enc.SetIndent("", "  ")
    if err := enc.Encode(users); err != nil { panic(err) }

    fmt.Printf("wrote %d users to users.json\n", len(users))

    _ = io.Discard    // example of io.Discard for "read and discard"
}
```

---

## Common mistakes

### 1. Forgetting `defer Close()`

```go
f, _ := os.Open("data.txt")
data, _ := io.ReadAll(f)
// f never closed
```

Always `defer f.Close()` immediately after the open succeeds.

### 2. Forgetting `defer resp.Body.Close()`

```go
resp, _ := http.Get(url)
data, _ := io.ReadAll(resp.Body)
// connection not returned to pool
```

Same rule.

### 3. Ignoring errors

```go
data, _ := os.ReadFile("config.json")
```

If the file's missing, `data` is empty and you go ahead with empty config. Check errors.

### 4. Using `fmt.Println` for HTTP responses

```go
func handler(w http.ResponseWriter, r *http.Request) {
    fmt.Println("hello")    // prints to STDOUT, not the response!
}
```

Use `fmt.Fprintln(w, "hello")` or `w.Write([]byte("hello"))`.

### 5. JSON struct without tags

```go
type User struct {
    Name string    // JSON: {"Name":"Alice"} — capitalized!
}
```

JSON keys typically use lowercase or camelCase. Use tags:

```go
type User struct {
    Name string `json:"name"`
}
```

### 6. No timeout on HTTP client

The default client has no timeout. A misbehaving server can hang your program. Always:

```go
client := &http.Client{Timeout: 10 * time.Second}
```

---

## Exercises

1. **Word counter.** Read a text file. Use `bufio.Scanner` (set to scan words via `scanner.Split(bufio.ScanWords)`). Output a `map[string]int` count as JSON.
2. **Tiny REST API.** Build a `/notes` endpoint. POST adds a note (string). GET returns all notes as JSON. Test with `curl` and with `httptest`.
3. **HTTP fetcher.** Fetch 5 URLs concurrently using goroutines. Save responses to files `out_0.txt` through `out_4.txt`.
4. **Config loader.** Define a `Config` struct with `Port`, `Debug`, `DBUrl`. Load from `config.json`. Provide good defaults.

### Hint for #1

```go
counts := make(map[string]int)

f, _ := os.Open("input.txt")
defer f.Close()

scanner := bufio.NewScanner(f)
scanner.Split(bufio.ScanWords)
for scanner.Scan() {
    counts[strings.ToLower(scanner.Text())]++
}

out, _ := os.Create("counts.json")
defer out.Close()
enc := json.NewEncoder(out)
enc.SetIndent("", "  ")
enc.Encode(counts)
```

---

## What's next

```
→ Foundations/Programming/Go/11-stdlib-tour.md
```

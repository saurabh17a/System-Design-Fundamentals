# 08 — Goroutines and Channels

> **Prerequisites:** `07-interfaces.md`.
> **Time to read:** 50 minutes. (This is the densest doc — take a break partway.)

Go's reason to exist is **concurrency**. Goroutines and channels make concurrent programming **simple and safe** in a way few other languages match.

This doc builds up: goroutines → channels → synchronization → patterns → pitfalls.

---

## Why concurrency at all?

A program is **concurrent** when it has multiple things in progress. Examples:
- A web server handling 1,000 requests at once.
- A program that fetches 5 URLs in parallel and combines results.
- A game loop that handles input, physics, and rendering in separate threads.

Doing one thing at a time is *sequential*. Doing several at once is *concurrent*. If they run on different CPU cores literally simultaneously, that's *parallel*.

Concurrency = structure. Parallelism = execution. Go gives you concurrency; the runtime gives you parallelism for free if there are multiple cores.

---

## Goroutines — lightweight threads

A **goroutine** is a function that runs concurrently with other goroutines. Start one with the `go` keyword:

```go
func say(msg string) {
    for i := 0; i < 3; i++ {
        fmt.Println(msg, i)
        time.Sleep(100 * time.Millisecond)
    }
}

func main() {
    go say("hello")    // runs concurrently
    say("world")       // runs in main goroutine
}
```

Output is **interleaved** (order varies):
```
world 0
hello 0
hello 1
world 1
...
```

### How goroutines compare to OS threads

| | OS thread | Goroutine |
|---|---|---|
| Memory | ~1 MB stack | ~2 KB stack (grows dynamically) |
| Creation cost | High | Very low |
| Switching cost | High (kernel) | Very low (Go runtime) |
| Practical limit | Thousands | Millions |

You can spawn 100,000 goroutines without breaking a sweat. The Go runtime multiplexes them onto a small pool of OS threads (the "M:N scheduler").

---

## The first gotcha — main returns before goroutines finish

```go
func main() {
    go fmt.Println("hello")
    // main returns immediately; goroutine may never run
}
```

When `main()` returns, the program exits — even if goroutines are still running. You need to **wait** for them somehow.

### Naive fix: time.Sleep (DON'T)

```go
func main() {
    go fmt.Println("hello")
    time.Sleep(time.Second)    // hope it's enough
}
```

This works in toy examples but is wrong in production. Better tools follow.

---

## Channels — talking between goroutines

A **channel** is a typed pipe: send a value on one end, receive on the other.

```go
ch := make(chan int)    // unbuffered channel of int

go func() {
    ch <- 42    // send 42
}()

x := <-ch    // receive
fmt.Println(x)    // 42
```

The `<-` operator does both send and receive (direction depends on which side of the channel it's on).

### Unbuffered channels block

`ch <- 42` blocks until someone is ready to receive. `<-ch` blocks until someone sends.

This **synchronizes** goroutines. Send and receive happen together.

```go
ch := make(chan string)
go func() {
    fmt.Println("goroutine: about to send")
    ch <- "hi"
    fmt.Println("goroutine: sent")
}()

time.Sleep(time.Second)
fmt.Println("main: about to receive")
fmt.Println("main:", <-ch)
```

The goroutine prints "about to send", then **blocks** for a full second until main receives.

---

## Buffered channels

```go
ch := make(chan int, 3)    // capacity 3

ch <- 1    // doesn't block
ch <- 2    // doesn't block
ch <- 3    // doesn't block
ch <- 4    // BLOCKS — buffer full
```

Sends block when the buffer is full. Receives block when the buffer is empty.

Use buffered channels when:
- You know an upper bound on in-flight items.
- You want to decouple sender and receiver speeds slightly.

Don't use buffered channels just to "prevent blocking" — you usually want the synchronization unbuffered channels give.

---

## Closing channels and `range`

The sender can close a channel: `close(ch)`. After that:
- Receivers get the zero value.
- `v, ok := <-ch` — `ok` is `false` if the channel is closed and drained.
- Sending on a closed channel **panics**.

```go
func produce(ch chan int) {
    for i := 0; i < 5; i++ {
        ch <- i
    }
    close(ch)    // signal "no more values"
}

func main() {
    ch := make(chan int)
    go produce(ch)
    for v := range ch {    // ranges until channel closed
        fmt.Println(v)
    }
}
```

The `for v := range ch` loop ends when the channel is closed.

**Rule:** only the sender closes a channel. Never close from the receiver side.

---

## `select` — multiplexing channels

```go
select {
case msg := <-ch1:
    fmt.Println("from ch1:", msg)
case msg := <-ch2:
    fmt.Println("from ch2:", msg)
case ch3 <- 42:
    fmt.Println("sent on ch3")
}
```

Like a `switch` for channels: blocks until one case can proceed. If multiple, one is chosen randomly.

### Default case — non-blocking ops

```go
select {
case msg := <-ch:
    fmt.Println("got:", msg)
default:
    fmt.Println("nothing ready")
}
```

`default` runs if no other case is ready immediately. Good for polling or timeout patterns.

### Timeout pattern

```go
select {
case result := <-resultCh:
    fmt.Println("done:", result)
case <-time.After(2 * time.Second):
    fmt.Println("timeout!")
}
```

`time.After` returns a channel that fires after the duration. Common idiom.

---

## sync.WaitGroup — wait for many goroutines

You spawn N goroutines and want `main` to wait for all. Channels work, but `WaitGroup` is cleaner:

```go
var wg sync.WaitGroup

for i := 0; i < 5; i++ {
    wg.Add(1)    // before starting
    go func(id int) {
        defer wg.Done()    // when done
        fmt.Println("worker", id)
    }(i)
}

wg.Wait()    // block until all Done() called
fmt.Println("all done")
```

**Important:** `wg.Add` before the `go`, never inside the goroutine. Otherwise `Wait` could return before the goroutine even started.

---

## sync.Mutex — protecting shared state

Sometimes goroutines must share data. `sync.Mutex` gives mutual exclusion:

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func (c *Counter) Inc() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}

func (c *Counter) Value() int {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.n
}
```

Without the mutex, concurrent `Inc()` calls can lose updates. Run `go test -race` to detect data races.

### sync.RWMutex — many readers, one writer

If you have lots of reads and few writes, `RWMutex` allows concurrent reads:

```go
var mu sync.RWMutex

mu.RLock()    // shared read lock
defer mu.RUnlock()
// safe to read

mu.Lock()    // exclusive write lock
defer mu.Unlock()
// safe to read AND write
```

Don't reach for `RWMutex` automatically. Plain `Mutex` is faster for low contention.

---

## "Don't communicate by sharing memory; share memory by communicating"

This is Go's slogan. Translation: prefer **channels** to mutexes when possible.

### Mutex version

```go
type SafeCounter struct {
    mu sync.Mutex
    v  map[string]int
}

func (c *SafeCounter) Inc(key string) {
    c.mu.Lock()
    c.v[key]++
    c.mu.Unlock()
}
```

### Channel version

```go
type SafeCounter struct {
    inc chan string
    get chan getReq
}

type getReq struct {
    key  string
    resp chan int
}

func (c *SafeCounter) run(state map[string]int) {
    for {
        select {
        case k := <-c.inc:
            state[k]++
        case r := <-c.get:
            r.resp <- state[r.key]
        }
    }
}
```

A single goroutine "owns" the state; others ask via channels. No locks needed.

For simple counters, a mutex is fine and faster. For complex state machines, the channel approach is clearer.

---

## Patterns

### Worker pool

```go
func worker(id int, jobs <-chan int, results chan<- int) {
    for j := range jobs {
        fmt.Printf("worker %d processing %d\n", id, j)
        time.Sleep(100 * time.Millisecond)
        results <- j * 2
    }
}

func main() {
    jobs := make(chan int, 100)
    results := make(chan int, 100)

    for w := 1; w <= 3; w++ {
        go worker(w, jobs, results)
    }

    for j := 1; j <= 9; j++ {
        jobs <- j
    }
    close(jobs)

    for r := 1; r <= 9; r++ {
        fmt.Println("got:", <-results)
    }
}
```

Notice the **directional** channel types: `<-chan int` is receive-only, `chan<- int` is send-only. Compile-time enforcement of who can do what.

### Fan-out, fan-in

Fan-out: split work across many workers. Fan-in: merge results into one channel.

```go
func merge(channels ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(len(channels))
    for _, c := range channels {
        go func(ch <-chan int) {
            defer wg.Done()
            for v := range ch {
                out <- v
            }
        }(c)
    }
    go func() {
        wg.Wait()
        close(out)    // closer waits for all producers
    }()
    return out
}
```

Standard pipeline pattern.

### Cancellation via close

```go
done := make(chan struct{})

go func() {
    for {
        select {
        case <-done:
            return    // cancelled
        default:
            doWork()
        }
    }
}()

// later:
close(done)    // signals all goroutines listening on done
```

Closing a channel broadcasts to **all** receivers. Cheap signal.

---

## context.Context — the standard cancellation API

For real applications, use `context.Context` instead of raw `done` channels:

```go
ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
defer cancel()

select {
case <-ctx.Done():
    fmt.Println("cancelled or timed out:", ctx.Err())
case result := <-doSomething(ctx):
    fmt.Println("result:", result)
}
```

`context` is everywhere in Go: HTTP handlers, database calls, gRPC. Pass it as the first argument to any function that may take time or block.

```go
func fetchUser(ctx context.Context, id int) (*User, error) {
    select {
    case <-ctx.Done():
        return nil, ctx.Err()
    case res := <-callDB(id):
        return res, nil
    }
}
```

---

## Common mistakes

### 1. Goroutine leaks

```go
func leak() {
    ch := make(chan int)
    go func() {
        ch <- 1    // blocks forever — no receiver
    }()
    // goroutine never exits
}
```

If you spawn a goroutine, make sure it can **always exit**. Close channels, use context, or have a clear termination path. Leaked goroutines accumulate and consume memory.

### 2. Loop variable capture (pre-Go 1.22)

```go
for i := 0; i < 5; i++ {
    go func() {
        fmt.Println(i)    // OOPS — captures shared `i`
    }()
}
```

Before Go 1.22, all goroutines might print `5` because they share `i`. Fix:

```go
for i := 0; i < 5; i++ {
    i := i    // shadow
    go func() { fmt.Println(i) }()
}
// or pass as argument
for i := 0; i < 5; i++ {
    go func(i int) { fmt.Println(i) }(i)
}
```

Go 1.22+ fixed this — each iteration has its own `i`. But the pattern of passing as argument is still clearer.

### 3. Sending on a closed channel

```go
close(ch)
ch <- 1    // PANIC
```

Sender closes; receivers don't. If multiple goroutines might send, use a coordination mechanism.

### 4. Reading from a nil channel

```go
var ch chan int    // nil
<-ch    // blocks FOREVER
```

A nil channel blocks both send and receive. Sometimes useful in `select` (a `nil` case is never selected, effectively disabling that branch).

### 5. Forgetting to close

```go
ch := make(chan int)
go func() {
    for i := 0; i < 5; i++ {
        ch <- i
    }
    // forgot close(ch)
}()
for v := range ch {
    fmt.Println(v)    // hangs after 5 values
}
```

`range` waits for `close`. If you don't close, the loop hangs forever.

### 6. Race conditions

```go
var counter int

for i := 0; i < 100; i++ {
    go func() { counter++ }()
}
// counter is some random number, not 100
```

Detect with `go run -race main.go`. Fix with mutex or atomic operations or by serializing through a channel.

### 7. Deadlocks

```go
ch := make(chan int)
ch <- 1    // blocks forever — main is the only goroutine
<-ch
```

`fatal error: all goroutines are asleep - deadlock!` — the runtime detects the simplest deadlocks and crashes loudly. Real-world deadlocks (cyclic locking) are subtler and need careful design.

---

## When NOT to use goroutines

- **Simple sequential logic.** If a function is fast and only called once, don't spawn a goroutine just because.
- **CPU-bound work that needs to coordinate frequently.** Sometimes pure sequential code is faster.
- **Order matters and synchronization is hard.** Concurrency adds bugs; only use it when the problem benefits.

---

## Worked example — Concurrent URL fetcher

```go
package main

import (
    "fmt"
    "io"
    "net/http"
    "sync"
    "time"
)

type result struct {
    url    string
    status int
    bytes  int
    err    error
}

func fetch(url string) result {
    resp, err := http.Get(url)
    if err != nil {
        return result{url: url, err: err}
    }
    defer resp.Body.Close()
    body, err := io.ReadAll(resp.Body)
    return result{
        url:    url,
        status: resp.StatusCode,
        bytes:  len(body),
        err:    err,
    }
}

func main() {
    urls := []string{
        "https://example.com",
        "https://golang.org",
        "https://github.com",
    }

    start := time.Now()
    var wg sync.WaitGroup
    results := make(chan result, len(urls))

    for _, u := range urls {
        wg.Add(1)
        go func(u string) {
            defer wg.Done()
            results <- fetch(u)
        }(u)
    }

    go func() {
        wg.Wait()
        close(results)    // close after all sent
    }()

    for r := range results {
        if r.err != nil {
            fmt.Printf("%s: ERROR %v\n", r.url, r.err)
        } else {
            fmt.Printf("%s: %d (%d bytes)\n", r.url, r.status, r.bytes)
        }
    }
    fmt.Printf("total: %v\n", time.Since(start))
}
```

Three URLs, fetched concurrently. Total time ≈ slowest URL (not sum).

Note the pattern: **WaitGroup waits, separate goroutine closes the channel**. This is a stable cancellation/completion idiom.

---

## Worked example — Producer-consumer with cancellation

```go
package main

import (
    "context"
    "fmt"
    "math/rand"
    "time"
)

func produce(ctx context.Context, ch chan<- int) {
    for i := 0; ; i++ {
        select {
        case <-ctx.Done():
            close(ch)
            return
        case ch <- rand.Intn(100):
            time.Sleep(100 * time.Millisecond)
        }
    }
}

func consume(name string, ch <-chan int) {
    for v := range ch {
        fmt.Printf("%s got %d\n", name, v)
    }
    fmt.Printf("%s done\n", name)
}

func main() {
    ch := make(chan int)
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()

    go produce(ctx, ch)
    go consume("A", ch)
    go consume("B", ch)

    <-ctx.Done()
    time.Sleep(200 * time.Millisecond)    // let consumers drain
    fmt.Println("main done")
}
```

Two consumers, one producer, cancellation via context. Standard real-world shape.

---

## Exercises

1. **Parallel sum.** Given a slice of 1M ints, split into N chunks, sum each in a goroutine, combine results. Compare to sequential sum.
2. **Fan-in merge.** Write a function `merge(...chan int) chan int` that combines N input channels into one output channel.
3. **Rate limiter.** Build a function that allows at most 10 calls/second using a channel and `time.Tick`.
4. **Worker pool with cancellation.** Build a worker pool that accepts a `context.Context`. When cancelled, all workers should drain quickly and exit.
5. **Producer-consumer with bounded buffer.** Build a buffered channel of capacity 5 with multiple producers and consumers. Verify with `-race` flag.

### Hint for #1:

```go
nums := make([]int, 1_000_000)
// fill nums...

const N = 4
chunkSize := len(nums) / N
results := make(chan int, N)

for i := 0; i < N; i++ {
    start := i * chunkSize
    end := start + chunkSize
    if i == N-1 {
        end = len(nums)
    }
    go func(slice []int) {
        sum := 0
        for _, v := range slice {
            sum += v
        }
        results <- sum
    }(nums[start:end])
}

total := 0
for i := 0; i < N; i++ {
    total += <-results
}
fmt.Println(total)
```

---

## Further reading

- "Go Concurrency Patterns" — Rob Pike's classic talk.
- "Advanced Go Concurrency Patterns" — Sameer Ajmani.
- *Concurrency in Go* by Katherine Cox-Buday — full book, very good.

---

## What's next

You've finished Go Foundations! Eight docs, from "Hello, World" to concurrent producer-consumers.

Where to go next:
- **Object-oriented thinking** → `Foundations/OOP/four-pillars.md`
- **Design patterns in Go** → `Foundations/DesignPatterns/strategy.md`
- **Apply it** → `LLD/Go/parking-lot.md` (uses everything you've learned)
- **System design** → `HLD/url-shortener.md`

Good luck. Go's true beauty is when goroutines and channels click — and they will, after you write a few real programs with them.

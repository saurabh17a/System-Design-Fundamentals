# Logging Service — Low-Level Design (Go)

> **Difficulty:** Medium
> **Tags:** `[lld]` `[ood]` `[interfaces]` `[goroutines]` `[channels]` `[decorator]`
> **Language:** Go 1.21+
> **Prep time:** ~10 min skim, ~30 min deep read
> **Companies that ask this:** Atlassian, Microsoft, Google, Bloomberg

---

## Beginner's Guide

### What's this in plain English?

A logging library — what `log/slog` is in Go. Your app calls `Info("user signed up")`. Behind the scenes: format, filter by level, send to console / file / network.

### Why solve it?

- **Real world**: every app needs logs.
- **Teaches**: chain-of-responsibility, strategy, decorator, async via channels.

### Vocabulary

- **Level** — DEBUG / INFO / WARN / ERROR.
- **LogRecord** — timestamp + level + msg + fields.
- **Handler** — destination interface (Console, File, Network).
- **Formatter** — turns record into string (Text, JSON).

### High-level approach

Entities: **LogRecord**, **Formatter** interface, **Handler** interface (with min-level + formatter), **Logger** (list of handlers).

Flow: `Info(msg)` → build LogRecord → fan out to handlers ≥ INFO → format → write.

Async handler: wraps another; uses a goroutine + channel to batch + flush.

### How to read this doc

- **Beginner**: Logger + Handlers + Formatters separation.
- **Interview**: async, batching, structured fields, rotation.

---

## 0. How to use this doc in an interview

Python version covers all the patterns. **In Go, the conversation pivots:**
- **`io.Writer`** as the natural sink — handlers wrap it.
- **Channels for async** — buffered chan + worker goroutine; drop with `select default`.
- **`log/slog` is the modern stdlib answer** — show you know it, then implement.
- **Errors as values, but log methods do not return errors** — logging that fails silently is the contract.
- **Generics for fields** would be overkill — `map[string]any` is idiomatic.

---

## 1. Problem Statement
(Same as Python.)

---

## 2. Clarifying Questions
Same. Go-specific: should we mimic `slog.Handler` interface or simpler?

---

## 3. Functional Requirements
Same.

---

## 4. Actors & Use Cases
Same.

---

## 5. Core Entities

| Entity | Go shape |
|---|---|
| `Level` | named int |
| `Record` | struct (immutable copy semantics) |
| `Formatter` | interface (one method) |
| `Handler` | interface (Emit, Level, Close) |
| `Logger` | struct |
| `LogManager` | global registry |

---

## 6. Class Diagram (ASCII)
(Same shape as Python.)

---

## 7. Design Patterns
(Same as Python.)

---

## 8. Sequence Diagrams
(Same as Python.)

---

## 9. Concurrency Considerations

`sync.Mutex` per handler for sync sinks. `chan Record` + worker goroutine for async. Logger uses `RWMutex` for handler list (rare writes, frequent reads).

---

## 10. Full Working Code

```go
// File: log.go
// Build: go run log.go
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ──────────────────────────────────────────────────────────────────────────
// Level
// ──────────────────────────────────────────────────────────────────────────

type Level int

const (
	LevelDebug Level = 10
	LevelInfo  Level = 20
	LevelWarn  Level = 30
	LevelError Level = 40
	LevelFatal Level = 50
)

func (l Level) String() string {
	switch l {
	case LevelDebug:
		return "DEBUG"
	case LevelInfo:
		return "INFO"
	case LevelWarn:
		return "WARN"
	case LevelError:
		return "ERROR"
	case LevelFatal:
		return "FATAL"
	}
	return fmt.Sprintf("LVL%d", int(l))
}

// ──────────────────────────────────────────────────────────────────────────
// Record
// ──────────────────────────────────────────────────────────────────────────

type Record struct {
	Level     Level
	Message   string
	Fields    map[string]any
	Timestamp time.Time
	Logger    string
}

// ──────────────────────────────────────────────────────────────────────────
// Formatter
// ──────────────────────────────────────────────────────────────────────────

type Formatter interface {
	Format(rec Record) string
}

type TextFormatter struct{}

func (TextFormatter) Format(rec Record) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "%s [%-5s] %s: %s",
		rec.Timestamp.Format("2006-01-02T15:04:05.000"),
		rec.Level.String(), rec.Logger, rec.Message)
	if len(rec.Fields) > 0 {
		// stable key order for readability
		keys := make([]string, 0, len(rec.Fields))
		for k := range rec.Fields {
			keys = append(keys, k)
		}
		// simple in-place sort
		for i := 1; i < len(keys); i++ {
			for j := i; j > 0 && keys[j] < keys[j-1]; j-- {
				keys[j], keys[j-1] = keys[j-1], keys[j]
			}
		}
		for _, k := range keys {
			fmt.Fprintf(&sb, " %s=%v", k, rec.Fields[k])
		}
	}
	return sb.String()
}

type JSONFormatter struct{}

func (JSONFormatter) Format(rec Record) string {
	payload := map[string]any{
		"ts":     rec.Timestamp.Unix(),
		"level":  rec.Level.String(),
		"logger": rec.Logger,
		"msg":    rec.Message,
	}
	for k, v := range rec.Fields {
		payload[k] = v
	}
	b, _ := json.Marshal(payload)
	return string(b)
}

// ──────────────────────────────────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────────────────────────────────

type Handler interface {
	Emit(rec Record)
	Level() Level
	Close() error
}

// StreamHandler writes to any io.Writer (os.Stdout, file, custom buffer).
type StreamHandler struct {
	w         io.Writer
	level     Level
	formatter Formatter
	mu        sync.Mutex
}

func NewStreamHandler(w io.Writer, level Level, fmtr Formatter) *StreamHandler {
	if fmtr == nil {
		fmtr = TextFormatter{}
	}
	return &StreamHandler{w: w, level: level, formatter: fmtr}
}

func (h *StreamHandler) Emit(rec Record) {
	if rec.Level < h.level {
		return
	}
	s := h.formatter.Format(rec) + "\n"
	h.mu.Lock()
	defer h.mu.Unlock()
	_, _ = io.WriteString(h.w, s)
}

func (h *StreamHandler) Level() Level    { return h.level }
func (h *StreamHandler) Close() error    { return nil }

// AsyncHandler decorates any Handler with a buffered channel + worker.
type AsyncHandler struct {
	inner    Handler
	ch       chan Record
	done     chan struct{}
	dropFull bool
	dropped  atomic.Int64
}

func NewAsyncHandler(inner Handler, queueSize int, dropOnFull bool) *AsyncHandler {
	if queueSize <= 0 {
		queueSize = 1024
	}
	a := &AsyncHandler{
		inner:    inner,
		ch:       make(chan Record, queueSize),
		done:     make(chan struct{}),
		dropFull: dropOnFull,
	}
	go a.run()
	return a
}

func (a *AsyncHandler) Emit(rec Record) {
	if rec.Level < a.inner.Level() {
		return
	}
	if a.dropFull {
		select {
		case a.ch <- rec:
		default:
			// queue full: drop oldest, retry
			select {
			case <-a.ch:
				a.dropped.Add(1)
			default:
			}
			select {
			case a.ch <- rec:
			default:
				a.dropped.Add(1)
			}
		}
	} else {
		a.ch <- rec
	}
}

func (a *AsyncHandler) Level() Level { return a.inner.Level() }

func (a *AsyncHandler) Close() error {
	close(a.ch)
	<-a.done
	return a.inner.Close()
}

func (a *AsyncHandler) Dropped() int64 { return a.dropped.Load() }

func (a *AsyncHandler) run() {
	defer close(a.done)
	for rec := range a.ch {
		// Recover from panics in inner.Emit; logger never crashes
		func() {
			defer func() { _ = recover() }()
			a.inner.Emit(rec)
		}()
	}
}

// ──────────────────────────────────────────────────────────────────────────
// Logger
// ──────────────────────────────────────────────────────────────────────────

type Logger struct {
	mu        sync.RWMutex
	name      string
	level     Level
	handlers  []Handler
	parent    *Logger
	children  map[string]*Logger
	propagate bool
}

func newLogger(name string, level Level, parent *Logger) *Logger {
	return &Logger{
		name:      name,
		level:     level,
		parent:    parent,
		children:  make(map[string]*Logger),
		propagate: true,
	}
}

func (l *Logger) AddHandler(h Handler) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.handlers = append(l.handlers, h)
}

func (l *Logger) SetLevel(lv Level) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.level = lv
}

func (l *Logger) SetPropagate(b bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.propagate = b
}

func (l *Logger) isEnabled(lv Level) bool {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return lv >= l.level
}

func (l *Logger) log(lv Level, msg string, fields map[string]any) {
	if !l.isEnabled(lv) {
		return
	}
	rec := Record{
		Level:     lv,
		Message:   msg,
		Fields:    fields,
		Timestamp: time.Now(),
		Logger:    l.name,
	}
	l.dispatch(rec)
}

func (l *Logger) dispatch(rec Record) {
	l.mu.RLock()
	handlers := append([]Handler(nil), l.handlers...)
	parent := l.parent
	propagate := l.propagate
	l.mu.RUnlock()
	for _, h := range handlers {
		func() {
			defer func() { _ = recover() }()
			h.Emit(rec)
		}()
	}
	if propagate && parent != nil {
		parent.dispatch(rec)
	}
}

func (l *Logger) Debug(msg string, fields ...map[string]any) { l.log(LevelDebug, msg, mergeFields(fields)) }
func (l *Logger) Info(msg string, fields ...map[string]any)  { l.log(LevelInfo, msg, mergeFields(fields)) }
func (l *Logger) Warn(msg string, fields ...map[string]any)  { l.log(LevelWarn, msg, mergeFields(fields)) }
func (l *Logger) Error(msg string, fields ...map[string]any) { l.log(LevelError, msg, mergeFields(fields)) }
func (l *Logger) Fatal(msg string, fields ...map[string]any) { l.log(LevelFatal, msg, mergeFields(fields)) }

func mergeFields(parts []map[string]any) map[string]any {
	if len(parts) == 0 {
		return nil
	}
	out := make(map[string]any)
	for _, p := range parts {
		for k, v := range p {
			out[k] = v
		}
	}
	return out
}

// F is a syntactic helper for fields.
func F(k string, v any) map[string]any { return map[string]any{k: v} }

func (l *Logger) GetChild(name string) *Logger {
	l.mu.Lock()
	defer l.mu.Unlock()
	if c, ok := l.children[name]; ok {
		return c
	}
	childName := name
	if l.name != "" {
		childName = l.name + "." + name
	}
	c := newLogger(childName, l.level, l)
	l.children[name] = c
	return c
}

// ──────────────────────────────────────────────────────────────────────────
// LogManager
// ──────────────────────────────────────────────────────────────────────────

type LogManager struct {
	mu      sync.RWMutex
	root    *Logger
	byName  map[string]*Logger
}

func NewLogManager() *LogManager {
	root := newLogger("", LevelInfo, nil)
	return &LogManager{
		root:   root,
		byName: map[string]*Logger{"": root},
	}
}

func (m *LogManager) Root() *Logger { return m.root }

func (m *LogManager) GetLogger(name string) *Logger {
	if name == "" {
		return m.root
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if l, ok := m.byName[name]; ok {
		return l
	}
	parts := strings.Split(name, ".")
	current := m.root
	currentName := ""
	for _, p := range parts {
		if currentName != "" {
			currentName = currentName + "." + p
		} else {
			currentName = p
		}
		if l, ok := m.byName[currentName]; ok {
			current = l
			continue
		}
		c := current.GetChild(p)
		m.byName[currentName] = c
		current = c
	}
	return current
}

func (m *LogManager) Shutdown() {
	seen := make(map[Handler]bool)
	var visit func(*Logger)
	visit = func(node *Logger) {
		node.mu.RLock()
		handlers := append([]Handler(nil), node.handlers...)
		children := make([]*Logger, 0, len(node.children))
		for _, c := range node.children {
			children = append(children, c)
		}
		node.mu.RUnlock()
		for _, h := range handlers {
			if !seen[h] {
				seen[h] = true
				_ = h.Close()
			}
		}
		for _, c := range children {
			visit(c)
		}
	}
	visit(m.root)
}

// ──────────────────────────────────────────────────────────────────────────
// Demo / tests
// ──────────────────────────────────────────────────────────────────────────

func main() {
	basicTest()
	levelFiltering()
	hierarchyPropagation()
	jsonFormatter()
	asyncHandlerTest()
	asyncOverflowDropsTest()
	concurrentWritersTest()
	fmt.Println("\nAll tests passed.")
}

func basicTest() {
	fmt.Println("--- basic ---")
	mgr := NewLogManager()
	log := mgr.GetLogger("app")
	buf := &bytes.Buffer{}
	log.AddHandler(NewStreamHandler(buf, LevelDebug, nil))
	log.SetLevel(LevelDebug)
	log.Debug("hello", F("user_id", 42))
	log.Info("started")
	log.Warn("threshold", F("value", 99))
	out := buf.String()
	if !strings.Contains(out, "hello") || !strings.Contains(out, "user_id=42") {
		panic(out)
	}
	if !strings.Contains(out, "started") {
		panic("info missing")
	}
	fmt.Println("  OK")
	fmt.Print(out)
}

func levelFiltering() {
	fmt.Println("--- level filtering ---")
	mgr := NewLogManager()
	log := mgr.GetLogger("app")
	buf := &bytes.Buffer{}
	log.AddHandler(NewStreamHandler(buf, LevelWarn, nil))
	log.SetLevel(LevelDebug)
	log.Debug("d")
	log.Info("i")
	log.Warn("w")
	log.Error("e")
	out := buf.String()
	if strings.Contains(out, "d\n") || strings.Contains(out, "i\n") {
		panic("debug/info should be filtered")
	}
	if !strings.Contains(out, "w") || !strings.Contains(out, "e") {
		panic("warn/error should pass")
	}
	fmt.Println("  OK; only WARN+ went through")
}

func hierarchyPropagation() {
	fmt.Println("--- hierarchy propagation ---")
	mgr := NewLogManager()
	rootBuf := &bytes.Buffer{}
	mgr.Root().AddHandler(NewStreamHandler(rootBuf, LevelDebug, nil))
	mgr.Root().SetLevel(LevelDebug)

	app := mgr.GetLogger("app")
	appBuf := &bytes.Buffer{}
	app.AddHandler(NewStreamHandler(appBuf, LevelDebug, nil))
	app.SetLevel(LevelDebug)

	db := mgr.GetLogger("app.db")
	db.SetLevel(LevelDebug)
	db.Info("query took 5ms")
	if !strings.Contains(appBuf.String(), "query took 5ms") {
		panic("app should have it")
	}
	if !strings.Contains(rootBuf.String(), "query took 5ms") {
		panic("root should have it")
	}
	fmt.Println("  OK; propagated")
}

func jsonFormatter() {
	fmt.Println("--- JSON formatter ---")
	mgr := NewLogManager()
	log := mgr.GetLogger("svc")
	buf := &bytes.Buffer{}
	log.AddHandler(NewStreamHandler(buf, LevelDebug, JSONFormatter{}))
	log.SetLevel(LevelDebug)
	log.Info("event", F("request_id", "r-123"), F("duration_ms", 42))
	line := strings.TrimSpace(buf.String())
	var obj map[string]any
	if err := json.Unmarshal([]byte(line), &obj); err != nil {
		panic(err)
	}
	if obj["msg"] != "event" {
		panic("msg")
	}
	fmt.Printf("  OK %v\n", obj)
}

func asyncHandlerTest() {
	fmt.Println("--- async handler ---")
	mgr := NewLogManager()
	log := mgr.GetLogger("svc")
	buf := &bytes.Buffer{}
	inner := NewStreamHandler(buf, LevelDebug, nil)
	a := NewAsyncHandler(inner, 1024, true)
	log.AddHandler(a)
	log.SetLevel(LevelDebug)
	for i := 0; i < 100; i++ {
		log.Info("msg", F("i", i))
	}
	a.Close()
	lines := strings.Split(strings.TrimRight(buf.String(), "\n"), "\n")
	if len(lines) != 100 {
		panic(fmt.Sprintf("expected 100, got %d", len(lines)))
	}
	fmt.Printf("  OK; %d lines flushed\n", len(lines))
}

type slowHandler struct {
	count atomic.Int64
}

func (s *slowHandler) Emit(rec Record) {
	s.count.Add(1)
	time.Sleep(time.Millisecond)
}
func (s *slowHandler) Level() Level    { return LevelDebug }
func (s *slowHandler) Close() error    { return nil }

func asyncOverflowDropsTest() {
	fmt.Println("--- async overflow drops ---")
	mgr := NewLogManager()
	log := mgr.GetLogger("svc")
	slow := &slowHandler{}
	a := NewAsyncHandler(slow, 10, true)
	log.AddHandler(a)
	log.SetLevel(LevelDebug)
	for i := 0; i < 1000; i++ {
		log.Info("msg", F("i", i))
	}
	a.Close()
	emitted := slow.count.Load()
	dropped := a.Dropped()
	fmt.Printf("  emitted=%d dropped=%d\n", emitted, dropped)
	if dropped == 0 {
		panic("expected drops with slow handler + small queue")
	}
}

func concurrentWritersTest() {
	fmt.Println("--- concurrent writers ---")
	mgr := NewLogManager()
	log := mgr.GetLogger("svc")
	buf := &bytes.Buffer{}
	log.AddHandler(NewStreamHandler(buf, LevelDebug, nil))
	log.SetLevel(LevelDebug)
	var wg sync.WaitGroup
	for t := 0; t < 8; t++ {
		t := t
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 50; i++ {
				log.Info("from", F("thread", t), F("i", i))
			}
		}()
	}
	wg.Wait()
	lines := strings.Split(strings.TrimRight(buf.String(), "\n"), "\n")
	if len(lines) != 8*50 {
		panic(fmt.Sprintf("expected 400, got %d", len(lines)))
	}
	for _, ln := range lines[:5] {
		if !strings.Contains(ln, "thread=") || !strings.Contains(ln, "i=") {
			panic("torn line: " + ln)
		}
	}
	fmt.Printf("  OK; %d lines, no torn writes\n", len(lines))
	_ = os.Stdout
}
```

### How to run

```bash
go run /path/to/log.go
```

---

## 11. Cross-Questions ("Why X and not Y") — ≥ 12

### 11.1 Why a custom Handler interface and not stdlib `log/slog.Handler`?

`log/slog` (Go 1.21+) is the production answer; show you know it. We build our own to expose the design.

In production: use `log/slog`. The interface is similar (Enabled, Handle, WithAttrs, WithGroup); we'd implement a slog.Handler if integrating.

### 11.2 Why `io.Writer` as the sink and not a custom `Sink` type?

`io.Writer` is the universal Go stream interface. `os.Stdout`, `*os.File`, `*bytes.Buffer`, `bufio.Writer`, network connections — all are writers.

A custom `Sink` would force callers to wrap their writer. Useless ceremony.

### 11.3 Why drop oldest by default?

Same as Python: logging must not block app code. If queue fills:
- Drop oldest preserves recent context (often more useful).
- Drop newest is sometimes preferable for "first-error wins" workflows.
- Block is an anti-pattern unless you absolutely need every record (use a separate audit pipeline).

### 11.4 Why `sync.RWMutex` on Logger?

Reads of `level`, `handlers`, `parent` happen on every log call (frequent). Writes (`AddHandler`, `SetLevel`) are infrequent (config-time). RWMutex parallelizes reads.

### 11.5 Why does `dispatch` snapshot handlers under RLock and release before Emit?

To avoid holding the lock through possibly-slow handler I/O. We copy the slice (cheap) + release lock. Each `h.Emit` runs lock-free with respect to other Logger ops.

### 11.6 Why not `strings.Builder` in the formatter (saves alloc)?

We do, in `TextFormatter`. `bytes.Buffer` would also work; `strings.Builder` is purpose-built for string output and slightly faster.

### 11.7 Why `defer recover()` around `h.Emit`?

A buggy handler panicking would crash the goroutine. `recover()` traps it; logging continues. Standard "must not crash" pattern.

### 11.8 Why is `mergeFields` variadic?

Ergonomics: `log.Info("event", F("user", 42), F("dur_ms", 10))` is fluent. A single map argument forces callers to construct it inline (`map[string]any{...}`) — noisier.

Performance cost: one allocation per call. Negligible for log call rates.

### 11.9 Why `map[string]any` instead of typed structs?

Logging fields are open-ended. A typed struct would force schema upfront. `map[string]any` matches the dynamic nature.

For stronger typing, use `slog.Attr` (Go 1.21+) which carries type info. We use `any` for simplicity.

### 11.10 What if the worker goroutine panics?

`defer recover()` in `run()` would catch it. Currently we don't have a top-level recover in `run()`; we should add it for safety. Beyond that, a panic in `Emit` is recovered inside the loop.

### 11.11 Why `chan Record` and not `chan *Record`?

For small structs (~80 bytes), value semantics avoid one allocation per send. Pointer would be fine too; we chose value to keep the channel simple (no GC pressure on small items).

For larger payloads, pointer is the right call.

### 11.12 What about Go's `log/slog` in production?

```go
slog.New(slog.NewJSONHandler(os.Stdout, nil))
slog.Info("event", "user_id", 42)
```

Use this in production. Our hand-rolled is for the interview only.

### 11.13 What's the failure mode if the file handler can't open the file?

Currently, the StreamHandler is given a `io.Writer` already (caller opens the file). If `Write` fails, we ignore the error silently (logging must not crash).

For a production FileHandler with rotation: log to stderr on file error, retry next call.

### 11.14 What if I want context.Context propagation?

Add a method `LoggerCtx`:
```go
func (l *Logger) InfoCtx(ctx context.Context, msg string, fields ...map[string]any) {
    if v, ok := ctx.Value(traceKey{}).(string); ok {
        fields = append(fields, F("trace_id", v))
    }
    l.log(LevelInfo, msg, mergeFields(fields))
}
```

Or read from context inside `log()`. `slog` does this with `LogContext`.

### 11.15 Why does `LogManager.Shutdown` walk children?

Closing all handlers exactly once. We track `seen` because the same handler may be attached to multiple loggers (rare but possible).

---

## 12. Extensions
(Same as Python — see `LLD/Python/logging-service.md` §12.)

---

## 13. Cheat-Sheet Recap

1. **Problem:** Multi-sink, multi-level, hierarchical, async-capable logger.
2. **Idioms:** `io.Writer` for sinks, channels for async, sync.Mutex per handler, `slog`-like API.
3. **Patterns:** Strategy (handler/formatter), Decorator (AsyncHandler), Chain of Responsibility, Producer-Consumer.
4. **Concurrency:** Per-handler mutex (sync) + buffered chan (async); never block caller.
5. **Trade-offs:** Drop-on-full vs block; sync vs async per-handler.
6. **Production:** Use `log/slog`.

---

## Appendix A: How this differs from the Python version

```
Python                          Go
─────────                       ─────
ABC                             interface
threading.Lock                  sync.Mutex
queue.Queue                     buffered chan
threading.Thread                go (goroutine)
@dataclass(frozen=True)         struct (idiomatic value semantics)
**kwargs                        variadic map[string]any
contextvars                     context.Context
io.StringIO                     bytes.Buffer
```

## Appendix B: Common Go gotchas

```
- close(chan) on a nil chan panics — guard with sync.Once.
- range over closed chan terminates after draining.
- channel send on closed chan panics; close from sender only.
- map iteration order randomized; sort if needed for tests.
- atomic.Int64 for counters; sync/atomic for raw values.
- defer recover() at goroutine entry to survive panics.
- context cancellation propagation: pass ctx through the API.
```

## Appendix C: log/slog cheat-sheet

```go
// Modern Go logging (1.21+):
import "log/slog"
slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
    Level: slog.LevelInfo,
})))
slog.Info("event", "user_id", 42, "duration_ms", 10)

// With group:
log := slog.With("service", "auth")
log.Info("login_failed", "reason", "bad_password")
```

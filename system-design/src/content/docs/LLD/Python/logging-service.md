# Logging Service — Low-Level Design (Python)

> **Difficulty:** Medium
> **Tags:** `[lld]` `[ood]` `[strategy]` `[chain-of-responsibility]` `[concurrency]` `[async-io]`
> **Language:** Python 3.10+
> **Prep time:** ~10 min skim, ~30 min deep read
> **Companies that ask this:** Atlassian, Microsoft, Google, Bloomberg, every infra-leaning interview

---

## Beginner's Guide

### What's this in plain English?

A logging library. Your app calls `log.info("user signed up")`. Behind the scenes: format the message (add timestamp, level, etc.), filter by level (no DEBUG in production), send to one or more destinations (console, file, network).

The interview wants you to design **the system Python's `logging` module IS**.

### Why solve it?

- **Real world**: every application has logging; designing one yourself is a great way to understand it.
- **Teaches**: chain of responsibility (handlers in sequence), strategy (formatters), decorator (wrappers), thread/async safety.
- **Patterns**: chain of responsibility, strategy, decorator, observer.

### Vocabulary

- **Level** — DEBUG, INFO, WARNING, ERROR, CRITICAL.
- **Logger** — the thing your app calls.
- **Handler / Sink / Appender** — destination (console, file, network).
- **Formatter** — turns the message into a string.
- **Filter** — extra logic for "should this log?"

### High-level approach

Entities:
- **LogLevel** enum.
- **LogRecord** — timestamp, level, message, context.
- **Formatter** — interface; concrete: TextFormatter, JsonFormatter.
- **Handler** — interface; concrete: ConsoleHandler, FileHandler, NetworkHandler. Each holds a formatter and a min level.
- **Logger** — has a list of handlers; `log(level, msg)` dispatches to all.
- **AsyncHandler** — wraps a handler; queues records, flushes from a worker thread.

Flow: `logger.info("hello")` → builds LogRecord → for each handler with level ≤ INFO, format → write.

### How to read this doc

- **Beginner**: focus on Logger + Handlers + Formatters separation.
- **Interview**: async logging, batch flushing, structured logs, log rotation are the differentiators.

---

## 0. How to use this doc in an interview

Logging is the **multi-strategy + producer-consumer** OOD interview. Tests:
1. **Pluggable sinks** — console, file, network. Strategy pattern.
2. **Pluggable formatters** — text, JSON, structured.
3. **Levels with filtering** — DEBUG / INFO / WARN / ERROR / FATAL with hierarchy.
4. **Async writing** — `log()` should return ASAP; actual I/O happens off the hot path.
5. **Child loggers / hierarchy** — `logger.getChild("subsystem")` inheriting parent settings.
6. **Thread safety** — many threads log concurrently; handlers serialize writes.

The trap: building a synchronous logger that flushes-on-every-call. Production loggers buffer + flush async.

---

## 1. Problem Statement

A logging library/service that:
- Accepts log records at varying levels (DEBUG ... FATAL).
- Routes records to multiple **handlers** (sinks): console, file, syslog, network.
- Each handler can filter by level + apply a formatter.
- Operates without blocking the caller (async option).
- Supports child loggers (named hierarchy).
- Thread-safe.

This is the same problem `logging` (Python stdlib) and `logrus`/`slog` (Go) solve. We build a focused subset.

---

## 2. Clarifying Questions

### Scope
- [ ] Levels: which set? (DEBUG/INFO/WARN/ERROR/FATAL or trace+more.)
- [ ] **Async** by default, or sync with explicit async opt-in?
- [ ] **Structured logging** (JSON) or plain text?
- [ ] **Hierarchical loggers** (parent → child propagation)?
- [ ] Sinks: console, file (rotating?), network (syslog/HTTP)?
- [ ] Per-handler vs per-logger level filtering?

### Domain
- [ ] What happens when the queue is full (async mode)? Block, drop, or raise?
- [ ] Should handlers shut down gracefully (drain queue)?
- [ ] Add request-context info (trace_id, user_id)?

### Non-functional
- [ ] Throughput target — 100k logs/sec is normal for hot services.
- [ ] Memory: bounded queue.
- [ ] Persistence: depends on sink.

> **For this doc:** 5 levels, async via background queue (configurable), JSON + text formatters, hierarchical loggers, level filter on logger AND handler, file + console sinks, drop-oldest on full queue (configurable to block), thread-safe.

---

## 3. Functional Requirements

**Must-have (P0):**
1. `Logger` with `debug/info/warn/error/fatal(msg, **kwargs)`.
2. Multiple `Handler`s per logger; each with own level + formatter.
3. Records flow through handlers in order.
4. Async mode: log calls enqueue; background thread writes.
5. Child logger inherits parent's handlers + level by default; can override.
6. Thread-safe.
7. `shutdown()` drains pending logs.

**Should-have (P1):**
8. Structured fields (`logger.info("event", user_id=42)`).
9. File rotation (size or time).
10. Network sinks (HTTP, UDP).
11. Per-record context propagation (trace_id).

**Nice-to-have (P2 — designed):**
12. Sampling (1 in N).
13. Rate limiting per logger.
14. Graceful degradation under back-pressure.

---

## 4. Actors & Use Cases

```
                ┌──────────────────┐
                │  Application     │
                │   (many threads) │
                └────────┬─────────┘
                         │ logger.info(...)
                         ▼
                ┌──────────────────┐         ┌──────────────────┐
                │   Logger Tree    │ ──────▶ │ Async Dispatcher │
                │ root → app → db  │         │  (worker thread) │
                └──────────────────┘         └────────┬─────────┘
                                                      │
                                              ┌───────┼───────┐
                                              ▼       ▼       ▼
                                          Console  File   Network
                                          Handler Handler Handler
```

---

## 5. Core Entities

| Entity | Attributes |
|---|---|
| `LogLevel` | enum: DEBUG=10, INFO=20, WARN=30, ERROR=40, FATAL=50 (numeric for comparison) |
| `LogRecord` | level, msg, fields, ts, logger_name, thread_id |
| `Formatter` | abstract: `format(record) → str` |
| `Handler` | abstract: `emit(record)`, level filter, formatter |
| `Logger` | name, level, handlers, parent, children |
| `LogManager` | global registry of named loggers; root logger |

---

## 6. Class Diagram (ASCII)

```
                        ┌───────────────────────────┐
                        │       LogManager          │
                        │   (singleton-ish)         │
                        │───────────────────────────│
                        │ - root: Logger            │
                        │ - by_name                 │
                        │───────────────────────────│
                        │ + get_logger(name)        │
                        │ + shutdown()              │
                        └─────────┬─────────────────┘
                                  │ ◆
                                  ▼
                        ┌──────────────────────┐
                        │       Logger         │
                        │──────────────────────│
                        │ - name, level        │
                        │ - parent, children   │
                        │ - handlers           │◇──┐
                        │ - propagate          │   │
                        │──────────────────────│   │
                        │ + debug/info/.../fatal   │
                        │ + add_handler(h)     │   │
                        │ + get_child(name)    │   │
                        └──────────────────────┘   │
                                                   ▼
                                       ┌────────────────────┐
                                       │ «interface»        │
                                       │ Handler            │
                                       │────────────────────│
                                       │ + emit(record)     │
                                       │ + level, formatter │◇──┐
                                       │ + close()          │   │
                                       └─────────▲──────────┘   │
                                                 │              │
                                ┌────────────────┼──────────┐   │
                                │                │          │   │
                        ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
                        │ ConsoleHandler│ │ FileHandler  │ │ AsyncHandler │
                        │              │ │              │ │  (decorator) │
                        └──────────────┘ └──────────────┘ └──────────────┘
                                                              │ wraps any other
                                                              ▼
                                                                   ┌────────┐
                                                                   │ Handler│
                                                                   └────────┘

                                                ┌────────────────────┐
                                                │ «interface»        │
                                                │ Formatter          │◀──┘
                                                │────────────────────│
                                                │ + format(record)   │
                                                └─────────▲──────────┘
                                                          │
                                          ┌───────────────┼─────────────┐
                                          │               │             │
                                  ┌──────────────┐ ┌──────────────┐
                                  │ TextFormatter │ │JSONFormatter │
                                  └──────────────┘ └──────────────┘
```

---

## 7. Design Patterns Used

| Pattern | Where | Why |
|---|---|---|
| Strategy | `Formatter`, `Handler` | Pluggable serialization + sink |
| Chain of Responsibility | Logger walks parent → emit; level cutoff propagates | Hierarchy with override |
| Decorator | `AsyncHandler` wraps any Handler to add async I/O | Composable; orthogonal concerns |
| Singleton (light) | `LogManager` (one per process) | Process-wide registry; pragmatic singleton |
| Factory | `LogManager.get_logger(name)` | Reuse loggers by name |
| Producer-Consumer | Async pipeline | Decouple log call from I/O |

---

## 8. Sequence Diagrams

### 8.1 Synchronous log (basic)

```
  App         Logger          Handler         Formatter
   │            │                │                │
   │── info ──▶│                │                │
   │            │── if INFO < self.level: drop   │
   │            │── for h in handlers:           │
   │            │     emit(rec) ─▶│              │
   │            │                  │── format ──▶│
   │            │                  │◀── string ──│
   │            │                  │── write     │
```

### 8.2 Async log via AsyncHandler

```
  App         Logger      AsyncHandler     queue       worker thread     real Handler
   │            │              │              │            │                │
   │── info ──▶│── emit ─────▶│── put ────▶ │            │                │
   │◀── return │◀── ok ────────│           (queued)        │                │
   │                                                       │── get ────────▶│
   │                                                       │   emit(rec) ──▶│
   │                                                       │◀── ok ─────────│
```

### 8.3 Shutdown drain

```
  App         LogManager    AsyncHandler    queue
   │             │              │              │
   │── shutdown ▶│              │              │
   │             │── for h: close │            │
   │             │       (sentinel) ─▶queue.put(STOP)
   │             │                            │
   │                            worker drains, exits
   │             │              │── join     │
   │◀── done ────│              │              │
```

---

## 9. Concurrency Considerations

- Many app threads call `log()` simultaneously.
- Sync handlers must serialize writes (no torn output) — each handler holds its own `Lock`.
- Async handlers buffer through a `queue.Queue`; the queue itself is thread-safe; one worker thread does the I/O.

Patterns:
- Per-handler lock for synchronous writes.
- Async worker drains queue; on full queue, drop or block (configurable).
- `shutdown()` joins all workers via sentinels.

---

## 10. Full Working Code

```python
"""
Logging Service — Low-Level Design (Python)

Features:
- 5 levels (DEBUG/INFO/WARN/ERROR/FATAL)
- Pluggable formatters (text, JSON)
- Pluggable handlers (console, file, async wrapper)
- Hierarchical named loggers with propagation
- Thread-safe sync and async modes
- Graceful shutdown (drain queue)
"""
from __future__ import annotations

import enum
import io
import json
import queue
import threading
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, IO


class LogLevel(enum.IntEnum):
    DEBUG = 10
    INFO = 20
    WARN = 30
    ERROR = 40
    FATAL = 50


@dataclass(frozen=True)
class LogRecord:
    level: LogLevel
    message: str
    fields: dict
    timestamp: float
    logger_name: str
    thread_id: int


# ──────────────────────────────────────────────────────────────────────────
# Formatters
# ──────────────────────────────────────────────────────────────────────────

class Formatter(ABC):
    @abstractmethod
    def format(self, record: LogRecord) -> str:
        ...


class TextFormatter(Formatter):
    def format(self, record: LogRecord) -> str:
        ts = datetime.fromtimestamp(record.timestamp).isoformat(timespec="milliseconds")
        extras = ""
        if record.fields:
            extras = " " + " ".join(f"{k}={v!r}" for k, v in record.fields.items())
        return f"{ts} [{record.level.name:5}] {record.logger_name}: {record.message}{extras}"


class JSONFormatter(Formatter):
    def format(self, record: LogRecord) -> str:
        payload = {
            "ts": record.timestamp,
            "level": record.level.name,
            "logger": record.logger_name,
            "msg": record.message,
            "thread": record.thread_id,
            **record.fields,
        }
        return json.dumps(payload, default=str, separators=(",", ":"))


# ──────────────────────────────────────────────────────────────────────────
# Handlers
# ──────────────────────────────────────────────────────────────────────────

class Handler(ABC):
    def __init__(self, level: LogLevel = LogLevel.DEBUG, formatter: Optional[Formatter] = None) -> None:
        self.level = level
        self.formatter = formatter or TextFormatter()
        self._lock = threading.Lock()

    def is_enabled(self, level: LogLevel) -> bool:
        return level >= self.level

    @abstractmethod
    def emit(self, record: LogRecord) -> None:
        ...

    def close(self) -> None:
        pass


class StreamHandler(Handler):
    """Write to any io stream (stdout, stderr, custom)."""
    def __init__(self, stream: IO[str], level: LogLevel = LogLevel.DEBUG, formatter: Optional[Formatter] = None) -> None:
        super().__init__(level, formatter)
        self._stream = stream

    def emit(self, record: LogRecord) -> None:
        if not self.is_enabled(record.level):
            return
        s = self.formatter.format(record)
        with self._lock:
            self._stream.write(s + "\n")
            self._stream.flush()


class FileHandler(Handler):
    """Append to a file. Opens lazily."""
    def __init__(self, path: str, level: LogLevel = LogLevel.DEBUG, formatter: Optional[Formatter] = None) -> None:
        super().__init__(level, formatter)
        self._path = path
        self._fp: Optional[IO[str]] = None

    def _open(self) -> IO[str]:
        if self._fp is None:
            self._fp = open(self._path, "a", buffering=1, encoding="utf-8")
        return self._fp

    def emit(self, record: LogRecord) -> None:
        if not self.is_enabled(record.level):
            return
        s = self.formatter.format(record)
        with self._lock:
            fp = self._open()
            fp.write(s + "\n")

    def close(self) -> None:
        with self._lock:
            if self._fp is not None:
                self._fp.close()
                self._fp = None


class AsyncHandler(Handler):
    """Decorator: wrap any Handler with an async queue + worker.

    On full queue: drop oldest by default (drop_full=True), or block (drop_full=False).
    """
    _SENTINEL = object()

    def __init__(self, inner: Handler, queue_size: int = 1024, drop_full: bool = True) -> None:
        super().__init__(level=LogLevel.DEBUG, formatter=inner.formatter)
        self._inner = inner
        self._q: queue.Queue = queue.Queue(maxsize=queue_size)
        self._drop_full = drop_full
        self._dropped = 0
        self._worker = threading.Thread(target=self._run, name="async-log", daemon=True)
        self._worker.start()

    def emit(self, record: LogRecord) -> None:
        if not self._inner.is_enabled(record.level):
            return
        try:
            if self._drop_full:
                try:
                    self._q.put_nowait(record)
                except queue.Full:
                    # Drop oldest, push new
                    try:
                        self._q.get_nowait()
                        self._dropped += 1
                    except queue.Empty:
                        pass
                    try:
                        self._q.put_nowait(record)
                    except queue.Full:
                        self._dropped += 1
            else:
                self._q.put(record)
        except Exception:
            # Logging must NEVER raise into the app
            pass

    def close(self) -> None:
        self._q.put(self._SENTINEL)
        self._worker.join(timeout=5.0)
        self._inner.close()

    def _run(self) -> None:
        while True:
            item = self._q.get()
            if item is AsyncHandler._SENTINEL:
                return
            try:
                self._inner.emit(item)
            except Exception:
                # Don't crash worker on a bad log line
                pass

    @property
    def dropped(self) -> int:
        return self._dropped


# ──────────────────────────────────────────────────────────────────────────
# Logger + LogManager
# ──────────────────────────────────────────────────────────────────────────

class Logger:
    def __init__(self, name: str, level: LogLevel = LogLevel.INFO, parent: Optional["Logger"] = None) -> None:
        self.name = name
        self.level = level
        self.parent = parent
        self.handlers: list[Handler] = []
        self.propagate: bool = True
        self.children: dict[str, "Logger"] = {}
        self._lock = threading.RLock()

    def add_handler(self, h: Handler) -> None:
        with self._lock:
            self.handlers.append(h)

    def remove_handler(self, h: Handler) -> None:
        with self._lock:
            if h in self.handlers:
                self.handlers.remove(h)

    def set_level(self, level: LogLevel) -> None:
        self.level = level

    def is_enabled(self, level: LogLevel) -> bool:
        return level >= self.level

    def _log(self, level: LogLevel, msg: str, **kwargs) -> None:
        if not self.is_enabled(level):
            return
        record = LogRecord(
            level=level,
            message=msg,
            fields=dict(kwargs),
            timestamp=time.time(),
            logger_name=self.name,
            thread_id=threading.get_ident(),
        )
        self._dispatch(record)

    def _dispatch(self, record: LogRecord) -> None:
        # Walk handlers on self, then propagate up (mimics Python stdlib logging)
        for h in self.handlers:
            try:
                h.emit(record)
            except Exception:
                pass
        if self.propagate and self.parent is not None:
            self.parent._dispatch(record)

    def debug(self, msg: str, **kw): self._log(LogLevel.DEBUG, msg, **kw)
    def info(self, msg: str, **kw):  self._log(LogLevel.INFO, msg, **kw)
    def warn(self, msg: str, **kw):  self._log(LogLevel.WARN, msg, **kw)
    def error(self, msg: str, **kw): self._log(LogLevel.ERROR, msg, **kw)
    def fatal(self, msg: str, **kw): self._log(LogLevel.FATAL, msg, **kw)

    def get_child(self, suffix: str) -> "Logger":
        with self._lock:
            if suffix in self.children:
                return self.children[suffix]
            child_name = f"{self.name}.{suffix}" if self.name else suffix
            child = Logger(name=child_name, level=self.level, parent=self)
            self.children[suffix] = child
            return child


class LogManager:
    """Process-wide registry. Holds the root logger and resolves dotted names."""
    def __init__(self) -> None:
        self.root = Logger(name="", level=LogLevel.INFO)
        self._loggers_by_name: dict[str, Logger] = {"": self.root}
        self._lock = threading.RLock()

    def get_logger(self, name: str) -> Logger:
        if not name:
            return self.root
        with self._lock:
            if name in self._loggers_by_name:
                return self._loggers_by_name[name]
            # Walk from root, creating intermediate
            parts = name.split(".")
            current = self.root
            current_name = ""
            for p in parts:
                current_name = f"{current_name}.{p}" if current_name else p
                if current_name in self._loggers_by_name:
                    current = self._loggers_by_name[current_name]
                else:
                    new_logger = current.get_child(p)
                    self._loggers_by_name[current_name] = new_logger
                    current = new_logger
            return current

    def shutdown(self) -> None:
        # Close every handler we know of, walking the tree
        seen_handlers: set[int] = set()
        def visit(node: Logger):
            for h in list(node.handlers):
                if id(h) not in seen_handlers:
                    seen_handlers.add(id(h))
                    try:
                        h.close()
                    except Exception:
                        pass
            for ch in node.children.values():
                visit(ch)
        with self._lock:
            visit(self.root)


# ──────────────────────────────────────────────────────────────────────────
# Demo / tests
# ──────────────────────────────────────────────────────────────────────────

def _basic_test() -> None:
    print("--- basic sync logger ---")
    mgr = LogManager()
    log = mgr.get_logger("app")
    buf = io.StringIO()
    log.add_handler(StreamHandler(buf, level=LogLevel.DEBUG))
    log.set_level(LogLevel.DEBUG)
    log.debug("hello", user_id=42)
    log.info("started")
    log.warn("threshold crossed", value=99)
    output = buf.getvalue()
    assert "hello" in output and "user_id=42" in output
    assert "started" in output
    assert "WARN" in output
    print("  OK")
    print(output)


def _level_filtering() -> None:
    print("--- level filtering ---")
    mgr = LogManager()
    log = mgr.get_logger("app")
    buf = io.StringIO()
    h = StreamHandler(buf, level=LogLevel.WARN)
    log.add_handler(h)
    log.set_level(LogLevel.DEBUG)
    log.debug("d")
    log.info("i")
    log.warn("w")
    log.error("e")
    output = buf.getvalue()
    assert "d" not in output and "i" not in output
    assert "w" in output and "e" in output
    print("  OK; only WARN+ went through")


def _hierarchy_propagation() -> None:
    print("--- hierarchy propagation ---")
    mgr = LogManager()
    root_log = mgr.root
    buf_root = io.StringIO()
    root_log.add_handler(StreamHandler(buf_root, level=LogLevel.DEBUG))
    root_log.set_level(LogLevel.DEBUG)

    app = mgr.get_logger("app")
    buf_app = io.StringIO()
    app.add_handler(StreamHandler(buf_app, level=LogLevel.DEBUG))
    app.set_level(LogLevel.DEBUG)

    db = mgr.get_logger("app.db")
    db.set_level(LogLevel.DEBUG)
    # No own handler → should still log via parent (propagate)
    db.info("query took 5ms")
    # Both buf_app and buf_root should have the record
    assert "query took 5ms" in buf_app.getvalue()
    assert "query took 5ms" in buf_root.getvalue()
    print("  OK; propagated app.db → app → root")


def _json_formatter() -> None:
    print("--- JSON formatter ---")
    mgr = LogManager()
    log = mgr.get_logger("svc")
    buf = io.StringIO()
    log.add_handler(StreamHandler(buf, formatter=JSONFormatter()))
    log.set_level(LogLevel.DEBUG)
    log.info("event", request_id="r-123", duration_ms=42)
    line = buf.getvalue().strip()
    obj = json.loads(line)
    assert obj["msg"] == "event" and obj["request_id"] == "r-123" and obj["duration_ms"] == 42
    print("  OK", obj)


def _async_handler() -> None:
    print("--- async handler ---")
    mgr = LogManager()
    log = mgr.get_logger("svc")
    buf = io.StringIO()
    inner = StreamHandler(buf, level=LogLevel.DEBUG)
    async_h = AsyncHandler(inner, queue_size=1024)
    log.add_handler(async_h)
    log.set_level(LogLevel.DEBUG)
    for i in range(100):
        log.info("msg", i=i)
    async_h.close()
    lines = buf.getvalue().strip().splitlines()
    assert len(lines) == 100, f"got {len(lines)}"
    print(f"  OK; {len(lines)} lines flushed via async")


def _async_overflow_drops() -> None:
    print("--- async overflow drops ---")
    mgr = LogManager()
    log = mgr.get_logger("svc")
    inner = StreamHandler(io.StringIO(), level=LogLevel.DEBUG)
    # Slow down inner emit by injecting sleep via subclass
    class SlowHandler(Handler):
        def __init__(self):
            super().__init__()
            self.count = 0
        def emit(self, rec):
            self.count += 1
            time.sleep(0.001)
    slow = SlowHandler()
    async_h = AsyncHandler(slow, queue_size=10, drop_full=True)
    log.add_handler(async_h)
    log.set_level(LogLevel.DEBUG)
    for i in range(1000):
        log.info("msg", i=i)
    async_h.close()
    print(f"  emitted={slow.count}, dropped={async_h.dropped}")
    assert async_h.dropped > 0  # some should have been dropped


def _concurrent_writers() -> None:
    print("--- concurrent writers ---")
    mgr = LogManager()
    log = mgr.get_logger("svc")
    buf = io.StringIO()
    log.add_handler(StreamHandler(buf, level=LogLevel.DEBUG))
    log.set_level(LogLevel.DEBUG)
    def w(t: int):
        for i in range(50):
            log.info("from", thread=t, i=i)
    threads = [threading.Thread(target=w, args=(t,)) for t in range(8)]
    for t in threads: t.start()
    for t in threads: t.join()
    lines = buf.getvalue().strip().splitlines()
    assert len(lines) == 8 * 50, f"got {len(lines)}"
    # Each line must be intact (no mixed chars)
    for line in lines[:5]:
        assert "thread=" in line and "i=" in line
    print(f"  OK; {len(lines)} lines, no torn writes")


if __name__ == "__main__":
    _basic_test()
    _level_filtering()
    _hierarchy_propagation()
    _json_formatter()
    _async_handler()
    _async_overflow_drops()
    _concurrent_writers()
    print("\nAll tests passed.")
```

### How to run

```bash
python3 ~/Downloads/cc/kb/LLD/Python/logging-service.py
```

---

## 11. Cross-Questions ("Why X and not Y") — ≥ 12

### 11.1 Why `IntEnum` for `LogLevel` and not `Enum`?

Numeric ordering. We compare `record.level >= handler.level`. `IntEnum` makes that natural. `Enum` would force explicit numeric attributes or a custom comparator.

The numeric values (10, 20, 30, 40, 50) leave gaps for future levels (e.g. `TRACE=5`, `NOTICE=25`).

### 11.2 Why does Logger walk handlers AND propagate to parent?

Match Python stdlib `logging` semantics. A child logger's record fires its own handlers, then walks up to parent, recursively. `propagate=False` stops the walk.

This lets you configure a single root handler for the whole app, while attaching specialized handlers to specific subsystems.

### 11.3 Why a Decorator (AsyncHandler) and not an "async mode" flag on Handler?

Composition. `AsyncHandler(FileHandler(...))` and `AsyncHandler(NetworkHandler(...))` work without per-handler async logic. Each handler is responsible for *its* I/O; the async wrapper provides the queue + worker.

A flag-based design would duplicate the queue/worker pattern in every handler.

### 11.4 Why drop oldest on full queue (default) and not block?

Logging must never block the application. A blocked log call freezes the request handling thread → cascading latency → site outage during a logging incident.

Drop policies:
- **Drop oldest:** prefer recent context.
- **Drop newest:** prefer to keep historical buffer.
- **Block:** safety net only when exact log capture is critical.

We default to drop-oldest; expose `drop_full=False` for blocking.

### 11.5 Why `dropped` counter and not raise on drop?

Logging never raises. Drop is monitored via stats. Users who care can poll `handler.dropped` and alert.

### 11.6 Why is the worker a daemon thread?

The worker holds the queue + worker indefinitely. If the app exits without `shutdown()`, daemon flag lets the process die — safety net.

Cost: pending log lines on exit may be lost. `shutdown()` is the proper drain.

### 11.7 Why the formatter is per-handler and not per-record?

Different sinks need different formats. Console wants human-readable text; file may want JSON for log aggregation; network handler wants protobuf.

Per-handler formatter → one record fanned out to multiple formats simultaneously.

### 11.8 Why a per-handler `Lock` and not a single global?

Each handler writes to its own sink; locks only need to serialize *that* sink's writes. Global lock would force all handlers to wait on each other unnecessarily.

For high-throughput services, this matters: console handler is slow (terminal); file handler is fast (page cache). Independent locks let them progress independently.

### 11.9 What's the failure mode if a handler raises?

We catch exceptions in `_dispatch` and `AsyncHandler._run`. **Logging must never crash the app.** A bad handler is logged-and-skipped (irony noted); other handlers continue.

In production, you'd report the dropped log via a metric.

### 11.10 Why `LogRecord` is frozen?

Immutability. The same record fans out to multiple handlers; each formatter reads it. Mutation by one handler would corrupt others.

Frozen also makes records safe to share across threads without copying.

### 11.11 Why `**kwargs` for fields and not a positional dict?

Ergonomics. `log.info("event", user_id=42, ms=10)` reads naturally. A dict argument forces `log.info("event", {"user_id": 42, "ms": 10})` — noisier.

Internally we still capture as a dict.

### 11.12 What about thread-local context (e.g. trace_id)?

Add `contextvars.ContextVar` for context. `Logger._log` reads it and merges into `record.fields`.

```python
from contextvars import ContextVar
trace_id = ContextVar("trace_id", default=None)
# In _log:
fields = {**kwargs, "trace_id": trace_id.get()}
```

Out of scope for base; clean addition.

### 11.13 What about file rotation?

Add a `RotatingFileHandler` that rotates by size or time. Implementation: track bytes-written; on threshold, close + rename (`app.log.1`) + reopen.

Stdlib `logging.handlers.RotatingFileHandler` is the reference. Out of scope; same pattern.

### 11.14 Why does `LogManager.get_logger` create intermediate loggers?

To make `app.db.queries` a child of `app.db`, which is a child of `app`. Without intermediates, `app.db.queries` would jump to root, breaking propagation.

Cost: many loggers exist even if unused. Each is ~200 bytes. Negligible.

### 11.15 What's the failure mode under high QPS?

Async handler queue fills → drops increment → monitoring alerts. If sustained, options:
- Increase queue size (memory cost).
- Sample (1 in N).
- Reduce log volume at source (bump level).
- Add more workers (per-sink parallelism).

### 11.16 Why not use the stdlib `logging` module?

For an interview, the question is "build it." Stdlib `logging` has 30 years of design baggage; rolling our own teaches the principles.

In production: ALWAYS use stdlib logging or a battle-tested lib (loguru, structlog). Never roll your own for production.

### 11.17 What's the difference between propagate=False and removing the handler?

`propagate=False` keeps the logger's own handlers but stops the upward walk. Removing the handler removes one of the logger's own emit targets but propagation still happens.

You'd use `propagate=False` when you want a subsystem to handle its logs locally and NOT pollute the root logger.

---

## 12. Extensions

### 12.1 Sampling
A `SamplingHandler` decorator drops `(N-1)/N` records.

### 12.2 Rate limiting
A `RateLimitHandler` decorator that drops records after N/sec.

### 12.3 Network sinks (HTTP, syslog, UDP)
New Handler subclasses; same interface. Wrap in AsyncHandler for non-blocking I/O.

### 12.4 File rotation (size/time)
`RotatingFileHandler` with size threshold; renames old files.

### 12.5 Structured fields with type hints
Allow non-string values; format via JSONFormatter; sanitize for text formatter.

### 12.6 Context propagation (trace_id)
`contextvars.ContextVar` read in `_log`; merged into fields.

### 12.7 Multi-process safety
Switch FileHandler to use `fcntl` flock (UNIX); on Windows use `msvcrt`. Or queue all writes to a single owner process.

---

## 13. Cheat-Sheet Recap

1. **Problem:** Pluggable, hierarchical, async-capable logger with multiple sinks.
2. **Core entities:** Logger, LogRecord, Handler, Formatter, LogManager.
3. **Patterns:** Strategy (handler/formatter), Decorator (AsyncHandler), Chain of Responsibility (parent propagation), Producer-Consumer (async queue).
4. **Hardest design call:** Async wrapper as decorator (composes with any handler).
5. **Concurrency:** Per-handler lock (sync) + queue (async); never block caller.
6. **Trade-offs:** Drop-on-full vs block; choose based on app criticality.
7. **Open extensions:** rotation, sampling, rate limit, context vars.

---

## Appendix A: Test cases

```
1. Sync logger writes to handler.
2. Level filter on handler suppresses below threshold.
3. Hierarchy: child logs → parent + own handlers.
4. JSONFormatter produces valid JSON.
5. AsyncHandler buffers + flushes 100 messages.
6. AsyncHandler drops on overflow with slow inner.
7. 8 concurrent writers → 400 lines, no torn writes.
8. Shutdown drains async queue.
9. Removing a handler stops dispatch to it.
10. Nested logger names create intermediate parents.
```

## Appendix B: Common Python-specific gotchas

```
- queue.Queue is thread-safe; queue.Queue.put/get are atomic.
- threading.Lock is not re-entrant; threading.RLock is — choose based on need.
- file IO with buffering=1 (line buffering) for tail-friendly logs.
- json.dumps with default=str handles non-serializable values (datetime, custom).
- daemon threads can be killed at exit — call shutdown() to drain.
- contextvars for thread-safe per-request state (Py 3.7+).
```

## Appendix C: Why this question is loved by interviewers

```
- Tests pluggable design (Strategy, Decorator, Composite).
- Concurrency surfaces immediately (multi-thread loggers).
- Async/buffer pattern is real production design.
- Hierarchical naming is subtle (test of attention).
- Easy to extend (rotation, sampling, network) — open-ended.
```

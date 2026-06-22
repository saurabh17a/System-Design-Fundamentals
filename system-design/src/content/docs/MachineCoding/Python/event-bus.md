# Event Bus / Pub-Sub — Machine Coding (Python)

> **Difficulty:** Medium
> **Tags:** `[mc]` `[concurrency]` `[observer]` `[backpressure]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

Imagine an office with a public bulletin board. People post notes on it ("project deadline moved to Friday!"); anyone who cares can read it. Code can do the same: one part of your system **publishes** events ("user signed up"); other parts **subscribe** to those events and react. The bulletin board in the middle is the **event bus**.

### Why solve it?

- **Real world**: in-process event buses (Python's blinker, Go's bus libraries), inter-process via Kafka/Redis pub-sub. Decouples producers from consumers.
- **Teaches**: observer pattern, concurrency, backpressure (what if a slow subscriber can't keep up?).
- **Interview**: tests handling slow consumers gracefully — drop, block, or buffer?

### Vocabulary

- **Topic / channel** — a named "category" of events.
- **Publisher** — code that emits events.
- **Subscriber** — code that receives events for a topic.
- **Backpressure** — when consumers are slower than producers; system must decide what to do.
- **At-least-once / at-most-once** — delivery guarantees.

### High-level approach

A `Bus` holds a `dict[topic, list[subscriber_callback]]`.

**subscribe(topic, fn)**: append to the list.
**publish(topic, event)**: call every callback. But wait — synchronous calls would block the publisher. Solution: each subscriber gets its own queue and worker thread. `publish` puts the event in each subscriber's queue.

When a subscriber's queue is full → backpressure. Choose: block publisher, drop event, or evict oldest. Trade-offs.

### How to read this doc

- **Beginner**: focus on the basic pub-sub flow, ignore backpressure on first pass.
- **Interview**: backpressure handling is the differentiator.

---

## 0. Why this question

Tests **observer pattern at scale + backpressure handling**. Real systems: event bus inside microservice, in-process domain events.

---

## 1. Problem Statement

In-process event bus:
- Publishers emit events on a topic.
- Subscribers receive events.
- Topic-based routing.
- Sync delivery + async option.
- Slow subscriber doesn't block publishers (backpressure).

---

## 2. Approach

```
EventBus
  topics: dict[str → list[Subscriber]]
  
publish(topic, event):
  for sub in topics[topic]:
     sub.deliver(event)

Subscriber:
  callback: Callable
  delivery: SYNC or ASYNC (queue + worker)
```

---

## 3. Code

```python
"""In-process event bus with sync + async delivery."""
import queue
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Generic, TypeVar, Optional

T = TypeVar("T")


@dataclass
class Subscription(Generic[T]):
    topic: str
    callback: Callable[[T], None]
    is_async: bool
    queue_size: int = 100
    queue: Optional[queue.Queue] = None
    worker: Optional[threading.Thread] = None
    dropped: int = 0


class EventBus(Generic[T]):
    def __init__(self) -> None:
        self._subs: dict[str, list[Subscription[T]]] = {}
        self._lock = threading.RLock()
        self._closed = False

    def subscribe(self, topic: str, callback: Callable[[T], None],
                  is_async: bool = False, queue_size: int = 100) -> Subscription[T]:
        with self._lock:
            if self._closed:
                raise RuntimeError("bus closed")
            sub = Subscription(topic=topic, callback=callback,
                               is_async=is_async, queue_size=queue_size)
            if is_async:
                sub.queue = queue.Queue(maxsize=queue_size)
                sub.worker = threading.Thread(target=self._worker, args=(sub,), daemon=True)
                sub.worker.start()
            self._subs.setdefault(topic, []).append(sub)
            return sub

    def unsubscribe(self, sub: Subscription[T]) -> None:
        with self._lock:
            if sub.topic in self._subs:
                self._subs[sub.topic] = [s for s in self._subs[sub.topic] if s is not sub]
        if sub.is_async and sub.queue is not None:
            sub.queue.put(_SENTINEL)

    def publish(self, topic: str, event: T) -> None:
        with self._lock:
            subs = list(self._subs.get(topic, []))
        for sub in subs:
            if sub.is_async:
                try:
                    sub.queue.put_nowait(event)
                except queue.Full:
                    sub.dropped += 1
            else:
                try:
                    sub.callback(event)
                except Exception:
                    pass  # don't let one bad sub kill all

    def close(self) -> None:
        with self._lock:
            self._closed = True
            for subs in self._subs.values():
                for sub in subs:
                    if sub.is_async and sub.queue is not None:
                        sub.queue.put(_SENTINEL)
            self._subs.clear()

    def _worker(self, sub: Subscription[T]) -> None:
        while True:
            item = sub.queue.get()
            if item is _SENTINEL:
                return
            try:
                sub.callback(item)
            except Exception:
                pass


_SENTINEL = object()


# ─── Tests ───

def _basic_sync():
    print("--- sync delivery ---")
    bus = EventBus[int]()
    received: list[int] = []
    bus.subscribe("ticks", received.append)
    for i in range(5):
        bus.publish("ticks", i)
    assert received == [0, 1, 2, 3, 4]
    bus.close()
    print("  OK")


def _multiple_subs():
    print("--- multiple subscribers ---")
    bus = EventBus[str]()
    a, b = [], []
    bus.subscribe("topic", a.append)
    bus.subscribe("topic", b.append)
    bus.publish("topic", "hello")
    assert a == ["hello"]
    assert b == ["hello"]
    bus.close()
    print("  OK")


def _topic_isolation():
    print("--- topic isolation ---")
    bus = EventBus[str]()
    a, b = [], []
    bus.subscribe("foo", a.append)
    bus.subscribe("bar", b.append)
    bus.publish("foo", "x")
    bus.publish("bar", "y")
    assert a == ["x"]
    assert b == ["y"]
    bus.close()
    print("  OK")


def _async_delivery():
    print("--- async delivery ---")
    bus = EventBus[int]()
    received: list[int] = []
    received_lock = threading.Lock()
    def cb(v):
        time.sleep(0.005)
        with received_lock:
            received.append(v)
    sub = bus.subscribe("topic", cb, is_async=True, queue_size=100)
    for i in range(50):
        bus.publish("topic", i)
    # publish doesn't block
    time.sleep(0.5)  # let worker drain
    assert len(received) == 50
    bus.close()
    print("  OK")


def _slow_consumer_drops():
    print("--- slow consumer drops on overflow ---")
    bus = EventBus[int]()
    def slow(v):
        time.sleep(0.05)
    sub = bus.subscribe("topic", slow, is_async=True, queue_size=5)
    for i in range(100):
        bus.publish("topic", i)
    time.sleep(0.1)
    assert sub.dropped > 0
    print(f"  dropped: {sub.dropped}")
    bus.close()


def _unsubscribe():
    print("--- unsubscribe ---")
    bus = EventBus[int]()
    received = []
    sub = bus.subscribe("topic", received.append)
    bus.publish("topic", 1)
    bus.unsubscribe(sub)
    bus.publish("topic", 2)
    assert received == [1]
    bus.close()
    print("  OK")


def _sub_exception_doesnt_kill_others():
    print("--- bad subscriber doesn't kill others ---")
    bus = EventBus[int]()
    received = []
    bus.subscribe("topic", lambda x: 1/0)
    bus.subscribe("topic", received.append)
    bus.publish("topic", 42)
    assert received == [42]
    bus.close()
    print("  OK")


if __name__ == "__main__":
    _basic_sync()
    _multiple_subs()
    _topic_isolation()
    _async_delivery()
    _slow_consumer_drops()
    _unsubscribe()
    _sub_exception_doesnt_kill_others()
    print("\nAll tests passed.")
```

---

## 4. Cross-Questions

### 4.1 Why per-subscriber async queue?
- Slow subscriber must not block publish.
- Per-sub queue isolates.
- Trade: memory + worker thread per sub.

### 4.2 Why drop on full vs block?
- Block = blocks publisher (cascading).
- Drop = lossy but bounded.
- Configurable per sub.

### 4.3 What about ordering?
- Single subscriber: events delivered in order (single queue).
- Multiple subs: each sees events in order.
- Cross-topic ordering: not guaranteed.

### 4.4 Why catch exceptions in callback?
- One buggy subscriber shouldn't break the bus.
- Log + skip.

### 4.5 What about wildcard topics ("*")?
- Add prefix matching at subscribe.
- Publish iterates topics that match.

### 4.6 vs external pub/sub (Kafka, NATS)?
- Internal only; in-process.
- For cross-process: use Kafka (see HLD doc).

---

## 5. Variants
- **Pattern-matching topics** (e.g. `user.*.login`).
- **Sticky/last-value caching** (subscriber gets last published immediately).
- **Persistent** (durable queue per sub).

---

## 6. Cheat-Sheet
1. `topic → [Subscription]` map.
2. Subscriber: sync (callback called inline) or async (queue + worker).
3. Publish iterates subs; sync calls; async enqueues.
4. Drop on full queue (configurable).
5. Catch sub exceptions; isolate.

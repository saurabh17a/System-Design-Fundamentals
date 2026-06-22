# 08 — Concurrency: Threads, Async, Multiprocessing

> **Prerequisites:** all previous docs.
> **Time to read:** 30 minutes.

**Concurrency** = doing multiple things at the same time (or appearing to). Useful for: handling many network requests, processing files in parallel, keeping UIs responsive.

This doc gives you a working mental model. Mastery takes years. Don't worry if it's confusing — concurrency confuses everyone at first.

---

## Plain-English first: concurrency vs parallelism

Imagine you're a cook in a kitchen.

- **Sequential** (no concurrency): you boil pasta (10 min, just standing there watching), THEN chop vegetables (5 min), THEN make sauce (5 min). Total: 20 minutes. You wasted 10 minutes staring at a pot.
- **Concurrency**: you start the pasta boiling, and *while it boils* you chop vegetables and make the sauce. You're one cook, but you switch between tasks whenever one is "waiting". Total: ~10 minutes. You never created a clone of yourself — you just stopped wasting time standing idle.
- **Parallelism**: you hire a second cook. Now two pairs of hands are *physically* working at the same instant. Two things genuinely happen simultaneously.

The key insight beginners miss:

- **Concurrency is about structure** — dealing with many things at once by interleaving them. One worker, juggling.
- **Parallelism is about execution** — doing many things at the literal same instant. Many workers.

You can have concurrency *without* parallelism (one cook juggling). You can have parallelism *without much concurrency* (two cooks each doing one long task start to finish). Most "make my program faster" problems are really "stop wasting time waiting" problems, and those need concurrency, not necessarily parallelism.

**The precise/technical version:** In CPython, threads and `asyncio` give you *concurrency* (interleaved execution on potentially one core) — they shine when tasks spend time *blocked on I/O* (network, disk, sleeping). `multiprocessing` gives you *parallelism* (multiple OS processes, each with its own Python interpreter and its own GIL, running on multiple CPU cores at the same instant) — it shines when tasks are *CPU-bound* (crunching numbers). The reason this split exists at all is the **GIL**, explained below.

> **One-liner takeaway:** Concurrency = stop waiting; Parallelism = more hands. Pick based on whether you're *waiting* (I/O) or *computing* (CPU).

---

## Three flavors of "concurrent" in Python

| Approach | Best for | Problem with |
|---|---|---|
| **Threads** (`threading`) | I/O-bound: network, disk | CPU-bound (Python's GIL limits) |
| **Async** (`asyncio`) | I/O-bound at high scale | Library compatibility |
| **Multiprocessing** | CPU-bound: heavy compute | Memory cost, no shared state |

If your code is mostly waiting (network, disk), use **threads** or **async**. If it's mostly computing (math, image processing), use **multiprocessing**.

### How to decide in 10 seconds

Ask yourself one question: **"While this task runs, is my CPU busy or just waiting?"**

| Symptom | Diagnosis | Tool |
|---|---|---|
| Calling APIs, downloading files, querying a DB, `time.sleep` | I/O-bound (waiting) | `ThreadPoolExecutor` (simple) or `asyncio` (high scale) |
| Resizing images, parsing huge files, math, ML inference on CPU | CPU-bound (computing) | `ProcessPoolExecutor` |
| A mix | Split it | Threads/async for the I/O parts, processes for the CPU parts |
| Not sure | Measure | `time` the sequential version; try threads; if no speedup on CPU work, switch to processes |

> **One-liner takeaway:** "Waiting" work wants threads/async; "computing" work wants processes.

---

## Why this matters: the GIL

Python has a **GIL** (Global Interpreter Lock): only ONE thread runs Python bytecode at a time per process.

- For **I/O-bound work** (waiting for network/disk): threads release the GIL while waiting → real parallelism.
- For **CPU-bound work** (math): only one thread runs at a time → no speedup from threads.

For CPU work, use `multiprocessing` (separate processes, separate GILs).

### Plain-English: what the GIL actually is

Think of the GIL as a **single "talking stick"** that the whole Python process shares. Only the thread holding the talking stick is allowed to execute Python bytecode. There's exactly one stick per process, so even if you have 8 CPU cores and 8 threads, only one thread runs Python code at any instant.

Why does this exist? CPython's memory management (reference counting) isn't thread-safe by default. The GIL is a *simple, fast* way to keep the interpreter's internals consistent. The tradeoff: it caps pure-Python CPU parallelism at one core.

**Why threads still help for I/O:** when a thread does something that *waits* — `socket.recv()`, reading a file, `time.sleep()` — it *drops the talking stick* so another thread can run. So 100 threads can all be blocked on 100 network sockets simultaneously, which is a huge win. They're not *computing* at the same time, but they're all *waiting* at the same time, and waiting is the slow part.

**Why processes bypass it:** each process gets its *own* interpreter and *own* GIL. Four processes = four talking sticks = four cores genuinely running Python at once.

### Proving the GIL exists (small runnable demo)

```python
import time
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor

def cpu_burn(n):
    # Pure-Python CPU work: count down. No I/O.
    total = 0
    for _ in range(n):
        total += 1
    return total

N = 30_000_000

# Sequential baseline
start = time.perf_counter()
cpu_burn(N); cpu_burn(N)
print(f"Sequential : {time.perf_counter() - start:.2f}s")

# Two threads — GIL means NO speedup for CPU work
start = time.perf_counter()
with ThreadPoolExecutor(max_workers=2) as pool:
    list(pool.map(cpu_burn, [N, N]))
print(f"2 threads  : {time.perf_counter() - start:.2f}s")

# Two processes — separate GILs, REAL speedup
if __name__ == "__main__":
    start = time.perf_counter()
    with ProcessPoolExecutor(max_workers=2) as pool:
        list(pool.map(cpu_burn, [N, N]))
    print(f"2 processes: {time.perf_counter() - start:.2f}s")
```

Typical output on a multi-core machine (numbers vary by hardware):

```
Sequential : 2.00s
2 threads  : 2.05s   <- no improvement! GIL serialized them (slightly slower due to overhead)
2 processes: 1.05s   <- ~2x faster! Real parallelism across cores
```

> **One-liner takeaway:** Threads do NOT speed up pure-Python CPU work — that's the GIL in action; reach for processes instead.

> **Heads-up on the future:** Python 3.13 introduced an experimental **free-threaded build** (PEP 703, the "no-GIL" build, enabled with `python3.13t`). It is opt-in, not the default, and not yet production-ready in 3.13/3.14. For everything you'll do as a beginner/intermediate engineer today, **assume the GIL is present.** Don't write code that depends on it being gone.

---

## Threads — the basic concurrent unit

```python
import threading
import time

def worker(name):
    print(f"{name} starting")
    time.sleep(2)
    print(f"{name} done")

# Start two threads
t1 = threading.Thread(target=worker, args=("A",))
t2 = threading.Thread(target=worker, args=("B",))

t1.start()
t2.start()

# Wait for both
t1.join()
t2.join()

print("All done")
```

Output:
```
A starting
B starting
(2-second pause)
A done
B done
All done
```

Both threads ran "at the same time" (well, both slept at the same time — threads release GIL during I/O).

> **`.start()` vs `.run()` gotcha:** Call `.start()` to launch the function *in a new thread*. If you accidentally call `t.run()`, Python just executes `worker` *in the current thread* — synchronously, no concurrency, no error. This is a classic silent bug. Always `.start()`.

### Thread pool — easier API

```python
from concurrent.futures import ThreadPoolExecutor

def fetch(url):
    import time; time.sleep(1)
    return f"fetched {url}"

urls = ["a.com", "b.com", "c.com", "d.com"]

with ThreadPoolExecutor(max_workers=4) as pool:
    results = list(pool.map(fetch, urls))

for r in results:
    print(r)
```

Without threads: 4 seconds. With 4 threads: ~1 second.

**Why prefer the pool over raw `Thread` objects?** Three reasons:

1. **Bounded resources.** `max_workers` caps how many threads exist. Spawning 10,000 raw threads for 10,000 URLs will exhaust memory and thrash the OS scheduler. A pool reuses a fixed number of workers.
2. **Results and exceptions come back to you.** `pool.map` returns values; with raw threads you'd have to wire up a shared list or queue yourself. And if a worker raises, the exception is re-raised when you read the result (see gotcha below).
3. **Automatic cleanup.** The `with` block calls `shutdown(wait=True)` for you — it waits for all tasks, no manual `.join()` per thread.

### `map` vs `submit` — two ways to use a pool

`map` is great when you have a list of inputs and want results in order. `submit` gives you a `Future` per task, which you can complete in *any* order with `as_completed` — useful when some tasks finish much faster than others and you want to react immediately.

```python
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

def fetch(url, delay):
    time.sleep(delay)
    return f"{url} (took {delay}s)"

jobs = {"slow.com": 3, "fast.com": 1, "medium.com": 2}

with ThreadPoolExecutor(max_workers=3) as pool:
    # submit returns a Future immediately; we tag each with its url
    futures = {pool.submit(fetch, url, d): url for url, d in jobs.items()}
    for fut in as_completed(futures):           # yields in COMPLETION order
        print("done:", fut.result())            # .result() returns value or re-raises
```

Output (fast finishes first, even though it was submitted second):
```
done: fast.com (took 1s)
done: medium.com (took 2s)
done: slow.com (took 3s)
```

> **One-liner takeaway:** Use `map` for ordered results from a list; use `submit` + `as_completed` to process whichever task finishes first.

### Gotcha: exceptions in pooled tasks are silent until you read the result

```python
from concurrent.futures import ThreadPoolExecutor

def risky(x):
    if x == 2:
        raise ValueError("boom on 2")
    return x * 10

# WRONG assumption: "if a task fails, I'll see a traceback immediately."
with ThreadPoolExecutor() as pool:
    futures = [pool.submit(risky, i) for i in range(4)]
# ...nothing printed. The exception is stored in the Future, not raised here.

# FIX: read each result so exceptions surface.
with ThreadPoolExecutor() as pool:
    futures = [pool.submit(risky, i) for i in range(4)]
    for f in futures:
        try:
            print(f.result())          # re-raises ValueError for x == 2
        except ValueError as e:
            print("caught:", e)
```

Output of the fixed version:
```
0
10
caught: boom on 2
30
```

> **One-liner takeaway:** A worker's exception hides inside its `Future` — you only see it when you call `.result()`.

---

## Locks — protecting shared data

Threads share memory. If two threads modify the same variable simultaneously, you get **race conditions**.

```python
import threading

counter = 0

def increment():
    global counter
    for _ in range(100_000):
        counter += 1     # not atomic!

t1 = threading.Thread(target=increment)
t2 = threading.Thread(target=increment)
t1.start(); t2.start()
t1.join(); t2.join()

print(counter)    # often less than 200_000!
```

`counter += 1` is actually three operations: read, add, write. Two threads can interleave and "lose" updates.

### Plain-English: what a "race condition" feels like

Two people editing the same Google Doc cell with autosave off. You read "5", I read "5". You type "6" and save. I type "6" and save over you. The cell says "6" but two increments happened — one got *lost*. That's exactly what `counter += 1` does at the bytecode level:

```text
LOAD counter   (thread A reads 5)
                              LOAD counter   (thread B also reads 5)
ADD 1          (A computes 6)
                              ADD 1          (B computes 6)
STORE counter  (A writes 6)
                              STORE counter  (B writes 6)  <- A's increment lost!
```

The bug is **nondeterministic** — it depends on exact timing, so it may pass 100 tests and fail in production. That's what makes race conditions so nasty.

### Fix: use a lock

```python
import threading

counter = 0
lock = threading.Lock()

def increment():
    global counter
    for _ in range(100_000):
        with lock:
            counter += 1

t1 = threading.Thread(target=increment)
t2 = threading.Thread(target=increment)
t1.start(); t2.start()
t1.join(); t2.join()

print(counter)    # always 200_000
```

`with lock:` ensures only one thread is inside the block at a time.

> **Why `with lock:` and not `lock.acquire()` / `lock.release()`?** If the code inside raises an exception, a manual `release()` might be skipped — and the lock stays held *forever*, deadlocking every other thread. The `with` statement releases the lock even on exception. Always prefer the context manager.

### Locks have a cost

Locks serialize access, killing parallelism. Use them only where needed:
- Modifying a shared list/dict.
- Updating a counter.
- Any read-modify-write on shared state.

If you can avoid sharing state at all, do.

### `Lock` vs `RLock` — the re-entrancy trap

A plain `Lock` cannot be acquired twice by the *same* thread — doing so deadlocks the thread against itself. This bites you when a locked method calls another locked method.

```python
import threading

lock = threading.Lock()

def outer():
    with lock:
        inner()        # inner also wants the lock...

def inner():
    with lock:         # SAME thread tries to acquire again -> hangs forever
        print("work")

# outer()  # would deadlock

# FIX: use RLock (reentrant lock) — the owning thread may re-acquire it.
rlock = threading.RLock()

def outer2():
    with rlock:
        inner2()

def inner2():
    with rlock:        # OK: same thread already owns it, count just increments
        print("work")

outer2()   # prints: work
```

> **One-liner takeaway:** If a lock-holding function calls another function that grabs the same lock, you need `RLock`, not `Lock`.

### What is "atomic" anyway? (and why GIL ≠ thread-safety)

A common myth: "the GIL makes my code thread-safe." It does **not**. The GIL guarantees one *bytecode* runs at a time, but `counter += 1` is *multiple* bytecodes, and the GIL can switch threads between them. Operations that *are* effectively atomic (single bytecode, like `list.append(x)` or `dict[k] = v`) are safe; multi-step read-modify-write is not. When in doubt, lock — or use a structure built for concurrency (`queue.Queue`, see below).

---

## `asyncio` — async/await

Different model: cooperative multitasking. Tasks yield control with `await`.

```python
import asyncio

async def fetch(url):
    print(f"start {url}")
    await asyncio.sleep(1)    # like time.sleep but yields control
    print(f"done {url}")
    return f"data from {url}"

async def main():
    results = await asyncio.gather(
        fetch("a.com"),
        fetch("b.com"),
        fetch("c.com"),
    )
    print(results)

asyncio.run(main())
```

Three "fetches" complete in 1 second total (not 3). They share one thread but interleave at `await` points.

### Plain-English: cooperative vs preemptive

- **Threads are preemptive:** the OS can pause a thread *anywhere*, even mid-`counter += 1`. You don't control when. That's why you need locks.
- **`asyncio` is cooperative:** a coroutine runs until *it* chooses to pause, which only happens at an `await`. Between `await`s, no other coroutine can sneak in. This makes a lot of race conditions impossible — but it also means **one badly-behaved coroutine can hog the whole event loop.**

The **event loop** is the single juggler. Each `await` is the coroutine saying "I'm about to wait — go run someone else, wake me when my data's ready." If a coroutine does heavy CPU work with no `await`, the juggler is stuck and everything else freezes.

### The cardinal `asyncio` sin: blocking the event loop

```python
import asyncio, time

async def bad():
    print("start")
    time.sleep(3)          # WRONG: blocks the ENTIRE event loop for 3s
    print("end")

async def heartbeat():
    for _ in range(6):
        print("tick")
        await asyncio.sleep(0.5)

async def main():
    await asyncio.gather(bad(), heartbeat())

asyncio.run(main())
```

You'd hope to see ticks interleaved, but you get:
```
start
(3 second total freeze — NO ticks)
end
tick
tick
... (the heartbeat only runs after bad() finishes)
```

`time.sleep` doesn't yield to the loop. **Fix:** use `await asyncio.sleep(3)` for waiting, or push genuine CPU/blocking work to a thread with `await asyncio.to_thread(blocking_fn, ...)`.

```python
async def good():
    print("start")
    await asyncio.to_thread(time.sleep, 3)   # runs blocking call off the loop
    print("end")
```

> **One-liner takeaway:** Never call a *blocking* function (regular `time.sleep`, `requests.get`, heavy CPU loops) directly inside a coroutine — use the `await`-able equivalent or `asyncio.to_thread`.

### Tasks vs coroutines: a coroutine doesn't run until awaited/scheduled

```python
import asyncio

async def work(n):
    await asyncio.sleep(1)
    return n * 2

async def main():
    # Calling work(5) does NOT start it. It just creates a coroutine object.
    coro = work(5)
    print(type(coro))            # <class 'coroutine'>

    # To actually run concurrently, schedule it as a Task:
    task = asyncio.create_task(work(10))   # starts running in the background now
    other = await work(20)                  # this one runs/awaits inline
    result = await task                     # await the backgrounded task's result
    print(other, result)                    # 40 20

asyncio.run(main())
```

> **One-liner takeaway:** A bare `coro = foo()` is inert; use `await foo()` to run it inline or `asyncio.create_task(foo())` to run it concurrently.

### Modern structured concurrency: `TaskGroup` (Python 3.11+)

`asyncio.gather` is fine, but `TaskGroup` is the modern, safer idiom: if any task fails, siblings are cancelled and you get a clean `ExceptionGroup`. It also guarantees all tasks are awaited before the block exits (no "I forgot to await a task" leaks).

```python
import asyncio

async def job(name, delay):
    await asyncio.sleep(delay)
    return f"{name} ok"

async def main():
    async with asyncio.TaskGroup() as tg:        # 3.11+
        t1 = tg.create_task(job("A", 1))
        t2 = tg.create_task(job("B", 2))
    # On exit, both are guaranteed complete.
    print(t1.result(), t2.result())

asyncio.run(main())   # prints: A ok B ok
```

> **One-liner takeaway:** On Python 3.11+, prefer `async with asyncio.TaskGroup()` over manual `gather` for clearer error handling and no leaked tasks.

### When async vs threads?

- **Async**: massive scale (1000s of concurrent network requests), explicit control.
- **Threads**: simpler, work with most existing libraries.
- **Async libraries needed**: most stdlib is sync. For HTTP: `aiohttp` instead of `requests`. For DB: `asyncpg` instead of `psycopg2`.

For most beginner needs, threads are easier.

**The "async is colored" problem (why you can't just sprinkle `async` everywhere):** Once a function is `async`, everything that calls it must `await` it, which means *those* callers must be `async` too, all the way up to `asyncio.run`. Async "infects" your call stack. This is why mixing a synchronous codebase with async is painful and why threads are often the pragmatic choice for an existing sync app. Don't rewrite a working threaded app into async without a concrete scale reason.

---

## Multiprocessing — true parallelism for CPU work

```python
from concurrent.futures import ProcessPoolExecutor

def heavy_compute(n):
    # something CPU-intensive
    return sum(i * i for i in range(n))

if __name__ == "__main__":
    with ProcessPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(heavy_compute, [10**6, 2*10**6, 3*10**6, 4*10**6]))
    print(results)
```

4 cores → 4 simultaneous Python processes → real parallel CPU work.

**Caveats:**
- Each process has its own memory (no shared state).
- Data passed to workers is copied (pickled).
- Process startup is slow.

Reach for multiprocessing only when CPU is the bottleneck.

### Why `if __name__ == "__main__":` is mandatory here

On Windows and macOS (default since Python 3.8 on macOS), new processes are created with the **spawn** method: the child process *re-imports your script from the top* to find the worker function. If your pool-creating code runs at module top level (not guarded), each child would *re-create the pool*, which re-creates children, which re-import... an infinite fork-bomb that crashes with `RuntimeError: An attempt has been made to start a new process before the current process has finished its bootstrapping phase`.

```python
# WRONG — no guard. Crashes on spawn platforms.
from concurrent.futures import ProcessPoolExecutor
with ProcessPoolExecutor() as pool:        # runs again in every child on import!
    print(list(pool.map(abs, [-1, -2, -3])))

# RIGHT — guarded so child re-imports don't re-run the pool code.
from concurrent.futures import ProcessPoolExecutor
def main():
    with ProcessPoolExecutor() as pool:
        print(list(pool.map(abs, [-1, -2, -3])))
if __name__ == "__main__":
    main()
```

> **One-liner takeaway:** Always guard process-pool code under `if __name__ == "__main__":` — without it, spawn-based platforms fork-bomb on import.

### Gotcha: everything must be picklable

Data and functions sent to worker processes are serialized with `pickle`. Lambdas, local (nested) functions, open file handles, DB connections, and sockets are **not** picklable.

```python
from concurrent.futures import ProcessPoolExecutor

# WRONG — a lambda can't be pickled, so it can't cross the process boundary.
if __name__ == "__main__":
    with ProcessPoolExecutor() as pool:
        # PicklingError / "Can't pickle <lambda>"
        print(list(pool.map(lambda x: x * x, [1, 2, 3])))

# RIGHT — use a module-level (top-level) function instead.
def square(x):
    return x * x

if __name__ == "__main__":
    with ProcessPoolExecutor() as pool:
        print(list(pool.map(square, [1, 2, 3])))   # [1, 4, 9]
```

> **One-liner takeaway:** Process workers can only receive *picklable* things — define worker functions at module top level, never as lambdas or closures.

### Gotcha: tiny tasks are slower in parallel

Because each task's input and output must be pickled, shipped to another process, and unpickled, the *overhead per task* can dwarf the work. Multiprocessing wins only when each task does *meaningful* CPU work.

```python
from concurrent.futures import ProcessPoolExecutor

def add_one(x):
    return x + 1

# Sending a million trivial tasks across processes is FAR slower than a plain loop,
# because pickling + IPC overhead >> the cost of `x + 1`.
# Sequential here would be milliseconds; the process pool below can take seconds.
if __name__ == "__main__":
    with ProcessPoolExecutor() as pool:
        # chunksize batches many inputs per IPC round-trip, cutting overhead
        result = list(pool.map(add_one, range(1_000_000), chunksize=10_000))
    print(result[:5], "...", len(result), "items")
```

> **One-liner takeaway:** Multiprocessing pays off only for *coarse* CPU tasks; for many tiny tasks the pickling/IPC overhead makes it slower than a sequential loop (use `chunksize` to amortize).

---

## Common concurrency pitfalls

### 1. Race conditions (already covered)

Always lock shared mutable state.

### 2. Deadlock — two threads waiting forever

```python
lock_a = threading.Lock()
lock_b = threading.Lock()

def thread1():
    with lock_a:
        with lock_b:
            ...

def thread2():
    with lock_b:    # opposite order
        with lock_a:
            ...
```

If thread1 has lock_a and waits for lock_b, while thread2 has lock_b and waits for lock_a — frozen forever.

**Fix:** always acquire locks in the same order across all threads.

**Plain-English:** It's two people at a narrow doorway, each politely insisting "you go first" — both wait, nobody moves. The four classic conditions for deadlock (Coffman conditions) are: mutual exclusion, hold-and-wait, no preemption, and circular wait. Breaking *any one* prevents deadlock; enforcing a **global lock ordering** breaks the circular-wait condition, which is the easiest to control in practice. A defensive alternative is `lock.acquire(timeout=...)` so a stuck thread gives up instead of hanging forever.

### 3. Forgetting to call `.join()`

```python
t = threading.Thread(target=worker)
t.start()
# main thread continues; if main exits, daemon thread dies abruptly
```

Either `t.join()` or set `t.daemon = True` consciously.

### 4. Sharing too much

The more shared mutable state, the harder to reason about. Prefer:
- Pass arguments to workers; collect results back.
- Use queues (`queue.Queue`) instead of shared lists.

### 5. Confusing "I/O-bound" vs "CPU-bound"

Try threads first. If it doesn't speed up CPU-bound work, switch to multiprocessing.

### 6. Setting `max_workers` blindly

More workers is not always faster. For CPU-bound work, more processes than CPU cores just causes context-switching overhead — a good default is `os.cpu_count()`. For I/O-bound work you can go much higher (dozens to low hundreds) since workers mostly wait, but each thread costs memory and the target service may rate-limit you. Start with a modest number, measure, then tune.

```python
import os
from concurrent.futures import ProcessPoolExecutor
print("cores available:", os.cpu_count())
# CPU-bound default: don't exceed core count
# with ProcessPoolExecutor(max_workers=os.cpu_count()) as pool: ...
```

> **One-liner takeaway:** Size CPU pools to `os.cpu_count()`; size I/O pools higher but measure — bigger isn't automatically faster.

---

## Useful primitives

### `queue.Queue` — thread-safe FIFO

```python
import queue
import threading

q = queue.Queue()

def producer():
    for i in range(5):
        q.put(f"item-{i}")
    q.put(None)    # sentinel

def consumer():
    while True:
        item = q.get()
        if item is None:
            break
        print(f"got {item}")

t1 = threading.Thread(target=producer)
t2 = threading.Thread(target=consumer)
t1.start(); t2.start()
t1.join(); t2.join()
```

Queue handles thread-safety internally. No locks needed.

**Why queues are the preferred pattern:** instead of multiple threads poking at one shared list (which needs careful locking), you have producers *hand off* items and consumers *pick them up*. Ownership of each item moves cleanly from one thread to another, so there's no simultaneous access to protect. This "share by communicating, don't communicate by sharing" style eliminates a whole class of race conditions. `queue.Queue` also supports `maxsize=` for backpressure (a full queue blocks producers, preventing a fast producer from exhausting memory).

### `threading.Event` — signal between threads

```python
event = threading.Event()

def waiter():
    print("waiting...")
    event.wait()       # blocks until set
    print("got signal!")

t = threading.Thread(target=waiter)
t.start()
import time
time.sleep(2)
event.set()    # signals all waiters
t.join()
```

### `threading.Semaphore` — limit how many at once

A `Lock` allows *one* holder. A `Semaphore(N)` allows *N* holders — perfect for "let at most N threads hit this resource simultaneously" (e.g., don't open more than 5 connections to a fragile API).

```python
import threading, time

# Allow at most 2 threads in the "critical zone" at once.
sema = threading.Semaphore(2)

def access(name):
    with sema:
        print(f"{name} entered")
        time.sleep(1)
        print(f"{name} leaving")

threads = [threading.Thread(target=access, args=(f"T{i}",)) for i in range(5)]
for t in threads: t.start()
for t in threads: t.join()
```

You'll see at most two "entered" lines before a "leaving" line appears.

> **One-liner takeaway:** Use `Semaphore(N)` to cap concurrency to N (e.g. limiting concurrent connections), and `Lock` when N is exactly 1.

### `threading.Condition` — wait for a condition

For signaling complex states. We use it in our `MachineCoding/Python/bounded-buffer.md` doc.

---

## Worked example: parallel URL fetcher

```python
import time
from concurrent.futures import ThreadPoolExecutor

def fetch(url):
    # simulate slow network
    time.sleep(1)
    return f"fetched {url}"

urls = [f"site{i}.com" for i in range(10)]

# Sequential: ~10 seconds
start = time.time()
sequential = [fetch(u) for u in urls]
print(f"Sequential: {time.time() - start:.1f}s")

# Parallel: ~1 second
start = time.time()
with ThreadPoolExecutor(max_workers=10) as pool:
    parallel = list(pool.map(fetch, urls))
print(f"Parallel: {time.time() - start:.1f}s")
```

For "embarrassingly parallel" tasks (independent, I/O-bound), `ThreadPoolExecutor.map` is the easiest big win.

### Same job in `asyncio`, for comparison

```python
import asyncio, time

async def fetch(url):
    await asyncio.sleep(1)            # stand-in for an async HTTP call (aiohttp)
    return f"fetched {url}"

async def main():
    urls = [f"site{i}.com" for i in range(10)]
    start = time.perf_counter()
    results = await asyncio.gather(*(fetch(u) for u in urls))
    print(f"Async: {time.perf_counter() - start:.1f}s, {len(results)} fetched")

asyncio.run(main())   # Async: 1.0s, 10 fetched
```

Same ~1s result, no threads, one event loop. With *real* HTTP you'd swap the `asyncio.sleep` for an `aiohttp` request. The async version scales to thousands of concurrent fetches more cheaply than thousands of threads (each thread carries an OS stack; a coroutine is just a Python object).

> **One-liner takeaway:** Threads and async both turn 10s of sequential I/O into ~1s; async wins at the high end (thousands of concurrent waits) because coroutines are far cheaper than OS threads.

---

## Common mistakes

**1. Modifying shared state without locks.**
Race conditions are silent — your code "works" but produces wrong results occasionally.

**2. Holding locks too long.**
```python
with lock:
    data = fetch_from_network()    # might take seconds!
    process(data)
```
Other threads block. Pull data out first, then enter lock briefly.

```python
# FIX: do the slow part outside the lock; only the shared mutation is protected.
data = fetch_from_network()        # slow, but touches no shared state
with lock:
    shared_results.append(data)    # fast, exclusive
```

**3. Daemon threads dying mid-work.**
On main exit, daemon threads die immediately. Important work might be lost. Use `.join()` to wait.

**4. Mixing sync and async naively.**
You can't `await` in a sync function or just call an async function from sync code. Bridges exist but require care.

```python
import asyncio

async def get_data():
    await asyncio.sleep(0.1)
    return 42

# WRONG: calling a coroutine from sync code does nothing useful.
def sync_caller_wrong():
    result = get_data()            # creates a coroutine object, never runs it
    print(result)                  # <coroutine object ...>  (+ a RuntimeWarning)

# RIGHT: from plain sync code with no running loop, bridge via asyncio.run.
def sync_caller_right():
    result = asyncio.run(get_data())   # starts a loop, runs to completion, returns 42
    print(result)                      # 42

sync_caller_right()
```

(Note: `asyncio.run` is for *entering* async from sync code that has **no** loop running. Calling it from *inside* an already-running loop raises `RuntimeError` — there, use `await` or `asyncio.to_thread` instead.)

**5. Premature optimization.**
Concurrency is hard. If your code is fast enough sequential, leave it sequential.

**6. Iterating/mutating a shared collection across threads.**
Even "atomic" `dict`/`list` ops don't make a multi-step *iteration* safe — another thread mutating mid-iteration can raise `RuntimeError: dictionary changed size during iteration` or skip elements. Lock around the whole read, or pass a copy to each worker.

---

## When to reach for what

```
Network requests / API calls?     → ThreadPoolExecutor or asyncio
Reading many files?                → ThreadPoolExecutor
Heavy math / image processing?    → ProcessPoolExecutor
GUI app?                          → asyncio or framework's event loop
Web server?                       → framework handles it (Django, Flask, FastAPI)
```

Most apps need only `ThreadPoolExecutor` for speedups.

### When NOT to use concurrency at all

- **The task is fast enough sequential.** Concurrency adds bugs, complexity, and debugging pain. Profile first; optimize the thing that's actually slow.
- **The work is a single, indivisible sequential dependency** (step B needs step A's full output). Nothing to overlap.
- **You'd share lots of mutable state.** If you can't cleanly hand off ownership, the locking complexity may cost more than the speedup.
- **A simpler tool already solved it.** A web framework's worker model, a database's connection pool, or `numpy`'s vectorized C loops (which release the GIL and parallelize internally) often beat hand-rolled threads.
- **You're CPU-bound but the data doesn't fit / can't be pickled.** Multiprocessing's copy cost can erase the gains; sometimes a better algorithm or a native library is the real fix.

---

## Cross-questions an interviewer or reviewer will ask

**Q: Why doesn't adding threads speed up my CPU-bound number-crunching?**
A: The GIL. Only one thread executes Python bytecode at a time per process. CPU work never releases the GIL voluntarily, so threads just take turns on one core. Use `ProcessPoolExecutor` for CPU work.

**Q: If the GIL exists, why does anyone use threads in Python at all?**
A: Because I/O-bound code spends most of its time *blocked* (waiting on a socket, disk, sleep), and blocked threads *release* the GIL. So many threads can wait concurrently — the slow part (waiting) overlaps perfectly. Threads are great for I/O, useless for CPU.

**Q: `asyncio` vs threads — when would you pick which?**
A: Threads: simpler, work with existing synchronous libraries (`requests`, `psycopg2`), good up to maybe hundreds of concurrent tasks. `asyncio`: better at very high concurrency (thousands+) because coroutines are far lighter than OS threads, and it gives explicit control over scheduling — but it requires async-aware libraries (`aiohttp`, `asyncpg`) and "infects" the call stack with `async`/`await`. Pick threads for a quick win in a sync codebase; pick async for a high-scale I/O service.

**Q: Does the GIL make my code thread-safe?**
A: No. It guarantees one *bytecode* at a time, but most operations (like `x += 1`) span several bytecodes, and the interpreter can switch threads in between. You still need locks (or thread-safe structures like `queue.Queue`) for read-modify-write on shared state.

**Q: Why `multiprocessing` over `threading` for CPU, given processes are heavier?**
A: Each process has its own interpreter and its own GIL, so they truly run in parallel across cores. The cost is real (process startup, memory duplication, pickling data across the boundary), so it's worth it only when the per-task CPU work is large enough to dwarf that overhead.

**Q: Why prefer a queue over a shared list guarded by a lock?**
A: A queue *encapsulates* the locking and models clean handoff of ownership ("share by communicating"). It's harder to misuse, supports backpressure via `maxsize`, and removes the temptation to read/write shared state from multiple threads directly.

**Q: What is a deadlock and how do you prevent it?**
A: Two+ threads each holding a lock the other needs, waiting forever. Prevent by acquiring locks in a consistent global order (breaks circular wait), keeping critical sections small, or using `acquire(timeout=...)` so a stuck thread backs off.

**Q: `Lock` vs `RLock`?**
A: A `Lock` deadlocks if the *same* thread tries to acquire it twice (e.g., a locked method calling another locked method). An `RLock` (reentrant) lets the owning thread re-acquire it, releasing only when the matching number of releases happen.

**Q: Why does multiprocessing code need `if __name__ == "__main__":`?**
A: On spawn-based platforms (Windows, macOS default), child processes re-import the main module. Without the guard, the pool-creation code runs again in every child, recursively spawning processes — a fork-bomb that errors out.

**Q: Concurrency vs parallelism — define both.**
A: Concurrency is *structuring* work so multiple tasks make progress by interleaving (one core can do it). Parallelism is *executing* multiple tasks at the literal same instant (needs multiple cores/processes). Threads/async give concurrency; multiprocessing gives parallelism.

---

## Exercises

1. **Parallel sum**: split a list into 4 chunks, sum each in a process, return total.
2. **Web scraper**: download 10 URLs concurrently with `ThreadPoolExecutor`. Print order matches request order.
3. **Producer-consumer**: 1 producer thread puts numbers 0-100 into a queue; 3 consumer threads sum them. Combine results.
4. **Rate limiter**: a class that allows N calls per second. Multiple threads use it; verify rate isn't exceeded.
5. **Async HTTP**: with `aiohttp`, fetch 100 URLs concurrently.
6. **GIL demonstration**: time the same CPU-bound function run (a) sequentially, (b) in 4 threads, (c) in 4 processes. Confirm threads give no speedup and processes do.
7. **Semaphore gate**: 20 worker threads, but a `Semaphore(3)` ensures no more than 3 are ever inside a critical section at once. Add a shared counter (lock-protected) to assert the max-concurrent never exceeds 3.
8. **Deadlock then fix**: write two threads that deadlock on two locks acquired in opposite order; then fix it by enforcing a consistent acquisition order.

---

## What to read next

You're done with Python foundations! Pick a path:

```
→ Foundations/OOP/four-pillars.md          (start OOP)
→ Foundations/Programming/Go/01-getting-started.md  (learn Go)
→ MachineCoding/Python/lru-cache.md         (apply concepts)
→ MachineCoding/Python/bounded-buffer.md    (Condition variables in action — producer/consumer)
→ LLD/Python/parking-lot.md                 (object-oriented design)
```

For going deeper on concurrency specifically:
- The official `concurrent.futures`, `threading`, `asyncio`, and `multiprocessing` docs in the Python standard library reference — they have runnable examples for every primitive used here.
- David Beazley's talk "Understanding the Python GIL" — the canonical visual explanation of why threads behave the way they do.
- PEP 703 ("Making the GIL optional") if you're curious where free-threaded Python is heading.

Or check `Foundations/Roadmap.md` for full learning paths.

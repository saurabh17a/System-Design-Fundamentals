# Learning Roadmap

A guide to which docs to read in what order, depending on where you're starting and where you want to end up.

---

## What is a "learning roadmap," really? (plain English first)

Imagine you walked into the world's biggest library with no map. There are thousands of
books, some are introductions and some assume you already have a PhD, and they're shelved
in no obvious order. You'd waste days just figuring out *where to stand*. A learning
roadmap is the map. It tells you: "you are here, this is where you want to go, and these are
the doors to walk through in order."

That's all this document is — a *recommended reading order* through the rest of this
knowledge base. It is not the content itself; it is the table of contents organized by
*goal* instead of by *topic*.

**The precise version:** the KB is organized into four content tiers, and this roadmap maps
*learner profiles* onto *dependency-ordered traversals* of those tiers.

- **Foundations** — language syntax (Python, Go), OOP, SOLID, design patterns. The
  vocabulary and grammar of software.
- **LLD (Low-Level Design)** — designing a single program's classes and methods well
  (parking lot, elevator, chess). The "how do I structure *this* codebase" tier.
- **MachineCoding (MC)** — implement a non-trivial component correctly and fast under time
  pressure (LRU cache, thread pool, bloom filter). The "can you actually code it" tier.
- **HLD (High-Level Design)** — architecting *distributed* systems across many machines
  (URL shortener, Twitter feed, Uber). The "how do millions of users not melt this" tier.

The dependency relationship is roughly: **Foundations → LLD → MC → HLD**, with each tier
assuming comfort with the previous one. The paths below (A, B, C, D) are simply four
entry points into that chain depending on what you already know.

**One-line takeaway:** a roadmap converts a pile of docs into a *path* — pick your start
point, follow the arrows, don't read everything.

---

## How to actually use this page (a worked example)

A beginner asks "I learned a little Python in school — where do I start?" Here's the
literal sequence of decisions:

1. **Take the quiz below.** Q1 = "Yes" (you wrote hello world). Q2 = "No" (you don't know
   classes). The quiz routes you to **Path B**.
2. **Open Path B's first doc**, `Foundations/OOP/four-pillars.md`. Read it. Write one tiny
   class.
3. **Follow the arrows** down Path B until you hit "Apply to designs," then do *one* LLD
   problem.
4. **Re-take the quiz** when a path is done. Finishing B with confidence usually means Q3 is
   now "No → Path C."

> Expected outcome: in ~6 weeks of part-time study a Path B learner can read a class
> hierarchy, name the SOLID principle being violated in a code review, and explain why a
> `switch`-on-type smell wants the Strategy pattern.

**One-line takeaway:** the roadmap is *re-entrant* — finish a path, re-quiz, take the next.

---

## Picking a path — quick quiz

> **Q1.** Have you ever written a working program (even hello world)?
> - **No** → Start with **Path A: Absolute Beginner** (below).
> - **Yes** → Continue.
>
> **Q2.** Do you understand `class`, methods, inheritance?
> - **No** → Start with **Path B: I know syntax, learning OOP**.
> - **Yes** → Continue.
>
> **Q3.** Do you understand design patterns (Strategy, Factory, etc.)?
> - **No** → Start with **Path C: Learning patterns + design**.
> - **Yes** → **Path D: Interview / job-ready prep**.

### How to answer Q2 honestly (the "can you do it" test)

People over-rate themselves on Q2 because they've *seen* classes, not *written* them.
Use this concrete self-test instead of a gut feeling. If you can write this from scratch,
without copy-pasting, in under five minutes, answer "Yes":

```python
# Self-test for Q2: model a shape hierarchy with a method that behaves
# differently per subclass (this is inheritance + polymorphism + a method).
class Shape:
    def area(self) -> float:
        raise NotImplementedError  # subclasses must override

class Circle(Shape):
    def __init__(self, radius: float):
        self.radius = radius

    def area(self) -> float:
        return 3.14159 * self.radius * self.radius

class Square(Shape):
    def __init__(self, side: float):
        self.side = side

    def area(self) -> float:
        return self.side * self.side

shapes = [Circle(2), Square(3)]
for s in shapes:
    print(f"{type(s).__name__}: {s.area():.2f}")
```

Expected output:

```
Circle: 12.57
Square: 9.00
```

If that loop "just clicked" — same variable `s`, different `area()` runs depending on the
real type — you understand polymorphism, so answer Q2 "Yes." If `raise NotImplementedError`
or why the loop picks the right method is fuzzy, answer "No" and start Path B.

**One-line takeaway:** answer the quiz by *what you can build*, not by *what you've seen*.

---

## Path A — Absolute Beginner (3–6 months part-time)

You've never written code before, or only the very basics.

### Step 1: Pick ONE language to start (3–4 weeks)

We recommend **Python** for first-time learners — its syntax is forgiving and reads almost like English.

Go through these in order. Each takes 1–3 hours including practice.

```
Foundations/Programming/Python/01-getting-started.md
Foundations/Programming/Python/02-data-types.md
Foundations/Programming/Python/03-control-flow.md
Foundations/Programming/Python/04-functions.md
Foundations/Programming/Python/05-collections.md
```

After each doc: write your own small program using what you learned.

> **Why ONE language and not two at once?** Switching languages while you still
> don't have a "mental model of computation" doubles the syntax noise without teaching
> any new *idea*. A `for` loop is the same idea in Python and Go; learning it twice in
> parallel just means confusing `range()` with `range`. Get the idea solid in one
> language, *then* the second language is mostly a syntax diff.

A first program you can write after Step 1, exercising data types, control flow, and a
function together:

```python
def fizzbuzz(n: int) -> str:
    if n % 15 == 0:
        return "FizzBuzz"
    if n % 3 == 0:
        return "Fizz"
    if n % 5 == 0:
        return "Buzz"
    return str(n)

for i in range(1, 16):
    print(fizzbuzz(i))
```

Expected output:

```
1
2
Fizz
4
Buzz
Fizz
7
8
Fizz
Buzz
11
Fizz
13
14
FizzBuzz
```

**One-line takeaway:** if you can write FizzBuzz unaided, Step 1 has done its job.

### Step 2: Object-oriented thinking (2 weeks)

```
Foundations/Programming/Python/06-classes-and-objects.md
Foundations/OOP/four-pillars.md
```

### Step 3: Make programs robust (1 week)

```
Foundations/Programming/Python/07-error-handling.md
```

### Step 4: Concurrency basics (1 week)

```
Foundations/Programming/Python/08-concurrency.md
```

### Step 5: First applied projects (3-4 weeks)

These docs give you small, complete projects with full code:

```
LLD/Python/tic-tac-toe.md          ← simplest
LLD/Python/snake-and-ladder.md
LLD/Python/parking-lot.md
LLD/Python/vending-machine.md
MachineCoding/Python/lru-cache.md  ← classic data structure
```

### Step 6: Now learn Go (2-3 weeks)

After Python is comfortable, picking up Go is fast.

```
Foundations/Programming/Go/01-getting-started.md
   ↓ work through 01–08
Foundations/Programming/Go/08-goroutines-and-channels.md
```

Then redo one or two LLD problems in Go to feel the difference:

```
LLD/Go/parking-lot.md
LLD/Go/tic-tac-toe.md
```

### Path A gotchas (the wrong move and the fix)

- ❌ **Tutorial hell.** Watching a 10-hour video, nodding, never typing. The fix: the
  moment a doc shows a code block, *retype it yourself* (don't paste) and change one thing.
- ❌ **Skipping Step 3 (error handling) because the happy path works.** Then your first
  real project crashes on the first weird input and you don't know why. The fix: treat
  error handling as part of "done," not an optional extra.
- ❌ **Jumping to Go at week 2 because someone said it's "faster."** See the "Why ONE
  language" note above. Finish Python through Step 5 first.

**One-line takeaway for Path A:** the bottleneck is *typing reps*, not reading speed.

---

## Path B — I know syntax, learning design (1–2 months)

You can write functions and classes but don't know how to structure a real codebase.

### OOP fundamentals (1 week)

```
Foundations/OOP/four-pillars.md
Foundations/OOP/SOLID/overview.md
   ↓ then each principle in order
Foundations/OOP/SOLID/single-responsibility.md
Foundations/OOP/SOLID/open-closed.md
Foundations/OOP/SOLID/liskov-substitution.md
Foundations/OOP/SOLID/interface-segregation.md
Foundations/OOP/SOLID/dependency-inversion.md
```

### Design patterns — the building blocks (2 weeks)

Read these as a unit; they reinforce each other.

```
Foundations/DesignPatterns/strategy.md          ← start here, simplest
Foundations/DesignPatterns/factory.md
Foundations/DesignPatterns/singleton.md
Foundations/DesignPatterns/observer.md
Foundations/DesignPatterns/decorator.md
Foundations/DesignPatterns/adapter.md
Foundations/DesignPatterns/state.md
Foundations/DesignPatterns/builder.md
```

### Apply to designs (3-4 weeks)

```
LLD/Python/parking-lot.md           ← Strategy + Factory in action
LLD/Python/elevator-system.md       ← State machine
LLD/Python/file-system.md           ← Composite pattern
LLD/Python/movie-ticket-booking.md  ← Concurrency + State
LLD/Python/chess.md                 ← Polymorphism showcase
```

### Why patterns *after* SOLID, and not the reverse?

A beginner-friendly way to see it: SOLID tells you *what good structure feels like*
(small responsibilities, open to extension, depend on abstractions). Design patterns are
*named recipes that happen to produce SOLID structure*. If you learn the recipes first,
you cargo-cult them — slapping a Factory everywhere because it "looks professional." If you
learn the *principles* first, each pattern lands as "oh, this is just the
Open/Closed Principle made concrete."

Concretely, here's the smell SOLID teaches you to *feel*, and Strategy teaches you to *fix*:

```python
# SMELL: a method that grows an if/elif chain every time a new case appears.
# This violates Open/Closed — you must EDIT this function to ADD a payment type.
def pay(method: str, amount: float) -> str:
    if method == "card":
        return f"Charged ${amount} to card"
    elif method == "paypal":
        return f"Sent ${amount} via PayPal"
    elif method == "crypto":            # adding this line = editing tested code
        return f"Paid ${amount} in crypto"
    raise ValueError(f"unknown method {method}")
```

```python
# FIX (Strategy): each payment type is its own class implementing a shared interface.
# Adding a type = adding a NEW class. You never touch the existing, tested ones.
from abc import ABC, abstractmethod

class PaymentMethod(ABC):
    @abstractmethod
    def pay(self, amount: float) -> str: ...

class Card(PaymentMethod):
    def pay(self, amount: float) -> str:
        return f"Charged ${amount} to card"

class PayPal(PaymentMethod):
    def pay(self, amount: float) -> str:
        return f"Sent ${amount} via PayPal"

def checkout(method: PaymentMethod, amount: float) -> str:
    return method.pay(amount)   # no idea, and no need to know, which concrete type

print(checkout(Card(), 20))
print(checkout(PayPal(), 35))
```

Expected output:

```
Charged $20 to card
Sent $35 via PayPal
```

**One-line takeaway:** SOLID is the *why*, patterns are the *how* — learn the why first so
the how isn't blind imitation.

### Path B gotchas

- ❌ **Pattern-itis.** Forcing a Singleton/Factory/Observer into a 50-line script. The fix:
  patterns earn their complexity only when the *change they protect against actually
  happens*. A script that will never grow a second payment type doesn't need Strategy.
- ❌ **Reading all eight patterns before applying any.** They blur together. The fix: read
  Strategy, then immediately do the parking-lot LLD doc where it appears, *then* read the
  next pattern.

**One-line takeaway for Path B:** structure is judged by *how easily it changes*, not how
clever it looks.

---

## Path C — Patterns to system design (1–2 months)

You know OOP and patterns; you want to design real systems.

### Concept tour (1 week)

Skim these for vocabulary:

```
HLD/distributed-cache.md            ← consistent hashing, replication
HLD/rate-limiter.md                 ← canonical algorithms intro
HLD/url-shortener.md                ← simplest at-scale design
```

### System design problems (4-6 weeks)

Easier first:

```
HLD/url-shortener.md                ← canonical
HLD/rate-limiter.md
HLD/notification-system.md
HLD/distributed-logging.md
HLD/job-scheduler.md
```

Then harder:

```
HLD/twitter-news-feed.md            ← fan-out at scale
HLD/whatsapp.md                     ← realtime
HLD/uber.md                         ← geospatial
HLD/dropbox.md                      ← chunking + sync
HLD/payment-system.md               ← financial systems
```

### The mental shift from LLD to HLD (in plain English)

This is the step most people stumble on, so here it is explicitly. In **LLD** the hard
questions are "what classes, what methods, what's the cleanest object model" — everything
runs in *one process on one machine*. In **HLD** you assume *many machines*, and the hard
questions become totally different:

- **What breaks when a machine dies mid-request?** (one process never "half-dies.")
- **Where does the data live, and what happens when two copies disagree?** (consistency.)
- **What's the bottleneck at 10x traffic — CPU, network, the database, a single hot key?**
- **What do we trade away?** You cannot have it all; see CAP below.

The vocabulary you're skimming for in the Concept Tour is exactly this: *replication,
sharding, consistent hashing, fan-out, back-pressure, idempotency*. You're not memorizing —
you're building a word-bank so the harder docs read smoothly.

> **Cross-question an interviewer will ask: "Why not just use one giant powerful server?"**
> Answer: (1) vertical limits — there's a biggest machine you can buy, and traffic can
> exceed it; (2) availability — one machine is a single point of failure, so any maintenance
> or crash is total downtime; (3) geography — users in Tokyo and São Paulo can't both be
> close to one box. Horizontal scaling (many cheap machines) trades simplicity for
> scalability and fault tolerance. The whole HLD tier is about managing that trade.

**One-line takeaway:** LLD optimizes a clean object model on one machine; HLD optimizes
*trade-offs* across many machines that fail independently.

### Path C gotchas

- ❌ **Designing for Twitter-scale on day one.** You skip URL shortener because it's
  "too easy" and drown in fan-out. The fix: the easy docs teach the *primitives*
  (hashing, caching, a single DB) that the hard docs *assume*.
- ❌ **Listing technologies instead of reasoning.** Saying "I'll use Kafka and Redis and
  Cassandra" with no *why*. The fix: for every component, be able to answer "what does this
  buy me, and what would break without it."

**One-line takeaway for Path C:** name a trade-off, not a tech logo.

---

## Path D — Interview prep (8–12 weeks intensive)

For senior+ engineering roles. Mix of LLD, MC, HLD.

### Week 1: refresh + survey

- `Foundations/OOP/four-pillars.md` (10 min)
- `Foundations/OOP/SOLID/overview.md` (15 min)
- `Foundations/DesignPatterns/strategy.md` and `factory.md`

### Weeks 2-4: LLD + machine coding

Practice 2 problems per week. Try without looking, then read.

```
LLD/Python/parking-lot.md      (or Go)
LLD/Python/elevator-system.md
LLD/Python/movie-ticket-booking.md
LLD/Python/chess.md
LLD/Python/file-system.md
LLD/Python/inventory-management.md
MachineCoding/Python/lru-cache.md
MachineCoding/Python/thread-pool.md
MachineCoding/Python/lfu-cache.md
MachineCoding/Python/bloom-filter.md
```

### Weeks 5-8: HLD progression

```
HLD/url-shortener.md
HLD/rate-limiter.md
HLD/twitter-news-feed.md
HLD/distributed-cache.md
HLD/whatsapp.md
HLD/uber.md
HLD/dropbox.md
HLD/youtube.md
```

### Weeks 9-10: domain-specific

Pick 4-5 from the list that match your target company:

```
HLD/payment-system.md      ← if Stripe / fintech
HLD/robinhood.md           ← if trading
HLD/ticketmaster.md        ← if marketplace
HLD/google-docs.md         ← if collaboration product
HLD/linkedin.md            ← if social
HLD/ad-click-aggregator.md ← if Google / data
HLD/leetcode.md            ← if developer tools
```

### Week 11-12: mock interviews

Find a peer; give 60-min mock HLD interviews using the docs as reference.

### How interviewers actually grade (so you study the right thing)

Beginners study to *recall the answer*. Interviewers grade your *process*. A senior HLD
loop is usually scored on four axes, none of which is "did you memorize Twitter":

1. **Requirements & scoping** — did you ask about read/write ratio, scale, latency budget,
   and consistency needs *before* drawing boxes?
2. **Trade-off reasoning** — when you chose SQL vs NoSQL, push vs pull, sync vs async, did
   you say *why* and what you gave up?
3. **Handling the curveball** — the interviewer adds "now make it work across 3 regions" or
   "now a celebrity has 50M followers." Can you adapt your design instead of freezing?
4. **Communication** — could a peer follow your reasoning out loud?

Structure every HLD answer with this skeleton (memorize the *skeleton*, not the answers):

```
1. Functional requirements   — what must it DO?           (2 min)
2. Non-functional reqs       — scale, latency, consistency (2 min)
3. Capacity estimate         — QPS, storage, bandwidth      (2 min)
4. API + data model          — endpoints, key fields        (5 min)
5. High-level design         — boxes and arrows             (10 min)
6. Deep dive                 — the 1-2 hard parts           (15 min)
7. Bottlenecks & trade-offs  — what breaks, what you'd do   (5 min)
```

> **Cross-question: "Why do you keep starting with requirements? Just design it."**
> Because the *same prompt* ("design a chat app") has wildly different right answers
> depending on scale and constraints. A 1,000-user internal tool and WhatsApp are not the
> same system. Jumping to boxes signals you'll over- or under-engineer real work.

**One-line takeaway for Path D:** you're graded on *reasoning under a new constraint*, so
practice adapting, not reciting.

### Path D gotchas

- ❌ **Reading the solution before attempting.** You feel productive and learn nothing,
  because recognition ("yeah that makes sense") is not recall ("I produced it"). The fix:
  always spend 20–30 minutes solo first, *then* read.
- ❌ **Grinding only HLD because it feels "senior."** Many senior loops still include an LLD
  or machine-coding round, and bombing it sinks the loop regardless of HLD brilliance. The
  fix: keep the Weeks 2-4 muscle warm throughout.

---

## What to do AFTER finishing a doc

1. **Run the code.** Don't just read it.
2. **Modify it.** Break it. Fix it.
3. **Explain it to a friend** (or rubber duck).
4. **Solve a variant.** "What if I had to add X feature?"
5. **Move on.** Don't get stuck on perfection.

### Why "run the code" is non-negotiable (the science in one paragraph)

Reading produces *recognition* memory — you'll nod along and feel like you know it. Typing
and running produces *recall + procedural* memory — the kind you can actually reproduce under
interview pressure or on the job. This is the same reason you can recognize a thousand songs
but can only *play* the few you practiced. The "modify and break it" step is even stronger:
debugging your own broken version forces you to build a precise mental model of *why* the
working version works, which passive reading never does.

**One-line takeaway:** recognition is cheap and misleading; recall is what gets tested.

---

## How long should each doc take?

| Doc type | Read time | With practice |
|---|---|---|
| Programming foundation | 30 min | 2-4 hours |
| OOP / SOLID | 20 min | 1-2 hours |
| Design pattern | 30 min | 2-3 hours |
| LLD problem | 45 min | 3-5 hours |
| MC problem | 30 min | 1-3 hours |
| HLD problem | 60 min | 1-3 hours |

If a doc is taking 3x longer than expected, it's ok to skim and come back.

> **How to read these numbers:** "read time" is a single pass to understand; "with practice"
> is the realistic time to actually *own* it (type the code, do a variant, explain it). The
> gap between the two columns is the whole point of this KB — the value is in the right
> column, not the left.

---

## Anti-patterns: what NOT to do

- ❌ Reading every HLD doc back-to-back without practicing. Information overload.
- ❌ Trying to memorize patterns. Patterns are tools you reach for; you'll know them by use.
- ❌ Stopping at "I get it" without writing any code. Reading ≠ knowing.
- ❌ Comparing yourself to others. Pace is personal.
- ❌ Reading the answer before attempting. The struggle is where learning happens.
- ❌ **Collecting roadmaps instead of following one.** Bookmarking five different study
  plans is procrastination wearing a productive costume. Pick this one, or any one, and
  *move*. A mediocre plan executed beats a perfect plan admired.
- ❌ **Optimizing the meta-level.** Spending a weekend on the "perfect" Notion tracker / Anki
  setup / spaced-repetition system instead of finishing a single doc. Tooling is a tax you
  pay once you have a habit, not a substitute for one.

---

## Common questions

**Q: Should I start with Python or Go?**
A: Python for first-time learners — friendlier syntax. Once you know Python, picking up Go is much faster than the reverse.

**Q: Do I need to learn both?**
A: For most jobs, one is enough. For senior backend roles or interviews, knowing both is a significant advantage.

**Q: How much math do I need?**
A: For Tier 1 and 2: high school math (basic algebra). For HLD: comfort with logarithms and big-O notation. For ML system design: probability + linear algebra.

**Q: Is this enough to get a job?**
A: This is solid foundations + interview prep. You also need: project portfolio (GitHub), resume, networking. The KB is one piece.

**Q: I'm stuck on doc X. What do I do?**
A: Drop one tier. The doc probably has unstated prerequisites. Or ask in your community / Discord / Stack Overflow.

**Q: How do I know when I'm "done" with a path and should move to the next?**
A: When you can do the path's capstone *without the doc open*. For Path A that's writing a
small LLD project (e.g. tic-tac-toe) from a blank file. For Path B it's naming the pattern a
piece of code wants and refactoring toward it. For Path C/D it's walking the 7-step HLD
skeleton out loud for an unfamiliar prompt. Re-take the quiz at the top — your honest Q2/Q3
answers will have changed.

**Q: I keep "context-switching" between languages/patterns/systems and feel like I retain
nothing. Why?**
A: Almost always too much *breadth before depth*. Three half-learned topics feel like zero
because none is recallable. The fix is brutal focus: one language, then add OOP, then add
patterns — finishing each before starting the next, exactly the order the paths impose.

**Q: Do I need to memorize all the design patterns?**
A: No. Memorize the *problem each one solves* (Strategy = swap an algorithm; Observer =
notify many on a change; Factory = decide which class to build). When you hit that problem in
real code, you'll recognize the pattern and look up the mechanics. Reviewers and interviewers
care that you can *name and justify* a pattern, not recite its UML from memory.

**Q: Patterns vs SOLID — if I only had time for one, which?**
A: SOLID. The principles transfer to *every* design decision; the patterns are specific
applications of those principles. You can derive most common patterns from SOLID, but you
can't derive SOLID from a list of patterns.

---

## What to read next

You've finished the meta-doc; now jump into content. Based on your quiz result:

- **Path A →** open `Foundations/Programming/Python/01-getting-started.md`.
- **Path B →** open `Foundations/OOP/four-pillars.md`, then `Foundations/OOP/SOLID/overview.md`.
- **Path C →** open `HLD/url-shortener.md` (the canonical, gentlest at-scale design).
- **Path D →** open this week's two LLD problems and *attempt them blind* before reading.

If you're unsure, the universal safe first read is `Foundations/OOP/four-pillars.md` — it's
short, it's a prerequisite for nearly everything downstream, and it sharpens your honest
answer to the Q2 self-test above.

---

Happy learning. Pick a path, pick the first doc, start.

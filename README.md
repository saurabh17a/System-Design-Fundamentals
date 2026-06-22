# Software Engineering Knowledge Base

A learning + reference library for students, junior engineers, and interview prep.

> **Who is this for?**
> - **CS students** (undergrad/bootcamp) building foundations.
> - **Junior engineers** leveling up to mid/senior roles.
> - **Self-taught coders** filling gaps in CS fundamentals.
> - **Interview candidates** preparing for system design / coding rounds.

You don't need a CS degree to use this. Topics start from "what is a variable?" and go up to "design WhatsApp."

---

## How the bank is organized

We use **3 tiers**. Pick where you are; move up.

```
┌────────────────────────────────────────────────────────────┐
│                  Tier 1: FOUNDATIONS                        │
│  Programming basics in Python and Go.                       │
│  → Read this first if you're new to coding.                 │
└────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────┐
│                  Tier 2: CONCEPTS                           │
│  OOP principles. SOLID. Design patterns.                    │
│  → Read this once you can write basic Python or Go.         │
└────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────┐
│                  Tier 3: APPLIED (Interview-Grade)          │
│  Low-Level Design (LLD): parking lot, elevator, etc.        │
│  Machine Coding (MC): LRU cache, thread pool, etc.          │
│  High-Level Design (HLD): Twitter, Uber, WhatsApp, etc.     │
│  → Read this when prepping for interviews or work.          │
└────────────────────────────────────────────────────────────┘
```

---

## Directory layout

```
kb/
├── README.md                         ← you are here
├── Foundations/
│   ├── Roadmap.md                    ← suggested learning paths
│   ├── Programming/
│   │   ├── Python/                   ← 8 beginner-friendly Python docs
│   │   └── Go/                       ← 8 beginner-friendly Go docs
│   ├── OOP/
│   │   ├── four-pillars.md           ← Encapsulation, Abstraction, etc.
│   │   └── SOLID/                    ← 5 principles, 1 doc each
│   └── DesignPatterns/               ← 8 core patterns in Py + Go
├── HLD/                              ← system design (Twitter, Uber, etc.)
├── LLD/                              ← OOP design (parking lot, chess, etc.)
│   ├── Python/                       ← LLD answers in Python
│   └── Go/                           ← same, in Go
├── MachineCoding/                    ← data-structure / concurrency code
│   ├── Python/
│   └── Go/
├── _template/                        ← skeletons for new docs
└── INDEX.md                          ← searchable list of every doc
```

---

## Recommended learning paths

### Path A — "I'm starting from scratch" (3-6 months)

```
1. Foundations/Programming/Python/01-getting-started.md
   ↓ work through 01–08 in order
2. Foundations/OOP/four-pillars.md
3. Foundations/DesignPatterns/strategy.md   ← start with simplest pattern
   ↓ then a few more patterns
4. LLD/Python/parking-lot.md                ← apply concepts
5. LLD/Python/connect-four.md
6. MachineCoding/Python/lru-cache.md         ← data structures
```

### Path B — "I know one language, learning the other"

If you know Python and want Go:
```
Foundations/Programming/Go/* (read all 8 in order)
LLD/Go/parking-lot.md      (compare with Python version)
```

### Path C — "I'm prepping for a tech interview" (6-12 weeks)

```
Week 1-2:  Refresh OOP + SOLID
Week 3-4:  Design Patterns (cover 6+ common ones)
Week 5-6:  LLD warmups: Tic Tac Toe, Snake & Ladder, Parking Lot
Week 7-8:  LLD harder: Movie Booking, Chess, File System
Week 9:    Machine Coding: LRU, Thread Pool, Bloom Filter
Week 10-11: HLD: URL Shortener, Twitter, WhatsApp
Week 12:   HLD harder: Uber, Dropbox, Payment System
```

### Path D — "I want to learn system design (already strong programmer)"

Skip Tier 1 entirely.
```
Foundations/OOP/four-pillars.md      (10-min refresher)
Foundations/DesignPatterns/*          (skim)
HLD/url-shortener.md                  (canonical first HLD)
HLD/rate-limiter.md
HLD/twitter-news-feed.md
HLD/distributed-cache.md
   ↓ pick whichever interests you next
```

See `Foundations/Roadmap.md` for more detail.

---

## How to read each doc

Most docs follow this shape:

1. **What is this and why should I care?** — the TL;DR.
2. **Prerequisites** — what you should know first.
3. **Concept explained** — plain language, no jargon dumps.
4. **Code example** — small, runnable.
5. **Common mistakes** — pitfalls that catch beginners.
6. **Cross-questions** ("why X and not Y") — common interviewer drilldowns.
7. **What to read next** — pointer onward.

The deeper docs (HLD especially) are denser. If a doc feels too hard, drop one tier.

---

## How to actually run the code

Every code example in this bank is **runnable**. Most can be copy-pasted into a `.py` or `.go` file and run.

### Python

You need Python 3.10 or newer.

```bash
# Check your version
python3 --version

# Run a doc's code (after copying into a .py file)
python3 my_example.py
```

### Go

You need Go 1.21 or newer.

```bash
# Check
go version

# Run
go run my_example.go
```

**Don't have Python/Go installed?**
- Python: [python.org/downloads](https://python.org/downloads) or `brew install python3` on macOS.
- Go: [go.dev/doc/install](https://go.dev/doc/install) or `brew install go`.

---

## How this knowledge base will grow

Today: 130+ docs.
Coming: video walkthroughs, exercises with auto-grading, interview mock environment.

If you spot a typo, want a new topic added, or have a question — `INDEX.md` lists every doc; if your topic isn't there, request it.

---

## A note on code style

- We prefer **clarity over cleverness**. Examples are written to be read.
- We **explain the "why"**, not just the "what." A pattern's purpose is more important than its exact implementation.
- We **show common mistakes** so you don't have to make them all yourself.

Welcome aboard. Pick a doc and start.

# Software Engineering Knowledge Base

A learning + reference library for students, junior engineers, and interview prep.

🌐 **Live site:** [saurabh17a.github.io/System-Design-Fundamentals](https://saurabh17a.github.io/System-Design-Fundamentals/)

> **Who is this for?**
> - **CS students** (undergrad/bootcamp) building foundations.
> - **Junior engineers** leveling up to mid/senior roles.
> - **Self-taught coders** filling gaps in CS fundamentals.
> - **Interview candidates** preparing for system design / coding rounds.

You don't need a CS degree to use this. Topics start from "what is a variable?" and go up to "design WhatsApp."

---

## How the bank is organized

We use **tiers**. Pick where you are; move up.

```
┌────────────────────────────────────────────────────────────┐
│                  Tier 0: METHODOLOGY                        │
│  What system design is, and how to approach a problem.      │
│  → Read this first if you've never done a design round.     │
└────────────────────────────────────────────────────────────┘
                            │
                            ▼
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
                            │
                            ▼
┌────────────────────────────────────────────────────────────┐
│                  Tier 4: DEEP DIVES                         │
│  Databases, Caching, Messaging, Networking, Resiliency...   │
│  → Reference for the building blocks HLD answers reach for. │
└────────────────────────────────────────────────────────────┘
```

> The whole bank is also published as a searchable, dark-mode-friendly website:
> **[saurabh17a.github.io/System-Design-Fundamentals](https://saurabh17a.github.io/System-Design-Fundamentals/)** — browse by tag or company, or use full-text search.

---

## Directory layout

All content lives as Markdown under `system-design/src/content/docs/`. The
`system-design/` folder is an [Astro](https://astro.build) project that renders
those docs into the website.

```
SystemDesign/
├── README.md                         ← you are here
├── _template/                        ← skeletons for new docs
└── system-design/                    ← the Astro site
    ├── astro.config.mjs
    ├── package.json
    └── src/
        ├── content/docs/             ← every knowledge-base doc (~210)
        │   ├── Methodology/          ← how to approach a design problem
        │   ├── Foundations/
        │   │   ├── Roadmap.md        ← suggested learning paths
        │   │   ├── Programming/
        │   │   │   ├── Python/       ← 10 beginner-friendly Python docs
        │   │   │   └── Go/           ← beginner-friendly Go docs
        │   │   ├── OOP/              ← four pillars + SOLID
        │   │   └── DesignPatterns/   ← core patterns (factory, strategy, ...)
        │   ├── HLD/                  ← system design (Twitter, Uber, etc.)
        │   ├── LLD/                  ← OOP design (parking lot, chess, etc.)
        │   │   ├── Python/           ← LLD answers in Python
        │   │   └── Go/               ← same, in Go
        │   ├── MachineCoding/        ← data-structure / concurrency code
        │   │   ├── Python/
        │   │   └── Go/
        │   └── DeepDives/            ← building blocks, grouped by topic
        │       ├── Databases/  Caching/  Messaging/  Networking/
        │       ├── Distribution/  Coordination/  Resiliency/
        │       └── Infrastructure/  Search/  BigData/
        ├── components/  layouts/  pages/   ← site UI (tags, companies, search)
        └── styles/
```

---

## Recommended learning paths

Paths below are relative to `system-design/src/content/docs/`.

### Path A — "I'm starting from scratch" (3-6 months)

```
1. Foundations/Programming/Python/01-getting-started.md
   ↓ work through 01–10 in order
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
Foundations/Programming/Go/* (read all 12 in order)
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
Methodology/02-how-to-approach.md     (the interview framework)
Foundations/OOP/four-pillars.md       (10-min refresher)
Foundations/DesignPatterns/*          (skim)
HLD/url-shortener.md                  (canonical first HLD)
HLD/rate-limiter.md
HLD/twitter-news-feed.md
HLD/distributed-cache.md
   ↓ then pull in DeepDives/ topics as each HLD needs them
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

## Running the site locally

The website is an Astro project in `system-design/`. You need Node 18+ (CI builds
on Node 22).

```bash
cd system-design
npm install
npm run dev        # local dev server at http://localhost:4321
```

Other commands:

| Command           | Action                                          |
| :---------------- | :---------------------------------------------- |
| `npm run build`   | Build the static site to `dist/` (+ search index) |
| `npm run preview` | Preview the production build locally            |

The site auto-deploys to GitHub Pages from `master` via `.github/workflows/deploy.yml`.
To add or edit content, drop a Markdown file into `system-design/src/content/docs/`
— it shows up as a route automatically.

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

Today: 210+ docs across Methodology, Foundations, LLD, Machine Coding, HLD, and Deep Dives.
Coming: video walkthroughs, exercises with auto-grading, interview mock environment.

If you spot a typo, want a new topic added, or have a question — browse the
[live site](https://saurabh17a.github.io/System-Design-Fundamentals/) or the docs
under `system-design/src/content/docs/`; if your topic isn't there, request it.

---

## A note on code style

- We prefer **clarity over cleverness**. Examples are written to be read.
- We **explain the "why"**, not just the "what." A pattern's purpose is more important than its exact implementation.
- We **show common mistakes** so you don't have to make them all yourself.

Welcome aboard. Pick a doc and start.

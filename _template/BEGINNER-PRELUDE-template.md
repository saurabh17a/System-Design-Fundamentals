# Beginner Prelude — Template

> Every existing LLD/HLD/MC doc gets a "Section 0 — Beginner's Guide" inserted at the top.
> This file is the spec. Use it when adding new docs or refactoring old ones.

---

## Where it goes

Right after the `> **Difficulty:** ...` / `> **Tags:** ...` header, BEFORE the existing `## 1. Problem` section. Keeps the rest of the doc untouched.

---

## Structure (5 short sections)

```markdown
---

## 0. Beginner's Guide

### What's the problem in plain English?

[1-2 paragraphs in everyday language. NO jargon. Explain it like you'd explain
to a non-engineer friend. Use a concrete scene: "You walk into a coffee shop and
they hand you a buzzer that lights up when your drink is ready..." instead of
"This is a notification system with a publish-subscribe pattern."]

### Why is this problem worth solving?

[2-4 bullets answering: where do real-world systems do this? What does solving it
teach you? Why do interviewers ask it? Don't pad — if it's an interview classic,
say so. If it shows a useful pattern (state machines, concurrency), name it.]

- Where you see it in real life: ...
- What it teaches: ...
- Why interviewers ask it: ...

### Vocabulary (read these first)

[3-8 terms used in the rest of the doc. Each gets a one-sentence definition for
a beginner. Order alphabetically so it's findable.]

- **Term A** — short definition.
- **Term B** — short definition.

### High-level approach (the big picture, before any code)

[Explain the design WITHOUT code. What are the entities? What are the key flows?
This is the "verbal whiteboard" version. ~10-15 lines.]

The system has a few main pieces:
1. **X** — describe what it does.
2. **Y** — describe what it does.
3. **Z** — describe what it does.

The main flow is:
- Step 1: ...
- Step 2: ...
- Step 3: ...

### How to read the rest of this doc

[Tell the reader where to focus. Code-heavy doc? Tell them to skim section 2
and read section 3 carefully. Diagram-heavy? Send them to section 5 first.
This shapes their attention.]

- If you're new: read sections 1, 2, and the cheat-sheet at the end. Skip the
  cross-questions on first pass.
- If you're prepping for an interview: read everything; the cross-questions are
  the differentiator.
- If you've built this before: jump straight to the code in section [X].

---
```

---

## Tone rules

- **No assumed knowledge.** Don't use "obviously," "as you know," "trivially."
- **Plain English first, jargon second.** When introducing a term, define it inline the first time.
- **Concrete scenes** beat abstract descriptions. "Imagine a parking lot at the airport with 4 floors..." beats "Consider a system with hierarchical resource allocation."
- **Brevity.** The prelude is the warm-up, not the main course. ~80–120 lines.
- **No new code.** Code lives in the existing doc body. The prelude is prose only.

---

## What NOT to put in the prelude

- A second copy of the problem statement (the existing doc has one).
- API specifications (those are in the body).
- Detailed code (none).
- Trade-off analysis (that's in the body's cross-questions).
- A retread of the entire doc.

The prelude is a **ramp**: it gets a beginner's mental model in place so the rest of the doc lands.

---

## Worked example — for "LRU Cache" MC doc

```markdown
## 0. Beginner's Guide

### What's the problem in plain English?

Your laptop has fast RAM (small) and a slow disk (big). When the RAM fills up,
something has to go. An "LRU cache" is one rule for deciding what goes: kick out
whatever was used least recently. It's like a small desk where you keep the
last few books you used; if a new book arrives and the desk is full, the book
you haven't touched in the longest time goes back to the shelf.

### Why is this problem worth solving?

- **Real-world**: every web browser, every database, every CPU has caches that
  use LRU or a close cousin.
- **Teaches you**: combining two data structures (hashmap + doubly linked list)
  to get O(1) lookup AND O(1) eviction.
- **Interview classic**: probably the most-asked machine-coding question.

### Vocabulary

- **Cache** — a small fast store in front of a big slow store.
- **Eviction** — removing an item to make room for a new one.
- **Hit** — the value was in the cache (good).
- **Miss** — the value wasn't there; you have to fetch it (bad).
- **Doubly linked list** — a list where each node knows both its neighbors,
  so you can remove a node from the middle in O(1).
- **O(1)** — operation takes constant time regardless of how big the data is.

### High-level approach

The trick is two data structures working together:

1. **Hashmap (key → node)** lets you find any node in O(1).
2. **Doubly linked list** keeps the order: most-recent at the head, least-recent
   at the tail.

Operations:
- **get(key)**: look up in hashmap → if found, move that node to the head (it's
  the most-recent now). Return its value.
- **put(key, val)**: if key exists, update; move to head. Otherwise, add a new
  node at the head. If we're full, drop the tail node (least-recent).

Every operation is O(1) because the hashmap tells us where any node is, and the
doubly linked list lets us remove and reinsert anywhere in constant time.

### How to read the rest of this doc

- Read sections 1 and 2 carefully — the data structure is the whole point.
- Skim the test code to see how it's used.
- Cross-questions at the end are about variants (LFU, ARC) — read if interested.
```

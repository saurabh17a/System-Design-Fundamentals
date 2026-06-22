# [System Name] — Low-Level Design (Object-Oriented Design)

> **Difficulty:** [Easy / Medium / Hard]
> **Tags:** `[lld]` `[ood]` `[domain-tag]` `[concurrency?]`
> **Language:** [Go / Python]
> **Prep time:** ~[N] min skim, ~[N] min deep read
> **Companies that ask this:** [Amazon, Uber, Atlassian, ...]

---

## 0. How to use this doc in an interview

LLD interviews are a 60-minute trap. The trap is **starting to code immediately**. Don't.

Spend the first ~15 minutes on:
1. Restating the problem.
2. Asking clarifying questions.
3. Listing functional requirements (numbered).
4. Identifying actors and their use cases.
5. Sketching the class diagram (entities + relationships).
6. **Picking design patterns and saying why.**

Only after the interviewer agrees on the diagram should you start writing classes. And even then — start with skeletons (class + method signatures), get the interviewer's nod, *then* fill in bodies.

The cross-questions section catches the standard "why pattern X and not Y" drilldowns.

---

## 1. Problem Statement

[One paragraph. State what the system represents and what behaviors it supports. Resist describing implementation.]

---

## 2. Clarifying Questions to Ask the Interviewer

### Scope
- [ ] What's in scope vs out of scope? (e.g. payment integration in scope?)
- [ ] CLI, GUI, library API — which is the consumer?
- [ ] Single instance or multi-instance / distributed?

### Domain
- [ ] [Domain question 1]
- [ ] [Domain question 2]
- [ ] [Domain question 3]

### Non-functional
- [ ] Concurrency expected? Single-thread acceptable?
- [ ] Persistence required? In-memory only?
- [ ] Approximate scale (number of entities)?
- [ ] Real-time constraints?

### Edge cases up-front
- [ ] What happens when [edge case 1]?
- [ ] What happens when [edge case 2]?

> **Tip:** Capture answers in a corner of the whiteboard — refer back when justifying decisions.

---

## 3. Functional Requirements

**Must-have (P0):**
1. [Capability]
2. [Capability]
3. [Capability]

**Should-have (P1):**
1. [Capability]

**Nice-to-have (P2 — declare out of scope):**
1. [Capability]

---

## 4. Actors & Use Cases

```
                       ┌──────────────────┐
                       │     System       │
                       │   [System Name]  │
                       └──────────────────┘
                              ▲    ▲
              ┌───── uses ────┘    └──── uses ──────┐
              │                                     │
        ┌───────────┐                         ┌───────────┐
        │  Actor A  │                         │  Actor B  │
        │  (e.g.    │                         │   (e.g.   │
        │ customer) │                         │   admin)  │
        └───────────┘                         └───────────┘
```

### Actor A — [name]
- Use case 1: [...]
- Use case 2: [...]

### Actor B — [name]
- Use case 1: [...]

---

## 5. Core Entities

> Identify the **nouns** in the problem. Name them, attribute them, and resist adding behavior here — behavior comes after relationships are clear.

| Entity | Attributes | Notes |
|---|---|---|
| [Entity1] | id, name, ... | [reason for existence] |
| [Entity2] | id, ... | [reason for existence] |
| [Entity3] | id, ... | [reason for existence] |

**Enums:**
```
[EnumName]: VALUE_A, VALUE_B, VALUE_C
[EnumName]: SMALL, MEDIUM, LARGE
```

---

## 6. Class Diagram (ASCII)

```
                     ┌─────────────────────────────┐
                     │       [SystemFacade]        │
                     │─────────────────────────────│
                     │ - field1                    │
                     │ - field2                    │
                     │─────────────────────────────│
                     │ + method1()                 │
                     │ + method2()                 │
                     └─────────────┬───────────────┘
                                   │ owns ◇
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
      ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
      │  ClassA      │    │  «interface» │    │   ClassC     │
      │              │    │   StrategyI  │    │              │
      │  - fields    │    │              │    │              │
      │  + methods   │    │  + execute() │    │              │
      └──────┬───────┘    └──────▲───────┘    └──────────────┘
             │ extends           │ implements
             ▼                   │
      ┌──────────────┐   ┌───────┴──────┐
      │  ClassA1     │   │ StrategyImpl │
      └──────────────┘   └──────────────┘

Legend:
  ◇ aggregation     ◆ composition     △ inheritance
  ───▶ association  ─ ─▶ dependency  ═══▶ realization (interface impl)
```

> **Be deliberate.** Composition (◆) means "lifecycle bound" — child dies with parent. Aggregation (◇) means "owns reference but lives independently". Pick the right arrow; senior interviewers notice.

---

## 7. Design Patterns Used (and Why)

State each pattern explicitly. Don't make the interviewer guess.

| Pattern | Where used | Why this pattern | Alternative considered |
|---|---|---|---|
| Strategy | [pricing / matching / ...] | Pluggable algorithm, runtime swap, open/closed | if/else chain — fails open/closed |
| Factory | [creation of ...] | Encapsulate construction logic, hide concrete types | direct `new` — leaks types to caller |
| State | [...] | Behavior depends on state, transitions are explicit | nested switch — duplicates per-state behavior |
| Singleton | [system facade if global] | Single source of truth | global var — untestable |
| Observer | [notifications, audit] | Decouple producer and N consumers | tight coupling — adds dep per listener |
| Command | [undoable actions] | Reify operations, queue / log / undo | direct call — can't time-travel |

> Don't pattern-stuff. If a pattern doesn't earn its keep, leave it out and call out *why* you considered it.

---

## 8. Sequence Diagrams (key flows)

### 8.1 [Flow 1 — e.g. happy path]

```
  Actor          Facade           ServiceA           Repo
    │              │                  │                │
    │── action ────▶                  │                │
    │              │── validate ─────▶│                │
    │              │◀─── ok ──────────│                │
    │              │── persist ──────────────────────▶ │
    │              │◀── id ──────────────────────────  │
    │              │── notify ───────▶│                │
    │◀── result ───│                  │                │
    │              │                  │                │
```

### 8.2 [Flow 2 — e.g. error path]

```
  Actor          Facade           ServiceA           Repo
    │── action ────▶                  │                │
    │              │── validate ─────▶│                │
    │              │◀── error ────────│                │
    │◀── 4xx ──────│                  │                │
```

---

## 9. Concurrency Considerations

| Concern | Manifestation | Resolution |
|---|---|---|
| Shared state | Multiple goroutines/threads mutating [resource] | sync.Mutex / threading.Lock around critical section |
| Race on read-then-write | Check-then-act on availability | Atomic CAS or lock |
| Deadlock risk | Multiple locks acquired in different orders | Always acquire in [defined] order |
| Throughput vs correctness | Coarse lock kills throughput | Lock per shard / per entity |

> If single-threaded was specified in clarifying questions, **say so explicitly** — don't bolt on locks defensively.

---

## 10. Full Working Code

[Below: complete, runnable code in {Go/Python}. Includes:
- All classes / structs / interfaces
- Construction (factory or constructor)
- Public API methods with full bodies
- Edge case handling
- Inline comments **only** where the WHY is non-obvious
- A `main`/`__main__`/test that exercises the happy path]

```{language}
[code]
```

### How to run

```bash
# Go
cd <dir>
go run .
# or
go test ./...

# Python
python3 [file].py
# or
python3 -m pytest [test_file].py
```

---

## 11. Cross-Questions ("Why X and not Y") — ≥ 12

### 11.1 Why [pattern A] and not [pattern B]?
[5–15 line answer. What B is. Why B sounds tempting. Specifically what fails. When B is correct.]

### 11.2 Why [data structure] for [field] and not [alternative]?
[answer]

### 11.3 Why [enum] for [state] and not [string / int / table-driven]?
[answer]

### 11.4 Why this class hierarchy and not flat composition?
[answer]

### 11.5 Why mutable state and not immutability?
[answer]

### 11.6 Why expose this as a method and not an event?
[answer]

### 11.7 Why no [pattern X] here even though it's tempting?
[answer]

### 11.8 What if [scale assumption] changes?
[answer]

### 11.9 How is this thread-safe (or why is it OK that it's not)?
[answer]

### 11.10 What's the testing strategy? Unit / integration / property-based?
[answer]

### 11.11 What's the failure mode of [critical operation]?
[answer]

### 11.12 How would you persist this to a database?
[answer]

[Add domain-specific cross-questions — usually 3–5 more.]

---

## 12. Extensions (Common Follow-Ups)

### 12.1 [Extension A — e.g. add electric vehicles]
[How the existing design absorbs this without rewriting. Show concretely which classes change vs which don't. This is the open/closed test.]

### 12.2 [Extension B — e.g. multi-floor]
[same]

### 12.3 [Extension C — e.g. monthly subscription]
[same]

> If an extension would force you to rewrite >30% of the design, your design failed open/closed. Re-examine the abstraction boundary.

---

## 13. Cheat-Sheet Recap

1. **Problem:** [one line]
2. **Core entities:** [N1, N2, N3]
3. **Patterns:** [Strategy for X, Factory for Y, State for Z]
4. **Hardest design call:** [decision + alternative]
5. **Concurrency:** [single-thread / locked at granularity Y]
6. **Trade-off accepted:** [what we gave up]
7. **Open extension point:** [where we plug in next]

---

## Appendix: How to draw class diagrams faster on a whiteboard

```
[Class]
─────────
- field
─────────
+ method()
```
Use:
- `−` for private, `+` for public, `#` for protected
- `◆──▶` composition, `◇──▶` aggregation, `△──` inheritance, `─ ─▶` dependency
- Italicize abstract; «interface» tag for interfaces

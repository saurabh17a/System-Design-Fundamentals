# Function Docstring / Comment Style

> Applied to every function and method inside LLD and MC code blocks.
> Goal: a reader can walk through the file top-to-bottom and **narrate it to an interviewer** out loud.

---

## Structure

Every public function/method gets a doc-comment ABOVE it with three lines:

1. **What** — one sentence of what it does.
2. **Why / How** — one sentence on the design choice or the trick used.
3. **Interview tip** *(only if non-obvious)* — one sentence on what to emphasize when explaining.

Trivial helpers (getters, plain constructors) get just the **What** line.

---

## Python style — docstring inside the function

```python
def cast_vote(self, election_id, voter_id, candidate_id):
    """Cast a vote in an active election.

    Why this approach: we hash the voter ID before recording it, so the system
    knows that someone voted (preventing double-vote) without storing their
    identity tied to the candidate (anonymity).

    Interview tip: emphasize the voter_hash trick — sha256(salt + election + id)
    is the cleanest way to get dedup + anonymity in one move.
    """
    with self._lock:
        ...
```

For trivial methods, a single line is fine:

```python
def winner(self) -> Optional[Candidate]:
    """Return the candidate with the highest tally, or None if no votes."""
    ...
```

---

## Go style — `//` comments above the function

```go
// CastVote records a vote in an active election.
//
// Why this approach: we hash the voter ID with sha256(salt + electionID + voterID)
// before recording. The system can detect double-voting via the hash set, but
// can't link a vote back to a specific voter — anonymity preserved.
//
// Interview tip: emphasize the hash trick when explaining how we get
// dedup AND anonymity in a single mechanism.
func (s *Service) CastVote(electionID, voterID, candidateID string) (*Vote, error) {
    s.mu.Lock()
    defer s.mu.Unlock()
    ...
}
```

For trivial functions:

```go
// Winner returns the candidate with the highest tally, or nil if no votes.
func (s *Service) Winner(electionID string) (*Candidate, error) { ... }
```

---

## When to skip

- Generated boilerplate (e.g., `func (e Email) Pay(...)` in a Strategy demo where the function is just there to satisfy an interface and the explanation is in the parent type).
- Pure data-transfer struct field methods (a `String()` that just returns a formatted name).

If skipping, use a 1-line `// What` so the reader still sees something.

---

## What NOT to do

- ❌ Don't restate the code in English (`# increment counter`).
- ❌ Don't write a paragraph; 3 lines max.
- ❌ Don't add an "interview tip" if there's nothing surprising to say.
- ❌ Don't use marketing voice ("This elegant function...").

---

## Examples in this bank

After this round, every code block in `LLD/` and `MachineCoding/` has comments in this style. Read `LLD/Python/parking-lot.md` or `MachineCoding/Python/lru-cache.md` for a worked example.

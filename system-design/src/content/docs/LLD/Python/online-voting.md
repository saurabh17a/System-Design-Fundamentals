# Online Voting System — LLD (Python)

> **Difficulty:** Medium
> **Tags:** `[lld]` `[security]` `[concurrency]` `[idempotency]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

An online election. Eligible voters are pre-registered. They vote (once each, anonymously). The system tallies votes and announces the winner. Two key invariants: **no double-voting** (anti-fraud) and **anonymity** (we know someone voted, but not how).

### Why solve it?

- **Real world**: corporate polls, school elections; concepts apply to any "one user, one action" system.
- **Teaches**: idempotency, hashing for anonymity, atomic vote-and-record.
- **Patterns**: state machine (election lifecycle), strategy (different voting rules: plurality, ranked-choice).

### Vocabulary

- **Voter / Candidate** — registered participants.
- **Eligibility** — set of allowed voter IDs.
- **Voter hash** — `hash(salt + election_id + voter_id)` — used to dedup without storing identity.
- **State** — DRAFT (setup) → OPEN (voting) → CLOSED (counted).
- **Idempotency** — voting twice has no effect (other than a rejection).

### High-level approach

Entities:
- **Election** — id, candidates, eligible voters set, state, voted-set, tally.
- **ElectionService** — orchestrator: create, open, vote, close, declare winner.

Vote flow (atomic):
1. Verify state is OPEN.
2. Verify voter is eligible.
3. Compute voter_hash.
4. If hash in voted-set → reject (already voted).
5. Add hash to voted-set; increment candidate's tally.

Concurrency: a single mutex around the whole vote operation prevents two threads from sneaking in for the same voter.

### How to read this doc

- **Beginner**: focus on the voted-set + tally pair.
- **Interview**: discuss anti-coercion, paper backup, real-vs-online voting trust models.

---

## 1. Problem

Election system:
- Voters registered.
- Candidates registered.
- Each voter can vote once.
- Tally votes.
- Anti-fraud: no double-voting, audit log.

---

## 2. Code

```python
"""Online Voting System."""
from __future__ import annotations
import enum
import hashlib
import threading
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


class State(enum.Enum):
    DRAFT = "draft"
    OPEN = "open"
    CLOSED = "closed"


class VoteError(Exception): ...
class AlreadyVoted(VoteError): ...
class NotEligible(VoteError): ...
class ElectionNotOpen(VoteError): ...


@dataclass(frozen=True)
class Voter:
    id: str
    name: str


@dataclass(frozen=True)
class Candidate:
    id: str
    name: str


@dataclass(frozen=True)
class Vote:
    id: str
    election_id: str
    voter_hash: str  # hashed voter_id (anonymity)
    candidate_id: str
    timestamp: datetime


@dataclass
class Election:
    id: str
    name: str
    state: State
    candidates: dict[str, Candidate]
    eligible_voters: set[str]  # voter_ids
    voted_set: set[str]  # voter hashes (for fast dedup)
    tally: dict[str, int]
    votes: list[Vote]


class ElectionService:
    def __init__(self, salt: str = "election-salt"):
        self._elections: dict[str, Election] = {}
        self._salt = salt
        self._lock = threading.RLock()

    def _hash_voter(self, election_id: str, voter_id: str) -> str:
        s = f"{self._salt}:{election_id}:{voter_id}"
        return hashlib.sha256(s.encode()).hexdigest()

    def create_election(self, name: str, eligible_voters: list[str]) -> Election:
        with self._lock:
            e = Election(
                id=str(uuid.uuid4()), name=name, state=State.DRAFT,
                candidates={}, eligible_voters=set(eligible_voters),
                voted_set=set(), tally=defaultdict(int), votes=[],
            )
            self._elections[e.id] = e
            return e

    def add_candidate(self, election_id: str, candidate: Candidate) -> None:
        with self._lock:
            e = self._elections[election_id]
            if e.state is not State.DRAFT:
                raise VoteError("election not draft")
            e.candidates[candidate.id] = candidate

    def open_election(self, election_id: str) -> None:
        with self._lock:
            e = self._elections[election_id]
            if e.state is not State.DRAFT:
                raise VoteError(f"state={e.state}")
            if not e.candidates:
                raise VoteError("no candidates")
            e.state = State.OPEN

    def cast_vote(self, election_id: str, voter_id: str, candidate_id: str) -> Vote:
        with self._lock:
            e = self._elections[election_id]
            if e.state is not State.OPEN:
                raise ElectionNotOpen()
            if voter_id not in e.eligible_voters:
                raise NotEligible()
            if candidate_id not in e.candidates:
                raise VoteError("unknown candidate")
            vh = self._hash_voter(election_id, voter_id)
            if vh in e.voted_set:
                raise AlreadyVoted()
            e.voted_set.add(vh)
            v = Vote(id=str(uuid.uuid4()), election_id=election_id,
                     voter_hash=vh, candidate_id=candidate_id,
                     timestamp=datetime.utcnow())
            e.votes.append(v)
            e.tally[candidate_id] += 1
            return v

    def close_election(self, election_id: str) -> dict[str, int]:
        with self._lock:
            e = self._elections[election_id]
            if e.state is not State.OPEN:
                raise VoteError(f"state={e.state}")
            e.state = State.CLOSED
            return dict(e.tally)

    def winner(self, election_id: str) -> Optional[Candidate]:
        with self._lock:
            e = self._elections[election_id]
            if e.state is not State.CLOSED:
                raise VoteError("not closed")
            if not e.tally:
                return None
            top = max(e.tally.items(), key=lambda kv: kv[1])
            return e.candidates[top[0]]


# Tests
def main():
    svc = ElectionService()

    print("--- create + open ---")
    e = svc.create_election("Class President 2026",
                            eligible_voters=[f"v{i}" for i in range(100)])
    svc.add_candidate(e.id, Candidate(id="A", name="Alice"))
    svc.add_candidate(e.id, Candidate(id="B", name="Bob"))
    svc.open_election(e.id)
    print("  OK")

    print("--- vote ---")
    svc.cast_vote(e.id, "v0", "A")
    svc.cast_vote(e.id, "v1", "B")
    svc.cast_vote(e.id, "v2", "A")
    print("  OK")

    print("--- double vote rejected ---")
    try:
        svc.cast_vote(e.id, "v0", "B")
    except AlreadyVoted:
        pass
    print("  OK")

    print("--- ineligible rejected ---")
    try:
        svc.cast_vote(e.id, "v999", "A")
    except NotEligible:
        pass
    print("  OK")

    print("--- close + tally + winner ---")
    tally = svc.close_election(e.id)
    assert tally == {"A": 2, "B": 1}
    w = svc.winner(e.id)
    assert w.id == "A"
    print(f"  winner: {w.name}, tally={tally}")

    print("--- concurrent voting (only first per voter wins) ---")
    e2 = svc.create_election("E2", eligible_voters=[f"u{i}" for i in range(50)])
    svc.add_candidate(e2.id, Candidate(id="X", name="X"))
    svc.add_candidate(e2.id, Candidate(id="Y", name="Y"))
    svc.open_election(e2.id)
    succ = []
    failed = 0
    succ_lock = threading.Lock()
    fail_lock = threading.Lock()

    def fire(i):
        nonlocal failed
        try:
            svc.cast_vote(e2.id, "u0", "X")  # always same voter
            with succ_lock:
                succ.append(i)
        except AlreadyVoted:
            with fail_lock:
                failed += 1

    threads = [threading.Thread(target=fire, args=(i,)) for i in range(50)]
    for t in threads: t.start()
    for t in threads: t.join()
    assert len(succ) == 1
    assert failed == 49
    print(f"  exactly 1 succeeded, {failed} failed")

    print("\nAll tests passed.")


if __name__ == "__main__":
    main()
```

---

## 3. Cheat-Sheet
1. Election state: DRAFT → OPEN → CLOSED.
2. Voter hash for anonymous dedup.
3. Tally maintained on each vote.
4. Concurrency: lock prevents double-vote race.
5. Eligible-voter set for authorization.

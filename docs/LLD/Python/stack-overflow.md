# Stack Overflow — LLD (Python)

> **Difficulty:** Medium
> **Tags:** `[lld]` `[forum]` `[voting]` `[reputation]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

A Q&A site like Stack Overflow. Users post questions, others answer. Everyone can upvote/downvote questions and answers. The question's author can mark one answer as "accepted." Users earn **reputation** based on votes (e.g., +5 per question upvote, +10 per answer upvote, +15 if your answer is accepted).

### Why solve it?

- **Real world**: Reddit, Quora, Stack Overflow itself, internal Q&A tools.
- **Teaches**: vote tracking with idempotency (one user, one vote), reputation calculation, role-based permissions (only author can accept).
- **Interview**: tests entity-relationship modeling and edge cases (changing your vote, voting on own post).

### Vocabulary

- **Question / Answer** — both are "posts" with similar interfaces.
- **Vote** — +1 (upvote) or -1 (downvote). One per user per post.
- **Accept** — question author marks one answer as the chosen one.
- **Reputation** — user's score; computed from votes.
- **Tag** — topic label on a question.

### High-level approach

Entities:
- **User** — id, name, reputation.
- **Question** — author, title, body, tags, score, accepted_answer_id.
- **Answer** — author, question_id, body, score.
- **Vote** — keyed by `(post_id, user_id)`, value = -1 or +1.
- **StackOverflow** — orchestrator.

Vote logic: if user voted before, REVERSE old vote's reputation effect first, then apply new. This handles "change your vote" correctly.

Permissions: voting on your own post → reject. Accepting an answer → only by question author.

### How to read this doc

- **Beginner**: vote logic + reputation calculation are the meat.
- **Interview**: discuss search, ranking, tag system, badges.

---

## 1. Problem

Q&A platform LLD:
- Users post questions and answers.
- Vote up/down on questions, answers, comments.
- Reputation: derived from votes received.
- Tags on questions.
- Accept an answer.

---

## 2. Code

```python
"""Stack Overflow LLD."""
from __future__ import annotations
import enum
import threading
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


class SOError(Exception): ...
class AlreadyVoted(SOError): ...
class CannotVoteOwn(SOError): ...


class Badge(enum.Enum):
    NEWCOMER = "newcomer"      # default
    CONTRIBUTOR = "contributor"  # 10+ rep
    EXPERT = "expert"          # 100+ rep


@dataclass(frozen=True)
class User:
    id: str
    name: str


@dataclass
class Question:
    id: str
    author_id: str
    title: str
    body: str
    tags: list[str]
    created_at: datetime
    score: int = 0
    accepted_answer_id: Optional[str] = None


@dataclass
class Answer:
    id: str
    question_id: str
    author_id: str
    body: str
    created_at: datetime
    score: int = 0


@dataclass
class Comment:
    id: str
    parent_id: str  # question or answer
    author_id: str
    body: str


class StackOverflow:
    REP_DELTA = {"upvote_q": 5, "upvote_a": 10, "downvote": -2, "accepted": 15}

    def __init__(self):
        self._users: dict[str, User] = {}
        self._questions: dict[str, Question] = {}
        self._answers: dict[str, Answer] = {}
        self._comments: dict[str, Comment] = {}
        self._reputation: dict[str, int] = defaultdict(int)
        # vote tracking: (item_id, user_id) → -1|+1
        self._votes_q: dict[tuple[str, str], int] = {}
        self._votes_a: dict[tuple[str, str], int] = {}
        self._questions_by_tag: dict[str, list[str]] = defaultdict(list)
        self._lock = threading.RLock()

    def add_user(self, name: str) -> User:
        with self._lock:
            u = User(id=str(uuid.uuid4()), name=name)
            self._users[u.id] = u
            return u

    def post_question(self, author_id: str, title: str, body: str, tags: list[str]) -> Question:
        with self._lock:
            q = Question(
                id=str(uuid.uuid4()), author_id=author_id, title=title, body=body,
                tags=list(tags), created_at=datetime.utcnow(),
            )
            self._questions[q.id] = q
            for t in tags:
                self._questions_by_tag[t].append(q.id)
            return q

    def post_answer(self, author_id: str, question_id: str, body: str) -> Answer:
        with self._lock:
            a = Answer(id=str(uuid.uuid4()), question_id=question_id,
                       author_id=author_id, body=body, created_at=datetime.utcnow())
            self._answers[a.id] = a
            return a

    @staticmethod
    def _q_rep(value: int) -> int:
        return {1: 5, -1: -2, 0: 0}[value]

    @staticmethod
    def _a_rep(value: int) -> int:
        return {1: 10, -1: -2, 0: 0}[value]

    def vote_question(self, question_id: str, user_id: str, value: int) -> None:
        if value not in (-1, 0, +1):
            raise ValueError()
        with self._lock:
            q = self._questions[question_id]
            if q.author_id == user_id:
                raise CannotVoteOwn()
            key = (question_id, user_id)
            old = self._votes_q.get(key, 0)
            if old == value:
                return
            self._votes_q[key] = value
            q.score += value - old
            # Reverse old vote's reputation, apply new
            self._reputation[q.author_id] -= self._q_rep(old)
            self._reputation[q.author_id] += self._q_rep(value)

    def vote_answer(self, answer_id: str, user_id: str, value: int) -> None:
        if value not in (-1, 0, +1):
            raise ValueError()
        with self._lock:
            a = self._answers[answer_id]
            if a.author_id == user_id:
                raise CannotVoteOwn()
            key = (answer_id, user_id)
            old = self._votes_a.get(key, 0)
            if old == value:
                return
            self._votes_a[key] = value
            a.score += value - old
            self._reputation[a.author_id] -= self._a_rep(old)
            self._reputation[a.author_id] += self._a_rep(value)

    def accept_answer(self, question_id: str, answer_id: str, by_user_id: str) -> None:
        with self._lock:
            q = self._questions[question_id]
            if q.author_id != by_user_id:
                raise SOError("only question author can accept")
            a = self._answers[answer_id]
            q.accepted_answer_id = answer_id
            self._reputation[a.author_id] += 15

    def reputation(self, user_id: str) -> int:
        return self._reputation[user_id]

    def search_by_tag(self, tag: str) -> list[Question]:
        return [self._questions[qid] for qid in self._questions_by_tag.get(tag, [])]


# Tests
def main():
    so = StackOverflow()
    alice = so.add_user("Alice")
    bob = so.add_user("Bob")
    carol = so.add_user("Carol")

    print("--- post + answer ---")
    q = so.post_question(alice.id, "How does X work?", "...", tags=["python", "x"])
    a1 = so.post_answer(bob.id, q.id, "...")
    a2 = so.post_answer(carol.id, q.id, "...")
    print("  OK")

    print("--- voting ---")
    so.vote_question(q.id, bob.id, +1)
    assert so.reputation(alice.id) == 5
    so.vote_question(q.id, bob.id, +1)  # idempotent
    assert so.reputation(alice.id) == 5

    so.vote_answer(a1.id, alice.id, +1)
    assert so.reputation(bob.id) == 10
    print("  OK")

    print("--- can't vote own ---")
    try:
        so.vote_question(q.id, alice.id, +1)
    except CannotVoteOwn:
        pass
    print("  OK")

    print("--- change vote ---")
    so.vote_answer(a1.id, alice.id, -1)
    assert so.reputation(bob.id) == -2  # was +10, became -2 (delta -12)
    print("  OK")

    print("--- accept answer ---")
    so.accept_answer(q.id, a2.id, alice.id)
    assert q.accepted_answer_id == a2.id
    assert so.reputation(carol.id) == 15
    print("  OK")

    print("--- search by tag ---")
    res = so.search_by_tag("python")
    assert q in res
    print("  OK")

    print("\nAll tests passed.")


if __name__ == "__main__":
    main()
```

---

## 3. Cheat-Sheet
1. User, Question, Answer, Comment.
2. Vote tables: (item, user) → vote_value.
3. Vote change updates score + reputation.
4. Accept answer: question author only; +15 rep.
5. Tag index for search.

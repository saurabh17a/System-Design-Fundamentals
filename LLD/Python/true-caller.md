# True Caller — LLD (Python)

> **Difficulty:** Medium
> **Tags:** `[lld]` `[lookup]` `[crowd-sourced]` `[spam-detection]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

Truecaller. An unknown number calls; the app says "Spam Caller from Nigeria" or "Bob from Acme Corp". Where does that data come from? Two sources:
1. **Crowd-sourced**: many users reported "this number = Bob" or "this number = spam."
2. **User contacts**: users (with permission) upload their address books.

The app combines votes to determine name and spam status.

### Why solve it?

- **Real world**: Truecaller, Hiya, Whoscall.
- **Teaches**: aggregating crowd-sourced votes, privacy considerations, lookup data structures.

### Vocabulary

- **Phone number** — normalized to E.164 (`+91XXX...`).
- **Report** — a user's claim about a number's name or spam status.
- **Spam score** — derived from reports; > threshold → flag.
- **Privacy** — what the app knows about you vs what it shows others.

### High-level approach

Entities:
- **Number** (normalized).
- **Report** — reporter, target_number, name, type (spam/ok).
- **NumberInfo** — name (most-voted), spam_score, total_reports.
- **TrueCallerService** — `lookup(number)`, `report(...)`, `block(...)`.

Lookup: O(1) hashmap from number → NumberInfo.
Report: increment counters, recompute name + spam_score.

For "search by name", a trie or inverted index helps.

### How to read this doc

- **Beginner**: focus on the report aggregation.
- **Interview**: discuss privacy (you don't show all numbers in user's contacts back to others), spam thresholds, false-positive risks.

---

## 1. Problem Statement

Phone number lookup app:
- Lookup name + spam-likelihood for a phone number.
- Crowdsourced: users contribute contacts; spam reports.
- Block / unblock numbers.

---

## 2. Design

| Entity |
|---|
| `Contact` (number, name, source_user) |
| `SpamReport` (number, reporter, reason, ts) |
| `User` (id, name, phone) |
| `BlockList` (per-user) |
| `TrueCallerService` |

Pattern: Strategy (spam scoring), Facade.

---

## 3. Code

```python
"""True Caller-style number lookup."""
from __future__ import annotations
import enum
import threading
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


class SpamLevel(enum.Enum):
    SAFE = "safe"
    SUSPICIOUS = "suspicious"
    SPAM = "spam"


@dataclass(frozen=True)
class Contact:
    number: str
    name: str
    source_user_id: str


@dataclass(frozen=True)
class SpamReport:
    number: str
    reporter_id: str
    reason: str
    timestamp: datetime


@dataclass(frozen=True)
class LookupResult:
    number: str
    name: Optional[str]  # most-popular name from contacts
    spam_level: SpamLevel
    spam_count: int
    is_blocked: bool  # by the querying user


class TrueCallerService:
    def __init__(self):
        self._contacts: dict[str, list[Contact]] = defaultdict(list)
        self._reports: dict[str, list[SpamReport]] = defaultdict(list)
        self._blocks: dict[str, set[str]] = defaultdict(set)  # user_id → set of numbers
        self._lock = threading.RLock()

    def upload_contacts(self, user_id: str, contacts: list[tuple[str, str]]) -> None:
        """User uploads (name, number) pairs from their phone."""
        with self._lock:
            for name, number in contacts:
                self._contacts[number].append(
                    Contact(number=number, name=name, source_user_id=user_id)
                )

    def report_spam(self, reporter_id: str, number: str, reason: str = "") -> None:
        with self._lock:
            self._reports[number].append(
                SpamReport(number=number, reporter_id=reporter_id, reason=reason,
                           timestamp=datetime.utcnow())
            )

    def block(self, user_id: str, number: str) -> None:
        with self._lock:
            self._blocks[user_id].add(number)

    def unblock(self, user_id: str, number: str) -> None:
        with self._lock:
            self._blocks[user_id].discard(number)

    def lookup(self, number: str, querying_user_id: Optional[str] = None) -> LookupResult:
        with self._lock:
            # Most popular name
            names = [c.name for c in self._contacts.get(number, [])]
            name = Counter(names).most_common(1)[0][0] if names else None
            # Spam level by reports
            spam_count = len(self._reports.get(number, []))
            level = self._classify(spam_count)
            blocked = (querying_user_id is not None
                       and number in self._blocks.get(querying_user_id, set()))
            return LookupResult(
                number=number, name=name, spam_level=level,
                spam_count=spam_count, is_blocked=blocked,
            )

    def _classify(self, count: int) -> SpamLevel:
        if count >= 10:
            return SpamLevel.SPAM
        elif count >= 3:
            return SpamLevel.SUSPICIOUS
        return SpamLevel.SAFE


# Tests
def main():
    svc = TrueCallerService()
    svc.upload_contacts("u1", [("Pizza Place", "555-PIZZA"), ("Mom", "555-MOM")])
    svc.upload_contacts("u2", [("Pizza Hut", "555-PIZZA")])
    svc.upload_contacts("u3", [("Pizza Place", "555-PIZZA")])

    print("--- popular name lookup ---")
    r = svc.lookup("555-PIZZA")
    assert r.name == "Pizza Place"  # 2 votes for "Pizza Place" vs 1 for "Pizza Hut"
    print(f"  {r}")

    print("--- spam classification ---")
    for i in range(12):
        svc.report_spam(f"reporter-{i}", "555-SCAM")
    r = svc.lookup("555-SCAM")
    assert r.spam_level is SpamLevel.SPAM
    assert r.spam_count == 12
    print(f"  {r}")

    print("--- block per user ---")
    svc.block("u1", "555-SCAM")
    r1 = svc.lookup("555-SCAM", querying_user_id="u1")
    r2 = svc.lookup("555-SCAM", querying_user_id="u2")
    assert r1.is_blocked is True
    assert r2.is_blocked is False
    print(f"  user1.blocked={r1.is_blocked}, user2.blocked={r2.is_blocked}")

    print("--- unknown number ---")
    r = svc.lookup("555-UNKNOWN")
    assert r.name is None
    assert r.spam_level is SpamLevel.SAFE
    print("  OK")

    print("\nAll tests passed.")


if __name__ == "__main__":
    main()
```

---

## 4. Cheat-Sheet
1. Crowdsourced contacts → most-popular name.
2. Spam reports → threshold-based classification.
3. Per-user block list.
4. Lookup returns: name, spam_level, blocked-by-this-user.

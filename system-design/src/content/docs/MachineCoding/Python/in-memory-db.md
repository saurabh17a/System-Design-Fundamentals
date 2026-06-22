# In-Memory DB with Transactions — Machine Coding (Python)

> **Difficulty:** Medium → Hard
> **Tags:** `[mc]` `[transactions]` `[isolation]` `[stack]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

A baby database, in memory, that supports **transactions**. You can do `set("a", 1)`, then `begin()`, then make a bunch of changes, then `commit()` (keep them) or `rollback()` (throw them away). Plus nested transactions: `begin()` inside a `begin()`, with separate inner rollback.

### Why solve it?

- **Real world**: every DB has transactions; this is the simplest version. Also: Git stages, file system snapshots — same shape.
- **Teaches**: stack-based undo logs, scoped state, nesting.
- **Interview**: HackerRank-style classic.

### Vocabulary

- **Transaction** — a group of operations that succeed or fail atomically.
- **Begin / Commit / Rollback** — start / accept / discard a transaction.
- **Nested transaction** — a transaction inside another (like savepoints).
- **Layered store** — the elegant trick: each transaction is a "layer" of overrides.

### High-level approach

Stack of dicts. Bottom = base state. Each `begin()` pushes a fresh empty dict.

**get(k)**: walk the stack from top to bottom, return first hit. Top layer wins.
**set(k, v)**: write to the top layer.
**delete(k)**: write a tombstone in the top layer (or special sentinel value).
**commit()**: merge top into the layer below.
**rollback()**: pop top.

This is elegantly simple and supports any nesting depth automatically.

### How to read this doc

- **Beginner**: trace `begin → set → begin → set → rollback → commit` on paper.
- **Interview**: edge cases (commit at depth 0, rollback at depth 0) are where bugs hide.

---

## 0. Why this question

Tests **transaction semantics, nested transactions, rollback**. Common at HackerRank-style interviews.

---

## 1. Problem Statement

Implement KV store with:
- `set(k, v)`, `get(k)`, `delete(k)`.
- `count(v)` — number of keys with value v (read-heavy).
- `begin()`, `commit()`, `rollback()`.
- Nested transactions.

---

## 2. Approach

**Layered KV stores**. Each transaction = layer on top of previous.
- Read: walk layers from top to bottom; first hit wins.
- Write: write to top layer.
- Commit: merge top layer into below.
- Rollback: drop top layer.

For `count(v)`: maintain per-layer `count` map; sum (with override semantics).

```
[L0 (committed)]
[L1 (BEGIN)]
[L2 (BEGIN)]
[L3 (BEGIN)]   <- writes go here
```

---

## 3. Code

```python
"""In-memory KV store with nested transactions."""
from __future__ import annotations
from typing import Optional


_TOMBSTONE = object()  # represents "deleted"


class _Layer:
    def __init__(self):
        self.kv: dict[str, object] = {}     # key → value or TOMBSTONE
        self.value_count_delta: dict[object, int] = {}  # value → count change


class TransactionDB:
    def __init__(self):
        # base committed layer
        self._layers: list[_Layer] = [_Layer()]

    def set(self, key: str, value: str) -> None:
        old = self.get(key)
        top = self._layers[-1]
        top.kv[key] = value
        if old is not None:
            top.value_count_delta[old] = top.value_count_delta.get(old, 0) - 1
        top.value_count_delta[value] = top.value_count_delta.get(value, 0) + 1

    def get(self, key: str) -> Optional[str]:
        for layer in reversed(self._layers):
            if key in layer.kv:
                v = layer.kv[key]
                if v is _TOMBSTONE:
                    return None
                return v  # type: ignore
        return None

    def delete(self, key: str) -> None:
        old = self.get(key)
        if old is None:
            return
        top = self._layers[-1]
        top.kv[key] = _TOMBSTONE
        top.value_count_delta[old] = top.value_count_delta.get(old, 0) - 1

    def count(self, value: str) -> int:
        total = 0
        for layer in self._layers:
            total += layer.value_count_delta.get(value, 0)
        return max(0, total)

    def begin(self) -> None:
        self._layers.append(_Layer())

    def commit(self) -> bool:
        if len(self._layers) <= 1:
            return False
        top = self._layers.pop()
        below = self._layers[-1]
        for k, v in top.kv.items():
            below.kv[k] = v
        for v, delta in top.value_count_delta.items():
            below.value_count_delta[v] = below.value_count_delta.get(v, 0) + delta
        return True

    def rollback(self) -> bool:
        if len(self._layers) <= 1:
            return False
        self._layers.pop()
        return True


# ─── Tests ───

def _basic():
    print("--- basic ---")
    db = TransactionDB()
    db.set("a", "1")
    assert db.get("a") == "1"
    db.delete("a")
    assert db.get("a") is None
    print("  OK")


def _count():
    print("--- count ---")
    db = TransactionDB()
    db.set("a", "x")
    db.set("b", "x")
    db.set("c", "y")
    assert db.count("x") == 2
    assert db.count("y") == 1
    db.set("a", "y")  # a from x to y
    assert db.count("x") == 1
    assert db.count("y") == 2
    print("  OK")


def _txn_commit():
    print("--- transaction commit ---")
    db = TransactionDB()
    db.set("a", "1")
    db.begin()
    db.set("a", "2")
    assert db.get("a") == "2"
    db.commit()
    assert db.get("a") == "2"
    print("  OK")


def _txn_rollback():
    print("--- transaction rollback ---")
    db = TransactionDB()
    db.set("a", "1")
    db.begin()
    db.set("a", "2")
    assert db.get("a") == "2"
    db.rollback()
    assert db.get("a") == "1"
    print("  OK")


def _nested():
    print("--- nested transactions ---")
    db = TransactionDB()
    db.set("a", "1")
    db.begin()
    db.set("a", "2")
    db.begin()
    db.set("a", "3")
    assert db.get("a") == "3"
    db.rollback()
    assert db.get("a") == "2"
    db.commit()
    assert db.get("a") == "2"
    print("  OK")


def _delete_then_rollback():
    print("--- delete then rollback ---")
    db = TransactionDB()
    db.set("a", "1")
    db.begin()
    db.delete("a")
    assert db.get("a") is None
    db.rollback()
    assert db.get("a") == "1"
    print("  OK")


def _count_in_txn():
    print("--- count under transaction ---")
    db = TransactionDB()
    db.set("a", "x")
    db.begin()
    db.set("b", "x")
    assert db.count("x") == 2
    db.rollback()
    assert db.count("x") == 1
    print("  OK")


if __name__ == "__main__":
    _basic()
    _count()
    _txn_commit()
    _txn_rollback()
    _nested()
    _delete_then_rollback()
    _count_in_txn()
    print("\nAll tests passed.")
```

---

## 4. Cross-Questions

### 4.1 Why layered approach?
- Each transaction = stack frame.
- Rollback = pop.
- Commit = merge into below.
- Naturally nested.

### 4.2 Why TOMBSTONE for delete?
- Distinguishes "deleted in this layer" from "not present in this layer."
- Without: deleting in inner txn then committing wouldn't propagate the delete.

### 4.3 Why count delta?
- Avoids O(N) recomputation per layer.
- Each layer tracks delta from below; sum = current count.

### 4.4 What if commit fails mid-merge?
- For in-memory, doesn't fail.
- For persistent: write-ahead log; commit atomic.

### 4.5 What about isolation between concurrent transactions?
- Single-threaded MVCC: snapshot at begin.
- Multi-threaded: lock or MVCC versioning.
- Out of scope for the basic problem.

### 4.6 Why max(0, total) on count?
- Defensive: if internal accounting goes negative, return 0.
- Should never happen if logic is correct.

### 4.7 Memory cost?
- Per layer: only changes; not full DB.
- Long-lived transaction with many changes = bigger layer.

---

## 5. Variants
- **MVCC**: each value has version vector; readers see snapshot.
- **Persistent**: write-ahead log; replay on crash.
- **Distributed**: 2PC or saga across nodes.

---

## 6. Cheat-Sheet
1. Stack of layers; each layer = transaction frame.
2. Read walks top-down; first hit wins.
3. Delete = TOMBSTONE on top.
4. Commit merges top into below.
5. Rollback discards top.
6. Count via per-layer delta.

# Splitwise — Low-Level Design (Python)

> **Difficulty:** Medium → Hard
> **Tags:** `[lld]` `[ood]` `[strategy]` `[graph-algorithm]` `[debt-simplification]`
> **Language:** Python 3.10+
> **Prep time:** ~10 min skim, ~30 min deep read
> **Companies that ask this:** Atlassian, Uber, Razorpay, Goldman Sachs, Microsoft, Amazon

---

## Beginner's Guide

### What's this in plain English?

You and friends share expenses. Alice paid $30 for dinner; everyone owes their share. The Splitwise app tracks: who owes whom, how much. The cool part: it can **simplify** chains. If A owes B $10 and B owes C $10, you can shortcut: A pays C $10, B is out of the loop. We minimize total transactions.

### Why solve it?

- **Real world**: Splitwise, Tricount, group expense tools.
- **Teaches**: graph algorithms (debt simplification = network flow simplification), Strategy pattern for split types (equal / exact / percentage), invariants ("everyone's balance sums to zero").
- **Interview**: tests problem-solving + design together.

### Vocabulary

- **Expense** — one event: who paid, who owes, how it splits.
- **Split** — how the cost is divided: equal, exact amounts, percentages.
- **Balance** — for user X: positive means others owe X; negative means X owes others.
- **Debt simplification** — collapse cycles into fewer direct transfers.

### High-level approach

Entities:
- **User** — id, name.
- **Group** — set of users.
- **Expense** — payer, total, splits (list of (user, amount)).
- **SplitStrategy** — interface; concrete: EqualSplit, ExactSplit, PercentSplit.
- **Service** — orchestrator; tracks balances per user pair (or per group).

State: keep `balance[user]` (sum across all transactions). After every expense, update balances.

Simplification: for users in a group, find the simplest set of payments that zero out balances. Greedy: largest creditor pays into largest debtor; repeat. This is O(N log N) per simplify.

### How to read this doc

- **Beginner**: focus on the simple expense → balance flow.
- **Interview**: simplification algorithm and Strategy for splits are the differentiators.

---

## 0. How to use this doc in an interview

Splitwise sits at the intersection of OOD and a classic graph-reduction algorithm. Interviewers grade on:
1. Did you model **expenses, splits, and balances** correctly? (Most candidates conflate the three.)
2. Did you separate **what was spent** from **what is owed** from **what is settled**?
3. Did you handle **multiple split types** with a clean abstraction? (Strategy.)
4. Could you **simplify debts** (A→B, B→C → A→C) when prompted? This is the differentiator.
5. Did you keep money math **exact** (no floats)?

Trap: jumping to debt simplification without first nailing the simple "balance per user" representation. Build the simple thing first; simplification is a layer on top.

---

## 1. Problem Statement

Build a system that lets a group of users track shared expenses, computes who owes whom, and supports settlement.

Core flow:
- Users create / join **groups**.
- Anyone records an **expense**: who paid, how much, who it should be split among, and *how* (equal / exact amounts / percentages / shares).
- The system maintains **balances**: net amount each user owes / is owed.
- Users settle: a payment from A to B reduces A's debt to B.
- The system can **simplify** the debt graph: instead of A→B→C→A circular debts, collapse to net flows.

---

## 2. Clarifying Questions to Ask the Interviewer

### Scope
- [ ] Just personal balances or full group support?
- [ ] What **split types**? (equal, exact, percentage, share/weight)
- [ ] Do we support **multiple currencies**? Conversion?
- [ ] Are expenses **mutable** (edit after the fact) or append-only?
- [ ] **Settlements** — manual record only, or actual payment integration?
- [ ] Do we **simplify debts** (graph reduction) or always show raw P2P?

### Domain
- [ ] What's the source of truth — a list of expenses, or running balance counters?
- [ ] Is there a concept of **involvement** (you participated even though paid 0)?
- [ ] Receipts / attachments / categories — in scope?

### Non-functional
- [ ] Concurrency: many users edit a group at once — last-write-wins or merge?
- [ ] Persistence: in-memory or DB?
- [ ] Approximate scale (groups, users per group)?

> **For this doc** we'll assume: groups + 1:1 friendships, four split types (equal / exact / percentage / share), single currency, expenses immutable (record a reverse expense to "undo"), in-memory thread-safe, on-demand debt simplification, library API.

---

## 3. Functional Requirements

**Must-have (P0):**
1. Create user, friendship, group.
2. Record expense with split type and split params.
3. Compute per-user balance (net owe/owed).
4. Compute pairwise balances (A owes B exactly $X).
5. Record settlement (A pays B $X).
6. List a user's friends and groups.
7. List all transactions for a user / group.

**Should-have (P1):**
8. **Simplify debts** in a group: produce a minimal-edge equivalent settlement graph.
9. Multiple currencies (with explicit conversion at expense time).
10. Mutable expenses (edit / delete with audit trail).

**Nice-to-have (P2 — out of scope for code, designed-for):**
11. Notifications.
12. Recurring expenses.
13. Receipt OCR.
14. Cross-group transfers.

---

## 4. Actors & Use Cases

```
                    ┌──────────────────┐
                    │ Splitwise System │
                    └──────────────────┘
                          ▲    ▲
                          │    │
                ┌─────────┘    └─────────┐
                │                         │
         ┌────────────┐            ┌────────────┐
         │   User     │            │   Admin    │
         │ (record    │            │ (manage    │
         │  expenses) │            │  groups)   │
         └────────────┘            └────────────┘
```

### User
- Create account, add friends, create group.
- Record expense, choose split, settle.
- View balances, transactions, simplified graph.

### Admin
- Out of scope here; would manage groups, soft-delete users, audit.

---

## 5. Core Entities

| Entity | Attributes | Notes |
|---|---|---|
| `User` | user_id, name, email | |
| `Friendship` | user_a, user_b, balance (signed) | (a→b debt; sign convention enforced) |
| `Group` | group_id, name, members (set), expenses (list), balances | Self-contained ledger |
| `Expense` | expense_id, paid_by, amount, split_type, split_params, participants, created_at | Immutable |
| `Settlement` | settlement_id, payer, payee, amount, group_id (optional), created_at | Immutable; reduces debt |
| `BalanceSheet` | per-user net + pairwise matrix | Derived |

**Enums:**
```
SplitType: EQUAL, EXACT, PERCENTAGE, SHARE
```

`Decimal` for all money — exact arithmetic, no floating-point error.

---

## 6. Class Diagram (ASCII)

```
                                ┌─────────────────────────────┐
                                │      SplitwiseService       │
                                │─────────────────────────────│
                                │ - users                     │
                                │ - groups                    │
                                │ - friendships               │
                                │ - lock: RLock               │
                                │─────────────────────────────│
                                │ + add_user                  │
                                │ + create_group              │
                                │ + record_expense            │
                                │ + record_settlement         │
                                │ + get_balance(user)         │
                                │ + simplify(group) ─→ list   │
                                └────┬────────────────────────┘
                                     │ ◆
                          ┌──────────┼──────────┐
                          ▼                     ▼
                 ┌────────────────┐    ┌──────────────────┐
                 │     User       │    │     Group        │
                 │────────────────│    │──────────────────│
                 │ - user_id      │    │ - group_id       │
                 │ - name         │    │ - name           │
                 │ - email        │    │ - members        │
                 └────────────────┘    │ - expenses[]     │◆──┐
                                       │ - settlements[]  │   │
                                       │ - balances{}     │   │
                                       └──────────────────┘   │
                                                              ▼
                                                    ┌──────────────────┐
                                                    │     Expense      │
                                                    │──────────────────│
                                                    │ - expense_id     │
                                                    │ - paid_by        │
                                                    │ - amount         │
                                                    │ - split: SplitStrategy │◇──┐
                                                    │ - participants   │       │
                                                    │ - created_at     │       │
                                                    └──────────────────┘       │
                                                                                ▼
                                                            ┌─────────────────────────┐
                                                            │ «interface»             │
                                                            │ SplitStrategy           │
                                                            │─────────────────────────│
                                                            │ + split(amount, parts)  │
                                                            │   → dict[user_id, amt]  │
                                                            └─────────▲───────────────┘
                                                                      │
                                                       ┌──────────────┼─────────────┐
                                                       │              │             │
                                                ┌──────┴────┐  ┌──────┴─────┐  ┌────┴────────┐
                                                │ EqualSplit │  │ ExactSplit │  │ PercentSplit │
                                                │            │  │            │  │             │
                                                └────────────┘  └────────────┘  └─────────────┘

  (separate, related)
  ┌──────────────────┐
  │   Settlement     │
  │──────────────────│
  │ - id             │
  │ - payer, payee   │
  │ - amount         │
  │ - group_id?      │
  └──────────────────┘
```

---

## 7. Design Patterns Used (and Why)

| Pattern | Where used | Why this pattern | Alternative considered |
|---|---|---|---|
| Strategy | `SplitStrategy` (Equal/Exact/Percent/Share) | 4 distinct split algorithms; runtime choice; open for new types | One method with `if split_type == ...` — fails open/closed |
| Factory | `SplitFactory.create(SplitType, params)` | Caller has type + params; factory dispatches to right concrete | Direct construction — leaks types |
| Facade | `SplitwiseService` | Single API for all operations | Per-class direct access — leaks internals |
| Visitor (NOT used) | — | Tempting for "iterate all expenses, compute X". Overkill — list iteration suffices |
| Observer (NOT used) | — | Useful for notification on balance change. Out of scope; bolt-on |

---

## 8. Sequence Diagrams

### 8.1 Record an expense

```
  User           Service           SplitFactory       Group        Expense
    │              │                    │              │              │
    │── expense ──▶│                    │              │              │
    │              │── split_strategy ─▶│              │              │
    │              │◀── strategy ───────│              │              │
    │              │── new Expense ─────────────────────────────────▶ │
    │              │── apply to balance ──────────────▶│              │
    │              │◀── ok ───────────────────────────│              │
    │◀── exp_id ───│                    │              │              │
```

### 8.2 Compute balance

```
  User           Service           Group
    │              │                │
    │── balance? ─▶│                │
    │              │── balances ───▶│
    │              │◀── {a:+5, b:-3, c:-2} ──│
    │◀── result ───│                │
```

### 8.3 Simplify debts

```
  User           Service           Group           Simplifier
    │              │                 │                │
    │── simplify ▶│                 │                │
    │              │── balances ────▶│                │
    │              │◀── balances ────│                │
    │              │── reduce ───────────────────────▶│
    │              │◀── min-edge graph ───────────────│
    │◀── txns ─────│                 │                │
```

---

## 9. Concurrency Considerations

- A coarse `RLock` on `SplitwiseService` for cross-cutting operations.
- Fine-grained per-group lock for high-traffic groups (extension).
- Expenses are immutable; settlements append-only — most reads can run lock-free if balances are also append-only.
- Implementation simplification: single `RLock` for all writes; reads acquire briefly to snapshot.

---

## 10. Full Working Code

```python
"""
Splitwise — Low-Level Design (Python)

Complete in-memory implementation:
- users, friendships, groups
- expenses with 4 split types (equal / exact / percentage / share)
- balance tracking (per-user and pairwise)
- settlements
- debt simplification via greedy max-flow (creditor/debtor matching)
"""

from __future__ import annotations

import enum
import heapq
import threading
import uuid
from abc import ABC, abstractmethod
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional


# ──────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────

CENTS = Decimal("0.01")


def round_money(x: Decimal) -> Decimal:
    """Always round money to 2 decimal places, half-up."""
    return x.quantize(CENTS, rounding=ROUND_HALF_UP)


def D(x) -> Decimal:
    """Coerce to Decimal safely (str/int/Decimal in)."""
    if isinstance(x, Decimal):
        return x
    return Decimal(str(x))


# ──────────────────────────────────────────────────────────────────────────
# Enums + value types
# ──────────────────────────────────────────────────────────────────────────

class SplitType(enum.Enum):
    EQUAL = "equal"
    EXACT = "exact"
    PERCENTAGE = "percentage"
    SHARE = "share"


@dataclass(frozen=True)
class User:
    user_id: str
    name: str
    email: str


@dataclass(frozen=True)
class Settlement:
    settlement_id: str
    payer_id: str
    payee_id: str
    amount: Decimal
    group_id: Optional[str]
    created_at: datetime


# ──────────────────────────────────────────────────────────────────────────
# Strategy: split algorithms
# ──────────────────────────────────────────────────────────────────────────

class SplitStrategy(ABC):
    @abstractmethod
    def split(
        self,
        amount: Decimal,
        participants: list[str],
        params: Optional[dict] = None,
    ) -> dict[str, Decimal]:
        """Return {user_id → owed amount}. Sum must equal `amount` (within rounding)."""


class EqualSplit(SplitStrategy):
    def split(self, amount, participants, params=None):
        n = len(participants)
        if n == 0:
            raise ValueError("EqualSplit needs participants")
        each = round_money(amount / D(n))
        result = {p: each for p in participants}
        # Distribute the rounding remainder onto first participant(s)
        diff = round_money(amount - each * n)
        if diff != 0:
            result[participants[0]] = round_money(result[participants[0]] + diff)
        return result


class ExactSplit(SplitStrategy):
    """params: {user_id → exact_amount}. Sum must equal `amount`."""
    def split(self, amount, participants, params=None):
        if not params:
            raise ValueError("ExactSplit requires params={user_id: amount}")
        amounts = {uid: round_money(D(v)) for uid, v in params.items()}
        if set(amounts.keys()) != set(participants):
            raise ValueError("ExactSplit params must cover exactly the participants")
        total = sum(amounts.values(), Decimal("0"))
        if round_money(total) != round_money(amount):
            raise ValueError(f"ExactSplit sum {total} != amount {amount}")
        return amounts


class PercentageSplit(SplitStrategy):
    """params: {user_id → percent}. Sum must equal 100."""
    def split(self, amount, participants, params=None):
        if not params:
            raise ValueError("PercentageSplit requires params={user_id: percent}")
        percents = {uid: D(v) for uid, v in params.items()}
        if set(percents.keys()) != set(participants):
            raise ValueError("PercentageSplit params must cover exactly the participants")
        if round_money(sum(percents.values(), Decimal("0"))) != Decimal("100.00"):
            raise ValueError("PercentageSplit percentages must sum to 100")
        result = {uid: round_money(amount * (p / D(100))) for uid, p in percents.items()}
        # Fix rounding remainder on first participant
        diff = round_money(amount - sum(result.values(), Decimal("0")))
        if diff != 0:
            first = participants[0]
            result[first] = round_money(result[first] + diff)
        return result


class ShareSplit(SplitStrategy):
    """params: {user_id → share}. Each user owes share/total_shares of amount."""
    def split(self, amount, participants, params=None):
        if not params:
            raise ValueError("ShareSplit requires params={user_id: shares}")
        shares = {uid: D(v) for uid, v in params.items()}
        if set(shares.keys()) != set(participants):
            raise ValueError("ShareSplit params must cover exactly the participants")
        total = sum(shares.values(), Decimal("0"))
        if total <= 0:
            raise ValueError("Total shares must be > 0")
        result = {uid: round_money(amount * (s / total)) for uid, s in shares.items()}
        diff = round_money(amount - sum(result.values(), Decimal("0")))
        if diff != 0:
            first = participants[0]
            result[first] = round_money(result[first] + diff)
        return result


class SplitFactory:
    @staticmethod
    def create(split_type: SplitType) -> SplitStrategy:
        return {
            SplitType.EQUAL:      EqualSplit(),
            SplitType.EXACT:      ExactSplit(),
            SplitType.PERCENTAGE: PercentageSplit(),
            SplitType.SHARE:      ShareSplit(),
        }[split_type]


# ──────────────────────────────────────────────────────────────────────────
# Expense (immutable)
# ──────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Expense:
    expense_id: str
    description: str
    paid_by: str
    amount: Decimal
    split_type: SplitType
    participants: tuple[str, ...]   # tuple for hashability
    split_params: Optional[dict]
    group_id: Optional[str]
    created_at: datetime
    # cached computed split (immutable)
    breakdown: dict[str, Decimal]   # who owes what (positive = owes)


# ──────────────────────────────────────────────────────────────────────────
# Group
# ──────────────────────────────────────────────────────────────────────────

@dataclass
class Group:
    group_id: str
    name: str
    members: set[str] = field(default_factory=set)
    expenses: list[Expense] = field(default_factory=list)
    settlements: list[Settlement] = field(default_factory=list)
    # balances: balance[u] = signed total. positive = group owes u (paid more than share).
    # In addition we keep a pairwise matrix for finer grained queries.
    balances: dict[str, Decimal] = field(default_factory=lambda: defaultdict(lambda: Decimal("0")))
    # pairwise[a][b] = how much b owes a (positive). Equivalently pairwise[b][a] = -pairwise[a][b].
    pairwise: dict[str, dict[str, Decimal]] = field(default_factory=lambda: defaultdict(lambda: defaultdict(lambda: Decimal("0"))))

    def add_member(self, user_id: str) -> None:
        self.members.add(user_id)


# ──────────────────────────────────────────────────────────────────────────
# Service (facade)
# ──────────────────────────────────────────────────────────────────────────

class SplitwiseService:
    def __init__(self) -> None:
        self._users: dict[str, User] = {}
        self._groups: dict[str, Group] = {}
        # 1:1 friendship balances: friendship[a][b] = b owes a (positive)
        self._friendship: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(lambda: Decimal("0")))
        self._lock = threading.RLock()

    # --- users ---

    def add_user(self, name: str, email: str) -> User:
        with self._lock:
            uid = str(uuid.uuid4())
            user = User(uid, name, email)
            self._users[uid] = user
            return user

    def get_user(self, user_id: str) -> User:
        return self._users[user_id]

    # --- groups ---

    def create_group(self, name: str, member_ids: list[str]) -> Group:
        with self._lock:
            for uid in member_ids:
                if uid not in self._users:
                    raise ValueError(f"unknown user {uid}")
            gid = str(uuid.uuid4())
            g = Group(group_id=gid, name=name)
            for uid in member_ids:
                g.add_member(uid)
            self._groups[gid] = g
            return g

    # --- expenses ---

    def record_expense(
        self,
        *,
        description: str,
        paid_by: str,
        amount,
        split_type: SplitType,
        participants: list[str],
        split_params: Optional[dict] = None,
        group_id: Optional[str] = None,
        now: Optional[datetime] = None,
    ) -> Expense:
        amount = round_money(D(amount))
        if amount <= 0:
            raise ValueError("amount must be positive")
        if paid_by not in participants:
            # Splitwise convention: payer is implicitly part of the split if equal/share/etc.
            # But we require explicit participants for clarity.
            raise ValueError("paid_by must be one of participants")

        with self._lock:
            for uid in participants:
                if uid not in self._users:
                    raise ValueError(f"unknown user {uid}")

            strategy = SplitFactory.create(split_type)
            breakdown = strategy.split(amount, participants, split_params)

            exp = Expense(
                expense_id=str(uuid.uuid4()),
                description=description,
                paid_by=paid_by,
                amount=amount,
                split_type=split_type,
                participants=tuple(participants),
                split_params=split_params,
                group_id=group_id,
                created_at=now or datetime.utcnow(),
                breakdown=dict(breakdown),
            )

            if group_id is not None:
                if group_id not in self._groups:
                    raise ValueError(f"unknown group {group_id}")
                g = self._groups[group_id]
                if not all(p in g.members for p in participants):
                    raise ValueError("all participants must be group members")
                g.expenses.append(exp)
                self._apply_to_group(g, exp)
            else:
                # 1:1 / personal: update friendship balances
                self._apply_to_friendship(exp)

            return exp

    def _apply_to_group(self, g: Group, exp: Expense) -> None:
        # Each participant `p` owes `breakdown[p]` to `paid_by`.
        # paid_by themselves owes `breakdown[paid_by]` of their own bill — net zero for self.
        for p, owed in exp.breakdown.items():
            if p == exp.paid_by:
                continue
            g.pairwise[exp.paid_by][p] = round_money(g.pairwise[exp.paid_by][p] + owed)
            g.pairwise[p][exp.paid_by] = round_money(g.pairwise[p][exp.paid_by] - owed)
            g.balances[exp.paid_by] = round_money(g.balances[exp.paid_by] + owed)
            g.balances[p] = round_money(g.balances[p] - owed)

    def _apply_to_friendship(self, exp: Expense) -> None:
        for p, owed in exp.breakdown.items():
            if p == exp.paid_by:
                continue
            self._friendship[exp.paid_by][p] = round_money(self._friendship[exp.paid_by][p] + owed)
            self._friendship[p][exp.paid_by] = round_money(self._friendship[p][exp.paid_by] - owed)

    # --- settlements ---

    def record_settlement(
        self,
        *,
        payer_id: str,
        payee_id: str,
        amount,
        group_id: Optional[str] = None,
        now: Optional[datetime] = None,
    ) -> Settlement:
        amount = round_money(D(amount))
        if amount <= 0:
            raise ValueError("settlement amount must be positive")
        with self._lock:
            sid = str(uuid.uuid4())
            s = Settlement(sid, payer_id, payee_id, amount, group_id, now or datetime.utcnow())
            if group_id is not None:
                g = self._groups[group_id]
                g.settlements.append(s)
                # payer paid payee: reduces payer's debt to payee.
                # If payee was owed by payer (payee→payer balance positive in pairwise[payee][payer]):
                g.pairwise[payee_id][payer_id] = round_money(g.pairwise[payee_id][payer_id] - amount)
                g.pairwise[payer_id][payee_id] = round_money(g.pairwise[payer_id][payee_id] + amount)
                g.balances[payer_id] = round_money(g.balances[payer_id] + amount)
                g.balances[payee_id] = round_money(g.balances[payee_id] - amount)
            else:
                self._friendship[payee_id][payer_id] = round_money(self._friendship[payee_id][payer_id] - amount)
                self._friendship[payer_id][payee_id] = round_money(self._friendship[payer_id][payee_id] + amount)
            return s

    # --- queries ---

    def get_group_balances(self, group_id: str) -> dict[str, Decimal]:
        with self._lock:
            g = self._groups[group_id]
            return {uid: round_money(bal) for uid, bal in g.balances.items() if bal != 0}

    def get_pairwise(self, group_id: str) -> dict[tuple[str, str], Decimal]:
        """{ (creditor, debtor): amount } — only positive entries."""
        with self._lock:
            g = self._groups[group_id]
            out = {}
            for a, m in g.pairwise.items():
                for b, v in m.items():
                    if v > 0:
                        out[(a, b)] = round_money(v)
            return out

    def get_friendship_balance(self, a: str, b: str) -> Decimal:
        """Positive = b owes a; negative = a owes b."""
        with self._lock:
            return round_money(self._friendship[a][b])

    # --- debt simplification ---

    def simplify_group(self, group_id: str) -> list[tuple[str, str, Decimal]]:
        """Greedy max-flow: produce a minimal set of (debtor, creditor, amount) txns
        equivalent to the current group balances.

        Algorithm:
          1. Compute net balance per user.
          2. Repeatedly: pick most-owed creditor and most-owing debtor.
             They settle min(|debtor|, creditor) — one becomes 0; the other diminishes.
          3. Continue until all balances ≈ 0.

        Output is a list of transactions to perform.
        """
        with self._lock:
            g = self._groups[group_id]
            # snapshot net balances
            net: dict[str, Decimal] = {uid: round_money(b) for uid, b in g.balances.items() if b != 0}
            # heaps: max-heap of creditors (positive), max-heap of debtors (we use min-heap on negated debt)
            creditors: list[tuple[Decimal, str]] = []  # (-amount, user)  -> max-heap by -amount means smallest (most negative) first
            debtors: list[tuple[Decimal, str]] = []
            for uid, bal in net.items():
                if bal > 0:
                    creditors.append((-bal, uid))
                elif bal < 0:
                    debtors.append((bal, uid))   # negative — most negative first
            heapq.heapify(creditors)
            heapq.heapify(debtors)

            txns: list[tuple[str, str, Decimal]] = []
            while creditors and debtors:
                neg_credit, c_uid = heapq.heappop(creditors)
                credit = -neg_credit
                deb, d_uid = heapq.heappop(debtors)
                debt = -deb

                pay = min(credit, debt)
                if pay > 0:
                    txns.append((d_uid, c_uid, round_money(pay)))

                remaining_credit = round_money(credit - pay)
                remaining_debt = round_money(debt - pay)
                if remaining_credit > 0:
                    heapq.heappush(creditors, (-remaining_credit, c_uid))
                if remaining_debt > 0:
                    heapq.heappush(debtors, (-remaining_debt, d_uid))

            return txns


# ──────────────────────────────────────────────────────────────────────────
# Demo
# ──────────────────────────────────────────────────────────────────────────

def _demo() -> None:
    s = SplitwiseService()
    alice = s.add_user("Alice", "a@x.com")
    bob   = s.add_user("Bob",   "b@x.com")
    carol = s.add_user("Carol", "c@x.com")
    dave  = s.add_user("Dave",  "d@x.com")

    g = s.create_group("Trip", [alice.user_id, bob.user_id, carol.user_id, dave.user_id])

    # Alice paid 400 for hotel; equal split among all 4
    s.record_expense(
        description="Hotel",
        paid_by=alice.user_id,
        amount=400,
        split_type=SplitType.EQUAL,
        participants=[alice.user_id, bob.user_id, carol.user_id, dave.user_id],
        group_id=g.group_id,
    )
    # Bob paid 90 for dinner; alice & bob & carol exact split (alice=30, bob=30, carol=30)
    s.record_expense(
        description="Dinner",
        paid_by=bob.user_id,
        amount=90,
        split_type=SplitType.EXACT,
        participants=[alice.user_id, bob.user_id, carol.user_id],
        split_params={alice.user_id: 30, bob.user_id: 30, carol.user_id: 30},
        group_id=g.group_id,
    )
    # Carol paid 60 for taxi; share split (alice=1, bob=2, carol=1, dave=2 → 1/6, 2/6, 1/6, 2/6)
    s.record_expense(
        description="Taxi",
        paid_by=carol.user_id,
        amount=60,
        split_type=SplitType.SHARE,
        participants=[alice.user_id, bob.user_id, carol.user_id, dave.user_id],
        split_params={alice.user_id: 1, bob.user_id: 2, carol.user_id: 1, dave.user_id: 2},
        group_id=g.group_id,
    )

    print("Balances (positive = group owes user):")
    for uid, bal in s.get_group_balances(g.group_id).items():
        name = s.get_user(uid).name
        print(f"  {name:>5}: {bal:>+8}")

    print("\nPairwise (creditor → debtor: amount):")
    for (a, b), amt in s.get_pairwise(g.group_id).items():
        print(f"  {s.get_user(a).name} ← {s.get_user(b).name}: {amt}")

    print("\nSimplified settlement plan (minimal-edge):")
    plan = s.simplify_group(g.group_id)
    for debtor, creditor, amt in plan:
        print(f"  {s.get_user(debtor).name} pays {s.get_user(creditor).name}: ${amt}")

    # Verify the plan actually settles all balances
    print("\nVerifying plan:")
    bals = dict(s.get_group_balances(g.group_id))
    for d, c, a in plan:
        bals[d] = bals.get(d, Decimal("0")) + a
        bals[c] = bals.get(c, Decimal("0")) - a
    bals = {u: round_money(v) for u, v in bals.items() if round_money(v) != 0}
    print(f"  Residual balances after plan: {bals}  (should be {{}})")
    assert all(v == 0 for v in bals.values()), "simplification failed to settle"

    # Concurrency smoke
    print("\n--- concurrency: 50 expenses in 50 threads ---")
    s2 = SplitwiseService()
    u = [s2.add_user(f"u{i}", f"u{i}@x.com") for i in range(5)]
    g2 = s2.create_group("ConcurrentTest", [x.user_id for x in u])

    def fire(i):
        s2.record_expense(
            description=f"e{i}",
            paid_by=u[i % 5].user_id,
            amount=Decimal("10.00"),
            split_type=SplitType.EQUAL,
            participants=[x.user_id for x in u],
            group_id=g2.group_id,
        )
    threads = [threading.Thread(target=fire, args=(i,)) for i in range(50)]
    for t in threads: t.start()
    for t in threads: t.join()

    # Total amount across all balances must be 0 (zero-sum game)
    total = sum(s2.get_group_balances(g2.group_id).values(), Decimal("0"))
    print(f"  Sum of balances: {round_money(total)}  (should be 0)")
    assert round_money(total) == 0


if __name__ == "__main__":
    _demo()
```

### How to run

```bash
python3 ~/Downloads/cc/kb/LLD/Python/splitwise.py
```

Expected output: shows balances after three expenses, simplified settlement plan that uses fewer transactions than the raw pairwise graph, and a concurrency smoke test that verifies the zero-sum property holds even under concurrent writes.

---

## 11. Cross-Questions ("Why X and not Y") — ≥ 12

### 11.1 Why Strategy for split types instead of an enum-driven `if/else`?

`if split_type == EQUAL: ... elif EXACT: ...` works for 4 cases. The moment we add a 5th (e.g. weighted-by-income, or per-receipt-line-item), the dispatch grows. Strategy isolates each algorithm in its own class with its own tests — open/closed for new types.

Bonus: each strategy validates its own params (`ExactSplit` requires sum-equal-amount; `PercentageSplit` requires sum-100). Centralizing validation in the strategy keeps the service code linear.

### 11.2 Why immutable `Expense` (frozen dataclass)?

- **Audit**: every recorded expense is permanent. Editing produces a new expense (or a reverse expense + replacement).
- **Concurrency**: shared without lock — read freely from any thread.
- **Hashability**: can be a key / set member.

Edits in real Splitwise are an additional layer: a "tombstone" + new expense. Don't mutate; record.

### 11.3 Why both per-user `balances` AND `pairwise` matrix in `Group`?

- `balances[u]` answers "do I owe / am I owed in this group?" in O(1).
- `pairwise[a][b]` answers "exactly how much does b owe a?" — needed if we display the unsimplified graph, OR if we simplify only when asked.

Keeping both costs O(N²) memory in users — fine for groups of ~100 members. We update both on every expense.

### 11.4 Why net balances and not store all expenses and recompute?

Recomputing from expense list on every read is O(E) per query. For a group with thousands of expenses queried often, that's expensive. Maintaining running balances is O(1) per query, O(P) per write (P = participants).

Trade-off: balances drift if writes have bugs. We keep the expense log as source of truth; balances are a denormalized view that can be regenerated by replaying the log if drift is suspected.

### 11.5 Why greedy max-flow simplification and not exact (NP-hard)?

The minimum-edge debt-simplification problem (find the smallest set of transactions to settle all balances) is NP-hard in the general case. Greedy creditor-debtor matching gives:
- O(N log N) time.
- Always produces ≤ N - 1 transactions (proved: at each step we zero out at least one user).
- The optimal can do better only when subsets of users have *exactly summing* balances — rare in practice.

Real Splitwise also uses a greedy approach. Optimal is reserved for academic curiosity.

### 11.6 Why heaps (priority queues) for simplification?

Max creditor + max debtor matching is the natural greedy step. A heap gives O(log N) extract-max. Without heap, scanning N users per step is O(N²) total — fine for small groups but poor for ~1000-member corporate groups.

### 11.7 Why `Decimal` for money and not `float` or `int` (cents)?

Floats: rounding errors compound. `0.1 + 0.2 != 0.3`.
Integer cents: works but is awkward — every input must be converted to cents and back; UI breaks if devs forget.
`Decimal` (arbitrary precision base-10): exact arithmetic, natural input, works.

In a tight DB-backed system we'd store *cents* (integer) at rest and convert at boundaries. In-memory, `Decimal` is the cleanest.

### 11.8 Why does `record_expense` require `paid_by ∈ participants`?

To prevent ambiguity:
- "Alice paid for Bob and Carol's lunch" — is Alice a participant? Splitwise's convention is that the payer is part of the split unless explicitly excluded.
- Forcing `paid_by ∈ participants` makes intent explicit. If Alice didn't eat (e.g. paid for friends' meal as a gift), the recorder should add Alice with explicit zero share via `ExactSplit` — making the gift visible in the split.

### 11.9 Why a `RLock` and not a `Lock`?

`record_expense` calls `_apply_to_group` which calls into other internal methods that may need the lock. A non-reentrant `Lock` would deadlock self. `RLock` allows the same thread to re-acquire.

If we strictly held the lock at the entry point and never re-entered, `Lock` would be fine. `RLock` is a small insurance against future refactors that introduce re-entry.

### 11.10 Why no event sourcing?

Event sourcing — store the log of expenses + settlements, derive all state — is a clean fit here (it's basically what we're doing with `Group.expenses` + `balances`). We chose to *also* maintain a denormalized `balances` for query speed.

A pure event-sourced version would compute balances on demand from the expense list. Trade-off: pay O(E) per query vs O(P) per write. For our scale and access pattern, denormalized wins.

### 11.11 What if two users record an expense at the same instant?

The single `RLock` serializes them. One commits first; the other sees the updated state when it acquires.

For higher throughput, switch to per-group lock — different groups are independent. A single hot group still serializes; that's fine because expenses are point-of-truth and conflict resolution would be ill-defined anyway.

### 11.12 Why include `group_id` on `Settlement` and `Expense` instead of inferring from membership?

Explicitness: a settlement may apply to a *specific* group (settle the trip's debts) or to a 1:1 friendship (no group). Storing `group_id` (nullable) makes intent unambiguous.

If we omitted, we'd have to guess based on context — fragile, especially when users are in many groups together.

### 11.13 What's the failure mode if rounding remainders accumulate over many expenses?

We push all remainders onto the first participant per expense. That single user takes the cent-by-cent imbalance. Over many expenses, they may consistently absorb 1¢ here, 1¢ there.

Mitigations:
- Rotate the "remainder absorber" — round-robin among participants or pick the one with the largest balance.
- Display rounding adjustments as a separate line in receipts.

For our design we keep it simple (first participant). Document the convention.

### 11.14 Why does `simplify_group` not mutate the group's balances?

Simplification produces a *suggested* settlement plan; users execute it via real settlements (or actual money transfers). The plan is a recommendation. Once they pay, they record settlements, which mutate balances normally.

If `simplify_group` mutated balances directly, we'd have lost the audit trail — there'd be no record of the actual money movement, just an algorithmic simplification.

### 11.15 What about multiple currencies?

Add `currency: str` to `Expense`. Convert at expense time to a base currency using a snapshot exchange rate (record the rate alongside the expense — exchange rates fluctuate, and historical accuracy matters).

Balances are kept in the group's base currency. Settlements record in the actual currency paid + the converted amount.

Significant additional complexity; out of scope for this design but designable on top.

---

## 12. Extensions

### 12.1 Mutable expenses (edit / delete)
Each edit creates a new expense with a `replaces` pointer to the previous. Audit trail preserved. Balances are recomputed by replaying the active expense set.

### 12.2 Multiple currencies
`currency` + `exchange_rate` on each `Expense`. Group has a `base_currency`; conversions happen at recording time.

### 12.3 Notifications
Observer pattern on balance changes. Library exposes `register_listener(callback)`; service emits events on every balance update.

### 12.4 Recurring expenses
A `RecurringExpense` template that fires monthly. Cron-like scheduling outside the LLD scope; integrates by calling `record_expense` on schedule.

### 12.5 Attachments / receipts
Add `attachments: list[URL]` to `Expense`. Storage is external (object storage); the model holds references only.

---

## 13. Cheat-Sheet Recap

1. **Problem:** Track shared expenses with multiple split types; compute balances; simplify debts.
2. **Core entities:** `User`, `Group`, `Expense`, `Settlement`, `SplitStrategy`.
3. **Patterns:** Strategy (split types), Factory (split creation), Facade (service).
4. **Money math:** `Decimal`, half-up rounding to cents, remainder absorbed by first participant.
5. **Balances:** Per-user net + pairwise matrix; updated incrementally; expense log is source of truth.
6. **Debt simplification:** Greedy creditor-debtor heap matching; ≤ N-1 transactions.
7. **Concurrency:** Single `RLock`; per-group lock as scaling extension.
8. **Trade-off accepted:** Greedy simplification (not optimal); denormalized balances (drift risk, mitigated by replay).
9. **Open extension points:** Mutable expenses, multi-currency, recurring, notifications.

---

## Appendix A: Test cases the interviewer will probe

```
1. Equal split of $100 among 3 → each owes $33.33; one absorbs 1¢ remainder.
2. Exact split where amounts don't sum to total → ValueError.
3. Percentage split where percents don't sum to 100 → ValueError.
4. Share split with shares (2,3,5) for $100 → 20, 30, 50.
5. Settlement reduces balance to 0 and stays at 0.
6. Settlement that overpays → balance flips sign (now A is owed by B).
7. Simplification of cycle (A→B 10, B→C 10, C→A 10) → empty plan (no actual debt).
8. Simplification of 5-user group → ≤ 4 transactions.
9. Concurrent expense recording → final sum-of-balances = 0 (zero-sum invariant).
10. Group with 0 expenses → balances dict empty; simplification plan empty.
```

## Appendix B: Why this question is loved by interviewers

```
- Tests OOD AND algorithm thinking in one question.
- Many natural pattern fits (Strategy, Factory, Facade) — easy to grade.
- Money math gotchas: Decimal vs float, rounding, sign conventions.
- Debt simplification: a real graph problem.
- Concurrency naturally surfaces (multi-user editing).
- Open-ended scope — never "done" — but easy to demo a working core.
```

## Appendix C: Common Python-specific gotchas

```
- `defaultdict(lambda: defaultdict(...))` is fine for in-memory but doesn't pickle cleanly.
- `Decimal(0.1)` ≠ `Decimal("0.1")` — float lit binds to float first. Always use str.
- frozen dataclass with `tuple` of mutable inner objects is shallow-frozen.
- `dict` ordering is insertion-ordered (Py 3.7+); rely on it for deterministic test output.
- Threading + Decimal: Decimal is thread-safe (immutable values), context is per-thread.
```

# Library Management — LLD (Python)

> **Difficulty:** Medium
> **Tags:** `[lld]` `[strategy]` `[state]` `[concurrency]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

A library: it has books (often multiple copies of the same title), members can check books out, return them, get fined for late returns. The system tracks who has what, when it's due, and who's allowed to borrow.

### Why solve it?

- **Real world**: libraries, but also any "borrow / return" model — equipment rental, gym lockers.
- **Teaches**: tracking copies vs titles, state per copy (AVAILABLE / CHECKED_OUT / LOST), fine policies.

### Vocabulary

- **Book** — a title (e.g., "Sapiens").
- **BookCopy / BookItem** — a physical instance (Sapiens copy #3). State per copy.
- **Member** — borrower; has membership tier (max books out, fine rate).
- **Loan / Checkout** — record of who has which copy, due date.
- **Fine** — penalty per day late.

### High-level approach

Entities:
- **Book** — title, author, ISBN.
- **BookCopy** — links to a Book, has state.
- **Member** — id, current loans count, max allowed.
- **Loan** — copy, member, checkout time, due time, returned time.
- **Library** — orchestrator: checkout, return, fine.
- **FineStrategy** — interface; flat rate or progressive.

Checkout flow: validate member → find available copy → mark CHECKED_OUT → create Loan.
Return flow: mark AVAILABLE → if late, compute fine.

### How to read this doc

- **Beginner**: focus on Book vs BookCopy distinction.
- **Interview**: discuss reservations, multi-branch libraries, recommendation features.

---

## 1. Problem Statement

Manage books, members, checkouts:
- Books with copies; multiple copies of same book.
- Members can borrow N books; due date.
- Returns; overdue fines.
- Reservations (hold a book).
- Search by title/author/ISBN.

---

## 2. Design

| Entity | Fields |
|---|---|
| `Book` | isbn, title, author |
| `BookCopy` | id, book, status (AVAILABLE/CHECKED_OUT/RESERVED/LOST) |
| `Member` | id, name, email, max_books |
| `Checkout` | copy_id, member_id, checked_at, due_at, returned_at |
| `Reservation` | book_isbn, member_id, ts |
| `Library` (facade) | manages all |

Pattern: State (BookCopy), Strategy (fine calculation), Facade.

---

## 3. Code

```python
"""Library Management."""
from __future__ import annotations
import enum
import threading
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Optional


class CopyStatus(enum.Enum):
    AVAILABLE = "available"
    CHECKED_OUT = "checked_out"
    RESERVED = "reserved"
    LOST = "lost"


class LibError(Exception): ...
class NotAvailable(LibError): ...
class LimitExceeded(LibError): ...


@dataclass(frozen=True)
class Book:
    isbn: str
    title: str
    author: str


@dataclass
class BookCopy:
    id: str
    book: Book
    status: CopyStatus = CopyStatus.AVAILABLE
    checked_out_to: Optional[str] = None


@dataclass
class Member:
    id: str
    name: str
    email: str
    max_books: int = 5


@dataclass(frozen=True)
class Checkout:
    copy_id: str
    member_id: str
    checked_at: datetime
    due_at: datetime
    returned_at: Optional[datetime] = None
    fine: Decimal = Decimal("0.00")


class Library:
    LOAN_DAYS = 14
    FINE_PER_DAY = Decimal("0.50")

    def __init__(self):
        self._books: dict[str, Book] = {}                  # isbn → book
        self._copies: dict[str, BookCopy] = {}            # copy_id → copy
        self._copies_by_book: dict[str, list[BookCopy]] = {}
        self._members: dict[str, Member] = {}
        self._checkouts: list[Checkout] = []
        self._active_by_member: dict[str, set[str]] = {}  # member_id → set(copy_id)
        self._reservation_queue: dict[str, deque[str]] = {}  # isbn → queue of member_ids
        self._lock = threading.RLock()

    def add_book(self, book: Book) -> None:
        self._books[book.isbn] = book

    def add_copy(self, isbn: str) -> BookCopy:
        copy = BookCopy(id=str(uuid.uuid4()), book=self._books[isbn])
        self._copies[copy.id] = copy
        self._copies_by_book.setdefault(isbn, []).append(copy)
        return copy

    def add_member(self, name: str, email: str) -> Member:
        m = Member(id=str(uuid.uuid4()), name=name, email=email)
        self._members[m.id] = m
        return m

    def search(self, query: str) -> list[Book]:
        q = query.lower()
        return [b for b in self._books.values()
                if q in b.title.lower() or q in b.author.lower() or q == b.isbn]

    def checkout(self, member_id: str, isbn: str, *, now: Optional[datetime] = None) -> Checkout:
        now = now or datetime.utcnow()
        with self._lock:
            member = self._members[member_id]
            active = self._active_by_member.get(member_id, set())
            if len(active) >= member.max_books:
                raise LimitExceeded()
            for copy in self._copies_by_book.get(isbn, []):
                if copy.status is CopyStatus.AVAILABLE:
                    copy.status = CopyStatus.CHECKED_OUT
                    copy.checked_out_to = member_id
                    co = Checkout(
                        copy_id=copy.id, member_id=member_id,
                        checked_at=now, due_at=now + timedelta(days=self.LOAN_DAYS),
                    )
                    self._checkouts.append(co)
                    self._active_by_member.setdefault(member_id, set()).add(copy.id)
                    return co
            raise NotAvailable(isbn)

    def return_book(self, copy_id: str, *, now: Optional[datetime] = None) -> Checkout:
        now = now or datetime.utcnow()
        with self._lock:
            copy = self._copies[copy_id]
            if copy.status is not CopyStatus.CHECKED_OUT:
                raise LibError(f"copy {copy_id} not checked out")
            # Find latest checkout for this copy
            for i, c in enumerate(reversed(self._checkouts)):
                if c.copy_id == copy_id and c.returned_at is None:
                    fine = max(Decimal("0"), Decimal((now - c.due_at).days) * self.FINE_PER_DAY)
                    new_co = Checkout(**{**c.__dict__, "returned_at": now, "fine": fine})
                    self._checkouts[len(self._checkouts) - 1 - i] = new_co
                    self._active_by_member[c.member_id].discard(copy_id)
                    # Reservations next?
                    queue = self._reservation_queue.get(copy.book.isbn)
                    if queue:
                        next_member = queue.popleft()
                        copy.status = CopyStatus.RESERVED
                        # Notify next_member (out of band)
                    else:
                        copy.status = CopyStatus.AVAILABLE
                        copy.checked_out_to = None
                    return new_co
            raise LibError("no active checkout for copy")

    def reserve(self, member_id: str, isbn: str) -> int:
        with self._lock:
            queue = self._reservation_queue.setdefault(isbn, deque())
            queue.append(member_id)
            return len(queue)


# Tests
def main():
    lib = Library()
    book = Book(isbn="978-0", title="The Pragmatic Programmer", author="Hunt")
    lib.add_book(book)
    c1 = lib.add_copy("978-0")
    c2 = lib.add_copy("978-0")
    alice = lib.add_member("Alice", "a@x.com")
    bob = lib.add_member("Bob", "b@x.com")

    print("--- search ---")
    found = lib.search("pragmatic")
    assert found and found[0].isbn == "978-0"
    print("  OK")

    print("--- checkout + return ---")
    co = lib.checkout(alice.id, "978-0")
    assert c1.status is CopyStatus.CHECKED_OUT or c2.status is CopyStatus.CHECKED_OUT
    new_co = lib.return_book(co.copy_id)
    assert new_co.returned_at is not None
    print("  OK")

    print("--- both copies out ---")
    lib.checkout(alice.id, "978-0")
    lib.checkout(bob.id, "978-0")
    try:
        lib.checkout(alice.id, "978-0")
    except NotAvailable:
        pass
    print("  OK")

    print("--- overdue fine ---")
    lib2 = Library()
    lib2.add_book(book)
    lib2.add_copy("978-0")
    alice2 = lib2.add_member("A", "a@x.com")
    base = datetime(2026, 1, 1)
    co2 = lib2.checkout(alice2.id, "978-0", now=base)
    new_co2 = lib2.return_book(co2.copy_id, now=base + timedelta(days=20))
    # 20 - 14 = 6 days overdue × $0.50 = $3
    assert new_co2.fine == Decimal("3.00"), new_co2.fine
    print(f"  fine={new_co2.fine}")

    print("\nAll tests passed.")


if __name__ == "__main__":
    main()
```

---

## 4. Cheat-Sheet
1. Book has multiple Copies.
2. Copy has state: AVAILABLE/CHECKED_OUT/RESERVED/LOST.
3. Checkout: pick available copy; due date.
4. Return: compute fine; possibly assign to next reservation.
5. Per-member borrow limit.

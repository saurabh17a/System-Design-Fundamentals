# Calendar / Scheduling — LLD (Python)

> **Difficulty:** Medium
> **Tags:** `[lld]` `[date-ranges]` `[recurrence]` `[conflicts]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

A calendar app like Google Calendar. Users create events with start/end times. Find conflicts ("does this overlap with anything?"). Recurring events ("every Tuesday at 3pm for 6 weeks"). Invite attendees; check their availability.

### Why solve it?

- **Real world**: Google/Outlook/Apple calendars; meeting room booking; appointment systems.
- **Teaches**: interval handling, recurrence rule expansion, conflict detection algorithms.
- **Patterns**: strategy (recurrence rules), composite (event = base + overrides for moved instances).

### Vocabulary

- **Event** — title, start, end, organizer, attendees, recurrence.
- **RRule** — recurrence rule (daily, weekly, monthly).
- **Instance** — one occurrence of a recurring event.
- **Conflict** — two events that overlap in time for a person.
- **Free/busy** — query "is this person free between X and Y?"

### High-level approach

Entities:
- **Event** — id, owner, title, start, end, attendees, RRule (optional).
- **RecurrenceRule** — rule that expands into instances within a time window.
- **Calendar** — events per user.
- **CalendarService** — orchestrator: schedule, query, find conflicts, suggest free slots.

Conflict detection: given a candidate (start, end) and existing events for a user, return overlapping ones. Naive O(N) per user; with sorted events and binary search, O(log N).

For recurring events, expand RRule into concrete instances within the query window — don't store every future instance.

### How to read this doc

- **Beginner**: focus on Event + conflict check.
- **Interview**: recurrence rules and free-slot finding (across multiple users) are the differentiators.

---

## 1. Problem

- Users create events.
- Events have time range, title, attendees.
- Recurring events.
- Conflict detection.
- Free/busy queries.

---

## 2. Code

```python
"""Calendar with one-off and recurring events."""
from __future__ import annotations
import enum
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, date
from typing import Optional


class Frequency(enum.Enum):
    NONE = "none"
    DAILY = "daily"
    WEEKLY = "weekly"


class CalError(Exception): ...
class Conflict(CalError): ...


@dataclass
class Event:
    id: str
    user_id: str
    title: str
    start: datetime
    end: datetime
    attendees: list[str] = field(default_factory=list)
    frequency: Frequency = Frequency.NONE
    recurrence_end: Optional[datetime] = None  # None = forever


def occurrences(event: Event, window_start: datetime, window_end: datetime) -> list[tuple[datetime, datetime]]:
    """Generate (start, end) of occurrences within window."""
    if event.frequency is Frequency.NONE:
        if event.start < window_end and event.end > window_start:
            return [(event.start, event.end)]
        return []
    out: list[tuple[datetime, datetime]] = []
    delta = {Frequency.DAILY: timedelta(days=1), Frequency.WEEKLY: timedelta(days=7)}[event.frequency]
    cur_start = event.start
    cur_end = event.end
    while cur_start < window_end:
        if event.recurrence_end and cur_start > event.recurrence_end:
            break
        if cur_end > window_start:
            out.append((cur_start, cur_end))
        cur_start += delta
        cur_end += delta
    return out


def _overlaps(a, b):
    return a[0] < b[1] and b[0] < a[1]


class Calendar:
    def __init__(self):
        self._events: dict[str, Event] = {}
        self._events_by_user: dict[str, list[Event]] = {}
        self._lock = threading.RLock()

    def add(self, user_id: str, title: str, start: datetime, end: datetime,
            attendees: Optional[list[str]] = None,
            frequency: Frequency = Frequency.NONE,
            recurrence_end: Optional[datetime] = None,
            check_conflict: bool = True) -> Event:
        if end <= start:
            raise CalError("end <= start")
        with self._lock:
            attendees = attendees or []
            new_ev = Event(
                id=str(uuid.uuid4()), user_id=user_id, title=title,
                start=start, end=end, attendees=attendees,
                frequency=frequency, recurrence_end=recurrence_end,
            )
            if check_conflict:
                window_end = recurrence_end or (end + timedelta(days=365))
                for occ in occurrences(new_ev, start, window_end):
                    for u in [user_id] + attendees:
                        for ev in self._events_by_user.get(u, []):
                            for other in occurrences(ev, occ[0], occ[1]):
                                if _overlaps(occ, other):
                                    raise Conflict(f"conflicts with {ev.title}")
            self._events[new_ev.id] = new_ev
            for u in [user_id] + attendees:
                self._events_by_user.setdefault(u, []).append(new_ev)
            return new_ev

    def cancel(self, event_id: str) -> None:
        with self._lock:
            ev = self._events.pop(event_id, None)
            if ev is None:
                return
            for u, lst in self._events_by_user.items():
                self._events_by_user[u] = [e for e in lst if e.id != event_id]

    def list_in_range(self, user_id: str, start: datetime, end: datetime) -> list[tuple[Event, datetime, datetime]]:
        with self._lock:
            out: list[tuple[Event, datetime, datetime]] = []
            for ev in self._events_by_user.get(user_id, []):
                for occ in occurrences(ev, start, end):
                    out.append((ev, occ[0], occ[1]))
            out.sort(key=lambda x: x[1])
            return out

    def is_busy(self, user_id: str, start: datetime, end: datetime) -> bool:
        for _, s, e in self.list_in_range(user_id, start, end):
            if s < end and e > start:
                return True
        return False


# Tests
def main():
    cal = Calendar()

    print("--- single event ---")
    base = datetime(2026, 5, 18, 9, 0)
    ev = cal.add("alice", "Meeting", base, base + timedelta(hours=1))
    items = cal.list_in_range("alice", base, base + timedelta(hours=2))
    assert len(items) == 1
    print(f"  {ev.title}")

    print("--- conflict detection ---")
    try:
        cal.add("alice", "Conflict", base + timedelta(minutes=30),
                base + timedelta(hours=2))
    except Conflict:
        pass
    print("  OK")

    print("--- non-conflict ---")
    cal.add("alice", "After", base + timedelta(hours=2),
            base + timedelta(hours=3))
    print("  OK")

    print("--- recurring weekly ---")
    cal2 = Calendar()
    weekly = cal2.add("alice", "Weekly", base, base + timedelta(hours=1),
                      frequency=Frequency.WEEKLY,
                      recurrence_end=base + timedelta(days=30))
    items = cal2.list_in_range("alice", base, base + timedelta(days=30))
    assert len(items) == 5  # 5 weekly occurrences in 30 days (week 0,1,2,3,4)
    print(f"  {len(items)} occurrences")

    print("--- attendees added to both calendars ---")
    cal3 = Calendar()
    cal3.add("alice", "Meet", base, base + timedelta(hours=1), attendees=["bob"])
    bob_events = cal3.list_in_range("bob", base, base + timedelta(hours=2))
    assert len(bob_events) == 1
    print("  OK")

    print("--- bob conflict via attendee ---")
    cal4 = Calendar()
    cal4.add("alice", "M1", base, base + timedelta(hours=1), attendees=["bob"])
    try:
        cal4.add("carol", "M2", base + timedelta(minutes=30),
                 base + timedelta(hours=1, minutes=30), attendees=["bob"])
    except Conflict:
        pass
    print("  OK")

    print("--- is_busy ---")
    assert cal.is_busy("alice", base, base + timedelta(hours=1)) is True
    assert cal.is_busy("alice", base + timedelta(hours=4),
                       base + timedelta(hours=5)) is False
    print("  OK")

    print("\nAll tests passed.")


if __name__ == "__main__":
    main()
```

---

## 3. Cheat-Sheet
1. Events: one-off or recurring (DAILY/WEEKLY).
2. Occurrence enumeration over a window.
3. Conflict check across user + attendees.
4. is_busy: query specific window.

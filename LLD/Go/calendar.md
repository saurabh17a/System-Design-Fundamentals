# Calendar / Scheduling — LLD (Go)

> **Difficulty:** Medium
> **Tags:** `[lld]` `[recurrence]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

Google Calendar at LLD scale. Events have times, recurrence (every Mon at 3pm), attendees. Detect conflicts. Find free slots.

### Why solve it?

- **Real world**: Google/Outlook calendars, meeting room booking, appointments.
- **Teaches**: interval handling, recurrence expansion, conflict detection.

### Vocabulary

- **Event** — start, end, attendees, recurrence rule.
- **RRule** — daily/weekly/monthly recurrence.
- **Instance** — one occurrence of a recurring event.
- **Conflict** — overlap in a user's calendar.

### High-level approach

Entities: **Event**, **RecurrenceRule**, **Calendar**, **CalendarService**.

Conflict check: with sorted events, binary search for overlapping range. O(log N) per query.
Recurrence: expand RRule to instances within a query window — don't pre-store infinite future events.

### How to read this doc

- **Beginner**: Event + conflict check.
- **Interview**: recurrence + free-slot across users are the differentiators.

---

## 1. Code

```go
package main

import (
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"
)

type Frequency int

const (
	None Frequency = iota
	Daily
	Weekly
)

var ErrConflict = errors.New("conflict")

type Event struct {
	ID, UserID, Title string
	Start, End        time.Time
	Attendees         []string
	Frequency         Frequency
	RecurrenceEnd     time.Time // zero = forever
}

func occurrences(e *Event, ws, we time.Time) []time.Time {
	if e.Frequency == None {
		if e.Start.Before(we) && e.End.After(ws) {
			return []time.Time{e.Start}
		}
		return nil
	}
	delta := time.Hour * 24
	if e.Frequency == Weekly {
		delta = time.Hour * 24 * 7
	}
	var out []time.Time
	cur := e.Start
	dur := e.End.Sub(e.Start)
	for cur.Before(we) {
		if !e.RecurrenceEnd.IsZero() && cur.After(e.RecurrenceEnd) {
			break
		}
		if cur.Add(dur).After(ws) {
			out = append(out, cur)
		}
		cur = cur.Add(delta)
	}
	return out
}

func overlap(aS, aE, bS, bE time.Time) bool {
	return aS.Before(bE) && bS.Before(aE)
}

type Calendar struct {
	mu          sync.Mutex
	events      map[string]*Event
	byUser      map[string][]*Event
	idCount     int
}

func NewCalendar() *Calendar {
	return &Calendar{events: map[string]*Event{}, byUser: map[string][]*Event{}}
}

func (c *Calendar) Add(userID, title string, start, end time.Time,
	attendees []string, freq Frequency, recurrenceEnd time.Time, checkConflict bool) (*Event, error) {
	if !end.After(start) {
		return nil, errors.New("end <= start")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.idCount++
	ev := &Event{
		ID: fmt.Sprintf("e-%d", c.idCount), UserID: userID, Title: title,
		Start: start, End: end, Attendees: attendees,
		Frequency: freq, RecurrenceEnd: recurrenceEnd,
	}
	if checkConflict {
		windowEnd := recurrenceEnd
		if windowEnd.IsZero() {
			windowEnd = end.Add(365 * 24 * time.Hour)
		}
		for _, occ := range occurrences(ev, start, windowEnd) {
			users := append([]string{userID}, attendees...)
			for _, u := range users {
				for _, other := range c.byUser[u] {
					dur := ev.End.Sub(ev.Start)
					for _, occOther := range occurrences(other, occ, occ.Add(dur)) {
						otherDur := other.End.Sub(other.Start)
						if overlap(occ, occ.Add(dur), occOther, occOther.Add(otherDur)) {
							return nil, ErrConflict
						}
					}
				}
			}
		}
	}
	c.events[ev.ID] = ev
	users := append([]string{userID}, attendees...)
	for _, u := range users {
		c.byUser[u] = append(c.byUser[u], ev)
	}
	return ev, nil
}

func (c *Calendar) ListInRange(userID string, start, end time.Time) []*Event {
	c.mu.Lock()
	defer c.mu.Unlock()
	var matching []*Event
	for _, ev := range c.byUser[userID] {
		if len(occurrences(ev, start, end)) > 0 {
			matching = append(matching, ev)
		}
	}
	sort.Slice(matching, func(i, j int) bool { return matching[i].Start.Before(matching[j].Start) })
	return matching
}

// Tests
func main() {
	cal := NewCalendar()
	base := time.Date(2026, 5, 18, 9, 0, 0, 0, time.UTC)
	_, err := cal.Add("alice", "Meeting", base, base.Add(time.Hour), nil, None, time.Time{}, true)
	if err != nil {
		panic(err)
	}
	_, err = cal.Add("alice", "Conflict", base.Add(30*time.Minute), base.Add(2*time.Hour), nil, None, time.Time{}, true)
	if !errors.Is(err, ErrConflict) {
		panic("expected conflict")
	}
	_, err = cal.Add("alice", "After", base.Add(2*time.Hour), base.Add(3*time.Hour), nil, None, time.Time{}, true)
	if err != nil {
		panic(err)
	}

	// Recurring
	cal2 := NewCalendar()
	_, _ = cal2.Add("alice", "Weekly", base, base.Add(time.Hour), nil, Weekly,
		base.Add(30*24*time.Hour), false)
	events := cal2.ListInRange("alice", base, base.Add(30*24*time.Hour))
	if len(events) == 0 {
		panic("expected recurring")
	}

	fmt.Println("All tests passed.")
}
```

---

## 2. Cheat-Sheet
1. Events: one-off or recurring (Daily/Weekly).
2. Occurrence enumeration in window.
3. Conflict check across user + attendees.

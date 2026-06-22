# Snake and Ladder — LLD (Python)

> **Difficulty:** Easy → Medium
> **Tags:** `[lld]` `[game]` `[state-machine]` `[strategy]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

A children's board game. 100 cells in a snake pattern. Each player rolls a die and advances. Some cells have a snake (slide down) or ladder (climb up). First to reach cell 100 wins.

### Why solve it?

- **Easy OOD warmup** — testable, full-cycle (init → play → end).
- **Teaches**: configurable rules (snakes/ladders are just `dict[int, int]`), strategy pattern (different die-rolling rules), turn-based state machines.

### Vocabulary

- **Cell** — a square on the board (1 to N²).
- **Snake / Ladder** — `(start, end)`. Snake: end < start. Ladder: end > start.
- **Die** — random number generator. Sometimes "must roll 6 to start", sometimes "extra turn on 6".
- **Turn** — one player's move.

### High-level approach

Entities:
- **Board** — size N + dict of `cell → cell` (snakes and ladders combined).
- **Player** — id, current position.
- **Die** — interface; concrete: standard 1-6, two-dice-sum, etc.
- **Game** — players, board, die, current turn, winner.

Move logic:
1. Roll die.
2. New pos = current + roll.
3. If on a snake/ladder, jump.
4. If new pos > N, you can't move (or you bounce, depending on rules).
5. If new pos == N, win.

Strategy pattern fits naturally for the die: swap implementations without touching `Game`.

### How to read this doc

- **Beginner**: trace one full game on paper.
- **Interview**: discuss configurability (multi-dice, bounce-back, must-roll-6, two-snakes-stacked).

---

## 1. Problem Statement

N×N board (default 100). Multiple players. Each rolls a die; advances. Snakes pull down; ladders push up. First to (or past) cell N wins.

---

## 2. Design

| Entity |
|---|
| `Player` (id, name, position) |
| `Snake` (head, tail) |
| `Ladder` (start, end) |
| `Dice` (interface; std 6-sided + custom) |
| `Game` (board_size, players, snakes, ladders, current, state) |

Pattern: Strategy (Dice), State (game state).

---

## 3. Code

```python
"""Snake and Ladder."""
from __future__ import annotations
import enum
import random
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional


class GameState(enum.Enum):
    IN_PROGRESS = "in_progress"
    WON = "won"


@dataclass
class Player:
    id: str
    name: str
    position: int = 0


@dataclass(frozen=True)
class Snake:
    head: int
    tail: int


@dataclass(frozen=True)
class Ladder:
    start: int
    end: int


class Dice(ABC):
    @abstractmethod
    def roll(self) -> int: ...


class SixSidedDice(Dice):
    def __init__(self, seed: Optional[int] = None):
        self._rng = random.Random(seed)
    def roll(self) -> int:
        return self._rng.randint(1, 6)


class FixedDice(Dice):
    """For tests."""
    def __init__(self, sequence: list[int]):
        self._seq = list(sequence)
    def roll(self) -> int:
        return self._seq.pop(0)


@dataclass
class Game:
    board_size: int = 100
    players: list[Player] = field(default_factory=list)
    snakes: dict[int, int] = field(default_factory=dict)  # head → tail
    ladders: dict[int, int] = field(default_factory=dict) # start → end
    dice: Dice = field(default_factory=SixSidedDice)
    current_idx: int = 0
    state: GameState = GameState.IN_PROGRESS
    winner: Optional[Player] = None

    def add_player(self, name: str) -> Player:
        p = Player(id=str(len(self.players) + 1), name=name)
        self.players.append(p)
        return p

    def add_snake(self, head: int, tail: int) -> None:
        if head <= tail:
            raise ValueError("snake head > tail")
        if head in self.ladders:
            raise ValueError("conflicting ladder/snake at " + str(head))
        self.snakes[head] = tail

    def add_ladder(self, start: int, end: int) -> None:
        if end <= start:
            raise ValueError("ladder start < end")
        if start in self.snakes:
            raise ValueError("conflicting snake/ladder at " + str(start))
        self.ladders[start] = end

    def turn(self) -> dict:
        if self.state is not GameState.IN_PROGRESS:
            return {"state": "won", "winner": self.winner.name}
        player = self.players[self.current_idx]
        roll = self.dice.roll()
        new_pos = player.position + roll
        if new_pos > self.board_size:
            # bounce back? Or stay? Common rule: stay put.
            return {
                "player": player.name, "rolled": roll, "stayed": True, "position": player.position,
            }
        # snakes / ladders
        bumped: list[str] = []
        while True:
            if new_pos in self.snakes:
                bumped.append(f"snake {new_pos}→{self.snakes[new_pos]}")
                new_pos = self.snakes[new_pos]
            elif new_pos in self.ladders:
                bumped.append(f"ladder {new_pos}→{self.ladders[new_pos]}")
                new_pos = self.ladders[new_pos]
            else:
                break
        player.position = new_pos
        out = {
            "player": player.name, "rolled": roll, "position": new_pos,
            "bumped": bumped, "won": False,
        }
        if new_pos == self.board_size:
            self.state = GameState.WON
            self.winner = player
            out["won"] = True
        else:
            self.current_idx = (self.current_idx + 1) % len(self.players)
        return out


# Tests
def main():
    print("--- ladder ---")
    g = Game(dice=FixedDice([3, 1, 1, 1, 1]))
    p = g.add_player("A")
    g.add_player("B")
    g.add_ladder(3, 22)
    r = g.turn()
    assert p.position == 22
    print(f"  {r}")

    print("--- snake ---")
    g = Game(dice=FixedDice([5]))
    p = g.add_player("A")
    g.add_player("B")
    g.add_snake(5, 1)
    r = g.turn()
    assert p.position == 1
    print(f"  {r}")

    print("--- win ---")
    g = Game(board_size=10, dice=FixedDice([4, 6]))
    p = g.add_player("A")
    g.add_player("B")
    g.turn()  # A → 4
    g.turn()  # B → 6
    g.dice = FixedDice([6, 6])  # A → 10 win
    r = g.turn()
    assert g.state is GameState.WON
    assert g.winner.name == "A"
    print(f"  {r}")

    print("--- overshoot stays ---")
    g = Game(board_size=10, dice=FixedDice([6]))
    p = g.add_player("A")
    g.add_player("B")
    p.position = 7
    r = g.turn()
    assert p.position == 7  # stayed
    print(f"  {r}")

    print("--- chained snake/ladder ---")
    g = Game(dice=FixedDice([3]))
    p = g.add_player("A")
    g.add_player("B")
    g.add_ladder(3, 10)
    g.add_snake(10, 2)  # land on ladder, then snake
    r = g.turn()
    assert p.position == 2  # ladder to 10 then snake to 2
    print(f"  {r}")

    print("\nAll tests passed.")


if __name__ == "__main__":
    main()
```

---

## 4. Cross-Questions

### 4.1 What if landing on a snake-head after a ladder?
Chain effect: ladder up, then snake down. Loop until stable. We implement.

### 4.2 Overshoot rule?
Common: stay put if roll exceeds N. Our impl follows this.

### 4.3 Why Strategy for Dice?
- Test with FixedDice (deterministic).
- Production: SixSidedDice.

### 4.4 Concurrency?
Single-threaded turn-based; no lock needed.

### 4.5 Multiple winners possible?
Standard: first to N wins; game ends.

---

## 5. Cheat-Sheet
1. Board cells 1..N.
2. Roll → advance → resolve snake/ladder loops.
3. Overshoot → stay.
4. State: IN_PROGRESS → WON.
5. Dice as Strategy for testability.

# Connect Four — Low-Level Design (Python)

> **Difficulty:** Medium
> **Tags:** `[lld]` `[ood]` `[game]` `[state-machine]` `[grid]`
> **Language:** Python 3.10+
> **Prep time:** ~10 min skim, ~25 min deep read
> **Companies that ask this:** Amazon, Microsoft, Google, Atlassian, Bloomberg

---

## Beginner's Guide

### What's this in plain English?

Like Tic Tac Toe but **gravity matters**. You have a 7×6 grid mounted vertically. Players drop discs (red and yellow) into columns; discs fall to the bottom-most empty spot. First to get 4 in a row (horizontal, vertical, diagonal) wins.

The interview version often generalizes: configurable rows × cols, K-in-a-row to win.

### Why solve it?

- **One step harder than Tic Tac Toe** — same skeleton + the gravity twist.
- **Teaches**: column-based input (vs row,col), efficient win detection, separating game logic from input.
- **Patterns**: state machine, strategy (player types), factory (player creation).

### Vocabulary

- **Column** — vertical slice; a move specifies just a column.
- **Drop** — disc falls to lowest empty cell in the column.
- **K-in-a-row** — winning condition (4 by default).
- **Gravity** — discs always fill from the bottom.

### High-level approach

Entities:
- **Board** — 2D grid (rows × cols). Knows: drop disc into column, check win after a drop.
- **Player** — id, color (Red/Yellow).
- **Game** — players, turn, board, state.

Drop logic: scan column from the bottom up; first empty cell gets the disc.

Win detection: after dropping at `(r, c)`, check 4 directions through that cell — horizontal, vertical, two diagonals. Don't scan the whole board.

### How to read this doc

- **Beginner**: focus on drop + win-after-drop logic.
- **Interview**: discuss generalization to N-in-a-row Connect K, AI strategies (minimax with alpha-beta).

---

## 0. How to use this doc in an interview

Connect Four is a game-design OOD that tests:
1. **Grid / matrix modeling** — pick a representation (list-of-lists vs flat).
2. **Game state machine** — IN_PROGRESS / WON / DRAW.
3. **Win detection** — naive O(N×M) scan vs **smart O(1)-from-last-move**. Show the smart one.
4. **Move validation** — column full? game over?
5. **Extensibility** — variable board size, custom win-length (Connect-K), AI hooks.

The trap: scanning the entire board after every move. Real bots scan **from the just-placed piece** along the 4 axes (horizontal, vertical, two diagonals) — O(K) per check. Show this.

---

## 1. Problem Statement

A two-player game on a 7-column × 6-row board. Players alternate dropping discs into columns; gravity pulls each disc to the lowest empty cell in that column. The first player to align 4 discs (horizontal / vertical / diagonal) wins. If the board fills before either wins, the game is a draw.

The system must:
- Model the board, players, moves.
- Validate moves (legal column, game still in progress).
- Detect win after each move efficiently.
- Detect draw (board full).
- Support undo (optional).
- Support custom dimensions (extension).

---

## 2. Clarifying Questions

### Scope
- [ ] Standard 7×6 or configurable?
- [ ] Win length 4 or configurable (Connect-K)?
- [ ] Two-player or N-player (rare; some variants)?
- [ ] AI opponent in scope?
- [ ] Undo / takeback?
- [ ] Time controls (chess clock-style)?
- [ ] Spectator mode? Persistence (save/load)?

### Domain
- [ ] What if a player tries an invalid move — error or skip?
- [ ] Player IDs — strings, ints, enum colors (Red/Yellow)?
- [ ] CLI render / GUI / library? (Library only.)

### Non-functional
- [ ] Concurrency: server-side multi-game? (We design per-game; many instances run in parallel.)
- [ ] Memory: trivial.

> **For this doc:** standard 7×6, win length 4, two players (Red/Yellow), undo supported, no AI (designed-for), library API, single-game-per-instance.

---

## 3. Functional Requirements

**Must-have (P0):**
1. `drop(column, player) → result` — places piece, advances state, returns outcome.
2. Strict turn order; reject if wrong player tries to move.
3. Reject if column is full.
4. Reject if game already over.
5. Detect win (4 in a row) immediately after the winning move.
6. Detect draw when board fills with no winner.
7. Inspect board state.

**Should-have (P1):**
8. `undo()` — revert the last move.
9. `legal_columns()` — list of non-full columns.
10. Configurable dimensions and win length.

**Nice-to-have (P2 — designed):**
11. AI opponent (minimax / MCTS).
12. Save/load game.
13. Move history with timestamps.
14. Spectator subscriptions (Observer).

---

## 4. Actors & Use Cases

```
                    ┌──────────────────┐
                    │   Connect Four   │
                    │      Game        │
                    └──────────────────┘
                         ▲      ▲
                         │      │
                ┌────────┘      └───────┐
                │                       │
        ┌──────────────┐         ┌──────────────┐
        │  Player A    │         │  Player B    │
        │ (Red, drops) │         │ (Yellow)     │
        └──────────────┘         └──────────────┘
```

---

## 5. Core Entities

| Entity | Attributes | Notes |
|---|---|---|
| `Disc` | enum: EMPTY, RED, YELLOW | Cell value |
| `Player` | id, disc, name | |
| `Move` | column, row, player, move_number | History |
| `Board` | rows, cols, grid (list of lists), heights (per column) | |
| `Game` | board, players, current, state, history, win_length | |
| `GameState` | enum: IN_PROGRESS, WON, DRAW | |

**Why `heights` per column?**
Tracking the next empty row per column lets `drop` be O(1) — no need to scan the column. It's a denormalized but cheap auxiliary structure.

---

## 6. Class Diagram (ASCII)

```
                                ┌──────────────────────────────┐
                                │            Game              │
                                │──────────────────────────────│
                                │ - board                      │
                                │ - players: (Player, Player)  │
                                │ - current: int (0 or 1)      │
                                │ - state: GameState           │
                                │ - history: list[Move]        │
                                │ - winner: Player?            │
                                │ - winning_cells: list?       │
                                │ - win_length                 │
                                │──────────────────────────────│
                                │ + drop(col)                  │
                                │ + undo()                     │
                                │ + legal_columns()            │
                                │ + render()                   │
                                └─────┬────────────────────────┘
                                      │ ◆
                                      ▼
                              ┌──────────────────┐
                              │      Board       │
                              │──────────────────│
                              │ - rows, cols     │
                              │ - grid           │  list[list[Disc]]
                              │ - heights        │  list[int]
                              │──────────────────│
                              │ + drop(col, disc)│
                              │ + remove(col)    │
                              │ + cell(r, c)     │
                              │ + is_full()      │
                              └──────────────────┘

  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
  │     Disc     │   │   Player     │   │     Move     │
  │   (enum)     │   │              │   │              │
  └──────────────┘   └──────────────┘   └──────────────┘
```

---

## 7. Design Patterns Used

| Pattern | Where | Why |
|---|---|---|
| State | `GameState` enum + transitions in `drop` | Clean WON/DRAW/IN_PROGRESS distinction |
| Facade | `Game` is the entry point | Hides board mechanics |
| Memento (light) | `Move` records enough to undo | Each move stores (col, row, player); undo just clears that cell |
| Strategy (NOT used) | — | Could parameterize win-detection algorithm; overkill for fixed rules |

---

## 8. Sequence Diagrams

### 8.1 Drop a disc (happy path)

```
  Player        Game            Board
    │             │               │
    │── drop(3) ▶│               │
    │             │── validate    │
    │             │── place ─────▶│
    │             │◀── (row=0)────│
    │             │── check win   │
    │             │   from (3,0)  │
    │             │── update state│
    │◀── result ──│               │
```

### 8.2 Drop on a won board

```
  Player        Game
    │             │
    │── drop(3) ▶│
    │             │── state != IN_PROGRESS
    │◀── error ───│
```

---

## 9. Concurrency Considerations

A single `Game` instance is typically not shared across threads — each match owns its game. If exposed as a service:
- Add `threading.Lock` around `drop` and `undo`.
- Two players "pressing" simultaneously serialize at the lock; turn-order check rejects the off-turn one.

For a multi-match server: a `Game` per match; matches are independent.

---

## 10. Full Working Code

```python
"""
Connect Four — Low-Level Design (Python)

In-memory game with:
- configurable rows/cols/win-length
- O(1) drop via per-column heights
- O(K) win detection from last placed piece
- undo via move stack
- thread-safe-able (single lock would suffice if exposed as service)
"""
from __future__ import annotations

import enum
from dataclasses import dataclass, field
from typing import Optional


# ──────────────────────────────────────────────────────────────────────────
# Enums
# ──────────────────────────────────────────────────────────────────────────

class Disc(enum.Enum):
    EMPTY = " "
    RED = "R"
    YELLOW = "Y"


class GameState(enum.Enum):
    IN_PROGRESS = "in_progress"
    WON = "won"
    DRAW = "draw"


# ──────────────────────────────────────────────────────────────────────────
# Errors
# ──────────────────────────────────────────────────────────────────────────

class GameError(Exception): ...
class IllegalMove(GameError): ...
class GameOver(GameError): ...
class WrongTurn(GameError): ...


# ──────────────────────────────────────────────────────────────────────────
# Domain
# ──────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Player:
    id: str
    disc: Disc
    name: str


@dataclass(frozen=True)
class Move:
    column: int
    row: int
    player_id: str
    move_number: int


@dataclass
class Board:
    rows: int
    cols: int
    grid: list[list[Disc]] = field(default_factory=list)
    heights: list[int] = field(default_factory=list)  # next empty row per column

    def __post_init__(self):
        if not self.grid:
            self.grid = [[Disc.EMPTY for _ in range(self.cols)] for _ in range(self.rows)]
        if not self.heights:
            self.heights = [0] * self.cols

    def drop(self, col: int, disc: Disc) -> int:
        """Return the row where the disc landed."""
        if not (0 <= col < self.cols):
            raise IllegalMove(f"column {col} out of range")
        if self.heights[col] >= self.rows:
            raise IllegalMove(f"column {col} is full")
        row = self.heights[col]
        self.grid[row][col] = disc
        self.heights[col] += 1
        return row

    def remove_top(self, col: int) -> Disc:
        """Undo the top piece in `col`. Returns the removed Disc."""
        if self.heights[col] == 0:
            raise IllegalMove(f"column {col} is empty")
        self.heights[col] -= 1
        row = self.heights[col]
        d = self.grid[row][col]
        self.grid[row][col] = Disc.EMPTY
        return d

    def cell(self, row: int, col: int) -> Disc:
        if 0 <= row < self.rows and 0 <= col < self.cols:
            return self.grid[row][col]
        return Disc.EMPTY  # off-board treated as empty for win-line scans

    def is_full(self) -> bool:
        return all(h >= self.rows for h in self.heights)


# ──────────────────────────────────────────────────────────────────────────
# Game (facade)
# ──────────────────────────────────────────────────────────────────────────

@dataclass
class Game:
    rows: int = 6
    cols: int = 7
    win_length: int = 4
    players: tuple[Player, Player] = field(default_factory=lambda: (
        Player("p1", Disc.RED, "Red"),
        Player("p2", Disc.YELLOW, "Yellow"),
    ))
    current: int = 0
    state: GameState = GameState.IN_PROGRESS
    history: list[Move] = field(default_factory=list)
    winner: Optional[Player] = None
    winning_cells: list[tuple[int, int]] = field(default_factory=list)
    board: Optional[Board] = None

    def __post_init__(self):
        if self.board is None:
            self.board = Board(rows=self.rows, cols=self.cols)
        if self.win_length < 1:
            raise ValueError(f"win_length {self.win_length} must be >= 1")
        # Note: win_length > max(rows,cols) is allowed; game becomes a forced draw.

    @property
    def current_player(self) -> Player:
        return self.players[self.current]

    def drop(self, col: int, player_id: Optional[str] = None) -> dict:
        """Drop the current player's disc. If player_id is given, it must match current."""
        if self.state is not GameState.IN_PROGRESS:
            raise GameOver(f"game is {self.state.value}")
        if player_id is not None and player_id != self.current_player.id:
            raise WrongTurn(
                f"current player is {self.current_player.id}; got {player_id}")
        row = self.board.drop(col, self.current_player.disc)  # type: ignore
        move = Move(
            column=col, row=row,
            player_id=self.current_player.id,
            move_number=len(self.history) + 1,
        )
        self.history.append(move)
        # Win check from the just-placed piece
        if self._check_win_from(row, col):
            self.state = GameState.WON
            self.winner = self.current_player
        elif self.board.is_full():  # type: ignore
            self.state = GameState.DRAW
        else:
            self.current ^= 1
        return {
            "move": move,
            "state": self.state.value,
            "winner": self.winner.id if self.winner else None,
            "winning_cells": self.winning_cells,
        }

    def undo(self) -> Optional[Move]:
        if not self.history:
            return None
        last = self.history.pop()
        self.board.remove_top(last.column)  # type: ignore
        self.state = GameState.IN_PROGRESS
        self.winner = None
        self.winning_cells = []
        # Restore turn to the player who made the popped move (they re-take it)
        for i, p in enumerate(self.players):
            if p.id == last.player_id:
                self.current = i
                break
        return last

    def legal_columns(self) -> list[int]:
        b = self.board  # type: ignore
        return [c for c in range(b.cols) if b.heights[c] < b.rows]

    # ─── win detection ────────────────────────────────────────────────

    def _check_win_from(self, row: int, col: int) -> bool:
        """Check 4 axes (horizontal, vertical, two diagonals) starting from (row, col)."""
        b = self.board  # type: ignore
        disc = b.grid[row][col]
        if disc is Disc.EMPTY:
            return False
        # 4 axis directions
        for dr, dc in [(0, 1), (1, 0), (1, 1), (1, -1)]:
            cells = self._line_through(row, col, dr, dc, disc)
            if len(cells) >= self.win_length:
                # Pick a contiguous winning slice for display
                self.winning_cells = cells[: self.win_length]
                return True
        return False

    def _line_through(self, row: int, col: int, dr: int, dc: int, disc: Disc) -> list[tuple[int, int]]:
        """Walk in (-dr,-dc) direction first, then (dr,dc), collecting matching cells."""
        b = self.board  # type: ignore
        cells: list[tuple[int, int]] = []
        # backward
        r, c = row - dr, col - dc
        back: list[tuple[int, int]] = []
        while 0 <= r < b.rows and 0 <= c < b.cols and b.grid[r][c] is disc:
            back.append((r, c))
            r -= dr
            c -= dc
        cells = list(reversed(back)) + [(row, col)]
        # forward
        r, c = row + dr, col + dc
        while 0 <= r < b.rows and 0 <= c < b.cols and b.grid[r][c] is disc:
            cells.append((r, c))
            r += dr
            c += dc
        return cells

    # ─── rendering ─────────────────────────────────────────────────────

    def render(self) -> str:
        b = self.board  # type: ignore
        lines: list[str] = []
        for r in range(b.rows - 1, -1, -1):
            row = "| " + " | ".join(b.grid[r][c].value for c in range(b.cols)) + " |"
            lines.append(row)
        sep = "+" + "+".join("---" for _ in range(b.cols)) + "+"
        lines.append(sep)
        lines.append("  " + "   ".join(str(c) for c in range(b.cols)))
        return "\n".join(lines)


# ──────────────────────────────────────────────────────────────────────────
# Demo / tests
# ──────────────────────────────────────────────────────────────────────────

def _basic_test() -> None:
    print("--- horizontal win ---")
    g = Game()
    seq = [(3, "p1"), (3, "p2"), (4, "p1"), (4, "p2"), (5, "p1"), (5, "p2"), (2, "p1")]
    # red drops 3,4,5,2 (bottom row); yellow drops 3,4,5 (row above) — red wins horizontal
    last = None
    for col, pid in seq:
        last = g.drop(col, pid)
    print(g.render())
    print(f"  state: {last['state']}, winner: {last['winner']}")
    print(f"  winning cells: {last['winning_cells']}")
    assert last["winner"] == "p1"


def _vertical_win() -> None:
    print("\n--- vertical win ---")
    g = Game()
    seq = [(0, "p1"), (1, "p2"), (0, "p1"), (1, "p2"), (0, "p1"), (1, "p2"), (0, "p1")]
    for col, pid in seq:
        last = g.drop(col, pid)
    print(g.render())
    print(f"  state: {last['state']}, winner: {last['winner']}")
    assert last["winner"] == "p1"


def _diagonal_win() -> None:
    print("\n--- diagonal win ---")
    # Build diagonal for Red: (0,0), (1,1), (2,2), (3,3)
    g = Game()
    g.drop(0, "p1")  # R at (0,0)
    g.drop(1, "p2")  # Y at (0,1)
    g.drop(1, "p1")  # R at (1,1)
    g.drop(2, "p2")  # Y at (0,2)
    g.drop(2, "p1")  # R at (1,2)
    g.drop(3, "p2")  # Y at (0,3)
    g.drop(2, "p1")  # R at (2,2)
    g.drop(3, "p2")  # Y at (1,3)
    g.drop(3, "p1")  # R at (2,3)
    g.drop(0, "p2")  # Y at (1,0) -- placeholder
    last = g.drop(3, "p1")  # R at (3,3) → diagonal win
    print(g.render())
    print(f"  state: {last['state']}, winner: {last['winner']}")
    print(f"  winning cells: {last['winning_cells']}")
    assert last["winner"] == "p1"


def _draw_test() -> None:
    print("\n--- draw test (cols 5x5, win=5) ---")
    g = Game(rows=2, cols=2, win_length=2)
    # In a 2x2 with win=2, almost any move wins; let's use 3x3 win=4 (impossible win) → draw
    g = Game(rows=3, cols=3, win_length=4)
    moves = [(0, "p1"), (1, "p2"), (2, "p1"), (0, "p2"), (1, "p1"), (2, "p2"),
             (0, "p1"), (1, "p2"), (2, "p1")]
    for col, pid in moves:
        last = g.drop(col, pid)
    print(f"  state: {last['state']}, winner: {last['winner']}")
    assert last["state"] == "draw"
    assert last["winner"] is None


def _wrong_turn() -> None:
    print("\n--- wrong-turn rejected ---")
    g = Game()
    g.drop(0, "p1")
    try:
        g.drop(0, "p1")  # p1 again, should fail
        assert False, "should have raised"
    except WrongTurn:
        pass
    print("  OK")


def _full_column() -> None:
    print("\n--- full column rejected ---")
    g = Game()
    pids = ["p1", "p2"] * 4
    for i, pid in enumerate(pids[:6]):
        g.drop(0, pid)
    try:
        g.drop(0, pids[6])
        assert False
    except IllegalMove:
        pass
    print("  OK")


def _undo_test() -> None:
    print("\n--- undo ---")
    g = Game()
    g.drop(0, "p1")
    g.drop(1, "p2")
    g.drop(2, "p1")
    before_state = (g.current, len(g.history), g.board.cell(0, 2))
    last = g.undo()
    after_state = (g.current, len(g.history), g.board.cell(0, 2))
    assert last is not None and last.column == 2
    assert before_state[1] - 1 == after_state[1]
    assert after_state[2] is Disc.EMPTY
    # Now p1 can re-take the move (undo restores their turn)
    assert g.current_player.id == "p1"
    print("  OK")


if __name__ == "__main__":
    _basic_test()
    _vertical_win()
    _diagonal_win()
    _draw_test()
    _wrong_turn()
    _full_column()
    _undo_test()
    print("\nAll tests passed.")
```

### How to run

```bash
python3 ~/Downloads/cc/kb/LLD/Python/connect-four.py
```

---

## 11. Cross-Questions ("Why X and not Y") — ≥ 12

### 11.1 Why a 2D list `grid[row][col]` and not a flat `grid[row * cols + col]`?

Readability. 2D indexing matches the mental model. Flat would save a few cache lines on huge boards but Connect Four is 7×6 = 42 cells — negligible.

For an AI scanning many board states (millions/sec in MCTS), bitboards (one `int64` per disc color) win massively. Out of scope for the basic design.

### 11.2 Why `heights[col]` per column instead of scanning?

`drop` becomes O(1). Without heights, `drop` is O(rows) — scan the column for the lowest empty cell. We'd also need it during `is_full`. Heights cost 7 ints; clear win.

### 11.3 Why O(K) win detection from the last move and not O(N×M) full-board scan?

Every move at most extends a winning line through the just-placed piece. So we only check 4 axes (horizontal, vertical, 2 diagonals) outward from the last cell — at most `2*(win_length-1)+1` cells per axis. Total: O(K) where K = win_length.

Full-board scan after every move is O(rows*cols*4*K) — wasteful. AI engines that explore millions of states care a LOT about this.

### 11.4 Why a `Disc` enum with `EMPTY` rather than `Optional[Player]`?

Empty is a value the cell *holds*, not "absent player". Modeling as an enum:
- Cells have a uniform type (no None checks).
- Iteration / display is uniform.
- Type-checker happy.

`Optional[Disc]` would force `if c is not None: ...` everywhere — noisier without benefit.

### 11.5 Why `Move` records `row` even though we could re-derive it?

For `undo`. We need to know which row to clear without rescanning. Storing `row` makes undo O(1).

### 11.6 Why does `undo` restore the turn to the *previous* player and not toggle?

If P1 just played, `undo()` should put P1 back on the move (they re-take it). Toggling current would put P2 on the move — they'd play first when it's still P1's "redo" opportunity.

Subtle but important UX. The test `_undo_test` enforces this.

### 11.7 Why is `Game` a `@dataclass` with optional fields?

Convenience: `Game()` gives a default 7×6 board with default players. `Game(rows=10, cols=10, win_length=5)` for variants. `field(default_factory=lambda: ...)` for the players because the factory needs to capture `Disc` enum at construction time.

Trade-off: the `Optional[Board]` is a hack — we set it in `__post_init__`. In Python this is idiomatic; in Go we'd use a constructor.

### 11.8 Why support custom dimensions and win length?

Connect Four is one variant. Connect-K, gomoku-style 5-in-a-row, larger boards — all share the algorithm. Parameterizing exposes a cleaner test surface (e.g. 3×3 with win=4 forces a draw).

The cost is one validation check (`win_length <= min(rows, cols)`).

### 11.9 Why no AI in the base design?

OOD interviews focus on modeling. Adding minimax / MCTS is a separate algorithmic question — useful as a follow-up.

If asked: implement `class Bot` with a `choose_column(game) → int` method. Strategies: random / heuristic / minimax with alpha-beta / MCTS. Each is a Strategy.

### 11.10 What if a player tries to drop in a column when it's their opponent's turn?

`WrongTurn` exception. The optional `player_id` arg lets the caller assert their identity; if the game is single-process and trusted, omit it and let the game advance current automatically.

The optional check matters in a service: each network message names its sender; we validate before mutating state.

### 11.11 What's the failure mode if `drop` raises mid-execution?

The board mutation (`board.drop`) happens before the win check. If win check raises (it shouldn't in our code; defensive), the disc remains placed but the game state isn't updated. We'd leave the game in an inconsistent state.

Fix: wrap the win check in a try/except; on error, undo the placement, re-raise. We don't here because win check is pure-read.

### 11.12 What about move-by-move animation / partial state?

The library returns the resulting state; presentation (animation) is the consumer's concern. The `render()` method gives an ASCII snapshot; a GUI would build on top of `board.grid`.

### 11.13 Why not Observer for "game won" notifications?

Simple cases don't need it. The caller of `drop` gets the result; they emit notifications. For multi-spectator scenarios, add an Observer:
```python
def add_listener(self, fn): ...
```

We omit for minimum viable design.

### 11.14 What about saving/loading?

Serialize `Move` history; replay on load. Each `Move` is sufficient — we can reconstruct the board, current turn, and game state by replaying from start.

Storing the board state directly is also fine (denormalized) but bigger.

### 11.15 How would you generalize to N players?

Replace `players: (P, P)` with `players: tuple[Player, ...]`; rotate `current = (current + 1) % len(players)`. Each player gets a distinct disc value. The win-detection unchanged.

---

## 12. Extensions

### 12.1 AI opponent
A `Bot` interface with `choose_column(game)`. Implementations: random, minimax + alpha-beta, MCTS.

### 12.2 Time controls
Add `TimeBank` per player; `drop` decrements based on real-time elapsed.

### 12.3 Spectator subscriptions
Observer: subscribe to events; `drop` emits.

### 12.4 Persistence
Move history serializes trivially (list of dataclasses → JSON).

### 12.5 Pop-out variant
Allow popping the bottom disc out of a column (used in some Connect-4 variants). Add `pop_bottom(col, player)` and update `heights`.

### 12.6 Bitboard representation
For AI: 7×6 board fits in a 64-bit int. Each disc = bit. Win detection becomes a few bitwise ops. Massive speedup; complex code.

---

## 13. Cheat-Sheet Recap

1. **Problem:** 2-player drop-disc-into-column game; first to 4-in-a-row wins.
2. **Core entities:** `Game`, `Board`, `Disc`, `Player`, `Move`.
3. **Patterns:** State (game state), Memento-light (move history), Facade (Game).
4. **Hardest design call:** O(K) win detection from last move, not full scan.
5. **Auxiliary structures:** `heights[col]` for O(1) drop.
6. **Concurrency:** single-game per instance; lock if exposed as service.
7. **Open extensions:** AI bot, time controls, spectator events, bitboard.

---

## Appendix A: Test cases the interviewer will probe

```
1. Horizontal 4-in-a-row → win.
2. Vertical → win.
3. Diagonal (NE-SW and NW-SE) → win.
4. Draw on 3×3 with win=4 (impossible) → state=DRAW after 9 moves.
5. Drop in full column → IllegalMove.
6. Wrong-turn assertion → WrongTurn.
7. Drop after game over → GameOver.
8. Undo after a winning move → state reverts to IN_PROGRESS.
9. Configurable size 8×8, win=5 → Connect-5 variant.
10. Drop into col=-1 or col=cols → IllegalMove.
```

## Appendix B: Common Python-specific gotchas

```
- enum.Enum members compare with `is` (identity).
- @dataclass with mutable default: use field(default_factory=list); we do.
- list * cols creates references to same inner list; use list comprehension.
- tuple of two players is hashable; list is not — pick based on use.
- __post_init__ runs after the dataclass __init__; perfect for derived fields.
```

## Appendix C: Why this question is loved by interviewers

```
- Board games are friendly entry — easy to scope.
- Tests grid modeling, state machine, algorithm efficiency.
- Win detection has a clean O(K)-vs-O(N²) optimization to discuss.
- Open-ended: AI, time controls, spectator, persistence — many follow-ups.
- 60 min is enough to write working code with tests.
```

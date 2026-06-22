# Connect Four — Low-Level Design (Go)

> **Difficulty:** Medium
> **Tags:** `[lld]` `[ood]` `[game]` `[grid]` `[state-machine]`
> **Language:** Go 1.21+
> **Prep time:** ~10 min skim, ~25 min deep read
> **Companies that ask this:** Amazon, Microsoft, Google, Atlassian, Bloomberg

---

## Beginner's Guide

### What's this in plain English?

Tic Tac Toe with gravity. 7×6 grid. Players drop discs into columns; gravity pulls them to the lowest empty cell. First to 4-in-a-row wins.

### Why solve it?

- **One step up from Tic Tac Toe**: same skeleton + gravity.
- **Teaches**: column-only input, efficient win detection, separating logic from I/O.

### Vocabulary

- **Column / Drop** — move = column index; disc falls to lowest empty.
- **K-in-a-row** — generalized win condition (4 default).
- **Gravity** — always fills bottom-up.

### High-level approach

Entities: **Board** (2D grid + drop + check-win), **Player** (id, color), **Game** (state).

Drop: scan column bottom-up; first empty gets the disc.
Win check (after a drop at `(r, c)`): scan 4 directions through that cell — O(K) not O(N²).

### How to read this doc

- **Beginner**: drop + win check are the core.
- **Interview**: generalize to N-in-a-row; discuss minimax for AI.

---

## 0. How to use this doc in an interview

Python version covers state machine, win detection, undo. **In Go, the conversation pivots:**
- **Slices** for the grid; `[][]Disc` is fine but watch row-vs-col indexing.
- **Sentinel errors** + `errors.Is`.
- **No exceptions** — `Drop` returns `(Result, error)`.
- **Idiomatic constructors** (`NewGame`, `NewBoard`).
- **No `__post_init__`** — initialize in `NewGame` explicitly.

Bitboard variants are common in Go competitive code (one `uint64` per disc color); we stick with `[][]Disc` for clarity.

---

## 1. Problem Statement
(Same as Python — see `LLD/Python/connect-four.md` §1.)

---

## 2. Clarifying Questions
Same as Python. Go-specific: error wrapping policy.

---

## 3. Functional Requirements
Same.

---

## 4. Actors & Use Cases
Same.

---

## 5. Core Entities

| Entity | Go shape | Notes |
|---|---|---|
| `Disc` | named int enum | EMPTY=0, RED=1, YELLOW=2 |
| `GameState` | named int enum | InProgress / Won / Draw |
| `Player` | struct (immutable) | |
| `Move` | struct (immutable) | |
| `Board` | struct, mutated under lock if shared | |
| `Game` | facade with optional `sync.Mutex` | |

---

## 6. Class Diagram (ASCII)
(Same shape as Python — see `LLD/Python/connect-four.md` §6.)

---

## 7. Design Patterns

| Pattern | Go form | Why |
|---|---|---|
| State | `GameState` enum + transition checks | Clean game lifecycle |
| Memento (light) | `[]Move` history | Undo via `RemoveTop` |
| Facade | `Game` exposes thin API | Hides board mechanics |

---

## 8. Sequence Diagrams
(Same as Python.)

---

## 9. Concurrency Considerations

A `*Game` is typically owned by one match. If shared (e.g. server-side game state), guard with a single `sync.Mutex` around `Drop`/`Undo`. Reads (`Render`, `LegalColumns`) can use `RLock` if exposed.

---

## 10. Full Working Code

```go
// File: connect4.go
// Build: go run connect4.go
package main

import (
	"errors"
	"fmt"
	"strings"
)

// ──────────────────────────────────────────────────────────────────────────
// Enums
// ──────────────────────────────────────────────────────────────────────────

type Disc int

const (
	Empty Disc = iota
	Red
	Yellow
)

func (d Disc) String() string {
	return []string{" ", "R", "Y"}[d]
}

type GameState int

const (
	InProgress GameState = iota
	Won
	Draw
)

func (s GameState) String() string {
	return []string{"in_progress", "won", "draw"}[s]
}

// ──────────────────────────────────────────────────────────────────────────
// Sentinel errors
// ──────────────────────────────────────────────────────────────────────────

var (
	ErrIllegalMove = errors.New("connect4: illegal move")
	ErrGameOver    = errors.New("connect4: game over")
	ErrWrongTurn   = errors.New("connect4: wrong turn")
)

// ──────────────────────────────────────────────────────────────────────────
// Domain
// ──────────────────────────────────────────────────────────────────────────

type Player struct {
	ID   string
	Disc Disc
	Name string
}

type Move struct {
	Column     int
	Row        int
	PlayerID   string
	MoveNumber int
}

type Board struct {
	Rows    int
	Cols    int
	grid    [][]Disc // grid[row][col]
	heights []int    // next empty row per column
}

func NewBoard(rows, cols int) *Board {
	g := make([][]Disc, rows)
	for r := range g {
		g[r] = make([]Disc, cols)
	}
	return &Board{Rows: rows, Cols: cols, grid: g, heights: make([]int, cols)}
}

func (b *Board) Drop(col int, d Disc) (int, error) {
	if col < 0 || col >= b.Cols {
		return -1, fmt.Errorf("%w: column %d out of range", ErrIllegalMove, col)
	}
	if b.heights[col] >= b.Rows {
		return -1, fmt.Errorf("%w: column %d full", ErrIllegalMove, col)
	}
	row := b.heights[col]
	b.grid[row][col] = d
	b.heights[col]++
	return row, nil
}

func (b *Board) RemoveTop(col int) (Disc, error) {
	if b.heights[col] == 0 {
		return Empty, fmt.Errorf("%w: column %d empty", ErrIllegalMove, col)
	}
	b.heights[col]--
	row := b.heights[col]
	d := b.grid[row][col]
	b.grid[row][col] = Empty
	return d, nil
}

func (b *Board) Cell(row, col int) Disc {
	if row < 0 || row >= b.Rows || col < 0 || col >= b.Cols {
		return Empty
	}
	return b.grid[row][col]
}

func (b *Board) IsFull() bool {
	for _, h := range b.heights {
		if h < b.Rows {
			return false
		}
	}
	return true
}

// ──────────────────────────────────────────────────────────────────────────
// Game
// ──────────────────────────────────────────────────────────────────────────

type DropResult struct {
	Move          Move
	State         GameState
	Winner        *Player
	WinningCells  [][2]int
}

type Game struct {
	board        *Board
	players      [2]Player
	current      int
	state        GameState
	winner       *Player
	winningCells [][2]int
	winLength    int
	history      []Move
}

func NewGame(rows, cols, winLength int) (*Game, error) {
	if winLength < 1 {
		return nil, fmt.Errorf("winLength %d must be >= 1", winLength)
	}
	if rows < 1 || cols < 1 {
		return nil, fmt.Errorf("invalid dimensions: %dx%d", rows, cols)
	}
	return &Game{
		board:     NewBoard(rows, cols),
		players:   [2]Player{{ID: "p1", Disc: Red, Name: "Red"}, {ID: "p2", Disc: Yellow, Name: "Yellow"}},
		state:     InProgress,
		winLength: winLength,
	}, nil
}

func DefaultGame() *Game {
	g, _ := NewGame(6, 7, 4)
	return g
}

func (g *Game) CurrentPlayer() Player { return g.players[g.current] }
func (g *Game) State() GameState     { return g.state }
func (g *Game) Winner() *Player      { return g.winner }
func (g *Game) Board() *Board        { return g.board }

func (g *Game) Drop(col int, playerID string) (*DropResult, error) {
	if g.state != InProgress {
		return nil, fmt.Errorf("%w: state=%s", ErrGameOver, g.state)
	}
	if playerID != "" && playerID != g.players[g.current].ID {
		return nil, fmt.Errorf("%w: current=%s, got=%s", ErrWrongTurn, g.players[g.current].ID, playerID)
	}
	row, err := g.board.Drop(col, g.players[g.current].Disc)
	if err != nil {
		return nil, err
	}
	move := Move{
		Column:     col,
		Row:        row,
		PlayerID:   g.players[g.current].ID,
		MoveNumber: len(g.history) + 1,
	}
	g.history = append(g.history, move)

	if g.checkWinFrom(row, col) {
		g.state = Won
		p := g.players[g.current]
		g.winner = &p
	} else if g.board.IsFull() {
		g.state = Draw
	} else {
		g.current ^= 1
	}

	return &DropResult{
		Move:         move,
		State:        g.state,
		Winner:       g.winner,
		WinningCells: g.winningCells,
	}, nil
}

func (g *Game) Undo() (*Move, error) {
	if len(g.history) == 0 {
		return nil, nil
	}
	last := g.history[len(g.history)-1]
	g.history = g.history[:len(g.history)-1]
	if _, err := g.board.RemoveTop(last.Column); err != nil {
		return nil, err
	}
	g.state = InProgress
	g.winner = nil
	g.winningCells = nil
	for i, p := range g.players {
		if p.ID == last.PlayerID {
			g.current = i
			break
		}
	}
	return &last, nil
}

func (g *Game) LegalColumns() []int {
	out := make([]int, 0, g.board.Cols)
	for c := 0; c < g.board.Cols; c++ {
		if g.board.heights[c] < g.board.Rows {
			out = append(out, c)
		}
	}
	return out
}

func (g *Game) checkWinFrom(row, col int) bool {
	disc := g.board.Cell(row, col)
	if disc == Empty {
		return false
	}
	dirs := [4][2]int{{0, 1}, {1, 0}, {1, 1}, {1, -1}}
	for _, d := range dirs {
		cells := g.lineThrough(row, col, d[0], d[1], disc)
		if len(cells) >= g.winLength {
			g.winningCells = cells[:g.winLength]
			return true
		}
	}
	return false
}

func (g *Game) lineThrough(row, col, dr, dc int, disc Disc) [][2]int {
	var back [][2]int
	r, c := row-dr, col-dc
	for g.board.Cell(r, c) == disc && r >= 0 && r < g.board.Rows && c >= 0 && c < g.board.Cols {
		back = append(back, [2]int{r, c})
		r -= dr
		c -= dc
	}
	// reverse back
	for i, j := 0, len(back)-1; i < j; i, j = i+1, j-1 {
		back[i], back[j] = back[j], back[i]
	}
	cells := append(back, [2]int{row, col})
	r, c = row+dr, col+dc
	for g.board.Cell(r, c) == disc && r >= 0 && r < g.board.Rows && c >= 0 && c < g.board.Cols {
		cells = append(cells, [2]int{r, c})
		r += dr
		c += dc
	}
	return cells
}

func (g *Game) Render() string {
	var sb strings.Builder
	for r := g.board.Rows - 1; r >= 0; r-- {
		sb.WriteString("| ")
		for c := 0; c < g.board.Cols; c++ {
			sb.WriteString(g.board.grid[r][c].String())
			sb.WriteString(" | ")
		}
		sb.WriteString("\n")
	}
	sep := "+"
	for c := 0; c < g.board.Cols; c++ {
		sep += "---+"
	}
	sb.WriteString(sep + "\n  ")
	for c := 0; c < g.board.Cols; c++ {
		sb.WriteString(fmt.Sprintf("%d   ", c))
	}
	return sb.String()
}

// ──────────────────────────────────────────────────────────────────────────
// Demo / tests
// ──────────────────────────────────────────────────────────────────────────

func main() {
	horizontalWin()
	verticalWin()
	diagonalWin()
	drawTest()
	wrongTurnTest()
	fullColumnTest()
	undoTest()
	fmt.Println("\nAll tests passed.")
}

func horizontalWin() {
	fmt.Println("--- horizontal ---")
	g := DefaultGame()
	moves := []struct {
		col int
		pid string
	}{{3, "p1"}, {3, "p2"}, {4, "p1"}, {4, "p2"}, {5, "p1"}, {5, "p2"}, {2, "p1"}}
	var last *DropResult
	for _, m := range moves {
		r, err := g.Drop(m.col, m.pid)
		if err != nil {
			panic(err)
		}
		last = r
	}
	if last.Winner == nil || last.Winner.ID != "p1" {
		panic("p1 should win")
	}
	fmt.Println(g.Render())
	fmt.Printf("  state=%s winner=%s\n", last.State, last.Winner.ID)
}

func verticalWin() {
	fmt.Println("--- vertical ---")
	g := DefaultGame()
	moves := []struct {
		col int
		pid string
	}{{0, "p1"}, {1, "p2"}, {0, "p1"}, {1, "p2"}, {0, "p1"}, {1, "p2"}, {0, "p1"}}
	var last *DropResult
	for _, m := range moves {
		r, _ := g.Drop(m.col, m.pid)
		last = r
	}
	if last.Winner == nil || last.Winner.ID != "p1" {
		panic("p1 should win vertical")
	}
	fmt.Println("  OK")
}

func diagonalWin() {
	fmt.Println("--- diagonal ---")
	g := DefaultGame()
	seq := [][2]string{
		{"0", "p1"}, {"1", "p2"}, {"1", "p1"}, {"2", "p2"}, {"2", "p1"},
		{"3", "p2"}, {"2", "p1"}, {"3", "p2"}, {"3", "p1"}, {"0", "p2"},
		{"3", "p1"},
	}
	var last *DropResult
	for _, s := range seq {
		var c int
		fmt.Sscan(s[0], &c)
		r, err := g.Drop(c, s[1])
		if err != nil {
			panic(err)
		}
		last = r
	}
	if last.Winner == nil {
		panic("expected diagonal win")
	}
	fmt.Println("  OK")
}

func drawTest() {
	fmt.Println("--- draw on 3x3 win=4 (impossible) ---")
	g, _ := NewGame(3, 3, 4)
	moves := []struct {
		col int
		pid string
	}{
		{0, "p1"}, {1, "p2"}, {2, "p1"},
		{0, "p2"}, {1, "p1"}, {2, "p2"},
		{0, "p1"}, {1, "p2"}, {2, "p1"},
	}
	var last *DropResult
	for _, m := range moves {
		r, err := g.Drop(m.col, m.pid)
		if err != nil {
			panic(err)
		}
		last = r
	}
	if last.State != Draw {
		panic(fmt.Sprintf("expected draw, got %s", last.State))
	}
	fmt.Println("  OK")
}

func wrongTurnTest() {
	fmt.Println("--- wrong turn ---")
	g := DefaultGame()
	if _, err := g.Drop(0, "p1"); err != nil {
		panic(err)
	}
	if _, err := g.Drop(0, "p1"); !errors.Is(err, ErrWrongTurn) {
		panic("expected wrong turn")
	}
	fmt.Println("  OK")
}

func fullColumnTest() {
	fmt.Println("--- full column ---")
	g := DefaultGame()
	pids := []string{"p1", "p2"}
	for i := 0; i < 6; i++ {
		if _, err := g.Drop(0, pids[i%2]); err != nil {
			panic(err)
		}
	}
	if _, err := g.Drop(0, pids[0]); !errors.Is(err, ErrIllegalMove) {
		panic("expected illegal")
	}
	fmt.Println("  OK")
}

func undoTest() {
	fmt.Println("--- undo ---")
	g := DefaultGame()
	g.Drop(0, "p1")
	g.Drop(1, "p2")
	g.Drop(2, "p1")
	if _, err := g.Undo(); err != nil {
		panic(err)
	}
	if g.CurrentPlayer().ID != "p1" {
		panic("after undo, p1 should retake")
	}
	if g.Board().Cell(0, 2) != Empty {
		panic("cell should be empty after undo")
	}
	fmt.Println("  OK")
}
```

### How to run

```bash
go run /path/to/connect4.go
```

---

## 11. Cross-Questions ("Why X and not Y") — ≥ 12

### 11.1 Why `[][]Disc` and not `[]Disc` (flat)?

Readability for an interview implementation. Flat (1D) is faster for iteration on huge boards (cache locality) but for 7×6=42 cells the difference is unmeasurable.

For an AI engine: switch to bitboards (`uint64` per color). Each disc = a bit; win detection becomes a few bit-shifts and ANDs. Massive speedup; out of scope here.

### 11.2 Why `int` enums for `Disc` and `GameState`?

Comparable with `==`, switch-friendly, named constants for readability. A type-safe enum simulation.

`type Disc int; const (Empty Disc = iota; ...)` is the standard Go pattern.

### 11.3 Why a `DropResult` struct return and not multiple return values?

Six-value returns get unwieldy. A struct with named fields is self-documenting:
```go
result, err := g.Drop(3, "p1")
// vs
_, _, state, winner, cells, err := g.Drop(3, "p1")
```

Tradeoff: callers always allocate the struct. Negligible for a game move.

### 11.4 Why a `*Game` constructor (`NewGame`) instead of struct literal?

Encapsulation of invariants:
- Validate dimensions and win length.
- Allocate the board.
- Set initial state.

A struct literal would require callers to know to call `NewBoard`, set state, etc. `NewGame` is the public contract.

### 11.5 Why `[2]Player` (fixed-size array) and not `[]Player`?

Two players is a structural constant of standard Connect Four. Using `[2]Player` makes that explicit and allows compile-time bounds for `players[current]` (with `current ^= 1` toggle).

For N-player extension, change to `[]Player` and `current = (current + 1) % len(players)`.

### 11.6 Why does `Drop` take `playerID string` even though current player is implicit?

Defensive identity check. In a multiplayer service, each request carries a sender ID; we verify it matches whose turn it is. If empty (single-process trusted use), we skip the check.

This is the same pattern Python uses for the same reason.

### 11.7 Why `lineThrough` collects cells in a slice?

We need the actual winning cells for display ("highlight these 4"). If we only needed a yes/no answer, two integer counters (back-count + forward-count) would suffice — O(K) without allocation. We chose clarity over micro-optimization.

### 11.8 Why is `winningCells` `[][2]int` and not `[]Position` struct?

`[2]int{r, c}` is the cheapest 2-tuple in Go. A `Position` struct with named fields would be cleaner; we chose array-of-pairs to avoid yet another type. In a larger codebase, `Position` wins.

### 11.9 Why is `Game.history` mutated directly without locks?

Single-game-per-instance assumption. If shared across goroutines, wrap public methods in a mutex (drop-in `sync.Mutex` field).

`go test -race` would catch any unintended concurrent access if we share `*Game`.

### 11.10 What's the memory cost?

Per game: `Rows*Cols*sizeof(Disc)` for grid (~336 bytes for 7×6 with int Disc) + `Cols*sizeof(int)` for heights (~56 bytes) + history slice. Total < 1 KB. Trivial.

For an AI game-tree search visiting millions of positions: switch to bitboards (16 bytes per board state).

### 11.11 Why does `Board.Drop` mutate the board AND return the row?

Caller (Game) needs both: the side effect (place the disc) and the location (for win check + history). Returning the row avoids re-deriving.

Alternative: `Board.NextRow(col)` to query, then `Board.Place(row, col, disc)`. Two-step; race-prone if board is concurrent. One-step is atomic from the board's perspective.

### 11.12 Why `Cell` returns `Empty` for off-board indices instead of an error?

`Cell` is used inside `lineThrough` walks that probe outward; off-board is the natural stopping condition. Returning `Empty` (which doesn't match any active disc) terminates the walk cleanly without error-handling overhead.

For external callers, an off-board access is a bug; we accept the silent zero return as defensive.

### 11.13 What's the failure mode if `Drop` succeeds at the board level but `checkWinFrom` panics?

The disc is placed; the game state is mid-update. Caller sees a panic.

In practice, `checkWinFrom` is pure math on the board — it doesn't allocate, doesn't fail. Defensive `recover()` would be belt-and-suspenders. We don't.

### 11.14 Why no Observer pattern for game events (move, win, draw)?

YAGNI. The caller of `Drop` gets a result; they decide what to broadcast. If many spectators need real-time updates, add `RegisterListener(fn func(Event))`.

### 11.15 How would you save/load games?

Serialize `[]Move`. On load, replay from start. Order-dependent state (current, winner, etc.) is recomputed.

Alternatively serialize the full board snapshot — bigger but constant-time load.

---

## 12. Extensions
(Same as Python; see Python doc §12.)

---

## 13. Cheat-Sheet Recap

1. **Problem:** 2-player game, drop disc, first 4-in-a-row wins.
2. **Idioms:** Named-int enums, sentinel errors with `%w`, struct returns, no exceptions.
3. **Patterns:** State, Memento-light, Facade.
4. **Win detection:** O(K) walk from last placed disc along 4 axes.
5. **Aux data:** `heights[col]` for O(1) drop.
6. **Concurrency:** none built-in; add `sync.Mutex` if shared.

---

## Appendix A: How this differs from the Python version

```
Python                          Go
─────────                       ─────
@dataclass                      struct
ABC                             interface
raise GameOver                  fmt.Errorf("%w", ErrGameOver)
List comprehension              for-loop
Optional[Player]                *Player (nil = none)
__post_init__                   logic in NewGame
list[list[Disc]]                [][]Disc
tuple[int, int]                 [2]int (or struct)
```

## Appendix B: Common Go gotchas

```
- 2D slice initialization: must allocate inner slices in a loop, not [][]T{}.
- Loop variable in pre-1.22: capture in closure with care.
- Slicing keeps the underlying array alive — cheap reads but mutations may surprise.
- nil slice has len 0 and append works; nil map needs init.
- enum int comparison with == is fine; identity (`is`) doesn't exist in Go.
- defer is LIFO and runs even on panic — useful for cleanup.
```

# Tic Tac Toe — LLD (Go)

> **Difficulty:** Easy → Medium
> **Tags:** `[lld]` `[game]` `[grid]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

Two players take turns marking X or O on a 3×3 grid. First to line up three in a row wins. Draw if the board fills.

The OOD version: configurable N×N board, K-in-a-row to win.

### Why solve it?

- The **simplest OOD warmup**. Start here if new.
- **Teaches**: state machines, win detection, separating rules from I/O.
- **Patterns**: state machine (whose turn), strategy (player types).

### Vocabulary

- **Cell** — one square (X / O / empty).
- **Move** — placing your mark.
- **State machine** — IN_PROGRESS → WON / DRAWN.

### High-level approach

Entities:
- **Board** — N×N grid; checks wins.
- **Player** — ID + mark.
- **Game** — players, turn, board, state.
- **MoveStrategy** (optional, via interface) — human, random, minimax.

Flow: init → loop {get move → apply → check win/draw → swap turn} → end.

Win detection: after a move, check the row, column, and diagonals **through that cell** — O(N), not O(N²).

### How to read this doc

- **Beginner**: focus on win detection.
- **Interview**: think how this skeleton extends to Connect Four.

---

## 1. Code

```go
package main

import (
	"errors"
	"fmt"
)

type Cell int

const (
	Empty Cell = iota
	X
	O
)

func (c Cell) String() string {
	return []string{" ", "X", "O"}[c]
}

type State int

const (
	InProgress State = iota
	Won
	Draw
)

var (
	ErrIllegal  = errors.New("illegal move")
	ErrGameOver = errors.New("game over")
	ErrTurn     = errors.New("wrong turn")
)

type Game struct {
	size, winLen int
	board        [][]Cell
	current      Cell
	state        State
	winner       Cell
	moves        int
}

func NewGame(size, winLen int) *Game {
	if size < 1 || winLen < 1 {
		panic("invalid")
	}
	g := &Game{size: size, winLen: winLen, current: X, state: InProgress}
	g.board = make([][]Cell, size)
	for i := range g.board {
		g.board[i] = make([]Cell, size)
	}
	return g
}

func (g *Game) Play(row, col int, p Cell) error {
	if g.state != InProgress {
		return ErrGameOver
	}
	if p != g.current {
		return ErrTurn
	}
	if row < 0 || row >= g.size || col < 0 || col >= g.size {
		return ErrIllegal
	}
	if g.board[row][col] != Empty {
		return ErrIllegal
	}
	g.board[row][col] = p
	g.moves++
	if g.checkWin(row, col, p) {
		g.state = Won
		g.winner = p
	} else if g.moves == g.size*g.size {
		g.state = Draw
	} else {
		if g.current == X {
			g.current = O
		} else {
			g.current = X
		}
	}
	return nil
}

func (g *Game) checkWin(row, col int, p Cell) bool {
	dirs := [4][2]int{{0, 1}, {1, 0}, {1, 1}, {1, -1}}
	for _, d := range dirs {
		count := 1
		r, c := row+d[0], col+d[1]
		for r >= 0 && r < g.size && c >= 0 && c < g.size && g.board[r][c] == p {
			count++
			r += d[0]; c += d[1]
		}
		r, c = row-d[0], col-d[1]
		for r >= 0 && r < g.size && c >= 0 && c < g.size && g.board[r][c] == p {
			count++
			r -= d[0]; c -= d[1]
		}
		if count >= g.winLen {
			return true
		}
	}
	return false
}

func (g *Game) State() State    { return g.state }
func (g *Game) Winner() Cell    { return g.winner }
func (g *Game) Render() string {
	out := ""
	for _, row := range g.board {
		for j, c := range row {
			if j > 0 {
				out += " | "
			}
			out += c.String()
		}
		out += "\n"
	}
	return out
}

// Tests

func main() {
	t1()
	t2()
	t3()
	fmt.Println("All tests passed.")
}

func t1() {
	fmt.Println("--- horizontal win ---")
	g := NewGame(3, 3)
	moves := []struct {
		r, c int
		p    Cell
	}{{0, 0, X}, {1, 0, O}, {0, 1, X}, {1, 1, O}, {0, 2, X}}
	for _, m := range moves {
		if err := g.Play(m.r, m.c, m.p); err != nil {
			panic(err)
		}
	}
	if g.State() != Won || g.Winner() != X {
		panic("expected X win")
	}
	fmt.Println(g.Render())
}

func t2() {
	fmt.Println("--- wrong turn ---")
	g := NewGame(3, 3)
	g.Play(0, 0, X)
	if err := g.Play(0, 1, X); !errors.Is(err, ErrTurn) {
		panic("expected wrong turn")
	}
	fmt.Println("  OK")
}

func t3() {
	fmt.Println("--- illegal ---")
	g := NewGame(3, 3)
	g.Play(0, 0, X)
	if err := g.Play(0, 0, O); !errors.Is(err, ErrIllegal) {
		panic("expected illegal")
	}
	fmt.Println("  OK")
}
```

---

## 2. Cheat-Sheet
1. N×N int-enum board.
2. Play: validate → place → check win → advance state.
3. Win check: 4 directions from last move; ≥ K consecutive.
4. State machine: IN_PROGRESS → WON | DRAW.

# Chess — LLD (Go)

> **Difficulty:** Hard
> **Tags:** `[lld]` `[game]` `[ood]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

Two-player chess. 8×8 board, 6 piece types per side. Each piece has its own movement rules. Plus check, checkmate, castling, en passant, promotion. Hardest "complete and correct" LLD.

### Why solve it?

- **Real world**: chess.com, lichess.
- **Teaches**: polymorphism via interfaces, separating piece rules from board from game flow.

### Vocabulary

- **Piece** — one of 6 types per color.
- **Move** — from, to, optional promotion.
- **Check / Checkmate / Stalemate** — game states.
- **Castling / En passant / Promotion** — special moves with preconditions.

### High-level approach

Entities: **Piece** interface (`LegalMoves(board, from) []Move`), one struct per type, **Board** (8×8 of Piece), **Game** (players, history, state).

Move flow: validate move → simulate → ensure your king isn't attacked after → apply → check opponent for check/checkmate.

Special moves: extra logic in `LegalMoves` with state checks (e.g., castling needs king and rook unmoved + path empty + no attacks on path).

### How to read this doc

- **Beginner**: per-piece moves first; skip specials on first pass.
- **Interview**: state representation, move undo, performance.

---

## 1. Code

```go
package main

import (
	"errors"
	"fmt"
)

type Color int

const (
	White Color = iota
	Black
)

type GameState int

const (
	InProgress GameState = iota
	Check
	Checkmate
	Stalemate
	Draw
)

type Position struct{ Row, Col int }

func (p Position) InBounds() bool {
	return p.Row >= 0 && p.Row < 8 && p.Col >= 0 && p.Col < 8
}

var ErrIllegal = errors.New("illegal move")

type Piece interface {
	CanMove(b *Board, frm, to Position) bool
	GetColor() Color
	HasMovedFlag() bool
	SetMoved(bool)
	Symbol() string
}

type basePiece struct {
	color    Color
	hasMoved bool
}

func (p *basePiece) GetColor() Color    { return p.color }
func (p *basePiece) HasMovedFlag() bool { return p.hasMoved }
func (p *basePiece) SetMoved(b bool)    { p.hasMoved = b }

type King struct{ basePiece }

func (k *King) CanMove(b *Board, frm, to Position) bool {
	dr, dc := abs(frm.Row-to.Row), abs(frm.Col-to.Col)
	return max2(dr, dc) == 1
}
func (k *King) Symbol() string { return "K" }

type Rook struct{ basePiece }

func (r *Rook) CanMove(b *Board, frm, to Position) bool {
	if frm.Row != to.Row && frm.Col != to.Col {
		return false
	}
	return b.pathClear(frm, to)
}
func (r *Rook) Symbol() string { return "R" }

type Bishop struct{ basePiece }

func (bi *Bishop) CanMove(b *Board, frm, to Position) bool {
	if abs(frm.Row-to.Row) != abs(frm.Col-to.Col) {
		return false
	}
	return b.pathClear(frm, to)
}
func (bi *Bishop) Symbol() string { return "B" }

type Queen struct{ basePiece }

func (q *Queen) CanMove(b *Board, frm, to Position) bool {
	r := &Rook{basePiece: q.basePiece}
	bi := &Bishop{basePiece: q.basePiece}
	return r.CanMove(b, frm, to) || bi.CanMove(b, frm, to)
}
func (q *Queen) Symbol() string { return "Q" }

type Knight struct{ basePiece }

func (n *Knight) CanMove(b *Board, frm, to Position) bool {
	dr, dc := abs(frm.Row-to.Row), abs(frm.Col-to.Col)
	return (dr == 2 && dc == 1) || (dr == 1 && dc == 2)
}
func (n *Knight) Symbol() string { return "N" }

type Pawn struct{ basePiece }

func (p *Pawn) CanMove(b *Board, frm, to Position) bool {
	dir := -1
	if p.color == Black {
		dir = 1
	}
	if to.Col == frm.Col && to.Row-frm.Row == dir {
		return b.Get(to) == nil
	}
	if to.Col == frm.Col && to.Row-frm.Row == 2*dir && !p.hasMoved {
		mid := Position{frm.Row + dir, frm.Col}
		return b.Get(to) == nil && b.Get(mid) == nil
	}
	if abs(to.Col-frm.Col) == 1 && to.Row-frm.Row == dir {
		t := b.Get(to)
		return t != nil && t.GetColor() != p.color
	}
	return false
}
func (p *Pawn) Symbol() string { return "P" }

type Board struct {
	grid [8][8]Piece
}

func NewBoard() *Board {
	b := &Board{}
	for c := 0; c < 8; c++ {
		b.grid[1][c] = &Pawn{basePiece: basePiece{color: Black}}
		b.grid[6][c] = &Pawn{basePiece: basePiece{color: White}}
	}
	for _, color := range []struct {
		c   Color
		row int
	}{{Black, 0}, {White, 7}} {
		bp := basePiece{color: color.c}
		b.grid[color.row][0] = &Rook{basePiece: bp}
		b.grid[color.row][7] = &Rook{basePiece: bp}
		b.grid[color.row][1] = &Knight{basePiece: bp}
		b.grid[color.row][6] = &Knight{basePiece: bp}
		b.grid[color.row][2] = &Bishop{basePiece: bp}
		b.grid[color.row][5] = &Bishop{basePiece: bp}
		b.grid[color.row][3] = &Queen{basePiece: bp}
		b.grid[color.row][4] = &King{basePiece: bp}
	}
	return b
}

func (b *Board) Get(p Position) Piece {
	if !p.InBounds() {
		return nil
	}
	return b.grid[p.Row][p.Col]
}

func (b *Board) Set(p Position, piece Piece) {
	b.grid[p.Row][p.Col] = piece
}

func (b *Board) pathClear(frm, to Position) bool {
	dr := sign(to.Row - frm.Row)
	dc := sign(to.Col - frm.Col)
	r, c := frm.Row+dr, frm.Col+dc
	for r != to.Row || c != to.Col {
		if b.grid[r][c] != nil {
			return false
		}
		r += dr
		c += dc
	}
	return true
}

func (b *Board) FindKing(color Color) Position {
	for r := 0; r < 8; r++ {
		for c := 0; c < 8; c++ {
			if k, ok := b.grid[r][c].(*King); ok && k.color == color {
				return Position{r, c}
			}
		}
	}
	return Position{-1, -1}
}

func (b *Board) IsAttacked(pos Position, byColor Color) bool {
	for r := 0; r < 8; r++ {
		for c := 0; c < 8; c++ {
			p := b.grid[r][c]
			if p != nil && p.GetColor() == byColor {
				if p.CanMove(b, Position{r, c}, pos) {
					return true
				}
			}
		}
	}
	return false
}

type Game struct {
	Board   *Board
	Current Color
	State   GameState
}

func NewGame() *Game {
	return &Game{Board: NewBoard(), Current: White, State: InProgress}
}

func (g *Game) Move(frm, to Position) error {
	if g.State == Checkmate || g.State == Stalemate || g.State == Draw {
		return errors.New("game over")
	}
	piece := g.Board.Get(frm)
	if piece == nil || piece.GetColor() != g.Current {
		return ErrIllegal
	}
	if !to.InBounds() {
		return ErrIllegal
	}
	target := g.Board.Get(to)
	if target != nil && target.GetColor() == g.Current {
		return ErrIllegal
	}
	if !piece.CanMove(g.Board, frm, to) {
		return ErrIllegal
	}
	captured := g.Board.Get(to)
	g.Board.Set(to, piece)
	g.Board.Set(frm, nil)
	kingPos := g.Board.FindKing(g.Current)
	if g.Board.IsAttacked(kingPos, g.opponent()) {
		g.Board.Set(frm, piece)
		g.Board.Set(to, captured)
		return ErrIllegal
	}
	piece.SetMoved(true)
	g.Current = g.opponent()
	g.updateState()
	return nil
}

func (g *Game) opponent() Color {
	if g.Current == White {
		return Black
	}
	return White
}

func (g *Game) updateState() {
	kingPos := g.Board.FindKing(g.Current)
	inCheck := g.Board.IsAttacked(kingPos, g.opponent())
	hasMove := g.hasAnyLegalMove()
	switch {
	case inCheck && !hasMove:
		g.State = Checkmate
	case !inCheck && !hasMove:
		g.State = Stalemate
	case inCheck:
		g.State = Check
	default:
		g.State = InProgress
	}
}

func (g *Game) hasAnyLegalMove() bool {
	for r := 0; r < 8; r++ {
		for c := 0; c < 8; c++ {
			p := g.Board.grid[r][c]
			if p == nil || p.GetColor() != g.Current {
				continue
			}
			frm := Position{r, c}
			for r2 := 0; r2 < 8; r2++ {
				for c2 := 0; c2 < 8; c2++ {
					to := Position{r2, c2}
					target := g.Board.Get(to)
					if target != nil && target.GetColor() == g.Current {
						continue
					}
					if !p.CanMove(g.Board, frm, to) {
						continue
					}
					g.Board.Set(to, p)
					g.Board.Set(frm, nil)
					kingPos := g.Board.FindKing(g.Current)
					inCheck := g.Board.IsAttacked(kingPos, g.opponent())
					g.Board.Set(frm, p)
					g.Board.Set(to, target)
					if !inCheck {
						return true
					}
				}
			}
		}
	}
	return false
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

func max2(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func sign(n int) int {
	if n > 0 {
		return 1
	}
	if n < 0 {
		return -1
	}
	return 0
}

// Tests
func main() {
	g := NewGame()
	if _, ok := g.Board.Get(Position{0, 0}).(*Rook); !ok {
		panic("rook expected")
	}
	if err := g.Move(Position{6, 4}, Position{4, 4}); err != nil {
		panic(err)
	}
	if g.Current != Black {
		panic("turn")
	}

	// Fool's Mate
	g2 := NewGame()
	moves := [][4]int{
		{6, 5, 5, 5}, // f2-f3
		{1, 4, 3, 4}, // e7-e5
		{6, 6, 4, 6}, // g2-g4
		{0, 3, 4, 7}, // Qd8-h4#
	}
	for _, m := range moves {
		if err := g2.Move(Position{m[0], m[1]}, Position{m[2], m[3]}); err != nil {
			panic(err)
		}
	}
	if g2.State != Checkmate {
		panic(fmt.Sprintf("expected checkmate, got %v", g2.State))
	}
	fmt.Println("Fool's Mate: CHECKMATE ✓")
	fmt.Println("All tests passed.")
}
```

---

## 2. Cheat-Sheet
1. Interface `Piece`; concrete types per kind.
2. Board: `[8][8]Piece` (interface values).
3. Move flow: validate → try → check own king → commit.
4. State: InProgress / Check / Checkmate / Stalemate / Draw.
5. Special moves (castle/EP/promote) bolt on as separate paths.

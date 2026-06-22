# Snake and Ladder — LLD (Go)

> **Difficulty:** Easy → Medium
> **Tags:** `[lld]` `[game]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

Children's board game. Numbered cells 1-100. Roll dice, advance. Snakes pull you down; ladders push you up. First to 100 wins.

### Why solve it?

- **Easy OOD warmup**: testable, full-cycle.
- **Teaches**: configurable rules, strategy interface (die types), turn-based state machine.

### Vocabulary

- **Cell** — a square.
- **Snake / Ladder** — start → end (snake: end < start; ladder: end > start).
- **Die** — interface; standard, multi-dice, must-roll-6, etc.

### High-level approach

Entities: **Board** (size + jumps map), **Player** (id, position), **Die** (interface), **Game** (orchestrator).

Move: roll → advance → if on snake/ladder → jump → check win.

Strategy interface for the die lets you swap rules without touching Game.

### How to read this doc

- **Beginner**: trace a game by hand.
- **Interview**: discuss extensibility (multi-die, bounce-back, must-roll-6).

---

## 1. Code

```go
package main

import (
	"fmt"
	"math/rand"
)

type GameState int

const (
	InProgress GameState = iota
	Won
)

type Player struct {
	ID, Name string
	Position int
}

type Dice interface {
	Roll() int
}

type SixSidedDice struct{ rng *rand.Rand }

func NewSixSidedDice(seed int64) *SixSidedDice {
	return &SixSidedDice{rng: rand.New(rand.NewSource(seed))}
}
func (d *SixSidedDice) Roll() int { return d.rng.Intn(6) + 1 }

type FixedDice struct{ Seq []int }

func (d *FixedDice) Roll() int {
	v := d.Seq[0]
	d.Seq = d.Seq[1:]
	return v
}

type Game struct {
	BoardSize  int
	Players    []*Player
	Snakes     map[int]int
	Ladders    map[int]int
	Dice       Dice
	currentIdx int
	State      GameState
	Winner     *Player
}

func NewGame(boardSize int, dice Dice) *Game {
	if dice == nil {
		dice = NewSixSidedDice(0)
	}
	return &Game{
		BoardSize: boardSize,
		Dice:      dice,
		Snakes:    map[int]int{},
		Ladders:   map[int]int{},
		State:     InProgress,
	}
}

func (g *Game) AddPlayer(name string) *Player {
	p := &Player{ID: fmt.Sprintf("%d", len(g.Players)+1), Name: name}
	g.Players = append(g.Players, p)
	return p
}

func (g *Game) AddSnake(head, tail int) error {
	if head <= tail {
		return fmt.Errorf("snake head > tail")
	}
	if _, ok := g.Ladders[head]; ok {
		return fmt.Errorf("ladder conflict")
	}
	g.Snakes[head] = tail
	return nil
}

func (g *Game) AddLadder(start, end int) error {
	if end <= start {
		return fmt.Errorf("ladder end > start")
	}
	if _, ok := g.Snakes[start]; ok {
		return fmt.Errorf("snake conflict")
	}
	g.Ladders[start] = end
	return nil
}

type TurnResult struct {
	Player   string
	Rolled   int
	Position int
	Stayed   bool
	Bumped   []string
	Won      bool
}

func (g *Game) Turn() TurnResult {
	if g.State == Won {
		return TurnResult{}
	}
	p := g.Players[g.currentIdx]
	roll := g.Dice.Roll()
	newPos := p.Position + roll
	if newPos > g.BoardSize {
		return TurnResult{Player: p.Name, Rolled: roll, Position: p.Position, Stayed: true}
	}
	var bumped []string
	for {
		if t, ok := g.Snakes[newPos]; ok {
			bumped = append(bumped, fmt.Sprintf("snake %d→%d", newPos, t))
			newPos = t
		} else if t, ok := g.Ladders[newPos]; ok {
			bumped = append(bumped, fmt.Sprintf("ladder %d→%d", newPos, t))
			newPos = t
		} else {
			break
		}
	}
	p.Position = newPos
	res := TurnResult{Player: p.Name, Rolled: roll, Position: newPos, Bumped: bumped}
	if newPos == g.BoardSize {
		g.State = Won
		g.Winner = p
		res.Won = true
	} else {
		g.currentIdx = (g.currentIdx + 1) % len(g.Players)
	}
	return res
}

func main() {
	{
		fmt.Println("--- ladder ---")
		g := NewGame(100, &FixedDice{Seq: []int{3}})
		p := g.AddPlayer("A")
		g.AddPlayer("B")
		g.AddLadder(3, 22)
		g.Turn()
		if p.Position != 22 {
			panic(p.Position)
		}
		fmt.Println("  OK")
	}
	{
		fmt.Println("--- snake ---")
		g := NewGame(100, &FixedDice{Seq: []int{5}})
		p := g.AddPlayer("A")
		g.AddPlayer("B")
		g.AddSnake(5, 1)
		g.Turn()
		if p.Position != 1 {
			panic(p.Position)
		}
		fmt.Println("  OK")
	}
	{
		fmt.Println("--- overshoot stays ---")
		g := NewGame(10, &FixedDice{Seq: []int{6}})
		p := g.AddPlayer("A")
		g.AddPlayer("B")
		p.Position = 7
		g.Turn()
		if p.Position != 7 {
			panic("overshoot")
		}
		fmt.Println("  OK")
	}
	{
		fmt.Println("--- chained ---")
		g := NewGame(100, &FixedDice{Seq: []int{3}})
		p := g.AddPlayer("A")
		g.AddPlayer("B")
		g.AddLadder(3, 10)
		g.AddSnake(10, 2)
		g.Turn()
		if p.Position != 2 {
			panic("chain")
		}
		fmt.Println("  OK")
	}
	fmt.Println("All tests passed.")
}
```

---

## 2. Cheat-Sheet
1. Cells 1..N; players track position.
2. Dice as interface (testable via FixedDice).
3. Roll → advance; resolve snake/ladder loop.
4. Overshoot stays.
5. State machine: InProgress → Won.

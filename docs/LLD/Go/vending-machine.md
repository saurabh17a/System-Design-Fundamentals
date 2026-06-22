# Vending Machine — LLD (Go)

> **Difficulty:** Medium
> **Tags:** `[lld]` `[state-machine]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

A snack machine. Insert coins, pick a slot, get product + change. Hidden inside: a state machine — can't dispense before money is in; can't add more coins after selection.

### Why solve it?

- **Real world**: vending, kiosks, parking meters.
- **Teaches**: state pattern, inventory, why explicit states beat scattered booleans.

### Vocabulary

- **State** — current machine status (idle / accepting / dispensing).
- **Transition** — state → state (insert: idle → accepting).
- **Inventory** — product stock.
- **Change** — money returned.

### High-level approach

Entities: **Product**, **Inventory** (`map[string]*Product`), **Machine** (state, balance, selection), **State** interface (Idle, HasMoney, Dispensing).

Each state implements `InsertCoin`, `Select`, `Dispense`, `Cancel`. Most operations error out from wrong states.

Flow: idle → coins → select → if enough → dispense + change → idle.

### How to read this doc

- **Beginner**: draw the state diagram first.
- **Interview**: change-making (greedy vs DP) is a common drill-down.

---

## 1. Code

```go
package main

import (
	"errors"
	"fmt"
	"sort"
)

type State int

const (
	Idle State = iota
	Collecting
	Dispensing
)

var (
	ErrOutOfStock          = errors.New("out of stock")
	ErrInsufficientFunds   = errors.New("insufficient funds")
	ErrCannotMakeChange    = errors.New("cannot make change")
	ErrWrongState          = errors.New("wrong state")
	ErrUnknownProduct      = errors.New("unknown product")
)

type Cents int64

type Product struct {
	ID    string
	Name  string
	Price Cents
}

type Slot struct {
	Product *Product
	Count   int
}

type VendingMachine struct {
	slots         map[string]*Slot
	coinInventory map[Cents]int
	currentCredit Cents
	selected      *Product
	state         State
}

func NewVendingMachine() *VendingMachine {
	return &VendingMachine{
		slots:         make(map[string]*Slot),
		coinInventory: make(map[Cents]int),
		state:         Idle,
	}
}

func (v *VendingMachine) AddProduct(p *Product, count int) {
	v.slots[p.ID] = &Slot{Product: p, Count: count}
}

func (v *VendingMachine) AddCoins(denom Cents, count int) {
	v.coinInventory[denom] += count
}

func (v *VendingMachine) Select(productID string) error {
	if v.state != Idle {
		return ErrWrongState
	}
	slot, ok := v.slots[productID]
	if !ok {
		return ErrUnknownProduct
	}
	if slot.Count == 0 {
		return ErrOutOfStock
	}
	v.selected = slot.Product
	v.state = Collecting
	return nil
}

func (v *VendingMachine) InsertCoin(denom Cents) error {
	if v.state != Collecting {
		return ErrWrongState
	}
	v.coinInventory[denom]++
	v.currentCredit += denom
	return nil
}

func (v *VendingMachine) Cancel() (map[Cents]int, error) {
	if v.state != Collecting {
		return nil, ErrWrongState
	}
	change, err := v.makeChange(v.currentCredit, false)
	if err == nil {
		v.applyChange(change)
	}
	v.reset()
	return change, err
}

func (v *VendingMachine) Confirm() (*Product, map[Cents]int, error) {
	if v.state != Collecting {
		return nil, nil, ErrWrongState
	}
	if v.currentCredit < v.selected.Price {
		return nil, nil, ErrInsufficientFunds
	}
	v.state = Dispensing
	changeAmt := v.currentCredit - v.selected.Price
	change, err := v.makeChange(changeAmt, true)
	if err != nil {
		v.state = Collecting // rollback
		return nil, nil, err
	}
	v.applyChange(change)
	v.slots[v.selected.ID].Count--
	p := v.selected
	v.reset()
	return p, change, nil
}

// makeChange returns the change distribution; if dryRun, doesn't validate inventory consumption.
func (v *VendingMachine) makeChange(amount Cents, useGreedy bool) (map[Cents]int, error) {
	if amount <= 0 {
		return map[Cents]int{}, nil
	}
	denoms := make([]Cents, 0, len(v.coinInventory))
	for d := range v.coinInventory {
		denoms = append(denoms, d)
	}
	sort.Slice(denoms, func(i, j int) bool { return denoms[i] > denoms[j] })
	change := make(map[Cents]int)
	for _, d := range denoms {
		avail := v.coinInventory[d]
		need := int(amount / d)
		give := need
		if give > avail {
			give = avail
		}
		if give > 0 {
			change[d] = give
			amount -= d * Cents(give)
		}
	}
	if amount > 0 {
		return nil, ErrCannotMakeChange
	}
	return change, nil
}

func (v *VendingMachine) applyChange(change map[Cents]int) {
	for d, n := range change {
		v.coinInventory[d] -= n
	}
}

func (v *VendingMachine) reset() {
	v.currentCredit = 0
	v.selected = nil
	v.state = Idle
}

func main() {
	vm := NewVendingMachine()
	coke := &Product{ID: "C", Name: "Coke", Price: 150}
	vm.AddProduct(coke, 5)
	for _, d := range []Cents{25, 50, 100} {
		vm.AddCoins(d, 10)
	}
	if err := vm.Select("C"); err != nil {
		panic(err)
	}
	vm.InsertCoin(100)
	vm.InsertCoin(100)
	prod, change, err := vm.Confirm()
	if err != nil {
		panic(err)
	}
	if prod.Name != "Coke" || change[50] != 1 {
		panic("wrong")
	}
	fmt.Printf("OK: %s, change=%v\n", prod.Name, change)

	// Insufficient funds
	vm.Select("C")
	vm.InsertCoin(50)
	_, _, err = vm.Confirm()
	if !errors.Is(err, ErrInsufficientFunds) {
		panic("expected insufficient")
	}
	vm.Cancel()
	fmt.Println("All tests passed.")
}
```

---

## 2. Cheat-Sheet
1. State: Idle → Collecting → Dispensing.
2. Greedy change.
3. Cents as int64 (no Decimal in Go).
4. Rollback on can't-make-change.

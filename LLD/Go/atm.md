# ATM — LLD (Go)

> **Difficulty:** Medium
> **Tags:** `[lld]` `[state-machine]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

A bank ATM: insert card, type PIN, withdraw cash. State machine prevents skipping steps; cash inventory must dispense correct bill combinations.

### Why solve it?

- **Real world**: ATMs, kiosks, "auth then transact" UX.
- **Teaches**: state pattern, transaction handling, denomination dispensing.

### Vocabulary

- **Card / Account** — card → account; account has balance and type.
- **PIN** — auth secret; lock after N failures.
- **Denomination** — bill value (20, 50, 100).
- **State** — Idle → CardInserted → Authenticated → Transacting → Idle.

### High-level approach

Entities: **Card**, **Account**, **CashInventory** (counts per denom), **ATM** (current state, session), **State** interface.

Withdraw flow: check balance → check inventory → greedy dispense largest-first → fall back if needed → reject if impossible.

### How to read this doc

- **Beginner**: state diagram + dispense algorithm.
- **Interview**: edge cases (locked account, no large bills, daily limit).

---

## 1. Code

```go
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
)

type State int

const (
	Idle State = iota
	Authenticating
	Authenticated
	Transacting
)

type Cents int64

var (
	ErrAuth          = errors.New("auth failed")
	ErrInsufficient  = errors.New("insufficient funds")
	ErrCantDispense  = errors.New("cannot dispense")
	ErrWrongState    = errors.New("wrong state")
	ErrUnknownAcct   = errors.New("unknown account")
)

type Card struct {
	Number  string
	PinHash string
}

func HashPin(pin string) string {
	h := sha256.Sum256([]byte(pin))
	return hex.EncodeToString(h[:])
}

type Account struct {
	Number  string
	Balance Cents
}

type Bank struct {
	cards          map[string]*Card
	accounts       map[string]*Account
	cardToAccount  map[string]string
}

func NewBank() *Bank {
	return &Bank{
		cards:         map[string]*Card{},
		accounts:      map[string]*Account{},
		cardToAccount: map[string]string{},
	}
}

func (b *Bank) Register(c *Card, a *Account) {
	b.cards[c.Number] = c
	b.accounts[a.Number] = a
	b.cardToAccount[c.Number] = a.Number
}

func (b *Bank) Authenticate(cardNumber, pin string) (*Account, error) {
	c, ok := b.cards[cardNumber]
	if !ok || c.PinHash != HashPin(pin) {
		return nil, ErrAuth
	}
	return b.accounts[b.cardToAccount[cardNumber]], nil
}

func (b *Bank) Withdraw(a *Account, amt Cents) error {
	if amt <= 0 || a.Balance < amt {
		return ErrInsufficient
	}
	a.Balance -= amt
	return nil
}

func (b *Bank) Deposit(a *Account, amt Cents) {
	a.Balance += amt
}

func (b *Bank) Transfer(src *Account, dstNum string, amt Cents) error {
	dst, ok := b.accounts[dstNum]
	if !ok {
		return ErrUnknownAcct
	}
	if err := b.Withdraw(src, amt); err != nil {
		return err
	}
	b.Deposit(dst, amt)
	return nil
}

type BillDispenser struct {
	inv map[Cents]int
}

func NewBillDispenser(initial map[Cents]int) *BillDispenser {
	inv := make(map[Cents]int)
	for k, v := range initial {
		inv[k] = v
	}
	return &BillDispenser{inv: inv}
}

func (d *BillDispenser) Dispense(amount Cents) (map[Cents]int, error) {
	denoms := make([]Cents, 0, len(d.inv))
	for k := range d.inv {
		denoms = append(denoms, k)
	}
	sort.Slice(denoms, func(i, j int) bool { return denoms[i] > denoms[j] })
	out := make(map[Cents]int)
	rem := amount
	for _, dn := range denoms {
		give := int(rem / dn)
		if give > d.inv[dn] {
			give = d.inv[dn]
		}
		if give > 0 {
			out[dn] = give
			rem -= dn * Cents(give)
		}
	}
	if rem > 0 {
		return nil, ErrCantDispense
	}
	for d2, n := range out {
		d.inv[d2] -= n
	}
	return out, nil
}

type ATM struct {
	bank      *Bank
	disp      *BillDispenser
	state     State
	current   *Account
	pendingCard string
}

func NewATM(bank *Bank, disp *BillDispenser) *ATM {
	return &ATM{bank: bank, disp: disp, state: Idle}
}

func (a *ATM) InsertCard(number string) error {
	if a.state != Idle {
		return ErrWrongState
	}
	a.state = Authenticating
	a.pendingCard = number
	return nil
}

func (a *ATM) EnterPin(pin string) error {
	if a.state != Authenticating {
		return ErrWrongState
	}
	acct, err := a.bank.Authenticate(a.pendingCard, pin)
	if err != nil {
		a.EjectCard()
		return err
	}
	a.current = acct
	a.state = Authenticated
	return nil
}

func (a *ATM) Balance() (Cents, error) {
	if a.state != Authenticated {
		return 0, ErrWrongState
	}
	return a.current.Balance, nil
}

func (a *ATM) Withdraw(amt Cents) (map[Cents]int, error) {
	if a.state != Authenticated {
		return nil, ErrWrongState
	}
	a.state = Transacting
	defer func() { a.state = Authenticated }()
	if a.current.Balance < amt {
		return nil, ErrInsufficient
	}
	bills, err := a.disp.Dispense(amt)
	if err != nil {
		return nil, err
	}
	if err := a.bank.Withdraw(a.current, amt); err != nil {
		return nil, err
	}
	return bills, nil
}

func (a *ATM) EjectCard() {
	a.current = nil
	a.state = Idle
}

func main() {
	bank := NewBank()
	c := &Card{Number: "1111", PinHash: HashPin("1234")}
	acct := &Account{Number: "A1", Balance: 50000}
	bank.Register(c, acct)
	disp := NewBillDispenser(map[Cents]int{10000: 5, 2000: 10})

	atm := NewATM(bank, disp)
	if err := atm.InsertCard("1111"); err != nil {
		panic(err)
	}
	if err := atm.EnterPin("1234"); err != nil {
		panic(err)
	}
	bills, err := atm.Withdraw(14000)
	if err != nil {
		panic(err)
	}
	if bills[10000] != 1 || bills[2000] != 2 {
		panic(bills)
	}
	bal, _ := atm.Balance()
	if bal != 36000 {
		panic(bal)
	}
	atm.EjectCard()
	fmt.Printf("Withdraw OK: bills=%v balance=%d\n", bills, bal)

	// Bad PIN
	atm.InsertCard("1111")
	if err := atm.EnterPin("0000"); !errors.Is(err, ErrAuth) {
		panic("expected auth fail")
	}
	if atm.state != Idle {
		panic("should eject")
	}
	fmt.Println("All tests passed.")
}
```

---

## 2. Cheat-Sheet
1. State: Idle → Auth → Authed → Transacting.
2. PIN hashed (SHA-256).
3. Greedy bill dispense.
4. Sentinel errors with errors.Is.

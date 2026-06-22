# Online Shopping Cart — LLD (Go)

> **Difficulty:** Medium
> **Tags:** `[lld]` `[strategy]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

E-commerce cart. Add items, see subtotal, apply coupons, pay, deduct inventory. Multiple discount and payment options must combine cleanly.

### Why solve it?

- **Real world**: every shop site.
- **Teaches**: Strategy pattern for discounts/payments, atomic inventory.

### Vocabulary

- **CartItem** — product + qty.
- **DiscountStrategy** — interface; rules like Percent, Fixed, BOGO.
- **PaymentStrategy** — interface; Card, UPI, Wallet.
- **Inventory** — product stock with mutex.

### High-level approach

Entities: **Product**, **CartItem**, **Cart**, **DiscountStrategy** (iface), **PaymentStrategy** (iface), **Inventory**.

Checkout: subtotal → apply discounts in order → pay → atomically decrement inventory → order.

### How to read this doc

- **Beginner**: cart + strategy pattern first.
- **Interview**: discount ordering, idempotent checkouts.

---

## 1. Code

```go
package main

import (
	"errors"
	"fmt"
	"sync"
)

type Cents int64

var (
	ErrOutOfStock = errors.New("out of stock")
	ErrPayment    = errors.New("payment failed")
	ErrEmpty      = errors.New("empty cart")
)

type Product struct {
	ID, Name string
	Price    Cents
}

type CartItem struct {
	Product  Product
	Quantity int
}

type Discount interface {
	Apply(subtotal Cents, items []CartItem) Cents
}

type PercentOff struct{ Percent int }

func (d PercentOff) Apply(subtotal Cents, _ []CartItem) Cents {
	return Cents(int64(subtotal) * int64(d.Percent) / 100)
}

type FlatOff struct {
	Amount, MinSubtotal Cents
}

func (d FlatOff) Apply(subtotal Cents, _ []CartItem) Cents {
	if subtotal < d.MinSubtotal {
		return 0
	}
	if d.Amount > subtotal {
		return subtotal
	}
	return d.Amount
}

type BOGO struct{ ProductID string }

func (d BOGO) Apply(_ Cents, items []CartItem) Cents {
	for _, it := range items {
		if it.Product.ID == d.ProductID && it.Quantity >= 2 {
			pairs := it.Quantity / 2
			return it.Product.Price * Cents(pairs)
		}
	}
	return 0
}

type Payment interface {
	Charge(amount Cents) bool
}

type MockCard struct{}

func (MockCard) Charge(_ Cents) bool { return true }

type Inventory struct {
	mu    sync.Mutex
	stock map[string]int
}

func NewInventory() *Inventory { return &Inventory{stock: map[string]int{}} }

func (i *Inventory) Add(id string, q int) {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.stock[id] += q
}

func (i *Inventory) Reserve(id string, q int) bool {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.stock[id] < q {
		return false
	}
	i.stock[id] -= q
	return true
}

func (i *Inventory) Stock(id string) int {
	i.mu.Lock()
	defer i.mu.Unlock()
	return i.stock[id]
}

type Order struct {
	ID         string
	Items      []CartItem
	Subtotal   Cents
	Discount   Cents
	Tax        Cents
	Total      Cents
}

type Cart struct {
	items    map[string]*CartItem
	discounts []Discount
	inv      *Inventory
}

func NewCart(inv *Inventory) *Cart {
	return &Cart{items: map[string]*CartItem{}, inv: inv}
}

const taxBp = 800 // 8%

func (c *Cart) Add(p Product, q int) error {
	if q <= 0 {
		return errors.New("q > 0")
	}
	if c.inv.Stock(p.ID) < q {
		return ErrOutOfStock
	}
	if it, ok := c.items[p.ID]; ok {
		it.Quantity += q
	} else {
		c.items[p.ID] = &CartItem{Product: p, Quantity: q}
	}
	return nil
}

func (c *Cart) ApplyDiscount(d Discount) {
	c.discounts = append(c.discounts, d)
}

func (c *Cart) Subtotal() Cents {
	var t Cents
	for _, it := range c.items {
		t += it.Product.Price * Cents(it.Quantity)
	}
	return t
}

func (c *Cart) DiscountTotal() Cents {
	st := c.Subtotal()
	items := make([]CartItem, 0, len(c.items))
	for _, it := range c.items {
		items = append(items, *it)
	}
	var d Cents
	for _, dd := range c.discounts {
		d += dd.Apply(st, items)
	}
	return d
}

func (c *Cart) Total() Cents {
	st := c.Subtotal()
	d := c.DiscountTotal()
	tax := (st - d) * taxBp / 10000
	return st - d + tax
}

func (c *Cart) Checkout(p Payment) (*Order, error) {
	if len(c.items) == 0 {
		return nil, ErrEmpty
	}
	var reserved []struct{ id string; q int }
	for _, it := range c.items {
		if c.inv.Reserve(it.Product.ID, it.Quantity) {
			reserved = append(reserved, struct{ id string; q int }{it.Product.ID, it.Quantity})
		} else {
			for _, r := range reserved {
				c.inv.Add(r.id, r.q)
			}
			return nil, ErrOutOfStock
		}
	}
	amt := c.Total()
	if !p.Charge(amt) {
		for _, r := range reserved {
			c.inv.Add(r.id, r.q)
		}
		return nil, ErrPayment
	}
	items := make([]CartItem, 0, len(c.items))
	for _, it := range c.items {
		items = append(items, *it)
	}
	o := &Order{
		ID: fmt.Sprintf("o-%d", len(c.items)),
		Items: items, Subtotal: c.Subtotal(),
		Discount: c.DiscountTotal(),
		Tax: (c.Subtotal() - c.DiscountTotal()) * taxBp / 10000,
		Total: amt,
	}
	c.items = map[string]*CartItem{}
	c.discounts = nil
	return o, nil
}

// Tests
func main() {
	inv := NewInventory()
	inv.Add("A", 100)
	apple := Product{ID: "A", Name: "Apple", Price: 100}

	c := NewCart(inv)
	c.Add(apple, 4)
	c.ApplyDiscount(BOGO{ProductID: "A"})
	if c.DiscountTotal() != 200 {
		panic(c.DiscountTotal())
	}

	c2 := NewCart(inv)
	c2.Add(apple, 2)
	o, err := c2.Checkout(MockCard{})
	if err != nil {
		panic(err)
	}
	if o.Total <= 0 {
		panic(o.Total)
	}
	if inv.Stock("A") != 98 {
		panic(inv.Stock("A"))
	}
	fmt.Printf("Order %s total=%d\n", o.ID, o.Total)
	fmt.Println("All tests passed.")
}
```

---

## 2. Cheat-Sheet
1. Cart, items, discounts, inventory.
2. Checkout: reserve → charge → order.
3. Rollback on payment failure.

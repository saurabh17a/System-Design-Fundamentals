# Pizza Ordering — LLD (Go)

> **Difficulty:** Easy → Medium
> **Tags:** `[lld]` `[decorator]` `[interface]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

You order: small thin + cheese + mushrooms + olives. System computes total price and description. Each topping is a layer wrapping the pizza — the **Decorator pattern**.

### Why solve it?

- **Easy LLD warmup**.
- **Teaches**: Decorator pattern via Go interfaces; how composition replaces inheritance.

### Vocabulary

- **Pizza** — common interface (Cost, Describe).
- **Topping** — wraps a Pizza, adds to cost/description.
- **Decorator** — wraps an object with same interface.

### High-level approach

Go interface: `Pizza { Cost() float64; Describe() string }`.

- `BasePizza` struct implements it.
- Each topping struct holds a `Pizza` field; its `Cost()` returns `inner.Cost() + extra`.

Stacking: `Mushrooms{Pizza: Cheese{Pizza: BasePizza{}}}`.

### How to read this doc

- **Beginner**: trace Cost() through layers.
- **Interview**: alternative is `Pizza` with a `Toppings` slice. Discuss when each fits.

---

## 1. Code

```go
package main

import "fmt"

type Cents int64

type Pizza interface {
	Description() string
	Cost() Cents
}

type Size int

const (
	Small Size = iota
	Medium
	Large
)

func sizeName(s Size) string {
	return []string{"small", "medium", "large"}[s]
}

type BasePizza struct {
	size Size
}

func NewBasePizza(s Size) *BasePizza {
	return &BasePizza{size: s}
}

func (b *BasePizza) Description() string {
	return sizeName(b.size) + " pizza"
}

func (b *BasePizza) Cost() Cents {
	return []Cents{800, 1000, 1200}[b.size]
}

// Decorator base
type ToppingDecorator struct {
	inner    Pizza
	name     string
	addCost  Cents
}

func (t *ToppingDecorator) Description() string {
	return t.inner.Description() + " + " + t.name
}

func (t *ToppingDecorator) Cost() Cents {
	return t.inner.Cost() + t.addCost
}

func WithCheese(p Pizza) Pizza {
	return &ToppingDecorator{inner: p, name: "cheese", addCost: 150}
}
func WithPepperoni(p Pizza) Pizza {
	return &ToppingDecorator{inner: p, name: "pepperoni", addCost: 200}
}
func WithMushrooms(p Pizza) Pizza {
	return &ToppingDecorator{inner: p, name: "mushrooms", addCost: 100}
}
func WithExtraCheese(p Pizza) Pizza {
	return &ToppingDecorator{inner: p, name: "extra cheese", addCost: 250}
}

// Pricing
type Pricing interface {
	Total(pizzas []Pizza) Cents
}

type FlatPricing struct{}

func (FlatPricing) Total(pizzas []Pizza) Cents {
	var t Cents
	for _, p := range pizzas {
		t += p.Cost()
	}
	return t
}

type HappyHourPricing struct{}

func (HappyHourPricing) Total(pizzas []Pizza) Cents {
	var t Cents
	for _, p := range pizzas {
		t += p.Cost()
	}
	return Cents(float64(t) * 0.80)
}

type Order struct {
	Pizzas []Pizza
	Pricing Pricing
}

func (o *Order) Receipt() string {
	out := ""
	for i, p := range o.Pizzas {
		out += fmt.Sprintf("  %d. %s = %d cents\n", i+1, p.Description(), p.Cost())
	}
	out += fmt.Sprintf("Total: %d cents\n", o.Pricing.Total(o.Pizzas))
	return out
}

// Tests
func main() {
	p := NewBasePizza(Medium)
	if p.Cost() != 1000 {
		panic(p.Cost())
	}

	pp := WithMushrooms(WithPepperoni(WithCheese(NewBasePizza(Large))))
	if pp.Cost() != 1200+150+200+100 {
		panic(pp.Cost())
	}
	fmt.Println(pp.Description(), pp.Cost())

	o := &Order{
		Pizzas: []Pizza{
			WithExtraCheese(WithPepperoni(NewBasePizza(Large))),
			WithCheese(NewBasePizza(Small)),
		},
		Pricing: FlatPricing{},
	}
	fmt.Print(o.Receipt())

	o.Pricing = HappyHourPricing{}
	fmt.Print(o.Receipt())

	fmt.Println("All tests passed.")
}
```

---

## 2. Cheat-Sheet
1. Pizza interface; BasePizza struct.
2. ToppingDecorator wraps another Pizza.
3. Strategy for pricing.

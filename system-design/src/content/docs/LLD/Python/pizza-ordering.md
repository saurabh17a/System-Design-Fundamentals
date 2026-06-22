# Pizza Ordering — LLD (Python)

> **Difficulty:** Easy → Medium
> **Tags:** `[lld]` `[decorator-pattern]` `[strategy]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

You order a pizza: small thin-crust + cheese + mushrooms + extra olives. The system needs to compute the total price and a description ("Small thin-crust pizza with cheese, mushrooms, olives"). Each topping is a layer on top of the base. The classic pattern for "stacking modifiers" is the **Decorator pattern**.

### Why solve it?

- **Easy LLD warmup**: small but uses a real pattern.
- **Teaches**: Decorator pattern, separating base from modifiers, building costs up incrementally.

### Vocabulary

- **Pizza / Beverage** — base item.
- **Topping / Modifier** — wraps a pizza, adds price + description.
- **Decorator** — design pattern: object that wraps another with the SAME interface.

### High-level approach

A common interface (`Pizza`) with `cost()` and `describe()` methods.

- `BasePizza(size)` — implements the interface.
- `Topping(pizza)` — also implements the interface; wraps a pizza, adds its own cost/description.

To build "thin + cheese + mushrooms": `Mushrooms(Cheese(BasePizza("thin")))`. Each call delegates to inner + adds itself.

### How to read this doc

- **Beginner**: trace `cost()` through a stack of decorators.
- **Interview**: discuss alternatives — could use a list of toppings on a Pizza class. Trade-offs.

---

## 0. Why this question

Classic **Decorator pattern** demo. A pizza has a base + N toppings; each topping wraps the pizza, adding cost.

---

## 1. Code

```python
"""Pizza ordering with Decorator + Strategy."""
from __future__ import annotations
import enum
from abc import ABC, abstractmethod
from dataclasses import dataclass
from decimal import Decimal


class Size(enum.Enum):
    SMALL = "small"
    MEDIUM = "medium"
    LARGE = "large"


# Component
class Pizza(ABC):
    @abstractmethod
    def description(self) -> str: ...
    @abstractmethod
    def cost(self) -> Decimal: ...


# Concrete component
class BasePizza(Pizza):
    def __init__(self, size: Size = Size.MEDIUM):
        self._size = size
        self._base_cost = {
            Size.SMALL:  Decimal("8.00"),
            Size.MEDIUM: Decimal("10.00"),
            Size.LARGE:  Decimal("12.00"),
        }[size]

    def description(self) -> str:
        return f"{self._size.value} pizza"

    def cost(self) -> Decimal:
        return self._base_cost


# Decorator base
class ToppingDecorator(Pizza, ABC):
    def __init__(self, pizza: Pizza):
        self._pizza = pizza

    def description(self) -> str:
        return f"{self._pizza.description()} + {self._topping_name()}"

    def cost(self) -> Decimal:
        return self._pizza.cost() + self._topping_cost()

    @abstractmethod
    def _topping_name(self) -> str: ...

    @abstractmethod
    def _topping_cost(self) -> Decimal: ...


class Cheese(ToppingDecorator):
    def _topping_name(self): return "cheese"
    def _topping_cost(self): return Decimal("1.50")


class Pepperoni(ToppingDecorator):
    def _topping_name(self): return "pepperoni"
    def _topping_cost(self): return Decimal("2.00")


class Mushrooms(ToppingDecorator):
    def _topping_name(self): return "mushrooms"
    def _topping_cost(self): return Decimal("1.00")


class ExtraCheese(ToppingDecorator):
    def _topping_name(self): return "extra cheese"
    def _topping_cost(self): return Decimal("2.50")


# Pricing strategy (multiplier)
class PricingStrategy(ABC):
    @abstractmethod
    def total(self, pizzas: list[Pizza]) -> Decimal: ...


class FlatPricing(PricingStrategy):
    def total(self, pizzas):
        return sum((p.cost() for p in pizzas), Decimal("0"))


class HappyHourPricing(PricingStrategy):
    """20% off."""
    def total(self, pizzas):
        return sum((p.cost() for p in pizzas), Decimal("0")) * Decimal("0.80")


# Order
@dataclass
class Order:
    pizzas: list[Pizza]
    pricing: PricingStrategy

    def receipt(self) -> str:
        lines = []
        for i, p in enumerate(self.pizzas, 1):
            lines.append(f"  {i}. {p.description()} = ${p.cost()}")
        lines.append(f"Total: ${self.pricing.total(self.pizzas)}")
        return "\n".join(lines)


# Tests
def main():
    print("--- single plain pizza ---")
    p = BasePizza(Size.MEDIUM)
    assert p.cost() == Decimal("10.00")
    print(f"  {p.description()} ${p.cost()}")

    print("--- with toppings (decorator) ---")
    p = BasePizza(Size.LARGE)
    p = Cheese(p)
    p = Pepperoni(p)
    p = Mushrooms(p)
    assert p.cost() == Decimal("12") + Decimal("1.50") + Decimal("2") + Decimal("1")
    print(f"  {p.description()} = ${p.cost()}")

    print("--- order ---")
    p1 = ExtraCheese(Pepperoni(BasePizza(Size.LARGE)))
    p2 = Cheese(BasePizza(Size.SMALL))
    order = Order(pizzas=[p1, p2], pricing=FlatPricing())
    print(order.receipt())

    print("--- happy hour ---")
    order2 = Order(pizzas=[p1, p2], pricing=HappyHourPricing())
    expected = (Decimal("12") + Decimal("2") + Decimal("2.50") +
                Decimal("8") + Decimal("1.50")) * Decimal("0.80")
    assert order2.pricing.total(order2.pizzas) == expected
    print(order2.receipt())

    print("\nAll tests passed.")


if __name__ == "__main__":
    main()
```

---

## 2. Cross-Questions

### 2.1 Why decorator vs subclassing?
- Subclassing: 2^N classes for N toppings.
- Decorator: stack toppings dynamically.

### 2.2 Why separate pricing strategy?
Promotional pricing changes; decoupled from pizza definition.

### 2.3 What if topping cost depends on pizza size?
Decorator can read size from inner pizza (drill down or pass via interface).

---

## 3. Cheat-Sheet
1. Pizza interface; BasePizza concrete.
2. ToppingDecorator wraps Pizza; adds cost.
3. Strategy for pricing rules.
4. Order = list of pizzas + strategy.

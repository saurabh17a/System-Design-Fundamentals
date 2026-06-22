# Online Shopping Cart — LLD (Python)

> **Difficulty:** Medium
> **Tags:** `[lld]` `[strategy]` `[decorator]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

You're building Amazon's cart. Customer adds items, sees subtotal. Apply a coupon — discount. Choose payment method — pay. Inventory must update on checkout. Multiple discount rules (10% off, BOGO, $10 off over $50, etc.) need to combine cleanly.

### Why solve it?

- **Real world**: every e-commerce site needs this.
- **Teaches**: Strategy pattern for discounts and payments, transactional inventory updates.
- **Patterns**: strategy, decorator (stacking discounts), state.

### Vocabulary

- **CartItem** — product + quantity.
- **DiscountStrategy** — rule that reduces total.
- **PaymentStrategy** — handles cash/card/UPI.
- **Inventory** — products with stock counts.

### High-level approach

Entities:
- **Product** — id, name, price.
- **CartItem** — product + quantity.
- **Cart** — list of items, owner.
- **DiscountStrategy** — interface; concrete: PercentOff, FixedOff, BOGO.
- **PaymentStrategy** — interface; concrete: Card, UPI, Wallet.
- **Inventory** — locks down stock during checkout.

Checkout flow: compute subtotal → apply discounts (in order) → process payment → decrement inventory atomically → return order.

### How to read this doc

- **Beginner**: focus on Cart + Discount strategy.
- **Interview**: order of discount application matters; discuss rules engines vs hard-coded order.

---

## 0. Why this question

Cart + checkout is universal e-commerce LLD. Tests **discounts (Strategy), inventory linkage, payment (Strategy)**.

---

## 1. Problem

- Add/remove items (with quantity).
- Apply discount (coupon, percent off, BOGO).
- Compute total with tax.
- Checkout: payment + create order.

---

## 2. Code

```python
"""Online Shopping Cart."""
from __future__ import annotations
import enum
import threading
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional


class CartError(Exception): ...
class OutOfStock(CartError): ...
class EmptyCart(CartError): ...


@dataclass(frozen=True)
class Product:
    id: str
    name: str
    price: Decimal


@dataclass
class CartItem:
    product: Product
    quantity: int


class Discount(ABC):
    @abstractmethod
    def apply(self, subtotal: Decimal, items: list[CartItem]) -> Decimal:
        """Return discount amount (positive)."""


class PercentOff(Discount):
    def __init__(self, percent: Decimal):
        self.percent = percent
    def apply(self, subtotal, items):
        return subtotal * self.percent / Decimal("100")


class FlatOff(Discount):
    def __init__(self, amount: Decimal, min_subtotal: Decimal = Decimal("0")):
        self.amount = amount
        self.min = min_subtotal
    def apply(self, subtotal, items):
        if subtotal >= self.min:
            return min(self.amount, subtotal)
        return Decimal("0")


class BOGO(Discount):
    """Buy one get one free for a specific product."""
    def __init__(self, product_id: str):
        self.product_id = product_id
    def apply(self, subtotal, items):
        for it in items:
            if it.product.id == self.product_id and it.quantity >= 2:
                pairs = it.quantity // 2
                return it.product.price * pairs
        return Decimal("0")


class PaymentMethod(ABC):
    @abstractmethod
    def charge(self, amount: Decimal) -> bool: ...


class MockCard(PaymentMethod):
    def charge(self, amount):
        return True  # always succeed


class MockWallet(PaymentMethod):
    def __init__(self, balance: Decimal):
        self.balance = balance
    def charge(self, amount):
        if self.balance < amount:
            return False
        self.balance -= amount
        return True


@dataclass
class Order:
    id: str
    items: list[CartItem]
    subtotal: Decimal
    discount: Decimal
    tax: Decimal
    total: Decimal


class Inventory:
    def __init__(self):
        self._stock: dict[str, int] = {}
        self._lock = threading.Lock()

    def add(self, product_id: str, qty: int) -> None:
        with self._lock:
            self._stock[product_id] = self._stock.get(product_id, 0) + qty

    def reserve(self, product_id: str, qty: int) -> bool:
        with self._lock:
            if self._stock.get(product_id, 0) < qty:
                return False
            self._stock[product_id] -= qty
            return True

    def stock(self, product_id: str) -> int:
        with self._lock:
            return self._stock.get(product_id, 0)


class Cart:
    TAX_RATE = Decimal("0.08")

    def __init__(self, inventory: Inventory):
        self._items: dict[str, CartItem] = {}
        self._discounts: list[Discount] = []
        self._inv = inventory

    def add(self, product: Product, quantity: int) -> None:
        if quantity <= 0:
            raise ValueError("qty > 0")
        if self._inv.stock(product.id) < quantity:
            raise OutOfStock(product.id)
        if product.id in self._items:
            self._items[product.id].quantity += quantity
        else:
            self._items[product.id] = CartItem(product=product, quantity=quantity)

    def remove(self, product_id: str) -> None:
        self._items.pop(product_id, None)

    def update_qty(self, product_id: str, quantity: int) -> None:
        if quantity <= 0:
            self.remove(product_id)
        else:
            self._items[product_id].quantity = quantity

    def apply_discount(self, d: Discount) -> None:
        self._discounts.append(d)

    def subtotal(self) -> Decimal:
        return sum((i.product.price * i.quantity for i in self._items.values()), Decimal("0"))

    def discount_total(self) -> Decimal:
        st = self.subtotal()
        items = list(self._items.values())
        return sum((d.apply(st, items) for d in self._discounts), Decimal("0"))

    def tax(self) -> Decimal:
        return (self.subtotal() - self.discount_total()) * self.TAX_RATE

    def total(self) -> Decimal:
        return self.subtotal() - self.discount_total() + self.tax()

    def checkout(self, payment: PaymentMethod) -> Order:
        if not self._items:
            raise EmptyCart()
        # Reserve all (atomic-ish)
        reserved: list[tuple[str, int]] = []
        for it in self._items.values():
            if self._inv.reserve(it.product.id, it.quantity):
                reserved.append((it.product.id, it.quantity))
            else:
                # Roll back
                for pid, q in reserved:
                    self._inv.add(pid, q)
                raise OutOfStock(it.product.id)
        amt = self.total()
        if not payment.charge(amt):
            for pid, q in reserved:
                self._inv.add(pid, q)
            raise CartError("payment failed")
        order = Order(
            id=str(uuid.uuid4()),
            items=list(self._items.values()),
            subtotal=self.subtotal(),
            discount=self.discount_total(),
            tax=self.tax(),
            total=amt,
        )
        self._items.clear()
        self._discounts.clear()
        return order


# Tests
def main():
    inv = Inventory()
    apple = Product(id="A", name="Apple", price=Decimal("1.00"))
    book = Product(id="B", name="Book", price=Decimal("20.00"))
    inv.add("A", 100); inv.add("B", 5)

    print("--- basic add + total ---")
    c = Cart(inv)
    c.add(apple, 3)
    c.add(book, 1)
    assert c.subtotal() == Decimal("23.00")
    print(f"  subtotal={c.subtotal()}, total={c.total()}")

    print("--- BOGO discount ---")
    c = Cart(inv)
    c.add(apple, 4)  # 4 apples; 2 pairs free → $2 off
    c.apply_discount(BOGO("A"))
    assert c.discount_total() == Decimal("2.00")
    print("  OK")

    print("--- percent off ---")
    c = Cart(inv)
    c.add(book, 1)
    c.apply_discount(PercentOff(Decimal("10")))
    assert c.discount_total() == Decimal("2.00")
    print("  OK")

    print("--- flat off (min) ---")
    c = Cart(inv)
    c.add(apple, 5)  # $5
    c.apply_discount(FlatOff(Decimal("3"), min_subtotal=Decimal("10")))
    assert c.discount_total() == Decimal("0")  # under min
    c.add(apple, 10)  # $15 now
    assert c.discount_total() == Decimal("3")
    print("  OK")

    print("--- checkout ---")
    inv_co = Inventory(); inv_co.add("A", 100)
    c = Cart(inv_co)
    c.add(apple, 2)
    order = c.checkout(MockCard())
    assert order.total > 0
    assert inv_co.stock("A") == 98
    print(f"  order: {order.id}, total={order.total}")

    print("--- payment fail rolls back ---")
    inv2 = Inventory(); inv2.add("A", 10)
    c = Cart(inv2); c.add(apple, 5)
    try:
        c.checkout(MockWallet(Decimal("0")))
    except CartError:
        pass
    assert inv2.stock("A") == 10  # rolled back
    print("  OK")

    print("\nAll tests passed.")


if __name__ == "__main__":
    main()
```

---

## 3. Cheat-Sheet

1. Cart holds items; discounts as Strategy.
2. Subtotal → discount → tax → total.
3. Checkout: reserve → charge → create Order; rollback on fail.
4. Inventory tracks reservations.

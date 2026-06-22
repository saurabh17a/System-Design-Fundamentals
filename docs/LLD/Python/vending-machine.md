# Vending Machine — LLD (Python)

> **Difficulty:** Medium
> **Tags:** `[lld]` `[state-machine]` `[strategy]` `[inventory]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

You walk up to a snack machine. You insert coins, pick a slot, get a snack and change. Behind the buttons is a state machine: it can't dispense before you insert money; it can't accept more coins after you pressed the button. The interview wants you to model that machine with code.

### Why solve it?

- **Real world**: vending machines, kiosks, parking meters, anything coin-operated.
- **Teaches**: state pattern, inventory tracking, the importance of explicit states (vs scattered booleans).
- **Patterns**: state, strategy (different coin systems), command (button press).

### Vocabulary

- **State** — what the machine can do right now (idle / accepting coins / dispensing).
- **Transition** — moving from one state to another (insert coin: idle → accepting).
- **Inventory** — products with quantities.
- **Change** — money returned to the customer.

### High-level approach

Entities:
- **Product** — name, price, quantity.
- **Coin / Note** — denominations.
- **Inventory** — `dict[product_name → Product]`; track stock.
- **Machine** — current state, balance inserted so far, current selection.
- **State** — IdleState, HasMoneyState, DispensingState — each handles allowed operations.

State pattern: each state class implements `insert_coin`, `select`, `dispense`, `cancel` — and most error out except where the operation is valid.

Flow: idle → insert coins → select → if balance ≥ price → dispense + change → idle. At any time, cancel returns coins.

### How to read this doc

- **Beginner**: focus on the state diagram before code.
- **Interview**: change-making algorithm (greedy vs DP) is a common follow-up.

---

## 1. Problem Statement

Vending machine:
- Customer selects product, inserts coins/notes.
- Machine validates payment, dispenses, returns change.
- Inventory of products + coins (for change).
- Admin restocks.

---

## 2. Design

| Entity |
|---|
| `Product` (id, name, price) |
| `Slot` (product, count) |
| `Coin` (denomination) |
| `VendingMachine` (slots, coin_inventory, current_credit, state) |

State machine: IDLE → COLLECTING_MONEY → DISPENSING → IDLE.

Pattern: State, Strategy (change calculation).

---

## 3. Code

```python
"""Vending Machine."""
from __future__ import annotations
import enum
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional


class State(enum.Enum):
    IDLE = "idle"
    COLLECTING = "collecting_money"
    DISPENSING = "dispensing"


class VMError(Exception): ...
class OutOfStock(VMError): ...
class InsufficientFunds(VMError): ...
class CannotMakeChange(VMError): ...
class WrongState(VMError): ...


@dataclass(frozen=True)
class Product:
    id: str
    name: str
    price: Decimal


@dataclass
class Slot:
    product: Product
    count: int


@dataclass
class VendingMachine:
    slots: dict[str, Slot] = field(default_factory=dict)  # product_id → slot
    coin_inventory: dict[Decimal, int] = field(default_factory=dict)  # denom → count
    current_credit: Decimal = Decimal("0.00")
    selected: Optional[Product] = None
    state: State = State.IDLE

    def add_product(self, product: Product, count: int) -> None:
        self.slots[product.id] = Slot(product=product, count=count)

    def add_coins(self, denom: Decimal, count: int) -> None:
        self.coin_inventory[denom] = self.coin_inventory.get(denom, 0) + count

    def select(self, product_id: str) -> None:
        if self.state is not State.IDLE:
            raise WrongState(f"state={self.state}")
        slot = self.slots.get(product_id)
        if slot is None:
            raise VMError(f"unknown product {product_id}")
        if slot.count == 0:
            raise OutOfStock(f"{slot.product.name}")
        self.selected = slot.product
        self.state = State.COLLECTING

    def insert_coin(self, denom: Decimal) -> None:
        if self.state is not State.COLLECTING:
            raise WrongState(f"state={self.state}")
        self.coin_inventory[denom] = self.coin_inventory.get(denom, 0) + 1
        self.current_credit += denom

    def cancel(self) -> dict[Decimal, int]:
        """Cancel and return all inserted coins."""
        if self.state is not State.COLLECTING:
            raise WrongState(f"state={self.state}")
        # For simplicity: return same denominations as inserted
        # In real machine, track inserted coins specifically
        change = self._make_change(self.current_credit)
        self._reset()
        return change

    def confirm(self) -> tuple[Product, dict[Decimal, int]]:
        if self.state is not State.COLLECTING:
            raise WrongState(f"state={self.state}")
        if self.current_credit < self.selected.price:
            raise InsufficientFunds(f"need {self.selected.price}, have {self.current_credit}")
        self.state = State.DISPENSING
        change_amount = self.current_credit - self.selected.price
        try:
            change = self._make_change(change_amount)
        except CannotMakeChange:
            # Rollback: don't dispense
            self.state = State.COLLECTING
            raise
        # Dispense
        slot = self.slots[self.selected.id]
        slot.count -= 1
        product = self.selected
        self._reset()
        return product, change

    def _make_change(self, amount: Decimal) -> dict[Decimal, int]:
        if amount <= 0:
            return {}
        # Greedy by descending denomination
        change: dict[Decimal, int] = {}
        for denom in sorted(self.coin_inventory.keys(), reverse=True):
            avail = self.coin_inventory[denom]
            need = int(amount // denom)
            give = min(avail, need)
            if give > 0:
                change[denom] = give
                amount -= denom * give
        if amount > 0:
            raise CannotMakeChange(f"cannot make change for {amount}")
        # Deduct from inventory
        for denom, n in change.items():
            self.coin_inventory[denom] -= n
        return change

    def _reset(self) -> None:
        self.current_credit = Decimal("0.00")
        self.selected = None
        self.state = State.IDLE


# Tests
def main():
    print("--- happy path ---")
    vm = VendingMachine()
    coke = Product(id="C", name="Coke", price=Decimal("1.50"))
    vm.add_product(coke, count=5)
    for d in [Decimal("0.25"), Decimal("0.50"), Decimal("1.00")]:
        vm.add_coins(d, 10)
    vm.select("C")
    vm.insert_coin(Decimal("1.00"))
    vm.insert_coin(Decimal("1.00"))
    product, change = vm.confirm()
    assert product.name == "Coke"
    assert change == {Decimal("0.50"): 1}
    print(f"  product={product.name}, change={change}")

    print("--- out of stock ---")
    vm = VendingMachine()
    vm.add_product(coke, count=0)
    try:
        vm.select("C")
    except OutOfStock:
        pass
    print("  OK")

    print("--- insufficient funds ---")
    vm = VendingMachine()
    vm.add_product(coke, count=1)
    vm.add_coins(Decimal("0.25"), 10)
    vm.select("C")
    vm.insert_coin(Decimal("0.25"))
    try:
        vm.confirm()
    except InsufficientFunds:
        pass
    print("  OK")

    print("--- cancel returns coins ---")
    vm = VendingMachine()
    vm.add_product(coke, count=1)
    for d in [Decimal("0.25"), Decimal("0.50")]:
        vm.add_coins(d, 5)
    vm.select("C")
    vm.insert_coin(Decimal("0.50"))
    change = vm.cancel()
    assert change == {Decimal("0.50"): 1}
    assert vm.state is State.IDLE
    print(f"  returned: {change}")

    print("--- cannot make change rolls back ---")
    vm = VendingMachine()
    vm.add_product(coke, count=1)
    # Only quarters; can't make $0.25 of change for $1.50 product paid $2
    # Actually need to construct a scenario where change is impossible
    vm.add_coins(Decimal("1.00"), 1)  # only one $1
    vm.select("C")
    vm.insert_coin(Decimal("1.00"))
    vm.insert_coin(Decimal("1.00"))
    # paid $2, price $1.50, change $0.50 — but we have no $0.50
    try:
        vm.confirm()
    except CannotMakeChange:
        pass
    # State should be back to COLLECTING (rollback)
    assert vm.state is State.COLLECTING
    print("  OK; state rolled back")

    print("\nAll tests passed.")


if __name__ == "__main__":
    main()
```

---

## 4. Cross-Questions

### 4.1 Greedy change vs DP?
- US/IN coin systems: greedy works (canonical).
- Some systems (rare): need DP for optimal.
- Defensive: DP for correctness.

### 4.2 Why rollback on can't-make-change?
- User experience: don't take the money if you can't fulfill.
- Either give product + accept loss, or refuse.

### 4.3 Multiple denominations?
- Coin inventory tracks each.
- Bills modeled the same way.

### 4.4 Refunds?
- Cancel returns inserted coins as best-effort change.
- Real machines: track inserted denominations for exact return.

---

## 5. Cheat-Sheet
1. State: IDLE → COLLECTING → DISPENSING.
2. Greedy change algorithm.
3. Rollback if change not makable.
4. Inventory of products + coins separately.

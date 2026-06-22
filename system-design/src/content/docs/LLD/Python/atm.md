# ATM — LLD (Python)

> **Difficulty:** Medium
> **Tags:** `[lld]` `[state-machine]` `[transactions]` `[strategy]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

A bank ATM. Insert card, type PIN, see account balance, withdraw cash, get receipt. Behind the screen: a state machine that won't let you skip steps (can't withdraw without authenticating). Plus inventory: the ATM holds physical cash in different denominations and has to dispense the right combination.

### Why solve it?

- **Real world**: ATMs, kiosks, ticket machines, any "auth then transact" UX.
- **Teaches**: state pattern, transactions, denomination dispensing (a small coin-change problem).
- **Patterns**: state, strategy (different account types: savings/checking/credit).

### Vocabulary

- **Card** — physical card with account number.
- **PIN** — secret number to authenticate.
- **Account** — has a balance; different types have different rules (overdraft for credit, etc.).
- **Denomination** — bill values: $20, $50, $100.
- **State** — IDLE → CARD_INSERTED → AUTHENTICATED → TRANSACTION_IN_PROGRESS → done.

### High-level approach

Entities:
- **Card / Account** — card has account_no; account has balance, type, transaction history.
- **CashInventory** — counts of each denomination.
- **ATM** — current state, current card, current account, cash inventory.
- **State** classes — Idle, CardInserted, Authenticated, TransactionInProgress.

Flow:
1. Idle → InsertCard → CardInserted (validate card).
2. CardInserted → EnterPIN → Authenticated (validate, lock account on N failures).
3. Authenticated → choose Withdraw/Deposit/Balance.
4. For Withdraw: check balance, check inventory, dispense bills (greedy from high to low).
5. EjectCard → Idle.

### How to read this doc

- **Beginner**: focus on the state machine + dispense algorithm.
- **Interview**: discuss what happens when high-denom is out — fall back to lower; if can't, reject.

---

## 1. Problem Statement

ATM machine:
- Insert card → authenticate.
- Select operation: balance / withdraw / deposit / transfer.
- Process; dispense cash; print receipt.
- Bills inventory (mostly $20s and $100s).

---

## 2. Design

State machine: IDLE → AUTHENTICATING → AUTHENTICATED → TRANSACTING → IDLE.

| Entity |
|---|
| `Card` (number, pin_hash) |
| `Account` (number, balance) |
| `BankService` (validates card+pin; processes transactions) |
| `BillDispenser` (denominations + counts) |
| `ATM` (state, current session) |

Pattern: State (ATM state machine), Strategy (operation types).

---

## 3. Code

```python
"""ATM with state machine + bill dispenser."""
from __future__ import annotations
import enum
import hashlib
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional


class State(enum.Enum):
    IDLE = "idle"
    AUTHENTICATING = "authenticating"
    AUTHENTICATED = "authenticated"
    TRANSACTING = "transacting"


class ATMError(Exception): ...
class WrongState(ATMError): ...
class AuthFailed(ATMError): ...
class InsufficientFunds(ATMError): ...
class CannotDispense(ATMError): ...
class UnknownAccount(ATMError): ...


@dataclass(frozen=True)
class Card:
    number: str
    pin_hash: str

    @staticmethod
    def hash_pin(pin: str) -> str:
        return hashlib.sha256(pin.encode()).hexdigest()


@dataclass
class Account:
    number: str
    balance: Decimal


class BankService:
    """Source of truth; validates and processes."""
    def __init__(self):
        self._cards: dict[str, Card] = {}
        self._accounts: dict[str, Account] = {}
        self._card_to_account: dict[str, str] = {}

    def register(self, card: Card, account: Account) -> None:
        self._cards[card.number] = card
        self._accounts[account.number] = account
        self._card_to_account[card.number] = account.number

    def authenticate(self, card_number: str, pin: str) -> Account:
        card = self._cards.get(card_number)
        if not card or card.pin_hash != Card.hash_pin(pin):
            raise AuthFailed()
        return self._accounts[self._card_to_account[card_number]]

    def withdraw(self, account: Account, amount: Decimal) -> None:
        if amount <= 0 or account.balance < amount:
            raise InsufficientFunds()
        account.balance -= amount

    def deposit(self, account: Account, amount: Decimal) -> None:
        if amount <= 0:
            raise ValueError("amount > 0")
        account.balance += amount

    def transfer(self, src: Account, dst_number: str, amount: Decimal) -> None:
        dst = self._accounts.get(dst_number)
        if dst is None:
            raise UnknownAccount()
        self.withdraw(src, amount)
        self.deposit(dst, amount)


class BillDispenser:
    def __init__(self, inventory: dict[Decimal, int]):
        self._inv = dict(inventory)

    def dispense(self, amount: Decimal) -> dict[Decimal, int]:
        # Greedy
        bills: dict[Decimal, int] = {}
        remaining = amount
        for denom in sorted(self._inv.keys(), reverse=True):
            n = min(self._inv[denom], int(remaining // denom))
            if n > 0:
                bills[denom] = n
                remaining -= denom * n
        if remaining > 0:
            raise CannotDispense(f"can't dispense {amount}")
        for d, n in bills.items():
            self._inv[d] -= n
        return bills

    def add(self, denom: Decimal, count: int) -> None:
        self._inv[denom] = self._inv.get(denom, 0) + count


@dataclass
class ATM:
    bank: BankService
    dispenser: BillDispenser
    state: State = State.IDLE
    current_account: Optional[Account] = None

    def insert_card(self, card_number: str) -> None:
        if self.state is not State.IDLE:
            raise WrongState()
        self.state = State.AUTHENTICATING
        self._pending_card_number = card_number  # type: ignore

    def enter_pin(self, pin: str) -> None:
        if self.state is not State.AUTHENTICATING:
            raise WrongState()
        try:
            self.current_account = self.bank.authenticate(self._pending_card_number, pin)
            self.state = State.AUTHENTICATED
        except AuthFailed:
            self.eject_card()
            raise

    def get_balance(self) -> Decimal:
        if self.state is not State.AUTHENTICATED:
            raise WrongState()
        return self.current_account.balance

    def withdraw(self, amount: Decimal) -> dict[Decimal, int]:
        if self.state is not State.AUTHENTICATED:
            raise WrongState()
        self.state = State.TRANSACTING
        try:
            # Pre-check both: bank balance + dispenser ability
            if self.current_account.balance < amount:
                raise InsufficientFunds()
            bills = self.dispenser.dispense(amount)
            self.bank.withdraw(self.current_account, amount)
            return bills
        finally:
            self.state = State.AUTHENTICATED

    def deposit(self, amount: Decimal) -> None:
        if self.state is not State.AUTHENTICATED:
            raise WrongState()
        self.state = State.TRANSACTING
        try:
            self.bank.deposit(self.current_account, amount)
        finally:
            self.state = State.AUTHENTICATED

    def transfer(self, dst_account_number: str, amount: Decimal) -> None:
        if self.state is not State.AUTHENTICATED:
            raise WrongState()
        self.state = State.TRANSACTING
        try:
            self.bank.transfer(self.current_account, dst_account_number, amount)
        finally:
            self.state = State.AUTHENTICATED

    def eject_card(self) -> None:
        self.current_account = None
        self.state = State.IDLE


# Tests
def main():
    bank = BankService()
    card = Card(number="1111-2222", pin_hash=Card.hash_pin("1234"))
    acct = Account(number="A001", balance=Decimal("500.00"))
    bank.register(card, acct)
    acct2 = Account(number="A002", balance=Decimal("100.00"))
    bank.register(Card(number="3333-4444", pin_hash=Card.hash_pin("9999")), acct2)

    disp = BillDispenser({Decimal("100"): 5, Decimal("20"): 10})

    atm = ATM(bank=bank, dispenser=disp)

    print("--- happy withdraw ---")
    atm.insert_card("1111-2222")
    atm.enter_pin("1234")
    bills = atm.withdraw(Decimal("140"))
    assert bills == {Decimal("100"): 1, Decimal("20"): 2}
    assert atm.get_balance() == Decimal("360.00")
    atm.eject_card()
    print(f"  bills={bills}, balance={acct.balance}")

    print("--- bad pin ---")
    atm.insert_card("1111-2222")
    try:
        atm.enter_pin("0000")
    except AuthFailed:
        pass
    assert atm.state is State.IDLE
    print("  OK; ejected on bad pin")

    print("--- insufficient funds ---")
    atm.insert_card("1111-2222")
    atm.enter_pin("1234")
    try:
        atm.withdraw(Decimal("1000"))
    except InsufficientFunds:
        pass
    print("  OK")

    print("--- transfer ---")
    atm.transfer("A002", Decimal("50"))
    assert acct2.balance == Decimal("150.00")
    print(f"  acct2 balance: {acct2.balance}")

    print("--- can't dispense ---")
    atm.eject_card()
    atm.insert_card("1111-2222")
    atm.enter_pin("1234")
    try:
        atm.withdraw(Decimal("75"))  # no $5 bills
    except CannotDispense:
        pass
    # Balance unchanged
    print(f"  balance unchanged: {acct.balance}")

    print("\nAll tests passed.")


if __name__ == "__main__":
    main()
```

---

## 4. Cross-Questions
1. **Why state machine?** Operations only valid in certain states; enforce.
2. **Why pre-check both balance and dispenser?** Either failure should not commit the other side. Order: dispenser first (then bank withdraw); or use saga.
3. **What about concurrency?** ATM is per-machine; one customer at a time. Bank service can be concurrent (transactions atomic).
4. **PIN security?** Store hashed; never plaintext.
5. **What about double withdrawal (race)?** Bank uses transaction; only one wins. ATM serializes.

---

## 5. Cheat-Sheet
1. State: IDLE → AUTH → AUTHENTICATED → TRANSACTING.
2. BankService: source of truth.
3. BillDispenser: greedy bill selection.
4. Pin hashed at rest.
5. Pre-check before commit (both bank and dispenser).

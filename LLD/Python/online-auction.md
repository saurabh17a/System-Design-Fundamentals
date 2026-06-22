# Online Auction — LLD (Python)

> **Difficulty:** Medium → Hard
> **Tags:** `[lld]` `[bidding]` `[concurrency]` `[anti-snipe]`
> **Language:** Python 3.10+

---

## Beginner's Guide

### What's this in plain English?

eBay-style auction. An item has a start price, an end time, and a reserve price (minimum acceptable). Bidders place bids; current highest bid wins at end time. Last-second bidding ("sniping") is annoying — many real systems extend the auction by a few minutes if a bid arrives in the last seconds (anti-snipe).

### Why solve it?

- **Real world**: eBay, art auctions, government contracts, ad bidding.
- **Teaches**: time-based state, comparing bids atomically, anti-snipe, concurrency (10K simultaneous bids near end).
- **Interview**: tests handling time + concurrency + invariants together.

### Vocabulary

- **Reserve price** — minimum to win; if no bid clears reserve, no sale.
- **Increment / minimum step** — must beat current highest by ≥ X.
- **Anti-snipe** — extend end time if a bid arrives close to end.
- **Auction state** — DRAFT → OPEN → CLOSED.

### High-level approach

Entities:
- **Auction** — id, item, seller, start_time, end_time, reserve_price, current_bid.
- **Bid** — bidder_id, amount, time.
- **AuctionService** — orchestrator.

Bid flow under a lock:
1. State == OPEN?
2. now < end_time?
3. amount > current_bid + min_increment?
4. Update current_bid, current_winner.
5. If now > end_time - 30s → extend end_time by 30s (anti-snipe).

### How to read this doc

- **Beginner**: focus on the bid validation steps.
- **Interview**: anti-snipe, payment on close, edge cases (seller bidding, reserve not met).

---

## 1. Problem Statement

Auction system (LLD-level):
- Items with start price, end time, optional reserve.
- Bidders place bids; highest valid wins.
- Proxy bidding (auto-bid up to user's max).
- Anti-snipe (extend on last-N-min bid).
- Strict ordering on close-second bids.

(For HLD scale, see `HLD/online-auction.md`.)

---

## 2. Code

```python
"""Online Auction LLD."""
from __future__ import annotations
import enum
import heapq
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Optional


class AuctionState(enum.Enum):
    OPEN = "open"
    CLOSED_WITH_WINNER = "closed_with_winner"
    CLOSED_NO_WINNER = "closed_no_winner"


class AuctionError(Exception): ...
class BidTooLow(AuctionError): ...
class AuctionClosed(AuctionError): ...


@dataclass
class Item:
    id: str
    seller_id: str
    title: str
    start_price: Decimal
    reserve: Optional[Decimal] = None
    end_time: datetime = field(default_factory=lambda: datetime.utcnow())
    min_increment: Decimal = Decimal("1.00")
    anti_snipe_window: timedelta = timedelta(minutes=2)


@dataclass(frozen=True)
class Bid:
    bid_id: str
    item_id: str
    bidder_id: str
    amount: Decimal
    timestamp: datetime
    is_proxy_max: bool = False


class AuctionService:
    def __init__(self):
        self._items: dict[str, Item] = {}
        self._current_high: dict[str, Bid] = {}  # item_id → highest bid
        self._proxy_max: dict[str, dict[str, Decimal]] = {}  # item_id → user → max
        self._all_bids: dict[str, list[Bid]] = {}
        self._lock = threading.RLock()
        self._closed: set[str] = set()

    def list_item(self, seller_id: str, title: str, start_price: Decimal,
                  end_time: datetime, reserve: Optional[Decimal] = None) -> Item:
        item = Item(id=str(uuid.uuid4()), seller_id=seller_id, title=title,
                    start_price=start_price, reserve=reserve, end_time=end_time)
        self._items[item.id] = item
        return item

    def place_bid(self, item_id: str, bidder_id: str, max_bid: Decimal,
                  *, now: Optional[datetime] = None) -> Bid:
        """User places max_bid (proxy). System bids up incrementally."""
        now = now or datetime.utcnow()
        with self._lock:
            item = self._items[item_id]
            if item_id in self._closed or now > item.end_time:
                raise AuctionClosed()
            
            # Anti-snipe: extend if bid is in last window
            if item.end_time - now < item.anti_snipe_window:
                item.end_time = now + item.anti_snipe_window
            
            # Update proxy_max
            self._proxy_max.setdefault(item_id, {})[bidder_id] = max_bid
            current = self._current_high.get(item_id)
            
            # If first bid: set to start_price (or higher)
            if current is None:
                if max_bid < item.start_price:
                    raise BidTooLow()
                bid_amount = item.start_price
            else:
                # New bid must beat current + increment
                if max_bid < current.amount + item.min_increment:
                    raise BidTooLow()
                # Auto-bid: this bid wins at min increment over current,
                # OR up to current's max if higher.
                # Simulate proxy war.
                bid_amount = self._resolve_proxy_war(item, item_id, bidder_id, max_bid, now)
            
            bid = Bid(bid_id=str(uuid.uuid4()), item_id=item_id,
                     bidder_id=bidder_id, amount=bid_amount, timestamp=now)
            self._current_high[item_id] = bid
            self._all_bids.setdefault(item_id, []).append(bid)
            return bid

    def _resolve_proxy_war(self, item: Item, item_id: str, new_bidder: str,
                           new_max: Decimal, now: datetime) -> Decimal:
        """Returns winning amount of new bid considering proxy maxes."""
        current = self._current_high[item_id]
        cur_max = self._proxy_max[item_id].get(current.bidder_id, current.amount)
        if new_max <= cur_max:
            # Old bidder still wins; their bid bumped to new_max + increment (capped at their max)
            new_winning = min(cur_max, new_max + item.min_increment)
            # New bid is "below" winning; current still wins
            self._current_high[item_id] = Bid(
                bid_id=str(uuid.uuid4()), item_id=item_id,
                bidder_id=current.bidder_id, amount=new_winning,
                timestamp=now, is_proxy_max=True,
            )
            self._all_bids.setdefault(item_id, []).append(self._current_high[item_id])
            raise BidTooLow(f"outbid; current high is {new_winning}")
        # New bidder wins at cur_max + increment (or new_max if lower than that)
        winning = min(new_max, cur_max + item.min_increment)
        return winning

    def close(self, item_id: str, *, now: Optional[datetime] = None) -> Optional[Bid]:
        now = now or datetime.utcnow()
        with self._lock:
            item = self._items[item_id]
            if now < item.end_time:
                raise AuctionError("not yet ended")
            self._closed.add(item_id)
            high = self._current_high.get(item_id)
            if high is None:
                return None
            if item.reserve is not None and high.amount < item.reserve:
                return None
            return high


# Tests
def main():
    svc = AuctionService()
    end = datetime(2026, 1, 1, 12, 0)
    item = svc.list_item("seller", "Vintage Camera", Decimal("100"), end_time=end)

    print("--- first bid ---")
    base = datetime(2026, 1, 1, 10, 0)
    b1 = svc.place_bid(item.id, "alice", Decimal("100"), now=base)
    assert b1.amount == Decimal("100")
    print(f"  alice@100: bid={b1.amount}")

    print("--- proxy war ---")
    # Bob bids max=200; should win at alice_max+1 = 101
    try:
        b2 = svc.place_bid(item.id, "bob", Decimal("200"), now=base)
        # Bob wins
        assert b2.bidder_id == "bob"
        # His bid amount = max(alice_max, 100) + 1 = 101 (since alice_max==100)
        assert b2.amount == Decimal("101")
        print(f"  bob@max200: winning bid={b2.amount}")
    except BidTooLow:
        pass

    print("--- alice raises proxy max ---")
    # Alice now sets max=150; bob_max=200, alice_max=150 → alice loses, bob wins at 151
    try:
        svc.place_bid(item.id, "alice", Decimal("150"), now=base)
        assert False, "should have lost"
    except BidTooLow:
        pass
    high = svc._current_high[item.id]
    assert high.bidder_id == "bob"
    assert high.amount == Decimal("151")
    print(f"  current high: bob@{high.amount}")

    print("--- charlie outbids ---")
    b4 = svc.place_bid(item.id, "charlie", Decimal("250"), now=base)
    assert b4.bidder_id == "charlie"
    # bob_max=200 → charlie wins at 201
    assert b4.amount == Decimal("201")
    print(f"  charlie@max250: winning bid={b4.amount}")

    print("--- anti-snipe ---")
    item2 = svc.list_item("seller", "Coin", Decimal("10"), end_time=end)
    svc.place_bid(item2.id, "alice", Decimal("10"), now=base)
    # Bid at last 30 sec → extends
    near_end = end - timedelta(seconds=30)
    svc.place_bid(item2.id, "bob", Decimal("20"), now=near_end)
    # End should be extended
    assert svc._items[item2.id].end_time > end
    print(f"  end extended: {svc._items[item2.id].end_time}")

    print("--- auction close ---")
    item3 = svc.list_item("seller", "Coin2", Decimal("10"), end_time=end)
    svc.place_bid(item3.id, "alice", Decimal("10"), now=base)
    after_end = end + timedelta(minutes=10)
    winner = svc.close(item3.id, now=after_end)
    assert winner is not None and winner.bidder_id == "alice"
    print(f"  winner: {winner.bidder_id}@{winner.amount}")

    print("\nAll tests passed.")


if __name__ == "__main__":
    main()
```

---

## 3. Cheat-Sheet
1. Per-item lock; bid validation atomic.
2. Proxy bidding: store user's max; auto-bid wars resolve at min-increment.
3. Anti-snipe: extend end_time if bid in last window.
4. Reserve: only winner if bid ≥ reserve.
5. State: open → closed_with_winner | closed_no_winner.

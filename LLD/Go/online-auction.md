# Online Auction — LLD (Go)

> **Difficulty:** Medium → Hard
> **Tags:** `[lld]` `[bidding]` `[concurrency]`
> **Language:** Go 1.21+

---

## Beginner's Guide

### What's this in plain English?

eBay-style auction. Item with start price, end time, reserve price. Bidders bid; highest at end wins. Anti-snipe: extend end time if a bid arrives at the last second.

### Why solve it?

- **Real world**: eBay, art, government contracts, ad bidding.
- **Teaches**: time-based state, atomic bid comparison, concurrency near end-of-auction.

### Vocabulary

- **Reserve / Increment** — min winning price / min bid step.
- **Anti-snipe** — extend end time on late bids.
- **State** — DRAFT → OPEN → CLOSED.

### High-level approach

Entities: **Auction** (state, current bid, end time), **Bid**, **AuctionService** with `sync.Mutex`.

Bid validation under lock:
1. State == OPEN, now < end.
2. amount > current_bid + increment.
3. Update current_bid + winner.
4. If close to end → extend end_time.

### How to read this doc

- **Beginner**: bid validation steps.
- **Interview**: anti-snipe, payment, edge cases.

---

## 1. Code

```go
package main

import (
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

type Cents int64

var (
	ErrBidTooLow      = errors.New("bid too low")
	ErrAuctionClosed  = errors.New("auction closed")
	ErrAuctionNotEnded = errors.New("not yet ended")
)

type Item struct {
	ID, SellerID, Title string
	StartPrice          Cents
	Reserve             Cents
	EndTime             time.Time
	MinIncrement        Cents
	AntiSnipe           time.Duration
}

type Bid struct {
	ID        string
	ItemID    string
	BidderID  string
	Amount    Cents
	Timestamp time.Time
}

type AuctionService struct {
	mu          sync.Mutex
	items       map[string]*Item
	currentHigh map[string]*Bid
	proxyMax    map[string]map[string]Cents
	closed      map[string]bool
	idCounter   atomic.Int64
}

func NewAuctionService() *AuctionService {
	return &AuctionService{
		items:       map[string]*Item{},
		currentHigh: map[string]*Bid{},
		proxyMax:    map[string]map[string]Cents{},
		closed:      map[string]bool{},
	}
}

func (s *AuctionService) nextID(p string) string {
	return fmt.Sprintf("%s-%d", p, s.idCounter.Add(1))
}

func (s *AuctionService) ListItem(sellerID, title string, startPrice, reserve Cents, endTime time.Time) *Item {
	item := &Item{
		ID: s.nextID("item"), SellerID: sellerID, Title: title,
		StartPrice: startPrice, Reserve: reserve, EndTime: endTime,
		MinIncrement: 100, // 1.00 cents
		AntiSnipe:    2 * time.Minute,
	}
	s.items[item.ID] = item
	return item
}

func (s *AuctionService) PlaceBid(itemID, bidderID string, maxBid Cents, now time.Time) (*Bid, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.items[itemID]
	if !ok {
		return nil, ErrAuctionClosed
	}
	if s.closed[itemID] || now.After(item.EndTime) {
		return nil, ErrAuctionClosed
	}
	// Anti-snipe
	if item.EndTime.Sub(now) < item.AntiSnipe {
		item.EndTime = now.Add(item.AntiSnipe)
	}

	if s.proxyMax[itemID] == nil {
		s.proxyMax[itemID] = map[string]Cents{}
	}
	s.proxyMax[itemID][bidderID] = maxBid

	current := s.currentHigh[itemID]
	if current == nil {
		if maxBid < item.StartPrice {
			return nil, ErrBidTooLow
		}
		bid := &Bid{
			ID: s.nextID("bid"), ItemID: itemID, BidderID: bidderID,
			Amount: item.StartPrice, Timestamp: now,
		}
		s.currentHigh[itemID] = bid
		return bid, nil
	}

	if maxBid < current.Amount+item.MinIncrement {
		return nil, ErrBidTooLow
	}

	curMax := s.proxyMax[itemID][current.BidderID]
	if maxBid <= curMax {
		// New bid loses; current's bid bumped
		newWinning := curMax
		if maxBid+item.MinIncrement < newWinning {
			newWinning = maxBid + item.MinIncrement
		}
		s.currentHigh[itemID] = &Bid{
			ID: s.nextID("bid"), ItemID: itemID, BidderID: current.BidderID,
			Amount: newWinning, Timestamp: now,
		}
		return nil, ErrBidTooLow
	}
	// New bidder wins at curMax + increment (or maxBid if lower)
	winning := curMax + item.MinIncrement
	if maxBid < winning {
		winning = maxBid
	}
	bid := &Bid{
		ID: s.nextID("bid"), ItemID: itemID, BidderID: bidderID,
		Amount: winning, Timestamp: now,
	}
	s.currentHigh[itemID] = bid
	return bid, nil
}

func (s *AuctionService) Close(itemID string, now time.Time) (*Bid, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	item := s.items[itemID]
	if now.Before(item.EndTime) {
		return nil, ErrAuctionNotEnded
	}
	s.closed[itemID] = true
	high := s.currentHigh[itemID]
	if high == nil {
		return nil, nil
	}
	if item.Reserve > 0 && high.Amount < item.Reserve {
		return nil, nil
	}
	return high, nil
}

func main() {
	svc := NewAuctionService()
	end := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	item := svc.ListItem("seller", "Camera", 10000, 0, end)
	base := time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC)

	b1, _ := svc.PlaceBid(item.ID, "alice", 10000, base)
	if b1.Amount != 10000 {
		panic(b1.Amount)
	}
	b2, _ := svc.PlaceBid(item.ID, "bob", 20000, base)
	if b2 == nil || b2.Amount != 10100 {
		panic("bob should win at 10100")
	}
	// Close
	winner, _ := svc.Close(item.ID, end.Add(time.Hour))
	if winner == nil || winner.BidderID != "bob" {
		panic("winner")
	}
	fmt.Printf("Winner: %s @ %d\n", winner.BidderID, winner.Amount)
	fmt.Println("All tests passed.")
}
```

---

## 2. Cheat-Sheet
1. Per-item lock; verify-and-bid atomic.
2. Proxy bidding via per-user max table.
3. Anti-snipe: extend end on late bid.
4. Reserve: only declare winner if amount ≥ reserve.

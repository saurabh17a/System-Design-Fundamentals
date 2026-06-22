# Robinhood (Stock Trading) — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[order-matching]` `[market-data]` `[low-latency]` `[regulatory]`
> **Companies that ask this:** Robinhood, Schwab, Fidelity, Coinbase, Binance

---

## Beginner's Guide

### What's this in plain English?

A stock trading app. You see live prices ("AAPL: $193.21"). You tap "Buy" → enter amount → confirm. Order goes to the exchange; once filled, your account shows the new shares. Plus charts, news, watchlists. Unlike a chat app, **wrong is illegal** — you can't double-fill an order, can't lose money in flight.

### Why solve it?

- **Real world**: Robinhood, Schwab, Fidelity, Coinbase, Binance.
- **Teaches**: order matching (or routing), market data fan-out, low-latency, regulatory + idempotency.

### Vocabulary

- **Order** — buy/sell intent: market, limit, stop.
- **Order book** — list of pending buy/sell orders by price.
- **Market data** — stream of bid/ask quotes and trades.
- **Match** — when a buy crosses a sell at compatible prices.
- **Position** — what shares you own.
- **Margin** — borrowed money for trading.

### High-level architecture

```
Market data feed → Distribution → Watchlists, Charts (millions of subscribers)
                          ↓
        User → Place Order → Order Service (idempotent) → Exchange / MM
                          ↓
                  Fill confirmation → Account / Position update
```

Robinhood specifically routes orders to market makers (Citadel, Virtu) rather than running its own matching engine. So it's:
1. **Market data** (read-heavy, fan-out).
2. **Order placement** (idempotency, validation).
3. **Order routing** (to MM/exchange).
4. **Position bookkeeping** (after fills).
5. **Compliance** (KYC, anti-money-laundering).

### How to read this doc

- **Beginner**: focus on the order placement + fill bookkeeping.
- **Interview**: cross-questions on idempotency, compliance, market data fan-out.

---

## 0. How to use this doc in an interview

Trading systems test **order matching, market data feed, low-latency**. Robinhood specifically also has retail-broker concerns: they don't run their own exchange; they route to market makers/exchanges. Cover both: the broker side (orders, accounts, positions) and the implications of routing.

---

## 1. Problem Statement

A retail broker:
- Users place orders (market, limit, stop).
- System validates (have funds? have shares?).
- Routes to market venues for execution.
- Tracks fills, positions, P&L.
- Live market data display (price ticks).
- Account statements, regulatory reports.

---

## 2. Clarifying Questions

- [ ] Stocks only or also crypto, options, futures?
- [ ] We run an exchange or just route?
- [ ] Real-time market data?
- [ ] Margin trading?
- [ ] Tax reporting?

> **Assume:** stocks + ETFs; we're a broker (route to venues); real-time market data; margin yes; tax reporting yes.

---

## 3. Functional Requirements

**P0:**
1. Order entry (market, limit, stop).
2. Order validation (buying power, shares).
3. Route to execution venue.
4. Position + balance tracking.
5. Real-time market data feed.
6. Trade history.

**P1:**
7. Margin loans.
8. Options trading.
9. Tax forms.

**P2:**
10. Crypto.
11. Recurring investments.

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.99% during market hours |
| Order entry P99 | < 100 ms |
| Market data latency | < 100 ms feed → user |
| Audit | All orders / fills logged immutably |
| Regulatory | SEC / FINRA reports daily |

---

## 5. Capacity Estimation

```
Users: 25M
DAU during market: 5M
Orders / day: 10M peak (4 trading hours = 700/sec; 5x peak at open = 3.5k/sec)
Market data: 10k+ updates/sec on hot stocks; 1M total ticks/sec across all symbols
Positions: 25M users × 10 holdings = 250M
```

---

## 6. API

```
POST /v1/orders            body: {symbol, qty, type, side, limit?}  -> order_id
GET  /v1/orders/{id}                                                 -> status
GET  /v1/positions
GET  /v1/quotes/{symbol}                                             -> last price
WS   /v1/market-data       subscribe: symbols                        push ticks
```

---

## 7. Data Model

### Accounts (Postgres, ACID)
- `accounts(id, user_id, cash, buying_power, margin_factor)`
- `positions(account_id, symbol, qty, avg_cost)`

### Orders (Cassandra + Postgres)
- `orders(id, account_id, symbol, side, qty, type, status, ts)` — append-only log.
- Postgres for current open orders (fast lookup).

### Trades / fills (Cassandra)
- `(account_id, ts, fill_id, symbol, side, qty, price)`

### Market data (in-memory + time-series)
- Hot: Redis with current price per symbol.
- Cold: Cassandra/InfluxDB time-series.

---

## 8. Architecture

```
              ┌──────────────────────┐
              │  Mobile / Web        │
              └──────────┬───────────┘
                         │
                ┌────────▼────────┐
                │  Order Entry    │
                │  - validate     │
                │  - persist      │
                │  - route        │
                └────────┬────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
  ┌──────────┐    ┌──────────────┐  ┌──────────────┐
  │ Account  │    │ Order Router │  │ Risk Svc     │
  │ Svc      │    │ (to venues)  │  │ (margin chk) │
  └──────────┘    └──────────────┘  └──────────────┘
                         │
                         ▼
                ┌──────────────────┐
                │ Market Venues    │ NYSE, NASDAQ, market makers
                │ (FIX protocol)   │
                └────────┬─────────┘
                         │ fills back
                         ▼
                ┌──────────────────┐
                │ Trade Reporter   │
                │ - update pos     │
                │ - reconcile      │
                └──────────────────┘

              ┌──────────────────────┐
              │  Market Data Feed    │ from data vendor (Polygon, NYSE, etc.)
              │  → Kafka            │
              └──────────┬───────────┘
                         │
                ┌────────▼─────────┐
                │  Quote Service   │
                │  - latest price  │
                │  - WS push       │
                └──────────────────┘
```

---

## 9. Component Deep-Dives

### 9.1 Order entry
- Validate: balance / margin / shares.
- Persist to immutable log (Cassandra).
- Optimistically update `buying_power` (Reserve fund for the order).
- Route to venue.

### 9.2 Risk / margin check
- Calculate buying power.
- Reject if order exceeds.
- Margin: enforce maintenance margin requirement.

### 9.3 Order routing
- Select venue (best-execution algorithm).
- Send via FIX protocol.
- Receive fills async.

### 9.4 Trade reporting
- Each fill: update position, cash, P&L.
- Reconcile against venue's confirmation.
- Audit log.

### 9.5 Market data
- Vendor feed (Polygon, NYSE) → Kafka.
- Stream processor extracts last price.
- Redis hot cache.
- WS push to subscribed users.

---

## 10. Hard Sub-Problems

### 10.1 Order amount / position consistency
- Order placed → reserve buying power.
- Fill → adjust position + cash.
- Cancel → release reserve.
- All under transaction (Postgres).

### 10.2 Concurrency: two orders on same account
- Per-account lock during validation.
- Pessimistic (DB row lock) or optimistic (CAS).

### 10.3 Market data fan-out
- 1M ticks/sec; 5M users.
- User typically watches ~5 symbols.
- Per-symbol WS topic; users subscribe to topics they care about.

### 10.4 Settlement (T+1 / T+2)
- Trades settle 1-2 business days later.
- Track unsettled cash separately from settled.

### 10.5 Volatile market spikes
- Spike orders 5x normal → degrade gracefully.
- Pre-compute buying power; cache user state.

---

## 11. Cross-Questions ≥ 12

### 11.1 Why route to venues vs run own matching engine?
- Robinhood is a broker, not an exchange.
- Routing leverages existing liquidity.
- Running own ME is ~$100M+ regulatory + infra.

### 11.2 Why Postgres for accounts?
- ACID required for cash balance accuracy.
- Compliance / audit.
- Cassandra/NoSQL doesn't fit financial integrity needs.

### 11.3 Why Cassandra for orders/fills log?
- High write rate.
- Append-only.
- Time-partitioned scan for daily reports.

### 11.4 How is buying power computed?
- Cash + margin allowed - open orders' reserves.
- Updated on every order / fill.

### 11.5 What about flash sales (e.g. GameStop)?
- Volatility halts: venue may halt trading.
- Pre-trade risk checks reject excessive exposure.
- User notifications.

### 11.6 What's PFOF (payment for order flow)?
- Brokers route to market makers; receive rebates.
- Best-execution duty: must justify routing.
- Disclosed.

### 11.7 How is market data fanned out?
- Per-symbol WS topic; backed by Redis pub/sub or Kafka.
- User WS subscribes only to symbols watched.
- 5M users × 5 symbols = 25M subscriptions; sharded across many connection servers.

### 11.8 What about T+1 settlement?
- Trade today, settle tomorrow.
- Until settlement: cash is "unsettled", can't be withdrawn but can be reused for trades.

### 11.9 What about regulatory reporting?
- Daily: trade reports (FINRA OATS).
- Quarterly: 13F filings.
- Annual: tax documents.
- Pipeline: query Cassandra → batch → submit.

### 11.10 How are options different?
- Leg = combination of options.
- Margin requirements complex.
- Same routing pattern but with options-specific risk.

### 11.11 What about crypto?
- Real-time matching engine internal (no external venue).
- Or route to crypto exchange (Coinbase API).
- 24/7 trading.

### 11.12 What if a fill conflicts with our internal state?
- Reconciliation job runs nightly.
- Discrepancies escalated.
- Automated correction or human review.

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| Route to venues | Low cost, regulatory simpler | PFOF disclosure |
| Postgres for accounts | ACID | Sharding harder |
| Pre-reserve buying power | Prevent over-orders | Slight UX (reserved before fill) |
| WS push for market data | Real-time | Connection scale |

---

## 13. Cheat-Sheet

1. **Order entry → validate → route to venue.**
2. **Postgres** for account ACID.
3. **Cassandra** for orders/fills log (audit).
4. **Market data**: vendor feed → Kafka → Redis → WS.
5. **Per-account lock** during validation.
6. **Compliance pipeline** for daily reports.
7. **Settlement** tracked T+1 separately.

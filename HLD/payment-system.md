# Payment System (Stripe-like) — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[transactions]` `[idempotency]` `[double-entry-ledger]` `[reliability]`
> **Companies that ask this:** Stripe, PayPal, Square, Visa/Mastercard, Razorpay, Adyen

---

## Beginner's Guide

### What's this in plain English?

Stripe. A merchant calls "charge $10 to this card." Stripe sends to the card networks (Visa/Mastercard), gets back yes or no, pays the merchant minus fees. Plus: refunds, disputes, multi-currency, payouts. Money is involved — so **wrong is illegal**. Idempotency, double-entry accounting, audit logs.

### Why solve it?

- **Real world**: Stripe, PayPal, Square, Razorpay, Adyen.
- **Teaches**: financial correctness, idempotency, double-entry ledger, audit, retries, regulatory compliance.

### Vocabulary

- **Charge** — debit a customer's card.
- **Refund** — credit it back.
- **Dispute / Chargeback** — customer disputes; bank reverses.
- **Idempotency key** — client provides; same key = same action; deduplicate retries.
- **Double-entry ledger** — every txn is two entries: debit one account, credit another. Sum is always zero.

### High-level architecture

```
Merchant → API (idempotency check) → Payment Service → Card networks (Visa/MC)
                                          ↓
                                   Ledger (double-entry, append-only)
                                          ↓
                                   Reporting / payouts
```

Components:
1. **Idempotency** — at the API; same key returns same result.
2. **Payment service** — talks to card networks; retries with backoff.
3. **Ledger** — append-only; every charge = debit customer, credit merchant (minus fee). Audit log.
4. **Async workers** — refunds, disputes, payouts, reconciliation.

The ledger never updates rows in place. New events only. Closing balance computed by summing.

### How to read this doc

- **Beginner**: focus on idempotency + ledger.
- **Interview**: cross-questions on retries, partial failures, multi-currency, reconciliation with banks.

---

## 0. How to use this doc in an interview

Payment systems test **money-correct system design**. Tests:
1. **Idempotency** (everywhere; retries are inevitable).
2. **Double-entry ledger** (every cent has two sides).
3. **Distributed transactions** without 2PC (saga pattern).
4. **Compliance, audit, reconciliation.**
5. **Authorization vs capture vs settle** (industry vocabulary).

Trap: "use a database" — too generic. Show you understand financial-system invariants.

---

## 1. Problem Statement

A payment processor:
- Merchants integrate via API.
- Customer pays merchant.
- System: charge card / bank → settle to merchant.
- Refunds, chargebacks.
- Reporting + reconciliation.

---

## 2. Clarifying Questions

- [ ] Cards only or also bank transfers, wallets?
- [ ] Direct merchant integration or marketplace (Stripe Connect)?
- [ ] Multi-currency?
- [ ] Refund policy?
- [ ] Subscription billing?

> **Assume:** cards + bank + wallets; direct + marketplace; multi-currency; full refund support; subscriptions.

---

## 3. Functional Requirements

**P0:**
1. Charge: create payment intent → confirm → charge card.
2. Idempotent (every API call has Idempotency-Key).
3. Refund (full or partial).
4. Chargeback handling.
5. Daily settlement to merchant bank.
6. Webhook to merchant on event.
7. Audit log: every state change.

**P1:**
8. Subscriptions (recurring).
9. Multi-currency conversion.
10. Marketplace (split payment between platform + sub-merchants).

**P2:**
11. Crypto.
12. ACH / bank transfers.
13. Buy-now-pay-later.

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.999% (every minute lost = dollars lost) |
| Authorize latency | < 500 ms |
| Idempotency | 100% — no double charges |
| Audit | Every state change logged immutably |
| Compliance | PCI-DSS Level 1, SOC 2, regulatory |

---

## 5. Capacity Estimation

```
Transactions/sec: 10k peak
Authorization rate: 95% (5% decline)
Failover latency tolerance: < 30 s
Daily volume: $1B+ for top providers
```

---

## 6. API

```
POST /v1/payment_intents     body: {amount, currency, customer}, header: Idempotency-Key
POST /v1/payment_intents/{id}/confirm  body: {payment_method}
POST /v1/refunds             body: {payment_intent_id, amount}
GET  /v1/charges/{id}
```

Webhook events:
```
charge.succeeded, charge.failed, refund.succeeded, dispute.created
```

---

## 7. Data Model

### Ledger (double-entry, source of truth)
- Append-only.
- Each transaction = ≥2 entries that sum to zero.
- E.g. customer charged $100:
  - +$100 to merchant_pending
  - -$100 to customer_card
- Each entry: `(account_id, amount, currency, ts, idempotency_key, transaction_id)`.

### Accounts
- `accounts(id, type, owner_id, currency, balance)`
- Types: customer, merchant, platform, fee, reserve, etc.

### Idempotency keys (Redis + DB)
- `(merchant_id, idempotency_key)` → response.
- TTL 24h.

### Webhooks
- Outbound queue per merchant.

---

## 8. Architecture

```
              ┌──────────────────────┐
              │   Merchant App       │
              └──────────┬───────────┘
                         │ API
                         ▼
                ┌────────────────────┐
                │   API Gateway       │
                │   - auth            │
                │   - idempotency     │
                └────────┬────────────┘
                         │
                ┌────────▼────────┐
                │ Payment Svc     │
                │ - validate      │
                │ - create intent │
                └────────┬────────┘
                         │
                ┌────────▼────────────┐
                │  Ledger (Postgres)  │
                │  double-entry write │
                └────────┬────────────┘
                         │
                ┌────────▼────────────┐
                │ Card Network        │
                │ Connector (Visa,    │
                │ Stripe Connect)     │
                └────────┬────────────┘
                         │
                  authorization result
                         │
                         ▼
                ┌─────────────────────┐
                │ State Machine Engine│
                │ - update ledger     │
                │ - emit webhook      │
                └─────────────────────┘

                ┌─────────────────────┐
                │ Reconciliation Svc  │  daily; vs network statements
                └─────────────────────┘

                ┌─────────────────────┐
                │ Webhook Sender      │  retries with exp backoff
                └─────────────────────┘
```

---

## 9. Component Deep-Dives

### 9.1 Idempotency
- Every write API requires `Idempotency-Key`.
- Server stores `(key, response)` for 24h.
- Retry returns cached response.
- Critical: never charge twice on retry.

### 9.2 Double-entry ledger
- Every money movement = 2 entries.
- Sum across all entries for any time = 0.
- Append-only (no updates).
- Reconciliation: Σ(entries per account) = current balance.

### 9.3 Payment intent state machine
States: `requires_payment_method → processing → succeeded | failed | canceled`.

### 9.4 Card network integration
- Send authorize request via card network API.
- Wait for response (sub-second typical).
- On success: capture (immediate or delayed).
- On failure: surface decline reason.

### 9.5 Webhook delivery
- Async: write to outbound queue.
- Worker delivers; retries on failure with exponential backoff.
- Merchant must respond 200 within 30s; else retry.

### 9.6 Reconciliation
- Daily: pull statements from card networks.
- Compare against ledger.
- Discrepancies → ops team review.
- Adjustment entries to fix.

---

## 10. Hard Sub-Problems

### 10.1 Distributed transactions without 2PC
- Pattern: Saga.
- Step 1: charge customer (success).
- Step 2: credit merchant (success).
- If step 2 fails: compensating transaction (refund customer).

### 10.2 Idempotent retries across components
- Idempotency key threaded through every internal call.
- Each component dedups on key + operation type.

### 10.3 Currency conversion
- FX rate snapshot at transaction time.
- Stored alongside the transaction.
- Reconciliation accounts for FX gain/loss.

### 10.4 Chargebacks (disputes)
- Customer disputes charge → bank reverses.
- Merchant has window to respond.
- Funds held in reserve until resolved.

### 10.5 Subscription billing
- Schedule daily; charge cycle.
- Retry on temporary failure.
- Cancel on prolonged failure.
- Invoicing.

---

## 11. Cross-Questions ≥ 12

### 11.1 Why double-entry ledger?
- Industry standard since 13th century.
- Sum-to-zero invariant catches bugs.
- Audit trail.

### 11.2 Why not 2PC?
- 2PC blocks if coordinator dies.
- Saga allows independent failures with compensation.
- More resilient at scale.

### 11.3 What if same Idempotency-Key with different request body?
- Reject with 422 (key reuse with different payload).
- Common middleware bug; protect against it.

### 11.4 How is the ledger sharded?
- By account_id.
- Account → its transactions on one shard.

### 11.5 What about consistency on cross-account writes?
- Both entries (merchant credit + customer debit) in same Postgres transaction.
- If accounts on different shards: distributed transaction (rare; design accounts on same shard for hot pairs).

### 11.6 What about authorize vs capture?
- Authorize: hold funds (not yet charged).
- Capture: actually move funds.
- Useful for hotels, rentals.

### 11.7 How is fraud detected?
- ML signals: device, IP, amount, history.
- Risk score → block / challenge (3DS) / approve.
- Rules engine layered on top.

### 11.8 How is PCI compliance handled?
- Never store raw card numbers.
- Tokenize at gateway; store token.
- Transmit only via PCI-DSS-compliant systems.

### 11.9 What about multi-currency?
- FX done at network or our wallet.
- Snapshot rate; report gain/loss.

### 11.10 What's settlement vs capture?
- Capture: move funds from card to processor.
- Settlement: processor pays merchant (T+1 or T+2).

### 11.11 How are merchants paid out?
- Daily / weekly batch.
- Calculated: gross volume - refunds - fees - reserves.
- Wire transfer or ACH.

### 11.12 What's the failure mode if card network is down?
- Retry with backoff.
- Queue requests; don't lose them.
- Communicate to merchant; user sees "try again."

### 11.13 What about cross-region?
- Per-region payment processing (regulatory + latency).
- Cross-region reconciliation in offline batch.

### 11.14 How are refunds idempotent?
- Each refund has its own Idempotency-Key.
- Refund > charge amount: rejected.
- Cumulative refunds tracked.

### 11.15 What's the failure mode if ledger write fails after card charge?
- Big problem: customer charged, ledger doesn't reflect.
- Mitigation: ledger write happens first (in pending state); card charge confirms.
- If card charge fails: cancel pending entry.
- If ledger pending forever: reconciliation catches it.

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| Saga over 2PC | Resilient | Compensation logic complexity |
| Append-only ledger | Audit, simplicity | Storage growth |
| Idempotency required | Retry-safe | API verbosity |
| Webhook async | Decouple from merchant | Eventual consistency |

---

## 13. Cheat-Sheet

1. **Idempotency-Key on every write** (24h cache).
2. **Double-entry ledger** as source of truth.
3. **Saga** for cross-account flows.
4. **Webhook** for merchant async notification.
5. **Reconciliation** daily vs card network.
6. **Tokenize** cards (never store PAN).
7. **Authorize → Capture → Settle** vocabulary.

# Notification System — High-Level Design

> **Difficulty:** Medium → Hard
> **Tags:** `[hld]` `[multi-channel]` `[fan-out]` `[idempotency]` `[retry]`
> **Companies that ask this:** Twilio, SendGrid, OneSignal, every customer-facing product

---

## Beginner's Guide

### What's this in plain English?

You order on Amazon. You get an email confirmation. A text when it ships. A push notification when it arrives. All from "the system." This is a **notification system** — a service many parts of a company hit when they want to tell users something, across email/SMS/push/in-app/webhook.

### Why solve it?

- **Real world**: Twilio, SendGrid, OneSignal, AWS SNS, internal Notification Services.
- **Teaches**: multi-channel delivery, reliability/retries, idempotency, scheduling, throttling.

### Vocabulary

- **Channel** — delivery mechanism: email, SMS, push, in-app, webhook.
- **Provider** — vendor for that channel: SendGrid (email), Twilio (SMS), APNs (iOS push), FCM (Android).
- **Template** — pre-written message with variables.
- **Idempotency key** — prevent duplicate sends if a service retries.
- **Throttling** — don't spam; per-user quotas.

### High-level architecture

```
Service A ───┐
Service B ───┼→ Notification API → Queue → Worker pool → Channel adapters → Providers
Service C ───┘                       ↓
                                 Storage (sent log, idempotency)
```

Components:
1. **API** — accepts notification requests with template + recipient.
2. **Queue** (Kafka) — durable, retry-able.
3. **Workers** — pull from queue, render template, route to channel.
4. **Channel adapters** — email/SMS/push integrations.
5. **Idempotency** — key per request; reject duplicates.
6. **Preferences** — per-user opt-outs, channel choice.

Failures: retry with backoff. Track delivery status (delivered, bounced, opened).

### How to read this doc

- **Beginner**: focus on the queue + worker model.
- **Interview**: cross-questions on idempotency, throttling, user prefs, dead-letter queues.

---

## 0. How to use this doc in an interview

Tests **multi-channel delivery, idempotency, retries, scheduling**. Trap: assuming one channel; real systems handle email, SMS, push, in-app, webhook.

---

## 1. Problem Statement

Send notifications to users via multiple channels:
- Triggers: events from internal services.
- Channels: email, SMS, push, in-app, webhook.
- Per-user preferences (which channels, quiet hours).
- Deliverability tracking; retries.
- Templating.

---

## 2. Clarifying Questions

- [ ] Channels (email, SMS, push)?
- [ ] Bulk vs transactional?
- [ ] Templating?
- [ ] User preferences?
- [ ] Delivery tracking?

> **Assume:** all 4 + webhook; bulk + transactional; templating; full prefs; delivery tracking.

---

## 3. Functional Requirements

**P0:**
1. Send to user via channel.
2. Multi-channel (try push first, then email).
3. Templates.
4. User preferences (channels, quiet hours).
5. Idempotent.
6. Retry on transient failure.
7. Track delivery status.

**P1:**
8. Bulk campaigns (1M users).
9. A/B testing of variants.
10. Throttling per-user (don't spam).

**P2:**
11. Personalization at template-render time.
12. Cross-channel reconciliation (don't email + push for same alert).

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.99% |
| Throughput | 1M notifications/sec peak (bulk) |
| Transactional latency | < 5 s push, < 30 s email |
| Idempotency | Yes |
| Delivery tracking | 99% accuracy |

---

## 5. Capacity Estimation

```
Notifications/day: 1B
Per-channel split: 60% push, 30% email, 5% SMS, 5% in-app
Bulk peaks: 100M in 1 hour for major events
Fan-out: average 1 notification = 1.5 channel attempts (multi-channel)
```

---

## 6. API

```
POST /v1/notifications  body: {user_id, template, vars, channels?}
                         header: Idempotency-Key
                         -> notification_id
GET  /v1/notifications/{id}                                       -> status, delivery
POST /v1/campaigns      body: {audience, template, schedule}
GET  /v1/users/me/preferences
```

---

## 7. Data Model

### Notifications (Cassandra)
- `(user_id, ts, notif_id, template, status, channels[])`

### Templates (Postgres)
- `(template_id, name, subject, body, variables, channel_variants)`

### User preferences (Postgres or Redis)
- `(user_id, channel_prefs, quiet_hours, throttle_settings)`

### Delivery logs (Cassandra append-only)
- `(notif_id, channel, attempt, status, provider_response, ts)`

---

## 8. Architecture

```
              ┌───────────────────┐
              │  Internal Services │ (event triggers)
              └─────────┬─────────┘
                        │
                ┌───────▼──────────┐
                │  Notif API       │
                │  - validate      │
                │  - persist       │
                │  - enqueue       │
                └───────┬──────────┘
                        │
                ┌───────▼──────────┐
                │  Kafka            │
                │  topic: notifs    │
                └───────┬──────────┘
                        │
                ┌───────▼──────────┐
                │ Routing Service   │
                │ - apply prefs     │
                │ - apply throttle  │
                │ - choose channels │
                │ - render template │
                └───────┬──────────┘
                        │
        ┌───────────────┼─────────────┬───────────┐
        ▼               ▼             ▼           ▼
   ┌─────────┐    ┌─────────┐  ┌─────────┐  ┌──────────┐
   │ Email   │    │ SMS     │  │ Push    │  │ Webhook  │
   │ Worker  │    │ Worker  │  │ Worker  │  │ Worker   │
   └────┬────┘    └────┬────┘  └────┬────┘  └─────┬────┘
        │              │             │             │
        ▼              ▼             ▼             ▼
   ┌─────────┐    ┌─────────┐  ┌─────────┐  ┌──────────┐
   │SendGrid │    │ Twilio  │  │ APNs    │  │ HTTP     │
   │         │    │         │  │ FCM     │  │ POST     │
   └─────────┘    └─────────┘  └─────────┘  └──────────┘
```

---

## 9. Component Deep-Dives

### 9.1 Notif API
- Idempotency: `Idempotency-Key` header → cached response 24h.
- Validate user exists + template.
- Persist; enqueue.

### 9.2 Routing
- Look up user prefs.
- Filter quiet hours.
- Choose channel(s) per fallback rules.
- Render template per channel.

### 9.3 Per-channel workers
- Each channel has its own queue + workers.
- Email: bulk-friendly; batches.
- SMS: per-message API call; rate-limited by provider.
- Push: APNs / FCM; rate-limited per app.
- Webhook: HTTP POST; user-configured endpoints.

### 9.4 Retry
- Per-attempt: try → if transient fail → backoff retry.
- Max attempts (e.g. 3 for email, 1 for SMS).
- Dead-letter on permanent failure.

### 9.5 Delivery tracking
- Provider sends webhook back: delivered, bounced, opened, clicked.
- Update DB.

---

## 10. Hard Sub-Problems

### 10.1 Bulk campaigns at scale
- 100M emails in 1 hour = 28k/sec.
- Pre-render templates if possible.
- Batched API calls to email provider.

### 10.2 Per-user throttling
- Don't send 50 push in 1 hour.
- Per-user counter in Redis; reject if exceeded.

### 10.3 Multi-channel coordination
- "Send push; if not opened in 5 min, fall back to email."
- State machine per notification.

### 10.4 Provider failover
- Email: primary SendGrid, fallback Mailgun.
- Auto-switch on outage.
- Reconcile delivery logs.

---

## 11. Cross-Questions ≥ 12

### 11.1 Why per-channel queues?
- Different rate limits per provider.
- Different worker characteristics.
- Independent scaling.

### 11.2 How is multi-channel fallback done?
- State machine: try push → wait → if not delivered → email.
- Time-based or event-based trigger.

### 11.3 How are user preferences applied?
- At routing time: filter channels not enabled.
- Quiet hours: defer to next non-quiet window or skip.

### 11.4 What about transactional vs marketing?
- Transactional: immediate, all channels per priority.
- Marketing: opt-in only; subject to throttling.

### 11.5 How are templates rendered?
- Mustache / Handlebars-like.
- Variables substituted at render time.
- Per-channel variant (same content, different format).

### 11.6 How is idempotency enforced?
- Idempotency-Key header → 24h Redis cache.
- Same key + same payload = same result.

### 11.7 What's the failure mode under provider outage?
- Failover to backup provider.
- Or: queue grows; send when restored.
- Alert on backlog > threshold.

### 11.8 How is delivery tracked?
- Provider webhook → our delivery log.
- Bounce / open / click events.
- Updates Cassandra `delivery_logs` table.

### 11.9 How are quiet hours enforced?
- User-set time range in their prefs.
- Routing service checks; defers to next valid window.

### 11.10 How is unsubscribe handled?
- Per-channel unsubscribe link.
- Honored across all marketing.
- Compliance (CAN-SPAM, GDPR).

### 11.11 How is multi-region done?
- Per-region notif system.
- Provider regional endpoints.
- Cross-region replication for prefs.

### 11.12 What about real-time push for important alerts?
- Skip queue; direct API call.
- Used for security alerts (login from new device).

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| Per-channel queue | Independent scaling | Operational |
| Multi-channel fallback | Better delivery | Complex state |
| Provider redundancy | Resilience | Cost (2 providers) |
| Async delivery tracking | Decoupled | Eventual consistency |

---

## 13. Cheat-Sheet

1. **API → Kafka → Routing → Channel workers.**
2. **Per-channel queue** for independent scaling.
3. **Idempotency-Key** header; 24h cache.
4. **User prefs + quiet hours** at routing.
5. **Multi-channel fallback** state machine.
6. **Delivery tracking** via provider webhooks.
7. **Provider redundancy** for resilience.

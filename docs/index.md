# Knowledge Base Index

> **New here?** Start with [`README.md`](README.md). Pick a learning path. Then come here when you want to find a specific topic.

This index is organized by **tier** — start with whatever matches your level.

Last updated: 2026-05-18.

---

## Tier 1 — Foundations (Beginners + Refreshers)

### Programming — Python (start here if new to coding)

| # | Doc | Topic |
|---|---|---|
| 01 | [Getting Started](Foundations/Programming/Python/01-getting-started.md) | Install, first program, REPL, variables |
| 02 | [Data Types](Foundations/Programming/Python/02-data-types.md) | int, float, str, bool, None, conversion |
| 03 | [Control Flow](Foundations/Programming/Python/03-control-flow.md) | if/elif, match, for/while, comprehensions |
| 04 | [Functions](Foundations/Programming/Python/04-functions.md) | def, args, type hints, scope, closures, lambda |
| 05 | [Collections](Foundations/Programming/Python/05-collections.md) | list, tuple, dict, set, defaultdict, Counter |
| 06 | [Classes](Foundations/Programming/Python/06-classes-and-objects.md) | OOP basics, dataclasses, inheritance, properties |
| 07 | [Errors](Foundations/Programming/Python/07-error-handling.md) | try/except, raising, custom exceptions, with |
| 08 | [Concurrency](Foundations/Programming/Python/08-concurrency.md) | threads, GIL, asyncio, multiprocessing |
| 09 | [Modules & Testing](Foundations/Programming/Python/09-modules-and-testing.md) | imports, packages, pip, venv, pytest |
| 10 | [File I/O, JSON, HTTP](Foundations/Programming/Python/10-file-io-json-http.md) | open/with, pathlib, json, requests, Flask |
| 11 | [Standard Library Tour](Foundations/Programming/Python/11-stdlib-tour.md) | datetime, os, re, collections, itertools, functools |
| 12 | [Generics, Typing, Iterators](Foundations/Programming/Python/12-generics-typing-iterators.md) | TypeVar, Generic, Protocol, generators, yield |

### Programming — Go (great second language, or start here if you prefer)

| # | Doc | Topic |
|---|---|---|
| 01 | [Getting Started](Foundations/Programming/Go/01-getting-started.md) | Install, package main, fmt, project layout |
| 02 | [Types & Variables](Foundations/Programming/Go/02-types-and-variables.md) | Numeric types, strings, conversions, iota |
| 03 | [Control Flow](Foundations/Programming/Go/03-control-flow.md) | if, switch, for/range, defer, panic/recover |
| 04 | [Functions](Foundations/Programming/Go/04-functions.md) | Multi-return, errors, %w, errors.Is/As, closures |
| 05 | [Collections](Foundations/Programming/Go/05-collections.md) | Arrays, slices, maps, sort, sets via map |
| 06 | [Structs & Methods](Foundations/Programming/Go/06-structs-and-methods.md) | Receivers, embedding, composition, options pattern |
| 07 | [Interfaces](Foundations/Programming/Go/07-interfaces.md) | Duck typing, error/Stringer, type assertions, DI |
| 08 | [Goroutines & Channels](Foundations/Programming/Go/08-goroutines-and-channels.md) | go, chan, select, WaitGroup, context, patterns |
| 09 | [Modules & Testing](Foundations/Programming/Go/09-modules-and-testing.md) | go.mod, packages, go test, table-driven tests |
| 10 | [File I/O, JSON, HTTP](Foundations/Programming/Go/10-file-io-json-http.md) | os.Open, bufio, json marshaling, net/http, httptest |
| 11 | [Standard Library Tour](Foundations/Programming/Go/11-stdlib-tour.md) | time, strings, sort, regexp, log/slog, context |
| 12 | [Generics & Iterators](Foundations/Programming/Go/12-generics-iterators.md) | type params, constraints, slices/maps stdlib, iter.Seq |

### Roadmap

- [Roadmap.md](Foundations/Roadmap.md) — pick a learning path; week-by-week schedules.

---

## Tier 2 — Concepts (Once basics feel comfortable)

### OOP — Four Pillars

- [four-pillars.md](Foundations/OOP/four-pillars.md) — Encapsulation, Abstraction, Inheritance, Polymorphism (Python + Go).

### SOLID Principles

| | Doc |
|---|---|
| S | [Single Responsibility (SRP)](Foundations/OOP/SOLID/01-single-responsibility.md) |
| O | [Open/Closed (OCP)](Foundations/OOP/SOLID/02-open-closed.md) |
| L | [Liskov Substitution (LSP)](Foundations/OOP/SOLID/03-liskov-substitution.md) |
| I | [Interface Segregation (ISP)](Foundations/OOP/SOLID/04-interface-segregation.md) |
| D | [Dependency Inversion (DIP)](Foundations/OOP/SOLID/05-dependency-inversion.md) |

### Design Patterns (8 core)

| Pattern | Category | Doc |
|---|---|---|
| Strategy | Behavioral | [strategy.md](Foundations/DesignPatterns/strategy.md) |
| Factory | Creational | [factory.md](Foundations/DesignPatterns/factory.md) |
| Singleton | Creational | [singleton.md](Foundations/DesignPatterns/singleton.md) |
| Observer | Behavioral | [observer.md](Foundations/DesignPatterns/observer.md) |
| Decorator | Structural | [decorator.md](Foundations/DesignPatterns/decorator.md) |
| Adapter | Structural | [adapter.md](Foundations/DesignPatterns/adapter.md) |
| State | Behavioral | [state.md](Foundations/DesignPatterns/state.md) |
| Builder | Creational | [builder.md](Foundations/DesignPatterns/builder.md) |

---

## Tier 3 — Applied (Interview-Grade)

### Low-Level Design (LLD)

Each topic has a Python AND a Go version. They cover the same problem from slightly different angles — read both for depth.

| Topic | Difficulty | Python | Go |
|---|---|---|---|
| Parking Lot | ⭐⭐ | [py](LLD/Python/parking-lot.md) | [go](LLD/Go/parking-lot.md) |
| Tic Tac Toe | ⭐ | [py](LLD/Python/tic-tac-toe.md) | [go](LLD/Go/tic-tac-toe.md) |
| Snake & Ladder | ⭐ | [py](LLD/Python/snake-and-ladder.md) | [go](LLD/Go/snake-and-ladder.md) |
| Connect Four | ⭐⭐ | [py](LLD/Python/connect-four.md) | [go](LLD/Go/connect-four.md) |
| Vending Machine | ⭐⭐ | [py](LLD/Python/vending-machine.md) | [go](LLD/Go/vending-machine.md) |
| ATM | ⭐⭐ | [py](LLD/Python/atm.md) | [go](LLD/Go/atm.md) |
| Elevator System | ⭐⭐⭐ | [py](LLD/Python/elevator-system.md) | [go](LLD/Go/elevator-system.md) |
| Movie Ticket Booking | ⭐⭐⭐ | [py](LLD/Python/movie-ticket-booking.md) | [go](LLD/Go/movie-ticket-booking.md) |
| Hotel Booking | ⭐⭐⭐ | [py](LLD/Python/hotel-booking.md) | [go](LLD/Go/hotel-booking.md) |
| Restaurant Reservation | ⭐⭐⭐ | [py](LLD/Python/restaurant-reservation.md) | [go](LLD/Go/restaurant-reservation.md) |
| Cab Booking | ⭐⭐⭐ | [py](LLD/Python/cab-booking.md) | [go](LLD/Go/cab-booking.md) |
| Splitwise | ⭐⭐⭐ | [py](LLD/Python/splitwise.md) | [go](LLD/Go/splitwise.md) |
| Library Management | ⭐⭐ | [py](LLD/Python/library-management.md) | [go](LLD/Go/library-management.md) |
| Inventory Management | ⭐⭐⭐ | [py](LLD/Python/inventory-management.md) | [go](LLD/Go/inventory-management.md) |
| Logging Service | ⭐⭐ | [py](LLD/Python/logging-service.md) | [go](LLD/Go/logging-service.md) |
| Amazon Locker | ⭐⭐ | [py](LLD/Python/amazon-locker.md) | [go](LLD/Go/amazon-locker.md) |
| File System | ⭐⭐⭐ | [py](LLD/Python/file-system.md) | [go](LLD/Go/file-system.md) |
| Pizza Ordering | ⭐⭐ | [py](LLD/Python/pizza-ordering.md) | [go](LLD/Go/pizza-ordering.md) |
| Shopping Cart | ⭐⭐ | [py](LLD/Python/shopping-cart.md) | [go](LLD/Go/shopping-cart.md) |
| Calendar | ⭐⭐⭐ | [py](LLD/Python/calendar.md) | [go](LLD/Go/calendar.md) |
| TrueCaller | ⭐⭐ | [py](LLD/Python/true-caller.md) | [go](LLD/Go/true-caller.md) |
| Chess | ⭐⭐⭐⭐ | [py](LLD/Python/chess.md) | [go](LLD/Go/chess.md) |
| Stack Overflow | ⭐⭐⭐ | [py](LLD/Python/stack-overflow.md) | [go](LLD/Go/stack-overflow.md) |
| Online Auction | ⭐⭐⭐ | [py](LLD/Python/online-auction.md) | [go](LLD/Go/online-auction.md) |
| Online Voting | ⭐⭐ | [py](LLD/Python/online-voting.md) | [go](LLD/Go/online-voting.md) |

### Machine Coding — data structures + concurrency primitives

| Topic | Difficulty | Python | Go |
|---|---|---|---|
| LRU Cache | ⭐⭐ | [py](MachineCoding/Python/lru-cache.md) | [go](MachineCoding/Go/lru-cache.md) |
| LFU Cache | ⭐⭐⭐ | [py](MachineCoding/Python/lfu-cache.md) | [go](MachineCoding/Go/lfu-cache.md) |
| Trie | ⭐⭐ | [py](MachineCoding/Python/trie.md) | [go](MachineCoding/Go/trie.md) |
| HashMap | ⭐⭐ | [py](MachineCoding/Python/hashmap.md) | [go](MachineCoding/Go/hashmap.md) |
| Min Heap | ⭐⭐ | [py](MachineCoding/Python/min-heap.md) | [go](MachineCoding/Go/min-heap.md) |
| Skip List | ⭐⭐⭐ | [py](MachineCoding/Python/skip-list.md) | [go](MachineCoding/Go/skip-list.md) |
| Disjoint Set (Union-Find) | ⭐⭐ | [py](MachineCoding/Python/disjoint-set.md) | [go](MachineCoding/Go/disjoint-set.md) |
| Bloom Filter | ⭐⭐⭐ | [py](MachineCoding/Python/bloom-filter.md) | [go](MachineCoding/Go/bloom-filter.md) |
| Memoization | ⭐ | [py](MachineCoding/Python/memoization.md) | [go](MachineCoding/Go/memoization.md) |
| In-Memory DB | ⭐⭐⭐ | [py](MachineCoding/Python/in-memory-db.md) | [go](MachineCoding/Go/in-memory-db.md) |
| Thread Pool | ⭐⭐⭐ | [py](MachineCoding/Python/thread-pool.md) | [go](MachineCoding/Go/thread-pool.md) |
| Bounded Buffer | ⭐⭐ | [py](MachineCoding/Python/bounded-buffer.md) | [go](MachineCoding/Go/bounded-buffer.md) |
| RWLock | ⭐⭐⭐ | [py](MachineCoding/Python/rwlock.md) | [go](MachineCoding/Go/rwlock.md) |
| Connection Pool | ⭐⭐⭐ | [py](MachineCoding/Python/connection-pool.md) | [go](MachineCoding/Go/connection-pool.md) |
| Token Bucket | ⭐⭐ | [py](MachineCoding/Python/token-bucket.md) | [go](MachineCoding/Go/token-bucket.md) |
| Promise/Future | ⭐⭐⭐ | [py](MachineCoding/Python/promise.md) | [go](MachineCoding/Go/promise.md) |
| Event Bus | ⭐⭐ | [py](MachineCoding/Python/event-bus.md) | [go](MachineCoding/Go/event-bus.md) |
| Circuit Breaker | ⭐⭐⭐ | [py](MachineCoding/Python/circuit-breaker.md) | [go](MachineCoding/Go/circuit-breaker.md) |

### High-Level Design (HLD) — system design

| Topic | Tags | Doc |
|---|---|---|
| URL Shortener | KV, base62, sharding | [url-shortener.md](HLD/url-shortener.md) |
| Twitter News Feed | Fan-out, hot keys | [twitter-news-feed.md](HLD/twitter-news-feed.md) |
| Rate Limiter | Token bucket, distributed | [rate-limiter.md](HLD/rate-limiter.md) |
| Distributed Cache | LRU, sharding, Memcached | [distributed-cache.md](HLD/distributed-cache.md) |
| Notification System | Pub/sub, SMS/email/push | [notification-system.md](HLD/notification-system.md) |
| Web Crawler | BFS, politeness, freshness | [web-crawler.md](HLD/web-crawler.md) |
| Distributed Logging | Append-only, Kafka | [distributed-logging.md](HLD/distributed-logging.md) |
| WhatsApp | Realtime msg, online presence | [whatsapp.md](HLD/whatsapp.md) |
| Slack | Channels, threads, RT | [slack.md](HLD/slack.md) |
| YouTube | Video upload, transcoding, CDN | [youtube.md](HLD/youtube.md) |
| Spotify | Audio streaming, playlists | [spotify.md](HLD/spotify.md) |
| Dropbox | File sync, dedup | [dropbox.md](HLD/dropbox.md) |
| Google Docs | OT/CRDT collab | [google-docs.md](HLD/google-docs.md) |
| Uber | Geo, dispatch, ETA | [uber.md](HLD/uber.md) |
| Local Delivery | Geo, courier matching | [local-delivery.md](HLD/local-delivery.md) |
| Tinder | Geo, swipe match | [tinder.md](HLD/tinder.md) |
| LinkedIn | Connections, search | [linkedin.md](HLD/linkedin.md) |
| Reddit | Voting, threads | [reddit.md](HLD/reddit.md) |
| FB Live Comments | Realtime, fan-out | [fb-live-comments.md](HLD/fb-live-comments.md) |
| FB Post Search | Inverted index | [fb-post-search.md](HLD/fb-post-search.md) |
| Gaming Leaderboard | Sorted set, top-K | [gaming-leaderboard.md](HLD/gaming-leaderboard.md) |
| YouTube Top K | Heavy hitters | [youtube-top-k.md](HLD/youtube-top-k.md) |
| Search Autocomplete | Trie + ranking | [search-autocomplete.md](HLD/search-autocomplete.md) |
| Yelp | Geo + reviews | [yelp.md](HLD/yelp.md) |
| Strava | Activity tracking | [strava.md](HLD/strava.md) |
| Online Auction | Bid, leader, end-time | [online-auction.md](HLD/online-auction.md) |
| Price Tracker | Crawl + alert | [price-tracker.md](HLD/price-tracker.md) |
| Robinhood | Trading, orderbook | [robinhood.md](HLD/robinhood.md) |
| Ticketmaster | High contention seats | [ticketmaster.md](HLD/ticketmaster.md) |
| LeetCode | Code judge, sandboxing | [leetcode.md](HLD/leetcode.md) |
| Ad Click Aggregator | Stream + dedup | [ad-click-aggregator.md](HLD/ad-click-aggregator.md) |
| News Aggregator | Crawl, dedup, rank | [news-aggregator.md](HLD/news-aggregator.md) |
| Job Scheduler | Cron, retries | [job-scheduler.md](HLD/job-scheduler.md) |
| Payment System | Idempotency, ledger | [payment-system.md](HLD/payment-system.md) |
| Metrics Monitoring | TS DB, alerts | [metrics-monitoring.md](HLD/metrics-monitoring.md) |
| Distributed Lock | Redis Redlock, leases | [distributed-lock-service.md](HLD/distributed-lock-service.md) |
| Message Queue | Kafka-style, partitions | [message-queue.md](HLD/message-queue.md) |

---

## Templates (for adding new content)

- [HLD-template.md](_template/HLD-template.md)
- [LLD-template.md](_template/LLD-template.md)
- [MC-template.md](_template/MC-template.md)

---

## How to use this index

- **Searching by topic**: ⌘+F (or Ctrl+F) on this page.
- **Studying a path**: see [Roadmap.md](Foundations/Roadmap.md).
- **Just curious**: pick anything in Tier 2 or 3 — they're standalone reads.
- **For interviews**: combine 2-3 LLD + 2-3 HLD + LRU & one other MC. That's a solid week's prep.

If something's missing, write it using the templates above.

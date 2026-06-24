---
title: API Design (REST · gRPC · GraphQL)
---

# API Design: REST vs gRPC vs GraphQL — Deep Dive

> **Type:** Core concept
> **Tags:** `[api]` `[rest]` `[grpc]` `[graphql]` `[interfaces]`
> **Where it shows up:** The API/contract step of every HLD answer — [twitter-news-feed](../../HLD/twitter-news-feed.md), [uber](../../HLD/uber.md), [linkedin](../../HLD/linkedin.md), and any "design the API" prompt

---

## Mental model

Every system needs a contract between clients and servers. The three dominant styles answer "how do client and server talk?" differently:

- **REST** — resources addressed by URLs, manipulated with HTTP verbs. The web's default.
- **gRPC** — typed remote procedure calls over HTTP/2 with binary Protobuf. The internal-microservices default.
- **GraphQL** — a query language where the client asks for exactly the fields it wants from a typed graph. The flexible-client-data default.

The interview move isn't reciting features — it's matching the style to the **caller**: public/third-party clients → REST; service-to-service, low-latency, high-volume → gRPC; rich frontends with diverse, evolving data needs → GraphQL. Most real systems use **more than one** (REST/GraphQL at the edge, gRPC between services).

## REST

Resources (`/users/42`, `/users/42/orders`) acted on with verbs: `GET` (read), `POST` (create), `PUT`/`PATCH` (update), `DELETE`. Stateless, cacheable, uses HTTP status codes and JSON.

- **Strengths:** universal tooling, human-readable, **HTTP caching works out of the box** ([CDN](../Caching/cdn.md)/browser), easy to debug (curl), great for public APIs.
- **Weaknesses:** **over-fetching** (you get the whole resource even if you need one field) and **under-fetching** (need data from 3 resources → 3 round trips, the "N+1"/chatty problem). No enforced schema/typing by default (mitigated by OpenAPI).

REST design fundamentals interviewers expect: nouns not verbs in paths, correct status codes (2xx/4xx/5xx), **pagination** (cursor/keyset over offset for deep pages — see [sql-relational](../Databases/sql-relational.md)), **versioning** (`/v1/...` or header), and **idempotency** (below).

## gRPC

Define services and messages in a **`.proto`** file; generate typed client/server stubs in many languages. Runs over **HTTP/2** with **Protobuf** binary serialization.

- **Strengths:** **fast and compact** (binary, multiplexed HTTP/2), strongly typed contract, code generation, first-class **streaming** (client/server/bidirectional). Ideal for **internal service-to-service** calls at volume.
- **Weaknesses:** **not browser-native** (needs gRPC-Web + a proxy), binary payloads are hard to debug by eye, less friendly for public/third-party consumers, weaker HTTP caching story.

gRPC is the standard for east-west (internal) traffic; pair it with REST/GraphQL at the north-south (public) edge.

## GraphQL

A single endpoint exposes a **typed schema**; clients send a query specifying exactly the fields/relationships they want, and get exactly that shape back.

- **Strengths:** **no over/under-fetching** — the client gets precisely what it asked for in one request; great for varied UIs and mobile (bandwidth-sensitive); the schema is self-documenting; one round trip for nested data.
- **Weaknesses:** **caching is harder** (one POST endpoint, query-dependent responses — no free HTTP caching); the **N+1 problem moves server-side** (resolving fields can fan out into many DB calls — needs batching/`DataLoader`); a naive deep/expensive query can be a performance or DoS risk (need query cost limits/depth limits); more server complexity.

## Comparison

| | REST | gRPC | GraphQL |
|---|---|---|---|
| Transport | HTTP/1.1+ | HTTP/2 | HTTP (usually POST) |
| Payload | JSON (text) | Protobuf (binary) | JSON |
| Typing | optional (OpenAPI) | strong (`.proto`) | strong (schema) |
| Fetching | over/under-fetch | RPC-shaped | exact fields |
| Caching | **easy (HTTP)** | hard | hard |
| Streaming | limited (SSE/WS) | **native** | subscriptions |
| Best for | public APIs | internal microservices | rich/varied clients |
| Browser | native | needs proxy | native |

## Cross-cutting concerns (raise these regardless of style)

- **Idempotency:** retried/duplicated requests shouldn't double-charge or double-create. `GET/PUT/DELETE` are idempotent by definition; make `POST` safe with an **idempotency key** the server dedupes on. Essential for payments/orders ([payment-system](../../HLD/payment-system.md)).
- **Pagination:** cursor/keyset over offset for large sets.
- **Versioning & backward compatibility:** never break existing clients; add fields, don't repurpose them (Protobuf field numbers, additive GraphQL schema changes, REST `/v2`).
- **Auth & rate limiting:** tokens (OAuth/JWT) at the edge; [rate limiting](../../HLD/rate-limiter.md) to protect the backend.
- **Error semantics:** consistent, typed errors (HTTP status codes / gRPC status codes / GraphQL `errors` array).

## When to use which

- **REST** — public/third-party APIs, simple CRUD, when HTTP caching and ubiquity matter.
- **gRPC** — internal microservice calls, low-latency/high-throughput, polyglot services, streaming.
- **GraphQL** — client-facing APIs with diverse, nested, fast-evolving data needs (mobile + web sharing a backend), an aggregation layer over many services.
- **Hybrid (common):** GraphQL/REST gateway at the edge → gRPC between internal services.

## Common interview follow-ups

- *"Which API style and why?"* → match to the caller (public vs internal vs rich client); justify with caching/typing/fetching tradeoffs.
- *"How do you handle retries safely?"* → idempotency keys for non-idempotent operations.
- *"GraphQL N+1?"* → batch resolvers (DataLoader), cap query depth/cost.
- *"How do you version without breaking clients?"* → additive changes; explicit versions; never repurpose fields.
- *"Why is GraphQL caching hard and how do you cope?"* → single POST endpoint defeats HTTP caching; use persisted queries + app-level/field caching.
- *"gRPC from a browser?"* → not directly; gRPC-Web + proxy, or expose REST/GraphQL at the edge.

## Gotchas

- **REST chattiness** — under-fetching causes many round trips; consider GraphQL or purpose-built endpoints (BFF) for rich screens.
- **GraphQL exposing an unbounded query surface** — without depth/cost limits, a single query can melt the backend.
- **Forgetting idempotency** — retried `POST`s double-charge; the classic payments bug.
- **Breaking changes disguised as "small tweaks"** — renaming/removing fields breaks live clients.
- **Using gRPC at the public edge** — poor browser support and debuggability; keep it internal.
- **Offset pagination on huge datasets** — `O(offset)` scans; use cursors.

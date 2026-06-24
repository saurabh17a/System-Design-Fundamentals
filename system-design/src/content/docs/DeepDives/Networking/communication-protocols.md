# Client-Server & Communication Protocols — Deep Dive

> **Type:** Core concept
> **Tags:** `[networking]` `[protocols]` `[tcp]` `[http]` `[realtime]`
> **Where it shows up:** The "how do client and server talk?" layer under every system — pairs with [api-design](api-design-rest-grpc-graphql.md) and [realtime transports](realtime-websockets-sse.md)

---

## Mental model

Above the application logic, every distributed system rests on a stack of network protocols, and a few decisions recur in interviews: **which transport (TCP vs UDP), which HTTP version, and which interaction pattern (request/response vs streaming vs push).** You rarely implement these, but you choose between them, and knowing *why* one fits — reliability vs speed, request/response vs server-push — is the depth signal. This page is the transport-and-protocol companion to the higher-level [API styles](api-design-rest-grpc-graphql.md) (REST/gRPC/GraphQL) and [real-time transports](realtime-websockets-sse.md) (polling/SSE/WebSockets).

## The layers (just enough)

```
Application:  HTTP, gRPC, WebSocket, DNS, SMTP   ← what your app speaks
Transport:    TCP (reliable, ordered) | UDP (fast, best-effort)
Network:      IP (addressing, routing)
```

You mostly operate at the application layer, but transport choice (TCP vs UDP) is a real design decision for latency-sensitive systems.

## TCP vs UDP

The fundamental transport choice — reliability vs speed:

- **TCP** — connection-oriented, **reliable, ordered, error-checked**. A handshake sets up a connection; lost packets are retransmitted; bytes arrive in order. The cost: handshake latency, head-of-line blocking (a lost packet stalls everything behind it), and per-connection state. **Default for almost everything** — HTTP, databases, RPC — because correctness usually matters more than shaving milliseconds.
- **UDP** — connectionless, **fast, best-effort**: no handshake, no retransmit, no ordering guarantee. Packets may drop, duplicate, or arrive out of order — and the app must tolerate that. Lower latency and overhead.

**Choose UDP when** dropping a packet is better than waiting for it: live **video/voice** (a re-sent frame from 200ms ago is useless — better to skip it), **gaming** (latest position matters, not stale ones), **DNS** (one small request/response), real-time telemetry. **Choose TCP** when every byte must arrive correctly and in order: web pages, APIs, file transfer, financial data.

## HTTP versions (each fixed a bottleneck)

- **HTTP/1.1** — one request at a time per connection; pipelining is broken in practice, so browsers open many parallel connections. **Head-of-line blocking** at the request level.
- **HTTP/2** — **multiplexing**: many concurrent streams over one TCP connection; header compression; server push. Big latency win for multi-asset pages. But because it's over a single TCP connection, a lost packet still causes **TCP-level** head-of-line blocking for all streams. ([gRPC](api-design-rest-grpc-graphql.md) rides on HTTP/2.)
- **HTTP/3 (QUIC)** — runs over **UDP**, reimplementing reliability/ordering *per stream* in user space, so a lost packet only stalls *its* stream, not all of them. Also folds the TLS handshake in for faster connection setup. The current frontier for low-latency web.

The interview point: each version attacked the previous one's head-of-line blocking — request-level (1.1) → TCP-connection-level (2) → eliminated per-stream (3/QUIC).

## Interaction patterns (request/response → push)

How the two sides exchange messages — covered in depth in [realtime-websockets-sse](realtime-websockets-sse.md), summarized here:

- **Request/response** (classic HTTP) — client asks, server answers. Simple, stateless, cacheable. No server-initiated push.
- **Short polling** — client re-asks on a timer. Simple, wasteful, laggy.
- **Long polling** — server holds the request until data is ready. Near-real-time over plain HTTP.
- **Server-Sent Events (SSE)** — one long-lived HTTP connection streaming **server→client** events; auto-reconnect built in. One-directional.
- **WebSockets** — a persistent, **full-duplex** TCP connection upgraded from HTTP; lowest-latency two-way messaging; stateful (pins a connection to a server).

Decision: rare updates → polling; one-way stream → SSE; interactive two-way → WebSockets. See [realtime-websockets-sse](realtime-websockets-sse.md) for scaling them.

## API styles (the application contract)

On top of the transport sits the API style — **REST vs gRPC vs GraphQL** — fully covered in [api-design-rest-grpc-graphql](api-design-rest-grpc-graphql.md). In short: REST (HTTP/JSON, public APIs, cacheable), gRPC (HTTP/2 + Protobuf, internal microservices, streaming), GraphQL (exact-shape queries, rich clients).

## Cross-cutting essentials

- **TLS** — encrypt in transit; terminate at the edge/[load balancer](load-balancers.md) for latency, re-encrypt internally if required. TLS 1.3 cuts handshake round trips.
- **Connection reuse** — handshakes are expensive; **keep-alive** and connection pooling avoid re-handshaking per request (huge for DB and service-to-service calls).
- **Serialization** — text (JSON: readable, larger, slower) vs binary (Protobuf/Avro/Thrift: compact, fast, schema'd). Binary for high-volume internal traffic; JSON for public/debuggable APIs.
- **Backpressure** — in streaming protocols, the consumer must be able to signal "slow down" or buffers blow up.

## Tradeoffs & decisions

- **Reliability vs latency** — TCP (correct, ordered, slower setup) vs UDP (fast, lossy). The defining transport trade-off.
- **Simplicity vs efficiency** — HTTP/1.1 everywhere is simple; HTTP/2/3 and binary serialization cut latency/bandwidth at the cost of complexity/tooling.
- **Stateless request/response vs stateful streaming** — easy scaling/caching vs real-time push that pins connections and needs a [pub/sub backplane](../Messaging/realtime-pubsub.md).
- **Text vs binary payloads** — debuggability/ubiquity vs size/speed.

## Common interview follow-ups

- *"TCP or UDP for this?"* → reliability-critical (web, APIs, files) → TCP; latency-over-loss (live video/voice, gaming, DNS) → UDP.
- *"Why HTTP/2 or HTTP/3?"* → multiplexing removes request-level HoL blocking (2); QUIC over UDP removes per-stream HoL blocking and speeds connection setup (3).
- *"How does the server push to the client?"* → SSE (one-way) or WebSockets (two-way); polling if updates are rare.
- *"How do you cut connection latency?"* → keep-alive/pooling, TLS 1.3, terminate TLS at the edge, HTTP/2+.
- *"JSON or Protobuf?"* → JSON for public/debuggable; Protobuf for high-volume internal (smaller, faster, schema-enforced).

## Gotchas

- **Using UDP and ignoring loss** — if the app can't tolerate missing/out-of-order packets, UDP will bite you; reliability is then your problem to build.
- **Assuming HTTP/2 removed all head-of-line blocking** — it removed request-level, not TCP-packet-level; that's what HTTP/3/QUIC fixes.
- **New TCP/TLS connection per request** — handshake cost dominates; reuse connections.
- **WebSockets where SSE suffices** — paying for bidirectional + statefulness on a one-way stream.
- **Text serialization on hot internal paths** — JSON's size/parse cost adds up at high QPS; use binary.
- **No backpressure on a stream** — a fast producer + slow consumer overflows buffers and OOMs.

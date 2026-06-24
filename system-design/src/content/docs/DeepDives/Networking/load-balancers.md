# Load Balancers — Deep Dive

> **Type:** Core technology
> **Tags:** `[networking]` `[scalability]` `[availability]` `[traffic-distribution]`
> **Where it shows up:** The front door of essentially every HLD answer — [url-shortener](../../HLD/url-shortener.md), [twitter-news-feed](../../HLD/twitter-news-feed.md), [whatsapp](../../HLD/whatsapp.md), and any horizontally-scaled service

---

## Mental model

A load balancer sits in front of a pool of servers and spreads incoming requests across them. It does two jobs at once: **distribute load** (so no single server is overwhelmed and you can scale horizontally) and **provide availability** (route around dead servers via health checks). It's the component that turns "one server" into "a fleet that looks like one server" to the client.

In an HLD answer, the LB is where horizontal scaling becomes real: clients hit one stable address; behind it, you add/remove servers freely. The two things to get right are **the layer it operates at (L4 vs L7)** and **the algorithm**.

## Internals

### L4 vs L7

- **Layer 4 (transport):** routes based on **IP and TCP/UDP port** — it forwards packets/connections without looking inside. Fast, low overhead, protocol-agnostic. Can't make decisions based on URL, headers, or cookies.
- **Layer 7 (application):** terminates the connection and inspects **HTTP** — URL path, headers, cookies, method. Enables **content-based routing** (`/api/*` → API pool, `/static/*` → static pool), TLS termination, header rewriting, sticky sessions by cookie, request-level retries. More CPU per request, far more flexible.

Rule of thumb: **L7 for HTTP services** (the common case — you want path/host routing, TLS, and smarts); **L4 when you need raw throughput** or you're balancing non-HTTP protocols (databases, gRPC streams, game traffic).

### Balancing algorithms

- **Round-robin** — rotate through servers in order. Simple; assumes requests are roughly equal cost.
- **Weighted round-robin** — bigger servers get more traffic (weights). For heterogeneous fleets.
- **Least connections** — send to the server with the fewest active connections. Better when request durations vary (long-lived connections, streaming).
- **Least response time** — factor in latency, not just connection count.
- **IP/consistent hashing** — hash the client (or a key) to a server, so the same client lands on the same server. Enables a form of stickiness and pairs with [consistent hashing](../Distribution/consistent-hashing.md) for cache-affinity. 

### Health checks

The LB continuously probes backends (e.g. `GET /healthz`) and **removes unhealthy ones from rotation**, re-adding them when they recover. This is how the LB delivers availability — a crashed or overloaded server stops receiving traffic automatically. Tune the probe interval and failure threshold: too aggressive flaps servers in/out; too lax sends traffic to dead nodes.

### Sticky sessions (session affinity)

Pin a client to the same backend (via cookie or IP hash) so server-local session state stays valid. **Prefer to avoid it** — it undermines even distribution and breaks when that server dies (the user loses their session). The better pattern is **stateless servers + shared session store** ([Redis](../Caching/redis.md)), so any server can handle any request. Mention stickiness, then explain why you'd design it away.

### The LB itself can't be a single point of failure

A single LB is a SPOF — if it dies, everything is unreachable. Solutions: **redundant LBs** (active-passive with a floating/virtual IP, or active-active), and at the very edge, **DNS** ([dns](dns.md)) or **anycast** to distribute across multiple LB endpoints/regions. Big picture: DNS picks a region/LB → LB picks a server.

## Tradeoffs & decisions

- **L4 vs L7** — throughput/simplicity vs HTTP-aware routing and features.
- **Algorithm** — round-robin (uniform requests) vs least-connections (variable durations) vs hashing (affinity).
- **Stateless + shared store vs sticky sessions** — even distribution and resilience vs simpler-but-fragile server-local state.
- **Hardware/managed vs software** — managed cloud LBs (ALB/NLB, etc.) vs self-run (NGINX/HAProxy/Envoy): ops cost vs control.

## When to use / when not

**Use a load balancer when:** you run more than one instance of a service (i.e. almost always at scale) and need distribution + health-based failover. It's the default front door for any horizontally scaled tier.

**Not the right tool when:** the problem is *which region/datacenter* a user should reach — that's [DNS](dns.md)/anycast (geo routing) — or *which shard owns a key* — that's [sharding/partitioning](../Distribution/sharding-partitioning.md) logic, not connection balancing. LBs balance connections to interchangeable servers, not data ownership.

## Common interview follow-ups

- *"L4 or L7 here?"* → L7 for HTTP (path/host routing, TLS, retries); L4 for raw TCP/UDP throughput.
- *"Which algorithm?"* → round-robin for uniform requests; least-connections for long-lived/variable; hashing for affinity.
- *"How does it know a server is down?"* → health checks remove failing backends from rotation.
- *"How do you avoid the LB being a SPOF?"* → redundant LBs (active-active / floating IP) + DNS/anycast above them.
- *"How do you handle sessions across servers?"* → stateless servers + shared session store (Redis); avoid sticky sessions.
- *"How do you scale beyond one region?"* → DNS/GeoDNS routes to the nearest regional LB, which balances within the region.

## Gotchas

- **The LB as an unguarded SPOF** — a single instance defeats the availability you added it for; make it redundant.
- **Sticky sessions hiding statefulness** — they mask servers that should be stateless; a server death then drops user sessions.
- **Bad health checks** — checking only that the port is open (not that the app is actually healthy) routes traffic to broken servers; flapping checks churn the pool.
- **Confusing LB with DNS/sharding** — LBs don't pick regions (DNS does) or own data (shards do).
- **Ignoring connection draining** — removing a server without draining in-flight requests drops live connections; drain on deploy/scale-down.
- **L7 TLS termination without re-encryption** inside the network may violate security requirements — know whether you need end-to-end TLS.

# DNS — Deep Dive

> **Type:** Core technology
> **Tags:** `[networking]` `[dns]` `[routing]` `[availability]`
> **Where it shows up:** The first hop of every request — global routing for [youtube](../../HLD/youtube.md), [cdn](../Caching/cdn.md), and any multi-region system

---

## Mental model

DNS is the internet's phone book: it translates a human name (`api.example.com`) into an IP address a machine can connect to. But for system design its interesting role is bigger than lookup — **DNS is the first routing decision in every request**, and you can use it to steer users to the right region, the nearest edge, or away from a dead datacenter, *before* any of your servers are involved.

The interview-relevant insight: DNS resolution is **cached aggressively at every layer**, governed by **TTL**. That caching is what makes DNS scale to the whole planet — and also what makes DNS-based failover *slow* (you can't instantly change where users go).

## Internals

### Resolution flow

A lookup walks a hierarchy, mostly served from caches:

```
browser cache → OS cache → recursive resolver (ISP/8.8.8.8)
   → root nameserver  (knows where .com servers are)
   → TLD nameserver   (.com → knows example.com's authoritative server)
   → authoritative nameserver (example.com → returns the IP)
```

The **recursive resolver** does the legwork and caches the answer for its TTL, so most lookups never reach the root/TLD/authoritative servers. The **authoritative** server is the source of truth you control (where you set records).

### Record types worth knowing

- **A / AAAA** — name → IPv4 / IPv6 address.
- **CNAME** — alias one name to another (`www` → `example.com`).
- **NS** — delegates a zone to its authoritative nameservers.
- **MX** — mail servers.
- **TXT** — arbitrary text (SPF/DKIM, domain verification).

### TTL — the central tradeoff

Every record has a **TTL** telling resolvers how long to cache it.

- **High TTL** (hours/days): fewer lookups, faster resolution, less load on your nameservers — but **changes propagate slowly**. If you change an IP, old resolvers keep using the stale one until their cache expires.
- **Low TTL** (seconds/minutes): changes propagate fast (good for failover) — but more lookups and you depend on resolvers actually honoring the short TTL (some clamp it).

This is why **DNS-based failover is not instant**: even with a 60s TTL, some clients cache longer, so you can't rely on DNS alone for fast failover — pair it with redundant [load balancers](load-balancers.md)/anycast that fail over below the DNS layer.

### Routing policies (DNS as a traffic director)

Managed DNS can return *different answers to different users*:

- **GeoDNS / latency-based:** return the IP of the **nearest/lowest-latency** region or [CDN](../Caching/cdn.md) edge. This is how global services send Tokyo users to the Tokyo datacenter.
- **Weighted:** split traffic by percentage (canary releases, gradual migration).
- **Failover:** health-check endpoints and stop returning the IP of a dead datacenter.
- **Anycast:** the *same* IP is announced from many locations; the network routes the user to the topologically nearest one. Used heavily by CDNs and DNS providers themselves; gives near-instant rerouting without changing DNS records.

So in a global design: **DNS (geo/latency/anycast) chooses the region/edge → [load balancer](load-balancers.md) chooses the server.**

## Tradeoffs & decisions

- **TTL: stability/efficiency vs agility** — long TTL caches well but pins users to stale answers; short TTL enables failover but costs lookups and trusts resolver behavior.
- **DNS failover vs LB/anycast failover** — DNS is coarse and slow (cache-bound); anycast/redundant LBs handle fast failover; use DNS for region selection, not millisecond failover.
- **Simplicity vs smart routing** — plain A records are simple; geo/latency/weighted policies add power and a managed-DNS dependency.

## When to use / when not

**Lean on DNS for:** initial endpoint resolution (always), **region/edge selection** (GeoDNS/latency/anycast), weighted rollouts, and coarse datacenter failover.

**Don't rely on DNS for:** **fast failover** (TTL caching makes it laggy — use anycast / redundant LBs), or **per-request load balancing** (that's the [load balancer](load-balancers.md)'s job; DNS round-robin is crude and cache-skewed).

## Common interview follow-ups

- *"How do users reach the nearest datacenter/edge?"* → GeoDNS/latency-based DNS or anycast returns the closest endpoint.
- *"How do you fail over a whole region?"* → health-checked DNS failover for coarse rerouting, but note the TTL lag; anycast/redundant LBs for fast cutover.
- *"Why not set TTL to 1 second for instant failover?"* → more lookups, nameserver load, and many resolvers won't honor it; DNS isn't a fast-failover mechanism.
- *"What handles which server vs which region?"* → DNS picks region/edge; LB picks server.
- *"Is DNS a SPOF?"* → use multiple authoritative nameservers (NS records) across providers; anycast for resilience.

## Gotchas

- **Expecting instant propagation** — stale cached records persist past your TTL change; plan migrations around it (lower TTL *ahead* of a change).
- **DNS round-robin as a load balancer** — no health awareness and cache-skewed distribution; it's not a substitute for an LB.
- **Single authoritative provider** — a DNS provider outage takes you fully offline; use redundant NS across providers.
- **Forgetting client-side caching** — browsers/OS cache beyond the resolver; you don't control all the caches.
- **CNAME at the zone apex** — not allowed by the spec (`example.com` can't be a CNAME); needs provider-specific ALIAS/ANAME records.

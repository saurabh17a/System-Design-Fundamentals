# CDN — Deep Dive

> **Type:** Core technology
> **Tags:** `[cdn]` `[edge]` `[caching]` `[latency]` `[static-content]`
> **Where it shows up:** [youtube](../../HLD/youtube.md), [dropbox](../../HLD/dropbox.md), [spotify](../../HLD/spotify.md), [news-aggregator](../../HLD/news-aggregator.md), and any system serving images/video/static assets globally

---

## Mental model

A **Content Delivery Network** is a globally distributed fleet of caching servers ("edge" or PoPs — points of presence) that sit between users and your origin servers. A user in Tokyo hits a Tokyo edge node instead of your origin in Virginia; the edge serves a cached copy if it has one, or fetches from origin once and caches it for the next Tokyo user.

The two problems a CDN solves are **latency** (serve from physically near the user — speed of light is real; a round trip across the planet is ~150 ms+) and **origin offload** (the edge absorbs the bulk of read traffic, so your origin handles a trickle). In an HLD answer, a CDN is the standard answer for *static and large media content served to a geographically spread audience*.

## Internals

### Pull vs push

- **Pull (origin-pull):** the edge fetches from origin **on the first miss** for a given object, then caches it. You don't pre-upload anything — the CDN lazily fills as content is requested. Default for most web assets. First request per region is a miss (slower); after that it's hot.
- **Push:** you **proactively upload** content to the CDN ahead of demand. Better for large files you *know* will be hot (a new video release, a software update) so the first viewer doesn't eat the origin fetch. More control, more management.

### Cache keys & cacheability

The edge decides "do I have this?" via a **cache key** — typically the URL, sometimes plus selected headers/query params. Control caching with HTTP headers:

- **`Cache-Control: max-age=...`** — how long the edge (and browser) may serve it without rechecking.
- **`ETag` / `Last-Modified`** — validators for conditional revalidation (`If-None-Match` → `304 Not Modified` if unchanged, avoiding a re-download).
- **`Cache-Control: no-store / private`** — don't cache at the edge (user-specific or sensitive responses).

A subtle footgun: if query strings or cookies are part of the key when they shouldn't be, you get **cache fragmentation** (many keys for the same content → low hit rate). Strip irrelevant params from the key.

### Invalidation — the hard part

Cached content goes stale when you update it. Two strategies, and the second is strongly preferred:

- **Purge / invalidation:** explicitly tell the CDN "drop this URL." Works, but propagation across all edges takes time and APIs are rate-limited — don't rely on it for frequent updates.
- **Versioned URLs (cache busting):** make the URL change when the content changes — `app.a1b2c3.js`, `avatar.jpg?v=42`, or a content hash in the path. The new URL is simply a new cache key; the old one ages out. **This is the standard pattern** — set a long `max-age` and bust via the URL. No purge needed.

### What else edges do

Modern CDNs are more than caches: **TLS termination** (HTTPS handshake at the edge, near the user), **compression** (gzip/brotli), **DDoS absorption / WAF**, **geo-routing**, and increasingly **edge compute** (run small functions at the PoP). Routing the user to the nearest healthy edge is usually done via **[DNS](../Networking/dns.md)** (geo/latency-based) or anycast IP.

## Tradeoffs & decisions

- **Latency/offload vs staleness** — long TTLs maximize hit rate and offload but risk serving stale content; solve with versioned URLs rather than short TTLs.
- **Pull vs push** — lazy + simple (first-request penalty) vs proactive + controlled (management overhead).
- **Static vs dynamic** — CDNs shine for static/cacheable content; dynamic, per-user, frequently-changing responses cache poorly (though edge compute and micro-caching blur this).
- **Cost vs control** — CDNs charge for egress and requests; for huge media this is a real line item, but usually cheaper than scaling origin + bandwidth yourself.

## When to use / when not

**Use a CDN for:**
- Static assets (JS/CSS/images/fonts) and **large media** (video, audio, downloads, file shares) — [youtube](../../HLD/youtube.md), [spotify](../../HLD/spotify.md), [dropbox](../../HLD/dropbox.md).
- A globally distributed audience where origin RTT hurts.
- Absorbing read spikes and shielding the origin (flash traffic, launches).

**Less useful when:**
- Content is **highly dynamic and per-user** (personalized API responses) — low cacheability; cache the static parts only.
- Your audience is single-region and close to origin — the win shrinks.
- Strong consistency / instant updates are required and you can't use versioned URLs.

## Common interview follow-ups

- *"How do users reach the nearest edge?"* → geo/latency-based [DNS](../Networking/dns.md) or anycast.
- *"How do you update content without serving stale copies?"* → versioned/hashed URLs (preferred) + long TTL; purge only for emergencies.
- *"Static vs dynamic content?"* → CDN for static/media; origin (with an app cache) for dynamic; consider micro-caching or edge compute for semi-dynamic.
- *"Where does TLS terminate?"* → at the edge, close to the user, cutting handshake latency.
- *"Push or pull for a video platform?"* → pull for the long tail; push/pre-warm popular new releases to avoid an origin stampede on launch.

## Gotchas

- **Caching user-specific responses** at a shared edge can leak one user's data to another — mark them `private`/`no-store`.
- **Relying on purge for routine updates** — propagation lag + rate limits make it unreliable; use versioned URLs.
- **Cache fragmentation** from putting volatile query params/cookies in the cache key → low hit rate.
- **Forgetting the cold/first-request miss** in pull mode — the first user per region still pays the origin fetch; pre-warm if that matters.
- **No origin protection on a stampede** — if many edges miss simultaneously on a hot object, the origin can still get hammered; use origin shielding / tiered caching.

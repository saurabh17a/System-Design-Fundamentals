# Consistent Hashing — Deep Dive

> **Type:** Core concept
> **Tags:** `[distributed-systems]` `[partitioning]` `[load-balancing]` `[sharding]`
> **Where it shows up:** [distributed-cache](../../HLD/distributed-cache.md), [nosql-cassandra](../Databases/nosql-cassandra.md), [sharding-partitioning](sharding-partitioning.md), and any "how do you distribute keys across N nodes" follow-up

---

## Mental model

You have keys (cache entries, rows, sessions) and N servers, and you need a rule that maps each key to a server. The naive rule is `server = hash(key) % N`. It works perfectly — until N changes. **Add or remove one node and `% N` becomes `% (N±1)`, which remaps almost every key.** For a cache that means a near-total miss storm; for a sharded store it means moving nearly all your data.

Consistent hashing is the fix: a mapping where **adding or removing a node only moves the keys that node is directly responsible for — roughly `1/N` of them — leaving everyone else untouched.** That's the entire point, and the one sentence to say in an interview: *"Consistent hashing minimizes remapping when the node set changes; modulo hashing remaps almost everything."*

## Internals

### The ring

Map both **keys and nodes** onto the same circular hash space (e.g. 0 … 2³²−1, wrapping around).

- Hash each node's id to a point on the ring.
- Hash each key to a point on the ring.
- A key belongs to the **first node found going clockwise** from the key's position.

```
        node A (0)
          ●───────────────●  node B (90)
         ╱                  ╲
    k1 → ● (350)             ● ← k2 (120)   k2 walks clockwise → node C
        ╲                   ╱
   node D ●───────────────● node C (180)
         (270)
   k1 walks clockwise past 350 → wraps → node A
```

Now **add node E** between B and C at position 150. Only keys in the arc `(90, 150]` — formerly going to C — move to E. Keys mapped to A, B, D, and the `(150,180]` part of C are **unaffected**. Removing a node is the mirror image: only *its* keys move, to the next node clockwise.

```python
import bisect, hashlib

def h(s: str) -> int:
    return int(hashlib.md5(s.encode()).hexdigest(), 16)

class Ring:
    def __init__(self, nodes, vnodes=150):
        self.vnodes = vnodes
        self.ring = {}            # ring position -> physical node
        self.sorted = []          # sorted ring positions
        for n in nodes:
            self.add(n)

    def add(self, node):
        for i in range(self.vnodes):       # many virtual points per node
            pos = h(f"{node}#{i}")
            self.ring[pos] = node
            bisect.insort(self.sorted, pos)

    def get(self, key):
        if not self.ring:
            return None
        pos = h(key)
        i = bisect.bisect(self.sorted, pos) % len(self.sorted)  # first node clockwise
        return self.ring[self.sorted[i]]
```

### Virtual nodes — the essential refinement

With one point per node, two problems appear: (1) random placement makes arcs **uneven**, so some nodes own far more of the ring (and load) than others; (2) when a node dies, **all** its load dumps onto a single neighbor.

The fix: give each physical node **many virtual nodes** (e.g. 100–200 points scattered around the ring). Now:

- Load evens out — the law of large numbers smooths arc sizes (variance shrinks as you add vnodes).
- When a node fails, its many small arcs redistribute across **many** different neighbors, not one — no single hotspot from a failure.
- You can also weight heterogeneous hardware: a beefier node gets more vnodes → more keys.

Virtual nodes are why "consistent hashing" in practice always means "consistent hashing **with virtual nodes**." Mentioning them unprompted signals depth.

### Replication on the ring

To replicate a key to R nodes, walk clockwise and place copies on the **next R distinct physical nodes** (skipping additional vnodes of a node you already used). This is exactly how Dynamo-style stores and [Cassandra](../Databases/nosql-cassandra.md) pick replicas, and it composes with quorum reads/writes (`W+R>N`).

## Tradeoffs & decisions

- **vnode count:** more vnodes → smoother load + better failure spreading, but a larger ring (more memory, slightly slower lookups, more metadata to gossip). 100–200 per node is typical.
- **Even spread vs minimal movement:** consistent hashing optimizes for *minimal movement* on membership change. It does **not** by itself guarantee perfectly even load, especially with skewed key popularity — **hot keys** still concentrate on one node.
- **Bounded-load variant:** "consistent hashing with bounded loads" caps any node's share; if a key's target is over capacity it overflows to the next node. Worth naming if asked about load skew.
- **vs rendezvous (HRW) hashing:** rendezvous hashing (`pick node maximizing hash(key,node)`) also gives minimal movement with no ring/vnode bookkeeping and naturally even distribution; it's `O(N)` per lookup vs the ring's `O(log N)`. A good "what else?" answer.

## When to use / when not

**Use consistent hashing when:**
- You **distribute keys across a changing set of nodes** and want to minimize data movement / cache invalidation when nodes join or leave — distributed caches, sharded databases, partitioned queues.
- Nodes are added/removed routinely (autoscaling, failures) and a full remap would be catastrophic. ([distributed-cache](../../HLD/distributed-cache.md))

**You don't need it when:**
- The node set is **fixed** and you control rebalancing manually — plain hash partitioning or a lookup/directory table is simpler and lets you place shards deliberately. ([sharding-partitioning](sharding-partitioning.md))
- A central **coordinator/router** already maps keys→shards (many systems prefer an explicit shard map for control over placement and rebalancing).

## Common interview follow-ups

- *"Why not just `hash(key) % N`?"* → a node change remaps ~all keys; consistent hashing moves only ~`1/N`. This is the core question.
- *"How do you keep load even?"* → virtual nodes (many points per physical node); weight by capacity; bounded-load variant for skew.
- *"What happens when a node dies?"* → its arcs go to the next nodes clockwise; with vnodes the load spreads across many neighbors, not one.
- *"How do you replicate?"* → next R distinct physical nodes clockwise; pairs naturally with quorum.
- *"Hot key on the ring?"* → consistent hashing balances *keyspace*, not *traffic* — a single hot key still lands on one node; handle it with local caching, key splitting, or replicating that key. (See [Redis](../Caching/redis.md) hot-key notes.)

## Gotchas

- **One point per node = uneven load + single-neighbor failover.** Always use virtual nodes.
- **It balances the keyspace, not request volume.** Skewed key popularity (hot keys) defeats it; that's a separate problem.
- **Weak hash / clustered node positions** → lumpy ring. Use a good hash and enough vnodes.
- **Forgetting replica placement skips duplicate vnodes** — naive "next R points" can place two replicas on the *same* physical node; you must skip to R *distinct* nodes.
- **Confusing it with sharding strategy** — consistent hashing is *a* partitioning mechanism optimized for membership churn, not the only one; an explicit shard map is often chosen for placement control.

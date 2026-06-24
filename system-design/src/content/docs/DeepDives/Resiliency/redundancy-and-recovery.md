# Data Redundancy & Recovery — Deep Dive

> **Type:** Core concept
> **Tags:** `[resiliency]` `[backups]` `[disaster-recovery]` `[durability]` `[rpo-rto]`
> **Where it shows up:** [payment-system](../../HLD/payment-system.md), [dropbox](../../HLD/dropbox.md), [google-docs](../../HLD/google-docs.md), and any "how do you not lose data?" follow-up

---

## Mental model

Two different questions hide under "don't lose data":

1. **A machine died — is my data still served?** → solved by **redundancy** ([replication](../Distribution/replication.md)): copies on other live machines take over.
2. **The data itself got destroyed or corrupted — can I get it back?** → solved by **recovery** (backups): a point-in-time copy you can restore from.

The crucial insight interviewers probe: **replication is not a backup.** Replicas copy writes *faithfully and instantly* — including the bad `DELETE FROM users` and the corrupting bug. Redundancy protects against **hardware/node failure**; backups protect against **logical failure** (human error, bad deploys, corruption, ransomware). A serious system needs both, because they defend against different threats.

## Redundancy (staying available through failure)

Keep multiple live copies so a failure is invisible to users:

- **Replication** — leader–follower, multi-leader, or quorum copies of the data; on node loss, a replica is promoted/used. Details and the sync-vs-async durability knob in [replication](../Distribution/replication.md).
- **Failure domains** — spread copies across **racks → availability zones → regions** so a correlated failure (a rack loses power, an AZ goes down) doesn't take all copies. Three replicas in one rack are not redundant.
- **Erasure coding** — instead of N full copies, split data into k data + m parity fragments; survive m losses at far less storage cost than full replication. How [object stores](../Databases/object-blob-storage.md) reach ~11 nines durability economically. Tradeoff: cheaper storage, more CPU/rebuild cost vs plain replication.
- **Sync vs async** — synchronous replication = no loss on failover but higher latency; async = fast but a failover can lose un-replicated writes. Semi-sync is the common middle.

Redundancy gives you **availability and durability against hardware failure** — but it will happily replicate a logical disaster.

## Recovery (getting data back after it's destroyed)

Backups are point-in-time copies you restore from when redundancy can't help:

- **Full backup** — complete snapshot; simple, large, slow.
- **Incremental** — only what changed since the last backup; small/fast to take, slower to restore (replay a chain).
- **Differential** — everything changed since the last *full*; middle ground.
- **Continuous / point-in-time recovery (PITR)** — full snapshot + a continuous log (WAL/binlog) so you can restore to *any moment*, e.g. "the second before the bad migration." The gold standard for databases.
- **Snapshots** — fast storage/volume-level copies (copy-on-write); great for quick rollback, but verify they're application-consistent.

**The 3-2-1 rule:** keep **3** copies, on **2** different media/systems, with **1** off-site (different region/provider) — so one event can't destroy all copies.

## RPO and RTO — the two numbers that define your strategy

These quantify "how much can we lose" and "how fast must we be back" — name them in an interview:

- **RPO (Recovery Point Objective)** — the maximum acceptable **data loss**, measured in time. "RPO = 5 minutes" means you can lose at most 5 minutes of data → you need backups/replication at least that fresh. RPO = 0 (zero loss) demands synchronous replication and is expensive.
- **RTO (Recovery Time Objective)** — the maximum acceptable **downtime** to recover. "RTO = 1 hour" means you must be back within an hour → drives whether you need hot standby (seconds) vs restore-from-backup (hours).

Different data justifies different targets: a financial ledger → RPO≈0, tight RTO; an analytics warehouse → hours of RPO/RTO are fine and far cheaper.

## Disaster recovery (DR) strategies

Whole-region/site recovery, ordered by cost vs speed (the classic spectrum):

| Strategy | RTO | Cost | How |
|---|---|---|---|
| **Backup & restore** | hours | $ | Restore from backups into a new environment. |
| **Pilot light** | 10s of min | $$ | Core (DB replica) always running; spin up the rest on disaster. |
| **Warm standby** | minutes | $$$ | A scaled-down full copy running; scale it up and cut over. |
| **Hot standby / multi-region active-active** | seconds | $$$$ | Full capacity live in another region; traffic fails over via [DNS](../Networking/dns.md)/anycast. |

Pick by RTO/RPO and budget — most teams don't need active-active; many need more than backup-and-restore.

## Tradeoffs & decisions

- **Redundancy vs backups** — different threats (hardware vs logical); you need both, not one or the other.
- **RPO/RTO vs cost** — tighter targets cost exponentially more (sync replication, hot standby). Match to the data's value.
- **Replication vs erasure coding** — simple/fast/read-friendly vs cheaper storage at higher rebuild/CPU cost.
- **Backup frequency vs overhead** — fresher backups (smaller RPO) cost more I/O/storage; continuous PITR vs periodic snapshots.
- **Retention** — how far back you can restore vs storage cost; tier old backups to cheap [archive storage](../Databases/object-blob-storage.md).

## When to use / what to reach for

- **Always replicate** for availability/durability against node loss.
- **Always back up** for recovery from logical disasters — even with replication.
- **Add cross-region/DR** when an outage's cost justifies it; size the DR strategy by RTO/RPO.
- **Verify restores** — an untested backup is a hope, not a recovery plan.

## Common interview follow-ups

- *"Isn't replication enough — why back up too?"* → replication copies bad writes/deletes/corruption faithfully; backups defend against logical failure and human error.
- *"What's your RPO/RTO here?"* → set them per data criticality; they drive replication mode and DR strategy.
- *"Someone ran a bad `DELETE` — how do you recover?"* → point-in-time recovery (snapshot + WAL) to just before the bad statement; replicas can't help.
- *"How do you survive a region going down?"* → multi-region redundancy + DNS/anycast failover; DR strategy chosen by RTO/RPO.
- *"How do object stores get 11 nines?"* → multi-AZ replication + erasure coding.

## Gotchas

- **"Replication is my backup"** — the cardinal mistake; it propagates corruption and deletes instantly.
- **Backups never restore-tested** — discovered to be broken/incomplete exactly when you need them; test restores regularly.
- **All copies in one failure domain** — replicas in one AZ, or backups in the same account/region as prod, die together.
- **Ignoring RPO/RTO** — "we have backups" without the numbers doesn't tell you if the strategy meets the business need.
- **Backups not encrypted / not access-controlled** — a backup is a full copy of your data; it's a prime exfiltration target.
- **Forgetting backup *consistency*** — a snapshot taken mid-transaction across shards can be inconsistent; use application-consistent/coordinated snapshots.

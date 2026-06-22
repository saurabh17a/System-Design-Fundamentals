# LeetCode (Code Submission + Judge) — High-Level Design

> **Difficulty:** Hard
> **Tags:** `[hld]` `[sandboxing]` `[queue]` `[isolation]` `[scheduling]`
> **Companies that ask this:** LeetCode, HackerRank, Codeforces, AtCoder, code interview platforms

---

## Beginner's Guide

### What's this in plain English?

LeetCode. You write code in a textarea. Click "Submit." Within seconds, you see "Accepted" or "Wrong Answer on test 7." The system: take your code, run it against a battery of test cases, time and memory limit it, sandbox it (you might write malicious code!), and report back. Times tens of thousands of submissions a minute during contests.

### Why solve it?

- **Real world**: LeetCode, HackerRank, Codeforces, AtCoder, internal coding interview platforms.
- **Teaches**: sandbox isolation, queue + worker pool, multi-language support, resource limits.

### Vocabulary

- **Sandbox** — isolated execution environment (Docker, gVisor, Firecracker).
- **Test case** — input + expected output.
- **Time / memory limit** — hard caps; killed if exceeded.
- **Verdict** — Accepted / Wrong Answer / Time Limit Exceeded / Runtime Error.
- **Judge** — the program that runs tests and produces a verdict.

### High-level architecture

```
User submits code → API → Queue (Kafka) → Judge workers (sandboxed)
                                                ↓
                                        Run against tests
                                                ↓
                                          Verdict → user
```

Components:
1. **Submit API** — receives code + problem; queues.
2. **Queue** — buffers under load.
3. **Judge worker** — pulls from queue; spins up a sandbox; compiles + runs.
4. **Sandbox** — strict resource caps; no network; ephemeral disk.
5. **Storage** — submission history, leaderboards.

Sandbox isolation is critical — submissions are untrusted code; one bug in isolation = exploit.

### How to read this doc

- **Beginner**: focus on the queue + sandbox model.
- **Interview**: cross-questions on contest scale, sandbox security, multi-language.

---

## 0. How to use this doc in an interview

Tests **sandboxed code execution + queue + multi-language**. Tests:
1. Untrusted code execution (sandbox is the central concern).
2. Resource limits (CPU, memory, time).
3. Queueing + scheduling for fair execution.
4. Contest mode (10000 simultaneous submissions).

---

## 1. Problem Statement

A coding problem platform:
- Users submit code in language X for problem P.
- System runs against test cases.
- Returns verdict (AC, WA, TLE, RE).
- Contest mode: high concurrency.
- Discussion / leaderboard.

---

## 2. Clarifying Questions

- [ ] Languages supported (10? 30?)?
- [ ] Compiled (C++, Rust) and interpreted?
- [ ] Custom test cases by user?
- [ ] Contest leaderboards in scope?
- [ ] Anti-cheat?

> **Assume:** 15 languages; both compiled and interpreted; custom test cases yes; contests yes; basic anti-cheat (plagiarism detection).

---

## 3. Functional Requirements

**P0:**
1. Browse problems.
2. Submit code; get verdict.
3. Sandboxed execution.
4. Resource limits (time, memory).
5. Standard verdicts (Accepted, WA, TLE, MLE, RE, CE).
6. Test history per user.

**P1:**
7. Custom test inputs.
8. Contest mode + leaderboard.
9. Discussion threads.

**P2:**
10. Code playback / debugging.
11. AI-suggested solutions.

---

## 4. Non-Functional Requirements

| Dim | Target |
|---|---|
| Avail | 99.99% |
| Verdict latency | < 10 s typical |
| Throughput | 10k submissions/min during contest |
| Sandbox security | Strict; assume submitted code is malicious |

---

## 5. Capacity Estimation

```
Active users: 10M
Submissions / day: 5M
Peak (contest start): 10k/min = 170/sec
Avg execution time: 1-5 s
Concurrent runs: 1k workers
```

---

## 6. API

```
POST /v1/submissions   body: {problem_id, language, code, test_inputs?}  -> submission_id
GET  /v1/submissions/{id}                                                -> status, verdict, runtime, output
GET  /v1/contests/{id}/leaderboard
```

---

## 7. Data Model

### Submissions (Cassandra, partitioned by user_id)
- `(user_id, ts, submission_id, problem_id, lang, code, verdict, runtime, memory)`

### Problems (Postgres)
- `(problem_id, title, description, sample_inputs, judge_inputs (S3))`
- `judge_inputs` = list of (input, expected_output).

### Queue (Kafka)
- `submissions` topic: per-language partitions for routing.

---

## 8. Architecture

```
              ┌──────────────────────┐
              │  User                │
              └──────────┬───────────┘
                         │
                ┌────────▼─────────┐
                │ Submission Svc   │
                │  - validate      │
                │  - persist       │
                │  - enqueue       │
                └────────┬─────────┘
                         │
                ┌────────▼─────────┐
                │  Kafka           │
                │  topics by lang  │
                └────────┬─────────┘
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
        ┌──────────┐         ┌──────────┐
        │ Judge    │   ...   │ Judge    │
        │ Workers  │         │ Workers  │
        │ (lang A) │         │ (lang B) │
        └────┬─────┘         └────┬─────┘
             │                    │
             ▼                    ▼
        ┌──────────────────────────────┐
        │  Sandbox (Docker/Firecracker)│
        │  - per-language base image   │
        │  - cgroup limits             │
        │  - no network                │
        └──────────────────────────────┘
                  │
                  ▼
        ┌──────────────────────┐
        │  Verdict aggregator  │
        │  - compare output    │
        │  - persist           │
        │  - notify user (WS)  │
        └──────────────────────┘
```

---

## 9. Component Deep-Dives

### 9.1 Sandbox (the critical part)
- Each submission runs in fresh sandbox.
- Tools: Docker, gVisor, Firecracker microVMs.
- Constraints:
  - No network.
  - cgroups: CPU 1 core, memory 256 MB, time limit 5s.
  - Read-only filesystem; writable /tmp small.
  - seccomp: deny dangerous syscalls.
- Timeout enforced by parent process; kill -9 if exceeded.

### 9.2 Compilation
- Compiled language: separate compile step (with its own timeout, e.g. 10s).
- If CE → return verdict.
- Cache compiled binary keyed by code hash for repeats.

### 9.3 Test cases
- Stored in S3 per problem.
- Worker downloads on demand.
- Run binary against each input; collect output.
- Compare to expected (exact or token-based).

### 9.4 Verdict types
- AC, WA, TLE, MLE, RE (runtime error), CE (compile error), Sandbox error.
- First failed test → return that verdict; remaining skipped (or run all per config).

### 9.5 Contest mode
- Pre-warm sandbox pool ahead of contest.
- Increase worker count.
- Real-time leaderboard updates.

---

## 10. Hard Sub-Problems

### 10.1 Sandbox security
- Untrusted code = adversarial.
- Defense in depth: container + seccomp + non-root user + read-only FS.
- VM-level isolation (Firecracker) for highest paranoia.

### 10.2 Reproducibility
- Same code, same input, same verdict every time.
- Pin language versions; pin OS image.
- No nondeterminism in test setup.

### 10.3 Fair scheduling under contest
- 10k submissions in 1 min.
- Per-user rate limit (1 submission / 5 sec).
- Worker pool autoscale.
- Fairness: round-robin over users (avoid one user hogging).

### 10.4 Anti-cheat (plagiarism)
- Code similarity (MOSS-like).
- Behavioral signals (time spent, edit patterns).
- Flags for review.

---

## 11. Cross-Questions ≥ 12

### 11.1 Why containers vs VMs?
- Containers (Docker, gVisor): cheaper to spin up, slower.
- VMs (Firecracker): stronger isolation; larger footprint.
- LeetCode-class: containers OK with hardening; high-stake (like AWS Lambda) uses Firecracker.

### 11.2 Why Kafka for queue?
- Durable queue; replay if worker dies.
- Per-language partitions route to specialized workers.

### 11.3 Why partition by language?
- Each worker has prebuilt language image; faster startup.
- Java workers stay warm for Java.

### 11.4 How is timeout enforced?
- Parent process sets cgroup CPU + wall-clock timer.
- SIGKILL on expiry.
- Reported as TLE.

### 11.5 How is memory enforced?
- cgroup memory limit.
- Exceeding → kernel kills; reported as MLE.

### 11.6 What about output truncation?
- Limit stdout to e.g. 10 MB.
- Beyond: kill + verdict "OLE" (output-limit-exceeded).

### 11.7 How is compile timeout different from run timeout?
- Compile: 10-30s typical.
- Run: per-test-case 1-5s.
- Both enforced separately.

### 11.8 What about flaky tests (random output)?
- Test cases must be deterministic.
- Problem authors enforce.
- Hash-based comparison if multi-line.

### 11.9 How are sandboxes recycled?
- Each submission = fresh sandbox (no state leakage).
- Pool of pre-warmed sandboxes for fast start.

### 11.10 What if a sandbox escapes?
- Defense in depth: even if container escape, host has limited privileges.
- VMs add stronger boundary.
- Detection: anomaly monitoring (worker host CPU spike with no activity).

### 11.11 What about code with malicious infinite loops?
- TLE catches with cgroup CPU time.

### 11.12 How is the leaderboard real-time?
- Submission verdicts stream into leaderboard service.
- Per-contest sorted set in Redis (ZSET) by score.
- Top-K read in O(log N).

---

## 12. Trade-offs

| Decision | Gained | Gave up |
|---|---|---|
| Container sandbox | Cheap, fast | Weaker than VM isolation |
| Per-lang queue | Worker specialization | Kafka topic count |
| Pre-warm pool | Fast start | Idle resources |
| Per-user rate limit | Fairness | Slight UX |

---

## 13. Cheat-Sheet

1. **Submission → Kafka → Judge worker.**
2. **Container sandbox** with cgroup + seccomp.
3. **Per-language workers** (warm).
4. **Compile + run** with separate timeouts.
5. **Test cases in S3**; downloaded on demand.
6. **Cassandra** for submission history.
7. **Contest mode** with pre-warmed pool + autoscaling.

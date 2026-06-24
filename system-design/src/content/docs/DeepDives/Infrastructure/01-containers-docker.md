---
title: Containers & Docker
---

# Containers & Docker — Deep Dive

> **Type:** Core technology
> **Tags:** `[infrastructure]` `[containers]` `[docker]` `[deployment]` `[isolation]`
> **Where it shows up:** The packaging/deploy layer under every modern system; prerequisite for [Kubernetes](02-kubernetes.md) and [cloud platforms](03-cloud-building-blocks.md)

---

## Mental model

A container packages an application **with everything it needs to run** — code, runtime, libraries, system tools — into a single, portable unit that runs identically on a laptop, a CI server, or production. The promise is **"build once, run anywhere"**: it eliminates "works on my machine" by shipping the environment *with* the app.

The crucial distinction interviewers want: a container is **not a virtual machine.** A VM virtualizes *hardware* and runs a full guest OS (heavyweight, slow to boot, GBs). A container virtualizes the *operating system* — all containers on a host **share the host kernel** but get isolated user-spaces (lightweight, boot in milliseconds, MBs). That difference — kernel sharing — is why containers are dense, fast, and the unit of modern deployment.

**Docker** is the tooling that made containers mainstream: a format for images, a CLI/daemon to build and run them, and a registry to share them.

## Internals

### How isolation works

A container is just a **process on the host** that the Linux kernel isolates using two primitives:

- **Namespaces** — give the process its *own view* of the system: its own process tree (PID namespace), network stack, mounts, hostname, users. It "thinks" it's alone on the machine.
- **cgroups (control groups)** — *limit and meter* what it can use: CPU, memory, I/O. This is how you cap a container to "0.5 CPU, 512 MB."

There's no hypervisor and no guest OS — just kernel-enforced isolation around a normal process. That's the whole magic, and why containers are so cheap compared to VMs.

### Images & layers

A **container image** is a read-only template; a **container** is a running instance of one. Images are built in **layers** — each instruction in a `Dockerfile` (install deps, copy code) creates a layer, and layers are **cached and shared**:

```dockerfile
FROM node:20-alpine          # base layer (shared across all your images)
WORKDIR /app
COPY package*.json ./
RUN npm ci                    # dependency layer — cached unless package.json changes
COPY . .                      # app code layer — changes most often, so it's last
CMD ["node", "server.js"]
```

- **Layer caching** is why Dockerfile *order matters*: put rarely-changing steps (deps) before frequently-changing ones (code), so a code change only rebuilds the last layer.
- Layers are content-addressed and **shared between images** — ten images on the same `node:20` base store that base once.
- **Multi-stage builds** (build in a heavy image, copy only the artifact into a tiny runtime image) keep production images small and attack-surface minimal.

### Registries

Images are pushed to and pulled from a **registry** (Docker Hub, ECR, GCR, GHCR) — the distribution mechanism. `docker push myapp:1.2` → registry; a deploy does `docker pull myapp:1.2` on each host. **Tag immutably** (a version/content hash, not just `latest`) so deploys are reproducible — the same lesson as versioned URLs in [CDN](../Caching/cdn.md).

## Tradeoffs & decisions

- **Containers vs VMs** — containers are lighter, denser, faster to start, and portable; VMs give *stronger* isolation (separate kernel) for hostile multi-tenancy or different OS kernels. Many clouds run containers *inside* VMs to get both.
- **Image size vs convenience** — a full base image is easy but bloated/insecure; slim/alpine + multi-stage builds shrink size and attack surface at some build complexity.
- **Immutability** — containers are meant to be **immutable and ephemeral**: you don't patch a running container, you build a new image and replace it. State must live *outside* (DB, [object storage](../Databases/object-blob-storage.md), volumes) — a container's local filesystem dies with it.
- **One process per container** — the convention is one concern per container (the app), composed with others (DB, cache) rather than a fat all-in-one container.

## When to use / when not

**Use containers for:**
- Packaging and deploying services consistently across dev/CI/prod — the default unit of deployment today.
- Microservices, where each service ships as its own image and scales independently.
- Reproducible builds, fast horizontal scaling (spin up identical instances behind a [load balancer](../Networking/load-balancers.md)), and as the substrate for [Kubernetes](02-kubernetes.md).

**Be cautious / reach elsewhere when:**
- You need **hard security isolation** between untrusted tenants → VMs or sandboxed runtimes (gVisor, Firecracker microVMs), not bare containers sharing a kernel.
- The workload is a **single simple app on one box** — containers add tooling overhead you may not need (though they still help reproducibility).
- You're tempted to put **state inside the container** — don't; containers are ephemeral.

## Common interview follow-ups

- *"Container vs VM?"* → containers share the host kernel (lightweight, fast, less isolation); VMs virtualize hardware with a full guest OS (heavy, strong isolation).
- *"How does isolation actually work?"* → kernel **namespaces** (what it sees) + **cgroups** (what it can use); it's an isolated host process, not a VM.
- *"Why are images layered?"* → caching + sharing; order the Dockerfile so volatile steps (code) come last to maximize cache hits.
- *"Where does state go?"* → outside the container — DB, object storage, or mounted volumes; containers are ephemeral and immutable.
- *"How do you ship a container to prod?"* → build image → push to registry (immutable tag) → orchestrator pulls and runs it (see [Kubernetes](02-kubernetes.md)).
- *"How do you keep images small/secure?"* → slim base + multi-stage builds; scan images; pin versions.

## Gotchas

- **Confusing containers with VMs** — "a lightweight VM" is wrong; no guest OS, shared kernel. Get this right.
- **State in the container** — writing data to the container filesystem loses it on restart/reschedule; externalize state.
- **`latest` tag in production** — non-reproducible deploys; pin immutable version tags.
- **Bloated images** — copying the whole build toolchain into the runtime image; use multi-stage builds.
- **Dockerfile cache misses** — putting `COPY . .` before dependency install busts the cache on every code change; order matters.
- **Assuming kernel-level isolation is a security boundary** for untrusted code — it's weaker than a VM; use stronger sandboxing for hostile multi-tenancy.
- **Running many processes in one container** — breaks the lifecycle/health model; one concern per container.

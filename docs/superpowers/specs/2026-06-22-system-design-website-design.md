# System Design Knowledge Base — Website Design

**Date:** 2026-06-22
**Status:** Approved

## Goal

Turn the existing `docs/` knowledge base (163 markdown files) into a beautiful,
browsable static website built on the **existing Astro project** (kept and renamed
`system-design`), deployed to GitHub Pages. No new framework (Starlight was offered
and declined — we build on the current Astro blog scaffold).

## Locked decisions

- **Framework:** existing Astro scaffold (`extinct-equinox`), not Starlight.
- **Location:** subfolder `system-design/` (renamed from `extinct-equinox`).
- **Deploy:** GitHub Pages — `site: https://saurabh17a.github.io`, `base: /System-Design-Fundamentals`.
- **Remove demo blog** content/routes — the site *is* the knowledge base.
- **Include Pagefind** static search.
- **Keep base path** `/System-Design-Fundamentals`.

## Content inventory (163 `.md` files)

| Section | Files |
|---|---|
| Foundations · Programming (Python 12 + Go 12) | 24 |
| Foundations · OOP (four-pillars) + SOLID (5) | 6 |
| Foundations · Design Patterns | 8 |
| Foundations · Roadmap | 1 |
| LLD (Python 25 + Go 25) | 50 |
| Machine Coding (Python 18 + Go 18) | 36 |
| HLD (system design) | 37 |
| Index | 1 |

**Format note:** docs have **no YAML frontmatter**. Each starts with an `# H1`
followed by a `> **Difficulty:** …` blockquote. Internal references use relative
`.md` links, e.g. `[go](LLD/Go/parking-lot.md)`.

## Architecture

### 1. Rename & project layout
- `extinct-equinox/` → `system-design/`; update `package.json` `name` and README.
- Fold the orphan root `astro.config.mjs`'s `site`/`base` into the subfolder config,
  then delete the root orphan. Drop the unused root Tailwind config (scaffold uses
  its own `global.css`).

### 2. Content collection
- Move `docs/*` → `system-design/src/content/docs/`, preserving the directory tree.
- Define a `docs` collection in `content.config.ts` with a **permissive schema**
  (all metadata optional) since files lack frontmatter.
- Derive `title` from the H1 and `section`/`category` from the file path.
- The Difficulty/Tags blockquote stays in-body and renders as-is.
- Remove the demo `blog` posts and routes.

### 3. Routing & pages
- `src/pages/[...slug].astro` — catch-all rendering any doc at a clean URL
  (`/hld/url-shortener`, `/lld/go/parking-lot`). Slugs lowercased from paths.
- `src/pages/index.astro` — landing page (hero + tier-organized category grid)
  **generated from the collection** so it never drifts from content.

### 4. Navigation & look
- Persistent **collapsible left sidebar**: Tier → Category
  (Foundations · SOLID · Patterns · LLD · Machine Coding · HLD), Python/Go
  sub-grouping where relevant, current-page highlight.
- **Doc layout** adapted from `BlogPost.astro`: readable column, sticky sidebar,
  breadcrumb, auto "On this page" TOC from headings, prev/next links. Reuses existing
  typography and light/dark. Mobile: sidebar collapses to a menu.
- Code blocks: Astro's built-in Shiki highlighting (already enabled), themed.

### 5. Internal link handling
- A small **remark plugin** rewrites relative `*.md` links to site routes at build
  time (strip `.md`, lowercase, resolve relative to the source file, respect `base`).
  Avoids hand-editing 163 files.

### 6. Search
- **Pagefind** static client-side search indexing the built site; search box in header.

### 7. Deployment
- Set `site`/`base` in `system-design/astro.config.mjs`.
- Update `.github/workflows/deploy.yml` to build from `system-design/` (and run the
  Pagefind index step after `astro build`).

## Out of scope (YAGNI)

- Comments, auth, CMS, i18n.
- Editing the *content* of the 163 docs (only build-time link rewriting).

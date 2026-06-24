import { getCollection } from 'astro:content';

export type Difficulty = 'easy' | 'medium' | 'hard';

/** A topic tag or company, with a display label and a URL-safe slug. */
export interface Tag {
	label: string;
	slug: string;
}

export interface DocEntry {
	/** Lowercased path without extension, e.g. `hld/url-shortener`. */
	id: string;
	/** Path segments, e.g. `['hld', 'url-shortener']`. */
	segments: string[];
	/** Short sidebar label derived from the file name. */
	label: string;
	/** SEO description derived from section + label. */
	description: string;
	/**
	 * Difficulty levels parsed from the page's `> **Difficulty:** …` line.
	 * A range like "Medium → Hard" yields `['medium','hard']`. Empty for
	 * reference/guide pages (Deep Dives, Methodology) that aren't rated.
	 */
	difficulty: Difficulty[];
	/** Topic tags — parsed from the `**Tags:**` line, or derived from the path. */
	tags: Tag[];
	/** Companies that ask this — parsed from the `**Companies …:**` line (problem docs only). */
	companies: Tag[];
	/** Page kind from a `**Type:**` line (e.g. "Core technology", "Guide"). */
	type?: string;
}

export interface NavGroup {
	key: string;
	label: string;
	docs: DocEntry[];
	groups: NavGroup[];
}

// BASE_URL may or may not carry a trailing slash depending on config; normalize to
// no trailing slash and join safely so we never emit `…Fundamentalsfoo`.
const BASE = import.meta.env.BASE_URL.replace(/\/+$/, '');

/** Join a path onto the site base, always slash-separated. `withBase('')` is the home URL. */
export function withBase(path = ''): string {
	return `${BASE}/${path.replace(/^\/+/, '')}`;
}

/** Site route for a doc id, e.g. `/base/hld/url-shortener/`. */
export function docHref(id: string): string {
	return `${withBase(id)}/`;
}

const ACRONYMS = new Set([
	'hld', 'lld', 'oop', 'solid', 'api', 'url', 'db', 'kv', 'lru', 'lfu', 'id', 'ui',
	'fb', 'ip', 'os', 'json', 'http', 'sql', 'cdn', 'ot', 'crdt', 'dns', 'tcp', 'udp',
	'qps', 'rwlock', 'atm', 'srp', 'ocp', 'lsp', 'isp', 'dip',
]);

/**
 * Per-section presentation metadata (emoji + one-line blurb), keyed by the
 * top-level directory key. Used by the home-page cards and the sidebar section
 * headers so the two stay in sync.
 */
export const SECTION_META: Record<string, { emoji: string; blurb: string }> = {
	methodology: {
		emoji: '🧭',
		blurb: 'How to think about system design — the interview framework, scoping and estimation, and what separates a good system from one that merely works.',
	},
	foundations: {
		emoji: '🧱',
		blurb: 'Programming in Python & Go, the four pillars of OOP, SOLID principles, and the core design patterns.',
	},
	lld: {
		emoji: '🧩',
		blurb: 'Object-oriented design problems — each classic worked in both Python and Go.',
	},
	machinecoding: {
		emoji: '⚙️',
		blurb: 'Data structures and concurrency primitives implemented from scratch.',
	},
	hld: {
		emoji: '🏛️',
		blurb: 'End-to-end, interview-grade system designs — from URL shorteners to payment systems.',
	},
	deepdives: {
		emoji: '🔬',
		blurb: 'The core technologies and distributed-systems concepts behind every design — Kafka, Redis, SQL, caching, consistency, sharding, resiliency, and more.',
	},
};

/** Fallback presentation used for any section not listed in SECTION_META. */
export const DEFAULT_SECTION_META = { emoji: '📄', blurb: '' };

const DIR_LABELS: Record<string, string> = {
	foundations: 'Foundations',
	programming: 'Programming',
	python: 'Python',
	go: 'Go',
	oop: 'OOP',
	solid: 'SOLID Principles',
	designpatterns: 'Design Patterns',
	hld: 'High-Level Design',
	lld: 'Low-Level Design',
	machinecoding: 'Machine Coding',
	methodology: 'Methodology',
	deepdives: 'Deep Dives',
	databases: 'Databases',
	caching: 'Caching',
	messaging: 'Messaging',
	coordination: 'Coordination',
	distribution: 'Distribution',
	resiliency: 'Resiliency',
	bigdata: 'Big Data',
	search: 'Search',
	networking: 'Networking',
	infrastructure: 'Infrastructure & Ops',
};

// Display order for known directory/section keys (lower = earlier). Keys are unique
// enough across nesting levels that one flat map suffices.
const ORDER: Record<string, number> = {
	methodology: -1, foundations: 0, lld: 1, machinecoding: 2, hld: 3, deepdives: 4, // tiers (top level)
	programming: 0, designpatterns: 2, roadmap: 3, // under Foundations (oop handled below)
	python: 0, // languages: Python before Go
	// Deep Dives subgroups (curriculum order)
	databases: 0, caching: 1, messaging: 2, coordination: 3, distribution: 4,
	resiliency: 5, bigdata: 6, search: 7, networking: 8, infrastructure: 9,
};

// Matches the house-style difficulty line, e.g. `> **Difficulty:** Medium → Hard`.
const DIFFICULTY_RE = /^\s*>?\s*\*\*\s*Difficulty\s*:?\s*\*\*\s*(.+)$/im;

/**
 * Parse difficulty levels from a page body. A range ("Easy → Medium",
 * "Medium → Hard") yields every level it spans. Returns [] when the page has
 * no difficulty line (reference/guide pages).
 */
export function parseDifficulty(body?: string): Difficulty[] {
	if (!body) return [];
	const match = body.match(DIFFICULTY_RE);
	if (!match) return [];
	const text = match[1].toLowerCase();
	const levels: Difficulty[] = [];
	if (text.includes('easy')) levels.push('easy');
	if (text.includes('medium')) levels.push('medium');
	if (text.includes('hard')) levels.push('hard');
	return levels;
}

/** URL-safe slug: lowercase, non-alphanumerics collapsed to single dashes. */
export function slugify(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

const TAGS_RE = /^\s*>?\s*\*\*\s*Tags\s*:?\s*\*\*\s*(.+)$/im;
const COMPANIES_RE = /^\s*>?\s*\*\*\s*Companies(?:\s+that\s+ask\s+this)?\s*:?\s*\*\*\s*(.+)$/im;
const TYPE_RE = /^\s*>?\s*\*\*\s*Type\s*:?\s*\*\*\s*(.+)$/im;

function dedupeBySlug(tags: Tag[]): Tag[] {
	const seen = new Set<string>();
	return tags.filter((t) => t.slug && !seen.has(t.slug) && seen.add(t.slug));
}

/** Parse topic tags from a `**Tags:** \`[a]\` \`[b]\`` line into `[a]`, `[b]`. */
function parseTags(body?: string): Tag[] {
	const line = body?.match(TAGS_RE)?.[1];
	if (!line) return [];
	const tokens = [...line.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim());
	return dedupeBySlug(tokens.map((t) => ({ label: t.toLowerCase(), slug: slugify(t) })));
}

/**
 * Parse the comma-separated companies line. Drops prose tokens ("every
 * customer-facing product") and strips parentheticals ("Meta (FB)" → "Meta").
 */
function parseCompanies(body?: string): Tag[] {
	const line = body?.match(COMPANIES_RE)?.[1];
	if (!line) return [];
	const parts = line
		.split(',')
		.map((p) => p.replace(/\(.*?\)/g, '').trim())
		.filter(Boolean)
		// Real company names start with an uppercase letter; drop generic prose.
		.filter((p) => /^[A-Z0-9]/.test(p) && !/\b(every|interview|product|companies|teams?)\b/i.test(p));
	return dedupeBySlug(parts.map((p) => ({ label: p, slug: slugify(p) })));
}

function parseType(body?: string): string | undefined {
	const line = body?.match(TYPE_RE)?.[1];
	return line ? line.replace(/[`*]/g, '').trim() : undefined;
}

// Path segments that make poor tags (too generic / language-track folders kept).
const TAG_FROM_DIR: Record<string, string> = {
	designpatterns: 'design-patterns',
	machinecoding: 'machine-coding',
	oop: 'oop',
	solid: 'solid',
};

/**
 * Fallback tags for pages without an explicit `**Tags:**` line (Methodology,
 * Foundations): derive from the directory segments so every doc is tagged.
 */
function deriveTags(segments: string[]): Tag[] {
	const dirs = segments.slice(0, -1); // drop the file segment
	const labels = dirs.map((d) => TAG_FROM_DIR[d] ?? d).filter(Boolean);
	return dedupeBySlug(labels.map((l) => ({ label: l.toLowerCase(), slug: slugify(l) })));
}

export function prettifyLabel(name: string): string {
	const withoutNumber = name.replace(/^\d+[-_]/, '');
	return withoutNumber
		.split(/[-_]/)
		.filter(Boolean)
		.map((word) =>
			ACRONYMS.has(word.toLowerCase())
				? word.toUpperCase()
				: word.charAt(0).toUpperCase() + word.slice(1),
		)
		.join(' ');
}

export function prettifyDir(key: string): string {
	return DIR_LABELS[key] ?? prettifyLabel(key);
}

function numericPrefix(file: string): number | null {
	const match = file.match(/^(\d+)[-_]/);
	return match ? Number(match[1]) : null;
}

function compareDocs(a: DocEntry, b: DocEntry): number {
	const fa = a.segments[a.segments.length - 1];
	const fb = b.segments[b.segments.length - 1];
	const na = numericPrefix(fa);
	const nb = numericPrefix(fb);
	if (na !== null && nb !== null) return na - nb;
	if (na !== null) return -1;
	if (nb !== null) return 1;
	return a.label.localeCompare(b.label);
}

function compareGroups(a: NavGroup, b: NavGroup): number {
	const oa = ORDER[a.key] ?? 99;
	const ob = ORDER[b.key] ?? 99;
	if (oa !== ob) return oa - ob;
	return a.label.localeCompare(b.label);
}

function buildGroups(docs: DocEntry[], depth: number): { docs: DocEntry[]; groups: NavGroup[] } {
	const here: DocEntry[] = [];
	const byDir = new Map<string, DocEntry[]>();

	for (const doc of docs) {
		if (doc.segments.length === depth + 1) {
			here.push(doc);
		} else {
			const key = doc.segments[depth];
			if (!byDir.has(key)) byDir.set(key, []);
			byDir.get(key)!.push(doc);
		}
	}

	const groups: NavGroup[] = [];
	for (const [key, list] of byDir) {
		const sub = buildGroups(list, depth + 1);
		groups.push({ key, label: prettifyDir(key), docs: sub.docs, groups: sub.groups });
	}

	groups.sort(compareGroups);
	here.sort(compareDocs);
	return { docs: here, groups };
}

/** Depth-first flatten matching the rendered sidebar order (subgroups, then docs). */
function flatten(group: { docs: DocEntry[]; groups: NavGroup[] }): DocEntry[] {
	const out: DocEntry[] = [];
	for (const sub of group.groups) out.push(...flatten(sub));
	out.push(...group.docs);
	return out;
}

let cache: { groups: NavGroup[]; ordered: DocEntry[] } | null = null;

/** Build the navigation tree and a flat ordered list (cached per build). */
export async function getNav(): Promise<{ groups: NavGroup[]; ordered: DocEntry[] }> {
	if (cache) return cache;

	const entries = await getCollection('docs');
	const docs: DocEntry[] = entries.map((entry) => {
		const segments = entry.id.split('/');
		const file = segments[segments.length - 1];
		const label = entry.data.title ?? prettifyLabel(file);
		const section = segments.length > 1 ? prettifyDir(segments[0]) : 'Docs';
		const explicitTags = parseTags(entry.body);
		return {
			id: entry.id,
			segments,
			label,
			description: entry.data.description ?? `${label} — ${section}.`,
			difficulty: parseDifficulty(entry.body),
			tags: explicitTags.length ? explicitTags : deriveTags(segments),
			companies: parseCompanies(entry.body),
			type: parseType(entry.body),
		};
	});

	const root = buildGroups(docs, 0);
	cache = { groups: root.groups, ordered: flatten(root) };
	return cache;
}

/** Whether a nav group contains the given doc id anywhere in its subtree. */
export function groupContainsId(group: NavGroup, id: string): boolean {
	if (group.docs.some((doc) => doc.id === id)) return true;
	return group.groups.some((sub) => groupContainsId(sub, id));
}

/** Breadcrumb trail for a doc: section labels + the page label. */
export function breadcrumbs(doc: DocEntry): string[] {
	const dirs = doc.segments.slice(0, -1).map(prettifyDir);
	return [...dirs, doc.label];
}

/** Site route for a topic-tag browse page, e.g. `/base/tags/caching/`. */
export function tagHref(slug: string): string {
	return `${withBase(`tags/${slug}`)}/`;
}

/** Site route for a company browse page, e.g. `/base/companies/uber/`. */
export function companyHref(slug: string): string {
	return `${withBase(`companies/${slug}`)}/`;
}

export interface TagGroup {
	slug: string;
	label: string;
	docs: DocEntry[];
}

function buildIndex(pick: (d: DocEntry) => Tag[], docs: DocEntry[]): TagGroup[] {
	const map = new Map<string, TagGroup>();
	for (const doc of docs) {
		for (const t of pick(doc)) {
			let g = map.get(t.slug);
			if (!g) map.set(t.slug, (g = { slug: t.slug, label: t.label, docs: [] }));
			// Prefer the longest display label seen for this slug (most complete).
			if (t.label.length > g.label.length) g.label = t.label;
			g.docs.push(doc);
		}
	}
	return [...map.values()].sort(
		(a, b) => b.docs.length - a.docs.length || a.label.localeCompare(b.label),
	);
}

/** All topic tags across the corpus, each with its docs, sorted by frequency. */
export async function getTagIndex(): Promise<TagGroup[]> {
	const { ordered } = await getNav();
	return buildIndex((d) => d.tags, ordered);
}

/** All companies across the corpus, each with its docs, sorted by frequency. */
export async function getCompanyIndex(): Promise<TagGroup[]> {
	const { ordered } = await getNav();
	return buildIndex((d) => d.companies, ordered);
}

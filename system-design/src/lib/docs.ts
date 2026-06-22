import { getCollection } from 'astro:content';

export interface DocEntry {
	/** Lowercased path without extension, e.g. `hld/url-shortener`. */
	id: string;
	/** Path segments, e.g. `['hld', 'url-shortener']`. */
	segments: string[];
	/** Short sidebar label derived from the file name. */
	label: string;
	/** SEO description derived from section + label. */
	description: string;
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
};

// Display order for known directory/section keys (lower = earlier). Keys are unique
// enough across nesting levels that one flat map suffices.
const ORDER: Record<string, number> = {
	foundations: 0, lld: 1, machinecoding: 2, hld: 3, // tiers (top level)
	programming: 0, designpatterns: 2, roadmap: 3, // under Foundations (oop handled below)
	python: 0, // languages: Python before Go
};

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
		return {
			id: entry.id,
			segments,
			label,
			description: entry.data.description ?? `${label} — ${section}.`,
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

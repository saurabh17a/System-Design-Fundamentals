import path from 'node:path';

const CONTENT_ROOT = path.join('src', 'content', 'docs');

/**
 * Rehype plugin that rewrites relative links to other `.md` docs into clean site
 * routes. The source knowledge base cross-links files with paths like
 * `LLD/Go/parking-lot.md` or `../message-queue.md`; this resolves them against the
 * current file, strips `.md`, lowercases, and prefixes the configured base path so
 * they match the IDs produced by the `docs` content collection.
 *
 * External links (http/mailto), in-page anchors (#…) and already-absolute links are
 * left untouched.
 *
 * @param {{ base?: string }} options
 */
export function rewriteMdLinks({ base = '' } = {}) {
	const baseClean = base.replace(/\/$/, '');

	return (tree, file) => {
		const filePath = file.path || (file.history && file.history[file.history.length - 1]);
		if (!filePath) return;

		// Path of the current doc relative to the content root, e.g. `HLD/url-shortener.md`.
		const rel = path.relative(path.join(file.cwd, CONTENT_ROOT), filePath);
		const dir = path.dirname(rel).split(path.sep).join('/'); // e.g. `HLD`

		visit(tree, (node) => {
			if (node.type !== 'element' || node.tagName !== 'a') return;
			const href = node.properties && node.properties.href;
			if (typeof href !== 'string') return;
			if (/^(?:[a-z]+:|\/\/|#|\/)/i.test(href)) return; // external / absolute / anchor

			const [target, anchor] = href.split('#');
			if (!/\.md$/i.test(target)) return;

			const baseDir = dir === '.' ? '' : dir;
			let resolved = path.posix.normalize(path.posix.join(baseDir, target));
			resolved = resolved.replace(/\.md$/i, '').toLowerCase();

			let newHref = `${baseClean}/${resolved}/`;
			if (anchor) newHref += `#${anchor}`;
			node.properties.href = newHref;
		});
	};
}

function visit(node, fn) {
	fn(node);
	if (node.children) {
		for (const child of node.children) visit(child, fn);
	}
}

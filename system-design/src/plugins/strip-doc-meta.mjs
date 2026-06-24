/**
 * Remark plugin that removes the legacy text-based metadata header from each
 * doc so it can be re-rendered as a styled component (see DocMeta.astro).
 *
 * Every source doc opens with:
 *
 *     # Title
 *     > **Difficulty:** … **Tags:** … **Companies that ask this:** …   (one blockquote)
 *     ---
 *
 * (Deep Dives use `**Type:** / **Where it shows up:**`; Methodology uses
 * `**Type:** / **Read this:**`.) This strips the leading H1 — the title is
 * re-rendered by the layout from the parsed metadata — plus the meta blockquote
 * and the `---` rule that follows it. The parsed values come from
 * `src/lib/docs.ts`; this plugin only deletes the now-redundant source nodes.
 *
 * Only the FIRST matching blockquote within the first few top-level nodes is
 * touched, so genuine callout blockquotes deeper in the body are left alone.
 */
// Matches the parsed AST text — remark has already turned `**Difficulty**` into a
// strong node, so the text node reads "Difficulty:" with no asterisks. Anchored at
// the start so only the leading meta blockquote matches, never a body callout.
const META_RE =
	/^(Difficulty|Tags|Type|Companies|Where it shows up|Read this|Prep time)\b/i;

function nodeText(node) {
	if (typeof node.value === 'string') return node.value;
	if (node.children) return node.children.map(nodeText).join(' ');
	return '';
}

export function stripDocMeta() {
	return (tree) => {
		const children = tree.children;
		if (!Array.isArray(children) || children.length === 0) return;

		// 1) Drop the leading H1 (re-rendered as the page title by the layout).
		if (children[0].type === 'heading' && children[0].depth === 1) {
			children.shift();
		}

		// 2) Remove the first meta blockquote in the opening nodes + a trailing rule.
		const limit = Math.min(children.length, 4);
		for (let i = 0; i < limit; i++) {
			const node = children[i];
			if (node.type === 'blockquote' && META_RE.test(nodeText(node).trimStart())) {
				const next = children[i + 1];
				const count = next && next.type === 'thematicBreak' ? 2 : 1;
				children.splice(i, count);
				break;
			}
		}
	};
}

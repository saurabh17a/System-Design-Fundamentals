import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Knowledge-base docs. The source markdown has no frontmatter, so every field is
// optional — title/section are derived from the file path (see src/lib/docs.ts).
// IDs are the lowercased path without extension, e.g. `hld/url-shortener`.
const docs = defineCollection({
	loader: glob({
		base: './src/content/docs',
		pattern: '**/*.md',
		generateId: ({ entry }) => entry.replace(/\.md$/i, '').toLowerCase(),
	}),
	schema: z.object({
		title: z.string().optional(),
		description: z.string().optional(),
	}),
});

export const collections = { docs };

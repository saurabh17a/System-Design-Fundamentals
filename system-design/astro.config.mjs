// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';

import { rewriteMdLinks } from './src/plugins/rewrite-md-links.mjs';

// GitHub Pages project site. `base` must match the repo name.
const base = '/System-Design-Fundamentals';

// https://astro.build/config
export default defineConfig({
	site: 'https://saurabh17a.github.io',
	base,
	integrations: [mdx(), sitemap()],
	markdown: {
		shikiConfig: { theme: 'one-dark-pro', wrap: false },
		// Rewrite relative `*.md` cross-links in the knowledge base to site routes.
		rehypePlugins: [[rewriteMdLinks, { base }]],
	},
	fonts: [
		{
			provider: fontProviders.local(),
			name: 'Atkinson',
			cssVariable: '--font-atkinson',
			fallbacks: ['sans-serif'],
			options: {
				variants: [
					{
						src: ['./src/assets/fonts/atkinson-regular.woff'],
						weight: 400,
						style: 'normal',
						display: 'swap',
					},
					{
						src: ['./src/assets/fonts/atkinson-bold.woff'],
						weight: 700,
						style: 'normal',
						display: 'swap',
					},
				],
			},
		},
	],
});

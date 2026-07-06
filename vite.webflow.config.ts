// vite.webflow.config.ts — standalone minified IIFE bundle for Webflow Custom Code Embed.
// Produces a single self-contained browser global (window.SteadyGray) with no module loader,
// no React, and no external dependencies — droppable into a Webflow embed via one <script> tag.
import { defineConfig } from 'vite'

export default defineConfig({
	build: {
		// Do not wipe dist/ — the library build (vite.config.ts) writes index.js/.cjs there too.
		emptyOutDir: false,
		lib: {
			entry: 'src/webflow/embed.ts',
			formats: ['iife'],
			// Exposes the module's exports (init, refit, destroy) as window.SteadyGray.
			name: 'SteadyGray',
			fileName: () => 'steadygray.webflow.min.js',
		},
		rollupOptions: {
			// The core's optional `import()`s for glyph-path density, syllable complexity, and
			// canvas line detection must not be inlined — the embed never enables those modes by
			// default, and bundling opentype.js / syllable / pretext adds tens of kB of dead weight.
			// Kept external: the runtime import() rejects harmlessly and the core falls back.
			external: ['opentype.js', 'syllable', '@chenglou/pretext'],
		},
		minify: true,
	},
})

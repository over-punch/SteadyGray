import Demo from "@/components/Demo"
import CopyInstall from "@/components/CopyInstall"
import CodeBlock from "@/components/CodeBlock"
import ToolDirectory from "@/components/ToolDirectory"
import { version } from "../../../package.json"
import { version as siteVersion } from "../../package.json"
import SiteFooter from "../components/SiteFooter"
import PortsSection from "../components/PortsSection"
import { MagnetChar } from "@liiift-studio/magnettype"

export default function Home() {
	return (
		<main className="flex flex-col items-center px-6 py-20 gap-24">

			{/* Hero */}
			<section className="w-full max-w-2xl lg:max-w-5xl flex flex-col gap-6">
				<div className="flex flex-col gap-2">
					<p className="text-xs uppercase tracking-[0.18em] font-medium text-muted">steadygray</p>
					<h1 className="text-4xl lg:text-8xl xl:text-9xl" style={{ fontFamily: "var(--font-merriweather), serif", fontVariationSettings: '"wght" 300, "opsz" 144', lineHeight: "1.05em" }}>
						<MagnetChar as="span" minWeight={300} maxWeight={800} spreadRadius={220} fixedAxes={{ opsz: 144 }}>Even colour,</MagnetChar><br />
						<MagnetChar as="span" minWeight={300} maxWeight={800} spreadRadius={220} fixedAxes={{ opsz: 144 }} style={{ color: "var(--foreground-subtle)", fontStyle: "italic" }}>line by line.</MagnetChar>
					</h1>
				</div>
				<div className="flex items-center gap-4">
					<CopyInstall />
					<a href="https://github.com/Liiift-Studio/SteadyGray" target="_blank" rel="noopener noreferrer" aria-label="SteadyGray on GitHub (opens in new tab)" className="text-sm text-muted hover:text-foreground transition-colors">GitHub ↗</a>
				</div>
				<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted tracking-wide">
					<span>TypeScript</span><span aria-hidden="true">·</span><span>Canvas pixel sampling</span><span aria-hidden="true">·</span><span>React + Vanilla JS</span>
				</div>
				<p className="text-base leading-relaxed max-w-lg">
					Compositors call it colour — the aggregate grey of a text block. When some lines are denser than others, the paragraph looks uneven. Gray Value measures ink pixel density per line using Canvas and adjusts letter-spacing until the paragraph has even colour throughout.
				</p>
			</section>

			{/* Demo */}
			<section className="w-full max-w-2xl lg:max-w-5xl flex flex-col gap-4">
				<h2 className="text-xs uppercase tracking-[0.18em] font-medium text-muted">Live demo</h2>
				<div className="rounded-xl -mx-8 px-8 py-8" style={{ background: "var(--panel)", overflow: 'visible' }}>
					<Demo />
				</div>
			</section>

			{/* Explanation */}
			<section className="w-full max-w-2xl lg:max-w-5xl flex flex-col gap-6">
				<h2 className="text-xs uppercase tracking-[0.18em] font-medium text-muted">How it works</h2>
				<div className="prose-grid grid grid-cols-1 sm:grid-cols-2 gap-12 text-sm leading-relaxed">
					<div className="flex flex-col gap-3">
						<p className="font-semibold text-foreground text-base">Canvas pixel sampling</p>
						<p>Each line of text is rendered to an off-screen Canvas at the correct font size and weight. The pixel data is read and ink pixels are counted. The ratio of ink to total pixels gives the line&rsquo;s optical density.</p>
					</div>
					<div className="flex flex-col gap-3">
						<p className="font-semibold text-foreground text-base">Per-line spacing correction</p>
						<p>The average density across all lines becomes the target. Each line gets a letter-spacing adjustment proportional to its deviation from the target, clamped to the maxAdjustment limit. The correction is re-run on resize.</p>
					</div>
				</div>
			</section>

			{/* Usage */}
			<section className="w-full max-w-2xl lg:max-w-5xl flex flex-col gap-6">
				<div className="flex items-baseline gap-4">
					<h2 className="text-xs uppercase tracking-[0.18em] font-medium text-muted">Usage</h2>
				</div>
				<div className="flex flex-col gap-8 text-sm">
					<div className="flex flex-col gap-3">
						<p className="text-muted">Drop-in component</p>
						<CodeBlock code={`import { GrayValueText } from '@liiift-studio/steadygray'

<GrayValueText maxAdjustment={0.05} calibrationFactor={2}>
  Your paragraph text here...
</GrayValueText>`} />
					</div>
					<div className="flex flex-col gap-3">
						<p className="text-muted">Hook</p>
						<CodeBlock code={`import { useGrayValue } from '@liiift-studio/steadygray'

const ref = useGrayValue({ maxAdjustment: 0.05, calibrationFactor: 2 })
<p ref={ref}>{children}</p>`} />
					</div>
					<div className="flex flex-col gap-3">
						<p className="text-muted">Vanilla JS</p>
						<CodeBlock code={`import { applyGrayValue, removeGrayValue, getCleanHTML } from '@liiift-studio/steadygray'

const el = document.querySelector('p')
// Call getCleanHTML BEFORE the first applyGrayValue — it strips injected spans,
// so calling it on the clean element captures the true original markup.
const original = getCleanHTML(el)
applyGrayValue(el, original, { maxAdjustment: 0.05, calibrationFactor: 2 })

// Later — restore original:
removeGrayValue(el, original)`} />
					</div>
					<div className="flex flex-col gap-3">
						<p className="text-muted">Options</p>
						<table className="w-full text-xs" aria-label="steadyGray API options">
							<caption className="sr-only">steadyGray API options reference</caption>
							<thead><tr className="text-subtle text-left"><th className="pb-2 pr-6 font-normal">Option</th><th className="pb-2 pr-6 font-normal">Default</th><th className="pb-2 font-normal">Description</th></tr></thead>
							<tbody className="text-muted zebra-bleed">
								<tr className="hover:bg-foreground/5 transition-colors"><td className="py-2 pr-6 font-mono">targetDensity</td><td className="py-2 pr-6">&apos;auto&apos;</td><td className="py-2">Target density ratio (0–1). &apos;auto&apos; uses the average of all lines.</td></tr>
								<tr className="hover:bg-foreground/5 transition-colors"><td className="py-2 pr-6 font-mono">densityMode</td><td className="py-2 pr-6">&apos;canvas&apos;</td><td className="py-2">&apos;canvas&apos; renders each line off-screen and counts ink pixels. &apos;glyph-path&apos; uses opentype.js to compute true glyph area via bezier paths — font-exact but requires opentype.js and a CORS-accessible font URL. Falls back silently to &apos;canvas&apos; if opentype.js is not installed or the font cannot be loaded.</td></tr>
								<tr className="hover:bg-foreground/5 transition-colors"><td className="py-2 pr-6 font-mono">fontUrl</td><td className="py-2 pr-6">—</td><td className="py-2">URL of the font file for glyph-path measurement. Required when densityMode is &apos;glyph-path&apos;. Must be same-origin or CORS-enabled.</td></tr>
								<tr className="hover:bg-foreground/5 transition-colors"><td className="py-2 pr-6 font-mono">method</td><td className="py-2 pr-6">&apos;letter-spacing&apos;</td><td className="py-2">CSS property to adjust per line: &apos;letter-spacing&apos;, &apos;word-spacing&apos;, &apos;font-weight&apos;, or &apos;font-width&apos;.</td></tr>
								<tr className="hover:bg-foreground/5 transition-colors"><td className="py-2 pr-6 font-mono">maxAdjustment</td><td className="py-2 pr-6">0.05</td><td className="py-2">Max correction magnitude in em units (letter/word-spacing), weight units (font-weight), or wdth units (font-width).</td></tr>
								<tr className="hover:bg-foreground/5 transition-colors"><td className="py-2 pr-6 font-mono">tolerance</td><td className="py-2 pr-6">0.01</td><td className="py-2">Minimum density difference required before a correction is applied. Lines within this threshold of the target are left untouched.</td></tr>
								<tr className="hover:bg-foreground/5 transition-colors"><td className="py-2 pr-6 font-mono">calibrationFactor</td><td className="py-2 pr-6">2.0</td><td className="py-2">Strength of the correction — correction magnitude per 1.0 density unit difference. Higher = more aggressive.</td></tr>
								<tr className="hover:bg-foreground/5 transition-colors"><td className="py-2 pr-6 font-mono">lineDetection</td><td className="py-2 pr-6">&apos;bcr&apos;</td><td className="py-2">&apos;bcr&apos; reads actual browser layout — ground truth, works with any font and inline HTML. &apos;canvas&apos; uses <a href="https://github.com/chenglou/pretext" className="underline opacity-70">@chenglou/pretext</a> for arithmetic line breaking with no forced reflow on resize. Install pretext separately. Note: avoid &apos;canvas&apos; with <code className="font-mono text-xs opacity-90">system-ui</code> — canvas resolves system fonts differently on macOS and will produce incorrect line breaks.</td></tr>
								<tr className="hover:bg-foreground/5 transition-colors"><td className="py-2 pr-6 font-mono">linePreservation</td><td className="py-2 pr-6">&apos;none&apos;</td><td className="py-2">&apos;none&apos; — line widths vary with the correction. &apos;scale&apos; — applies a scaleX transform after correction so lines never overflow the container.</td></tr>
								<tr className="hover:bg-foreground/5 transition-colors"><td className="py-2 pr-6 font-mono">mode</td><td className="py-2 pr-6">&apos;equalize&apos;</td><td className="py-2">&apos;equalize&apos; brings all lines toward the same optical density. &apos;readability&apos; weights complex lines (long words / high syllable count) toward a slightly higher spacing target.</td></tr>
								<tr className="hover:bg-foreground/5 transition-colors"><td className="py-2 pr-6 font-mono">complexity</td><td className="py-2 pr-6">&apos;word-length&apos;</td><td className="py-2">Complexity metric used in readability mode: &apos;word-length&apos; (avg chars/word, no deps), &apos;syllable&apos; (requires npm install syllable), or &apos;pos&apos; (part-of-speech weighting, falls back to &apos;word-length&apos; if the pos tagger is unavailable).</td></tr>
								<tr className="hover:bg-foreground/5 transition-colors"><td className="py-2 pr-6 font-mono">strength</td><td className="py-2 pr-6">0.5</td><td className="py-2">How aggressively to weight complex lines in readability mode. Range 0–1. At 0: same as equalize mode.</td></tr>
								<tr className="hover:bg-foreground/5 transition-colors"><td className="py-2 pr-6 font-mono">active</td><td className="py-2 pr-6">true</td><td className="py-2">Set false to skip the correction entirely and restore the element to its original HTML.</td></tr>
							</tbody>
						</table>
					</div>
				<div className="flex flex-col gap-3">
					<p className="text-muted">Additional exports</p>
					<CodeBlock code={`import { measureLineDensity, GRAY_VALUE_CLASSES } from '@liiift-studio/steadygray'

// Sample ink density of a single line element directly:
const density = measureLineDensity(lineEl, { densityMode: 'canvas' })

// CSS class names injected into the DOM — useful for custom styling or selectors:
// GRAY_VALUE_CLASSES.word   → 'gv-word'  (per-word span)
// GRAY_VALUE_CLASSES.line   → 'gv-line'  (per-line wrapper span)
// GRAY_VALUE_CLASSES.probe  → 'gv-probe' (measurement probe span)
console.log(GRAY_VALUE_CLASSES)`} />
				</div>
				<div className="flex flex-col gap-3">
					<p className="text-muted">Accessibility &amp; display compatibility</p>
					<p className="text-sm leading-relaxed">
						steadyGray skips the canvas measurement and spacing correction on e-ink and other slow-refresh displays (Kindle, reMarkable, etc.) via a <code className="font-mono text-xs opacity-90">(update: slow)</code> <code className="font-mono text-xs opacity-90">matchMedia</code> guard — CSS transitions produce no visible effect on those panels but the pixel-counting work would still run. The element is restored to its original HTML and the function returns early.
					</p>
				</div>
				</div>
			</section>

			<PortsSection
				npm="@liiift-studio/steadygray"
				bundle="steadygray"
				attr="data-steadygray"
				framerComponent="SteadyGray"
				repo="Liiift-Studio/SteadyGray"
			/>

			<SiteFooter current="steadyGray" npmVersion={version} siteVersion={siteVersion} />

		</main>
	)
}

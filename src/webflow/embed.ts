// steadyGray/src/webflow/embed.ts — zero-config browser bundle for Webflow Custom Code Embed.
// Auto-equalises optical density on any element marked with [data-steadygray], reading options
// from data-* attributes, re-runs on viewport resize (line grouping is width-dependent), and
// exposes a small window.SteadyGray API for manual control.
import { applyGrayValue, removeGrayValue } from '../core/adjust'
import type { GrayValueOptions } from '../core/types'

/** Attribute that opts an element in to gray-value density equalization. */
const OPT_IN_ATTR = 'data-steadygray'

/** Per-element record so re-runs and teardown reuse the same clean snapshot. */
interface Instance {
	/** Clean HTML snapshot taken before the first adjustment, reused on every re-run */
	originalHTML: string
}

/** Tracks live instances keyed by their element — WeakMap so removed nodes are GC'd. */
const INSTANCES = new WeakMap<HTMLElement, Instance>()

/** Set of currently-managed elements, iterated on resize to re-equalise each. */
const TRACKED = new Set<HTMLElement>()

/** Valid density measurement modes for data-sg-density-mode. */
const VALID_DENSITY_MODES: readonly string[] = ['canvas', 'glyph-path']

/** Valid line detection strategies for data-sg-line-detection. */
const VALID_LINE_DETECTION: readonly string[] = ['bcr', 'canvas']

/** Valid per-line adjustment properties for data-sg-method. */
const VALID_METHODS: readonly string[] = ['letter-spacing', 'word-spacing', 'font-weight', 'font-width']

/** Valid line-width preservation strategies for data-sg-line-preservation. */
const VALID_LINE_PRESERVATION: readonly string[] = ['none', 'scale']

/** Valid algorithm modes for data-sg-mode. */
const VALID_MODES: readonly string[] = ['equalize', 'readability']

/** Valid complexity metrics for data-sg-complexity. */
const VALID_COMPLEXITY: readonly string[] = ['word-length', 'syllable', 'pos']

/**
 * Read gray-value options from an element's data-* attributes.
 * Unset attributes fall through to the library defaults.
 *
 * Supported attributes:
 *   data-sg-active            — "false" to skip processing and restore original HTML
 *   data-sg-density-mode      — canvas | glyph-path
 *   data-sg-font-url          — font file URL for glyph-path density measurement
 *   data-sg-line-detection    — bcr | canvas
 *   data-sg-target-density    — "auto" (default) or a 0–1 number
 *   data-sg-method            — letter-spacing | word-spacing | font-weight | font-width
 *   data-sg-max-adjustment    — maximum adjustment magnitude (unit depends on method)
 *   data-sg-tolerance         — minimum adjustment magnitude below which nothing is applied
 *   data-sg-calibration-factor — em change per 1.0 density-unit difference
 *   data-sg-line-preservation — none | scale
 *   data-sg-mode              — equalize | readability
 *   data-sg-complexity        — word-length | syllable | pos (readability mode)
 *   data-sg-strength          — complexity weighting 0–1 (readability mode)
 *
 * @param el - The opted-in element
 */
function readOptions(el: HTMLElement): GrayValueOptions {
	const opts: GrayValueOptions = {}
	const d = el.dataset

	if (d.sgActive === 'false') opts.active = false
	if (d.sgDensityMode && VALID_DENSITY_MODES.includes(d.sgDensityMode)) {
		opts.densityMode = d.sgDensityMode as GrayValueOptions['densityMode']
	}
	if (d.sgFontUrl) opts.fontUrl = d.sgFontUrl
	if (d.sgLineDetection && VALID_LINE_DETECTION.includes(d.sgLineDetection)) {
		opts.lineDetection = d.sgLineDetection as GrayValueOptions['lineDetection']
	}
	if (d.sgTargetDensity !== undefined) {
		if (d.sgTargetDensity === 'auto') {
			opts.targetDensity = 'auto'
		} else {
			const n = parseFloat(d.sgTargetDensity)
			if (!isNaN(n)) opts.targetDensity = n
		}
	}
	if (d.sgMethod && VALID_METHODS.includes(d.sgMethod)) {
		opts.method = d.sgMethod as GrayValueOptions['method']
	}
	if (d.sgMaxAdjustment !== undefined) {
		const n = parseFloat(d.sgMaxAdjustment)
		if (!isNaN(n)) opts.maxAdjustment = n
	}
	if (d.sgTolerance !== undefined) {
		const n = parseFloat(d.sgTolerance)
		if (!isNaN(n)) opts.tolerance = n
	}
	if (d.sgCalibrationFactor !== undefined) {
		const n = parseFloat(d.sgCalibrationFactor)
		if (!isNaN(n)) opts.calibrationFactor = n
	}
	if (d.sgLinePreservation && VALID_LINE_PRESERVATION.includes(d.sgLinePreservation)) {
		opts.linePreservation = d.sgLinePreservation as GrayValueOptions['linePreservation']
	}
	if (d.sgMode && VALID_MODES.includes(d.sgMode)) {
		opts.mode = d.sgMode as GrayValueOptions['mode']
	}
	if (d.sgComplexity && VALID_COMPLEXITY.includes(d.sgComplexity)) {
		opts.complexity = d.sgComplexity as GrayValueOptions['complexity']
	}
	if (d.sgStrength !== undefined) {
		const n = parseFloat(d.sgStrength)
		if (!isNaN(n)) opts.strength = n
	}

	return opts
}

/**
 * Equalise a single element: snapshot its clean markup once, then run the adjustment.
 * Idempotent — applyGrayValue resets to the saved snapshot on every call, so re-running
 * (e.g. on resize) never compounds.
 *
 * @param el - Element to adjust
 */
function initElement(el: HTMLElement): void {
	let inst = INSTANCES.get(el)
	if (!inst) {
		// First run — capture the pristine markup before any gv-* spans are injected.
		inst = { originalHTML: el.innerHTML }
		INSTANCES.set(el, inst)
	}
	applyGrayValue(el, inst.originalHTML, readOptions(el))
	TRACKED.add(el)
}

/**
 * Re-equalise every tracked element. Line grouping depends on container width,
 * so a resize can change how words fall into lines — re-running restores balance.
 * applyGrayValue resets to each element's saved snapshot first, so this is idempotent.
 */
function refit(): void {
	TRACKED.forEach((el) => {
		const inst = INSTANCES.get(el)
		if (inst) applyGrayValue(el, inst.originalHTML, readOptions(el))
	})
}

/**
 * Restore a single element to its original markup and stop tracking it.
 *
 * @param el - Element previously initialised
 */
function destroy(el: HTMLElement): void {
	const inst = INSTANCES.get(el)
	if (!inst) return
	removeGrayValue(el, inst.originalHTML)
	INSTANCES.delete(el)
	TRACKED.delete(el)
}

/**
 * Scan a root for opted-in elements and equalise each one.
 *
 * @param root - Element or document to search (default: document)
 */
function init(root: ParentNode = document): void {
	root.querySelectorAll<HTMLElement>(`[${OPT_IN_ATTR}]`).forEach(initElement)
}

// Re-equalise on viewport resize — the container's width drives line grouping. Throttled
// to one re-run per animation frame so a drag-resize doesn't run the whole pass on every event.
let resizeRaf = 0
function onResize(): void {
	if (resizeRaf) cancelAnimationFrame(resizeRaf)
	resizeRaf = requestAnimationFrame(() => { resizeRaf = 0; refit() })
}

/**
 * Auto-initialise once the DOM is parsed and web fonts have loaded.
 * Fonts must settle first: line breaking, glyph metrics, and density measurement
 * all depend on final rendered glyphs, which shift when a web font swaps in.
 */
function autoInit(): void {
	const run = () => {
		if (document.fonts?.ready) {
			document.fonts.ready.then(() => init()).catch(() => init())
		} else {
			init()
		}
		window.addEventListener('resize', onResize)
	}
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', run, { once: true })
	} else {
		run()
	}
}

autoInit()

// Public browser API — assigned to window.SteadyGray via the IIFE global name.
export { init, refit, destroy }

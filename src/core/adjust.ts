// steadyGray/src/core/adjust.ts — canvas-based optical density equalization algorithm
import { GRAY_VALUE_CLASSES, type GrayValueOptions } from './types'

// ─── OpenType.js (optional peer dep for glyph-path mode) ──────────────────────

type OpentypeFont = {
	unitsPerEm: number
	charToGlyph: (ch: string) => OpentypeGlyph
}
type OpentypeGlyphPath = {
	commands: Array<
		| { type: 'M' | 'L'; x: number; y: number }
		| { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
		| { type: 'Q'; x1: number; y1: number; x: number; y: number }
		| { type: 'Z' }
	>
}
type OpentypeGlyph = { path: OpentypeGlyphPath; advanceWidth: number }
type OpentypeModule = {
	parse?: (buffer: ArrayBuffer) => OpentypeFont
	load?: (url: string, cb: (err: Error | null, font?: OpentypeFont) => void) => void
}

let _opentype: OpentypeModule | null = null
let _opentypeLoading = false
const _fontCache = new Map<string, OpentypeFont | null>()

function tryLoadOpentype(): void {
	if (_opentype !== null || _opentypeLoading) return
	_opentypeLoading = true
	import(/* @vite-ignore */ 'opentype.js' as string)
		.then((m) => {
			// ESM builds expose parse/load on the namespace; CommonJS builds on `default`.
			const mod = m as OpentypeModule & { default?: OpentypeModule }
			_opentype = mod.parse || mod.load ? mod : (mod.default ?? null)
		})
		.catch(() => {
			console.warn('[steadygray] densityMode: "glyph-path" requires opentype.js — falling back to canvas')
		})
}

/**
 * Load an OpenType font from a URL and cache the result.
 * Calls `cb` with the font when ready, or null on error.
 */
function loadFont(url: string, cb: (font: OpentypeFont | null) => void): void {
	if (_fontCache.has(url)) { cb(_fontCache.get(url) ?? null); return }
	const ot = _opentype
	if (!ot) { cb(null); return }
	// Several applies may ask for the same font while it downloads: one fetch, every caller told.
	const waiting = _fontWaiters.get(url)
	if (waiting) { waiting.push(cb); return }
	_fontWaiters.set(url, [cb])
	const done = (font: OpentypeFont | null) => {
		_fontCache.set(url, font)
		const cbs = _fontWaiters.get(url) ?? []
		_fontWaiters.delete(url)
		cbs.forEach((fn) => fn(font))
	}
	if (ot.parse && typeof fetch === 'function') {
		// fetch + parse works in opentype.js 1.x and 2.x (2.x deprecated load(), which never calls back).
		fetch(url)
			.then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
			.then((buf) => done(ot.parse!(buf)))
			.catch(() => {
				console.warn(`[steadygray] could not load ${url} for glyph-path density — using canvas`)
				done(null)
			})
	} else if (ot.load) {
		ot.load(url, (err, font) => done(err || !font ? null : font))
	} else {
		done(null)
	}
}

/** Callbacks waiting for a font that is downloading. */
const _fontWaiters = new Map<string, ((font: OpentypeFont | null) => void)[]>()

/**
 * Compute the approximate filled area of a glyph path using the shoelace formula.
 * Cubic and quadratic bezier curves are approximated by sampling 8 points per segment.
 * Returns area in font units squared.
 *
 * @param glyph - opentype.js glyph with a .path.commands array
 */
function glyphPathArea(glyph: OpentypeGlyph): number {
	const commands = glyph.path.commands
	let area = 0
	let contourPoints: Array<[number, number]> = []
	let cx = 0, cy = 0 // current pen position

	const flushContour = () => {
		// Shoelace formula for a polygon
		const n = contourPoints.length
		if (n < 3) { contourPoints = []; return }
		let sum = 0
		for (let i = 0; i < n; i++) {
			const [x0, y0] = contourPoints[i]
			const [x1, y1] = contourPoints[(i + 1) % n]
			sum += x0 * y1 - x1 * y0
		}
		// Signed: a counter (the hole in o, e, a) winds the other way and subtracts from the outer
		// contour. Summing absolute values counted counters as ink.
		area += sum / 2
		contourPoints = []
	}

	const STEPS = 8

	for (const cmd of commands) {
		if (cmd.type === 'M') {
			if (contourPoints.length > 0) flushContour()
			cx = cmd.x; cy = cmd.y
			contourPoints.push([cx, cy])
		} else if (cmd.type === 'L') {
			cx = cmd.x; cy = cmd.y
			contourPoints.push([cx, cy])
		} else if (cmd.type === 'C') {
			// Cubic bezier — sample STEPS intermediate points
			const x0 = cx, y0 = cy
			for (let s = 1; s <= STEPS; s++) {
				const t = s / STEPS
				const u = 1 - t
				const bx = u*u*u*x0 + 3*u*u*t*cmd.x1 + 3*u*t*t*cmd.x2 + t*t*t*cmd.x
				const by = u*u*u*y0 + 3*u*u*t*cmd.y1 + 3*u*t*t*cmd.y2 + t*t*t*cmd.y
				contourPoints.push([bx, by])
			}
			cx = cmd.x; cy = cmd.y
		} else if (cmd.type === 'Q') {
			// Quadratic bezier — sample STEPS intermediate points
			const x0 = cx, y0 = cy
			for (let s = 1; s <= STEPS; s++) {
				const t = s / STEPS
				const u = 1 - t
				const bx = u*u*x0 + 2*u*t*cmd.x1 + t*t*cmd.x
				const by = u*u*y0 + 2*u*t*cmd.y1 + t*t*cmd.y
				contourPoints.push([bx, by])
			}
			cx = cmd.x; cy = cmd.y
		} else if (cmd.type === 'Z') {
			flushContour()
		}
	}

	if (contourPoints.length > 0) flushContour()
	return area
}

/**
 * Measure line density using glyph path areas from an OpenType font.
 * Returns a value in [0, 1] where 0 = no ink and 1 = fully covered.
 *
 * @param text      - Text content of the line
 * @param font      - Loaded opentype.js font object
 * @param fontSize  - Rendered font size in CSS pixels
 * @param lineHeight - Rendered line height in CSS pixels
 */
function measureLineDensityGlyph(
	text: string,
	font: OpentypeFont,
	fontSize: number,
	lineHeight: number,
): number {
	const upm = font.unitsPerEm
	const scale = fontSize / upm
	const scale2 = scale * scale // area scales as the square of the linear scale

	let inkArea = 0
	let textWidth = 0

	for (const ch of text) {
		if (/\s/.test(ch)) continue
		const glyph = font.charToGlyph(ch)
		inkArea += glyphPathArea(glyph) * scale2
		textWidth += (glyph.advanceWidth ?? 0) * scale
	}

	if (textWidth <= 0 || lineHeight <= 0) return 0
	const totalArea = textWidth * lineHeight
	return Math.min(1, inkArea / totalArea)
}

// ─── Syllable (optional peer dep) ─────────────────────────────────────────────
type SyllableModule = { syllable: (word: string) => number } | { default: (word: string) => number }
let _syllable: ((word: string) => number) | null = null
let _syllableLoading = false

function tryLoadSyllable(): void {
	if (_syllable !== null || _syllableLoading) return
	_syllableLoading = true
	import(/* @vite-ignore */ 'syllable' as string)
		.then((m) => {
			const mod = m as SyllableModule
			_syllable = 'syllable' in mod ? mod.syllable : (mod as { default: (w: string) => number }).default
		})
		.catch(() => {
			console.warn('[steadygray] complexity: "syllable" requires the `syllable` package — falling back to "word-length"')
		})
}

// ─── Pretext (canvas line detection) ─────────────────────────────────────────

type PretextModule = {
	prepareWithSegments: (text: string, font: string) => unknown
	layoutWithLines: (prepared: unknown, maxWidth: number, lineHeight: number) => { lines: { text: string; width: number }[] }
}

let _pretext: PretextModule | null = null
let _pretextLoading = false

function tryLoadPretext(): void {
	if (_pretext !== null || _pretextLoading) return
	_pretextLoading = true
	import('@chenglou/pretext' as string)
		.then((m) => { _pretext = m as PretextModule })
		.catch(() => {
			console.warn('[steadygray] canvas lineDetection requires @chenglou/pretext — falling back to BCR')
		})
}

type PreparedEntry = { originalHTML: string; prepared: unknown }
const pretextCache = new WeakMap<HTMLElement, PreparedEntry>()

function getLineHeightPx(el: HTMLElement): number {
	const s = getComputedStyle(el)
	const lh = parseFloat(s.lineHeight)
	return isNaN(lh) ? parseFloat(s.fontSize) * 1.2 : lh
}

/** Resolved defaults applied when options are omitted */
const DEFAULTS = {
	targetDensity: 'auto' as const,
	method: 'letter-spacing' as const,
	maxAdjustment: 0.05,
	tolerance: 0.01,
	calibrationFactor: 2.0,
	mode: 'equalize' as const,
	complexity: 'word-length' as const,
	strength: 0.5,
}

/**
 * Compute the relative luminance of an sRGB colour string (e.g. 'rgb(30, 30, 30)').
 * Returns a value in [0, 1] where 0 is black and 1 is white.
 * Used to detect dark-background contexts so canvas ink counting can be adapted.
 *
 * @param cssColor - Computed CSS color string from getComputedStyle
 */
function relativeLuminance(cssColor: string): number {
	const m = cssColor.match(/\d+/g)
	if (!m || m.length < 3) return 1 // default to light if unparseable
	const [r, g, b] = m.map((v) => {
		const c = parseInt(v, 10) / 255
		return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
	})
	return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Measures the optical density (ink pixel ratio) of a single line of text
 * by rendering it to a Canvas and counting non-background pixels.
 *
 * The canvas is sized to the TEXT's own rendered width (via measureText), NOT the
 * container width. This gives the intrinsic character density of the line —
 * independent of whether the line is long or short. Using container width was
 * a bug: short lines would measure as sparse just because of trailing white space,
 * causing the algorithm to over-tighten them.
 *
 * Returns a value in [0, 1] where 0 = no ink and 1 = fully covered.
 *
 * @param text       - The text content of the line
 * @param fontStyle  - Canvas-compatible font string (e.g. "400 18px Georgia")
 * @param lineHeight - Height of the canvas in CSS pixels
 * @param canvas     - Canvas element to render into (reused across calls)
 * @param darkMode   - When true, text is drawn light-on-dark and light pixels are counted as ink
 */
export function measureLineDensity(
	text: string,
	fontStyle: string,
	lineHeight: number,
	canvas: HTMLCanvasElement,
	darkMode = false,
): number {
	// willReadFrequently tells Chrome to use a CPU-backed canvas for this context,
	// avoiding expensive GPU readback on each getImageData() call.
	const ctx = canvas.getContext('2d', { willReadFrequently: true })
	if (!ctx) return 0

	// Measure text width first — font must be set before measureText for accurate metrics.
	// Canvas width is set to the text's own rendered width, not the container width.
	// This normalizes density to the character ink area, not the full column area.
	ctx.font = fontStyle
	const textWidth = ctx.measureText(text).width
	if (textWidth <= 0) return 0

	// Scale canvas by devicePixelRatio so text renders at full resolution on retina displays.
	// Without this, text at 2× DPR renders at half size → wrong density readings.
	const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1
	canvas.width = Math.max(1, Math.ceil(textWidth * dpr))
	canvas.height = Math.max(1, Math.ceil(lineHeight * dpr))

	// setTransform resets the matrix (avoids accumulation when the canvas is reused).
	// Re-apply font after canvas resize — resize resets context state.
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
	ctx.clearRect(0, 0, textWidth, lineHeight)

	// Draw background then text. In dark mode, flip fg/bg so we can count
	// light pixels as ink — the density measurement stays consistent regardless
	// of whether the page renders dark-on-light or light-on-dark.
	ctx.fillStyle = darkMode ? 'black' : 'white'
	ctx.fillRect(0, 0, textWidth, lineHeight)
	ctx.fillStyle = darkMode ? 'white' : 'black'
	ctx.font = fontStyle
	// Approximate baseline at 75% of line height
	ctx.fillText(text, 0, lineHeight * 0.75)

	const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
	const data = imageData.data

	let inkPixels = 0
	const totalPixels = canvas.width * canvas.height

	for (let i = 0; i < data.length; i += 4) {
		const r = data[i]
		const g = data[i + 1]
		const b = data[i + 2]
		if (darkMode) {
			// Light-on-dark: count pixels lighter than mid-grey as ink
			if (r > 115 || g > 115 || b > 115) inkPixels++
		} else {
			// Dark-on-light: count pixels darker than mid-grey as ink.
			// Threshold 140 correctly captures antialiased edges at high DPR.
			if (r < 140 || g < 140 || b < 140) inkPixels++
		}
	}

	return totalPixels > 0 ? inkPixels / totalPixels : 0
}

/** Per-item data kept during one apply: the whitespace before it, an author <br> before it, and whether it is a whole element. */
interface ItemMeta {
	lead: string
	breakBefore: HTMLBRElement | null
	atomic?: boolean
}

/** A piece of one item on one line: usually a whole word, or part of a word the browser breaks. */
interface Segment {
	item: HTMLElement
	text: string
	top: number
	bottom: number
	lead: string
	breakBefore: HTMLBRElement | null
	atomic: boolean
	/** Whether this is the item's first segment (its start is the span's start). */
	first: boolean
}

/**
 * Splits a text node that the browser lays out over several lines into one piece per line, by
 * measuring where each character's box starts a new line. Used only for the rare word that wraps.
 */
function splitAtLineBreaks(node: Text, text: string): { text: string; top: number; bottom: number }[] {
	const pieces: { text: string; top: number; bottom: number }[] = []
	const range = document.createRange()
	let start = 0
	let top = NaN, bottom = NaN
	for (let i = 0; i < text.length; i++) {
		range.setStart(node, i)
		range.setEnd(node, i + 1)
		const rect = range.getClientRects()[0]
		if (!rect) continue
		const middle = (rect.top + rect.bottom) / 2
		if (Number.isNaN(top)) { top = rect.top; bottom = rect.bottom; continue }
		if (middle > bottom) {
			pieces.push({ text: text.slice(start, i), top, bottom })
			start = i
			top = rect.top
			bottom = rect.bottom
		} else {
			bottom = Math.max(bottom, rect.bottom)
		}
	}
	pieces.push({ text: text.slice(start), top: Number.isNaN(top) ? 0 : top, bottom: Number.isNaN(bottom) ? 0 : bottom })
	return pieces.filter((p) => p.text.length > 0)
}

/** Elements kept whole during the rebuild (no text of their own to split). */
const ATOMIC_TAGS = new Set(['IMG', 'SVG', 'INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'VIDEO', 'AUDIO', 'CANVAS', 'IFRAME', 'OBJECT', 'MATH'])

/** Scripts written without spaces between words: every grapheme is a possible line break. */
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u

/**
 * Splits a space-free token into the pieces a line may break between: graphemes for CJK, Thai and
 * similar scripts (Intl.Segmenter keeps combining marks with their base), the whole token otherwise.
 */
function splitUnspaced(token: string): string[] {
	if (!UNSPACED_SCRIPT.test(token)) return [token]
	const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(t: string): Iterable<{ segment: string }> } }).Segmenter
	if (!Seg) return Array.from(token)
	return Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(token), (seg) => seg.segment)
}

/** A finite number, else the default (with a one-time warning). */
function finiteOr(value: unknown, fallback: number, name: string): number {
	if (value === undefined) return fallback
	if (typeof value === 'number' && Number.isFinite(value)) return value
	if (!warned.has(name)) {
		warned.add(name)
		console.warn(`[steadyGray] ${name} must be a finite number; got ${String(value)}, using ${fallback}`)
	}
	return fallback
}

/** Warnings already printed. */
const warned = new Set<string>()

/** The snapshot each processed element was built from, returned by getCleanHTML. */
const originals = new WeakMap<HTMLElement, string>()

/**
 * The element's original nodes: each element's child list, so a refit or removal can put the very
 * same nodes back (keeping their event listeners, React's included) instead of re-parsing HTML.
 */
interface NodeSnapshot { html: string; children: Map<Node, Node[]> }
const snapshots = new WeakMap<HTMLElement, NodeSnapshot>()

/** Records every element's child list under root. */
function takeSnapshot(root: HTMLElement, html: string): NodeSnapshot {
	const children = new Map<Node, Node[]>()
	const visit = (node: Node) => {
		children.set(node, Array.from(node.childNodes))
		node.childNodes.forEach((child) => { if (child.nodeType === Node.ELEMENT_NODE) visit(child) })
	}
	visit(root)
	return { html, children }
}

/** Puts the original nodes back where they were. */
function restoreSnapshot(snapshot: NodeSnapshot): void {
	snapshot.children.forEach((kids, parent) => (parent as Element).replaceChildren(...kids))
}

/**
 * Pass 1: bring the element back to its original content, reusing the original nodes when they
 * are still known (a refit, or a first run on an element that already holds originalHTML).
 */
function resetElement(element: HTMLElement, originalHTML: string): void {
	const snap = snapshots.get(element)
	if (snap && snap.html === originalHTML) {
		restoreSnapshot(snap)
		return
	}
	if (snap) restoreSnapshot(snap)
	const current = element.querySelector(`.${GRAY_VALUE_CLASSES.line}`) ? null : element.innerHTML
	if (current !== originalHTML) element.innerHTML = originalHTML
	snapshots.set(element, takeSnapshot(element, originalHTML))
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Strips all optical-margin injected markup from a clone of the element and returns the clean
 * innerHTML (the author's own <br> tags are kept). Safe to call multiple times — idempotent.
 *
 * @param el - Element that may contain optical-margin markup

/**
 * Returns the element's original innerHTML: for an element this library processed, the exact
 * snapshot it was built from; otherwise the innerHTML with any gray-value markup removed. Idempotent.
 *
 * @param el - Element that may contain gray-value markup
 */
export function getCleanHTML(el: HTMLElement): string {
	const original = originals.get(el)
	if (original !== undefined && el.querySelector(`.${GRAY_VALUE_CLASSES.line}`)) return original
	const clone = el.cloneNode(true) as HTMLElement
	const gvSpans = clone.querySelectorAll(
		`.${GRAY_VALUE_CLASSES.word}, .${GRAY_VALUE_CLASSES.line}`,
	)
	gvSpans.forEach((node) => {
		const parent = node.parentNode
		if (!parent) return
		while (node.firstChild) parent.insertBefore(node.firstChild, node)
		parent.removeChild(node)
	})
	// Also remove any injected <br> elements between lines
	clone.querySelectorAll('br[data-gv-break]').forEach((br) => br.remove())
	clone.normalize()
	return clone.innerHTML
}

/**
 * The canvas font for an element: style, weight, size and the whole computed family list (the
 * browser quotes names that need it, such as "Source Serif 4", which canvas rejects unquoted).
 */
function canvasFontFor(cs: CSSStyleDeclaration): string {
	return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
}

/** The colour actually behind an element: the nearest ancestor with a non-transparent background (white if none). */
function effectiveBackground(el: HTMLElement): string {
	let node: HTMLElement | null = el
	while (node) {
		const bg = getComputedStyle(node).backgroundColor
		const alpha = /rgba\([^)]*,\s*([\d.]+)\)/.exec(bg)
		if (bg && bg !== 'transparent' && !(alpha && parseFloat(alpha[1]) === 0)) return bg
		node = node.parentElement
	}
	return 'rgb(255, 255, 255)'
}

/** Replaces or adds one axis in a font-variation-settings string, keeping the others. */
function withAxis(base: string, tag: string, value: number): string {
	const entry = `"${tag}" ${value}`
	if (!base || base === 'normal') return entry
	const re = new RegExp(`(["'])${tag}\\1\\s+-?[\\d.eE+-]+`)
	return re.test(base) ? base.replace(re, entry) : `${base}, ${entry}`
}

/** Most recent apply per element, so a font that finishes loading re-applies only if nothing newer ran. */
const latestApply = new WeakMap<HTMLElement, object>()

/**
 * Applies gray-value optical density equalization to an element.
 *
 * Algorithm:
 *  1. Reset — bring back the original content (the original nodes, when known)
 *  2. Word wrap — wrap each word in a plain inline gv-word span, leaving the spaces between words in
 *     the text flow, so the browser breaks lines exactly as it does for the original text
 *  3. Read — group words into visual lines by position (a word the browser breaks is split there)
 *  4. Measure — render each line to Canvas and compute its ink density
 *  5. Target — the average density (or a given one); readability mode spreads it per line
 *  6. Adjust — a per-line correction from the density difference
 *  7. Write — one gv-line span per line (inline markup kept) carrying the correction
 *
 * @param element      - Live DOM element to adjust (must be rendered and visible)
 * @param originalHTML - HTML snapshot taken before the first adjustment run
 * @param options      - GrayValueOptions (merged with defaults)
 * @param _canvas      - Optional injectable Canvas for testing (creates one if absent)
 */
export function applyGrayValue(
	element: HTMLElement,
	originalHTML: string,
	options: GrayValueOptions | null = {},
	_canvas?: HTMLCanvasElement,
): void {
	if (typeof window === 'undefined') return
	const opts = options ?? {}

	// active:false, or an e-ink / slow-refresh display: restore the original content and stop.
	if ((opts.active ?? true) === false || window.matchMedia?.('(update: slow)')?.matches) {
		resetElement(element, originalHTML)
		return
	}

	// Resolve and validate options
	const targetDensityOpt = typeof opts.targetDensity === 'number'
		? (Number.isFinite(opts.targetDensity) && opts.targetDensity >= 0 && opts.targetDensity <= 1 ? opts.targetDensity : (warnOnce(`[steadyGray] targetDensity must be between 0 and 1 or 'auto'; got ${opts.targetDensity}, using 'auto'`), 'auto' as const))
		: DEFAULTS.targetDensity
	const method = opts.method ?? DEFAULTS.method
	const maxAdjustment = Math.abs(finiteOr(opts.maxAdjustment, method === 'font-weight' ? 100 : method === 'font-width' ? 30 : DEFAULTS.maxAdjustment, 'maxAdjustment'))
	const tolerance = Math.abs(finiteOr(opts.tolerance, DEFAULTS.tolerance, 'tolerance'))
	const calibrationFactor = finiteOr(opts.calibrationFactor, DEFAULTS.calibrationFactor, 'calibrationFactor')
	const linePreservation = opts.linePreservation ?? 'none'
	const densityMode = opts.densityMode ?? 'canvas'
	const mode = opts.mode ?? DEFAULTS.mode
	const complexity = opts.complexity ?? DEFAULTS.complexity
	const strength = Math.max(0, Math.min(1, finiteOr(opts.strength, DEFAULTS.strength, 'strength')))

	// Optional modules: the first apply falls back while they load, then re-applies once.
	const applyToken = {}
	latestApply.set(element, applyToken)
	if (densityMode === 'glyph-path') tryLoadOpentype()
	if (mode === 'readability' && complexity === 'syllable') tryLoadSyllable()

	// --- Pass 1: Reset ---
	resetElement(element, originalHTML)
	originals.set(element, originalHTML)

	if (!element.offsetWidth && !element.getBoundingClientRect().width) return
	if (!originalHTML.trim()) return

	const computedStyle = getComputedStyle(element)
	const fontSize = parseFloat(computedStyle.fontSize) || 16
	const fontStyle = canvasFontFor(computedStyle)
	const px = (v: string) => parseFloat(v) || 0
	const contentWidth = element.getBoundingClientRect().width - px(computedStyle.paddingLeft) - px(computedStyle.paddingRight) - px(computedStyle.borderLeftWidth) - px(computedStyle.borderRightWidth)

	// Dark-mode context: text lighter than what's actually behind it (the nearest non-transparent
	// background), so canvas counting must treat light pixels as ink.
	const darkMode = relativeLuminance(effectiveBackground(element)) < relativeLuminance(computedStyle.color)
	const baseWeight = parseFloat(computedStyle.fontWeight) || 400
	const baseFVS = computedStyle.fontVariationSettings || 'normal'
	const authorLetterSpacing = computedStyle.letterSpacing && computedStyle.letterSpacing !== 'normal' ? computedStyle.letterSpacing : ''
	const authorWordSpacing = computedStyle.wordSpacing && computedStyle.wordSpacing !== 'normal' && computedStyle.wordSpacing !== '0px' ? computedStyle.wordSpacing : ''

	// --- Pass 2: Word wrap ---
	// Each word goes in a plain inline span holding only the word; the whitespace around it stays as
	// text in the flow. (Inline-block word spans with their leading space inside dropped that space,
	// packed lines too tightly, and the locked nowrap lines then overflowed.) Text without spaces (CJK,
	// Thai) is split into graphemes. Author <br>, images and other childless elements are atomic items.
	const items: HTMLElement[] = []
	const meta = new WeakMap<Element, ItemMeta>()
	let pendingSpace = ''
	let pendingBreak: HTMLBRElement | null = null

	const pushWord = (span: HTMLElement, lead: string) => {
		meta.set(span, { lead: pendingSpace + lead, breakBefore: pendingBreak })
		pendingSpace = ''
		pendingBreak = null
		items.push(span)
	}

	const walk = (node: Node): void => {
		if (node.nodeType === Node.TEXT_NODE) {
			const textNode = node as Text
			const text = textNode.textContent ?? ''
			if (!text.trim()) {
				pendingSpace += text
				return
			}
			const fragment = document.createDocumentFragment()
			let lead = ''
			for (const token of text.split(/(\s+)/)) {
				if (!token) continue
				if (/^\s+$/.test(token)) {
					fragment.appendChild(document.createTextNode(token))
					lead += token
					continue
				}
				for (const piece of splitUnspaced(token)) {
					const span = document.createElement('span')
					span.className = GRAY_VALUE_CLASSES.word
					// A locked nowrap line can't hyphenate, so the measurement mustn't either.
					span.style.hyphens = 'manual'
					span.textContent = piece
					fragment.appendChild(span)
					pushWord(span, lead)
					lead = ''
				}
			}
			pendingSpace += lead
			textNode.parentNode!.replaceChild(fragment, textNode)
			return
		}
		if (node.nodeType !== Node.ELEMENT_NODE) return
		const el = node as Element
		if (el.tagName === 'BR') {
			pendingBreak = el as HTMLBRElement
			return
		}
		if (!el.hasChildNodes() || ATOMIC_TAGS.has(el.tagName)) {
			meta.set(el, { lead: pendingSpace, breakBefore: pendingBreak, atomic: true })
			pendingSpace = ''
			pendingBreak = null
			items.push(el as HTMLElement)
			return
		}
		Array.from(el.childNodes).forEach(walk)
	}
	Array.from(element.childNodes).forEach(walk)

	if (items.length === 0) {
		resetElement(element, originalHTML)
		return
	}

	// --- Pass 3: Group into lines ---
	const lineDetection = opts.lineDetection ?? 'bcr'
	if (lineDetection === 'canvas') tryLoadPretext()
	const usePretext = lineDetection === 'canvas' && _pretext !== null

	let lines: Segment[][] = []
	if (usePretext) {
		// Canvas path — pretext gives line texts; words are matched to them in order.
		const cached = pretextCache.get(element)
		let prepared: unknown
		if (cached && cached.originalHTML === originalHTML) {
			prepared = cached.prepared
		} else {
			prepared = _pretext!.prepareWithSegments(element.textContent ?? '', fontStyle)
			pretextCache.set(element, { originalHTML, prepared })
		}
		const { lines: pretextLines } = _pretext!.layoutWithLines(prepared, contentWidth, getLineHeightPx(element))
		const toSeg = (item: HTMLElement): Segment => {
			const info = meta.get(item)
			return { item, text: info?.atomic ? '' : item.textContent ?? '', top: 0, bottom: 0, lead: info?.lead ?? '', breakBefore: info?.breakBefore ?? null, atomic: !!info?.atomic, first: true }
		}
		let si = 0
		for (const pl of pretextLines) {
			const target = pl.text.replace(/\s+/g, '')
			const line: Segment[] = []
			let acc = ''
			while (si < items.length) {
				acc += (items[si].textContent ?? '').replace(/\s+/g, '')
				line.push(toSeg(items[si]))
				si++
				if (acc.length >= target.length) break
			}
			if (line.length) lines.push(line)
		}
		while (si < items.length) lines[lines.length - 1]?.push(toSeg(items[si++]))
		// An author <br> always starts a line.
		lines = lines.flatMap((line) => {
			const out: Segment[][] = [[]]
			line.forEach((seg, k) => { if (k > 0 && seg.breakBefore) out.push([]); out[out.length - 1].push(seg) })
			return out
		})
	} else {
		// BCR path. A word the browser itself breaks across lines (after a hyphen, or with
		// overflow-wrap) is split into one segment per line at the real break.
		const segments: Segment[] = []
		for (const item of items) {
			const rects = item.getClientRects?.()
			const rect = rects && rects.length ? rects[0] : item.getBoundingClientRect()
			const info = meta.get(item)
			const text = info?.atomic ? '' : item.textContent ?? ''
			if (rects && rects.length > 1 && !info?.atomic && item.firstChild?.nodeType === Node.TEXT_NODE) {
				for (const [k, piece] of splitAtLineBreaks(item.firstChild as Text, text).entries()) {
					segments.push({ item, text: piece.text, top: piece.top, bottom: piece.bottom, lead: k === 0 ? info?.lead ?? '' : '', breakBefore: k === 0 ? info?.breakBefore ?? null : null, atomic: false, first: k === 0 })
				}
				continue
			}
			segments.push({ item, text, top: rect.top, bottom: rect.bottom ?? rect.top, lead: info?.lead ?? '', breakBefore: info?.breakBefore ?? null, atomic: !!info?.atomic, first: true })
		}
		// A word starts a new line when its vertical middle is below the bottom of the current line's
		// boxes: a superscript, subscript, emoji or inline image stays in its line, and lines whose
		// glyph boxes overlap (a tight line-height) stay apart. Grouping by exact top split a line
		// at every <sub>, <sup> or emoji.
		let current: Segment[] | null = null
		let groupBottom = -Infinity
		for (const seg of segments) {
			const middle = (seg.top + seg.bottom) / 2
			if (current === null || middle > groupBottom || (current.length > 0 && seg.breakBefore)) {
				current = []
				lines.push(current)
				groupBottom = seg.bottom
			} else {
				groupBottom = Math.max(groupBottom, seg.bottom)
			}
			current.push(seg)
		}
	}

	if (lines.length === 0) return

	const lineHeightPx = getLineHeightPx(element)
	const lineTexts = lines.map((line) => line.map((seg, k) => (k > 0 ? seg.lead : '') + seg.text).join('').replace(/\s+/g, ' ').trim())

	// --- Pass 4: Measure density per line ---
	// glyph-path needs opentype.js and the font file; until both are loaded, canvas is used and the
	// element is re-applied once they are.
	let loadedFont: OpentypeFont | null = null
	// True while this apply is measuring: a font from the cache calls back synchronously and is used
	// directly; one that arrives later triggers a re-apply.
	let sync = true
	if (densityMode === 'glyph-path' && opts.fontUrl) {
		if (_opentype !== null) {
			loadFont(opts.fontUrl, (f) => {
				if (loadedFont === null && f && latestApply.get(element) === applyToken && sync === false) {
					// Loaded after this apply finished: re-apply with glyph paths.
					applyGrayValue(element, originalHTML, opts, _canvas)
				}
				loadedFont = f
			})
		} else if (_opentypeLoading) {
			retryWhenLoaded(() => _opentype !== null, () => { if (latestApply.get(element) === applyToken) applyGrayValue(element, originalHTML, opts, _canvas) })
		}
	}

	const canvas: HTMLCanvasElement = _canvas ?? document.createElement('canvas')
	const densities: number[] = lineTexts.map((text) => {
		if (loadedFont) return measureLineDensityGlyph(text, loadedFont, fontSize, lineHeightPx || fontSize)
		return measureLineDensity(text, fontStyle, lineHeightPx || fontSize, canvas, darkMode)
	})
	sync = false

	// --- Pass 5: Target density ---
	let targetDensity: number
	if (typeof targetDensityOpt === 'number') {
		targetDensity = targetDensityOpt
	} else {
		const sum = densities.reduce((acc, d) => acc + d, 0)
		targetDensity = densities.length > 0 ? sum / densities.length : 0
	}

	// --- Pass 6: Per-line correction ---
	// Equalize: every line aims at the same density. Readability: complex lines aim lower (opened up)
	// and simple lines higher, by up to ±10% of the target at strength 1. (This used to add the
	// maxAdjustment value — an em amount — to a density.)
	let perLineTargets: number[]
	if (mode === 'readability') {
		const complexityScores = lineTexts.map((text) => {
			const words = text.split(/\s+/).filter(Boolean)
			if (words.length === 0) return 0
			if (complexity === 'syllable' && _syllable !== null) {
				return words.reduce((sum, w) => sum + _syllable!(w), 0) / words.length
			}
			return words.reduce((sum, w) => sum + w.length, 0) / words.length
		})
		const minC = Math.min(...complexityScores)
		const rangeC = Math.max(...complexityScores) - minC || 1
		perLineTargets = complexityScores.map((c) => targetDensity * (1 - ((c - minC) / rangeC - 0.5) * strength * 0.2))
	} else {
		perLineTargets = densities.map(() => targetDensity)
	}

	// delta = (density − target) × calibrationFactor, in em for the spacing methods. Weight and width
	// work in their own units (~1000× larger), so the same density difference is scaled to them.
	const unitScale = method === 'font-weight' || method === 'font-width' ? 1000 : 1
	const adjustments: number[] = densities.map((density, i) => {
		const delta = (density - perLineTargets[i]) * calibrationFactor * unitScale
		if (Math.abs(delta) < tolerance * unitScale) return 0
		return Math.max(-maxAdjustment, Math.min(maxAdjustment, delta))
	})

	// --- Pass 7: Write — one gv-line span per line ---
	const chains = new Map<Segment, Element[]>()
	for (const line of lines) {
		for (const seg of line) {
			const ancestors: Element[] = []
			let node: Element | null = seg.item.parentElement
			while (node && node !== element) {
				ancestors.unshift(node)
				node = node.parentElement
			}
			chains.set(seg, ancestors)
		}
	}

	const justify = computedStyle.textAlign === 'justify'
	const ws = computedStyle.whiteSpace
	const lineWhiteSpace = ws === 'pre' || ws === 'pre-wrap' || ws === 'break-spaces' ? 'pre' : 'nowrap'
	const copied = new Set<Element>()
	const fragment = document.createDocumentFragment()
	const lineEls: HTMLElement[] = []

	lines.forEach((line, lineIndex) => {
		const adj = adjustments[lineIndex]
		const lineSpan = document.createElement('span')
		lineSpan.className = GRAY_VALUE_CLASSES.line
		lineSpan.style.display = 'inline-block'
		lineSpan.style.whiteSpace = lineWhiteSpace
		lineSpan.style.verticalAlign = 'top'
		// text-indent is inherited: without this every line would be indented, not just the first.
		lineSpan.style.textIndent = '0'
		if (adj !== 0) {
			if (method === 'font-weight') {
				// Dense lines get positive adj → lighter; sparse lines → heavier.
				lineSpan.style.fontWeight = String(Math.max(1, Math.min(1000, Math.round(baseWeight - adj))))
			} else if (method === 'font-width') {
				// Dense lines get positive adj → wider. (Narrower glyphs pack the same strokes into less
				// width, so they measure denser; widening a dense line lightens it.) Other axes are kept.
				lineSpan.style.fontVariationSettings = withAxis(baseFVS, 'wdth', Math.max(50, Math.min(200, +(100 + adj).toFixed(1))))
			} else if (method === 'word-spacing') {
				lineSpan.style.wordSpacing = authorWordSpacing ? `calc(${authorWordSpacing} + ${adj}em)` : `${adj}em`
			} else {
				lineSpan.style.letterSpacing = authorLetterSpacing ? `calc(${authorLetterSpacing} + ${adj}em)` : `${adj}em`
			}
		}
		// Justified text: every line but the last of a paragraph (and lines before an author <br>)
		// fills the column.
		const nextSeg = lines[lineIndex + 1]?.[0]
		if (justify && nextSeg && !nextSeg.breakBefore && contentWidth > 0) {
			lineSpan.style.width = `${contentWidth}px`
			lineSpan.style.textAlignLast = 'justify'
		}

		// Rebuild the line inside its inline ancestors. The first appearance of an element reuses the
		// original (keeping its listeners); a later line gets a copy without its id.
		let openChain: { source: Element; clone: Element }[] = []
		line.forEach((seg, k) => {
			const ancestors = chains.get(seg) ?? []
			let shared = 0
			while (shared < openChain.length && shared < ancestors.length && openChain[shared].source === ancestors[shared]) shared++
			openChain = openChain.slice(0, shared)
			let parent: Node = shared ? openChain[shared - 1].clone : lineSpan
			let lead = seg.lead
			if (k === 0) lead = lead.replace(/[\r\n]+/g, '')
			if (lead) parent.appendChild(document.createTextNode(lead))
			for (let a = shared; a < ancestors.length; a++) {
				let copy: Element
				if (copied.has(ancestors[a])) {
					copy = ancestors[a].cloneNode(false) as Element
					copy.removeAttribute('id')
				} else {
					copy = ancestors[a]
					copy.replaceChildren()
				}
				copied.add(ancestors[a])
				parent.appendChild(copy)
				openChain.push({ source: ancestors[a], clone: copy })
				parent = copy
			}
			parent.appendChild(seg.atomic ? seg.item : document.createTextNode(seg.text))
		})

		fragment.appendChild(lineSpan)
		lineEls.push(lineSpan)
		if (lineIndex < lines.length - 1) {
			const authorBreak = lines[lineIndex + 1][0].breakBefore
			if (authorBreak) {
				fragment.appendChild(authorBreak.cloneNode(false))
			} else {
				const br = document.createElement('br')
				br.setAttribute('data-gv-break', '1')
				br.setAttribute('aria-hidden', 'true')
				fragment.appendChild(br)
			}
		}
	})

	element.innerHTML = ''
	element.appendChild(fragment)

	// --- Optional: scale preservation ---
	// Each line is scaled back to the width it had before the correction (not stretched to the
	// container, which distorted short lines), so the column edge doesn't move.
	if (linePreservation === 'scale' && !justify) {
		const corrected = lineEls.map((el) => el.getBoundingClientRect().width)
		const saved = lineEls.map((el) => ({ ls: el.style.letterSpacing, wsp: el.style.wordSpacing, fw: el.style.fontWeight, fvs: el.style.fontVariationSettings }))
		lineEls.forEach((el) => { el.style.letterSpacing = ''; el.style.wordSpacing = ''; el.style.fontWeight = ''; el.style.fontVariationSettings = '' })
		const natural = lineEls.map((el) => el.getBoundingClientRect().width)
		lineEls.forEach((el, i) => {
			el.style.letterSpacing = saved[i].ls
			el.style.wordSpacing = saved[i].wsp
			el.style.fontWeight = saved[i].fw
			el.style.fontVariationSettings = saved[i].fvs
			const cw = corrected[i], nw = natural[i]
			if (cw > 0.5 && nw > 0.5 && Math.abs(cw - nw) > 0.5) {
				el.style.transform = `scaleX(${(nw / cw).toFixed(6)})`
				el.style.transformOrigin = 'left center'
			}
		})
	}
}

/** Prints a console warning the first time it is seen. */
function warnOnce(message: string): void {
	if (warned.has(message)) return
	warned.add(message)
	console.warn(message)
}

/** Polls (on animation frames, briefly) until an optional module is ready, then runs the callback once. */
function retryWhenLoaded(ready: () => boolean, run: () => void, tries = 120): void {
	if (ready()) { run(); return }
	if (tries <= 0 || typeof requestAnimationFrame === 'undefined') return
	requestAnimationFrame(() => retryWhenLoaded(ready, run, tries - 1))
}

/**
 * Remove gray-value markup and restore original HTML.
 *
 * @param element      - Element previously adjusted by applyGrayValue
 * @param originalHTML - The clean HTML snapshot passed to applyGrayValue
 */
export function removeGrayValue(element: HTMLElement, originalHTML: string): void {
	const snap = snapshots.get(element)
	if (snap && snap.html === originalHTML) restoreSnapshot(snap)
	else element.innerHTML = originalHTML
	snapshots.delete(element)
	originals.delete(element)
}

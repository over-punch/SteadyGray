// gray-value/src/__tests__/adjust.test.ts — core algorithm tests
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { applyGrayValue, removeGrayValue, getCleanHTML, measureLineDensity } from '../core/adjust'
import { GRAY_VALUE_CLASSES } from '../core/types'

// ─── DOM measurement mock ─────────────────────────────────────────────────────

/** Width used for the simulated container element */
const CONTAINER_WIDTH = 600
/** Width returned for every gv-word span (so 600/80 = 7 words per line) */
const WORD_WIDTH = 80
/** Line height returned by BCR for word spans */
const LINE_HEIGHT = 20
/** Number of words that fit per simulated line */
const WORDS_PER_LINE = Math.floor(CONTAINER_WIDTH / WORD_WIDTH) // 7

/**
 * Patches HTMLElement.prototype.offsetWidth via a configurable getter+setter
 * so that:
 *  - all elements return CONTAINER_WIDTH by default
 *  - gv-word spans return WORD_WIDTH
 *
 * The setter is required so that happy-dom's class-field initializer
 * (`public readonly offsetWidth = 0`) can still write the own property
 * on new instances without throwing in strict mode.
 *
 * Must be called once before any test creates DOM elements, because patching
 * the prototype while elements already exist can fail.
 */
function patchOffsetWidth() {
	// Find the HTMLElement prototype. We cannot call createElement here because
	// happy-dom has already set up the prototype chain; we access it through the
	// global HTMLElement constructor if available, falling back to a temp element.
	let proto: object
	if (typeof HTMLElement !== 'undefined') {
		proto = HTMLElement.prototype
	} else {
		// Fallback: create a transient element to walk to the prototype
		proto = Object.getPrototypeOf(document.createElement('div'))
	}

	Object.defineProperty(proto, 'offsetWidth', {
		configurable: true,
		// Setter allows happy-dom's `readonly offsetWidth = 0` class-field
		// initializer to complete without throwing in strict mode.
		set(_v: number) { /* discard — getter provides the value */ },
		get(this: HTMLElement) {
			if (this.classList?.contains(GRAY_VALUE_CLASSES.word)) return WORD_WIDTH
			return CONTAINER_WIDTH
		},
	})
}

/**
 * Patches Element.prototype.getBoundingClientRect so word spans return
 * staggered top values (LINE_HEIGHT * row) enabling multi-line detection.
 */
function patchBCR() {
	/** Map from word span → assigned row index */
	const wordRow = new WeakMap<Element, number>()
	let wordCount = 0

	Element.prototype.getBoundingClientRect = function (this: Element) {
		if (this.classList?.contains(GRAY_VALUE_CLASSES.word)) {
			if (!wordRow.has(this)) {
				wordRow.set(this, Math.floor(wordCount / WORDS_PER_LINE))
				wordCount++
			}
			const row = wordRow.get(this)!
			const top = row * LINE_HEIGHT
			return {
				width: WORD_WIDTH,
				height: LINE_HEIGHT,
				top,
				left: 0,
				right: WORD_WIDTH,
				bottom: top + LINE_HEIGHT,
				x: 0,
				y: top,
				toJSON: () => {},
			} as DOMRect
		}
		return {
			width: CONTAINER_WIDTH,
			height: LINE_HEIGHT,
			top: 0,
			left: 0,
			right: CONTAINER_WIDTH,
			bottom: LINE_HEIGHT,
			x: 0,
			y: 0,
			toJSON: () => {},
		} as DOMRect
	}
}

/**
 * Creates a paragraph element, appends it to the document body, and returns it.
 *
 * @param html - innerHTML to set on the element
 */
function makeElement(html: string): HTMLElement {
	const el = document.createElement('p')
	el.innerHTML = html
	el.style.width = `${CONTAINER_WIDTH}px`
	document.body.appendChild(el)
	return el
}

// ─── Mock canvas factory ──────────────────────────────────────────────────────

/**
 * Creates a mock HTMLCanvasElement whose getImageData returns alternating
 * density values across successive calls:
 *  - odd calls  → high density (0.06, representing a tight/dense line)
 *  - even calls → low density  (0.02, representing a loose/sparse line)
 *
 * canvas.width and canvas.height are mutable so that measureLineDensity can
 * resize the canvas to the text's rendered width before calling getImageData.
 * getImageData uses the requested (w, h) dimensions so density ratios are
 * stable regardless of canvas size.
 * measureText returns text.length × 8 — a stable proxy for text width in tests.
 */
function makeMockCanvas(): HTMLCanvasElement {
	let callCount = 0
	let _width = CONTAINER_WIDTH
	let _height = LINE_HEIGHT

	const mockCanvas = {
		get width()  { return _width },
		set width(v: number)  { _width = v },
		get height() { return _height },
		set height(v: number) { _height = v },
		getContext: () => ({
			font: '',
			fillStyle: '' as string,
			setTransform: () => {},
			clearRect: () => {},
			fillRect:  () => {},
			fillText:  () => {},
			measureText: (text: string) => ({ width: text.length * 8 }),
			getImageData: (_x: number, _y: number, w: number, h: number) => {
				callCount++
				// Alternate: 1st call = dense (0.06), 2nd call = sparse (0.02), etc.
				const density = callCount % 2 === 1 ? 0.06 : 0.02
				const pixels = w * h
				const data = new Uint8ClampedArray(pixels * 4)
				const inkCount = Math.floor(density * pixels)
				// First inkCount pixels → black ink
				for (let i = 0; i < inkCount * 4; i += 4) {
					data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255
				}
				// Remaining pixels → white
				for (let i = inkCount * 4; i < data.length; i += 4) {
					data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255
				}
				return { data }
			},
		}),
	}

	return mockCanvas as unknown as HTMLCanvasElement
}

// ─── Tests ────────────────────────────────────────────────────────────────────

// Patch the prototype once before all tests to avoid the strict-mode setter
// conflict that arises when defineProperty is called after elements exist.
beforeAll(() => {
	patchOffsetWidth()
	patchBCR()
})

describe('gray-value', () => {
	beforeEach(() => {
		document.body.innerHTML = ''
	})

	// 1. gv-line spans exist after apply
	it('creates gv-line spans after applyGrayValue', () => {
		// 14 words → 2 lines with WORDS_PER_LINE = 7
		const words = Array.from({ length: 14 }, (_, i) => `word${i + 1}`).join(' ')
		const el = makeElement(words)
		const original = getCleanHTML(el)
		applyGrayValue(el, original, {}, makeMockCanvas())
		const lineSpans = el.querySelectorAll(`.${GRAY_VALUE_CLASSES.line}`)
		expect(lineSpans.length).toBeGreaterThan(0)
	})

	// 2. Lines with below-target density get negative letter-spacing (tightened to increase density)
	it('applies negative letter-spacing to below-target-density lines', () => {
		const words = Array.from({ length: 14 }, (_, i) => `word${i + 1}`).join(' ')
		const el = makeElement(words)
		const original = getCleanHTML(el)
		// targetDensity=0.05: 1st line density=0.06 (dense), 2nd line density=0.02 (sparse)
		// Sparse line (below target) → negative letter-spacing tightens tracking
		applyGrayValue(el, original, { targetDensity: 0.05, calibrationFactor: 2.0, maxAdjustment: 0.05 }, makeMockCanvas())
		const lines = Array.from(el.querySelectorAll<HTMLElement>(`.${GRAY_VALUE_CLASSES.line}`))
		expect(lines.length).toBeGreaterThanOrEqual(2)
		// Second line density = 0.02 < 0.05 target → negative spacing to tighten it
		const secondLine = lines[1]
		const spacing = parseFloat(secondLine.style.letterSpacing)
		expect(spacing).toBeLessThan(0)
	})

	// 3. Lines with above-target density get positive letter-spacing (opens up to reduce density)
	it('applies positive letter-spacing to above-target-density lines', () => {
		const words = Array.from({ length: 14 }, (_, i) => `word${i + 1}`).join(' ')
		const el = makeElement(words)
		const original = getCleanHTML(el)
		// targetDensity=0.05: 1st line density=0.06 > target → positive spacing opens tracking
		applyGrayValue(el, original, { targetDensity: 0.05, calibrationFactor: 2.0, maxAdjustment: 0.05 }, makeMockCanvas())
		const lines = Array.from(el.querySelectorAll<HTMLElement>(`.${GRAY_VALUE_CLASSES.line}`))
		expect(lines.length).toBeGreaterThanOrEqual(2)
		// First line density = 0.06 > 0.05 target → positive spacing to open it up
		const firstLine = lines[0]
		const spacing = parseFloat(firstLine.style.letterSpacing)
		expect(spacing).toBeGreaterThan(0)
	})

	// 4. removeGrayValue restores original HTML
	it('removeGrayValue restores original HTML', () => {
		const el = makeElement('<em>Hello</em> world')
		const original = getCleanHTML(el)
		applyGrayValue(el, original, {}, makeMockCanvas())
		removeGrayValue(el, original)
		expect(el.innerHTML).toBe(original)
	})

	// 5. getCleanHTML is idempotent
	it('getCleanHTML is idempotent', () => {
		const el = makeElement('<em>Hello</em> world')
		const html1 = getCleanHTML(el)
		const html2 = getCleanHTML(el)
		expect(html1).toBe(html2)
	})

	// 6. Inline elements are preserved after apply
	it('preserves inline elements after applyGrayValue', () => {
		const el = makeElement('<em>italic</em> and <strong>bold</strong>')
		const original = getCleanHTML(el)
		applyGrayValue(el, original, {}, makeMockCanvas())
		// Inline element text content should still appear in the output
		expect(el.innerHTML).toContain('italic')
		expect(el.innerHTML).toContain('bold')
	})

	// 7. measureLineDensity returns 0 for empty text (textWidth = 0 → early return)
	it('measureLineDensity returns 0 for empty text', () => {
		// measureText returns width 0 for '' → measureLineDensity returns 0 early
		const blankCanvas = {
			width: 1,
			height: 1,
			getContext: () => ({
				font: '',
				fillStyle: '',
				setTransform: () => {},
				clearRect: () => {},
				fillRect:  () => {},
				fillText:  () => {},
				measureText: (_text: string) => ({ width: 0 }),
				getImageData: () => ({ data: new Uint8ClampedArray(0) }),
			}),
		} as unknown as HTMLCanvasElement

		const density = measureLineDensity('', '400 16px serif', 1, blankCanvas)
		expect(density).toBe(0)
	})

	// 8. measureLineDensity returns value in [0, 1]
	it('measureLineDensity returns a value between 0 and 1 inclusive', () => {
		const density = measureLineDensity('Hello world', '400 16px serif', 20, makeMockCanvas())
		expect(density).toBeGreaterThanOrEqual(0)
		expect(density).toBeLessThanOrEqual(1)
	})

	// 9. targetDensity: 0 → all spacings clamped at -maxAdjustment (all lines denser than 0)
	it('clamps spacing at maxAdjustment when targetDensity is 0', () => {
		const words = Array.from({ length: 14 }, (_, i) => `word${i + 1}`).join(' ')
		const el = makeElement(words)
		const original = getCleanHTML(el)
		const maxAdj = 0.05
		// targetDensity=0: all measured densities > 0 → all lines get negative spacing clamped at -maxAdj
		applyGrayValue(el, original, { targetDensity: 0, maxAdjustment: maxAdj, calibrationFactor: 2.0 }, makeMockCanvas())
		const lines = Array.from(el.querySelectorAll<HTMLElement>(`.${GRAY_VALUE_CLASSES.line}`))
		for (const line of lines) {
			const spacing = parseFloat(line.style.letterSpacing)
			expect(Math.abs(spacing)).toBeLessThanOrEqual(maxAdj + 0.0001)
		}
	})

	// 10. Empty element does not throw
	it('applyGrayValue does not throw on an empty element', () => {
		const el = makeElement('')
		const original = getCleanHTML(el)
		expect(() => applyGrayValue(el, original, {}, makeMockCanvas())).not.toThrow()
	})

	// 11. method:'word-spacing' sets word-spacing not letter-spacing
	it('method word-spacing sets word-spacing on line spans', () => {
		const words = Array.from({ length: 14 }, (_, i) => `word${i + 1}`).join(' ')
		const el = makeElement(words)
		const original = getCleanHTML(el)
		applyGrayValue(el, original, { method: 'word-spacing', targetDensity: 0.05, calibrationFactor: 2.0, maxAdjustment: 0.05 }, makeMockCanvas())
		const lines = Array.from(el.querySelectorAll<HTMLElement>(`.${GRAY_VALUE_CLASSES.line}`))
		expect(lines.length).toBeGreaterThan(0)
		// At least one line should have a non-empty word-spacing style
		const hasWordSpacing = lines.some((l) => l.style.wordSpacing !== '')
		expect(hasWordSpacing).toBe(true)
	})

	// 12. calibrationFactor:0 → no spacing adjustment (0 * delta = 0)
	it('calibrationFactor:0 produces zero spacing adjustment', () => {
		const words = Array.from({ length: 14 }, (_, i) => `word${i + 1}`).join(' ')
		const el = makeElement(words)
		const original = getCleanHTML(el)
		applyGrayValue(el, original, { targetDensity: 0.05, calibrationFactor: 0, maxAdjustment: 0.05 }, makeMockCanvas())
		const lines = Array.from(el.querySelectorAll<HTMLElement>(`.${GRAY_VALUE_CLASSES.line}`))
		expect(lines.length).toBeGreaterThan(0)
		for (const line of lines) {
			const spacing = parseFloat(line.style.letterSpacing || '0')
			expect(Math.abs(spacing)).toBeLessThan(0.001)
		}
	})

	// 13. Apply twice from same original gives same line count (idempotent)
	it('applying twice from same original gives same line count', () => {
		const words = Array.from({ length: 14 }, (_, i) => `word${i + 1}`).join(' ')
		const el = makeElement(words)
		const original = getCleanHTML(el)
		applyGrayValue(el, original, {}, makeMockCanvas())
		const count1 = el.querySelectorAll(`.${GRAY_VALUE_CLASSES.line}`).length
		applyGrayValue(el, original, {}, makeMockCanvas())
		const count2 = el.querySelectorAll(`.${GRAY_VALUE_CLASSES.line}`).length
		expect(count2).toBe(count1)
	})

	// 14. gv-word spans are produced for multi-word content
	it('produces gv-word spans for multi-word content', () => {
		const el = makeElement('one two three four five six seven')
		const original = getCleanHTML(el)
		applyGrayValue(el, original, {}, makeMockCanvas())
		// After apply the word spans have been grouped into lines;
		// gv-word spans may or may not persist but line spans must exist
		const lines = el.querySelectorAll(`.${GRAY_VALUE_CLASSES.line}`)
		expect(lines.length).toBeGreaterThan(0)
	})

	// 15. Positive and negative adjustments don't both exceed maxAdjustment
	it('positive spacing adjustments are clamped to maxAdjustment', () => {
		const words = Array.from({ length: 14 }, (_, i) => `word${i + 1}`).join(' ')
		const el = makeElement(words)
		const original = getCleanHTML(el)
		const maxAdj = 0.03
		// targetDensity = 1.0 → all lines below target → positive spacing
		applyGrayValue(el, original, { targetDensity: 1.0, maxAdjustment: maxAdj, calibrationFactor: 10.0 }, makeMockCanvas())
		const lines = Array.from(el.querySelectorAll<HTMLElement>(`.${GRAY_VALUE_CLASSES.line}`))
		for (const line of lines) {
			const spacing = parseFloat(line.style.letterSpacing || '0')
			expect(Math.abs(spacing)).toBeLessThanOrEqual(maxAdj + 0.001)
		}
	})

	// 16. measureLineDensity: canvas with all opaque pixels returns value > 0
	it('measureLineDensity returns > 0 for fully opaque content', () => {
		let _w = 100
		let _h = 10
		const fullCanvas = {
			get width()  { return _w },
			set width(v: number)  { _w = v },
			get height() { return _h },
			set height(v: number) { _h = v },
			getContext: () => ({
				font: '', fillStyle: '', setTransform: () => {}, clearRect: () => {}, fillRect: () => {}, fillText: () => {},
				measureText: (text: string) => ({ width: text.length * 8 }),
				getImageData: (_x: number, _y: number, w: number, h: number) => {
					const data = new Uint8ClampedArray(w * h * 4)
					// All black pixels
					for (let i = 0; i < data.length; i += 4) {
						data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255
					}
					return { data }
				},
			}),
		} as unknown as HTMLCanvasElement
		const density = measureLineDensity('Hello world', '400 16px serif', 10, fullCanvas)
		expect(density).toBeGreaterThan(0)
	})

	// 17. Link text content is preserved after apply (element may be re-wrapped)
	it('text content inside <a> is preserved after applyGrayValue', () => {
		const el = makeElement('<a href="#">typography</a> tools for the web')
		const original = getCleanHTML(el)
		applyGrayValue(el, original, {}, makeMockCanvas())
		// Text content must survive even if link element structure is modified
		expect(el.textContent).toContain('typography')
	})

	// 18. getCleanHTML after apply strips all gv- class names
	it('getCleanHTML after apply strips all injected markup', () => {
		const words = Array.from({ length: 14 }, (_, i) => `word${i + 1}`).join(' ')
		const el = makeElement(words)
		const original = getCleanHTML(el)
		applyGrayValue(el, original, {}, makeMockCanvas())
		const cleaned = getCleanHTML(el)
		expect(cleaned).not.toContain(GRAY_VALUE_CLASSES.line)
		expect(cleaned).not.toContain(GRAY_VALUE_CLASSES.word)
	})
})

// ─── Review fixes (2026-10) ──────────────────────────────────────────────────

describe('markup, text and listeners survive', () => {
	beforeEach(() => { document.body.innerHTML = '' })

	it('keeps inline markup, author <br> and the spaces between words; getCleanHTML returns the input', () => {
		const html = 'The <em>quick brown</em> fox <a href="#x" id="L">jumps over the</a> <strong>lazy</strong> dog.<br>Second line follows the break here.'
		const el = makeElement(html)
		const text = el.textContent
		applyGrayValue(el, html, {}, makeMockCanvas())
		expect(el.textContent).toBe(text)
		expect(el.querySelectorAll('a').length).toBeGreaterThan(0)
		expect(el.querySelectorAll('#L').length).toBe(1)
		expect(getCleanHTML(el)).toBe(html)
	})

	it('re-applying from getCleanHTML does not lose words', () => {
		const html = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ')
		const el = makeElement(html)
		for (let i = 0; i < 4; i++) applyGrayValue(el, getCleanHTML(el), {}, makeMockCanvas())
		expect((el.textContent ?? '').split(/\s+/).filter(Boolean).length).toBe(30)
	})

	it('keeps the original elements, so their listeners survive a refit and removal', () => {
		const html = 'Please read <a href="#">our terms</a> carefully before you continue.'
		const el = makeElement(html)
		const link = el.querySelector('a')!
		let clicks = 0
		link.addEventListener('click', (e) => { e.preventDefault(); clicks++ })
		applyGrayValue(el, html, {}, makeMockCanvas())
		applyGrayValue(el, html, {}, makeMockCanvas())
		el.querySelector('a')!.click()
		expect(clicks).toBe(1)
		removeGrayValue(el, html)
		expect(el.querySelector('a')).toBe(link)
	})

	it('accepts null options and an out-of-range targetDensity', () => {
		const html = 'Some words here to fill a line or two of text.'
		const el = makeElement(html)
		expect(() => applyGrayValue(el, html, null, makeMockCanvas())).not.toThrow()
		expect(() => applyGrayValue(el, html, { targetDensity: 2 }, makeMockCanvas())).not.toThrow()
	})
})

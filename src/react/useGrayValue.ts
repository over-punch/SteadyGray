// steadyGray/src/react/useGrayValue.ts — React hook that applies gray-value equalization and re-runs on resize and font load.
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { applyGrayValue, getCleanHTML } from '../core/adjust'
import type { GrayValueOptions } from '../core/types'

/**
 * React hook that applies the gray-value effect to a ref'd element.
 * Re-runs on width changes, after fonts load, and when any option changes.
 *
 * @param options    - GrayValueOptions
 * @param contentKey - A value that changes when the element's content changes (GrayValueText derives
 *                     one from its children). The library rewrites the element's DOM, so new content
 *                     needs a fresh element and a fresh snapshot.
 */
export function useGrayValue(options: GrayValueOptions = {}, contentKey?: string) {
	const ref = useRef<HTMLElement>(null)
	const originalHTMLRef = useRef<string | null>(null)
	/** The element originalHTMLRef was read from; a new element is read afresh. */
	const sourceElRef = useRef<HTMLElement | null>(null)
	const optionsRef = useRef(options)
	optionsRef.current = options

	// Every option is a dependency (serialised, so an inline object doesn't re-run every render).
	const optionsKey = JSON.stringify(options)

	const run = useCallback(() => {
		const el = ref.current
		if (!el) return
		if (originalHTMLRef.current === null || sourceElRef.current !== el) {
			originalHTMLRef.current = getCleanHTML(el)
			sourceElRef.current = el
		}
		applyGrayValue(el, originalHTMLRef.current, optionsRef.current)
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [optionsKey, contentKey])

	useLayoutEffect(() => {
		run()
		const el = ref.current
		if (!el || typeof ResizeObserver === 'undefined') return

		let lastWidth = 0
		let rafId = 0
		const ro = new ResizeObserver((entries) => {
			if (!entries.length) return
			const w = Math.round(entries[0].contentRect.width)
			if (w === lastWidth) return
			lastWidth = w
			cancelAnimationFrame(rafId)
			rafId = requestAnimationFrame(run)
		})
		ro.observe(el)
		return () => {
			ro.disconnect()
			cancelAnimationFrame(rafId)
		}
	}, [run])

	// Re-run after fonts finish loading (measurements before the swap use the fallback font).
	useEffect(() => {
		let unmounted = false
		document.fonts?.ready?.then(() => { if (!unmounted) run() }).catch(() => {})
		return () => { unmounted = true }
	}, [run])

	return ref
}

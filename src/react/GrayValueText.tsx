// steadyGray/src/react/GrayValueText.tsx — React component wrapper
import React, { Children, forwardRef, isValidElement, useCallback } from 'react'
import { useGrayValue } from './useGrayValue'
import type { GrayValueOptions } from '../core/types'

interface GrayValueTextProps extends GrayValueOptions, Omit<React.HTMLAttributes<HTMLElement>, 'children' | 'className' | 'style'> {
	children: React.ReactNode
	className?: string
	style?: React.CSSProperties
	as?: React.ElementType
}

/** GrayValueOptions keys: consumed by the hook, not forwarded to the DOM element. */
const OPTION_KEYS: (keyof GrayValueOptions)[] = [
	'active', 'densityMode', 'fontUrl', 'lineDetection', 'targetDensity', 'method', 'maxAdjustment',
	'tolerance', 'calibrationFactor', 'linePreservation', 'mode', 'complexity', 'strength',
]

/**
 * A string that changes whenever the rendered content of `children` changes: text, element types,
 * keys and primitive props, walked recursively. Functions and objects are ignored.
 */
function childrenSignature(children: React.ReactNode): string {
	const parts: string[] = []
	const walk = (node: React.ReactNode) => {
		Children.forEach(node, (child) => {
			if (child === null || child === undefined || typeof child === 'boolean') return
			if (typeof child === 'string' || typeof child === 'number') { parts.push(String(child)); return }
			if (isValidElement(child)) {
				const type = typeof child.type === 'string' ? child.type : ((child.type as { displayName?: string; name?: string }).displayName ?? (child.type as { name?: string }).name ?? 'C')
				const props = child.props as Record<string, unknown>
				const attrs = Object.keys(props).filter((k) => k !== 'children' && ['string', 'number', 'boolean'].includes(typeof props[k])).sort().map((k) => `${k}=${String(props[k])}`)
				parts.push(`<${type}${child.key != null ? '#' + child.key : ''} ${attrs.join(' ')}>`)
				walk(props.children as React.ReactNode)
				parts.push(`</${type}>`)
			}
		})
	}
	walk(children)
	return parts.join('\u0000')
}

/**
 * Drop-in component that applies the gray-value effect to its children.
 */
export const GrayValueText = forwardRef<HTMLElement, GrayValueTextProps>(
	function GrayValueText({ children, className, style, as: Tag = 'p', ...rest }, forwardedRef) {
		// Algorithm options go to the hook; everything else (id, aria-*, data-*, lang…) to the element.
		const options: GrayValueOptions = {}
		const htmlProps: Record<string, unknown> = {}
		for (const [key, value] of Object.entries(rest)) {
			if ((OPTION_KEYS as string[]).includes(key)) (options as Record<string, unknown>)[key] = value
			else htmlProps[key] = value
		}
		// The library replaces the element's DOM, so React can't patch new children into it. When the
		// children's content changes, remount the element (key) and re-apply to the fresh content.
		const contentKey = childrenSignature(children)
		const innerRef = useGrayValue(options, contentKey)

		// Merge the hook's internal ref with the forwarded ref so both are satisfied.
		const mergedRef = useCallback(
			(node: HTMLElement | null) => {
				;(innerRef as React.MutableRefObject<HTMLElement | null>).current = node
				if (typeof forwardedRef === 'function') {
					forwardedRef(node)
				} else if (forwardedRef) {
					forwardedRef.current = node
				}
			},
			// eslint-disable-next-line react-hooks/exhaustive-deps
			[innerRef, forwardedRef],
		)

		return (
			<Tag key={contentKey} ref={mergedRef as React.Ref<HTMLElement>} className={className} style={style} {...htmlProps}>
				{children}
			</Tag>
		)
	},
)

GrayValueText.displayName = 'GrayValueText'

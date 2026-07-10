// steadyGray/src/framer/SteadyGray.tsx — Framer code component wrapping the steadyGray core.
//
// Distribution: paste this file into Framer (Insert → Code → New Component), or host it as an
// ES module and add it by URL. It imports the framework-agnostic core straight from the CDN, so
// it needs no build step — the core functions take a DOM element, not React, so there is no
// React version/externalisation issue.
//
// steadyGray is an APPLY-ONCE tool: applyGrayValue measures per-line optical density against the
// live layout and rewrites the paragraph once. There is no rAF animation loop (unlike floodText),
// so there is no RenderTarget animate/static gate — the single static rewrite is correct on the
// canvas, in preview, and on export alike. The rendering logic mirrors the proven `useGrayValue`
// hook (snapshot clean HTML, applyGrayValue in an effect, removeGrayValue on cleanup); the only
// Framer-specific additions are the property controls and layout annotations.
import { useEffect, useRef } from "react"
import { addPropertyControls, ControlType } from "framer"
// Pin to a published version so shared instances stay stable. Bump when the core changes.
// The core is framework-agnostic (operates on a DOM element), so no React externalisation is needed.
import { applyGrayValue, removeGrayValue, getCleanHTML } from "https://esm.sh/@liiift-studio/steadygray@1.2.5"

/** Props surfaced to the Framer UI via addPropertyControls, plus base text styling.
 *  Option fields are declared explicitly so the component needs no type import over HTTP. */
interface SteadyGrayFramerProps {
	/** The paragraph text to equalize. Needs multiple wrapped lines to have an effect. */
	text: string
	/** CSS font-family. For 'font-weight'/'font-width' methods this MUST be a variable font. */
	fontFamily: string
	/** Font size in px. */
	fontSize: number
	/** Text colour. */
	color: string
	/** Horizontal text alignment. */
	textAlign: "left" | "center" | "right"
	/** When false, skip all processing and restore the original text. */
	active: boolean
	/** Density measurement method. */
	densityMode: "canvas" | "glyph-path"
	/** Font file URL for glyph-path measurement. Must be same-origin/CORS-enabled. */
	fontUrl: string
	/** Line detection method. */
	lineDetection: "bcr" | "canvas"
	/** When true, target density is the auto average of all lines; else use targetDensity. */
	autoTarget: boolean
	/** Explicit target optical density ratio (0–1), used only when autoTarget is false. */
	targetDensity: number
	/** Which CSS property to adjust per line. */
	method: "letter-spacing" | "word-spacing" | "font-weight" | "font-width"
	/** Maximum adjustment magnitude — unit depends on method (em / weight / wdth units). */
	maxAdjustment: number
	/** Minimum calibrated adjustment below which no change is applied. */
	tolerance: number
	/** Linear scaling factor: spacing change per 1.0 density unit difference. */
	calibrationFactor: number
	/** Line-width preservation strategy after correction. */
	linePreservation: "none" | "scale"
	/** Algorithm mode: equalize all lines, or readability-weighted targets. */
	mode: "equalize" | "readability"
	/** Complexity metric used in readability mode. */
	complexity: "word-length" | "syllable" | "pos"
	/** How aggressively to weight complex lines in readability mode (0–1). */
	strength: number
}

/**
 * Paragraph optical density equalization, as a Framer code component.
 *
 * @framerSupportedLayoutWidth any-prefer-fixed
 * @framerSupportedLayoutHeight auto
 */
export default function SteadyGray(props: Partial<SteadyGrayFramerProps>) {
	const {
		text = "The quick brown fox jumps over the lazy dog while a heavy grey cloud drifts slowly across the wide open sky above the quiet valley below",
		fontFamily = "Georgia, serif",
		fontSize = 28,
		color = "#111111",
		textAlign = "left",
		active = true,
		densityMode = "canvas",
		fontUrl = "",
		lineDetection = "bcr",
		autoTarget = true,
		targetDensity = 0.5,
		method = "letter-spacing",
		maxAdjustment = 0.05,
		tolerance = 0.01,
		calibrationFactor = 2,
		linePreservation = "none",
		mode = "equalize",
		complexity = "word-length",
		strength = 0.5,
	} = props

	const ref = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const el = ref.current
		if (!el) return

		// Snapshot the clean, unprocessed HTML before the first rewrite so re-runs and
		// cleanup can restore it exactly.
		const original = getCleanHTML(el)

		const options = {
			active,
			densityMode,
			// fontUrl is only meaningful in glyph-path mode; omit when empty.
			...(fontUrl ? { fontUrl } : {}),
			lineDetection,
			// 'auto' string vs an explicit numeric target — collapse the boolean toggle here.
			targetDensity: autoTarget ? ("auto" as const) : targetDensity,
			method,
			maxAdjustment,
			tolerance,
			calibrationFactor,
			linePreservation,
			mode,
			complexity,
			strength,
		}

		// Apply-once: measure the live layout and rewrite the paragraph a single time.
		// steadyGray has no animation loop, so there is no RenderTarget gate — the static
		// result is correct on canvas, in preview, and on export.
		applyGrayValue(el, original, options)

		return () => {
			removeGrayValue(el, original)
		}
	}, [
		text,
		active,
		densityMode,
		fontUrl,
		lineDetection,
		autoTarget,
		targetDensity,
		method,
		maxAdjustment,
		tolerance,
		calibrationFactor,
		linePreservation,
		mode,
		complexity,
		strength,
		fontFamily,
		fontSize,
	])

	return (
		<div
			ref={ref}
			style={{
				fontFamily,
				fontSize,
				color,
				textAlign,
				lineHeight: 1.4,
				width: "100%",
			}}
		>
			{text}
		</div>
	)
}

// Map every meaningful GrayValueOptions field to a Framer control.
addPropertyControls(SteadyGray, {
	text: {
		type: ControlType.String,
		title: "Text",
		defaultValue:
			"The quick brown fox jumps over the lazy dog while a heavy grey cloud drifts slowly across the wide open sky above the quiet valley below",
		displayTextArea: true,
	},
	fontFamily: {
		type: ControlType.String,
		title: "Font",
		defaultValue: "Georgia, serif",
		description: "Use a variable font for the font-weight / font-width methods.",
	},
	fontSize: { type: ControlType.Number, title: "Size", defaultValue: 28, min: 8, max: 200, unit: "px" },
	color: { type: ControlType.Color, title: "Colour", defaultValue: "#111111" },
	textAlign: {
		type: ControlType.Enum,
		title: "Align",
		options: ["left", "center", "right"],
		optionTitles: ["Left", "Center", "Right"],
		defaultValue: "left",
		displaySegmentedControl: true,
	},
	active: { type: ControlType.Boolean, title: "Active", defaultValue: true },
	method: {
		type: ControlType.Enum,
		title: "Method",
		options: ["letter-spacing", "word-spacing", "font-weight", "font-width"],
		optionTitles: ["Letter spacing", "Word spacing", "Font weight", "Font width"],
		defaultValue: "letter-spacing",
	},
	maxAdjustment: {
		type: ControlType.Number,
		title: "Max adjust",
		defaultValue: 0.05,
		min: 0,
		max: 200,
		step: 0.005,
		description: "Unit depends on method: em (spacing), weight units, or wdth units.",
	},
	tolerance: { type: ControlType.Number, title: "Tolerance", defaultValue: 0.01, min: 0, max: 0.5, step: 0.005 },
	calibrationFactor: { type: ControlType.Number, title: "Calibration", defaultValue: 2, min: 0.1, max: 2000, step: 0.1 },
	autoTarget: {
		type: ControlType.Boolean,
		title: "Auto target",
		defaultValue: true,
		description: "On: target the average line density. Off: use the target below.",
	},
	targetDensity: {
		type: ControlType.Number,
		title: "Target",
		defaultValue: 0.5,
		min: 0,
		max: 1,
		step: 0.01,
		hidden: (p: Partial<SteadyGrayFramerProps>) => p.autoTarget !== false,
	},
	linePreservation: {
		type: ControlType.Enum,
		title: "Line width",
		options: ["none", "scale"],
		optionTitles: ["None", "Scale to fit"],
		defaultValue: "none",
	},
	mode: {
		type: ControlType.Enum,
		title: "Mode",
		options: ["equalize", "readability"],
		optionTitles: ["Equalize", "Readability"],
		defaultValue: "equalize",
	},
	complexity: {
		type: ControlType.Enum,
		title: "Complexity",
		options: ["word-length", "syllable", "pos"],
		optionTitles: ["Word length", "Syllable", "POS"],
		defaultValue: "word-length",
		hidden: (p: Partial<SteadyGrayFramerProps>) => p.mode !== "readability",
	},
	strength: {
		type: ControlType.Number,
		title: "Strength",
		defaultValue: 0.5,
		min: 0,
		max: 1,
		step: 0.05,
		hidden: (p: Partial<SteadyGrayFramerProps>) => p.mode !== "readability",
	},
	densityMode: {
		type: ControlType.Enum,
		title: "Density mode",
		options: ["canvas", "glyph-path"],
		optionTitles: ["Canvas", "Glyph path"],
		defaultValue: "canvas",
	},
	fontUrl: {
		type: ControlType.String,
		title: "Font URL",
		defaultValue: "",
		description: "Font file for glyph-path measurement (same-origin / CORS).",
		hidden: (p: Partial<SteadyGrayFramerProps>) => p.densityMode !== "glyph-path",
	},
	lineDetection: {
		type: ControlType.Enum,
		title: "Line detect",
		options: ["bcr", "canvas"],
		optionTitles: ["BCR", "Canvas"],
		defaultValue: "bcr",
	},
})

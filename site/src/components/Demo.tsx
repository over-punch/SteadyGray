"use client"

// Interactive gray value demo with cursor/gyro/ambient-light modes, drag-to-inspect circle, and live controls
import { useState, useEffect, useDeferredValue, useRef, useCallback, useMemo } from "react"
import { useMediaQuery, useClientValue } from "@/lib/clientValue"
import { GrayValueText } from "@liiift-studio/steadygray"

const SAMPLE = `The colour of a page — the compositor’s term for the aggregate grey of the text block — is determined by the ratio of ink to space across every line. A line with many narrow letters sits lighter than one with wide letters and generous spacing. Print compositors corrected this by hand, adjusting word spaces to equalise the grey. No web tool has automated this measurement. Gray Value uses Canvas to sample the actual ink pixels in each rendered line, then adjusts letter-spacing to bring every line to the same optical density. The adjustment is invisible when correct — all you notice is that the paragraph looks even.`

const INSPECTOR_R = 96

/** Map a lux value to a human-readable ambient light label */
function luxLabel(lux: number): string {
	if (lux < 100) return "Dark room"
	if (lux < 1000) return "Indoor"
	if (lux < 10000) return "Overcast"
	if (lux < 30000) return "Outdoor"
	return "Direct sun"
}

/** Derive calibrationFactor from lux: 0.5 (dark) → 5.0 (bright sun) */
function luxToCalibration(lux: number): number {
	return parseFloat((0.5 + (lux / 50000) * 4.5).toFixed(1))
}

/** Labelled range slider with value displayed below the track */
function Slider({ label, value, min, max, step, onChange, fmt, dimmed, title, describedBy }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string; dimmed?: boolean; title?: string; describedBy?: string }) {
	const valueId = `${label.replace(/\s+/g, '-').toLowerCase()}-value`
	return (
		<div className="flex flex-col gap-1" style={{ opacity: dimmed ? 0.4 : 1, transition: 'opacity 0.2s ease' }}>
			<span className="text-xs uppercase tracking-[0.18em] font-medium text-muted">{label}</span>
			<input
				type="range" min={min} max={max} step={step} value={value}
				aria-label={label} aria-describedby={`${valueId}${describedBy ? ` ${describedBy}` : ''}`}
				title={title}
				onChange={e => onChange(Number(e.target.value))}
				style={{ touchAction: 'pan-y', pointerEvents: dimmed ? 'none' : undefined }}
				disabled={dimmed}
			/>
			<span id={valueId} className="tabular-nums text-xs text-muted text-right">{fmt ? fmt(value) : value}</span>
		</div>
	)
}

/** Before/after toggle — left half = without effect, right half filled = with effect */
function BeforeAfterToggle({ active, onClick }: { active: boolean; onClick: () => void }) {
	return (
		<button
			onClick={onClick}
			aria-label={active ? 'Comparison active — hide' : 'Toggle before/after comparison'}
			aria-pressed={active}
			title={active ? 'Hide comparison' : 'Compare without effect'}
			style={{
				position: 'absolute', bottom: 0, right: 0,
				width: 32, height: 32, borderRadius: '50%',
				border: '1px solid currentColor',
				opacity: active ? 0.8 : 0.25,
				background: 'transparent',
				display: 'flex', alignItems: 'center', justifyContent: 'center',
				cursor: 'pointer', transition: 'opacity 0.15s ease',
			}}
		>
			<svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden="true">
				<rect aria-hidden="true" x="0.5" y="0.5" width="13" height="9" rx="1" stroke="currentColor" strokeWidth="1"/>
				<line aria-hidden="true" x1="7" y1="0.5" x2="7" y2="9.5" stroke="currentColor" strokeWidth="1"/>
				<rect aria-hidden="true" x="8" y="1.5" width="5" height="7" fill="currentColor"/>
			</svg>
		</button>
	)
}

/** Cursor icon SVG */
function CursorIcon() {
	return (
		<svg width="11" height="14" viewBox="0 0 11 14" fill="currentColor" aria-hidden>
			<path d="M0 0L0 11L3 8L5 13L6.8 12.3L4.8 7.3L8.5 7.3Z" />
		</svg>
	)
}

/** Gyroscope icon SVG — circle with rotation arrow */
function GyroIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
			<circle cx="7" cy="7" r="5.5" />
			<circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none" />
			<path d="M7 1.5 A5.5 5.5 0 0 1 12.5 7" strokeWidth="1.4" />
			<path d="M11.5 5.5 L12.5 7 L13.8 6" strokeWidth="1.2" />
		</svg>
	)
}

/** Sun icon SVG — for ambient light mode */
function SunIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
			<circle cx="7" cy="7" r="2.5" />
			<line x1="7" y1="0.5" x2="7" y2="2.5" />
			<line x1="7" y1="11.5" x2="7" y2="13.5" />
			<line x1="0.5" y1="7" x2="2.5" y2="7" />
			<line x1="11.5" y1="7" x2="13.5" y2="7" />
			<line x1="2.4" y1="2.4" x2="3.8" y2="3.8" />
			<line x1="10.2" y1="10.2" x2="11.6" y2="11.6" />
			<line x1="11.6" y1="2.4" x2="10.2" y2="3.8" />
			<line x1="3.8" y1="10.2" x2="2.4" y2="11.6" />
		</svg>
	)
}

type Method = 'letter-spacing' | 'word-spacing' | 'font-weight' | 'font-width'

/** Default max adjustment and calibration factor per method. */
const METHOD_DEFAULTS: Record<Method, { max: number; cal: number }> = {
	'letter-spacing': { max: 0.05,  cal: 2    },
	'word-spacing':   { max: 0.05,  cal: 2    },
	'font-weight':    { max: 100,   cal: 1000 },
	'font-width':     { max: 20,    cal: 500  },
}

/** Slider config (min/max/step/decimals) for the maxAdjustment slider per method. */
const MAX_ADJ_CFG: Record<Method, { min: number; max: number; step: number; decimals: number; unit: string }> = {
	'letter-spacing': { min: 0.005, max: 0.15, step: 0.005, decimals: 3, unit: 'em'   },
	'word-spacing':   { min: 0.005, max: 0.15, step: 0.005, decimals: 3, unit: 'em'   },
	'font-weight':    { min: 10,    max: 300,  step: 5,     decimals: 0, unit: 'wt'   },
	'font-width':     { min: 1,     max: 50,   step: 0.5,   decimals: 1, unit: 'wdth' },
}

/** Slider config for the calibrationFactor slider per method. */
const CAL_CFG: Record<Method, { min: number; max: number; step: number; decimals: number }> = {
	'letter-spacing': { min: 0.5,  max: 5,    step: 0.1,  decimals: 1 },
	'word-spacing':   { min: 0.5,  max: 5,    step: 0.1,  decimals: 1 },
	'font-weight':    { min: 100,  max: 3000, step: 100,  decimals: 0 },
	'font-width':     { min: 50,   max: 2000, step: 50,   decimals: 0 },
}

export default function Demo() {
	const [maxAdjustment, setMaxAdjustment] = useState(0.05)
	const [calibrationFactor, setCalibrationFactor] = useState(2.0)
	const [method, setMethod] = useState<Method>('letter-spacing')
	const [beforeAfter, setComparing] = useState(false)

	// Interaction modes — mutually exclusive
	const [cursorMode, setCursorMode] = useState(false)
	const [gyroMode, setGyroMode] = useState(false)
	const [ambientMode, setAmbientMode] = useState(false)

	// Lux value for ambient light simulation (0–50000, default 500)
	const [lux, setLux] = useState(500)

	// Gyro-driven maxAdjustment — kept separate from slider state so slider value props
	// never change during gyro mode (preventing mobile scroll-to-input on orientation update)
	const [gyroMaxAdjustment, setGyroMaxAdjustment] = useState(0.05)

	// Detected capabilities — resolved client-side after mount
	const showCursor = useMediaQuery('(hover: hover)')
	const isTouch = useMediaQuery('(hover: none)')
	const hasOrientation = useClientValue(() => 'DeviceOrientationEvent' in window, false)
	const showGyro = isTouch && hasOrientation

	// Blur circle position as fraction of container (0–1)
	const [circlePos, setCirclePos] = useState({ x: 0.5, y: 0.5 })
	const [hasDragged, setHasDragged] = useState(false)
	const dragging = useRef(false)
	const containerRef = useRef<HTMLDivElement>(null)

	const handleCirclePointerDown = useCallback((e: React.PointerEvent) => {
		e.currentTarget.setPointerCapture(e.pointerId)
		dragging.current = true
	}, [])
	const handleCirclePointerMove = useCallback((e: React.PointerEvent) => {
		if (!dragging.current || !containerRef.current) return
		if (!hasDragged) setHasDragged(true)
		const rect = containerRef.current.getBoundingClientRect()
		setCirclePos({
			x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
			y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
		})
	}, [hasDragged])
	const handleCirclePointerUp = useCallback(() => { dragging.current = false }, [])

	// Effective calibrationFactor: ambient-driven when ambientMode is active, slider-driven otherwise
	const effectiveCalibration = useMemo(
		() => ambientMode ? luxToCalibration(lux) : calibrationFactor,
		[ambientMode, lux, calibrationFactor]
	)

	// Effective maxAdjustment: gyro-driven when gyroMode is active, slider-driven otherwise
	const effectiveMax = gyroMode ? gyroMaxAdjustment : maxAdjustment

	const dMax = useDeferredValue(effectiveMax)
	const dCal = useDeferredValue(effectiveCalibration)
	const dMethod = useDeferredValue(method)

	// Cursor mode — Y controls maxAdjustment relative to the demo container (not window height)
	// Using container rect avoids sudden jumps when browser chrome resizes on mobile scroll
	useEffect(() => {
		if (!cursorMode) return
		const handleMove = (e: MouseEvent) => {
			const rect = containerRef.current?.getBoundingClientRect()
			if (!rect) {
				// Fallback: map against viewport if container is not yet measured
				setMaxAdjustment(parseFloat((0.01 + (1 - e.clientY / window.innerHeight) * 0.14).toFixed(3)))
				return
			}
			const relY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
			setMaxAdjustment(parseFloat((0.01 + (1 - relY) * 0.14).toFixed(3)))
		}
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setCursorMode(false)
		}
		window.addEventListener('mousemove', handleMove)
		window.addEventListener('keydown', handleKey)
		return () => {
			window.removeEventListener('mousemove', handleMove)
			window.removeEventListener('keydown', handleKey)
		}
	}, [cursorMode])

	// Gyro mode — beta (front/back tilt) controls maxAdjustment.
	// beta clamped [15, 90]: tilt forward (smaller beta) = lower adjustment, upright = higher.
	// Uses gyroMaxAdjustment so slider value props stay frozen during orientation events.
	// rAF throttle limits re-renders to one per frame.
	useEffect(() => {
		if (!gyroMode) return
		let rafId: number | null = null
		const handleOrientation = (e: DeviceOrientationEvent) => {
			if (rafId !== null) return
			rafId = requestAnimationFrame(() => {
				rafId = null
				if (e.beta !== null) {
					// beta [15, 90] → maxAdjustment [0.01, 0.15]
					const clamped = Math.max(15, Math.min(90, e.beta))
					setGyroMaxAdjustment(parseFloat((0.01 + ((clamped - 15) / 75) * 0.14).toFixed(3)))
				}
			})
		}
		window.addEventListener('deviceorientation', handleOrientation)
		return () => {
			window.removeEventListener('deviceorientation', handleOrientation)
			if (rafId !== null) cancelAnimationFrame(rafId)
		}
	}, [gyroMode])

	// Gyro permission denied state — shown briefly on the button
	const [gyroDenied, setGyroDenied] = useState(false)

	// Change method and reset max/calibration to per-method defaults
	const changeMethod = useCallback((m: Method) => {
		setMethod(m)
		setMaxAdjustment(METHOD_DEFAULTS[m].max)
		setCalibrationFactor(METHOD_DEFAULTS[m].cal)
	}, [])

	// Toggle cursor mode — turns off gyro and ambient if active
	const toggleCursor = useCallback(() => {
		setGyroMode(false)
		setAmbientMode(false)
		setCursorMode(v => !v)
	}, [])

	// Toggle gyro mode — requests iOS permission if needed, turns off cursor and ambient if active
	const toggleGyro = useCallback(async () => {
		if (gyroMode) {
			setGyroMode(false)
			return
		}
		setCursorMode(false)
		setAmbientMode(false)
		const DOE = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
			requestPermission?: () => Promise<PermissionState>
		}
		try {
			if (typeof DOE.requestPermission === 'function') {
				const permission = await DOE.requestPermission()
				if (permission === 'granted') {
					setGyroMode(true)
				} else {
					// Show "Permission denied" on the button briefly
					setGyroDenied(true)
					setTimeout(() => setGyroDenied(false), 2500)
				}
			} else {
				setGyroMode(true)
			}
		} catch {
			setGyroDenied(true)
			setTimeout(() => setGyroDenied(false), 2500)
		}
	}, [gyroMode])

	// Toggle ambient mode — turns off cursor and gyro if active
	const toggleAmbient = useCallback(() => {
		setCursorMode(false)
		setGyroMode(false)
		setAmbientMode(v => !v)
	}, [])

	// In font-weight mode, use font-weight (not fontVariationSettings) so per-line
	// weight adjustments on child spans are not overridden by an inherited "wght" axis.
	const sampleStyle = useMemo<React.CSSProperties>(() => method === 'font-weight'
		? {
			fontFamily: "var(--font-merriweather), serif",
			fontSize: "1.125rem",
			lineHeight: "1.8",
			fontWeight: 300,
		}
		: {
			fontFamily: "var(--font-merriweather), serif",
			fontSize: "1.125rem",
			lineHeight: "1.8",
			fontVariationSettings: '"wght" 300, "opsz" 18, "wdth" 100',
		}, [method])


	// Memoised method button titles to avoid recreation on every render
	const METHOD_TITLES = useMemo<Record<Method, string>>(() => ({
		'letter-spacing': 'Equalise line colour by nudging the space between individual characters — works with any font',
		'word-spacing':   'Equalise line colour by nudging the space between words — subtler than letter-spacing on ragged lines',
		'font-weight':    'Equalise line colour by varying font weight per line — requires a variable font with a wght axis',
		'font-width':     'Equalise line colour by varying the condensed-to-extended width of each line — requires a variable font with a wdth axis',
	}), [])

	return (
		<div className="w-full">
			{/* Screen reader live region — announces mode changes */}
			<div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
				{cursorMode ? 'Cursor mode active. Move cursor up or down to adjust max correction. Press Escape to exit.' :
				 gyroMode   ? 'Gyro mode active. Tilt device front and back to adjust max correction.' :
				 ambientMode ? 'Ambient mode active. Use the lux slider to simulate lighting conditions.' : ''}
			</div>

			<div className="grid grid-cols-2 gap-6 mb-6">
				<Slider
					label={`Max adjustment (${MAX_ADJ_CFG[method].unit})`}
					value={maxAdjustment}
					min={MAX_ADJ_CFG[method].min}
					max={MAX_ADJ_CFG[method].max}
					step={MAX_ADJ_CFG[method].step}
					onChange={setMaxAdjustment}
					fmt={v => `${v.toFixed(MAX_ADJ_CFG[method].decimals)} ${MAX_ADJ_CFG[method].unit}`}
					title="Maximum allowed adjustment per line — larger values let steadyGray correct more unevenly-coloured lines, but may produce noticeable spacing shifts"
				/>
				<Slider
					label="Sensitivity"
					value={calibrationFactor}
					min={CAL_CFG[method].min}
					max={CAL_CFG[method].max}
					step={CAL_CFG[method].step}
					onChange={setCalibrationFactor}
					fmt={v => v.toFixed(CAL_CFG[method].decimals)}
					dimmed={ambientMode}
					describedBy={ambientMode ? 'sensitivity-ambient-note' : undefined}
					title="Controls how aggressively pixel-density differences between lines are interpreted — higher values cause steadyGray to treat lighter lines as more unequal and apply stronger corrections"
				/>
				{ambientMode && (
					<span id="sensitivity-ambient-note" className="sr-only">
						Sensitivity is controlled automatically by the ambient light slider in ambient mode.
					</span>
				)}
			</div>
			<div role="radiogroup" aria-label="Adjustment method" className="flex flex-wrap items-center gap-3 mb-4">
				<span className="text-xs uppercase tracking-[0.18em] font-medium text-muted" aria-hidden="true">Method</span>
				{(['letter-spacing', 'word-spacing', 'font-weight', 'font-width'] as const).map(v => (
					<button
						key={v}
						role="radio"
						aria-checked={method === v}
						onClick={() => changeMethod(v)}
						className="text-xs px-3 py-1 rounded-full border transition-opacity"
						style={{ borderColor: 'currentColor', opacity: method === v ? 1 : 0.5, background: method === v ? 'var(--btn-bg)' : 'transparent' }}
						title={METHOD_TITLES[v]}
					>{v}</button>
				))}

				{/* Cursor mode — desktop/hover-capable devices only */}
				{showCursor && (
					<button
						onClick={toggleCursor}
						aria-pressed={cursorMode}
						title="Move cursor vertically to control max adjustment"
						className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border transition-all ml-auto"
						style={{
							borderColor: 'currentColor',
							opacity: cursorMode ? 1 : 0.5,
							background: cursorMode ? 'var(--btn-bg)' : 'transparent',
						}}
					>
						<CursorIcon />
						<span>{cursorMode ? 'Esc to exit' : 'Cursor'}</span>
					</button>
				)}

				{/* Gyro mode — touch devices with DeviceOrientationEvent */}
				{showGyro && (
					<button
						onClick={toggleGyro}
						aria-pressed={gyroMode}
						title="Tilt your device front/back to control max adjustment"
						className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border transition-all ml-auto"
						style={{
							borderColor: 'currentColor',
							opacity: gyroMode || gyroDenied ? 1 : 0.5,
							background: gyroMode ? 'var(--btn-bg)' : 'transparent',
						}}
					>
						<GyroIcon />
						<span>{gyroDenied ? 'Permission denied' : gyroMode ? 'Tilt active' : 'Gyro'}</span>
					</button>
				)}

				{/* Ambient light mode — always shown */}
				<button
					onClick={toggleAmbient}
					aria-pressed={ambientMode}
					title="Simulate ambient light conditions affecting perceived contrast"
					className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border transition-all"
					style={{
						borderColor: 'currentColor',
						opacity: ambientMode ? 1 : 0.5,
						background: ambientMode ? 'var(--btn-bg)' : 'transparent',
						marginLeft: showCursor || showGyro ? undefined : 'auto',
					}}
				>
					<SunIcon />
					<span>Ambient</span>
				</button>
			</div>

			{/* Lux slider — visible only in ambient mode; finer step at lower values */}
			{ambientMode && (
				<div className="mb-6">
					<Slider
						label="Ambient light (lux)"
						value={lux}
						min={0}
						max={50000}
						step={lux < 500 ? 10 : 100}
						onChange={setLux}
						fmt={v => `${v.toLocaleString()} lx — ${luxLabel(v)}  →  sensitivity ${luxToCalibration(v).toFixed(1)}`}
						title="Simulates the brightness of the surrounding environment — brighter conditions bleed background into type and require a higher sensitivity to maintain even typographic colour"
					/>
				</div>
			)}

			{/* Inspector wrapper — draggable blur circle; compare overlay and button sit inside */}
			<div ref={containerRef} className="relative pb-8" style={{ marginTop: ambientMode ? 0 : undefined }}>
				<GrayValueText maxAdjustment={dMax} calibrationFactor={dCal} method={dMethod} style={sampleStyle}>
					{SAMPLE}
				</GrayValueText>
				{beforeAfter && (
					<p aria-hidden style={{ ...sampleStyle, position: 'absolute', top: 0, left: 0, width: '100%', margin: 0, opacity: 0.25, pointerEvents: 'none' }}>{SAMPLE}</p>
				)}
				{/* Inspector circle — only rendered when beforeAfter comparison is active */}
				{beforeAfter && (
					<>
						<div
							role="application"
							aria-label="Inspector lens — drag to compare adjusted and unadjusted rendering"
							tabIndex={0}
							title="Drag this lens across the paragraph to compare adjusted and unadjusted rendering side by side through a blurred viewport"
							onPointerDown={handleCirclePointerDown}
							onPointerMove={handleCirclePointerMove}
							onPointerUp={handleCirclePointerUp}
							onKeyDown={e => {
								const step = 0.05
								if (e.key === 'ArrowLeft')  setCirclePos(p => ({ ...p, x: Math.max(0, p.x - step) }))
								if (e.key === 'ArrowRight') setCirclePos(p => ({ ...p, x: Math.min(1, p.x + step) }))
								if (e.key === 'ArrowUp')    setCirclePos(p => ({ ...p, y: Math.max(0, p.y - step) }))
								if (e.key === 'ArrowDown')  setCirclePos(p => ({ ...p, y: Math.min(1, p.y + step) }))
							}}
							style={{
								position: 'absolute',
								left: `${circlePos.x * 100}%`,
								top: `${circlePos.y * 100}%`,
								transform: 'translate(-50%, -50%)',
								width: INSPECTOR_R * 2,
								height: INSPECTOR_R * 2,
								borderRadius: '50%',
								backdropFilter: 'blur(7px)',
								WebkitBackdropFilter: 'blur(7px)',
								border: '1px solid var(--panel)',
								boxShadow: '0 0 0 1px var(--panel)',
								cursor: 'grab',
								touchAction: 'none',
							}}
						/>
						{!hasDragged && (
							<p
								aria-hidden
								style={{
									position: 'absolute',
									left: `${circlePos.x * 100}%`,
									top: `${circlePos.y * 100}%`,
									transform: 'translate(-50%, 20px)',
									fontSize: 11,
									opacity: 0.4,
									pointerEvents: 'none',
									whiteSpace: 'nowrap',
									margin: 0,
								}}
							>
								drag to inspect
							</p>
						)}
					</>
				)}
				<BeforeAfterToggle active={beforeAfter} onClick={() => setComparing(v => !v)} />
			</div>

			{/* Caption — uses non-deferred method so it reflects the click immediately */}
			<div className="flex items-center gap-3 mt-8">
				{ambientMode ? (
					<p className="text-xs text-muted italic" style={{ lineHeight: "1.8" }}>
						Ambient light simulation for smart glasses: at {lux.toLocaleString()} lx ({luxLabel(lux)}), high ambient light bleeds background into text, requiring a sensitivity of {luxToCalibration(lux).toFixed(1)} to maintain even optical density.
					</p>
				) : cursorMode ? (
					<p className="text-xs text-muted italic" style={{ lineHeight: "1.8" }}>
						Move cursor up/down to adjust max adjustment. Press Esc to exit.
					</p>
				) : gyroMode ? (
					<p className="text-xs text-muted italic" style={{ lineHeight: "1.8" }}>
						Tilt front/back to adjust max adjustment.
					</p>
				) : (
					<p className="text-xs text-muted italic" style={{ lineHeight: "1.8" }}>
						{method === 'font-weight' || method === 'font-width'
							? `Each line is measured by pixel density and adjusted by ±${effectiveMax.toFixed(MAX_ADJ_CFG[method].decimals)} ${MAX_ADJ_CFG[method].unit} via ${method}. Requires a variable font with a ${method === 'font-weight' ? 'wght' : 'wdth'} axis for continuous adjustment.`
							: `Each line is measured by pixel density and adjusted by ±${effectiveMax.toFixed(3)} em via ${method}. E-ink displays and automotive HUDs benefit most — on e-ink, ambient light determines perceived contrast directly; on a windshield HUD, glare can wash out undifferentiated paragraphs entirely.`
						}
					</p>
				)}
			</div>
		</div>
	)
}

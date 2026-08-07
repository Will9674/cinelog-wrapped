import { useMemo, useRef, useState, useCallback, useLayoutEffect, createContext, useContext } from 'react'
import {
  lensUsage, supportUsage, cameraUsage, filterUsage,
  takesPerDay, deduplicateShots, getCameraColorByIndex,
} from '../utils/stats'
import { fmtDate, shortFilterName, headlineFilterName } from '../utils/format'
import { CARD_SIZE, FORMAT_GEOMETRY } from './shareCardSize'
import { MONO, buildTheme } from './shareThemes'

const CardThemeContext = createContext(buildTheme('classic'))
const useT = () => useContext(CardThemeContext)

function ProjectTitle({ projectTitle, portrait }) {
  const t = useT()
  return (
    <div data-role="card-title" style={{ fontSize: portrait ? t.sc(42) : 36, fontWeight: 700, color: t.ink, fontFamily: MONO, letterSpacing: '0.04em', textTransform: 'uppercase', lineHeight: 1.15, flexShrink: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
      {projectTitle || 'CamLog Wrapped'}
    </div>
  )
}

function CardFooter({ portrait = false }) {
  const t = useT()
  const markSz = portrait ? t.sc(16) : 13
  const urlSz  = portrait ? t.sc(19) : 15
  return (
    <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: portrait ? t.sc(12) : 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ fontSize: markSz, fontWeight: 800, fontFamily: '-apple-system,"system-ui","Segoe UI",Helvetica,Arial,sans-serif', letterSpacing: '-0.025em' }}>
          <span style={{ color: t.ink }}>Cam</span>
          <span style={{ color: t.accent }}>Log</span>
          {' '}
          <span style={{ ...t.gradientText, display: 'inline-block', fontFamily: MONO, fontWeight: 700, letterSpacing: 'normal' }}>Wrapped</span>
        </div>
        <div style={{ fontSize: urlSz, fontWeight: 500, color: t.accent, fontFamily: MONO, letterSpacing: '0.04em' }}>
          camlog.app
        </div>
      </div>
      <div style={{ height: portrait ? t.sc(10) : 8, background: t.gradient, borderRadius: 0 }} />
    </div>
  )
}

// ── Dynamic font sizing ───────────────────────────────────────────────────────
// Name is the BIG hero figure; pct is the supporting figure.
//
// The hero name is sized by canvas.measureText() (see FitText), not a fixed ratio.
// A hard-coded advance like 0.60em is slightly off on iOS, which leaves short names
// like "Handheld" or "ND 0.3" 1–2px over the box and CSS-clips them. Canvas reads
// whatever font the device actually loaded, so it's exact on every platform.

const NAME_FLOOR = 32   // shrink to here before resorting to an ellipsis

// Trailing lens focal length, e.g. "24-290mm", "32mm", "18-35mm".
const FOCAL_RE = /\s*(\d+(?:[.\-x×]\d+)?\s*mm)$/i

// Builds the shortest acceptable label for a name that won't fit even at the font
// floor. `fits(str)` measures the candidate at the floor size. Lens names keep their
// focal length and trim the prefix ("Angenieux… 24-290mm"); everything else uses a
// plain trailing ellipsis. (Leading-focal names like "35mm Cooke S4" keep the focal
// naturally, since the ellipsis falls at the end.)
function shortenToFit(name, fits) {
  if (fits(name)) return name
  const m = name.match(FOCAL_RE)
  if (m) {
    const focal = m[1].replace(/\s+/g, '')
    const prefix = name.slice(0, m.index).trimEnd()
    for (let len = prefix.length - 1; len >= 1; len--) {
      let p = prefix.slice(0, len)
      const sp = p.lastIndexOf(' ')              // prefer a clean word boundary
      if (sp >= len * 0.5) p = p.slice(0, sp)
      const candidate = p.trimEnd() + '… ' + focal
      if (fits(candidate)) return candidate
    }
    if (fits(focal)) return focal
  }
  for (let len = name.length - 1; len >= 1; len--) {
    if (fits(name.slice(0, len).trimEnd() + '…')) return name.slice(0, len).trimEnd() + '…'
  }
  return '…'
}

// Renders text that auto-fits its container's width. Uses canvas.measureText() for
// glyph width — this is immune to the iOS Safari bug where an off-screen DOM span
// inside an overflow:hidden ancestor gets clipped to zero (making offsetWidth
// useless and leaving the text permanently at maxSize, where CSS clips it).
// Shrinks font from `maxSize` down to `NAME_FLOOR`; only ellipsizes below the floor.
function FitText({ text, maxSize, weight = 700, style }) {
  const boxRef = useRef(null)
  const [{ size, display }, setFit] = useState({ size: maxSize, display: text })

  useLayoutEffect(() => {
    let cancelled = false

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const measureWidth = (str, px) => {
      ctx.font = `${weight} ${px}px "DM Mono", monospace`
      return ctx.measureText(str).width
    }

    const compute = () => {
      if (cancelled) return
      const box = boxRef.current
      if (!box) return
      // 3% reserve: DM Mono ships no 700 weight, so the DOM renders a
      // synthesized bold that iOS draws slightly wider than canvas measureText
      // reports. Fitting against a reduced budget keeps the DOM render from
      // tipping into the ellipsis backstop on those devices.
      const avail = box.clientWidth * 0.97
      if (!avail) return   // not yet laid out — ResizeObserver will retry

      const wFull = measureWidth(text, maxSize)
      let nextSize, nextDisplay
      if (wFull <= avail) {
        nextSize = maxSize
        nextDisplay = text
      } else {
        const scaled = Math.floor(maxSize * (avail / wFull))
        if (scaled >= NAME_FLOOR) {
          nextSize = scaled
          nextDisplay = text
        } else {
          nextSize = NAME_FLOOR
          nextDisplay = shortenToFit(text, (s) => measureWidth(s, NAME_FLOOR) <= avail)
        }
      }
      setFit((prev) =>
        prev.size === nextSize && prev.display === nextDisplay ? prev : { size: nextSize, display: nextDisplay }
      )
    }

    compute()
    const raf = requestAnimationFrame(compute)
    // Re-measure once DM Mono bold is confirmed available; canvas then uses the real font.
    document.fonts?.load?.(`${weight} 1px "DM Mono"`)?.then?.(compute)?.catch?.(() => {})

    // Retry when the container gets its layout width (iOS can have avail=0 initially).
    const box = boxRef.current
    const obs = box ? new ResizeObserver(compute) : null
    obs?.observe(box)

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      obs?.disconnect()
    }
  }, [text, maxSize, weight])

  return (
    <div ref={boxRef} style={{ minWidth: 0 }}>
      <div style={{ ...style, fontSize: size, fontWeight: weight, fontFamily: MONO, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {display}
      </div>
    </div>
  )
}

function pctFontSize(pctStr, portrait) {
  const len = pctStr.length
  if (portrait) {
    if (len <= 4) return 88
    if (len <= 5) return 76
    return 64
  }
  // Square — pct is the supporting figure
  if (len <= 4) return 62
  if (len <= 5) return 54
  return 46
}

// ── Shared hero for Lens / Support / Filters ─────────────────────────────────

function HeroContent({ label, name, pct, count, portrait = false }) {
  const t = useT()
  const pctStr  = pct.toFixed(1) + '%'
  const pctSz   = pctFontSize(pctStr, portrait)

  if (portrait) {
    return (
      <div style={{ flexShrink: 0 }}>
        <div style={{ ...t.viewLabel, fontSize: t.sc(30), letterSpacing: '0.08em', marginBottom: t.sc(20) }}>{label}</div>
        <FitText
          text={name}
          maxSize={t.sc(130)}
          style={{ color: t.ink, lineHeight: 1, marginBottom: t.sc(20) }}
        />
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18, marginBottom: t.sc(14) }}>
          <div style={{ fontSize: t.sc(pctSz), fontWeight: 700, fontFamily: MONO, lineHeight: 1, ...t.gradientText, display: 'block' }}>
            {pctStr}
          </div>
          <div style={{ fontSize: t.sc(22), color: t.ink2, fontFamily: MONO, lineHeight: 1, paddingBottom: 6 }}>
            {count} {count === 1 ? 'Shot' : 'Shots'}
          </div>
        </div>
      </div>
    )
  }

  // Square: big name left (wraps if needed), pct + shot count stacked right
  return (
    <div style={{ flexShrink: 0 }}>
      <div style={{ ...t.viewLabel, fontSize: 24, letterSpacing: '0.10em', marginBottom: 14 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <FitText
            text={name}
            maxSize={100}
            style={{ color: t.ink, lineHeight: 1.1 }}
          />
        </div>
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', paddingTop: 4 }}>
          <div style={{ fontSize: pctSz, fontWeight: 700, fontFamily: MONO, lineHeight: 1.1, ...t.gradientText, display: 'block' }}>
            {pctStr}
          </div>
          <div style={{ fontSize: 18, color: t.ink2, fontFamily: MONO, marginTop: 6 }}>
            {count} {count === 1 ? 'Shot' : 'Shots'}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Bar list ──────────────────────────────────────────────────────────────────

function BarList({ data, topN = 5, portrait = false }) {
  const t = useT()
  const shown   = data.slice(0, topN)
  const maxPct  = shown[0]?.pct || 1
  const barH    = portrait ? t.sc(14) : 9
  // Width fit (same approach as CameraView): the label row is monospace on a
  // fixed 600px canvas, so shrink the type until the longest name + value pair
  // fits instead of letting the ellipsis eat the name. Floor keeps it legible.
  const baseLabelSz = portrait ? t.sc(17) : 14
  const innerW      = CARD_SIZE - (portrait ? 96 : 40)
  const maxNameLen  = Math.max(...shown.map((d) => d.name.length), 1)
  const maxValLen   = Math.max(...shown.map((d) => `${d.pct.toFixed(1)}%  ·  ${d.count} ${d.count === 1 ? 'Shot' : 'Shots'}`.length), 1)
  const labelSz     = Math.max(11, Math.min(baseLabelSz, Math.floor((innerW - 12) / ((maxNameLen + maxValLen) * 0.62))))

  const outerStyle = portrait
    ? { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }
    : { display: 'flex', flexDirection: 'column', gap: 12 }

  return (
    <div style={outerStyle}>
      {shown.map((d) => (
        <div key={d.name}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 5 }}>
            {/* Name flexes and truncates with … ; the value column never shrinks or wraps */}
            <span style={{ fontSize: labelSz, color: t.ink2, fontFamily: MONO, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{d.name}</span>
            <span style={{ fontSize: labelSz, color: t.ink2, fontFamily: MONO, whiteSpace: 'nowrap', flexShrink: 0 }}>
              {d.pct.toFixed(1)}%  ·  {d.count} {d.count === 1 ? 'Shot' : 'Shots'}
            </span>
          </div>
          <div style={{ height: barH, background: t.surface2, borderRadius: 4 }}>
            <div style={{ height: '100%', width: `${Math.max(0.5, (d.pct / maxPct) * 100)}%`, background: t.accent, borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function HeroStat({ label, value, sub, subSize = 11, gradient = false, valueSz = 36, labelSz = 13 }) {
  const t = useT()
  return (
    <div>
      <div style={{ ...t.viewLabel, fontSize: labelSz, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: valueSz, fontWeight: 700, fontFamily: MONO, lineHeight: 1, whiteSpace: 'nowrap', ...(gradient ? { ...t.gradientText, display: 'block' } : { color: t.ink }) }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: subSize, fontWeight: subSize > 16 ? 600 : 400, color: t.ink2, fontFamily: MONO, marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  )
}

// ── View-specific layouts ─────────────────────────────────────────────────────

function LensView({ lensData, portrait, listRows }) {
  if (!lensData.data.length) return <EmptyCard label="No lens data recorded" />
  const top = lensData.data[0]
  return (
    <>
      <HeroContent label="Your #1 Lens" name={top.name} pct={top.pct} count={top.count} portrait={portrait} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: portrait ? 'hidden' : 'visible', ...(portrait ? {} : { justifyContent: 'flex-end' }) }}>
        <BarList data={lensData.data} topN={listRows} portrait={portrait} />
      </div>
    </>
  )
}

function SupportView({ suppData, portrait, listRows }) {
  if (!suppData.length) return <EmptyCard label="No support data recorded" />
  const top = suppData[0]
  return (
    <>
      <HeroContent label="Mostly Shot" name={top.name} pct={top.pct} count={top.count} portrait={portrait} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: portrait ? 'hidden' : 'visible', ...(portrait ? {} : { justifyContent: 'flex-end' }) }}>
        <BarList data={suppData} topN={listRows} portrait={portrait} />
      </div>
    </>
  )
}

// Single source of truth for a camera legend row's text, so the width-fit math
// in CameraView measures exactly the string that gets rendered.
function cameraLegendText(cam) {
  return cam.model ? `${cam.name} · ${cam.model}` : `${cam.name} CAMERA`
}


// A legend row is as tall as its largest line box — the % figure's — which the
// browser lays out at DM Mono's `normal` line-height, i.e. 1.5em. The rows are given
// this height EXPLICITLY (see CameraView) rather than inheriting it, so the fit math
// below is exact rather than dependent on the font that actually loaded or on iOS's
// slightly taller synthesized-bold metrics. 1.5 reproduces the previous line box, so
// cards that already fit look unchanged.
const ROW_LH = 1.5
const rowHeightFor = (pctSz) => pctSz * ROW_LH

function cameraRowSizing(n, portrait, scale = 1, budget = null) {
  // Design-confirmed baselines: full-size values that fit at threshold n.
  // Scaled down for the shorter Feed canvas (see FORMAT_GEOMETRY.scale).
  const BASE_PCT_SZ = Math.round((portrait ? 44 : 28) * scale)
  const BASE_GAP    = Math.round((portrait ? 28 : 14) * scale)
  const BASE_N      = portrait ? 6  : 5
  const MIN_GAP     = portrait ? 4  : 2
  const MIN_PCT_SZ  = Math.round((portrait ? 14 : 10) * scale)

  // `budget` is the row area's measured height. Before the first measurement lands
  // we fall back to the height BASE_N full-size rows occupy — the one figure every
  // format is known to have room for, so a card never clips even if the measurement
  // never arrives (it just runs a little tighter than it needs to for one frame).
  const availH = budget ?? (BASE_N * rowHeightFor(BASE_PCT_SZ) + (BASE_N - 1) * BASE_GAP)

  const totalFor = (pctSz, gap) => n * rowHeightFor(pctSz) + (n - 1) * gap

  if (totalFor(BASE_PCT_SZ, BASE_GAP) <= availH) {
    return { pctSz: BASE_PCT_SZ, rowGap: BASE_GAP }
  }

  // Phase 1: keep pctSz, reduce gap
  const idealGap = (availH - n * rowHeightFor(BASE_PCT_SZ)) / Math.max(n - 1, 1)
  if (idealGap >= MIN_GAP) {
    return { pctSz: BASE_PCT_SZ, rowGap: Math.floor(idealGap) }
  }

  // Phase 2: gap at minimum, reduce pctSz
  const pctSz = Math.max(
    MIN_PCT_SZ,
    Math.min(BASE_PCT_SZ, Math.floor((availH - (n - 1) * MIN_GAP) / n / ROW_LH))
  )
  return { pctSz, rowGap: MIN_GAP }
}

function CameraView({ camData, portrait, camRows }) {
  const t = useT()
  // ── Height fit ─────────────────────────────────────────────────────────────
  // The row area's height isn't a constant: a project title that wraps to two lines
  // takes a title's worth of height out of it. Measuring it (rather than assuming the
  // single-line optimum) is what keeps the last camera from being sliced in half on a
  // full Story card. `minHeight: 0` on the measured element is load-bearing — without
  // it the container's min-content height is its rows, so it silently grows past the
  // clipping box instead of reporting the space it actually has.
  const listRef = useRef(null)
  const [budget, setBudget] = useState(null)
  const readBudget = useCallback(() => {
    const el = listRef.current
    if (!el) return
    const h = el.clientHeight
    if (h > 0) setBudget((prev) => (prev === h ? prev : h))
  }, [])
  // Deliberately dependency-free: the row area also changes without this component
  // unmounting — switching format inside the share sheet, or a project title that
  // rewraps — and a re-read on every render is what keeps those from rendering
  // against the previous format's budget. It settles in one extra render: the box
  // is `flex: 1, minHeight: 0`, so resizing the rows can't resize the box back.
  useLayoutEffect(readBudget)
  // The observer covers reflows that no render coincides with — chiefly the web font
  // finishing loading after first paint.
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    const obs = new ResizeObserver(readBudget)
    obs.observe(el)
    return () => obs.disconnect()
  }, [readBudget])

  if (!camData.length) return <EmptyCard label="No camera data recorded" />

  const shown  = camData.slice(0, camRows)

  const effectiveN = shown.length
  const { pctSz: basePctSz, rowGap } = cameraRowSizing(effectiveN, portrait, t.scale, budget)

  const BASE_PCT_SZ = Math.round((portrait ? 44 : 28) * t.scale)
  const r = basePctSz / BASE_PCT_SZ

  const swatchSz   = Math.max(portrait ? 10 : 8,  Math.round((portrait ? t.sc(26) : 16) * r))
  const baseNameSz  = Math.max(portrait ? 10 : 10, Math.round((portrait ? t.sc(26) : 18) * r))
  const baseCountSz = Math.max(portrait ? 8  : 8,  Math.round((portrait ? t.sc(22) : 16) * r))
  const rowItemGap = portrait ? t.sc(18) : 14

  // ── Width fit ──────────────────────────────────────────────────────────────
  // The row's only flexible element is the name, but the % and count columns
  // scale with the format's type size — at story sizes they can starve the name
  // into "S · Alexa…". The card is a fixed 600px canvas and DM Mono is
  // monospace, so the required width is exactly computable: if the widest
  // name + % + count row wouldn't fit at base sizes, shrink all three type
  // sizes by one factor (preserving hierarchy) until it does. Floors keep the
  // type legible; the ellipsis remains only as a backstop for absurd names.
  const CHAR   = 0.62 // DM Mono advance width ≈ 0.6em, plus a little safety
  const innerW = CARD_SIZE - (portrait ? 96 : 40) // canvas minus horizontal padding
  const maxNameLen  = Math.max(...shown.map((c) => cameraLegendText(c).length))
  const maxPctLen   = Math.max(...shown.map((c) => `${c.pct.toFixed(1)}%`.length))
  const maxCountLen = Math.max(...shown.map((c) => `${c.count} ${c.count === 1 ? 'Shot' : 'Shots'}`.length))
  const textNeeded  = (maxNameLen * baseNameSz + maxPctLen * basePctSz + maxCountLen * baseCountSz) * CHAR
  const textAvail   = innerW - swatchSz - 3 * rowItemGap
  const f = Math.min(1, textAvail / textNeeded)

  const nameSz  = Math.max(11, Math.floor(baseNameSz * f))
  // Clamped to basePctSz: the width fit may only ever shrink the % figure, never grow
  // it past the size the height fit approved — the row height is derived from this.
  const pctSz   = Math.min(basePctSz, Math.max(14, Math.floor(basePctSz * f)))
  const countSz = Math.max(10, Math.floor(baseCountSz * f))
  const rowH    = rowHeightFor(pctSz)
  // Content-sized count column (fixed width wasted space and starved the name).
  const countW  = Math.ceil(maxCountLen * countSz * CHAR)

  const barH         = portrait ? t.sc(56) : 44
  const labelSz      = portrait ? t.sc(30) : 24
  const labelSpacing = portrait ? '0.08em' : '0.10em'

  return (
    <>
      <div style={{ ...t.viewLabel, fontSize: labelSz, letterSpacing: labelSpacing, flexShrink: 0 }}>Camera Breakdown</div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: portrait ? t.sc(14) : 10, minHeight: 0, overflow: portrait ? 'hidden' : 'visible' }}>
        <div style={{ display: 'flex', height: barH, borderRadius: 5, overflow: 'hidden', flexShrink: 0 }}>
          {camData.map((cam, i) => (
            <div key={cam.name} style={{ width: `${cam.pct}%`, background: getCameraColorByIndex(cam.name, i), minWidth: cam.pct > 0 ? 3 : 0 }} />
          ))}
        </div>
        <div ref={listRef} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: rowGap }}>
          {shown.map((cam, i) => (
            /* Explicit height + lineHeight 1: the row is exactly as tall as the fit
               math budgeted for, on any platform and whatever font resolved. */
            <div key={cam.name} style={{ display: 'flex', alignItems: 'center', gap: rowItemGap, height: rowH, flexShrink: 0 }}>
              <div style={{ width: swatchSz, height: swatchSz, borderRadius: 4, background: getCameraColorByIndex(cam.name, i), flexShrink: 0 }} />
              <span style={{ fontFamily: MONO, fontSize: nameSz, lineHeight: 1, color: t.ink, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {cameraLegendText(cam)}
              </span>
              <span style={{ fontFamily: MONO, fontSize: pctSz, lineHeight: 1, fontWeight: 600, color: t.ink }}>{cam.pct.toFixed(1)}%</span>
              <span style={{ fontFamily: MONO, fontSize: countSz, lineHeight: 1, color: t.ink2, width: countW, textAlign: 'right' }}>{cam.count} {cam.count === 1 ? 'Shot' : 'Shots'}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

function DaysView({ perDayData, stats, portrait }) {
  const t = useT()
  const maxCount = Math.max(...perDayData.map((d) => d.count), 1)
  const bd = stats.busiestDay
  const n = perDayData.length

  // Portrait: tight gap so bars are wide enough for labels; square: original formula
  const gapSize = portrait
    ? Math.max(1, n <= 30 ? 3 : n <= 60 ? 2 : 1)
    : Math.max(2, Math.floor(460 / Math.max(n, 1)) - 4)

  // Effective bar width at 504px inner portrait width — drives label visibility
  const effectiveBarW = portrait ? Math.max(1, (504 - (n - 1) * gapSize) / Math.max(n, 1)) : 0
  const showCountLabels = portrait && effectiveBarW >= 12
  const showDateLabels  = portrait && effectiveBarW >= 8
  const countLabelSz    = effectiveBarW >= 18 ? 11 : 9

  const formatDate = (d) => {
    if (!d) return ''
    const [, m, day] = d.split('-')
    return `${parseInt(m)}/${parseInt(day)}`
  }

  const valueSz = portrait ? t.sc(40) : 36
  const labelSz = 15

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
        <HeroStat label="Total Shots"    value={stats.totalShots}      valueSz={valueSz} labelSz={labelSz} />
        <HeroStat label="Shooting Days"  value={stats.shootingDays}    valueSz={valueSz} labelSz={labelSz} />
        <HeroStat label="AVG SHOTS/DAY"  value={stats.avgShotsPerDay}  valueSz={valueSz} labelSz={labelSz} />
        {bd && (
          <HeroStat
            label="Busiest Day"
            value={fmtDate(bd.date).label}
            sub={`${bd.count} Shots`}
            subSize={portrait ? 24 : 26}
            valueSz={valueSz}
            labelSz={labelSz}
          />
        )}
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: gapSize, minHeight: 0, overflow: portrait ? 'hidden' : 'visible' }}>
          {perDayData.map((d) => {
            const pct = Math.max(2, (d.count / maxCount) * 100)
            if (showCountLabels) {
              return (
                <div key={d.name} style={{ flex: 1, minWidth: 0, height: `${pct}%`, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ fontSize: countLabelSz, color: t.ink2, fontFamily: MONO, lineHeight: 1, overflow: 'hidden', width: '100%', textAlign: 'center', flexShrink: 0 }}>
                    {d.count}
                  </div>
                  <div style={{ flex: 1, width: '100%', background: t.accent, borderRadius: '2px 2px 0 0' }} />
                </div>
              )
            }
            return (
              <div key={d.name} style={{ flex: 1, height: `${pct}%`, background: t.accent, borderRadius: '2px 2px 0 0', minWidth: 0 }} />
            )
          })}
        </div>
        {showDateLabels && (
          <div style={{ display: 'flex', gap: gapSize, flexShrink: 0, marginTop: 5 }}>
            {perDayData.map((d) => (
              <div key={d.name} style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 9, color: t.ink2, fontFamily: MONO, overflow: 'hidden', whiteSpace: 'nowrap', lineHeight: 1.4 }}>
                {formatDate(d.name)}
              </div>
            ))}
          </div>
        )}
        {portrait && !showDateLabels && (
          <div style={{ textAlign: 'center', fontSize: 16, color: t.ink, fontFamily: MONO, letterSpacing: '0.10em', textTransform: 'uppercase', marginTop: 10, flexShrink: 0 }}>
            Shots Per Day
          </div>
        )}
        {!portrait && (
          <div style={{ textAlign: 'center', fontSize: 13, color: t.ink, fontFamily: MONO, letterSpacing: '0.10em', textTransform: 'uppercase', marginTop: 10, flexShrink: 0 }}>
            Shots Per Day
          </div>
        )}
      </div>
    </div>
  )
}

function FiltersView({ filtrData, portrait, listRows }) {
  if (!filtrData.length) return <EmptyCard label="No filter data recorded" />
  // Hero drops the orientation (headline form); the list keeps it (shorthand only)
  // so distinct orientations stay distinguishable as separate rows.
  const listData = filtrData.map((d) => ({ ...d, name: shortFilterName(d.name) }))
  const top = filtrData[0]
  return (
    <>
      <HeroContent label="Top Filter" name={headlineFilterName(top.name)} pct={top.pct} count={top.count} portrait={portrait} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: portrait ? 'hidden' : 'visible', ...(portrait ? {} : { justifyContent: 'flex-end' }) }}>
        <BarList data={listData} topN={listRows} portrait={portrait} />
      </div>
    </>
  )
}

// ── Summary: the winners of every view on one card ────────────────────────────

// A single "winner" line: small label, big truncating name, gradient pct on the right.
function WinnerRow({ label, name, pct, portrait, fitSz }) {
  const t = useT()
  // fitSz (from SummaryView) shrinks name+pct together so long winner names
  // fit instead of ellipsizing; all rows share one size for a consistent look.
  const nameSz  = fitSz ?? (portrait ? t.sc(40) : 27)
  const pctSz   = nameSz
  const labelSz = portrait ? t.sc(19) : 13
  return (
    <div>
      <div style={{ ...t.viewLabel, fontSize: labelSz, letterSpacing: '0.10em', marginBottom: portrait ? t.sc(8) : 5 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 }}>
        <span style={{ fontFamily: MONO, fontSize: nameSz, fontWeight: 700, color: t.ink, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{name}</span>
        <span style={{ fontFamily: MONO, fontSize: pctSz, fontWeight: 700, lineHeight: 1.1, ...t.gradientText, display: 'block', flexShrink: 0 }}>{pct.toFixed(1)}%</span>
      </div>
    </div>
  )
}

// Compact camera bar + legend for the summary card.
function CameraStrip({ camData, portrait }) {
  const t = useT()
  const legend = camData.slice(0, portrait ? 5 : 4)
  return (
    <div style={{ flexShrink: 0 }}>
      <div style={{ ...t.viewLabel, fontSize: portrait ? t.sc(19) : 13, letterSpacing: '0.10em', marginBottom: portrait ? t.sc(12) : 9 }}>Cameras</div>
      <div style={{ display: 'flex', height: portrait ? t.sc(26) : 18, borderRadius: 5, overflow: 'hidden', marginBottom: portrait ? t.sc(14) : 10 }}>
        {camData.map((cam, i) => (
          <div key={cam.name} style={{ width: `${cam.pct}%`, background: getCameraColorByIndex(cam.name, i), minWidth: cam.pct > 0 ? 2 : 0 }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: portrait ? `${t.sc(10)}px ${t.sc(24)}px` : '6px 16px' }}>
        {legend.map((cam, i) => (
          <div key={cam.name} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, maxWidth: '100%' }}>
            <div style={{ width: portrait ? t.sc(13) : 10, height: portrait ? t.sc(13) : 10, borderRadius: 3, background: getCameraColorByIndex(cam.name, i), flexShrink: 0 }} />
            {/* Ellipsis backstop: without it a long camera name overflows the card edge */}
            <span style={{ fontFamily: MONO, fontSize: portrait ? t.sc(18) : 13, color: t.ink2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
              {cam.name} · {cam.pct.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SummaryView({ lensData, suppData, camData, filtrData, stats, portrait }) {
  const t = useT()
  const lens = lensData.data[0]
  const supp = suppData[0]
  const filt = filtrData[0]

  const winners = [
    lens && { key: 'lens',   label: 'Top Lens',      name: lens.name, pct: lens.pct },
    supp && { key: 'supp',   label: 'Most Shot On',  name: supp.name, pct: supp.pct },
    filt && { key: 'filter', label: 'Top Filter',    name: headlineFilterName(filt.name), pct: filt.pct },
  ].filter(Boolean)

  const statSz      = portrait ? t.sc(46) : 34
  const statLabelSz = portrait ? t.sc(15) : 12
  const bd = stats.busiestDay

  // Uniform width-fit for the winner rows: size name+pct so the longest
  // name/pct pair fits the canvas; one shared size keeps the rows consistent.
  const baseWinnerSz = portrait ? t.sc(40) : 27
  const innerW       = CARD_SIZE - (portrait ? 96 : 40)
  const maxWinLen    = Math.max(...winners.map((w) => w.name.length), 1)
  const maxWinPctLen = Math.max(...winners.map((w) => `${w.pct.toFixed(1)}%`.length), 1)
  // 0.65 (not 0.62): the winner rows are fontWeight 700, but DM Mono only
  // ships up to 500, so browsers synthesize the bold — and iOS CoreText
  // widens glyphs slightly when it does. The extra margin absorbs that.
  const winnerFitSz  = Math.max(15, Math.min(baseWinnerSz, Math.floor((innerW - 16) / ((maxWinLen + maxWinPctLen) * 0.65))))

  return (
    <>
      {/* Headline numbers */}
      <div style={{ display: 'flex', gap: portrait ? t.sc(20) : 14, flexShrink: 0 }}>
        <HeroStat label="Total Shots"   value={stats.totalShots}   valueSz={statSz} labelSz={statLabelSz} />
        <HeroStat label="Shooting Days" value={stats.shootingDays} valueSz={statSz} labelSz={statLabelSz} />
        {bd && (
          <HeroStat
            label="Busiest Day"
            value={fmtDate(bd.date).label}
            sub={`${bd.count} ${bd.count === 1 ? 'Shot' : 'Shots'}`}
            subSize={portrait ? t.sc(20) : 15}
            valueSz={statSz}
            labelSz={statLabelSz}
          />
        )}
      </div>

      {camData.length > 0 && <CameraStrip camData={camData} portrait={portrait} />}

      {/* Winners — flex fills remaining height, rows spread evenly */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-around', minHeight: 0, overflow: portrait ? 'hidden' : 'visible', gap: portrait ? 0 : 12 }}>
        {winners.map((w) => (
          <WinnerRow key={w.key} label={w.label} name={w.name} pct={w.pct} portrait={portrait} fitSz={winnerFitSz} />
        ))}
      </div>
    </>
  )
}

function EmptyCard({ label }) {
  const t = useT()
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.ink3, fontFamily: MONO, fontSize: 13 }}>
      {label}
    </div>
  )
}

// ── Public API ────────────────────────────────────────────────────────────────

export function ShareCardContent({ viewId, rows, stats, projectTitle, format = 'square', theme = 'classic' }) {
  const geo = FORMAT_GEOMETRY[format] || FORMAT_GEOMETRY.square
  const portrait = geo.tall   // feed + story share the tall layout; square is compact
  const scale = geo.scale ?? 1 // shrinks the tall layout for the shorter Feed canvas
  // Theme + a `sc()` helper that scales portrait-layout sizes for the current format.
  const t = useMemo(() => {
    const base = buildTheme(theme)
    return { ...base, scale, sc: (n) => Math.round(n * scale) }
  }, [theme, scale])
  const shotsRows  = useMemo(() => deduplicateShots(rows), [rows])
  const lensData   = useMemo(() => lensUsage(shotsRows), [shotsRows])
  const suppData   = useMemo(() => supportUsage(shotsRows), [shotsRows])
  const camData    = useMemo(() => cameraUsage(rows), [rows])
  const filtrData  = useMemo(() => filterUsage(shotsRows), [shotsRows])
  const perDayData = useMemo(() => takesPerDay(shotsRows), [shotsRows])

  // The tall row counts (geo.listRows/camRows) are the single-line-title optimum. A
  // wrapped 2-line title eats about one row's height, so measure the rendered title and
  // drop one entry when it wraps — this keeps single-line cards (the common case) full
  // without ever clipping the two-line case.
  const cardRef = useRef(null)
  const [titleLines, setTitleLines] = useState(1)
  useLayoutEffect(() => {
    const el = cardRef.current?.querySelector('[data-role="card-title"]')
    if (!el) return
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 1
    setTitleLines(Math.max(1, Math.min(2, Math.round(el.offsetHeight / lh))))
  }, [projectTitle, format, theme])
  // Both tall formats need this. Story was previously exempted on the assumption that
  // it had slack for a wrapped title; it does not — at its full 9 rows a second title
  // line pushed the last bar ~40px past the card's clipping box.
  const rowDrop  = portrait ? titleLines - 1 : 0
  const listRows = Math.max(3, geo.listRows - rowDrop)
  // Camera Breakdown needs no row drop: it measures its own row area and scales the
  // rows to whatever height the title left it (see CameraView's height fit).
  const camRows  = geo.camRows

  const views = {
    summary: <SummaryView lensData={lensData} suppData={suppData} camData={camData} filtrData={filtrData} stats={stats} portrait={portrait} />,
    lens:    <LensView lensData={lensData} portrait={portrait} listRows={listRows} />,
    support: <SupportView suppData={suppData} portrait={portrait} listRows={listRows} />,
    camera:  <CameraView camData={camData} portrait={portrait} camRows={camRows} />,
    days:    <DaysView perDayData={perDayData} stats={stats} portrait={portrait} />,
    filters: <FiltersView filtrData={filtrData} portrait={portrait} listRows={listRows} />,
  }

  return (
    <CardThemeContext.Provider value={t}>
      <div ref={cardRef} style={{
        width: CARD_SIZE,
        height: geo.height,
        background: t.bg,
        paddingTop: geo.topPad,
        paddingRight: portrait ? 48 : 20,
        paddingBottom: format === 'story' ? 20 : 40,
        paddingLeft: portrait ? 48 : 20,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: portrait ? t.sc(28) : 22,
        fontFamily: MONO,
        overflow: 'hidden',
      }}>
        <ProjectTitle projectTitle={projectTitle} portrait={portrait} />
        {views[viewId] ?? views.summary}
        <CardFooter portrait={portrait} />
      </div>
    </CardThemeContext.Provider>
  )
}

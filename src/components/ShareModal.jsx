import { useState, useRef, useEffect, useMemo } from 'react'
import { ShareCardContent } from './ShareCard'
import { SHARE_THEME_META, THEMES, buildCustomBase, customSignature, CUSTOM_DEFAULT } from './shareThemes'
import { CARD_SIZE, FORMAT_GEOMETRY } from './shareCardSize'
import CustomThemeModal from './ShareCustomTheme'
import { safeFileStem } from '../utils/format'

const CUSTOM_KEY = 'camlog-wrapped-custom-theme'

const PREVIEW_W = 360

const VIEWS = [
  { id: 'summary', label: 'Summary' },
  { id: 'lens',    label: 'Lens Usage' },
  { id: 'support', label: 'Support' },
  { id: 'camera',  label: 'Camera' },
  { id: 'days',    label: 'Per Day' },
  { id: 'filters', label: 'Filters' },
]

// Aspect-ratio glyph proportions (w × h, in px) drawn inside the segmented control.
// The shape itself communicates the format, so no text label is needed inline.
const FORMATS = [
  { id: 'square', label: 'Square · 1:1',  w: 15,   h: 15 },
  { id: 'feed',   label: 'Feed · 4:5',    w: 12.8, h: 16 },
  { id: 'story',  label: 'Story · 9:16',  w: 10,   h: 17.8 },
]

export default function ShareModal({ rows, stats, projectTitle, onClose }) {
  const [activeView, setActiveView]   = useState('summary')
  const [format, setFormat]           = useState('square')
  const [theme, setTheme]             = useState('classic')
  // Custom theme config { mode, colors }, restored from localStorage so a user's
  // palette survives reloads. `showCustomizer` toggles the color-picker modal.
  const [customConfig, setCustomConfig] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CUSTOM_KEY) || 'null')
      if (saved && Array.isArray(saved.colors) && saved.colors.length) return saved
    } catch { /* ignore malformed storage */ }
    return CUSTOM_DEFAULT
  })
  const [showCustomizer, setShowCustomizer] = useState(false)
  const [exporting, setExporting]     = useState(false)
  const [exported, setExported]       = useState(false)
  const [exportError, setExportError] = useState(false)
  const [sharing, setSharing]         = useState(false)
  const [shared, setShared]           = useState(false)
  const [shareError, setShareError]   = useState(false)
  // previewScale is derived from ResizeObserver on the flex-1 container,
  // so CSS layout (not JS viewport math) determines how big the preview is.
  const [previewScale, setPreviewScale] = useState(PREVIEW_W / CARD_SIZE)
  const previewAreaRef = useRef(null)
  const exportRef      = useRef(null)
  // Cached background-rendered PNG for the current view/format/theme, so that a
  // Share tap can hand the file to the OS immediately — inside the tap's user-
  // activation window — instead of awaiting a ~500ms render and losing the gesture.
  const pngRef       = useRef({ key: null, blob: null, file: null })
  // The in-flight render, if any: { key, promise }. Concurrent callers for the same
  // key share this promise; a caller for a different key waits behind it (there is a
  // single shared export node, so renders must not overlap).
  const inFlightRef  = useRef(null)

  // Whether this browser can share files (iOS Safari / Android Chrome). Desktop
  // browsers generally can't, so they fall back to the download button.
  const canShareFiles = useMemo(() => {
    try {
      const probe = new File([''], 'x.png', { type: 'image/png' })
      return !!navigator.canShare && navigator.canShare({ files: [probe] })
    } catch { return false }
  }, [])

  // Persist the custom palette whenever it changes.
  useEffect(() => {
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(customConfig)) } catch { /* ignore */ }
  }, [customConfig])

  // The theme handed to the card: a preset id string, or the derived custom base
  // object when 'custom' is selected. Memoized so the base has a stable identity
  // (ShareCardContent depends on it) and only rebuilds when the palette changes.
  const customBase = useMemo(() => buildCustomBase(customConfig), [customConfig])
  const isCustom   = theme === 'custom'
  const themeProp  = isCustom ? customBase : theme

  const geo        = FORMAT_GEOMETRY[format] || FORMAT_GEOMETRY.square
  const cardH      = geo.height
  const pixelRatio = 3

  // Measure the flex-1 preview area and compute scale to fill it.
  // Only update on the first measure or when width changes (orientation change).
  // Address-bar scroll changes height only — we ignore those to keep the preview stable.
  useEffect(() => {
    const el = previewAreaRef.current
    if (!el) return
    let prevW = -1

    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width === prevW) return   // height-only change (address bar) — ignore
      prevW = width

      const scaleW = Math.min(width, PREVIEW_W) / CARD_SIZE
      const scaleH = height / cardH
      setPreviewScale(Math.min(scaleW, scaleH))
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [cardH])

  const scale          = previewScale
  const effectivePreviewW = Math.round(scale * CARD_SIZE)
  const previewH          = Math.round(scale * cardH)

  // Include the custom palette signature so the PNG cache invalidates when the
  // user recolors a custom theme (the id alone would collide across palettes).
  const themeKey = isCustom ? customSignature(customConfig) : theme
  const cfgKey   = `${activeView}|${format}|${themeKey}`
  const filename = `${safeFileStem(projectTitle, 'CamLog-Wrapped')}-${activeView}-${format}-${theme}.png`

  // Renders the export node to a PNG File. The node is kept in-viewport (html-to-image
  // stalls indefinitely on elements positioned far off-screen) but fully transparent via
  // an opacity:0 wrapper, so it never flashes. Double toPng: the first warms font/image
  // inlining, the second is the real capture.
  //
  // Concurrent callers are coalesced by config key: a Save/Share tap during an in-flight
  // background pre-render reuses that render's promise instead of erroring — so the user
  // never sees a spurious "failed" while a render is already on the way. A caller for a
  // different key waits behind the current one (single shared export node → no overlap).
  async function renderPng() {
    const el = exportRef.current
    if (!el) return null
    const key = cfgKey
    const name = filename

    while (inFlightRef.current) {
      if (inFlightRef.current.key === key) return inFlightRef.current.promise
      try { await inFlightRef.current.promise } catch { /* ignore a prior render's failure */ }
    }

    const promise = (async () => {
      const { toPng } = await import('html-to-image')
      const render = async () => {
        await toPng(el, { pixelRatio })          // warm-up pass (font/image inlining)
        return toPng(el, { pixelRatio })         // real capture
      }
      // Guard against a stuck render so the button never hangs on "Saving…".
      const dataUrl = await Promise.race([
        render(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('render timeout')), 15000)),
      ])
      const blob = await (await fetch(dataUrl)).blob()
      return { blob, file: new File([blob], name, { type: 'image/png' }) }
    })()
    inFlightRef.current = { key, promise }
    try {
      return await promise
    } finally {
      if (inFlightRef.current?.promise === promise) inFlightRef.current = null
    }
  }

  // Returns the cached PNG if it matches the current selection, else renders one.
  async function getPng() {
    if (pngRef.current.key === cfgKey && pngRef.current.file) return pngRef.current
    const out = await renderPng()
    if (out) pngRef.current = { key: cfgKey, ...out }
    return out
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }

  async function handleExport() {
    if (exporting) return
    setExporting(true)
    try {
      const out = await getPng()
      if (!out) throw new Error('render failed')
      downloadBlob(out.blob, out.file.name)
      setExported(true)
      setTimeout(() => setExported(false), 2500)
    } catch {
      setExportError(true)
      setTimeout(() => setExportError(false), 2500)
    } finally {
      setExporting(false)
    }
  }

  async function handleShare() {
    if (sharing) return
    setSharing(true)
    try {
      const out = await getPng()
      if (!out) throw new Error('render failed')
      try {
        await navigator.share({ files: [out.file], title: projectTitle || 'CamLog Wrapped' })
        setShared(true)
        setTimeout(() => setShared(false), 2500)
      } catch (err) {
        if (err?.name === 'AbortError') return       // user dismissed the share sheet
        downloadBlob(out.blob, out.file.name)         // activation lost / unsupported → save instead
      }
    } catch {
      setShareError(true)
      setTimeout(() => setShareError(false), 2500)
    } finally {
      setSharing(false)
    }
  }

  // No background pre-rendering: browsing views/formats/themes stays smooth because
  // nothing renders until the user actually taps Share or Save. The first tap renders
  // on demand (~half a second, shown as "Preparing…"/"Saving…") and getPng() caches the
  // result, so re-tapping the same card is instant. Render time is well inside the Web
  // Share user-activation window, and a failed share falls back to a download.
  const btnBase     = "px-2.5 py-1.5 rounded-lg border text-xs font-['DM_Mono'] transition-colors"
  const btnActive   = 'bg-(--c-accent) text-white border-transparent'
  const btnInactive = 'bg-transparent text-(--c-nav-fg) border-(--c-border) hover:text-(--c-nav-fg-hover) hover:border-(--c-border-strong)'

  // Exported pixels = CARD_SIZE × pixelRatio (1800 wide) by the card's height.
  const exportLabel = `Save PNG  ${CARD_SIZE * pixelRatio} × ${cardH * pixelRatio}`

  return (
    <>
      <style>{`.share-view-strip::-webkit-scrollbar{display:none}`}</style>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />

      {/* Modal — flex column, capped at 90dvh so it never overflows the visible screen.
          Tighter outer padding on mobile so the modal (and preview) use more of the screen. */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 pointer-events-none">
        <div className="bg-(--c-surface) border border-(--c-border) rounded-2xl shadow-2xl w-full max-w-sm pointer-events-auto flex flex-col max-h-[95dvh] sm:max-h-[90dvh]">

          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-3 pb-2 border-b border-(--c-border) flex-shrink-0">
            <span className="font-['DM_Mono'] text-sm font-medium text-(--c-ink)">Share as Image</span>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-full text-(--c-ink2) hover:text-(--c-ink) hover:bg-(--c-nav-hover-bg) transition-colors"
              aria-label="Close"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          {/* Toolbar — format (aspect-ratio glyphs) on the left, theme swatches on the right.
              Merging the two former rows into one frees vertical space for a larger preview. */}
          <div className="px-4 pt-2.5 pb-2 flex items-center justify-between gap-3 flex-shrink-0">
            {/* Format — segmented control of aspect-ratio glyphs */}
            <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg border border-(--c-border) bg-(--c-nav-hover-bg)">
              {FORMATS.map((f) => {
                const on = format === f.id
                return (
                  <button
                    key={f.id}
                    onClick={() => setFormat(f.id)}
                    title={f.label}
                    aria-label={f.label}
                    aria-pressed={on}
                    className={`w-8 h-7 flex items-center justify-center rounded-md transition-colors ${
                      on ? 'bg-(--c-accent)' : 'hover:bg-(--c-nav-hover-bg)'
                    }`}
                  >
                    <span
                      className="block rounded-[2px]"
                      style={{
                        width: f.w,
                        height: f.h,
                        border: `1.5px solid ${on ? '#fff' : 'var(--c-nav-fg)'}`,
                      }}
                    />
                  </button>
                )
              })}
            </div>

            {/* Theme — swatch shows the canvas color + accent gradient */}
            <div className="flex items-center gap-1.5">
              {SHARE_THEME_META.map((th) => {
                const t = THEMES[th.id]
                const selected = theme === th.id
                return (
                  <button
                    key={th.id}
                    onClick={() => setTheme(th.id)}
                    title={th.label}
                    aria-label={th.label}
                    aria-pressed={selected}
                    className="w-6 h-6 rounded-full flex items-center justify-center transition-transform hover:scale-110"
                    style={{
                      background: t.bg,
                      boxShadow: selected
                        ? '0 0 0 2px var(--c-surface), 0 0 0 4px var(--c-ink)'
                        : '0 0 0 1px var(--c-border-strong)',
                    }}
                  >
                    <span className="w-3 h-3 rounded-full block" style={{ background: t.gradient }} />
                  </button>
                )
              })}

              {/* Custom theme — previews the user's palette; tapping selects it and
                  opens the color picker. A pencil badge marks it as editable. */}
              <button
                onClick={() => { setTheme('custom'); setShowCustomizer(true) }}
                title="Custom theme"
                aria-label="Custom theme"
                aria-pressed={isCustom}
                className="relative w-6 h-6 rounded-full flex items-center justify-center transition-transform hover:scale-110"
                style={{
                  background: customBase.bg,
                  boxShadow: isCustom
                    ? '0 0 0 2px var(--c-surface), 0 0 0 4px var(--c-ink)'
                    : '0 0 0 1px var(--c-border-strong)',
                }}
              >
                <span className="w-3 h-3 rounded-full block" style={{ background: customBase.gradient }} />
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-(--c-surface) flex items-center justify-center" style={{ boxShadow: '0 0 0 1px var(--c-border-strong)' }}>
                  <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-(--c-ink2)">
                    <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </span>
              </button>
            </div>
          </div>

          {/* Preview area — flex-1 fills all remaining space between chrome elements.
              ResizeObserver measures this container and scales the card to fill it. */}
          <div
            ref={previewAreaRef}
            className="flex-1 min-h-0 flex justify-center items-center px-3 pb-1 overflow-hidden"
          >
            <div style={{ width: effectivePreviewW, height: previewH, overflow: 'hidden', borderRadius: 10, flexShrink: 0 }}>
              <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: CARD_SIZE, height: cardH }}>
                <ShareCardContent
                  viewId={activeView}
                  rows={rows}
                  stats={stats}
                  projectTitle={projectTitle}
                  format={format}
                  theme={themeProp}
                />
              </div>
            </div>
          </div>

          {/* View picker — single horizontal-scroll chip strip. The edge fade hints there
              are more views to swipe through, inviting exploration without a second row. */}
          <div
            className="px-4 pt-1 pb-1.5 flex-shrink-0 overflow-x-auto share-view-strip"
            style={{
              scrollbarWidth: 'none',
              maskImage: 'linear-gradient(to right, transparent 0, #000 14px, #000 calc(100% - 14px), transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to right, transparent 0, #000 14px, #000 calc(100% - 14px), transparent 100%)',
            }}
          >
            <div className="flex gap-1.5 w-max">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setActiveView(v.id)}
                  className={`${btnBase} whitespace-nowrap flex-shrink-0 ${activeView === v.id ? btnActive : btnInactive}`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          {/* Share / Save — native share sheet on capable devices, download otherwise */}
          <div className="px-5 pb-3 pt-1.5 border-t border-(--c-border) flex-shrink-0">
            {canShareFiles ? (
              <>
                <button
                  onClick={handleShare}
                  disabled={sharing}
                  className={`w-full h-10 rounded-xl text-sm font-['DM_Mono'] font-medium transition-colors flex items-center justify-center gap-2 ${
                    shareError || shared
                      ? 'bg-(--c-accent)/20 text-(--c-accent)'
                      : 'bg-(--c-accent) text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-default'
                  }`}
                >
                  {sharing ? 'Preparing…' : shareError ? 'Share failed' : shared ? 'Shared!' : (
                    <>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/>
                        <polyline points="16 6 12 2 8 6"/>
                        <line x1="12" y1="2" x2="12" y2="15"/>
                      </svg>
                      Share
                    </>
                  )}
                </button>
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  className="w-full mt-2 h-8 rounded-lg text-xs font-['DM_Mono'] text-(--c-ink2) hover:text-(--c-ink) transition-colors disabled:opacity-50"
                >
                  {exporting ? 'Saving…' : exportError ? 'Save failed' : exported ? 'Saved to device!' : 'Save to device'}
                </button>
              </>
            ) : (
              <button
                onClick={handleExport}
                disabled={exporting}
                className={`w-full h-10 rounded-xl text-sm font-['DM_Mono'] font-medium transition-colors ${
                  exportError || exported
                    ? 'bg-(--c-accent)/20 text-(--c-accent)'
                    : 'bg-(--c-accent) text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-default'
                }`}
              >
                {exporting ? 'Saving…' : exportError ? 'Export failed' : exported ? 'Saved!' : exportLabel}
              </button>
            )}
          </div>

        </div>
      </div>

      {/* Export target — kept in-viewport (html-to-image stalls on elements far off-screen)
          but fully transparent via opacity:0 so it never flashes on screen. */}
      <div aria-hidden style={{ position: 'fixed', left: 0, top: 0, opacity: 0, pointerEvents: 'none', zIndex: -1 }}>
        <div ref={exportRef}>
          <ShareCardContent
            viewId={activeView}
            rows={rows}
            stats={stats}
            projectTitle={projectTitle}
            format={format}
            theme={themeProp}
          />
        </div>
      </div>

      {showCustomizer && (
        <CustomThemeModal
          config={customConfig}
          onChange={setCustomConfig}
          onClose={() => setShowCustomizer(false)}
        />
      )}
    </>
  )
}

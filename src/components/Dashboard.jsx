import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import FilterPanel from './FilterPanel'
import PrintLayout from './PrintLayout'
import ShareModal from './ShareModal'
import LensView from '../views/LensView'
import SupportView from '../views/SupportView'
import DaysView from '../views/DaysView'
import FiltersView from '../views/FiltersView'
import CameraView from '../views/CameraView'
import { ThemeToggleButton } from '../ThemeContext.jsx'
import { filterRows, summaryStats, getDateRange, getCamerasInData } from '../utils/stats'
import { fmtDate, safeFileStem } from '../utils/format'

const VIEWS = [
  { id: 'lens', label: 'Lens Usage' },
  { id: 'support', label: 'Camera Support' },
  { id: 'camera', label: 'Camera Breakdown' },
  { id: 'days', label: 'Per Day Data' },
  { id: 'filters', label: 'Optical Filters' },
]

function NavButton({ view, activeView, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-['DM_Sans'] transition-colors ${
        activeView === view.id
          ? 'text-(--c-accent) bg-(--c-accent)/10'
          : 'text-(--c-nav-fg) hover:text-(--c-nav-fg-hover) hover:bg-(--c-nav-hover-bg)'
      }`}
    >
      {view.label}
    </button>
  )
}

function SidebarContents({ activeView, onNavClick, filters, onFiltersChange, dateMin, dateMax, availableCameras }) {
  return (
    <>
      <div className="text-xs uppercase tracking-widest text-(--c-label) font-['DM_Mono'] mb-2">
        Views
      </div>
      {VIEWS.map((v) => (
        <NavButton key={v.id} view={v} activeView={activeView} onClick={() => onNavClick(v.id)} />
      ))}
      <div className="mt-8">
        <FilterPanel
          filters={filters}
          onChange={onFiltersChange}
          dateMin={dateMin}
          dateMax={dateMax}
          availableCameras={availableCameras}
        />
      </div>
    </>
  )
}

// The headline is derived from the export's filename, which the exporting app has
// usually mangled — ZoeLog drops the spaces out of a project name, CamLog swaps them
// for underscores and appends "_all_cameras". Rather than have the app guess where the
// words were, let the user correct it. The value goes straight back to App state, so a
// fix reaches the share cards, the PDF and the export filenames without any extra
// plumbing. Deliberately not persisted: a re-upload re-derives the title, and a stale
// override would be harder to explain than retyping it.
const TITLE_SHELL =
  "flex-1 min-w-0 text-center sm:flex-none sm:absolute sm:left-1/2 sm:-translate-x-1/2 font-['DM_Mono'] text-xl font-medium tracking-tight"

function EditableTitle({ value, onChange }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  function commit() {
    setEditing(false)
    const next = draft.trim()
    if (next !== value) onChange(next)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          // Escape abandons the draft — the committed title is untouched.
          if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
        }}
        maxLength={60}
        aria-label="Project title"
        className={`${TITLE_SHELL} w-full sm:w-96 bg-transparent text-(--c-ink) border-b border-(--c-accent) outline-none px-1 py-0.5`}
      />
    )
  }

  return (
    <button
      onClick={() => { setDraft(value); setEditing(true) }}
      title="Rename this project"
      className={`${TITLE_SHELL} line-clamp-2 cursor-text transition-colors hover:text-(--c-accent) ${
        value ? 'text-(--c-ink)' : 'text-(--c-ink3)'
      }`}
    >
      {value || 'Add a title'}
    </button>
  )
}

export default function Dashboard({ rows, projectTitle, onTitleChange, onReset }) {
  const [activeView, setActiveView] = useState('lens')
  // Stable identity: React re-attaches this ref to whichever tab becomes active,
  // firing the callback to scroll it into view.
  const activeTabRef = useCallback((el) => {
    if (el) el.scrollIntoView({ inline: 'nearest', behavior: 'smooth' })
  }, [])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState(false)
  const [exportError, setExportError] = useState(false)
  const printRef = useRef(null)

  async function handleExport() {
    const el = printRef.current
    if (!el || exporting) return
    setExporting(true)
    el.style.position = 'fixed'
    el.style.left = '0'
    el.style.top = '0'
    el.style.visibility = 'visible'
    el.style.zIndex = '9999'
    try {
      await new Promise((r) => setTimeout(r, 400))

      const { toPng } = await import('html-to-image')
      const isMobile = window.innerWidth < 640
      const exportOpts = { pixelRatio: isMobile ? 3 : 6, backgroundColor: '#f0ece4' }
      await toPng(el, exportOpts)
      const dataUrl = await toPng(el, exportOpts)

      const img = new Image()
      await new Promise((res) => { img.onload = res; img.src = dataUrl })

      // Paginate onto standard A4 sheets (595 × 842 pt). Each of the layout's blocks
      // (header, stat rows, section cards, footer) is placed individually with comfortable
      // spacing, so a chart is never sliced across a page. Blocks are packed onto a page
      // until the next won't fit; content pages after the first center their blocks
      // vertically so a sheet isn't top-heavy with a blank bottom.
      const { jsPDF } = await import('jspdf')
      const pageW = 595, pageH = 842, margin = 40, gap = 26
      const scaleImg = img.naturalWidth / el.offsetWidth  // layout px → raster px (pixelRatio)
      const toPt = pageW / el.offsetWidth                 // layout px → PDF points

      const blocks = [...el.children]
        .filter((c) => c.offsetHeight > 2)                // skip the injected <style> tag
        .map((c) => ({
          srcTop: Math.round(c.offsetTop * scaleImg),
          srcH: Math.max(1, Math.round(c.offsetHeight * scaleImg)),
          hPt: c.offsetHeight * toPt,
        }))

      const pages = []
      let page = [], used = margin
      for (const b of blocks) {
        if (page.length && used + gap + b.hPt > pageH - margin) { pages.push(page); page = []; used = margin }
        used += (page.length ? gap : 0) + b.hPt
        page.push(b)
      }
      if (page.length) pages.push(page)

      const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
      pages.forEach((pageBlocks, pi) => {
        if (pi > 0) pdf.addPage()
        pdf.setFillColor(240, 236, 228)               // cream page background
        pdf.rect(0, 0, pageW, pageH, 'F')
        const contentH = pageBlocks.reduce((s, b) => s + b.hPt, 0) + (pageBlocks.length - 1) * gap
        let y = pi === 0 ? margin : Math.max(margin, (pageH - contentH) / 2)  // header stays top; rest centered
        for (const b of pageBlocks) {
          const cv = document.createElement('canvas')
          cv.width = img.naturalWidth
          cv.height = b.srcH
          const cx = cv.getContext('2d')
          cx.fillStyle = '#f0ece4'
          cx.fillRect(0, 0, cv.width, cv.height)
          cx.drawImage(img, 0, -b.srcTop)
          pdf.addImage(cv.toDataURL('image/png'), 'PNG', 0, y, pageW, b.hPt, undefined, 'FAST')
          y += b.hPt + gap
        }
      })
      pdf.save(`${safeFileStem(projectTitle, 'CamLog-Wrapped')}.pdf`)
      setExported(true)
      setTimeout(() => setExported(false), 2500)
    } catch {
      setExportError(true)
      setTimeout(() => setExportError(false), 2500)
    } finally {
      el.style.position = 'fixed'
      el.style.left = '-9999px'
      el.style.visibility = 'hidden'
      el.style.zIndex = '-1'
      setExporting(false)
    }
  }

  const [dateMin, dateMax] = useMemo(() => getDateRange(rows), [rows])
  const availableCameras = useMemo(() => getCamerasInData(rows), [rows])

  // Initialised once per mount; App remounts Dashboard (via key) on each new upload,
  // so the date range always starts at the new data's full span.
  const [filters, setFilters] = useState({
    cameras: ['All'],
    dateRange: [dateMin, dateMax],
  })

  const filteredRows = useMemo(() => filterRows(rows, filters), [rows, filters])
  const stats = useMemo(() => summaryStats(rows, filters), [rows, filters])

  // Human-readable description of any active filter, for the PDF header — null when
  // showing the full project, so a filtered export is never mistaken for the whole.
  const filterContext = useMemo(() => {
    const parts = []
    const cams = filters.cameras
    if (cams && cams.length && !cams.includes('All')) {
      parts.push((cams.length === 1 ? 'Camera ' : 'Cameras ') + cams.join(', '))
    }
    const [d0, d1] = filters.dateRange || []
    if (d0 && d1 && (d0 !== dateMin || d1 !== dateMax)) {
      const a = fmtDate(d0), b = fmtDate(d1)
      parts.push(a.year === b.year
        ? `${a.label} – ${b.label}, ${a.year}`
        : `${a.label}, ${a.year} – ${b.label}, ${b.year}`)
    }
    return parts.length ? parts.join(' · ') : null
  }, [filters, dateMin, dateMax])

  const ViewComponent = {
    lens: LensView,
    support: SupportView,
    camera: CameraView,
    days: DaysView,
    filters: FiltersView,
  }[activeView]

  const sidebarProps = {
    activeView,
    filters,
    onFiltersChange: setFilters,
    dateMin,
    dateMax,
    availableCameras,
  }

  return (
    <>
    <div className="min-h-screen flex flex-col bg-(--c-bg) no-print">
      {/* Top bar */}
      <header className="relative bg-(--c-surface) border-b border-(--c-border) px-10 sm:px-12 h-14 flex items-center justify-between flex-shrink-0">
        <span className="hidden sm:block text-base text-(--c-ink)" style={{fontFamily: '-apple-system,"system-ui","Segoe UI",Helvetica,Arial,sans-serif', fontWeight: 800, letterSpacing: '-0.025em'}}>
          Cam<span className="text-(--c-accent)">Log</span>{' '}
          <span style={{
            fontFamily: "'DM Mono', monospace",
            fontWeight: 700,
            letterSpacing: 'normal',
            background: 'linear-gradient(135deg, #3b82f6 0%, #e63946 50%, #fbbf24 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}>Wrapped</span>
        </span>
        <EditableTitle value={projectTitle} onChange={onTitleChange} />
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen((s) => !s)}
            className="sm:hidden text-(--c-ink2) hover:text-(--c-ink) transition-colors"
            aria-label="Toggle filters"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="4" y1="6" x2="20" y2="6"/>
              <line x1="8" y1="12" x2="20" y2="12"/>
              <line x1="12" y1="18" x2="20" y2="18"/>
            </svg>
          </button>
          <ThemeToggleButton />

          {/* Share as image button */}
          <button
            onClick={() => setShareOpen(true)}
            className="w-8 h-8 flex items-center justify-center rounded-full text-(--c-ink2) hover:text-(--c-ink) hover:bg-(--c-nav-hover-bg) transition-colors"
            aria-label="Share as image"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M3 9h18"/>
              <path d="M9 21V9"/>
            </svg>
          </button>

          {/* Export PDF button */}
          <button
            onClick={handleExport}
            disabled={exporting}
            className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${
              exportError
                ? 'text-(--c-accent) bg-(--c-accent)/10'
                : exported
                ? 'text-(--c-accent) bg-(--c-accent)/10'
                : exporting
                ? 'text-(--c-accent) bg-(--c-accent)/10 cursor-default'
                : 'text-(--c-ink2) hover:text-(--c-ink) hover:bg-(--c-nav-hover-bg)'
            }`}
            aria-label={exportError ? 'Export failed' : 'Export PDF'}
          >
            {exporting ? (
              <div className="w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin" />
            ) : exportError ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            ) : exported ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            )}
          </button>

          <button
            onClick={onReset}
            className="w-8 h-8 flex items-center justify-center rounded-full text-(--c-ink2) hover:text-(--c-ink) hover:bg-(--c-nav-hover-bg) transition-colors"
            aria-label="Back to upload"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — desktop */}
        <aside className="hidden sm:flex flex-col w-72 bg-(--c-sidebar) border-r border-(--c-border) flex-shrink-0 overflow-y-auto">
          <nav className="px-14 pt-8 pb-8 flex-1">
            <SidebarContents {...sidebarProps} onNavClick={(id) => setActiveView(id)} />
          </nav>
        </aside>

        {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <div className="sm:hidden fixed inset-0 z-40 flex">
            <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
            <div className="relative z-50 w-72 bg-(--c-sidebar) flex flex-col overflow-y-auto">
              <div className="px-8 pt-8 pb-8">
                <SidebarContents {...sidebarProps} onNavClick={(id) => { setActiveView(id); setSidebarOpen(false) }} />
              </div>
            </div>
          </div>
        )}

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-6 sm:px-10 py-8">
            {/* Mobile nav tabs */}
            <div className="sm:hidden flex gap-1.5 overflow-x-auto pb-4 mb-2">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  ref={activeView === v.id ? activeTabRef : null}
                  onClick={() => setActiveView(v.id)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-['DM_Mono'] transition-colors ${
                    activeView === v.id
                      ? 'bg-(--c-accent) text-white'
                      : 'bg-(--c-surface) text-(--c-ink2) border border-(--c-border)'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>

            <ViewComponent rows={filteredRows} stats={stats} />
          </div>
        </main>
      </div>
    </div>
    <PrintLayout ref={printRef} rows={filteredRows} stats={stats} projectTitle={projectTitle} filterContext={filterContext} />
    {shareOpen && (
      <ShareModal
        rows={filteredRows}
        stats={stats}
        projectTitle={projectTitle}
        onClose={() => setShareOpen(false)}
      />
    )}
    {exporting && (
      <div className="fixed inset-0 z-[10000] bg-(--c-bg)/80" />
    )}
    </>
  )
}

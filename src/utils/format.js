const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Two ways the headline arrives, and they need different amounts of work:
//
//   toProjectTitle()    the CamLog deep link, which sends project.name as typed
//   titleFromFilename() a hand-uploaded CSV, whose name the exporting app has mangled
//
// Only the filename has been mangled, so only it gets unpicked; both share the same
// normalising tail. ZoeLog stamps the export date into its filenames
// ("BaywatchS1_2026_8_06.csv"), where it reads as noise on a card.
//
// Only a date we're certain of is stripped: three parts, one of them a four-digit year,
// at the very end. That shape is precisely what protects real title text — a season
// suffix ("Baywatch S1"), a sequel number ("Sicario 2") and a year that IS the title
// ("Blade Runner 2049") all lack it and survive untouched. A lone trailing year is
// deliberately NOT a date for this purpose, for the same reason.
const TRAILING_DATE =
  /[\s._/-]+(?:(?:19|20)\d{2}[\s._/-]+\d{1,2}[\s._/-]+\d{1,2}|\d{1,2}[\s._/-]+\d{1,2}[\s._/-]+(?:19|20)\d{2})$/

// CamLog names its exports "<Project>_all_cameras.csv", "<Project>_custom.csv" or
// "<Project>_Acam.csv", having replaced every character outside [A-Za-z0-9_-] in the
// project name with an underscore — so "David Yurman" ships as
// "David_Yurman_all_cameras.csv". Strip the export suffix and the underscores convert
// back to spaces below, recovering the project name as typed.
//
// Only ONE suffix comes off, so a project genuinely called "Beach Cam" keeps its own
// word. The per-camera form requires a 1-2 character camera id before "cam", which is
// what stops a project ending in "_Cam" from being mistaken for one.
const EXPORT_SUFFIX = /_(?:all_cameras|custom|[a-z0-9]{1,2}cam)$/i

// The title used to come only from a filename, so it was always safe to put back into
// one. It is user-editable now, so a typed "/" or ":" could produce a download name the
// OS won't take — reduce it to characters every filesystem accepts.
export function safeFileStem(title, fallback) {
  const cleaned = (title || '')
    // Fold accents to their base letter first, so "Café Noir" saves as "Cafe Noir"
    // rather than losing the character entirely. The on-card title keeps the accent.
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 _-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || fallback
}

// Shared tail: separators to spaces, collapse, uppercase. One copy, so a change to how
// titles read can't apply to only one of the two entry points.
function normaliseTitle(s) {
  return s
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

// The in-app handoff: CamLog posts project.name beside the CSV (js/pages/scene-list.js),
// so the name arrives exactly as the user typed it — no extension, no export suffix, no
// date stamp. Normalising is all it needs. Running the filename unpicking here could
// only invent damage: it would eat the tail of a project genuinely called "Rig_custom".
export function toProjectTitle(name) {
  return normaliseTitle(name || '')
}

// The manual-upload fallback: this name has been through the exporting app's naming
// scheme (see EXPORT_SUFFIX and TRAILING_DATE above), so unpick that before normalising.
export function titleFromFilename(name) {
  // Each strip is skipped when it would leave nothing behind, so a file named only
  // "_custom.csv" or only a date still gets a headline instead of an empty one.
  const strip = (s, re) => {
    const out = s.replace(re, '')
    return out.trim() ? out : s
  }
  const base = (name || '').replace(/\.csv$/i, '')
  return normaliseTitle(strip(strip(base, EXPORT_SUFFIX), TRAILING_DATE))
}

export function fmtDate(dateStr) {
  if (!dateStr) return { label: '', year: '' }
  const [y, m, d] = dateStr.split('-')
  return { label: `${MONTHS[parseInt(m) - 1]} ${parseInt(d)}`, year: y }
}

// Camera-department shorthand for exports (share cards, PDF highlights):
// INTERNAL/EXTERNAL ND reads as INT/EXT ND, keeping the strength — the part
// that matters — prominent in tight layouts. Display-only; the dashboard
// keeps the full names.
export function shortFilterName(name) {
  return name.replace(/\bINTERNAL\b/gi, 'INT').replace(/\bEXTERNAL\b/gi, 'EXT')
}

// Headline form for single big-stat displays (Summary winner, Filters hero, PDF
// highlight): shorthand PLUS drop a trailing orientation/qualifier parenthetical,
// so "ATT ND 1.2 (H TOP)" reads "ATT ND 1.2" — filter + strength stay prominent.
// Only for the one-line headline; detailed lists keep the full name so distinct
// orientations (H TOP vs H BOT) don't collapse into identical-looking rows.
export function headlineFilterName(name) {
  return shortFilterName(name).replace(/\s*\([^)]*\)\s*$/, '').trim()
}

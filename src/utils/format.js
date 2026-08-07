const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// The headline comes from whatever named the data: the uploaded filename, or the
// project name CamLog pushes over postMessage. ZoeLog stamps the export date into its
// filenames ("BaywatchS1_2026_8_06.csv"), where it reads as noise on a card.
//
// Only a date we're certain of is stripped: three parts, one of them a four-digit year,
// at the very end. That shape is precisely what protects real title text — a season
// suffix ("Baywatch S1"), a sequel number ("Sicario 2") and a year that IS the title
// ("Blade Runner 2049") all lack it and survive untouched. A lone trailing year is
// deliberately NOT a date for this purpose, for the same reason.
const TRAILING_DATE =
  /[\s._/-]+(?:(?:19|20)\d{2}[\s._/-]+\d{1,2}[\s._/-]+\d{1,2}|\d{1,2}[\s._/-]+\d{1,2}[\s._/-]+(?:19|20)\d{2})$/

export function toProjectTitle(name) {
  const base = (name || '').replace(/\.csv$/i, '')
  const stripped = base.replace(TRAILING_DATE, '')
  // A filename that is nothing BUT a date keeps it, rather than titling the card ''.
  return (stripped.trim() ? stripped : base)
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
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

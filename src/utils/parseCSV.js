import Papa from 'papaparse'

function _papaOptions(resolve, reject) {
  return {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    transform: (value) => value.trim(),
    complete: (results) => resolve(results.data),
    error: reject,
  }
}

export function parseCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, _papaOptions(resolve, reject))
  })
}

export function parseCSVString(str) {
  return new Promise((resolve, reject) => {
    Papa.parse(str, _papaOptions(resolve, reject))
  })
}

const SUPPORT_RULES = [
  // Most specific first to avoid being shadowed by shorter terms
  { label: 'Dana Dolly',    pattern: /\bdana[\s-]?dolly\b/i },
  { label: 'Mini Libra',    pattern: /\bmini[\s-]?libra\b/i },
  { label: 'Mini Scope',    pattern: /\bmini[\s-]?scope\b/i },
  // Hydrascope (also spelled Hydroscope on plenty of logs)
  { label: 'Hydrascope',    pattern: /\bhydr[ao][\s-]?scope\b/i },
  // Hydroflex underwater housings. Mk6 before Mk5 so "VI" can't be read as "V", and
  // the mark itself is optional ("Hydroflex 6"); a bare "Hydroflex" falls to the
  // unmarked rule below rather than going unrecognized.
  { label: 'Hydroflex Mk6', pattern: /\bhydro[\s-]?flex[\s-]*(?:m(?:ar)?k)?\.?\s*(?:6|vi)\b/i },
  { label: 'Hydroflex Mk5', pattern: /\bhydro[\s-]?flex[\s-]*(?:m(?:ar)?k)?\.?\s*(?:5|v)\b/i },
  { label: 'Hydroflex',     pattern: /\bhydro[\s-]?flex\b/i },
  { label: '360 Head',      pattern: /\b360[\s-]?head\b/i },
  { label: 'Remote Head',   pattern: /\bremote[\s-]?head\b/i },
  // O'Connor — straight or curly apostrophe, or none at all; "head" is optional
  // since the brand name alone is how it gets written on a log.
  { label: "O'Connor Head", pattern: /\bo['’]?[\s-]?conn?or\b/i },
  { label: 'Panahead',      pattern: /\bpana[\s-]?head\b/i },
  { label: 'Gear Head',     pattern: /\bgear[\s-]?head\b/i },
  // Titan / Titan Crane — before the generic Crane rule
  { label: 'Titan Crane',   pattern: /\btitan\b/i },
  // Techno / Techno Crane / Technocrane / Techno-Crane
  { label: 'Technocrane',   pattern: /\btechno[\s-]?(crane)?\b/i },
  // Steadicam / Steadi / Stedicam / Stedi / Steadycam / Steady Cam
  { label: 'Steadicam',     pattern: /\bste[ae]?di(cam)?\b|\bsteady[\s-]?cam\b/i },
  // Handheld / Hand Held / Hand-Held / HH
  { label: 'Handheld',      pattern: /\bhand[\s-]?held\b|\bHH\b/i },
  { label: 'High Hat',      pattern: /\b(?:high|hi)[\s-]?hat\b/i },
  { label: 'Low Hat',       pattern: /\blow[\s-]?hat\b/i },
  // Sticks / Stick / Baby Sticks / Standard Sticks / Standards / Babies
  // Excludes slate clapper notations: No Sticks, 2nd Sticks, Mid Sticks, Tail Sticks, Head Sticks
  { label: 'Sticks',        pattern: /(?:(?<!(?:no|2nd|mid|tail|head)\s)\bsticks?\b|\bbaby[\s-]+sticks?\b|\bstandard[\s-]+sticks?\b|\bstandards\b|\bbabies\b)/i },
  { label: 'Slider',        pattern: /\bslider\b/i },
  { label: 'Dolly',         pattern: /\bdolly\b/i },
  { label: 'Jib',           pattern: /\bjib\b/i },
  // Generic crane, after Titan/Techno so a named crane keeps its name. The word
  // boundary means "Technocrane" (unspaced) can't reach this rule anyway.
  { label: 'Crane',         pattern: /\bcrane\b/i },
  // Ronin / Ronin-S / Ronin-M etc.
  { label: 'Ronin',         pattern: /\bronin/i },
  // Gimbal / Gimble
  { label: 'Gimbal',        pattern: /\bgimb[ae]l\b/i },
  { label: 'Drone',         pattern: /\bdrone\b/i },
  // "Studio" is the catch-all crews write instead of spelling out dolly / sticks /
  // gear head. It is LAST on purpose: it's a valid entry on its own, but whenever the
  // note also names the actual rig ("studio dolly"), the specific rule should win.
  { label: 'Studio',        pattern: /\bstudio\b/i },
]

export function parseSupportType(notes, description = '') {
  const text = [notes, description].filter(Boolean).join(' ').trim()
  if (!text) return null
  for (const rule of SUPPORT_RULES) {
    if (rule.pattern.test(text)) return rule.label
  }
  return null
}

export function formatDate(dateStr) {
  if (!dateStr) return null
  const s = String(dateStr).trim()
  // Already ISO (YYYY-MM-DD…) — take the date portion
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  // M/D/YYYY or M/D/YY
  const parts = s.split('/')
  if (parts.length === 3) {
    let [m, d, y] = parts
    if (y.length === 2) y = '20' + y
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  // Textual formats like "Jun 7" or "Jun 7, 2026" (older CamLog exports).
  // Date.parse infers the year for bare "Mon D" — not perfect for multi-year
  // shoots, but yields a sortable YYYY-MM-DD instead of a lexical string.
  const parsed = new Date(s)
  if (!isNaN(parsed.getTime())) {
    const y  = parsed.getFullYear()
    const mm = String(parsed.getMonth() + 1).padStart(2, '0')
    const dd = String(parsed.getDate()).padStart(2, '0')
    return `${y}-${mm}-${dd}`
  }
  return s
}

export function processData(rawRows) {
  return rawRows.map((row) => ({
    ...row,
    _date: formatDate(row['Date'] || row['date'] || ''),
    _circled: (row['Circled'] || '').toLowerCase() === 'true',
    _camera: (row['Camera'] || '').toUpperCase().trim(),
    _cameraModel: (row['Camera Model'] || '').trim(),
    _lens: (row['Lens'] || '').trim(),
    _scene: (row['Scene'] || '').trim(),
    _support: parseSupportType(row['Notes'] || '', row['Description'] || ''),
    _filter: (row['Filters'] || '').trim() || null,
  }))
}

import { useState, useEffect } from 'react'
import UploadScreen from './components/UploadScreen'
import Dashboard from './components/Dashboard'
import { parseCSV, parseCSVString, processData } from './utils/parseCSV'
import { sampleCsv, SAMPLE_TITLE } from './utils/sampleData'
import { toProjectTitle, titleFromFilename } from './utils/format'

export default function App() {
  const [rows, setRows] = useState(null)
  const [projectTitle, setProjectTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  // Bumped on every successful load so Dashboard remounts fresh for new data,
  // giving it a correct initial date range without syncing state in an effect.
  const [loadId, setLoadId] = useState(0)

  async function handleFile(file) {
    if (!file) return
    // Only CSV exports from CamLog / ZoeLog are supported — reject anything else
    // up front with a friendly, specific message instead of a silent no-op.
    if (!/\.csv$/i.test(file.name)) {
      setError('CamLog Wrapped reads .csv logs exported from CamLog or ZoeLog. That file isn’t a CSV.')
      return
    }
    setLoading(true)
    setError(null)
    window.location.hash = ''
    try {
      const raw = await parseCSV(file)
      const processed = processData(raw)
      if (!processed.some((r) => r._scene)) {
        setError('That CSV isn’t from CamLog or ZoeLog. Export your project from either app and try again.')
        return
      }
      setRows(processed)
      setProjectTitle(titleFromFilename(file.name))
      setLoadId((n) => n + 1)
    } catch (e) {
      setError('That file couldn’t be read as a CSV. Export a fresh log from CamLog or ZoeLog and try again.')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  function loadDemo() {
    ingestCsvString(sampleCsv(), SAMPLE_TITLE)
  }

  async function ingestCsvString(csvStr, name) {
    setLoading(true)
    setError(null)
    window.location.hash = ''
    try {
      const raw = await parseCSVString(csvStr)
      const processed = processData(raw)
      if (!processed.some((r) => r._scene)) {
        setError('That CSV isn’t from CamLog or ZoeLog. Export your project from either app and try again.')
        return
      }
      setRows(processed)
      setProjectTitle(toProjectTitle(name))
      setLoadId((n) => n + 1)
    } catch (e) {
      setError('Failed to parse CSV. Please check the file format.')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  // Deep-link handshake with the main CamLog app: when Wrapped is opened from
  // app.camlog.app, accept a CSV pushed via postMessage (so the user skips the
  // manual export/upload) and announce readiness. The listener is attached before
  // the ready ping so a fast reply from the opener can't race ahead of it.
  useEffect(() => {
    function onMessage(evt) {
      if (evt.origin !== 'https://app.camlog.app') return
      if (evt.data?.type !== 'camlog-import') return
      ingestCsvString(evt.data.csv, evt.data.name)
    }
    window.addEventListener('message', onMessage)
    if (window.opener) {
      try { window.opener.postMessage({ type: 'wrapped-ready' }, 'https://app.camlog.app') } catch { /* opener gone or cross-origin — ignore */ }
    }
    return () => window.removeEventListener('message', onMessage)
  }, [])

  function handleReset() {
    setRows(null)
    setProjectTitle('')
    window.location.hash = ''
  }

  if (rows) {
    return <Dashboard key={loadId} rows={rows} projectTitle={projectTitle} onTitleChange={setProjectTitle} onReset={handleReset} />
  }

  return <UploadScreen onFile={handleFile} onDemo={loadDemo} loading={loading} error={error} />
}

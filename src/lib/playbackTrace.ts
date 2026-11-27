type TraceFields = {
  channelId?: number
  runId?: number
  roomId?: number
  queueId?: number | null
  interventionId?: string
  checksum?: string
  reason?: string
  state?: string
  durationMs?: number
  elapsedMs?: number
  audioElapsedMs?: number
  playerEpoch?: number
  volume?: number
  remainingMs?: number
  diagnosticId?: string
  sourceQueueId?: number
  assetCount?: number
  cacheHits?: number
}

export type PlaybackTraceEvent = TraceFields & { sequence: number, event: string, wallTime: number, monotonicMs: number }
const events: PlaybackTraceEvent[] = []
let sequence = 0
let identity = 0
const capacity = 300
const incidentKey = 'karaoke:transition-incidents:v1'
const incidentTtlMs = 30 * 60 * 1000
const maxIncidents = 3

export const nextTraceIdentity = () => ++identity

// Only technical fields enter this ring. No text, credentials, URLs or socket IDs.
export function tracePlayback (event: string, fields: TraceFields = {}) {
  events.push({ ...fields, event, sequence: ++sequence, wallTime: Date.now(), monotonicMs: performance.now() })
  if (events.length > capacity) events.shift()
}

export function playbackTraceSnapshot () {
  return { schemaVersion: 1, capturedAt: Date.now(), timeOrigin: performance.timeOrigin,
    droppedEvents: Math.max(0, sequence - capacity), events: events.map(event => ({ ...event })) }
}

type TransitionCapture = ReturnType<typeof playbackTraceSnapshot> & { diagnosticId: string }

export function recentTransitionIncidents (): TransitionCapture[] {
  if (process.env.NODE_ENV !== 'development') return []
  try {
    const saved: TransitionCapture[] = JSON.parse(window.sessionStorage.getItem(incidentKey) ?? '[]')
    const now = Date.now()
    return saved.filter(item => item.schemaVersion === 1 && item.capturedAt <= now && now - item.capturedAt < incidentTtlMs && Array.isArray(item.events)).slice(0, maxIncidents)
  } catch { return [] }
}

export type TransitionDiagnostic = NonNullable<ReturnType<typeof beginTransitionDiagnostic>>

export function beginTransitionDiagnostic (sourceQueueId: number, roomId: number) {
  if (process.env.NODE_ENV !== 'development') return undefined
  const diagnosticId = globalThis.crypto?.randomUUID?.()
  if (!diagnosticId) return undefined
  const first = sequence
  let incident = false
  let pending = false
  const record = (event: string, fields: TraceFields = {}) => tracePlayback(event, { roomId, sourceQueueId, ...fields, diagnosticId })
  const save = () => {
    if (pending) return
    pending = true
    setTimeout(() => {
      pending = false
      try {
        const snapshot = playbackTraceSnapshot()
        const capture = { ...snapshot, diagnosticId, events: snapshot.events.filter(event => event.sequence > first && (!event.diagnosticId || event.diagnosticId === diagnosticId)) }
        window.sessionStorage.setItem(incidentKey, JSON.stringify([capture, ...recentTransitionIncidents().filter(item => item.diagnosticId !== diagnosticId)].slice(0, maxIncidents)))
      } catch { /* Diagnostics must not interfere with playback. */ }
    }, 0)
  }
  record('transition-attempt')
  return {
    diagnosticId, record,
    flag (reason: string, fields?: TraceFields) {
      record('transition-anomaly', { ...fields, reason })
      incident = true
      save()
    },
    flush () { if (incident) save() },
  }
}

declare global {
  interface Window { karaokePlaybackTrace: { snapshot: typeof playbackTraceSnapshot, incidents?: typeof recentTransitionIncidents } }
}

// Read-only export from the affected tab; no remote transport or playback controls.
if (typeof window !== 'undefined') {
  window.karaokePlaybackTrace = Object.freeze({ snapshot: playbackTraceSnapshot,
    ...(process.env.NODE_ENV === 'development' ? { incidents: recentTransitionIncidents } : {}) })
}

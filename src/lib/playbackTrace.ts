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
}

export type PlaybackTraceEvent = TraceFields & { sequence: number, event: string, wallTime: number, monotonicMs: number }
const events: PlaybackTraceEvent[] = []
let sequence = 0
let identity = 0
const capacity = 300

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

declare global {
  interface Window { karaokePlaybackTrace: { snapshot: typeof playbackTraceSnapshot } }
}

// Read-only export from the affected tab; no remote transport or playback controls.
if (typeof window !== 'undefined') {
  window.karaokePlaybackTrace = Object.freeze({ snapshot: playbackTraceSnapshot })
}

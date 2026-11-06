export type TransitionVideoState = 'preparing' | 'ready' | 'failed'
export const TRANSITION_VIDEO_SCENE = 'server/TRANSITION_VIDEO_SCENE'

export interface TransitionVideoPrefs {
  mode?: 'single' | 'all'
  videoId: string | null
  dimOpacity: number
  revision: number
}

export const TRANSITION_VIDEO_PREF_DEFAULTS: Readonly<TransitionVideoPrefs> = Object.freeze({
  videoId: null,
  dimOpacity: 0.55,
  revision: 0,
})

export const TRANSITION_VIDEO_LIMITS = Object.freeze({
  durationMs: 30_000,
  width: 1920,
  height: 1080,
  frameRate: 30,
  size: 40 * 1024 * 1024,
  dimOpacity: 0.85,
})

export interface TransitionVideo {
  active?: boolean
  id: string
  roomId: number
  requestId: string
  title: string
  state: TransitionVideoState
  reason: string | null
  durationMs: number | null
  width: number | null
  height: number | null
  frameRate: number | null
  size: number | null
  checksum: string | null
  // Resolve against the application's base URI, including KES_URL_PATH.
  videoUrl: string | null
  posterUrl: string | null
  createdAt: number
  updatedAt: number
}

export interface TransitionVideoOverview {
  videos?: TransitionVideo[]
  settings: TransitionVideoPrefs
  selected: TransitionVideo | null
  candidate: TransitionVideo | null
  capability: { available: boolean, busy: boolean, reason: string | null }
}

export interface TransitionVideoBackground {
  resource: TransitionVideo
  dimOpacity: number
  revision: number
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isVideoId = (value: unknown): value is string | null => value === null || (typeof value === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(value))
const isOpacity = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= TRANSITION_VIDEO_LIMITS.dimOpacity
const isRevision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export function getTransitionVideoPrefsValidationError (value: unknown): string | null {
  if (!isRecord(value)) return 'La configuración del fondo debe ser un objeto.'
  if (Object.keys(value).some(key => !['mode', 'videoId', 'dimOpacity', 'revision'].includes(key))) return 'La configuración del fondo contiene campos no válidos.'
  if (value.mode !== undefined && !['single', 'all'].includes(value.mode as string)) return 'Seleccione un modo de fondo válido.'
  if (!isVideoId(value.videoId)) return 'Seleccione un video válido o quite la selección.'
  if (!isOpacity(value.dimOpacity)) return 'El oscurecimiento debe estar entre 0 y 0.85.'
  if (!isRevision(value.revision) || value.revision === Number.MAX_SAFE_INTEGER) return 'La revisión del fondo no es válida. Recargue la configuración.'
  return null
}

export function normalizeTransitionVideoPrefs (value?: unknown): TransitionVideoPrefs {
  const prefs = isRecord(value) ? value : {}
  return {
    ...(prefs.mode === 'all' ? { mode: 'all' as const } : {}),
    videoId: isVideoId(prefs.videoId) ? prefs.videoId : TRANSITION_VIDEO_PREF_DEFAULTS.videoId,
    dimOpacity: isOpacity(prefs.dimOpacity) ? prefs.dimOpacity : TRANSITION_VIDEO_PREF_DEFAULTS.dimOpacity,
    revision: isRevision(prefs.revision) ? prefs.revision : TRANSITION_VIDEO_PREF_DEFAULTS.revision,
  }
}

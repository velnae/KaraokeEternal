import { randomUUID } from 'node:crypto'
import { db } from '../lib/Database.js'
import { ValidationError } from '../lib/Errors.js'
import {
  getTransitionVideoPrefsValidationError,
  normalizeTransitionVideoPrefs,
  TRANSITION_VIDEO_LIMITS,
  type TransitionVideo,
  type TransitionVideoPrefs,
} from '../../shared/transitionVideo.js'

export interface StoredTransitionVideo extends Omit<TransitionVideo, 'videoUrl' | 'posterUrl'> {
  filename: string | null
  posterFilename: string | null
  retiredAt: number | null
}

export interface PreparedTransitionVideo {
  durationMs: number
  width: number
  height: number
  frameRate: number
  size: number
  checksum: string
}

export class TransitionVideoConflictError extends Error {
  readonly status = 409
  constructor () {
    super('El fondo cambió en otra sesión. Recargue la configuración antes de guardar.')
    this.name = 'TransitionVideoConflictError'
  }
}

export function transitionVideoDTO (row: StoredTransitionVideo): TransitionVideo {
  const base = `api/animation/background/videos/${encodeURIComponent(row.id)}`
  return {
    id: row.id, roomId: row.roomId, requestId: row.requestId, title: row.title,
    state: row.retiredAt ? 'failed' : row.state,
    reason: row.retiredAt ? 'Este video fue descartado. Use una nueva solicitud para subirlo otra vez.' : row.reason,
    durationMs: row.durationMs,
    width: row.width, height: row.height, frameRate: row.frameRate,
    size: row.size, checksum: row.checksum,
    videoUrl: row.state === 'ready' && !row.retiredAt ? `${base}/video` : null,
    posterUrl: row.state === 'ready' && !row.retiredAt ? `${base}/poster` : null,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  }
}

export function getTransitionVideo (roomId: number, id: string): StoredTransitionVideo | undefined {
  return db.get<StoredTransitionVideo>('SELECT * FROM transitionVideos WHERE roomId=? AND id=? AND retiredAt IS NULL', [roomId, id])
}

export const getTransitionVideoAttempt = (roomId: number, requestId: string) => db.get<StoredTransitionVideo>(
  'SELECT * FROM transitionVideos WHERE roomId=? AND requestId=?', [roomId, requestId])

export const getLatestTransitionVideo = (roomId: number) => db.get<StoredTransitionVideo>(
  'SELECT * FROM transitionVideos WHERE roomId=? AND retiredAt IS NULL ORDER BY createdAt DESC,rowid DESC LIMIT 1', [roomId])

export function getTransitionVideoSettings (roomId: number): TransitionVideoPrefs {
  const row = db.get<{ data: string }>('SELECT data FROM rooms WHERE roomId=?', [roomId])
  if (!row) throw new ValidationError('No se encontró la sala.')
  return normalizeTransitionVideoPrefs(JSON.parse(row.data).prefs?.transitionVideo)
}

export function createTransitionVideo (roomId: number, input: { requestId: string, title: string }): StoredTransitionVideo {
  if (typeof input?.requestId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(input.requestId)) throw new ValidationError('La solicitud de video no es válida.')
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 120) throw new ValidationError('Indique un nombre de hasta 120 caracteres.')
  getTransitionVideoSettings(roomId)
  const now = Date.now()
  db.run(`INSERT INTO transitionVideos(id,roomId,requestId,title,createdAt,updatedAt) VALUES(?,?,?,?,?,?)
    ON CONFLICT(roomId,requestId) DO NOTHING`, [randomUUID(), roomId, input.requestId, input.title.trim(), now, now])
  return db.get<StoredTransitionVideo>('SELECT * FROM transitionVideos WHERE roomId=? AND requestId=?', [roomId, input.requestId])!
}

// Preparation owns file validation/publication. This operation records only verified
// media, using immutable generated filenames relative to the video data directory.
export function completeTransitionVideo (roomId: number, id: string, media: PreparedTransitionVideo): StoredTransitionVideo {
  for (const key of ['durationMs', 'width', 'height', 'size'] as const) {
    if (!Number.isInteger(media[key]) || media[key] <= 0 || media[key] > TRANSITION_VIDEO_LIMITS[key]) throw new ValidationError('El video preparado supera los límites permitidos.')
  }
  if (!Number.isFinite(media.frameRate) || media.frameRate <= 0 || media.frameRate > TRANSITION_VIDEO_LIMITS.frameRate
    || typeof media.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(media.checksum)) throw new ValidationError('Los metadatos del video preparado no son válidos.')
  const row = db.get<StoredTransitionVideo>(`UPDATE transitionVideos SET state='ready',reason=NULL,filename=?,posterFilename=?,
    durationMs=?,width=?,height=?,frameRate=?,size=?,checksum=?,updatedAt=?
    WHERE roomId=? AND id=? AND state='preparing' AND retiredAt IS NULL RETURNING *`,
  [`${id}.mp4`, `${id}.jpg`, media.durationMs, media.width, media.height, media.frameRate, media.size, media.checksum, Date.now(), roomId, id])
  if (!row) throw new ValidationError('El video ya no está en preparación o no pertenece a esta sala.')
  return row
}

export function failTransitionVideo (roomId: number, id: string, reason: string): StoredTransitionVideo {
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) throw new ValidationError('Indique un motivo de error de hasta 500 caracteres.')
  const row = db.get<StoredTransitionVideo>(`UPDATE transitionVideos SET state='failed',reason=?,updatedAt=?
    WHERE roomId=? AND id=? AND state='preparing' RETURNING *`, [reason.trim(), Date.now(), roomId, id])
  if (!row) throw new ValidationError('El video ya no está en preparación o no pertenece a esta sala.')
  return row
}

export function saveTransitionVideoSettings (roomId: number, value: unknown): TransitionVideoPrefs {
  const error = getTransitionVideoPrefsValidationError(value)
  if (error) throw new ValidationError(error)
  const prefs = value as TransitionVideoPrefs
  const next: TransitionVideoPrefs = { videoId: prefs.videoId, dimOpacity: prefs.dimOpacity, revision: prefs.revision + 1 }
  // Selection ownership/readiness and the expected revision are checked in the
  // same write. Only this preference changes; other room data remains current.
  const saved = db.get<{ data: string }>(`UPDATE rooms SET data=json_set(data,'$.prefs',
    json_set(CASE WHEN json_type(data,'$.prefs')='object' THEN json_extract(data,'$.prefs') ELSE '{}' END,
      '$.transitionVideo',json(?)))
    WHERE roomId=? AND COALESCE(json_extract(data,'$.prefs.transitionVideo.revision'),0)=?
      AND (? IS NULL OR EXISTS(SELECT 1 FROM transitionVideos WHERE id=? AND roomId=rooms.roomId AND state='ready' AND retiredAt IS NULL))
    RETURNING data`, [JSON.stringify(next), roomId, prefs.revision, prefs.videoId, prefs.videoId])
  if (saved) return next
  const current = getTransitionVideoSettings(roomId)
  if (current.revision !== prefs.revision) throw new TransitionVideoConflictError()
  throw new ValidationError('Seleccione un video disponible de esta sala.')
}

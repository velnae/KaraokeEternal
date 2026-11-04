import { db } from '../lib/Database.js'
import type { TransitionVideoBackground } from '../../shared/transitionVideo.js'
import { getTransitionVideo, getTransitionVideoSettings, transitionVideoDTO } from './Store.js'

/** Called only after the owning player receives a bounded audio/visual grant. */
export function captureTransitionBackground (roomId: number, leaseKey: string, until: number): TransitionVideoBackground | null {
  const now = Date.now()
  db.run('DELETE FROM transitionVideoLeases WHERE untilAt<=?', [now])
  if (!Number.isFinite(until) || until <= now) return null
  const settings = getTransitionVideoSettings(roomId)
  const row = settings.videoId ? getTransitionVideo(roomId, settings.videoId) : undefined
  if (!row || row.state !== 'ready') return null
  const background = { resource: transitionVideoDTO(row), dimOpacity: settings.dimOpacity, revision: settings.revision }
  db.run(`INSERT INTO transitionVideoLeases(leaseKey,videoId,roomId,untilAt,backgroundJSON,updatedAt) VALUES(?,?,?,?,?,?)
    ON CONFLICT(leaseKey,videoId) DO UPDATE SET untilAt=excluded.untilAt,backgroundJSON=excluded.backgroundJSON,updatedAt=excluded.updatedAt`,
  [leaseKey, row.id, roomId, Math.min(until, now + 60_000), JSON.stringify(background), now])
  return background
}

export function leasedTransitionBackground (leaseKey: string): TransitionVideoBackground | null {
  const row = db.get<{ backgroundJSON: string }>(`SELECT backgroundJSON FROM transitionVideoLeases
    WHERE leaseKey=? AND untilAt>? ORDER BY updatedAt DESC,rowid DESC LIMIT 1`, [leaseKey, Date.now()])
  return row ? JSON.parse(row.backgroundJSON) : null
}

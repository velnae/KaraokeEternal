import { db } from '../lib/Database.js'
import type { TransitionVideoBackground } from '../../shared/transitionVideo.js'
import { getTransitionVideo, getTransitionVideoSettings, transitionVideoDTO, type StoredTransitionVideo } from './Store.js'
import type { EventScene } from '../../shared/eventScenes.js'

type SceneSnapshot = { template: EventScene | null, nextQueueId: number | null, ownerSocketId: string }
const scenes = new Map<number, { key: string, until: number, background: TransitionVideoBackground | null, snapshot?: SceneSnapshot }>()

export function transitionVideoScene (roomId: number, sceneId: string, finished = false, videoId?: string | null, snapshot?: SceneSnapshot) {
  const key = `scene:${roomId}:${sceneId}`
  if (finished) {
    if (scenes.get(roomId)?.key === key) scenes.delete(roomId)
    return null
  }
  const current = scenes.get(roomId)
  if (current?.key === key && current.until > Date.now()) return current.background
  const until = Date.now() + 60_000
  const background = captureTransitionBackground(roomId, key, until, false, videoId)
  scenes.set(roomId, { key, until, background, snapshot: snapshot ? JSON.parse(JSON.stringify(snapshot)) as SceneSnapshot : undefined })
  return background
}

export function leasedEventScene (roomId: number, nextQueueId: number | null, ownerSocketId?: string): EventScene | null | undefined {
  const scene = scenes.get(roomId)
  return scene && scene.until > Date.now() && scene.snapshot?.nextQueueId === nextQueueId && (!ownerSocketId || scene.snapshot.ownerSocketId === ownerSocketId)
    ? scene.snapshot.template
    : undefined
}

/** Called only after the owning player receives a bounded audio/visual grant. */
export function captureTransitionBackground (roomId: number, leaseKey: string, until: number, inheritScene = true, videoId?: string | null): TransitionVideoBackground | null {
  const now = Date.now()
  db.run('DELETE FROM transitionVideoLeases WHERE untilAt<=?', [now])
  if (!Number.isFinite(until) || until <= now) return null
  const scene = scenes.get(roomId)
  if (scene && scene.until <= now) scenes.delete(roomId)
  let background = leasedTransitionBackground(leaseKey)
  if (!background && inheritScene && scene && scene.until > now) {
    background = scene.background
    if (!background) return null
  }
  if (!background) {
    const settings = getTransitionVideoSettings(roomId)
    const row = videoId
      ? getTransitionVideo(roomId, videoId)
      : settings.mode === 'all'
        ? db.get<StoredTransitionVideo>(`SELECT * FROM transitionVideos WHERE roomId=? AND active=1 AND state='ready' AND retiredAt IS NULL
          ORDER BY selectionOrder,createdAt,id LIMIT 1`, [roomId])
        : settings.videoId ? getTransitionVideo(roomId, settings.videoId) : undefined
    if (!row || row.state !== 'ready' || !row.active) return null
    background = { resource: transitionVideoDTO(row), dimOpacity: settings.dimOpacity, revision: settings.revision }
    if (!videoId && settings.mode === 'all') db.run(`UPDATE transitionVideos SET selectionOrder=(SELECT COALESCE(MAX(selectionOrder),0)+1 FROM transitionVideos WHERE roomId=?) WHERE id=?`, [roomId, row.id])
  }
  db.run(`INSERT INTO transitionVideoLeases(leaseKey,videoId,roomId,untilAt,backgroundJSON,updatedAt) VALUES(?,?,?,?,?,?)
    ON CONFLICT(leaseKey,videoId) DO UPDATE SET untilAt=MAX(untilAt,excluded.untilAt),updatedAt=excluded.updatedAt`,
  [leaseKey, background.resource.id, roomId, Math.min(until, now + 60_000), JSON.stringify(background), now])
  return background
}

export function leasedTransitionBackground (leaseKey: string): TransitionVideoBackground | null {
  const row = db.get<{ backgroundJSON: string }>(`SELECT backgroundJSON FROM transitionVideoLeases
    WHERE leaseKey=? AND untilAt>? ORDER BY updatedAt DESC,rowid DESC LIMIT 1`, [leaseKey, Date.now()])
  return row ? JSON.parse(row.backgroundJSON) : null
}

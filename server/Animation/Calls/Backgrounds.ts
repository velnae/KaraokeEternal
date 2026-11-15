import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { db } from '../../lib/Database.js'
import { prepareAudio } from '../AudioPreparation.js'
import { prepareTransitionVideo } from '../../TransitionVideo/Preparation.js'
import { KARAOKE_BACKGROUND_AUDIO_MS, KARAOKE_BACKGROUND_VIDEO_MS, defaultKaraokeBackgrounds, karaokeBed, karaokeVideo, validateKaraokeBackgrounds,
  type KaraokeBackgroundAsset, type KaraokeBackgroundKind, type KaraokeBackgroundSettings, type KaraokeSceneMedia } from '../../../shared/karaokeBackgrounds.js'

interface StoredAsset extends Omit<KaraokeBackgroundAsset, 'active' | 'url'> { active: number, filename: string | null, requestId: string, selectionOrder: number }
let directory = ''
let controller = new AbortController()
let uploading = false
export async function startKaraokeBackgrounds (root: string) {
  directory = root
  controller = new AbortController()
  await fs.mkdir(root, { recursive: true })
  db.run(`UPDATE karaokeBackgroundAssets SET state='failed',error='La preparación se interrumpió. Vuelva a subir el archivo.' WHERE state='preparing'`)
  db.run(`DELETE FROM karaokeBackgroundScenes WHERE NOT EXISTS (
    SELECT 1 FROM karaokeStartTurns t JOIN queue q ON q.roomId=t.roomId AND q.queueId=t.queueId
    WHERE t.roomId=karaokeBackgroundScenes.roomId AND t.queueId=karaokeBackgroundScenes.queueId AND t.presented=1 AND q.status='APPROVED'
  )`)
  return () => controller.abort()
}
export function backgroundSettings (roomId: number): KaraokeBackgroundSettings {
  const row = db.get<{ data: string }>('SELECT data FROM karaokeBackgroundSettings WHERE roomId=?', [roomId])
  return row ? JSON.parse(row.data) : { ...defaultKaraokeBackgrounds }
}
export const backgroundAsset = (roomId: number, id: string) => db.get<StoredAsset>('SELECT * FROM karaokeBackgroundAssets WHERE roomId=? AND id=?', [roomId, id])
function dto (row: StoredAsset): KaraokeBackgroundAsset {
  return { id: row.id, roomId: row.roomId, kind: row.kind, title: row.title, active: !!row.active, state: row.state, error: row.error,
    checksum: row.checksum, durationMs: row.durationMs, width: row.width, height: row.height, size: row.size, createdAt: row.createdAt,
    url: `api/rooms/${row.roomId}/karaoke-calls/backgrounds/assets/${row.id}` }
}
export function backgroundOverview (roomId: number) {
  return { settings: backgroundSettings(roomId), assets: db.all<StoredAsset>('SELECT * FROM karaokeBackgroundAssets WHERE roomId=? ORDER BY createdAt,id', [roomId]).map(dto) }
}
export function saveBackgroundSettings (roomId: number, input: unknown) {
  const value = validateKaraokeBackgrounds(input)
  if (value.revision !== backgroundSettings(roomId).revision) throw Object.assign(new Error('Los fondos cambiaron. Recargue antes de guardar.'), { status: 409 })
  for (const kind of ['video', 'bed'] as const) {
    if (value[`${kind}Mode`] !== 'single') continue
    const asset = backgroundAsset(roomId, value[`${kind}Id`] ?? '')
    if (!asset || asset.kind !== kind || asset.state !== 'ready' || !asset.active) throw new Error('Seleccione un fondo activo y disponible de esta sala.')
  }
  value.revision++
  db.run('INSERT INTO karaokeBackgroundSettings(roomId,data) VALUES(?,?) ON CONFLICT(roomId) DO UPDATE SET data=excluded.data', [roomId, JSON.stringify(value)])
  return backgroundOverview(roomId)
}
export function activateBackground (roomId: number, id: string, active: unknown) {
  const row = backgroundAsset(roomId, id)
  if (!row || row.state !== 'ready' || typeof active !== 'boolean') throw new Error('Seleccione un recurso disponible de esta sala.')
  const config = backgroundSettings(roomId)
  if (!active && config[`${row.kind}Mode`] === 'single' && config[`${row.kind}Id`] === id) throw new Error('Cambie el fondo fijo antes de desactivarlo.')
  db.run('UPDATE karaokeBackgroundAssets SET active=? WHERE roomId=? AND id=?', [active ? 1 : 0, roomId, id])
  return saveBackgroundSettings(roomId, config)
}
export async function uploadBackground (roomId: number, kind: KaraokeBackgroundKind, title: string, source: string, requestId: string) {
  const existing = db.get<StoredAsset>('SELECT * FROM karaokeBackgroundAssets WHERE roomId=? AND requestId=?', [roomId, requestId])
  if (existing) return dto(existing)
  if (uploading) throw new Error('Hay un fondo en preparación. Espere a que termine.')
  uploading = true
  const id = randomUUID()
  let staging = ''
  try {
    db.run('INSERT INTO karaokeBackgroundAssets(id,roomId,requestId,kind,title,createdAt) VALUES(?,?,?,?,?,?)', [id, roomId, requestId, kind, title.slice(0, 100), Date.now()])
    if (kind === 'video') {
      staging = await fs.mkdtemp(path.join(directory, '.video-'))
      await fs.copyFile(source, path.join(staging, 'source.mp4'))
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180000)])
      const media = await prepareTransitionVideo(staging, { ffmpeg: process.env.KES_FFMPEG_PATH || 'ffmpeg', ffprobe: process.env.KES_FFPROBE_PATH || 'ffprobe' }, signal, KARAOKE_BACKGROUND_VIDEO_MS)
      await fs.rename(path.join(staging, 'video.mp4'), path.join(directory, `${id}.mp4`))
      db.run(`UPDATE karaokeBackgroundAssets SET state='ready',filename=?,checksum=?,durationMs=?,width=?,height=?,size=? WHERE id=?`, [`${id}.mp4`, media.checksum, media.durationMs, media.width, media.height, media.size, id])
    } else {
      const media = await prepareAudio(directory, id, 'ambience', await fs.readFile(source), process.env.KES_FFMPEG_PATH || 'ffmpeg', controller.signal, undefined, { durationMs: KARAOKE_BACKGROUND_AUDIO_MS })
      db.run(`UPDATE karaokeBackgroundAssets SET state='ready',filename=?,checksum=?,durationMs=?,size=? WHERE id=?`, [media.filename, media.checksum, media.durationMs, media.size, id])
    }
  } catch (error) {
    db.run(`UPDATE karaokeBackgroundAssets SET state='failed',error=? WHERE id=?`, [(error as Error).message, id])
  } finally {
    uploading = false
    if (staging) await fs.rm(staging, { recursive: true, force: true })
  }
  return dto(backgroundAsset(roomId, id)!)
}
export function backgroundFile (roomId: number, id: string) {
  const asset = backgroundAsset(roomId, id)
  if (!asset?.filename || asset.state !== 'ready') throw Object.assign(new Error('El fondo no está disponible.'), { status: 404 })
  return { asset, file: path.join(directory, asset.filename) }
}
function choose (roomId: number, kind: KaraokeBackgroundKind, config: KaraokeBackgroundSettings, rotate = false) {
  if (config[`${kind}Mode`] === 'none') return undefined
  const row = config[`${kind}Mode`] === 'single'
    ? backgroundAsset(roomId, config[`${kind}Id`] ?? '')
    : db.get<StoredAsset>(`SELECT * FROM karaokeBackgroundAssets WHERE roomId=? AND kind=? AND active=1 AND state='ready' ORDER BY selectionOrder,createdAt,id LIMIT 1`, [roomId, kind])
  if (!row?.active || row.state !== 'ready' || row.kind !== kind) return undefined
  if (rotate && config[`${kind}Mode`] === 'all') db.run('UPDATE karaokeBackgroundAssets SET selectionOrder=(SELECT COALESCE(MAX(selectionOrder),0)+1 FROM karaokeBackgroundAssets WHERE roomId=?) WHERE id=?', [roomId, row.id])
  return dto(row)
}
export function peekKaraokeMedia (roomId: number, rotate = false): KaraokeSceneMedia {
  const config = backgroundSettings(roomId)
  const video = choose(roomId, 'video', config, rotate)
  const bed = choose(roomId, 'bed', config, rotate)
  return { background: video ? { resource: karaokeVideo(video), dimOpacity: config.dimOpacity, revision: config.revision } : null,
    bed: bed ? { ...karaokeBed(bed), volume: config.bedVolume } : null, volume: config.bedVolume }
}
export function currentKaraokeMedia (roomId: number, queueId: number): KaraokeSceneMedia | null {
  const row = db.get<{ mediaJSON: string }>('SELECT mediaJSON FROM karaokeBackgroundScenes WHERE roomId=? AND queueId=? AND untilAt>?', [roomId, queueId, Date.now()])
  return row ? JSON.parse(row.mediaJSON) : null
}
export function captureKaraokeMedia (roomId: number, sceneId: string, queueId: number): KaraokeSceneMedia {
  const waiting = db.get('SELECT 1 FROM karaokeStartTurns WHERE roomId=? AND queueId=? AND presented=1', [roomId, queueId])
  if (waiting) {
    const previous = db.get<{ mediaJSON: string }>('SELECT mediaJSON FROM karaokeBackgroundScenes WHERE roomId=? AND queueId=?', [roomId, queueId])
    if (previous) {
      db.run('UPDATE karaokeBackgroundScenes SET sceneId=?,untilAt=? WHERE roomId=?', [sceneId, Date.now() + 60000, roomId])
      return JSON.parse(previous.mediaJSON)
    }
  }
  const saved = db.get<{ sceneId: string, mediaJSON: string }>('SELECT * FROM karaokeBackgroundScenes WHERE roomId=? AND queueId=? AND untilAt>?', [roomId, queueId, Date.now()])
  if (saved?.sceneId === sceneId) return JSON.parse(saved.mediaJSON)
  const media = peekKaraokeMedia(roomId, true)
  db.run('INSERT INTO karaokeBackgroundScenes(roomId,sceneId,queueId,mediaJSON,untilAt) VALUES(?,?,?,?,?) ON CONFLICT(roomId) DO UPDATE SET sceneId=excluded.sceneId,queueId=excluded.queueId,mediaJSON=excluded.mediaJSON,untilAt=excluded.untilAt', [roomId, sceneId, queueId, JSON.stringify(media), Date.now() + 60000])
  return media
}
export function karaokeBedClips (roomId: number) {
  const next = peekKaraokeMedia(roomId).bed
  const current = db.get<{ mediaJSON: string }>('SELECT mediaJSON FROM karaokeBackgroundScenes WHERE roomId=? AND untilAt>?', [roomId, Date.now()])
  const bed = current ? (JSON.parse(current.mediaJSON) as KaraokeSceneMedia).bed : null
  return [...new Map([next, bed].filter((clip): clip is NonNullable<typeof clip> => !!clip).map(clip => [clip.id, clip])).values()]
}

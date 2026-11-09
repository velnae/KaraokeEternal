import { db } from '../lib/Database.js'
import { businessDate } from '../Animation/sessions.js'
import { selectBirthdayProfile, type BirthdayInput, type BirthdaySceneInput, type BirthdaySceneSelection, type BirthdaySettings } from '../../shared/birthdays.js'
import type { AssetRow, BirthdayRow } from './Store.js'

export const introBank = (config: BirthdaySettings) => config.introIds ?? (config.introId ? [config.introId] : [])
export function birthdayDayKey (roomId: number, at = Date.now()) {
  const session = db.get<{ sessionId: string }>('SELECT sessionId FROM animationSessions WHERE roomId=? AND openedAt<=? AND (closedAt IS NULL OR closedAt>=?) ORDER BY openedAt DESC LIMIT 1', [roomId, at, at])
  if (session) return `session:${session.sessionId}`
  const room = db.get<{ data: string }>('SELECT data FROM rooms WHERE roomId=?', [roomId])
  const cutoff = JSON.parse(room?.data ?? '{}').prefs?.animation?.cutoffHour ?? 4
  return `day:${businessDate(at, Number.isInteger(cutoff) && cutoff >= 0 && cutoff <= 23 ? cutoff : 4)}`
}
export const readScene = (row: { sceneJSON?: string | null }): BirthdaySceneSelection | null => row.sceneJSON ? JSON.parse(row.sceneJSON) : null
export function sceneAsset (roomId: number, id: string | null, kind: 'intro' | 'video' | 'music') {
  const row = id && db.get<AssetRow>('SELECT * FROM birthdayAssets WHERE roomId=? AND id=? AND kind=?', [roomId, id, kind])
  if (!row || row.durationMs <= 0) throw new Error(`Seleccione ${kind === 'intro' ? 'una introducción' : kind === 'video' ? 'un video' : 'la música'} disponible de esta sala.`)
  return row
}
export function selectBirthdayScene (roomId: number, config: BirthdaySettings, input: BirthdayInput, year: number) {
  const dayKey = birthdayDayKey(roomId)
  const candidates = introBank(config).map(id => sceneAsset(roomId, id, 'intro'))
  if (!candidates.length) throw new Error('Active al menos una introducción en Ajustes → Cumpleaños.')
  const uses = db.all<{ checksum: string, startedAt: number }>('SELECT checksum,startedAt FROM birthdayIntroUses WHERE roomId=? AND dayKey=? ORDER BY startedAt DESC,rowid DESC', [roomId, dayKey])
  const pending = db.all<{ settingsJSON: string, sceneJSON: string }>('SELECT settingsJSON,sceneJSON FROM birthdays WHERE roomId=? AND playback IN (\'held\',\'scheduled\') AND sceneJSON IS NOT NULL ORDER BY createdAt DESC,rowid DESC', [roomId])
    .filter(row => readScene(row)?.dayKey === dayKey)
    .flatMap((row) => {
      const intro = db.get<{ checksum: string }>('SELECT checksum FROM birthdayAssets WHERE roomId=? AND id=? AND kind=\'intro\'', [roomId, JSON.parse(row.settingsJSON).introId])
      return intro ? [intro.checksum] : []
    })
  const last = pending[0] ?? uses[0]?.checksum
  const counts = (hash: string) => uses.filter(row => row.checksum === hash).length + pending.filter(value => value === hash).length
  const pool = candidates.some(row => row.checksum !== last) ? candidates.filter(row => row.checksum !== last) : candidates
  const chosen = [...pool].sort((a, b) => counts(a.checksum) - counts(b.checksum) || candidates.indexOf(a) - candidates.indexOf(b))[0]
  const profile = selectBirthdayProfile(config, input, year)
  const videoId = sceneAsset(roomId, profile.videoId || config.videoId, 'video').id
  sceneAsset(roomId, config.musicId, 'music')
  const scene: BirthdaySceneSelection = { dayKey, automaticIntroId: chosen.id, automaticVideoId: videoId, defaultVideoId: config.videoId, introMode: 'auto', videoMode: 'auto' }
  return { config: { ...config, introId: chosen.id, videoId }, scene }
}
export function changeScene (row: BirthdayRow, input: BirthdaySceneInput) {
  if (!input || !Number.isSafeInteger(input.revision) || input.revision !== row.revision) throw Object.assign(new Error('El evento cambió. Actualice antes de configurar la celebración.'), { status: 409 })
  if (!['held', 'interrupted'].includes(row.playback)) throw new Error('Retire la programación antes de cambiar la celebración.')
  const original: BirthdaySettings = JSON.parse(row.settingsJSON)
  const scene = readScene(row) ?? { dayKey: birthdayDayKey(row.roomId), automaticIntroId: original.introId!, automaticVideoId: original.videoId!, introMode: 'auto', videoMode: 'auto' }
  if (input.automatic !== undefined && typeof input.automatic !== 'boolean') throw new Error('Selección automática inválida.')
  for (const id of [input.introId, input.videoId]) if (id !== undefined && (typeof id !== 'string' || !/^[\w-]{1,120}$/.test(id))) throw new Error('Seleccione recursos válidos.')
  const introId = input.automatic ? scene.automaticIntroId : input.introId ?? original.introId
  const videoId = input.automatic ? scene.automaticVideoId : input.videoId ?? original.videoId
  const intro = sceneAsset(row.roomId, introId, 'intro')
  sceneAsset(row.roomId, videoId, 'video')
  const next = { ...original, introId, videoId }
  const selected: BirthdaySceneSelection = { ...scene,
    introMode: input.automatic ? 'auto' : input.introId !== undefined ? 'manual' : scene.introMode,
    videoMode: input.automatic ? 'auto' : input.videoId !== undefined ? 'manual' : scene.videoMode }
  const greeting = row.greetingId && db.get<{ durationMs: number }>('SELECT durationMs FROM birthdayAssets WHERE roomId=? AND id=?', [row.roomId, row.greetingId])
  const music = sceneAsset(row.roomId, original.musicId, 'music')
  db.run('UPDATE birthdays SET settingsJSON=?,sceneJSON=?,durationMs=?,revision=revision+1 WHERE id=? AND roomId=?', [JSON.stringify(next), JSON.stringify(selected), intro.durationMs + music.durationMs + (greeting ? greeting.durationMs : original.targetSeconds * 1000), row.id, row.roomId])
}
export function recordBirthdayIntro (row: BirthdayRow) {
  const config: BirthdaySettings = JSON.parse(row.settingsJSON)
  const intro = sceneAsset(row.roomId, config.introId, 'intro')
  db.run('INSERT OR IGNORE INTO birthdayIntroUses(runId,birthdayId,roomId,dayKey,introId,checksum,startedAt) VALUES(?,?,?,?,?,?,?)', [row.token, row.id, row.roomId, birthdayDayKey(row.roomId, row.startedAt!), intro.id, intro.checksum, row.startedAt])
}

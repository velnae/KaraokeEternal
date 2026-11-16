import { db } from '../../lib/Database.js'
import Queue from '../../Queue/Queue.js'
import { binding, callControls, part, type PartRow } from './Store.js'
import { karaokeEffects } from './Backgrounds.js'
import { karaokeTurn } from './Start.js'
import { KARAOKE_REMINDER_MS, karaokeCountdownTail, karaokeCueClip, type KaraokeCueContext, type KaraokeCuePreparation } from '../../../shared/karaokeStage.js'
import type { AnimationClip } from '../../../shared/animation.js'

export const reminderVoice = (roomId: number) => db.get<PartRow>(`SELECT * FROM karaokeCallParts WHERE roomId=? AND kind='continuation' AND text='¡Karaoke!' AND retired=0 ORDER BY rowid DESC LIMIT 1`, [roomId])
const clip = (row: PartRow): AnimationClip => ({ id: row.id, title: row.title, displayText: '', kind: 'voice', checksum: row.checksum, durationMs: row.durationMs,
  source: 'Karaoke', license: 'Prepared table call', roomId: row.roomId!, url: `api/rooms/${row.roomId}/karaoke-calls/audio/${row.id}` })

export function karaokeCuePreparation (roomId: number, queueId: number): KaraokeCuePreparation {
  const item = Queue.get(roomId).entities[queueId]
  if (!item || item.requestIntent !== 'SING' || item.origin === 'HOUSE' || !['APPROVED', 'PLAYING', 'PLAYED'].includes(item.status)) return { assets: [], reminder: [] }
  const effects = karaokeEffects(roomId)
  const saved = item.tableId ? binding(roomId, item.tableId) : null
  const table = item.tableId ? db.get<{ code: string, status: string }>('SELECT code,status FROM roomTables WHERE roomId=? AND tableId=?', [roomId, item.tableId]) : null
  const tablePart = saved?.partId && table?.status === 'active' && saved.codeSnapshot === table.code
    && (item.tableLabelSnapshot === `Mesa ${table.code}` || item.tableLabelSnapshot?.startsWith(`Mesa ${table.code} · `))
    ? part(roomId, saved.partId)
    : null
  const voice = reminderVoice(roomId)
  const ending = effects.reminderEffectId ?? (voice ? clip(voice) : null)
  const reminder = tablePart && saved?.spokenText === tablePart.text && ending ? [clip(tablePart), ending] : []
  return { assets: [...new Map([...Object.values(effects).filter((asset): asset is AnimationClip => !!asset), ...reminder].map(asset => [asset.id, asset])).values()], reminder }
}

export function karaokeCueAllowed (roomId: number, cue: KaraokeCueContext, owner: string, checkDeadline = true, started = false) {
  if (db.get(`SELECT 1 FROM birthdays WHERE roomId=? AND playback IN ('scheduled','playing')`, [roomId])) return false
  const item = Queue.get(roomId).entities[cue.queueId]
  if (!item || item.requestIntent !== 'SING' || item.origin === 'HOUSE') return false
  if (cue.kind === 'countdown' && started && !checkDeadline) {
    const receipt = db.get<{ queueId: number, runId: string, revision: number, phase: string, ownerSocketId: string | null }>('SELECT * FROM karaokeStartTurns WHERE roomId=?', [roomId])
    const countdown = receipt?.queueId === cue.queueId && receipt.runId === cue.runId && receipt.revision === cue.revision && receipt.phase === 'countdown'
    if (receipt?.ownerSocketId === owner && (countdown || karaokeCountdownTail(cue, receipt)) && ['APPROVED', 'PLAYING'].includes(item.status)) return true
  }
  const turn = karaokeTurn(roomId)
  if (cue.kind === 'ended') return ['PLAYING', 'PLAYED'].includes(item.status)
  if (item.status !== 'APPROVED' || (!callControls(roomId).enabled && turn?.queueId !== cue.queueId)) return false
  if (cue.kind === 'entry') return !turn || (turn.queueId === cue.queueId && !turn.presented)
  if (!turn || turn.queueId !== cue.queueId || turn.runId !== cue.runId || turn.revision !== cue.revision) return false
  const saved = db.get<{ ownerSocketId: string | null, reminderAt: number | null }>('SELECT ownerSocketId,reminderAt FROM karaokeStartTurns WHERE roomId=?', [roomId])
  if (saved?.ownerSocketId !== owner) return false
  if (cue.kind === 'countdown') return turn.phase === 'countdown' && (turn.endsAt ?? 0) > Date.now() + (checkDeadline ? 250 : 0)
  return turn.phase === 'waiting' && (!checkDeadline || (saved.reminderAt !== null && saved.reminderAt <= Date.now()))
}

export function karaokeCueAssets (roomId: number, cue: KaraokeCueContext) {
  const effects = karaokeEffects(roomId)
  if (cue.kind === 'reminder') return karaokeCuePreparation(roomId, cue.queueId).reminder
  const effect = effects[`${cue.kind}EffectId`]
  return effect ? [karaokeCueClip(effect, cue.kind)] : []
}

export function consumeReminder (roomId: number) {
  db.run('UPDATE karaokeStartTurns SET reminderAt=? WHERE roomId=?', [Date.now() + KARAOKE_REMINDER_MS, roomId])
}

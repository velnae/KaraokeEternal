import { randomUUID } from 'node:crypto'
import { db } from '../../lib/Database.js'
import { callControls } from './Store.js'
import { KARAOKE_COUNTDOWN_MS, type KaraokeTurn } from '../../../shared/karaokeStart.js'

interface Row extends Omit<KaraokeTurn, 'playerPresent' | 'presented' | 'phase'> { roomId: number, ownerSocketId: string | null, heartbeatAt: number, presented: number, phase: KaraokeTurn['phase'] | 'played' }
const row = (roomId: number) => db.get<Row>('SELECT * FROM karaokeStartTurns WHERE roomId=?', [roomId])
const dto = (value: Row): KaraokeTurn => ({ queueId: value.queueId, runId: value.runId, phase: value.phase as KaraokeTurn['phase'], presented: !!value.presented,
  revision: value.revision, endsAt: value.endsAt, playerPresent: !!value.ownerSocketId && value.heartbeatAt > Date.now() - 15000 })
const fail = (message: string): never => {
  throw Object.assign(new Error(message), { status: 409 })
}

export function resetKaraokeTurn (roomId: number, owner?: string) {
  const saved = row(roomId)
  if (!saved || saved.phase === 'played' || (owner && saved.ownerSocketId !== owner)) return
  db.run(`UPDATE karaokeStartTurns SET phase=CASE WHEN presented=1 THEN 'waiting' ELSE 'presenting' END,endsAt=NULL,ownerSocketId=NULL,revision=revision+1 WHERE roomId=?`, [roomId])
}
export function recoverKaraokeTurns () {
  for (const saved of db.all<Row>('SELECT * FROM karaokeStartTurns')) resetKaraokeTurn(saved.roomId)
}
export function karaokeTurn (roomId: number): KaraokeTurn | null {
  let saved = row(roomId)
  if (!saved) return null
  if (saved.phase === 'played') return null
  const valid = db.get(`SELECT 1 FROM queue q JOIN rooms r USING(roomId) WHERE q.roomId=? AND q.queueId=? AND q.status='APPROVED' AND q.requestIntent='SING' AND q.origin!='HOUSE' AND r.status='open'`, [roomId, saved.queueId])
  if (!valid) {
    db.run('DELETE FROM karaokeStartTurns WHERE roomId=?', [roomId])
    return null
  }
  if (saved.ownerSocketId && saved.heartbeatAt <= Date.now() - 15000) {
    resetKaraokeTurn(roomId)
    saved = row(roomId)!
  }
  return dto(saved)
}
export function beginKaraokeTurn (roomId: number, queueId: number, owner: string) {
  const current = karaokeTurn(roomId)
  if (current) {
    const saved = row(roomId)!
    if (saved.ownerSocketId !== owner) resetKaraokeTurn(roomId)
    db.run('UPDATE karaokeStartTurns SET ownerSocketId=?,heartbeatAt=? WHERE roomId=?', [owner, Date.now(), roomId])
    return karaokeTurn(roomId)
  }
  const item = db.get<{ status: string, requestIntent: string, origin: string }>('SELECT status,requestIntent,origin FROM queue WHERE roomId=? AND queueId=?', [roomId, queueId])
  if (!item || item.status !== 'APPROVED' || item.requestIntent !== 'SING' || item.origin === 'HOUSE' || callControls(roomId).automaticStart) return null
  db.run('DELETE FROM karaokeStartTurns WHERE roomId=?', [roomId])
  db.run(`INSERT INTO karaokeStartTurns(roomId,queueId,runId,ownerSocketId,phase,heartbeatAt) VALUES(?,?,?,?,'presenting',?)`, [roomId, queueId, randomUUID(), owner, Date.now()])
  return karaokeTurn(roomId)
}
export function operateKaraokeTurn (roomId: number, owner: string, input: { operation?: unknown, queueId?: unknown, runId?: unknown, revision?: unknown }) {
  const receipt = row(roomId)
  if (input.operation === 'played' && receipt?.phase === 'played' && receipt.queueId === input.queueId && receipt.runId === input.runId && receipt.ownerSocketId === owner) return null
  const current = karaokeTurn(roomId)
  if (!current || input.queueId !== current.queueId || input.runId !== current.runId) return fail('El turno cambió. Actualice la cola.')
  const saved = row(roomId)!
  const operation = input.operation
  const birthday = () => !!db.get(`SELECT 1 FROM birthdays WHERE roomId=? AND playback IN ('scheduled','playing')`, [roomId])
  if (['heartbeat', 'presented', 'consume', 'played'].includes(String(operation))) {
    if (saved.ownerSocketId !== owner) return fail('El reproductor perdió este turno.')
    db.run('UPDATE karaokeStartTurns SET heartbeatAt=? WHERE roomId=?', [Date.now(), roomId])
    db.run('UPDATE karaokeBackgroundScenes SET untilAt=? WHERE roomId=? AND queueId=?', [Date.now() + 60000, roomId, current.queueId])
    if (['consume', 'played'].includes(String(operation)) && birthday()) {
      db.run(`UPDATE karaokeStartTurns SET phase='waiting',endsAt=NULL,revision=revision+1 WHERE roomId=?`, [roomId])
      return fail('Espere a que termine el cumpleaños y confirme nuevamente el karaoke.')
    }
    if (operation === 'presented' && !saved.presented) db.run(`UPDATE karaokeStartTurns SET presented=1,phase='waiting',revision=revision+1 WHERE roomId=?`, [roomId])
    if (operation === 'consume') {
      if (current.phase === 'released') return current
      if (current.phase !== 'countdown' || current.endsAt === null || current.endsAt > Date.now()) return fail('El conteo todavía no terminó.')
      db.run(`UPDATE karaokeStartTurns SET phase='released',revision=revision+1 WHERE roomId=?`, [roomId])
    }
    if (operation === 'played') {
      if (current.phase !== 'released') return fail('Confirme el inicio de este karaoke.')
      db.run(`UPDATE queue SET status='PLAYING',dateUpdated=? WHERE roomId=? AND queueId=? AND status='APPROVED'`, [Math.floor(Date.now() / 1000), roomId, current.queueId])
      db.run(`UPDATE karaokeStartTurns SET phase='played' WHERE roomId=?`, [roomId])
    }
  } else {
    if (!current.playerPresent) return fail('Abra el reproductor para iniciar el karaoke.')
    if (operation === 'start' && current.phase === 'countdown') return current
    if (input.revision !== current.revision) return fail('El turno cambió. Revise su estado antes de continuar.')
    if (operation === 'start') {
      if (birthday()) return fail('Espere a que termine el cumpleaños.')
      if (current.phase !== 'waiting') return fail('Espere a que termine la presentación.')
      db.run(`UPDATE karaokeStartTurns SET phase='countdown',endsAt=?,revision=revision+1 WHERE roomId=?`, [Date.now() + KARAOKE_COUNTDOWN_MS, roomId])
    } else if (operation === 'cancel') {
      if (!['waiting', 'countdown'].includes(current.phase)) return fail('La canción ya está iniciando.')
      db.run(`UPDATE karaokeStartTurns SET phase='waiting',endsAt=NULL,revision=revision+1 WHERE roomId=?`, [roomId])
    } else return fail('Operación de inicio no válida.')
  }
  return karaokeTurn(roomId)
}
export function discardKaraokeTurn (roomId: number, skip = false) {
  const saved = row(roomId)
  if (!saved) return false
  if (saved && skip) db.run(`UPDATE queue SET status='REMOVED',dateUpdated=? WHERE roomId=? AND queueId=? AND status='APPROVED'`, [Math.floor(Date.now() / 1000), roomId, saved.queueId])
  db.run('DELETE FROM karaokeStartTurns WHERE roomId=?', [roomId])
  return true
}

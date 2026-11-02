import { db } from '../lib/Database.js'
import Queue from '../Queue/Queue.js'
import Rooms from '../Rooms/Rooms.js'
import { buildRoundRobinQueue } from '../../shared/roundRobin.js'
import { buildPlayerHistory } from '../../shared/playerHistory.js'
import { normalizeQueuePrefs } from '../../shared/queueRules.js'
import { greetingDuration, validateGreeting, type Greeting, type GreetingGrant, type GreetingSnapshot, type GreetingAudioStatus } from '../../shared/greetings.js'

export interface GreetingPlayerStatus { queueId?: number, historyJSON?: string, nextUserId?: number | null, isAtQueueEnd?: boolean }
interface Identity { roomId: number, userId: number, isAdmin?: boolean }

export default class Greetings {
  static order (roomId: number, status: GreetingPlayerStatus = {}, includePendingId?: number) {
    const queue = Queue.get(roomId)
    if (includePendingId && queue.entities[includePendingId]?.status === 'PENDING_APPROVAL') queue.entities[includePendingId].status = 'APPROVED'
    const history = buildPlayerHistory(status.historyJSON ?? '[]', queue.result, queue.entities)
    return buildRoundRobinQueue(queue.result, queue.entities, history, status.queueId ?? -1, status.nextUserId ?? null,
      normalizeQueuePrefs(Rooms.get(roomId).entities[roomId]?.prefs?.queue))
  }

  static opportunity (identity: Identity, queueId: number, status: GreetingPlayerStatus): { greeting: Greeting | null, canAdd: boolean, reason: string | null } {
    const song = Queue.get(identity.roomId).entities[queueId]
    if (!song || song.origin !== 'PARTICIPANT' || song.userId !== identity.userId) throw new Error('El saludo debe acompañar a tu pedido musical')
    const greeting = Greetings.items(identity.roomId).find(item => item.queueId === queueId) ?? null
    if (greeting) return { greeting, canAdd: false, reason: null }
    if (!Rooms.get(identity.roomId).entities[identity.roomId]) return { greeting: null, canAdd: false, reason: 'La sala está cerrada.' }
    if (!['PENDING_APPROVAL', 'APPROVED'].includes(song.status)) return { greeting: null, canAdd: false, reason: 'La ventana de saludos de este pedido ya cerró.' }
    const turn = Greetings.order(identity.roomId, status, queueId).turns.find(turn => turn.ids.includes(queueId))
    if (!turn?.startsNewTurn || Greetings.turnFor(queueId) || turn.ids.some(id => Greetings.turnFor(id))) {
      return { greeting: null, canAdd: false, reason: 'La ventana de saludos de este turno ya cerró. Podrás agregar uno en tu próximo turno.' }
    }
    return { greeting: null, canAdd: true, reason: null }
  }

  static attach (identity: Identity, queueId: number, value: unknown, status: GreetingPlayerStatus) {
    const opportunity = Greetings.opportunity(identity, queueId, status)
    const song = Queue.get(identity.roomId).entities[queueId]
    const draft = validateGreeting(value, song.userDisplayName)
    if (opportunity.greeting) {
      // The unique musical request is the idempotency key, including lost acknowledgments.
      if (opportunity.greeting.recipient === draft.recipient && opportunity.greeting.message === draft.message) return opportunity.greeting.greetingId
      throw new Error('Este pedido ya tiene un saludo. Puedes consultarlo en Mis saludos.')
    }
    if (!opportunity.canAdd) throw new Error(opportunity.reason!)
    const result = db.run('INSERT INTO greetings(queueId,roomId,userId,sender,tableLabel,recipient,message,createdAt) VALUES(?,?,?,?,?,?,?,?)',
      [queueId, identity.roomId, identity.userId, song.userDisplayName, song.tableLabelSnapshot ?? null, draft.recipient, draft.message, Date.now()])
    return Number(result.lastID)
  }

  static turnFor (queueId: number) {
    return db.get<{ turnKey: number }>('SELECT turnKey FROM greetingTurnItems WHERE queueId=?', [queueId])?.turnKey
  }

  static reconcile (roomId: number) {
    db.run(`UPDATE greetings SET status='CANCELLED',reason='El pedido musical fue cancelado'
      WHERE roomId=? AND status IN ('QUEUED','RESERVED','DISPLAYING') AND queueId IN
      (SELECT queueId FROM queue WHERE status IN ('REMOVED','REJECTED'))`, [roomId])
    db.run(`UPDATE greetings SET status=CASE WHEN status='DISPLAYING' THEN 'INTERRUPTED' ELSE 'SKIPPED' END,
      reason='La pantalla no confirmó la entrega a tiempo'
      WHERE roomId=? AND status IN ('RESERVED','DISPLAYING') AND turnKey IN
      (SELECT turnKey FROM greetingTurns WHERE untilAt<=? OR finished=1)`, [roomId, Date.now()])
    db.run(`UPDATE greetings SET status='SKIPPED',reason='El turno ya comenzó'
      WHERE roomId=? AND status='QUEUED' AND queueId IN
      (SELECT queueId FROM queue WHERE status IN ('PLAYING','PLAYED','FAILED'))`, [roomId])
  }

  static items (roomId: number): Greeting[] {
    Greetings.reconcile(roomId)
    const enabled = Greetings.audioEnabled(roomId)
    return db.all<Greeting & { audioJobId: string | null, audioReason: string | null, jobStatus: GreetingAudioStatus | null, jobError: string | null, durationMs: number | null, cancelRequested: number | null }>(
      `SELECT g.*,q.title,j.status jobStatus,j.error jobError,j.durationMs,j.cancelRequested FROM greetings g JOIN queue q USING(queueId)
      LEFT JOIN greetingAudioJobs j ON j.jobId=g.audioJobId WHERE g.roomId=? ORDER BY g.greetingId`, [roomId])
      .map(({ audioJobId, audioReason, jobStatus, jobError, durationMs, cancelRequested, ...item }) => {
        void audioJobId
        if (!enabled) return item
        return { ...item, audio: { status: cancelRequested ? 'cancelled' as const : jobStatus ?? 'unavailable' as const,
          reason: audioReason ?? jobError ?? (!jobStatus ? 'La entrega en pantalla está disponible mientras se prepara la voz.' : null), durationMs } }
      })
  }

  static snapshot (identity: Identity, status: GreetingPlayerStatus = {}): GreetingSnapshot {
    const order = Greetings.order(identity.roomId, status)
    return {
      paused: Greetings.paused(identity.roomId),
      audioEnabled: Greetings.audioEnabled(identity.roomId),
      items: Greetings.items(identity.roomId).filter(item => identity.isAdmin || item.userId === identity.userId),
      turns: order.turns.filter(turn => identity.isAdmin || order.entities[turn.ids[0]].userId === identity.userId)
        .map(turn => ({ key: turn.ids[0], queueIds: turn.ids, userId: order.entities[turn.ids[0]].userId })),
    }
  }

  static paused (roomId: number) { return db.get<{ paused: number }>('SELECT paused FROM greetingControls WHERE roomId=?', [roomId])?.paused === 1 }

  static audioEnabled (roomId: number) { return db.get<{ audioEnabled: number }>('SELECT audioEnabled FROM greetingControls WHERE roomId=?', [roomId])?.audioEnabled === 1 }

  static prepareAudio (roomId: number, enabled: boolean) {
    db.run('INSERT INTO greetingControls(roomId,audioEnabled) VALUES(?,?) ON CONFLICT(roomId) DO UPDATE SET audioEnabled=excluded.audioEnabled', [roomId, enabled ? 1 : 0])
  }

  static pause (roomId: number, paused: boolean) {
    db.run('INSERT INTO greetingControls(roomId,paused) VALUES(?,?) ON CONFLICT(roomId) DO UPDATE SET paused=excluded.paused', [roomId, paused ? 1 : 0])
    if (paused) Greetings.interrupt(roomId, 'Publicación pausada por el operador')
  }

  static remove (identity: Identity, greetingId: number) {
    const item = Greetings.items(identity.roomId).find(item => item.greetingId === greetingId)
    if (!item || (!identity.isAdmin && (item.userId !== identity.userId || item.status !== 'QUEUED'))) throw new Error('No puedes retirar este saludo')
    db.run(`UPDATE greetings SET status=?,reason=? WHERE greetingId=? AND status IN ('QUEUED','RESERVED','DISPLAYING')`,
      [identity.isAdmin ? 'REMOVED' : 'CANCELLED', identity.isAdmin ? 'Retirado por el operador' : 'Cancelado por el remitente', greetingId])
  }

  static interrupt (roomId: number, reason: string, ownerSocketId?: string) {
    const turns = db.all<{ turnKey: number }>(`SELECT turnKey FROM greetingTurns WHERE roomId=? AND finished=0${ownerSocketId ? ' AND ownerSocketId=?' : ''}`, ownerSocketId ? [roomId, ownerSocketId] : [roomId])
    for (const { turnKey } of turns) {
      db.run(`UPDATE greetings SET status=CASE WHEN status='DISPLAYING' THEN 'INTERRUPTED' ELSE 'SKIPPED' END,reason=? WHERE turnKey=? AND status IN ('RESERVED','DISPLAYING')`, [reason, turnKey])
      db.run('UPDATE greetingTurns SET finished=1 WHERE turnKey=?', [turnKey])
    }
  }

  static reserve (roomId: number, socketId: string, expectedQueueId: number, status: GreetingPlayerStatus, blocker?: string): GreetingGrant | null {
    if (!Rooms.get(roomId).entities[roomId]) throw new Error('La sala está cerrada')
    Greetings.reconcile(roomId)
    const order = Greetings.order(roomId, status)
    const index = order.result.indexOf(status.queueId ?? -1)
    const next = order.result.slice(index + 1).find(id => order.entities[id].status === 'APPROVED')
    if (next !== expectedQueueId) throw new Error('El próximo turno cambió')
    const current = order.entities[status.queueId ?? -1]
    if (current && !status.isAtQueueEnd && !['PLAYED', 'FAILED'].includes(current.status)) throw new Error('La canción todavía ocupa la sala')
    const turn = order.turns.find(turn => turn.ids[0] === next)
    if (!turn) return null
    if (turn.ids.some(id => Greetings.turnFor(id))) return null
    const turnKey = next!
    const selected = Greetings.items(roomId).filter(item => turn.ids.includes(item.queueId) && item.status === 'QUEUED')
      .sort((a, b) => turn.ids.indexOf(a.queueId) - turn.ids.indexOf(b.queueId))
    const reason = !turn.startsNewTurn ? 'El turno ya comenzó' : Greetings.paused(roomId) ? 'Publicación pausada' : blocker
    const until = Date.now() + selected.reduce((total, item) => total + greetingDuration(item) + 2000, 2000)
    db.exec('SAVEPOINT greeting_turn')
    try {
      db.run('INSERT INTO greetingTurns(turnKey,roomId,ownerSocketId,untilAt,finished) VALUES(?,?,?,?,?)', [turnKey, roomId, socketId, until, reason || !selected.length ? 1 : 0])
      for (const [position, id] of turn.ids.entries()) db.run('INSERT INTO greetingTurnItems(queueId,turnKey,position) VALUES(?,?,?)', [id, turnKey, position])
      for (const item of selected) db.run('UPDATE greetings SET turnKey=?,status=?,reason=? WHERE greetingId=?', [turnKey, reason ? 'SKIPPED' : 'RESERVED', reason ?? null, item.greetingId])
      db.exec('RELEASE greeting_turn')
    } catch (error) {
      db.exec('ROLLBACK TO greeting_turn; RELEASE greeting_turn')
      throw error
    }
    return reason || !selected.length ? null : { turnKey, until, items: selected.map(item => ({ ...item, turnKey, status: 'RESERVED' })) }
  }

  static event (roomId: number, socketId: string, turnKey: number, greetingId: number, event: 'start' | 'end') {
    if (!Rooms.get(roomId).entities[roomId]) throw new Error('La sala está cerrada')
    Greetings.reconcile(roomId)
    const turn = db.get<{ ownerSocketId: string, untilAt: number, finished: number }>('SELECT * FROM greetingTurns WHERE turnKey=? AND roomId=?', [turnKey, roomId])
    if (!turn || turn.ownerSocketId !== socketId || turn.finished || turn.untilAt <= Date.now()) throw new Error('La ventana del saludo terminó')
    const members = db.all<{ queueId: number }>('SELECT queueId FROM greetingTurnItems WHERE turnKey=? ORDER BY position', [turnKey])
    const items = Greetings.items(roomId).filter(item => item.turnKey === turnKey)
      .sort((a, b) => members.findIndex(row => row.queueId === a.queueId) - members.findIndex(row => row.queueId === b.queueId))
    const item = items.find(item => item.greetingId === greetingId)
    if (!item) throw new Error('El saludo no pertenece al turno')
    if (event === 'start') {
      if (item.status === 'DISPLAYING') return
      if (items.find(entry => ['RESERVED', 'DISPLAYING'].includes(entry.status))?.greetingId !== greetingId) throw new Error('El saludo cambió o fue retirado')
      db.run('UPDATE greetings SET status=\'DISPLAYING\',startedAt=? WHERE greetingId=? AND status=\'RESERVED\'', [Date.now(), greetingId])
    } else {
      const started = db.get<{ startedAt: number }>('SELECT startedAt FROM greetings WHERE greetingId=?', [greetingId])?.startedAt
      if (item.status !== 'DISPLAYING' || !started || Date.now() - started < greetingDuration(item) - 100) throw new Error('La pantalla aún no completó el saludo')
      db.run('UPDATE greetings SET status=\'DISPLAYED\' WHERE greetingId=?', [greetingId])
    }
  }

  static finish (roomId: number, socketId: string, turnKey: number) {
    const turn = db.get('SELECT turnKey FROM greetingTurns WHERE roomId=? AND ownerSocketId=? AND turnKey=?', [roomId, socketId, turnKey])
    if (!turn) return
    db.run(`UPDATE greetings SET status=CASE WHEN status='DISPLAYING' THEN 'INTERRUPTED' ELSE 'SKIPPED' END,
      reason='La entrega del turno terminó' WHERE turnKey=? AND status IN ('RESERVED','DISPLAYING')`, [turnKey])
    db.run('UPDATE greetingTurns SET finished=1 WHERE turnKey=?', [turnKey])
  }
}

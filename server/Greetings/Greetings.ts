import { db } from '../lib/Database.js'
import { canOperate } from '../../shared/permissions.js'
import Queue from '../Queue/Queue.js'
import Rooms from '../Rooms/Rooms.js'
import { buildRoundRobinQueue } from '../../shared/roundRobin.js'
import { buildPlayerHistory } from '../../shared/playerHistory.js'
import { normalizeQueuePrefs } from '../../shared/queueRules.js'
import { greetingDuration, greetingMessageLimit, validateGreeting, type Greeting, type GreetingGrant, type GreetingSnapshot, type GreetingAudioStatus, type GreetingPreparation, type GreetingVoiceStatus, type GreetingPlaybackPrefs } from '../../shared/greetings.js'
import { captureTransitionBackground } from '../TransitionVideo/Playback.js'
import Animation from '../Animation/Animation.js'
import { catalogClips } from '../Animation/catalog.js'
import { greetingPlayback, planGreetingTransition } from './transition.js'
import { planCallTransition, prepareCall } from '../Animation/Calls/Playback.js'
import { isGreetingAllowed } from '../../shared/greetings.js'
import { publicGuestName } from '../../shared/guestName.js'

export interface GreetingPlayerStatus { queueId?: number, historyJSON?: string, nextUserId?: number | null, isAtQueueEnd?: boolean, queueDecisionAt?: number }
interface Identity { roomId: number, userId: number, role?: string, isAdmin?: boolean }
interface Delivery { ownerSocketId: string, untilAt: number, finished: number, displayMs: number | null, interventionId: string | null, voiceStatus: GreetingVoiceStatus | null }

export default class Greetings {
  static order (roomId: number, status: GreetingPlayerStatus = {}, includePendingId?: number) {
    const queue = Queue.get(roomId)
    if (includePendingId && queue.entities[includePendingId]?.status === 'PENDING_APPROVAL') queue.entities[includePendingId].status = 'APPROVED'
    const history = buildPlayerHistory(status.historyJSON ?? '[]', queue.result, queue.entities)
    return buildRoundRobinQueue(queue.result, queue.entities, history, status.queueId ?? -1, status.nextUserId ?? null,
      normalizeQueuePrefs(Rooms.get(roomId).entities[roomId]?.prefs?.queue), status.queueDecisionAt || undefined)
  }

  static opportunity (identity: Identity, queueId: number, status: GreetingPlayerStatus): { greeting: Greeting | null, canAdd: boolean, reason: string | null } {
    // Keep the caller contract for older inline submissions; eligibility now
    // follows this song's reservation, not the canonical participant turn.
    void status
    const song = Queue.get(identity.roomId).entities[queueId]
    if (!song || song.origin !== 'PARTICIPANT' || song.userId !== identity.userId) throw new Error('El saludo debe acompañar a tu pedido musical')
    const greeting = Greetings.items(identity.roomId).find(item => item.queueId === queueId) ?? null
    if (greeting) return { greeting, canAdd: false, reason: null }
    if (Rooms.get(identity.roomId).entities[identity.roomId]?.status !== 'open') return { greeting: null, canAdd: false, reason: 'La sala está cerrada.' }
    if (!['PENDING_APPROVAL', 'APPROVED'].includes(song.status)) return { greeting: null, canAdd: false, reason: 'La ventana de saludos de este pedido ya cerró.' }
    if (db.get('SELECT 1 FROM greetingTurns WHERE turnKey=? AND roomId=?', [queueId, identity.roomId])) {
      return { greeting: null, canAdd: false, reason: 'La transición de esta canción ya comenzó. Puedes agregar un saludo a otro pedido pendiente.' }
    }
    return { greeting: null, canAdd: true, reason: null }
  }

  static attach (identity: Identity, queueId: number, value: unknown, status: GreetingPlayerStatus) {
    const opportunity = Greetings.opportunity(identity, queueId, status)
    const song = Queue.get(identity.roomId).entities[queueId]
    const draft = validateGreeting(value, song.userDisplayName)
    if (opportunity.greeting) {
      // The unique musical request is the idempotency key, including lost acknowledgments.
      if (opportunity.greeting.message === draft.message) return opportunity.greeting.greetingId
      throw new Error('Este pedido ya tiene un saludo. Puedes consultarlo en Mis pedidos.')
    }
    if (!opportunity.canAdd) throw new Error(opportunity.reason!)
    const result = db.run('INSERT INTO greetings(queueId,roomId,userId,sender,tableLabel,message,createdAt) VALUES(?,?,?,?,?,?,?)',
      [queueId, identity.roomId, identity.userId, song.userDisplayName, song.tableLabelSnapshot ?? null, draft.message, Date.now()])
    return Number(result.lastID)
  }

  static turnFor (queueId: number) {
    return db.get<{ turnKey: number }>('SELECT turnKey FROM greetingTurnItems WHERE queueId=?', [queueId])?.turnKey
  }

  static reconcile (roomId: number) {
    for (const item of db.all<Greeting>(`SELECT * FROM greetings WHERE roomId=? AND status IN ('QUEUED','RESERVED','DISPLAYING')`, [roomId])) {
      if (isGreetingAllowed(item)) continue
      const reason = 'Saludo retirado: el texto o el remitente no cumple las reglas de publicación.'
      db.run(`UPDATE greetings SET status='REMOVED',reason=?,audioJobId=NULL WHERE greetingId=?`, [reason, item.greetingId])
      const turn = item.turnKey && db.get<Delivery>('SELECT * FROM greetingTurns WHERE turnKey=?', [item.turnKey])
      if (turn && turn.interventionId) Animation.cancel(roomId, reason, turn.interventionId)
    }
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
    db.run(`UPDATE greetingTurns SET voiceStatus='INTERRUPTED' WHERE roomId=? AND voiceStatus IN ('SCHEDULED','PLAYING')
      AND (finished=1 OR untilAt<=? OR EXISTS(SELECT 1 FROM greetings g WHERE g.turnKey=greetingTurns.turnKey AND g.status NOT IN ('RESERVED','DISPLAYING')))`, [roomId, Date.now()])
  }

  static items (roomId: number): Greeting[] {
    Greetings.reconcile(roomId)
    const enabled = Greetings.audioEnabled(roomId)
    return db.all<Greeting & { audioJobId: string | null, audioReason: string | null, jobStatus: GreetingAudioStatus | null, jobError: string | null, durationMs: number | null, cancelRequested: number | null, voiceStatus: GreetingVoiceStatus | null, voiceReason: string | null }>(
      `SELECT g.*,q.title,j.status jobStatus,j.error jobError,j.durationMs,j.cancelRequested,t.voiceStatus,t.voiceReason FROM greetings g JOIN queue q USING(queueId)
      LEFT JOIN greetingAudioJobs j ON j.jobId=g.audioJobId LEFT JOIN greetingTurns t ON t.turnKey=g.turnKey WHERE g.roomId=? ORDER BY g.greetingId`, [roomId])
      .map(({ audioJobId, audioReason, jobStatus, jobError, durationMs, cancelRequested, voiceStatus, voiceReason, ...item }) => {
        void audioJobId
        const result: Greeting = isGreetingAllowed(item) ? { ...item } : { ...item, message: 'Saludo no disponible.', sender: publicGuestName(item.sender) }
        if (voiceStatus) result.playback = { status: voiceStatus, reason: voiceReason }
        if (enabled) result.audio = { status: cancelRequested ? 'cancelled' : jobStatus ?? 'unavailable',
          reason: audioReason ?? jobError ?? (!jobStatus ? 'La entrega en pantalla está disponible mientras se prepara la voz.' : null), durationMs }
        return result
      })
  }

  static snapshot (identity: Identity, status: GreetingPlayerStatus = {}): GreetingSnapshot {
    const order = Greetings.order(identity.roomId, status)
    const playback = greetingPlayback(identity.roomId)
    return {
      paused: Greetings.paused(identity.roomId),
      audioEnabled: Greetings.audioEnabled(identity.roomId),
      playback: playback.prefs,
      playbackVersion: playback.version,
      items: Greetings.items(identity.roomId).filter(item => canOperate(identity) || item.userId === identity.userId),
      opportunities: Object.fromEntries(Object.values(order.entities)
        .filter(item => item.origin === 'PARTICIPANT' && item.userId === identity.userId && ['PENDING_APPROVAL', 'APPROVED'].includes(item.status))
        .map((item) => {
          const { canAdd, reason } = Greetings.opportunity(identity, item.queueId, status)
          return [item.queueId, { canAdd, reason, maxMessageLength: greetingMessageLimit(item.userDisplayName) }]
        })),
      turns: order.turns.filter(turn => canOperate(identity) || order.entities[turn.ids[0]].userId === identity.userId)
        .map(turn => ({ key: turn.ids[0], queueIds: turn.ids, userId: order.entities[turn.ids[0]].userId })),
    }
  }

  static paused (roomId: number) { return db.get<{ paused: number }>('SELECT paused FROM greetingControls WHERE roomId=?', [roomId])?.paused === 1 }

  static audioEnabled (roomId: number) { return db.get<{ audioEnabled: number }>('SELECT audioEnabled FROM greetingControls WHERE roomId=?', [roomId])?.audioEnabled === 1 }

  static prepareAudio (roomId: number, enabled: boolean) {
    db.run('INSERT INTO greetingControls(roomId,audioEnabled) VALUES(?,?) ON CONFLICT(roomId) DO UPDATE SET audioEnabled=excluded.audioEnabled', [roomId, enabled ? 1 : 0])
    if (!enabled) {
      db.run(`UPDATE greetingControls SET playbackJSON=json_set(playbackJSON,'$.enabled',json('false')),playbackVersion=playbackVersion+1 WHERE roomId=?`, [roomId])
      if (Animation.active(roomId)?.origin === 'GREETING') Animation.cancel(roomId, 'Lectura de saludos desactivada')
    }
  }

  static configurePlayback (roomId: number, input: unknown, version: unknown) {
    const current = greetingPlayback(roomId)
    if (!Number.isInteger(version) || version !== current.version) throw new Error('Los ajustes cambiaron. Actualice antes de guardar.')
    const value = input as GreetingPlaybackPrefs | null
    if (!value || typeof value.enabled !== 'boolean' || typeof value.ambienceEnabled !== 'boolean'
      || !(value.introClipId === null || (typeof value.introClipId === 'string' && /^[\w-]{1,100}$/.test(value.introClipId)))) throw new Error('Revise los ajustes de lectura.')
    if (value.introClipId && !catalogClips(roomId).some(clip => clip.id === value.introClipId && (clip.kind ?? 'voice') === 'voice' && clip.approvedForAuto)) throw new Error('Seleccione una presentación disponible del catálogo.')
    const prefs: GreetingPlaybackPrefs = { enabled: value.enabled, introClipId: value.introClipId, ambienceEnabled: value.ambienceEnabled }
    db.run(`INSERT INTO greetingControls(roomId,audioEnabled,playbackJSON,playbackVersion) VALUES(?,?,?,?)
      ON CONFLICT(roomId) DO UPDATE SET audioEnabled=CASE WHEN excluded.audioEnabled=1 THEN 1 ELSE audioEnabled END,playbackJSON=excluded.playbackJSON,playbackVersion=excluded.playbackVersion`,
    [roomId, prefs.enabled ? 1 : 0, JSON.stringify(prefs), current.version + 1])
    if (!prefs.enabled && Animation.active(roomId)?.origin === 'GREETING') Animation.cancel(roomId, 'Lectura de saludos desactivada')
  }

  static pause (roomId: number, paused: boolean) {
    db.run('INSERT INTO greetingControls(roomId,paused) VALUES(?,?) ON CONFLICT(roomId) DO UPDATE SET paused=excluded.paused', [roomId, paused ? 1 : 0])
    if (paused) Greetings.interrupt(roomId, 'Publicación pausada por el operador')
  }

  static remove (identity: Identity, greetingId: number) {
    const item = Greetings.items(identity.roomId).find(item => item.greetingId === greetingId)
    if (!item || (!canOperate(identity) && (item.userId !== identity.userId || item.status !== 'QUEUED'))) throw new Error('No puedes retirar este saludo')
    db.run(`UPDATE greetings SET status=?,reason=? WHERE greetingId=? AND status IN ('QUEUED','RESERVED','DISPLAYING')`,
      [canOperate(identity) ? 'REMOVED' : 'CANCELLED', canOperate(identity) ? 'Retirado por el operador' : 'Cancelado por el remitente', greetingId])
    if (item.turnKey) {
      const delivery = db.get<Delivery>('SELECT * FROM greetingTurns WHERE turnKey=?', [item.turnKey])
      if (delivery?.interventionId) Animation.cancel(identity.roomId, 'Saludo retirado', delivery.interventionId)
    }
  }

  static interrupt (roomId: number, reason: string, ownerSocketId?: string) {
    const turns = db.all<{ turnKey: number, interventionId: string | null }>(`SELECT turnKey,interventionId FROM greetingTurns WHERE roomId=? AND finished=0${ownerSocketId ? ' AND ownerSocketId=?' : ''}`, ownerSocketId ? [roomId, ownerSocketId] : [roomId])
    for (const { turnKey, interventionId } of turns) {
      db.run(`UPDATE greetings SET status=CASE WHEN status='DISPLAYING' THEN 'INTERRUPTED' ELSE 'SKIPPED' END,reason=? WHERE turnKey=? AND status IN ('RESERVED','DISPLAYING')`, [reason, turnKey])
      db.run('UPDATE greetingTurns SET finished=1 WHERE turnKey=?', [turnKey])
      if (interventionId) Animation.cancel(roomId, reason, interventionId)
    }
  }

  static reserve (roomId: number, socketId: string, expectedQueueId: number, status: GreetingPlayerStatus, blocker?: string, prepared: GreetingPreparation | null = null, ready: string[] = [], userId = 0, remainingMs = 25000): GreetingGrant | null {
    if (!Rooms.get(roomId).entities[roomId]) throw new Error('La sala está cerrada')
    Greetings.reconcile(roomId)
    const order = Greetings.order(roomId, status)
    const index = order.result.indexOf(status.queueId ?? -1)
    const next = order.result.slice(index + 1).find(id => order.entities[id].status === 'APPROVED')
    if (next !== expectedQueueId) throw new Error('El próximo turno cambió')
    const current = order.entities[status.queueId ?? -1]
    if (current && !status.isAtQueueEnd && !['PLAYED', 'FAILED'].includes(current.status)) throw new Error('La canción todavía ocupa la sala')
    const turn = order.turns.find(turn => turn.ids.includes(next!))
    const call = prepareCall(roomId, next!)
    if (!turn && !call) return null
    if (db.get('SELECT 1 FROM greetingTurns WHERE turnKey=?', [next])) return null
    const turnKey = next!
    const selected = Greetings.items(roomId).find(item => item.queueId === next && item.status === 'QUEUED')
    const reason = Greetings.paused(roomId) ? 'Publicación pausada' : blocker
    const control = greetingPlayback(roomId)
    const compatible = selected && prepared?.queueId === next && prepared.greetingId === selected.greetingId && prepared.playbackVersion === control.version
    const callCandidate = !blocker && prepared?.call
      ? planCallTransition(roomId, reason ? null : selected ?? null,
          { ...prepared, assets: prepared.assets.filter(asset => asset.role !== 'greeting' || (compatible && control.enabled && !reason)) },
          ready, Animation.snapshot(roomId).voiceBudgetRemainingMs ?? 0, remainingMs)
      : null
    const candidate = callCandidate ?? (!reason && selected && compatible && control.enabled
      ? planGreetingTransition(selected, prepared, ready, Animation.snapshot(roomId).voiceBudgetRemainingMs ?? 0, remainingMs)
      : null)
    let transition: GreetingGrant['transition']
    let displayMs = selected ? greetingDuration(selected) : 0
    let until = Date.now() + displayMs + 2000
    db.exec('SAVEPOINT greeting_turn')
    try {
      if (candidate) {
        const text = candidate.call ? candidate.assets.find(asset => asset.role === 'call' || asset.role === 'signature')!.displayText : selected!.message
        const intervention = Animation.reserveGreeting({ roomId, socketId, userId }, turnKey, candidate.assets, candidate.durationMs, candidate.voiceMs, text, candidate.call)
        if (intervention) {
          transition = { ...candidate, intervention }
          displayMs = candidate.displayMs
          until = intervention.leaseUntil!
        }
      }
      const voiceReason = !prepared?.assets.some(asset => asset.role === 'greeting')
        ? 'La voz todavía no estaba preparada. El saludo se mostró en pantalla.'
        : callCandidate && !callCandidate.assets.some(asset => asset.role === 'greeting')
          ? 'El llamado tiene prioridad; el saludo se muestra en pantalla dentro del tiempo disponible.'
          : !candidate
              ? 'El audio no estaba listo en el reproductor o se alcanzó el límite de voz. El saludo se mostró en pantalla.'
              : 'El canal de voz no pudo reservarse. Revise el volumen de voz y la conexión del reproductor.'
      db.run(`INSERT INTO greetingTurns(turnKey,roomId,ownerSocketId,untilAt,finished,displayMs,interventionId,playbackVersion,voiceStatus,voiceReason)
        VALUES(?,?,?,?,?,?,?,?,?,?)`, [turnKey, roomId, socketId, until, transition || (selected && !reason) ? 0 : 1, displayMs, transition?.intervention.interventionId ?? null,
        control.version, selected && !reason && control.prefs.enabled ? transition?.assets.some(asset => asset.role === 'greeting') ? 'SCHEDULED' : 'SCREEN' : null,
        selected && !reason && control.prefs.enabled && !transition?.assets.some(asset => asset.role === 'greeting') ? voiceReason : null])
      const ids = turn?.ids ?? [turnKey]
      const membership = ids.map(id => Greetings.turnFor(id)).find(Boolean) ?? turnKey
      for (const [position, id] of ids.entries()) db.run('INSERT OR IGNORE INTO greetingTurnItems(queueId,turnKey,position) VALUES(?,?,?)', [id, membership, position])
      if (selected) db.run('UPDATE greetings SET turnKey=?,status=?,reason=? WHERE greetingId=?', [turnKey, reason ? 'SKIPPED' : 'RESERVED', reason ?? null, selected.greetingId])
      db.exec('RELEASE greeting_turn')
    } catch (error) {
      db.exec('ROLLBACK TO greeting_turn; RELEASE greeting_turn')
      throw error
    }
    const song = order.entities[next!]
    if (blocker || (!call && (reason || !selected))) return null
    return { turnKey, until, displayMs, items: selected && !reason ? [{ ...selected, turnKey, status: 'RESERVED' }] : [], transition, callMode: !!call,
      background: transition?.intervention.background ?? captureTransitionBackground(roomId, `greeting:${roomId}:${turnKey}`, until),
      performer: { name: song.userDisplayName, tableLabel: song.tableLabelSnapshot ?? null, requestIntent: song.requestIntent ?? 'UNKNOWN', title: song.title } }
  }

  static event (roomId: number, socketId: string, turnKey: number, greetingId: number, event: 'start' | 'end') {
    if (!Rooms.get(roomId).entities[roomId]) throw new Error('La sala está cerrada')
    Greetings.reconcile(roomId)
    const turn = db.get<Delivery>('SELECT * FROM greetingTurns WHERE turnKey=? AND roomId=?', [turnKey, roomId])
    if (!turn || turn.ownerSocketId !== socketId || turn.finished || turn.untilAt <= Date.now()) throw new Error('La ventana del saludo terminó')
    const items = Greetings.items(roomId).filter(item => item.turnKey === turnKey)
    const item = items.find(item => item.greetingId === greetingId)
    if (!item) throw new Error('El saludo no pertenece al turno')
    if (event === 'start') {
      if (item.status === 'DISPLAYING') return
      if (items.find(entry => ['RESERVED', 'DISPLAYING'].includes(entry.status))?.greetingId !== greetingId) throw new Error('El saludo cambió o fue retirado')
      db.run('UPDATE greetings SET status=\'DISPLAYING\',startedAt=? WHERE greetingId=? AND status=\'RESERVED\'', [Date.now(), greetingId])
    } else {
      const started = db.get<{ startedAt: number }>('SELECT startedAt FROM greetings WHERE greetingId=?', [greetingId])?.startedAt
      if (item.status !== 'DISPLAYING' || !started || Date.now() - started < (turn.displayMs ?? greetingDuration(item)) - 100) throw new Error('La pantalla aún no completó el saludo')
      db.run('UPDATE greetings SET status=\'DISPLAYED\' WHERE greetingId=?', [greetingId])
    }
  }

  static voiceEvent (roomId: number, socketId: string, turnKey: number, greetingId: number, event: 'audioStarted' | 'audioEnded' | 'audioFailed', reason?: unknown) {
    const turn = db.get<Delivery>('SELECT * FROM greetingTurns WHERE turnKey=? AND roomId=?', [turnKey, roomId])
    const item = Greetings.items(roomId).find(item => item.greetingId === greetingId && item.turnKey === turnKey)
    if (!turn || turn.ownerSocketId !== socketId || turn.finished || turn.untilAt <= Date.now() || !item || item.status !== 'DISPLAYING') throw new Error('La ventana del saludo terminó')
    if (event === 'audioStarted') {
      const active = Animation.active(roomId)
      if (!turn.interventionId || !Animation.greetingEnabled(roomId) || active?.interventionId !== turn.interventionId || active.status !== 'PLAYING' || active.stopRequestedAt) throw new Error('La lectura ya no está autorizada')
      if (turn.voiceStatus === 'SCHEDULED') db.run(`UPDATE greetingTurns SET voiceStatus='PLAYING',voiceStartedAt=? WHERE turnKey=?`, [Date.now(), turnKey])
    } else if (event === 'audioEnded') {
      if (turn.voiceStatus === 'PLAYING') db.run(`UPDATE greetingTurns SET voiceStatus='PLAYED',voiceEndedAt=? WHERE turnKey=?`, [Date.now(), turnKey])
    } else if (turn.voiceStatus !== 'PLAYED') {
      const detail = typeof reason === 'string' ? reason.trim().slice(0, 240) : ''
      const message = `La voz no pudo completarse${detail ? ` (${detail})` : ''}. Se conservó la entrega en pantalla.`
      db.run(`UPDATE greetingTurns SET voiceStatus='FAILED',voiceReason=?,displayMs=? WHERE turnKey=?`, [message, greetingDuration(item), turnKey])
    }
  }

  static finish (roomId: number, socketId: string, turnKey: number) {
    const turn = db.get('SELECT turnKey FROM greetingTurns WHERE roomId=? AND ownerSocketId=? AND turnKey=?', [roomId, socketId, turnKey])
    if (!turn) return
    db.run(`UPDATE greetings SET status=CASE WHEN status='DISPLAYING' THEN 'INTERRUPTED' ELSE 'SKIPPED' END,
      reason='La entrega del turno terminó' WHERE turnKey=? AND status IN ('RESERVED','DISPLAYING')`, [turnKey])
    db.run(`UPDATE greetingTurns SET finished=1,voiceStatus=CASE WHEN voiceStatus IN ('SCHEDULED','PLAYING') THEN 'INTERRUPTED' ELSE voiceStatus END WHERE turnKey=?`, [turnKey])
    const cancelled = db.get(`SELECT 1 FROM greetingTurns t JOIN animationInterventions i USING(interventionId) JOIN queue q ON q.queueId=t.turnKey
      WHERE t.roomId=? AND t.turnKey=? AND i.callJSON IS NOT NULL AND i.startedAt IS NULL AND i.status='CANCELLED' AND q.status='APPROVED'
      AND NOT EXISTS(SELECT 1 FROM greetings g WHERE g.turnKey=t.turnKey AND g.startedAt IS NOT NULL)`, [roomId, turnKey])
    if (cancelled) {
      db.run(`UPDATE greetings SET status='QUEUED',turnKey=NULL,reason=NULL WHERE roomId=? AND turnKey=? AND startedAt IS NULL AND status='SKIPPED'`, [roomId, turnKey])
      db.run('DELETE FROM greetingTurnItems WHERE turnKey=?', [turnKey])
      db.run('DELETE FROM greetingTurns WHERE turnKey=? AND roomId=?', [turnKey, roomId])
    }
  }
}

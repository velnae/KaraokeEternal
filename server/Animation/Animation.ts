import { randomUUID } from 'node:crypto'
import type { Server } from 'socket.io'
import { db } from '../lib/Database.js'
import Queue from '../Queue/Queue.js'
import {
  ANIMATION_STATE, ANIMATION_LIMITS, animationContext, animationPrefs,
  type AnimationClip, type AnimationRoomState, type AnimationSnapshot, type Intervention,
  type AnimationPrefs, type AmbienceGrant, type VoiceFamily, interventionAssets,
} from '../../shared/animation.js'
import { catalogClips, catalogVersion } from './catalog.js'
import { currentSession, operateSession, pendingEvent } from './sessions.js'
import { profileIntervals, selectAnnouncement, voiceBudget } from './selection.js'

type Owner = { socketId: string, epoch: number, unlocked: boolean, readyClips: string[] }
export interface AnimationIdentity { roomId: number, userId: number, socketId: string }
export interface Reservation {
  interventionId: string
  playerEpoch: number
  controlVersion: number
  contextKey: string
  transitionId: string
  sourceQueueId: number | null
  expectedNextQueueId: number | null
  boundary: 'ended' | 'idle' | 'start'
  replay?: boolean
}

const activeStatuses = '(\'PENDING\',\'RESERVED\',\'PLAYING\')'
const owners = new Map<number, Owner>()
let io: Server | undefined

export default class Animation {
  static room (roomId: number) {
    const row = db.get<{ data: string, status: string }>('SELECT data,status FROM rooms WHERE roomId = ?', [roomId])
    if (!row) throw new Error('No se encontró la sala')
    const prefs = JSON.parse(row.data).prefs ?? {}
    return { status: row.status, prefs }
  }

  static state (roomId: number): AnimationRoomState {
    Animation.room(roomId)
    db.run('INSERT OR IGNORE INTO animationRoomState(roomId) VALUES (?)', [roomId])
    return db.get<AnimationRoomState>('SELECT * FROM animationRoomState WHERE roomId = ?', [roomId])!
  }

  static active (roomId: number) {
    return db.get<Intervention>(`SELECT * FROM animationInterventions WHERE roomId = ? AND status IN ${activeStatuses}`, [roomId]) ?? null
  }

  static history (roomId: number) {
    return db.all<Intervention>('SELECT * FROM animationInterventions WHERE roomId = ? ORDER BY requestedAt DESC, rowid DESC LIMIT 20', [roomId])
  }

  static selectionHistory (roomId: number) {
    return db.all<Intervention>('SELECT * FROM animationInterventions WHERE roomId=? ORDER BY requestedAt DESC', [roomId])
  }

  static ambience (roomId: number): AmbienceGrant | null {
    const value = Animation.state(roomId).ambienceJSON
    if (!value) return null
    const grant: AmbienceGrant = JSON.parse(value)
    return grant.until > Date.now() ? grant : null
  }

  static omit (roomId: number, reason: string) {
    if (Animation.state(roomId).lastOmission === reason) return
    db.run('UPDATE animationRoomState SET lastOmission=? WHERE roomId=?', [reason, roomId])
    Animation.publish(roomId)
  }

  static snapshot (roomId: number): AnimationSnapshot {
    const state = Animation.state(roomId)
    const owner = owners.get(roomId)
    return { ...state, prefs: animationPrefs(Animation.room(roomId).prefs.animation), active: Animation.active(roomId),
      history: Animation.history(roomId), playerPresent: !!owner, audioUnlocked: owner?.unlocked ?? false,
      readyClips: owner?.readyClips ?? [], serverTime: Date.now(), session: currentSession(roomId), ambience: Animation.ambience(roomId),
      catalogVersion: catalogVersion(), voiceBudgetRemainingMs: voiceBudget(Animation.selectionHistory(roomId), Date.now()) }
  }

  static publish (roomId: number) {
    if (!io || !db.get('SELECT roomId FROM rooms WHERE roomId = ?', [roomId])) return
    const payload = Animation.snapshot(roomId)
    for (const sock of io.of('/').sockets.values()) {
      const user = (sock as typeof sock & { user?: { isAdmin: boolean, roomId: number } }).user
      if (user?.isAdmin && user.roomId === roomId) sock.emit('action', { type: ANIMATION_STATE, payload })
    }
  }

  static initialize (server: Server) {
    io = server
    owners.clear()
    db.run('UPDATE animationInterventions SET status = CASE WHEN status = \'PENDING\' THEN \'CANCELLED\' ELSE \'UNCERTAIN\' END, finishedAt = ?, reason = \'Servidor reiniciado\' WHERE status IN ' + activeStatuses, [Date.now()])
    db.run('UPDATE animationRoomState SET pendingEventJSON=NULL')
    db.run('UPDATE animationSessions SET status=\'CLOSED\',closedAt=? WHERE status=\'CLOSING\'', [Date.now()])
    const timer = setInterval(() => Animation.sweep(), 250)
    timer.unref()
    return () => {
      clearInterval(timer)
      io = undefined
      owners.clear()
    }
  }

  static sweep () {
    const now = Date.now()
    const rows = db.all<Intervention>(`SELECT * FROM animationInterventions WHERE status IN ${activeStatuses}`)
    for (const row of rows) {
      if (row.status === 'PENDING' ? row.expiresAt <= now : (row.leaseUntil ?? 0) <= now) {
        db.run('UPDATE animationInterventions SET status = ?, finishedAt = ?, reason = ? WHERE interventionId = ?',
          [row.status === 'PENDING' ? 'EXPIRED' : 'UNCERTAIN', now,
            row.status === 'PENDING' ? 'La solicitud venció' : 'Sin confirmación de finalización', row.interventionId])
        Animation.publish(row.roomId)
      }
    }
    for (const row of db.all<{ roomId: number }>('SELECT roomId FROM animationSessions WHERE status=\'CLOSING\' AND closingDeadline<=?', [now])) {
      operateSession(row.roomId, 0, 'finish', 4)
      Animation.omit(row.roomId, 'Jornada cerrada sin una pausa disponible para despedida.')
      Animation.publish(row.roomId)
    }
    for (const state of db.all<AnimationRoomState>('SELECT * FROM animationRoomState WHERE pendingEventJSON IS NOT NULL OR ambienceJSON IS NOT NULL')) {
      const signal = pendingEvent(state.roomId)
      let changed = false
      if (signal && signal.expiresAt <= now) {
        db.run('UPDATE animationRoomState SET pendingEventJSON=NULL,lastOmission=? WHERE roomId=?', ['El evento perdió vigencia antes de encontrar una pausa.', state.roomId])
        changed = true
      }
      if (state.ambienceJSON && (JSON.parse(state.ambienceJSON) as AmbienceGrant).until <= now) {
        db.run('UPDATE animationRoomState SET ambienceJSON=NULL WHERE roomId=?', [state.roomId])
        changed = true
      }
      if (changed) Animation.publish(state.roomId)
    }
  }

  static claim (roomId: number, socketId: string) {
    if (owners.get(roomId)?.socketId === socketId) return
    Animation.state(roomId)
    db.run('UPDATE animationRoomState SET playerEpoch = playerEpoch + 1 WHERE roomId = ?', [roomId])
    owners.set(roomId, { socketId, epoch: Animation.state(roomId).playerEpoch, unlocked: false, readyClips: [] })
    Animation.publish(roomId)
  }

  static disconnect (roomId: number, socketId: string) {
    if (owners.get(roomId)?.socketId !== socketId) return
    owners.delete(roomId)
    const row = Animation.active(roomId)
    if (row) db.run('UPDATE animationInterventions SET status = ?, finishedAt = ?, reason = ? WHERE interventionId = ?',
      [row.status === 'PENDING' ? 'CANCELLED' : 'UNCERTAIN', Date.now(), 'Reproductor desconectado', row.interventionId])
    Animation.publish(roomId)
  }

  static ready (identity: AnimationIdentity, unlocked: boolean, clips: string[]) {
    const owner = owners.get(identity.roomId)
    if (owner?.socketId !== identity.socketId) throw new Error('Reproductor sin autoridad')
    owner.unlocked = unlocked
    owner.readyClips = unlocked ? clips : []
    Animation.publish(identity.roomId)
  }

  static request (identity: AnimationIdentity, requestId: string, clip: AnimationClip) {
    Animation.sweep()
    const existing = db.get<Intervention>('SELECT * FROM animationInterventions WHERE roomId = ? AND requestedByUserId = ? AND requestId = ?', [identity.roomId, identity.userId, requestId])
    if (existing) return existing
    const snapshot = Animation.snapshot(identity.roomId)
    if (Animation.room(identity.roomId).status !== 'open' || !snapshot.prefs.enabled) throw new Error('El animador está desactivado')
    if (snapshot.prefs.volume <= 0) throw new Error('Suba el volumen de voz antes de anunciar')
    if (!snapshot.playerPresent) throw new Error('Abra el reproductor de la sala')
    if (snapshot.microphoneOccupied) throw new Error('El micrófono está ocupado')
    if (clip.validUntil && clip.validUntil <= Date.now()) throw new Error('El recurso ya venció. Seleccione otro anuncio.')
    if (snapshot.active || snapshot.blockedUntil > Date.now()) throw new Error('Ya hay una intervención pendiente o en recuperación')
    const now = Date.now()
    const id = randomUUID()
    if (clip.kind === 'ambience' || (clip.roomId !== undefined && clip.roomId !== identity.roomId)) throw new Error('El recurso no es un anuncio de esta sala.')
    db.run(`INSERT INTO animationInterventions(interventionId,roomId,requestId,requestedByUserId,clipId,clipChecksum,displayText,durationMs,status,requestedAt,expiresAt,sessionId,family,sequenceJSON)
      VALUES(?,?,?,?,?,?,?,?,'PENDING',?,?,?,?,?)`, [id, identity.roomId, requestId, identity.userId, clip.id, clip.checksum, clip.displayText, clip.durationMs, now, Math.min(now + ANIMATION_LIMITS.requestMs, clip.validUntil ?? Infinity),
      currentSession(identity.roomId)?.sessionId ?? null, clip.family ?? 'manual', JSON.stringify([clip])])
    db.run('UPDATE animationRoomState SET lastOmission=? WHERE roomId=?', [clip.durationMs > (snapshot.voiceBudgetRemainingMs ?? 120000)
      ? 'Presupuesto de voz agotado; la solicitud espera sin detener la música.'
      : null, identity.roomId])
    Animation.publish(identity.roomId)
    return Animation.active(identity.roomId)!
  }

  static cancel (roomId: number, reason = 'Cancelado por el operador', interventionId?: string) {
    const row = Animation.active(roomId)
    if (!row || (interventionId && row.interventionId !== interventionId)) return
    if (row.status === 'PENDING') {
      db.run('UPDATE animationInterventions SET status = \'CANCELLED\', finishedAt = ?, reason = ? WHERE interventionId = ?', [Date.now(), reason, row.interventionId])
    } else {
      db.run('UPDATE animationInterventions SET stopRequestedAt = COALESCE(stopRequestedAt, ?), reason = ? WHERE interventionId = ?', [Date.now(), reason, row.interventionId])
    }
    Animation.publish(roomId)
  }

  static control (roomId: number, version: number, patch: Partial<AnimationPrefs> & { microphoneOccupied?: boolean }) {
    const state = Animation.state(roomId)
    if (version !== state.controlVersion) throw new Error('Los controles cambiaron. Revise el estado actual.')
    const old = animationPrefs(Animation.room(roomId).prefs.animation)
    const prefs = animationPrefs({ ...old, ...patch, events: { ...old.events, ...patch.events } })
    db.exec('SAVEPOINT animation_control')
    try {
      db.run('UPDATE rooms SET data = json_set(data, \'$.prefs.animation\', json(?)) WHERE roomId = ?', [JSON.stringify(prefs), roomId])
      db.run('UPDATE animationRoomState SET controlVersion = controlVersion + 1, microphoneOccupied = ? WHERE roomId = ?',
        [patch.microphoneOccupied === undefined ? state.microphoneOccupied : Number(patch.microphoneOccupied), roomId])
      db.exec('RELEASE animation_control')
    } catch (error) {
      db.exec('ROLLBACK TO animation_control')
      db.exec('RELEASE animation_control')
      throw error
    }
    if (!prefs.enabled || prefs.volume === 0 || (patch.microphoneOccupied === true && Animation.active(roomId)?.status !== 'PENDING')) {
      Animation.cancel(roomId, 'Animador bloqueado por el operador')
    }
    const active = Animation.active(roomId)
    if (!prefs.automation && active?.origin === 'AUTO' && active.status !== 'PLAYING') Animation.cancel(roomId, 'Funcionamiento manual activado')
    Animation.publish(roomId)
  }

  static reserve (identity: AnimationIdentity, input: Reservation, status: { queueId?: number, isAtQueueEnd?: boolean, isErrored?: boolean }) {
    Animation.sweep()
    const now = Date.now()
    const snapshot = Animation.snapshot(identity.roomId)
    const owner = owners.get(identity.roomId)
    const row = snapshot.active
    if (!row || row.interventionId !== input.interventionId || row.status !== 'PENDING') throw new Error('La solicitud ya no está pendiente')
    if (owner?.socketId !== identity.socketId || input.playerEpoch !== owner.epoch) throw new Error('Reproductor sin autoridad')
    if (!snapshot.prefs.enabled || snapshot.microphoneOccupied || snapshot.prefs.volume <= 0 || snapshot.blockedUntil > now || snapshot.ambience
      || input.controlVersion !== snapshot.controlVersion || Animation.room(identity.roomId).status !== 'open') throw new Error('La sala no permite intervenir')
    if (!owner.unlocked || interventionAssets(row).some(asset => !owner.readyClips.includes(asset.checksum))) throw new Error('El audio no está preparado')
    if (row.durationMs > (snapshot.voiceBudgetRemainingMs ?? 120000)) {
      Animation.omit(identity.roomId, 'Presupuesto de voz agotado; la solicitud espera sin detener la música.')
      throw new Error('Presupuesto de voz agotado')
    }
    if (status.isErrored) throw new Error('Resuelva el error de la canción')
    if (input.boundary === 'idle' || input.boundary === 'start') {
      if (!(status.isAtQueueEnd || status.queueId === -1)) throw new Error('La canción todavía ocupa el reproductor')
    } else if (input.boundary === 'ended') {
      if (status.queueId !== input.sourceQueueId) throw new Error('Cambió la canción actual')
      const source = db.get<{ status: string }>('SELECT status FROM queue WHERE roomId = ? AND queueId = ?', [identity.roomId, input.sourceQueueId])
      if (!source || !['PLAYING', 'PLAYED'].includes(source.status)) throw new Error('El final de canción no es válido')
    } else throw new Error('Pausa no válida')
    const room = Animation.room(identity.roomId)
    if (animationContext(Queue.get(identity.roomId), room.prefs.queue) !== input.contextKey) throw new Error('Cambió el contexto de la cola')
    if (input.expectedNextQueueId !== null) {
      const next = db.get<{ status: string }>('SELECT status FROM queue WHERE roomId = ? AND queueId = ?', [identity.roomId, input.expectedNextQueueId])
      if (next?.status !== 'APPROVED') throw new Error('El siguiente turno cambió')
    }
    const startBefore = Math.min(now + ANIMATION_LIMITS.startMs, row.expiresAt)
    const leaseUntil = startBefore + row.durationMs + ANIMATION_LIMITS.marginMs
    db.exec('SAVEPOINT animation_reserve')
    try {
      if (input.boundary === 'ended') Queue.transition(identity.roomId, input.sourceQueueId!, 'PLAYED')
      const contextKey = animationContext(Queue.get(identity.roomId), room.prefs.queue)
      db.run('UPDATE animationInterventions SET status = \'RESERVED\', playerEpoch = ?, ownerSocketId = ?, contextKey = ?, transitionId = ?, startBefore = ?, leaseUntil = ? WHERE interventionId = ?',
        [owner.epoch, identity.socketId, contextKey, input.transitionId, startBefore, leaseUntil, row.interventionId])
      db.run('UPDATE animationRoomState SET blockedUntil = ?, lastOmission = NULL WHERE roomId = ?', [leaseUntil, identity.roomId])
      const signal = pendingEvent(identity.roomId)
      if (signal && signal.key !== row.sourceEventKey) {
        // One announcement owns this boundary. Do not replay a lower-priority
        // welcome/celebration immediately after the selected voice ends.
        db.run('UPDATE animationRoomState SET pendingEventJSON=NULL,lastOmission=? WHERE roomId=?',
          ['Se omitió el evento pendiente: esta pausa ya tiene un anuncio prioritario.', identity.roomId])
      }
      db.exec('RELEASE animation_reserve')
    } catch (error) {
      db.exec('ROLLBACK TO animation_reserve')
      db.exec('RELEASE animation_reserve')
      throw error
    }
    Animation.publish(identity.roomId)
    return Animation.active(identity.roomId)!
  }

  static session (roomId: number, actor: number, operation: 'open' | 'close' | 'finish' | 'celebrate') {
    Animation.state(roomId)
    if (Animation.room(roomId).status !== 'open' && operation !== 'finish') throw new Error('La sala está cerrada.')
    const result = operateSession(roomId, actor, operation, animationPrefs(Animation.room(roomId).prefs.animation).cutoffHour)
    if (operation === 'finish' || operation === 'close') {
      if (Animation.active(roomId)?.origin === 'AUTO') Animation.cancel(roomId, 'Jornada cerrándose')
    }
    Animation.publish(roomId)
    return result
  }

  static automatic (identity: AnimationIdentity, input: Reservation, status: { queueId?: number, isAtQueueEnd?: boolean, isErrored?: boolean }) {
    const roomId = identity.roomId
    Animation.sweep()
    const prefs = animationPrefs(Animation.room(roomId).prefs.animation)
    const session = currentSession(roomId)
    const owner = owners.get(roomId)
    if (!session || !prefs.enabled || !prefs.automation || Animation.active(roomId) || input.replay) return null
    if (owner?.socketId !== identity.socketId || owner.epoch !== input.playerEpoch) throw new Error('Reproductor sin autoridad')
    const now = Date.now()
    const state = Animation.state(roomId)
    if (state.microphoneOccupied || state.blockedUntil > now || Animation.ambience(roomId) || !owner.unlocked) return null
    const signal = pendingEvent(roomId)
    let family: VoiceFamily | undefined
    let key = ''
    if (session.status === 'CLOSING') {
      if (signal?.family === 'goodbye') {
        family = 'goodbye'
        key = signal.key
      }
    } else if (input.expectedNextQueueId !== null && input.boundary !== 'idle' && prefs.events.turn) {
      family = 'turn'
      key = `${session.sessionId}:turn:${input.expectedNextQueueId}`
    } else if (signal && signal.expiresAt > now) {
      family = signal.family
      key = signal.key
    } else if (input.boundary === 'ended' && input.sourceQueueId !== null && prefs.events.closing) {
      family = 'closing'
      key = `${session.sessionId}:closing:${input.sourceQueueId}`
    } else if (input.boundary === 'idle' && now - session.openedAt >= profileIntervals[prefs.profile]) {
      const slot = Math.floor((now - session.openedAt) / profileIntervals[prefs.profile])
      const choices: VoiceFamily[] = ['invitation', 'booth', 'promotion']
      family = choices.filter(value => prefs.events[value])[slot % choices.filter(value => prefs.events[value]).length]
      key = `${session.sessionId}:idle:${slot}`
    }
    if (!family || !prefs.events[family]) return null
    if (db.get('SELECT interventionId FROM animationInterventions WHERE roomId=? AND sourceEventKey=?', [roomId, key])) return null
    const history = Animation.selectionHistory(roomId)
    const recentSessions = db.all<{ sessionId: string }>('SELECT sessionId FROM animationSessions WHERE roomId=? AND sessionId!=? ORDER BY openedAt DESC LIMIT 2', [roomId, session.sessionId]).map(row => row.sessionId)
    const selected = selectAnnouncement({ clips: catalogClips(roomId), family, profile: prefs.profile, history, sessionId: session.sessionId, recentSessions, ready: owner.readyClips, now })
    if (!selected.clip) {
      Animation.omit(roomId, selected.reason)
      return null
    }
    const clip = selected.clip
    const sequence = [clip]
    if (family === 'celebration' && prefs.profile !== 'dinner') {
      const effect = catalogClips(roomId).find(asset => asset.kind === 'effect' && asset.family === 'celebration' && asset.approvedForAuto && asset.modes?.includes(prefs.profile) && owner.readyClips.includes(asset.checksum))
      if (effect && clip.durationMs + effect.durationMs <= voiceBudget(history, now)) sequence.push(effect)
    }
    const id = randomUUID()
    db.run(`INSERT INTO animationInterventions(interventionId,roomId,requestId,requestedByUserId,clipId,clipChecksum,displayText,durationMs,status,requestedAt,expiresAt,origin,sessionId,sourceEventKey,family,sequenceJSON)
      VALUES(?,?,?,?,?,?,?,?,'PENDING',?,?,'AUTO',?,?,?,?)`, [id, roomId, key, identity.userId, clip.id, clip.checksum, clip.displayText,
      sequence.reduce((sum, asset) => sum + asset.durationMs, 0), now, Math.min(now + 1000, clip.validUntil ?? Infinity), session.sessionId, key, family, JSON.stringify(sequence)])
    if (signal?.key === key) db.run('UPDATE animationRoomState SET pendingEventJSON=NULL WHERE roomId=?', [roomId])
    db.run('UPDATE animationRoomState SET lastOmission=NULL WHERE roomId=?', [roomId])
    try {
      return Animation.reserve(identity, { ...input, interventionId: id }, status)
    } catch (error) {
      Animation.cancel(roomId, (error as Error).message, id)
      throw error
    }
  }

  static reserveAmbience (identity: AnimationIdentity, epoch: number, status: { queueId?: number, isAtQueueEnd?: boolean, isErrored?: boolean }, clipId?: string, offsetMs = 0) {
    const roomId = identity.roomId
    const snapshot = Animation.snapshot(roomId)
    const prefs = animationPrefs(snapshot.prefs)
    const owner = owners.get(roomId)
    if (owner?.socketId !== identity.socketId || owner.epoch !== epoch) throw new Error('Reproductor sin autoridad')
    if (!prefs.enabled || !prefs.automation || !prefs.ambienceEnabled || prefs.ambienceVolume === 0 || snapshot.microphoneOccupied
      || snapshot.session?.status !== 'OPEN' || Animation.room(roomId).status !== 'open'
      || status.isErrored || !(status.isAtQueueEnd || status.queueId === -1)
      || snapshot.blockedUntil > Date.now() || (snapshot.active && snapshot.active.status !== 'PENDING')
      || snapshot.ambience || !owner.unlocked) return null
    const clips = catalogClips(roomId).filter(clip => clip.kind === 'ambience' && clip.approvedForAuto && clip.modes?.includes(prefs.profile) && owner.readyClips.includes(clip.checksum))
    const clip = clips.find(clip => clip.id === clipId) ?? clips[0]
    if (!clip) return null
    const offset = Math.max(0, Math.min(clip.durationMs - 1, offsetMs))
    const durationMs = Math.min(10000, clip.durationMs - offset)
    const grant: AmbienceGrant = { id: randomUUID(), clip, ownerSocketId: identity.socketId, playerEpoch: epoch,
      until: Date.now() + durationMs + 1000, durationMs, offsetMs: offset }
    db.run('UPDATE animationRoomState SET ambienceJSON=? WHERE roomId=?', [JSON.stringify(grant), roomId])
    Animation.publish(roomId)
    return grant
  }

  static stopAmbience (identity: AnimationIdentity, id: string) {
    const grant = Animation.ambience(identity.roomId)
    if (!grant || grant.id !== id || grant.ownerSocketId !== identity.socketId) return
    db.run('UPDATE animationRoomState SET ambienceJSON=NULL WHERE roomId=?', [identity.roomId])
    Animation.publish(identity.roomId)
  }

  static event (identity: AnimationIdentity, id: string, epoch: number, event: 'STARTED' | 'ENDED' | 'STOPPED' | 'NOT_STARTED' | 'FAILED') {
    const row = db.get<Intervention>('SELECT * FROM animationInterventions WHERE roomId = ? AND interventionId = ?', [identity.roomId, id])
    if (!row || row.ownerSocketId !== identity.socketId || row.playerEpoch !== epoch) throw new Error('El permiso de reproducción no corresponde')
    const now = Date.now()
    if (!['RESERVED', 'PLAYING'].includes(row.status)) return
    if (event === 'STARTED') {
      if (row.status === 'PLAYING') return
      if (row.stopRequestedAt || now > row.startBefore! || owners.get(identity.roomId)?.epoch !== epoch) throw new Error('El permiso de inicio venció')
      const room = Animation.room(identity.roomId)
      const state = Animation.snapshot(identity.roomId)
      if (room.status !== 'open' || !state.prefs.enabled || state.microphoneOccupied || state.prefs.volume <= 0
        || animationContext(Queue.get(identity.roomId), room.prefs.queue) !== row.contextKey) {
        Animation.cancel(identity.roomId, 'El contexto cambió antes del inicio')
        throw new Error('El contexto cambió antes del inicio')
      }
      db.run('UPDATE animationInterventions SET status = \'PLAYING\', startedAt = ? WHERE interventionId = ?', [now, id])
    } else {
      const status = event === 'ENDED' && row.startedAt && !row.stopRequestedAt
        ? 'PLAYED'
        : event === 'NOT_STARTED' && !row.startedAt
          ? 'CANCELLED'
          : event === 'FAILED' ? 'FAILED' : row.startedAt ? 'INTERRUPTED' : 'UNCERTAIN'
      db.run('UPDATE animationInterventions SET status = ?, finishedAt = ?, reason = COALESCE(reason, ?) WHERE interventionId = ?', [status, now, event === 'ENDED' ? null : event, id])
      // Only this still-active reservation may release its room fence.
      db.run('UPDATE animationRoomState SET blockedUntil = 0 WHERE roomId = ? AND blockedUntil = ?', [identity.roomId, row.leaseUntil])
      if (row.family === 'goodbye' && row.sessionId && currentSession(identity.roomId)?.sessionId === row.sessionId) operateSession(identity.roomId, identity.userId, 'finish', 4)
    }
    Animation.publish(identity.roomId)
  }
}

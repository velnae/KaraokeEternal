import { randomUUID } from 'node:crypto'
import type { Server } from 'socket.io'
import { db } from '../lib/Database.js'
import Queue from '../Queue/Queue.js'
import {
  ANIMATION_STATE, ANIMATION_LIMITS, animationContext, animationPrefs,
  type AnimationClip, type AnimationRoomState, type AnimationSnapshot, type Intervention,
} from '../../shared/animation.js'

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
  boundary: 'ended' | 'idle'
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

  static snapshot (roomId: number): AnimationSnapshot {
    const state = Animation.state(roomId)
    const owner = owners.get(roomId)
    return { ...state, prefs: animationPrefs(Animation.room(roomId).prefs.animation), active: Animation.active(roomId),
      history: Animation.history(roomId), playerPresent: !!owner, audioUnlocked: owner?.unlocked ?? false,
      readyClips: owner?.readyClips ?? [], serverTime: Date.now() }
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
    if (snapshot.active || snapshot.blockedUntil > Date.now()) throw new Error('Ya hay una intervención pendiente o en recuperación')
    const now = Date.now()
    const id = randomUUID()
    db.run(`INSERT INTO animationInterventions(interventionId,roomId,requestId,requestedByUserId,clipId,clipChecksum,displayText,durationMs,status,requestedAt,expiresAt)
      VALUES(?,?,?,?,?,?,?,?,'PENDING',?,?)`, [id, identity.roomId, requestId, identity.userId, clip.id, clip.checksum, clip.displayText, clip.durationMs, now, now + ANIMATION_LIMITS.requestMs])
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

  static control (roomId: number, version: number, patch: { enabled?: boolean, volume?: number, microphoneOccupied?: boolean }) {
    const state = Animation.state(roomId)
    if (version !== state.controlVersion) throw new Error('Los controles cambiaron. Revise el estado actual.')
    const old = animationPrefs(Animation.room(roomId).prefs.animation)
    const prefs = { enabled: patch.enabled ?? old.enabled, volume: patch.volume ?? old.volume }
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
    if (!snapshot.prefs.enabled || snapshot.microphoneOccupied || snapshot.prefs.volume <= 0 || snapshot.blockedUntil > now
      || input.controlVersion !== snapshot.controlVersion || Animation.room(identity.roomId).status !== 'open') throw new Error('La sala no permite intervenir')
    if (!owner.unlocked || !owner.readyClips.includes(row.clipChecksum)) throw new Error('El audio no está preparado')
    if (status.isErrored) throw new Error('Resuelva el error de la canción')
    if (input.boundary === 'idle') {
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
    const startBefore = now + ANIMATION_LIMITS.startMs
    const leaseUntil = startBefore + row.durationMs + ANIMATION_LIMITS.marginMs
    db.exec('SAVEPOINT animation_reserve')
    try {
      if (input.boundary === 'ended') Queue.transition(identity.roomId, input.sourceQueueId!, 'PLAYED')
      const contextKey = animationContext(Queue.get(identity.roomId), room.prefs.queue)
      db.run('UPDATE animationInterventions SET status = \'RESERVED\', playerEpoch = ?, ownerSocketId = ?, contextKey = ?, transitionId = ?, startBefore = ?, leaseUntil = ? WHERE interventionId = ?',
        [owner.epoch, identity.socketId, contextKey, input.transitionId, startBefore, leaseUntil, row.interventionId])
      db.run('UPDATE animationRoomState SET blockedUntil = ? WHERE roomId = ?', [leaseUntil, identity.roomId])
      db.exec('RELEASE animation_reserve')
    } catch (error) {
      db.exec('ROLLBACK TO animation_reserve')
      db.exec('RELEASE animation_reserve')
      throw error
    }
    Animation.publish(identity.roomId)
    return Animation.active(identity.roomId)!
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
    }
    Animation.publish(identity.roomId)
  }
}

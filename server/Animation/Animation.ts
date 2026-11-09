import { randomUUID } from 'node:crypto'
import type { Server } from 'socket.io'
import { db } from '../lib/Database.js'
import Queue from '../Queue/Queue.js'
import {
  ANIMATION_STATE, ANIMATION_LIMITS, TRANSITION_BED_MS, animationContext, animationPrefs, eligibleAmbience,
  type AnimationClip, type AnimationRoomState, type AnimationSnapshot, type Intervention,
  type AnimationPrefs, type AmbienceGrant, type VoiceFamily, interventionAssets, interventionPlayback,
} from '../../shared/animation.js'
import { catalogClips, catalogVersion } from './catalog.js'
import { currentSession, operateSession, pendingEvent } from './sessions.js'
import { categoryEffects, heardAt, profileIntervals, selectAnnouncement, supportingEffects, voiceBudget } from './selection.js'
import { backfillAudioUsage, leastUsedAudio, recordAudioUsage } from './usage.js'
import { GREETING_START_MS } from '../../shared/greetings.js'
import { captureTransitionBackground, leasedTransitionBackground } from '../TransitionVideo/Playback.js'
import { callsEnabled, prepareCall, validCall } from './Calls/Playback.js'
import { callControls } from './Calls/Store.js'
import { getCallAutomation } from './Calls/Automation.js'
import type { CallContext } from '../../shared/karaokeCalls.js'
import { birthdayOwnsAudio } from '../Birthdays/Store.js'

type Owner = { socketId: string, epoch: number, unlocked: boolean, readyClips: string[], transitionBed: boolean }
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
    const row = db.get<Intervention>(`SELECT * FROM animationInterventions WHERE roomId = ? AND status IN ${activeStatuses}`, [roomId])
    return row ? { ...row, background: leasedTransitionBackground(`animation:${row.interventionId}`) } : null
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
    return { ...state, microphoneOccupied: 0, prefs: animationPrefs(Animation.room(roomId).prefs.animation), active: Animation.active(roomId),
      history: Animation.history(roomId), playerPresent: !!owner, audioUnlocked: owner?.unlocked ?? false,
      readyClips: owner?.readyClips ?? [], serverTime: Date.now(), session: currentSession(roomId), ambience: Animation.ambience(roomId),
      catalogVersion: catalogVersion(), voiceBudgetRemainingMs: voiceBudget(Animation.selectionHistory(roomId), Date.now()), greetingVoiceEnabled: Animation.greetingEnabled(roomId),
      karaokeCallsEnabled: callsEnabled(roomId), karaokeCallsRevision: callControls(roomId).revision }
  }

  static greetingEnabled (roomId: number) {
    return !!db.get(`SELECT 1 FROM greetingControls WHERE roomId=? AND audioEnabled=1 AND paused=0 AND json_extract(playbackJSON,'$.enabled')=1`, [roomId])
  }

  static transitionAmbience (identity: AnimationIdentity, nextQueueId: number | null, sourceQueueId?: number | null) {
    const grant = Animation.ambience(identity.roomId)
    return grant?.transition && grant.ownerSocketId === identity.socketId && grant.playerEpoch === owners.get(identity.roomId)?.epoch
      && grant.transition.expectedNextQueueId === nextQueueId
      && (sourceQueueId === undefined || grant.transition.sourceQueueId === sourceQueueId)
      ? grant
      : null
  }

  /** Greetings share the same exclusive intervention, epoch and persisted room fence. */
  static reserveGreeting (identity: AnimationIdentity, queueId: number, assets: AnimationClip[], durationMs: number, voiceMs: number, text: string, call?: CallContext): Intervention | null {
    if (birthdayOwnsAudio(identity.roomId)) return null
    const owner = owners.get(identity.roomId)
    const snapshot = Animation.snapshot(identity.roomId)
    const now = Date.now()
    if (!owner || owner.socketId !== identity.socketId || !owner.unlocked || (call ? !validCall(identity.roomId, call) : !Animation.greetingEnabled(identity.roomId))
      || snapshot.active || snapshot.blockedUntil > now || (snapshot.ambience && !Animation.transitionAmbience(identity, queueId)) || snapshot.prefs.volume <= 0
      || Animation.room(identity.roomId).status !== 'open' || voiceMs > (snapshot.voiceBudgetRemainingMs ?? 0)) return null
    if (!assets.length || durationMs <= 0 || durationMs > 25000 - GREETING_START_MS || voiceMs <= 0 || voiceMs > durationMs) throw new Error('La transición supera el tiempo disponible.')
    const id = randomUUID()
    const startBefore = now + GREETING_START_MS
    const until = now + (call ? durationMs + GREETING_START_MS : 25000)
    const requestKey = call ? `call-${queueId}-${id}` : `greeting-${queueId}`
    const room = Animation.room(identity.roomId)
    db.run(`INSERT INTO animationInterventions(interventionId,roomId,requestId,requestedByUserId,clipId,clipChecksum,displayText,durationMs,voiceDurationMs,status,
      playerEpoch,ownerSocketId,contextKey,transitionId,requestedAt,expiresAt,startBefore,leaseUntil,origin,sourceEventKey,family,sequenceJSON)
      VALUES(?,?,?,?,?,?,?,?,?,'RESERVED',?,?,?,?,?,?,?,?,'GREETING',?,'greeting',?)`,
    [id, identity.roomId, requestKey, identity.userId, assets[0].id, assets[0].checksum, text, durationMs, voiceMs,
      owner.epoch, identity.socketId, animationContext(Queue.get(identity.roomId), room.prefs.queue), id, now, until, startBefore, until, requestKey, JSON.stringify(assets)])
    if (call) db.run('UPDATE animationInterventions SET callJSON=? WHERE interventionId=?', [JSON.stringify(call), id])
    db.run('UPDATE animationRoomState SET blockedUntil=?,pendingEventJSON=NULL WHERE roomId=?', [until, identity.roomId])
    captureTransitionBackground(identity.roomId, `animation:${id}`, until)
    return Animation.active(identity.roomId)
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
    backfillAudioUsage()
    io = server
    owners.clear()
    db.run('UPDATE animationInterventions SET status = CASE WHEN status = \'PENDING\' THEN \'CANCELLED\' ELSE \'UNCERTAIN\' END, finishedAt = ?, reason = \'Servidor reiniciado\' WHERE status IN ' + activeStatuses, [Date.now()])
    db.run('UPDATE animationRoomState SET pendingEventJSON=NULL')
    db.run('UPDATE animationRoomState SET microphoneOccupied=0')
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
      if (row.callJSON && !row.stopRequestedAt && !validCall(row.roomId, JSON.parse(row.callJSON), !!row.startedAt)) {
        Animation.cancel(row.roomId, 'Cambió el pedido o la configuración del llamado.', row.interventionId)
      }
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
    owners.set(roomId, { socketId, epoch: Animation.state(roomId).playerEpoch, unlocked: false, readyClips: [], transitionBed: false })
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

  static ready (identity: AnimationIdentity, unlocked: boolean, clips: string[], transitionBed?: boolean) {
    const owner = owners.get(identity.roomId)
    if (owner?.socketId !== identity.socketId) throw new Error('Reproductor sin autoridad')
    owner.unlocked = unlocked
    owner.readyClips = unlocked ? clips : []
    if (transitionBed !== undefined) owner.transitionBed = transitionBed
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
    if (patch.microphoneOccupied !== undefined) throw new Error('El control de micrófono ya no existe. Actualice esta página.')
    const state = Animation.state(roomId)
    if (version !== state.controlVersion) throw new Error('Los controles cambiaron. Revise el estado actual.')
    const old = animationPrefs(Animation.room(roomId).prefs.animation)
    const prefs = animationPrefs({ ...old, ...patch, events: { ...old.events, ...patch.events } })
    if (patch.ambienceClipId !== undefined && patch.ambienceClipId !== null
      && (typeof patch.ambienceClipId !== 'string' || !/^[\w-]{1,100}$/.test(patch.ambienceClipId)
        || !eligibleAmbience(catalogClips(roomId), prefs).length)) throw new Error('Seleccione un ambiente activo y disponible para el perfil de esta sala.')
    db.exec('SAVEPOINT animation_control')
    try {
      db.run('UPDATE rooms SET data = json_set(data, \'$.prefs.animation\', json(?)) WHERE roomId = ?', [JSON.stringify(prefs), roomId])
      db.run('UPDATE animationRoomState SET controlVersion = controlVersion + 1, microphoneOccupied = 0 WHERE roomId = ?', [roomId])
      db.exec('RELEASE animation_control')
    } catch (error) {
      db.exec('ROLLBACK TO animation_control')
      db.exec('RELEASE animation_control')
      throw error
    }
    if ((!prefs.enabled && (Animation.active(roomId)?.origin !== 'GREETING' || Animation.active(roomId)?.callJSON)) || prefs.volume === 0) {
      Animation.cancel(roomId, 'Animador bloqueado por el operador')
    }
    const active = Animation.active(roomId)
    if (!prefs.automation && active?.origin === 'AUTO' && active.status !== 'PLAYING') Animation.cancel(roomId, 'Funcionamiento manual activado')
    Animation.publish(roomId)
  }

  static reserve (identity: AnimationIdentity, input: Reservation, status: { queueId?: number, isAtQueueEnd?: boolean, isErrored?: boolean }) {
    if (birthdayOwnsAudio(identity.roomId)) throw new Error('El cumpleaños está en reproducción.')
    Animation.sweep()
    const now = Date.now()
    const snapshot = Animation.snapshot(identity.roomId)
    const owner = owners.get(identity.roomId)
    const row = snapshot.active
    if (!row || row.interventionId !== input.interventionId || row.status !== 'PENDING') throw new Error('La solicitud ya no está pendiente')
    if (owner?.socketId !== identity.socketId || input.playerEpoch !== owner.epoch) throw new Error('Reproductor sin autoridad')
    const transitionBed = Animation.transitionAmbience(identity, input.expectedNextQueueId, input.sourceQueueId)
    if (!snapshot.prefs.enabled || snapshot.prefs.volume <= 0 || snapshot.blockedUntil > now || (snapshot.ambience && !transitionBed)
      || input.controlVersion !== snapshot.controlVersion || Animation.room(identity.roomId).status !== 'open') throw new Error('La sala no permite intervenir')
    const foreground = interventionPlayback(row).sequence
    if (!owner.unlocked || foreground.some(asset => !owner.readyClips.includes(asset.checksum))) throw new Error('El audio no está preparado')
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
    // A bed is optional and concurrent, never another sequential track or a
    // reason to block an otherwise ready announcement.
    const prefs = animationPrefs(snapshot.prefs)
    const bed = !transitionBed && owner.transitionBed && prefs.ambienceEnabled && prefs.ambienceVolume > 0
      ? leastUsedAudio(identity.roomId, eligibleAmbience(catalogClips(identity.roomId), prefs, now).filter(asset => owner.readyClips.includes(asset.checksum)))
      : undefined
    db.exec('SAVEPOINT animation_reserve')
    try {
      if (input.boundary === 'ended') Queue.transition(identity.roomId, input.sourceQueueId!, 'PLAYED')
      const contextKey = animationContext(Queue.get(identity.roomId), room.prefs.queue)
      db.run('UPDATE animationInterventions SET status = \'RESERVED\', playerEpoch = ?, ownerSocketId = ?, contextKey = ?, transitionId = ?, startBefore = ?, leaseUntil = ?, sequenceJSON=? WHERE interventionId = ?',
        [owner.epoch, identity.socketId, contextKey, input.transitionId, startBefore, leaseUntil, JSON.stringify([...foreground, ...(bed ? [bed] : [])]), row.interventionId])
      captureTransitionBackground(identity.roomId, `animation:${row.interventionId}`, leaseUntil)
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

  static automaticPlan (identity: AnimationIdentity, input: Reservation) {
    if (birthdayOwnsAudio(identity.roomId)) return null
    const roomId = identity.roomId
    Animation.sweep()
    const prefs = animationPrefs(Animation.room(roomId).prefs.animation)
    const session = currentSession(roomId)
    const owner = owners.get(roomId)
    if (!session || !prefs.enabled || !prefs.automation || Animation.active(roomId) || input.replay) return null
    if (input.expectedNextQueueId !== null && prepareCall(roomId, input.expectedNextQueueId)) return null
    if (owner?.socketId !== identity.socketId || owner.epoch !== input.playerEpoch) throw new Error('Reproductor sin autoridad')
    const now = Date.now()
    const state = Animation.state(roomId)
    if (state.blockedUntil > now || !owner.unlocked) return null
    const signal = pendingEvent(roomId)
    const history = Animation.selectionHistory(roomId)
    const greetingIntro = db.get<{ id: string | null }>(`SELECT json_extract(playbackJSON,'$.introClipId') id FROM greetingControls WHERE roomId=?`, [roomId])?.id
    const recentSessions = db.all<{ sessionId: string }>('SELECT sessionId FROM animationSessions WHERE roomId=? AND sessionId!=? ORDER BY openedAt DESC LIMIT 2', [roomId, session.sessionId]).map(row => row.sessionId)
    const lastUse = (family: VoiceFamily) => Math.max(0, ...history.filter(row => row.origin === 'AUTO' && row.family === family).map(heardAt))
    const cues: { family: VoiceFamily, key: string, confirmed?: boolean }[] = []
    const naturalKey = input.boundary === 'ended' && input.sourceQueueId !== null ? `${session.sessionId}:ended:${input.sourceQueueId}` : null
    if (naturalKey && db.get('SELECT interventionId FROM animationInterventions WHERE roomId=? AND sourceEventKey=?', [roomId, naturalKey])) return null
    if (session.status === 'CLOSING') {
      if (signal?.family === 'goodbye') cues.push({ family: 'goodbye', key: naturalKey ?? signal.key, confirmed: true })
    } else if (input.expectedNextQueueId !== null && input.boundary === 'start' && prefs.events.turn) {
      cues.push({ family: 'turn', key: `${session.sessionId}:turn:${input.expectedNextQueueId}` })
    } else if (signal && signal.expiresAt > now) {
      cues.push({ family: signal.family, key: naturalKey ?? signal.key, confirmed: true })
    } else {
      if (naturalKey && input.expectedNextQueueId === null) cues.push({ family: 'closing', key: naturalKey })
      // Environmental messages also get opportunities between songs, not only on an empty queue.
      if ((input.boundary === 'idle' || naturalKey) && now - session.openedAt >= profileIntervals[prefs.profile]) {
        const slot = Math.floor((now - session.openedAt) / profileIntervals[prefs.profile])
        const families: VoiceFamily[] = ['invitation', 'booth', 'promotion']
        for (const family of families.sort((a, b) => lastUse(a) - lastUse(b))) cues.push({ family, key: naturalKey ?? `${session.sessionId}:idle:${slot}` })
      }
      if (naturalKey) {
        const families: VoiceFamily[] = input.expectedNextQueueId === null ? ['celebration'] : ['closing', 'celebration', 'turn']
        for (const family of families.sort((a, b) => lastUse(a) - lastUse(b))) cues.push({ family, key: naturalKey })
      }
    }
    let reason = ''
    for (const { family, key, confirmed } of cues) {
      if (!prefs.events[family] || db.get('SELECT interventionId FROM animationInterventions WHERE roomId=? AND sourceEventKey=?', [roomId, key])) continue
      const clips = catalogClips(roomId).filter(clip => clip.id !== greetingIntro && (family !== 'celebration' || confirmed || clip.celebrationMode === 'song_end'))
      const selected = selectAnnouncement({ clips, family, profile: prefs.profile, history, sessionId: session.sessionId, recentSessions, ready: owner.readyClips, now })
      if (selected.clip) return { clip: selected.clip, family, key, session, signal: confirmed ? signal : null, history, prefs, owner, now }
      reason = selected.reason
    }
    if (reason) Animation.omit(roomId, reason)
    return null
  }

  static automatic (identity: AnimationIdentity, input: Reservation, status: { queueId?: number, isAtQueueEnd?: boolean, isErrored?: boolean }) {
    const roomId = identity.roomId
    if (Animation.ambience(roomId) && !Animation.transitionAmbience(identity, input.expectedNextQueueId, input.sourceQueueId)) return null
    const plan = Animation.automaticPlan(identity, input)
    if (!plan) return null
    const { clip, family, key, session, signal, history, prefs, owner, now } = plan
    const sequence = [clip]
    const addEffect = (candidates: AnimationClip[], before = false) => {
      const duration = sequence.reduce((sum, asset) => sum + asset.durationMs, 0)
      const effect = leastUsedAudio(roomId, candidates.filter(asset => duration + asset.durationMs <= Math.min(25000, voiceBudget(history, now))))
      if (effect) {
        if (before) sequence.unshift(effect)
        else sequence.push(effect)
      }
    }
    if (family === 'closing' || family === 'celebration') {
      const lastClosing = db.get<{ at: number | null }>(`SELECT max(u.startedAt) at FROM audioUsage u JOIN animationInterventions i
        ON i.roomId=u.roomId AND u.sourceId='intervention:'||i.interventionId
        WHERE u.roomId=? AND i.family='closing' AND EXISTS(SELECT 1 FROM json_each(i.sequenceJSON)
          WHERE json_extract(value,'$.id')=u.clipId AND json_extract(value,'$.kind')='effect'
            AND COALESCE(json_extract(value,'$.category'),'')!='transition')`, [roomId])?.at ?? 0
      addEffect(supportingEffects(catalogClips(roomId), family, prefs.profile, owner.readyClips, history, now, lastClosing))
    }
    if (family === 'celebration') addEffect(categoryEffects(catalogClips(roomId), 'anticipation', prefs.profile, owner.readyClips, now), true)
    if (family === 'turn') addEffect(categoryEffects(catalogClips(roomId), 'transition', prefs.profile, owner.readyClips, now))
    if (['invitation', 'promotion'].includes(family)) addEffect(categoryEffects(catalogClips(roomId), 'notification', prefs.profile, owner.readyClips, now), true)
    if (input.boundary === 'ended' && input.expectedNextQueueId !== null && !sequence.some(asset => asset.kind === 'effect')) {
      addEffect(categoryEffects(catalogClips(roomId), 'transition', prefs.profile, owner.readyClips, now))
    }
    const id = randomUUID()
    db.run(`INSERT INTO animationInterventions(interventionId,roomId,requestId,requestedByUserId,clipId,clipChecksum,displayText,durationMs,status,requestedAt,expiresAt,origin,sessionId,sourceEventKey,family,sequenceJSON)
      VALUES(?,?,?,?,?,?,?,?,'PENDING',?,?,'AUTO',?,?,?,?)`, [id, roomId, key, identity.userId, clip.id, clip.checksum, clip.displayText,
      sequence.reduce((sum, asset) => sum + asset.durationMs, 0), now, Math.min(now + ANIMATION_LIMITS.startMs, clip.validUntil ?? Infinity), session.sessionId, key, family, JSON.stringify(sequence)])
    if (signal) db.run('UPDATE animationRoomState SET pendingEventJSON=NULL WHERE roomId=?', [roomId])
    db.run('UPDATE animationRoomState SET lastOmission=NULL WHERE roomId=?', [roomId])
    try {
      return Animation.reserve(identity, { ...input, interventionId: id }, status)
    } catch (error) {
      Animation.cancel(roomId, (error as Error).message, id)
      throw error
    }
  }

  static reserveTransitionAmbience (identity: AnimationIdentity, epoch: number, status: { queueId?: number, isAtQueueEnd?: boolean, isErrored?: boolean }, transition: NonNullable<AmbienceGrant['transition']>) {
    if (birthdayOwnsAudio(identity.roomId)) return null
    const roomId = identity.roomId
    const snapshot = Animation.snapshot(roomId)
    const owner = owners.get(roomId)
    const prefs = animationPrefs(snapshot.prefs)
    if (owner?.socketId !== identity.socketId || owner.epoch !== epoch) throw new Error('Reproductor sin autoridad')
    if ((!prefs.enabled && !Animation.greetingEnabled(roomId)) || !prefs.ambienceEnabled || prefs.ambienceVolume === 0
      || Animation.room(roomId).status !== 'open' || !owner.unlocked || !owner.transitionBed || status.isErrored
      || snapshot.ambience || snapshot.blockedUntil > Date.now() || (snapshot.active && snapshot.active.status !== 'PENDING')) return null
    if (transition.sourceQueueId === null) {
      if (!status.isAtQueueEnd && status.queueId !== -1) throw new Error('La canción todavía ocupa el reproductor')
    } else {
      const source = Queue.get(roomId).entities[transition.sourceQueueId]
      if (status.queueId !== transition.sourceQueueId || !source || !['PLAYING', 'PLAYED'].includes(source.status)) throw new Error('Cambió la canción actual')
    }
    if (transition.expectedNextQueueId !== null && Queue.get(roomId).entities[transition.expectedNextQueueId]?.status !== 'APPROVED') throw new Error('El siguiente turno cambió')
    const clip = leastUsedAudio(roomId, eligibleAmbience(catalogClips(roomId), prefs).filter(clip => owner.readyClips.includes(clip.checksum)))
    if (!clip) return null
    const grant: AmbienceGrant = { id: randomUUID(), clip, transition, rotate: false, ownerSocketId: identity.socketId, playerEpoch: epoch,
      until: Date.now() + TRANSITION_BED_MS, durationMs: TRANSITION_BED_MS, offsetMs: 0 }
    grant.background = captureTransitionBackground(roomId, `ambience:${grant.id}`, grant.until)
    db.run('UPDATE animationRoomState SET ambienceJSON=? WHERE roomId=?', [JSON.stringify(grant), roomId])
    Animation.publish(roomId)
    return grant
  }

  static reserveAmbience (identity: AnimationIdentity, epoch: number, status: { queueId?: number, isAtQueueEnd?: boolean, isErrored?: boolean }, clipId?: string, offsetMs = 0) {
    if (birthdayOwnsAudio(identity.roomId)) return null
    const roomId = identity.roomId
    const snapshot = Animation.snapshot(roomId)
    const prefs = animationPrefs(snapshot.prefs)
    const owner = owners.get(roomId)
    if (owner?.socketId !== identity.socketId || owner.epoch !== epoch) throw new Error('Reproductor sin autoridad')
    if (!prefs.enabled || !prefs.automation || !prefs.ambienceEnabled || prefs.ambienceVolume === 0
      || snapshot.session?.status !== 'OPEN' || Animation.room(roomId).status !== 'open'
      || status.isErrored || !(status.isAtQueueEnd || status.queueId === -1)
      || snapshot.blockedUntil > Date.now() || (snapshot.active && snapshot.active.status !== 'PENDING')
      || snapshot.ambience || !owner.unlocked) return null
    const clips = eligibleAmbience(catalogClips(roomId), prefs).filter(clip => owner.readyClips.includes(clip.checksum))
    const previous = clips.find(clip => clip.id === clipId)
    const completed = previous && offsetMs >= previous.durationMs
    const clip = completed ? leastUsedAudio(roomId, clips.filter(clip => clip.id !== clipId)) ?? (previous.loop !== false ? previous : undefined) : previous ?? leastUsedAudio(roomId, clips)
    if (!clip) return null
    const offset = completed || clip.id !== clipId ? 0 : Math.max(0, Math.min(clip.durationMs - 1, offsetMs))
    const durationMs = Math.min(10000, clip.durationMs - offset)
    const grant: AmbienceGrant = { id: randomUUID(), clip, rotate: new Set(clips.map(clip => clip.checksum)).size > 1, ownerSocketId: identity.socketId, playerEpoch: epoch,
      until: Date.now() + durationMs + 1000, durationMs, offsetMs: offset }
    grant.background = captureTransitionBackground(roomId, `ambience:${grant.id}`, grant.until)
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

  static renewAmbience (identity: AnimationIdentity, epoch: number, id: string, status: { queueId?: number, isAtQueueEnd?: boolean, isErrored?: boolean }) {
    const snapshot = Animation.snapshot(identity.roomId)
    const grant = snapshot.ambience
    const owner = owners.get(identity.roomId)
    if (owner?.socketId !== identity.socketId || owner.epoch !== epoch) throw new Error('Reproductor sin autoridad')
    const prefs = snapshot.prefs
    if (!grant || grant.transition || grant.id !== id || grant.ownerSocketId !== identity.socketId || grant.playerEpoch !== epoch || !owner.unlocked
      || !prefs.enabled || !prefs.automation || !prefs.ambienceEnabled || !prefs.ambienceVolume
      || snapshot.session?.status !== 'OPEN' || Animation.room(identity.roomId).status !== 'open'
      || status.isErrored || !(status.isAtQueueEnd || status.queueId === -1) || snapshot.blockedUntil > Date.now()
      || (snapshot.active && (snapshot.active.status !== 'PENDING' || (owner.readyClips.includes(snapshot.active.clipChecksum) && snapshot.active.durationMs <= (snapshot.voiceBudgetRemainingMs ?? 0))))) return null
    const available = eligibleAmbience(catalogClips(identity.roomId), prefs).filter(clip => owner.readyClips.includes(clip.checksum))
    const clip = available.find(clip => clip.id === grant.clip.id && clip.checksum === grant.clip.checksum)
    if (!clip) return null
    const renewed = { ...grant, rotate: new Set(available.map(clip => clip.checksum)).size > 1, until: Date.now() + 10000 }
    renewed.background = captureTransitionBackground(identity.roomId, `ambience:${grant.id}`, renewed.until)
    db.run('UPDATE animationRoomState SET ambienceJSON=? WHERE roomId=?', [JSON.stringify(renewed), identity.roomId])
    Animation.publish(identity.roomId)
    return renewed
  }

  static ambienceStarted (identity: AnimationIdentity, id: string, runId: string) {
    const grant = Animation.ambience(identity.roomId)
    const owner = owners.get(identity.roomId)
    if (!grant || grant.id !== id || grant.ownerSocketId !== identity.socketId || owner?.socketId !== identity.socketId || owner.epoch !== grant.playerEpoch || !owner.unlocked) throw new Error('Permiso de ambiente no válido.')
    recordAudioUsage(identity.roomId, `ambience:${runId}`, grant.clip.id, 'ambience', Date.now(), currentSession(identity.roomId)?.sessionId)
  }

  static event (identity: AnimationIdentity, id: string, epoch: number, event: 'STARTED' | 'ASSET_STARTED' | 'ENDED' | 'STOPPED' | 'NOT_STARTED' | 'FAILED', clipId?: string) {
    const row = db.get<Intervention>('SELECT * FROM animationInterventions WHERE roomId = ? AND interventionId = ?', [identity.roomId, id])
    if (!row || row.ownerSocketId !== identity.socketId || row.playerEpoch !== epoch) throw new Error('El permiso de reproducción no corresponde')
    const now = Date.now()
    if (!['RESERVED', 'PLAYING'].includes(row.status)) return
    if (event === 'ASSET_STARTED') {
      if (row.status !== 'PLAYING' || row.stopRequestedAt || now > row.leaseUntil! || owners.get(identity.roomId)?.epoch !== epoch || !interventionAssets(row).slice(1).some(asset => asset.id === clipId)) throw new Error('El audio no corresponde a la intervención activa.')
      recordAudioUsage(row.roomId, `intervention:${id}`, clipId!, 'intervention', now, row.sessionId)
    } else if (event === 'STARTED') {
      if (row.status === 'PLAYING') return
      if (row.stopRequestedAt || now > row.startBefore! || owners.get(identity.roomId)?.epoch !== epoch) throw new Error('El permiso de inicio venció')
      const room = Animation.room(identity.roomId)
      const state = Animation.snapshot(identity.roomId)
      const call: CallContext | undefined = row.callJSON ? JSON.parse(row.callJSON) : undefined
      if (call && !validCall(identity.roomId, call)) {
        Animation.cancel(identity.roomId, 'El llamado cambió antes del inicio')
        throw new Error('El llamado ya no corresponde al pedido.')
      }
      const greeting = row.origin === 'GREETING' && (!call || interventionAssets(row).some(asset => (asset as AnimationClip & { role?: string }).role === 'greeting'))
      const control = greeting ? db.get<{ playbackVersion: number }>('SELECT playbackVersion FROM greetingControls WHERE roomId=?', [identity.roomId]) : null
      const delivery = greeting ? db.get<{ playbackVersion: number }>('SELECT playbackVersion FROM greetingTurns WHERE interventionId=?', [id]) : null
      if (room.status !== 'open' || (greeting ? !Animation.greetingEnabled(identity.roomId) || control?.playbackVersion !== delivery?.playbackVersion : !state.prefs.enabled) || state.prefs.volume <= 0
        || animationContext(Queue.get(identity.roomId), room.prefs.queue) !== row.contextKey) {
        Animation.cancel(identity.roomId, 'El contexto cambió antes del inicio')
        throw new Error('El contexto cambió antes del inicio')
      }
      db.run('UPDATE animationInterventions SET status = \'PLAYING\', startedAt = ? WHERE interventionId = ?', [now, id])
      recordAudioUsage(row.roomId, `intervention:${id}`, interventionAssets(row)[0].id, 'intervention', now, row.sessionId)
      if (call) getCallAutomation()?.started(identity.roomId, call)
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

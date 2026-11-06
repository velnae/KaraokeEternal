import Animation from './Animation.js'
import { catalogAsset, catalogClips } from './catalog.js'
import Rooms from '../Rooms/Rooms.js'
import Queue from '../Queue/Queue.js'
import { QUEUE_PUSH } from '../../shared/actionTypes.js'
import { TRANSITION_VIDEO_SCENE } from '../../shared/transitionVideo.js'
import { transitionVideoScene } from '../TransitionVideo/Playback.js'
import {
  ANIMATION_REQUEST, ANIMATION_CANCEL, ANIMATION_CONTROL, ANIMATION_RESERVE,
  ANIMATION_READY, ANIMATION_EVENT, ANIMATION_SYNC, ANIMATION_STATE,
  ANIMATION_AUTO, ANIMATION_SESSION, ANIMATION_AMBIENCE, ANIMATION_AMBIENCE_STOP, ANIMATION_AMBIENCE_STARTED, VOICE_FAMILIES,
} from '../../shared/animation.js'

const actions = [ANIMATION_REQUEST, ANIMATION_CANCEL, ANIMATION_CONTROL, ANIMATION_RESERVE, ANIMATION_READY, ANIMATION_EVENT, ANIMATION_SYNC, ANIMATION_AUTO, ANIMATION_SESSION, ANIMATION_AMBIENCE, ANIMATION_AMBIENCE_STOP, ANIMATION_AMBIENCE_STARTED, TRANSITION_VIDEO_SCENE]
const playerActions = [ANIMATION_RESERVE, ANIMATION_READY, ANIMATION_EVENT, ANIMATION_AUTO, ANIMATION_AMBIENCE, ANIMATION_AMBIENCE_STOP, ANIMATION_AMBIENCE_STARTED, TRANSITION_VIDEO_SCENE]
const isId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,100}$/.test(value)

export default Object.fromEntries(actions.map(type => [type, (sock, action, acknowledge) => {
  const roomId = sock.user?.roomId
  try {
    if (!sock.user?.isAdmin || !Number.isInteger(roomId)) throw new Error('No tiene autorización para esta sala')
    const input = action.payload ?? {}
    if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Solicitud no válida')
    if (type !== ANIMATION_SYNC && (!Number.isFinite(input.expiresAt) || input.expiresAt < Date.now() || input.expiresAt > Date.now() + 10000)) throw new Error('La orden venció. Actualice el estado.')
    if (playerActions.includes(type) && !Rooms.isAuthoritativePlayer(sock)) throw new Error('Reproductor sin autoridad')
    const identity = { roomId, userId: sock.user.userId, socketId: sock.id }
    let grant
    let ambience
    let background
    let eligible: boolean | undefined
    if (type === TRANSITION_VIDEO_SCENE) {
      if (!isId(input.sceneId) || typeof input.finished !== 'boolean') throw new Error('Escena de video no válida.')
      background = transitionVideoScene(roomId, input.sceneId, input.finished)
    } else if (type === ANIMATION_REQUEST) {
      if (!isId(input.requestId) || !isId(input.clipId)) throw new Error('Solicitud no válida')
      const asset = catalogAsset(input.clipId, roomId)
      if (!asset || (asset.clip.roomId !== undefined && asset.clip.roomId !== roomId)) throw new Error('El clip no está disponible')
      Animation.request(identity, input.requestId, asset.clip)
    } else if (type === ANIMATION_CANCEL) {
      if (!isId(input.interventionId)) throw new Error('Solicitud no válida')
      Animation.cancel(roomId, 'Cancelado por el operador', input.interventionId)
    } else if (type === ANIMATION_CONTROL) {
      if (!Number.isInteger(input.controlVersion)) throw new Error('Versión de controles no válida')
      for (const key of ['enabled', 'microphoneOccupied', 'automation', 'ambienceEnabled']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error('Control no válido')
      for (const key of ['volume', 'ambienceVolume']) if (input[key] !== undefined && (!Number.isFinite(input[key]) || input[key] < 0 || input[key] > 1)) throw new Error('Volumen no válido')
      if (input.profile !== undefined && !['dinner', 'mixed', 'party'].includes(input.profile)) throw new Error('Perfil no válido')
      if (input.ambienceClipId !== undefined && input.ambienceClipId !== null && !isId(input.ambienceClipId)) throw new Error('Ambiente no válido')
      if (input.cutoffHour !== undefined && (!Number.isInteger(input.cutoffHour) || input.cutoffHour < 0 || input.cutoffHour > 23)) throw new Error('Hora de corte no válida')
      if (input.events !== undefined && (!input.events || typeof input.events !== 'object' || Array.isArray(input.events)
        || Object.entries(input.events).some(([key, value]) => !VOICE_FAMILIES.includes(key as typeof VOICE_FAMILIES[number]) || typeof value !== 'boolean'))) throw new Error('Eventos no válidos')
      Animation.control(roomId, input.controlVersion, input)
    } else if (type === ANIMATION_READY) {
      if (typeof input.audioUnlocked !== 'boolean' || !Array.isArray(input.readyClips) || input.readyClips.length > 30
        || (input.transitionBed !== undefined && typeof input.transitionBed !== 'boolean')) throw new Error('Preparación no válida')
      const hashes = new Set(catalogClips(roomId).map(clip => clip.checksum))
      Animation.ready(identity, input.audioUnlocked, input.readyClips.filter(hash => hashes.has(hash)), input.transitionBed === true)
    } else if (type === ANIMATION_RESERVE || type === ANIMATION_AUTO) {
      if ((type === ANIMATION_RESERVE && !isId(input.interventionId)) || !isId(input.transitionId) || typeof input.contextKey !== 'string'
        || input.contextKey.length > 100000 || !Number.isInteger(input.playerEpoch)
        || !Number.isInteger(input.controlVersion)
        || !(input.sourceQueueId === null || Number.isInteger(input.sourceQueueId))
        || !(input.expectedNextQueueId === null || Number.isInteger(input.expectedNextQueueId))) throw new Error('Reserva no válida')
      if (input.probeOnly !== undefined && (type !== ANIMATION_AUTO || typeof input.probeOnly !== 'boolean')) throw new Error('Consulta no válida')
      if (input.probeOnly) eligible = !!Animation.automaticPlan(identity, input)
      else {
        grant = type === ANIMATION_AUTO ? Animation.automatic(identity, input, sock._lastPlayerStatus ?? {}) : Animation.reserve(identity, input, sock._lastPlayerStatus ?? {})
        sock.server.to(Rooms.prefix(roomId)).emit('action', { type: QUEUE_PUSH, payload: Queue.get(roomId) })
      }
    } else if (type === ANIMATION_EVENT) {
      if (!isId(input.interventionId) || !Number.isInteger(input.playerEpoch)
        || !['STARTED', 'ASSET_STARTED', 'ENDED', 'STOPPED', 'NOT_STARTED', 'FAILED'].includes(input.event)
        || (input.event === 'ASSET_STARTED' && !isId(input.clipId))) throw new Error('Evento no válido')
      Animation.event(identity, input.interventionId, input.playerEpoch, input.event, input.clipId)
    } else if (type === ANIMATION_SESSION) {
      if (!['open', 'close', 'finish', 'celebrate'].includes(input.operation) || (input.operation === 'celebrate' && input.confirmed !== true)) throw new Error('Confirme la operación de la jornada.')
      Animation.session(roomId, sock.user.userId, input.operation)
    } else if (type === ANIMATION_AMBIENCE) {
      if (!Number.isInteger(input.playerEpoch) || (input.offsetMs !== undefined && (!Number.isFinite(input.offsetMs) || input.offsetMs < 0))) throw new Error('Permiso de ambiente no válido')
      if (input.renewId !== undefined && !isId(input.renewId)) throw new Error('Permiso de ambiente no válido')
      if (input.transition !== undefined && (!input.transition || typeof input.transition !== 'object' || Array.isArray(input.transition) || input.renewId
        || ![input.transition.sourceQueueId, input.transition.expectedNextQueueId].every(id => id === null || (Number.isInteger(id) && id >= 0)))) throw new Error('Transición de ambiente no válida')
      ambience = input.renewId
        ? Animation.renewAmbience(identity, input.playerEpoch, input.renewId, sock._lastPlayerStatus ?? {})
        : input.transition
          ? Animation.reserveTransitionAmbience(identity, input.playerEpoch, sock._lastPlayerStatus ?? {}, input.transition)
          : Animation.reserveAmbience(identity, input.playerEpoch, sock._lastPlayerStatus ?? {}, input.clipId, input.offsetMs)
    } else if (type === ANIMATION_AMBIENCE_STOP) {
      if (!isId(input.id)) throw new Error('Permiso de ambiente no válido')
      Animation.stopAmbience(identity, input.id)
    } else if (type === ANIMATION_AMBIENCE_STARTED) {
      if (!isId(input.id) || !isId(input.runId)) throw new Error('Inicio de ambiente no válido.')
      Animation.ambienceStarted(identity, input.id, input.runId)
    }
    Animation.sweep()
    acknowledge?.({ type: ANIMATION_STATE, payload: Animation.snapshot(roomId), ...(background !== undefined ? { background } : {}), ...(eligible !== undefined ? { eligible } : {}), ...(grant ? { grant } : {}), ...(ambience ? { ambience } : {}) })
  } catch (error) {
    acknowledge?.({ type: ANIMATION_STATE, error: (error as Error).message })
  }
}]))

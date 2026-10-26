import Animation from './Animation.js'
import { catalogAsset, catalogClips } from './catalog.js'
import Rooms from '../Rooms/Rooms.js'
import Queue from '../Queue/Queue.js'
import { QUEUE_PUSH } from '../../shared/actionTypes.js'
import {
  ANIMATION_REQUEST, ANIMATION_CANCEL, ANIMATION_CONTROL, ANIMATION_RESERVE,
  ANIMATION_READY, ANIMATION_EVENT, ANIMATION_SYNC, ANIMATION_STATE,
} from '../../shared/animation.js'

const actions = [ANIMATION_REQUEST, ANIMATION_CANCEL, ANIMATION_CONTROL, ANIMATION_RESERVE, ANIMATION_READY, ANIMATION_EVENT, ANIMATION_SYNC]
const playerActions = [ANIMATION_RESERVE, ANIMATION_READY, ANIMATION_EVENT]
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
    if (type === ANIMATION_REQUEST) {
      if (!isId(input.requestId) || !isId(input.clipId)) throw new Error('Solicitud no válida')
      const asset = catalogAsset(input.clipId)
      if (!asset) throw new Error('El clip no está disponible')
      Animation.request(identity, input.requestId, asset.clip)
    } else if (type === ANIMATION_CANCEL) {
      if (!isId(input.interventionId)) throw new Error('Solicitud no válida')
      Animation.cancel(roomId, 'Cancelado por el operador', input.interventionId)
    } else if (type === ANIMATION_CONTROL) {
      if (!Number.isInteger(input.controlVersion)) throw new Error('Versión de controles no válida')
      for (const key of ['enabled', 'microphoneOccupied']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error('Control no válido')
      if (input.volume !== undefined && (!Number.isFinite(input.volume) || input.volume < 0 || input.volume > 1)) throw new Error('Volumen no válido')
      Animation.control(roomId, input.controlVersion, input)
    } else if (type === ANIMATION_READY) {
      if (typeof input.audioUnlocked !== 'boolean' || !Array.isArray(input.readyClips) || input.readyClips.length > 30) throw new Error('Preparación no válida')
      const hashes = new Set(catalogClips().map(clip => clip.checksum))
      Animation.ready(identity, input.audioUnlocked, input.readyClips.filter(hash => hashes.has(hash)))
    } else if (type === ANIMATION_RESERVE) {
      if (!isId(input.interventionId) || !isId(input.transitionId) || typeof input.contextKey !== 'string'
        || input.contextKey.length > 100000 || !Number.isInteger(input.playerEpoch)
        || !Number.isInteger(input.controlVersion)
        || !(input.sourceQueueId === null || Number.isInteger(input.sourceQueueId))
        || !(input.expectedNextQueueId === null || Number.isInteger(input.expectedNextQueueId))) throw new Error('Reserva no válida')
      grant = Animation.reserve(identity, input, sock._lastPlayerStatus ?? {})
      sock.server.to(Rooms.prefix(roomId)).emit('action', { type: QUEUE_PUSH, payload: Queue.get(roomId) })
    } else if (type === ANIMATION_EVENT) {
      if (!isId(input.interventionId) || !Number.isInteger(input.playerEpoch)
        || !['STARTED', 'ENDED', 'STOPPED', 'NOT_STARTED', 'FAILED'].includes(input.event)) throw new Error('Evento no válido')
      Animation.event(identity, input.interventionId, input.playerEpoch, input.event)
    }
    Animation.sweep()
    acknowledge?.({ type: ANIMATION_STATE, payload: Animation.snapshot(roomId), ...(grant ? { grant } : {}) })
  } catch (error) {
    acknowledge?.({ type: ANIMATION_STATE, error: (error as Error).message })
  }
}]))

import Greetings from './Greetings.js'
import Rooms from '../Rooms/Rooms.js'
import Animation from '../Animation/Animation.js'
import { participation } from '../Tables/admission.js'
import { GREETINGS } from '../../shared/greetings.js'
import getLogger from '../lib/Log.js'
import { prepareGreetingTransition } from './transition.js'
import { getGreetingAudioAsset } from './audioRouter.js'
import { db } from '../lib/Database.js'
import { interventionAssets, type Intervention } from '../../shared/animation.js'
import type { GreetingAsset } from '../../shared/greetings.js'
import { catalogClips } from '../Animation/catalog.js'

const log = getLogger('greetings')

export default {
  [GREETINGS]: async (sock, { payload }, acknowledge) => {
    try {
      const identity = sock.user
      participation(identity)
      const roomId = identity.roomId
      if (!Number.isSafeInteger(roomId)) throw new Error('Entra a una sala')
      const operation = payload?.operation
      const status = Rooms.getPlayerStatus(sock.server, roomId) ?? {}
      const number = (key: string) => {
        if (!Number.isSafeInteger(payload[key]) || payload[key] < 1) throw new Error('Identificador de saludo no válido')
        return payload[key] as number
      }
      if (operation === 'read') return acknowledge({ payload: Greetings.snapshot(identity, status) })
      if (!Number.isFinite(payload?.expiresAt) || payload.expiresAt < Date.now() || payload.expiresAt > Date.now() + 10000) throw new Error('La orden venció. Actualiza e intenta nuevamente.')
      if (operation === 'attach' || operation === 'inspect') throw new Error('Los saludos se agregan al pedir la canción.')
      if (operation === 'remove') Greetings.remove(identity, number('greetingId'))
      else if (operation === 'prepareAudio') {
        if (!identity.isAdmin || typeof payload.enabled !== 'boolean') throw new Error('Solo el operador puede configurar la preparación de voz')
        Greetings.prepareAudio(roomId, payload.enabled)
      } else if (operation === 'playback') {
        if (!identity.isAdmin) throw new Error('Solo el operador puede configurar la lectura de saludos')
        Greetings.configurePlayback(roomId, payload.settings, payload.version)
      } else if (operation === 'pause') {
        if (!identity.isAdmin || typeof payload.paused !== 'boolean') throw new Error('Solo el operador puede pausar los saludos')
        Greetings.pause(roomId, payload.paused)
      } else if (['prepare', 'reserve', 'start', 'end', 'finish', 'audioStarted', 'audioEnded', 'audioFailed'].includes(operation)) {
        if (!identity.isAdmin || !Rooms.isAuthoritativePlayer(sock)) throw new Error('Reproductor sin autoridad')
        const revalidate = () => {
          if (sock.connected === false || sock.user?.roomId !== roomId || !sock.user?.isAdmin || !Rooms.isAuthoritativePlayer(sock) || payload.expiresAt < Date.now()) throw new Error('El permiso de reproducción venció')
        }
        if (operation === 'prepare') {
          const preparation = await prepareGreetingTransition(roomId, number('queueId'))
          revalidate()
          return acknowledge({ preparation })
        }
        if (operation === 'reserve') {
          const ready: string[] = payload.readyClips ?? []
          if (!Array.isArray(ready) || ready.length > 30 || ready.some(hash => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) throw new Error('Preparación de audio no válida')
          const remainingMs = payload.remainingMs ?? 25000
          if (!Number.isFinite(remainingMs) || remainingMs < 0 || remainingMs > 25000) throw new Error('Tiempo de transición no válido')
          const prepared = payload.audioReady === true && ready.length ? await prepareGreetingTransition(roomId, number('queueId')) : null
          revalidate()
          if (payload.audioReady === true) {
            const catalogHashes = new Set(catalogClips(roomId).map(clip => clip.checksum))
            Animation.ready({ roomId, userId: identity.userId, socketId: sock.id }, true, ready.filter(hash => catalogHashes.has(hash)))
          }
          const animation = Animation.snapshot(roomId)
          const blocker = animation.microphoneOccupied ? 'Micrófono ocupado' : animation.active || animation.blockedUntil > Date.now() ? 'Intervención del operador en curso' : undefined
          const grant = Greetings.reserve(roomId, sock.id, number('queueId'), sock._lastPlayerStatus ?? {}, blocker, prepared, ready, identity.userId, remainingMs)
          Animation.publish(roomId)
          return acknowledge({ grant })
        }
        if (operation === 'start' && payload.voiced === true) {
          const asset = await getGreetingAudioAsset(roomId, number('greetingId'))
          revalidate()
          const intervention = db.get<Intervention>(`SELECT i.* FROM animationInterventions i JOIN greetingTurns t USING(interventionId) WHERE t.turnKey=? AND t.roomId=?`, [number('turnKey'), roomId])
          if (!asset || !Animation.greetingEnabled(roomId) || !intervention || intervention.ownerSocketId !== sock.id || intervention.stopRequestedAt
            || !(interventionAssets(intervention) as GreetingAsset[]).some(item => item.role === 'greeting' && item.id === asset.id && item.checksum === asset.checksum)) throw new Error('La voz ya no está disponible para este saludo')
        }
        if (operation === 'finish') Greetings.finish(roomId, sock.id, number('turnKey'))
        else if (['audioStarted', 'audioEnded', 'audioFailed'].includes(operation)) Greetings.voiceEvent(roomId, sock.id, number('turnKey'), number('greetingId'), operation, payload.reason)
        else Greetings.event(roomId, sock.id, number('turnKey'), number('greetingId'), operation)
      } else throw new Error('Operación de saludos no válida')
      Animation.publish(roomId)
      acknowledge({ payload: Greetings.snapshot(identity, status) })
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ERR_SQLITE_ERROR') {
        log.error('Greeting operation %s failed in room %s: %s', payload?.operation, sock.user?.roomId, error.message)
      }
      acknowledge({ error: (error as Error).message })
    }
  },
}

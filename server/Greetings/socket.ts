import Greetings from './Greetings.js'
import Rooms from '../Rooms/Rooms.js'
import Animation from '../Animation/Animation.js'
import { participation } from '../Tables/admission.js'
import { GREETINGS } from '../../shared/greetings.js'
import getLogger from '../lib/Log.js'

const log = getLogger('greetings')

export default {
  [GREETINGS]: (sock, { payload }, acknowledge) => {
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
      } else if (operation === 'pause') {
        if (!identity.isAdmin || typeof payload.paused !== 'boolean') throw new Error('Solo el operador puede pausar los saludos')
        Greetings.pause(roomId, payload.paused)
      } else if (['reserve', 'start', 'end', 'finish'].includes(operation)) {
        if (!identity.isAdmin || !Rooms.isAuthoritativePlayer(sock)) throw new Error('Reproductor sin autoridad')
        if (operation === 'reserve') {
          const animation = Animation.snapshot(roomId)
          const blocker = animation.microphoneOccupied ? 'Micrófono ocupado' : animation.active || animation.blockedUntil > Date.now() ? 'Intervención del operador en curso' : undefined
          const grant = Greetings.reserve(roomId, sock.id, number('queueId'), sock._lastPlayerStatus ?? {}, blocker)
          return acknowledge({ grant })
        }
        if (operation === 'finish') Greetings.finish(roomId, sock.id, number('turnKey'))
        else Greetings.event(roomId, sock.id, number('turnKey'), number('greetingId'), operation)
      } else throw new Error('Operación de saludos no válida')
      acknowledge({ payload: Greetings.snapshot(identity, status) })
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ERR_SQLITE_ERROR') {
        log.error('Greeting operation %s failed in room %s: %s', payload?.operation, sock.user?.roomId, error.message)
      }
      acknowledge({ error: (error as Error).message })
    }
  },
}

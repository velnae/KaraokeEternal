import { BIRTHDAY_PLAYER, BIRTHDAY_SYNC } from '../../shared/birthdays.js'
import Rooms from '../Rooms/Rooms.js'
import { canOperate } from '../../shared/permissions.js'
import Animation from '../Animation/Animation.js'
import Queue from '../Queue/Queue.js'
import { birthdayService } from './Service.js'
import { assertRoom, getBirthday, publicEvents } from './Store.js'

export default {
  [BIRTHDAY_SYNC]: (sock, _action, acknowledge) => {
    if (!Number.isInteger(sock.user.roomId)) throw new Error('Seleccione una sala.')
    acknowledge({ payload: { roomId: sock.user.roomId, events: publicEvents(sock.user.roomId) } })
  },
  [BIRTHDAY_PLAYER]: async (sock, { payload }, acknowledge) => {
    if (!canOperate(sock.user) || !Rooms.isAuthoritativePlayer(sock)) throw new Error('Reproductor sin autoridad.')
    const roomId = sock.user.roomId
    assertRoom(roomId)
    const service = birthdayService()
    if (payload?.operation === 'reserve') {
      if (!publicEvents(roomId).length) return acknowledge({ payload: null })
      const status = Rooms.getPlayerStatus(sock.server, roomId)
      const idle = status?.isAtQueueEnd || status?.queueId === -1
      if (!idle && !(payload.boundary === 'ended' && status?.queueId === payload.sourceQueueId)) throw new Error('La canción actual todavía ocupa la sala.')
      // Persist the boundary before waiting for preparation or sound permission;
      // reconnecting must not requeue a song that has already ended.
      if (payload.boundary === 'ended' && status?.queueId === payload.sourceQueueId) Queue.transition(roomId, payload.sourceQueueId, 'PLAYED')
      if (payload.ready !== true) {
        service.waiting(roomId, status?.volume <= 0 ? 'Suba el volumen del reproductor para iniciar el cumpleaños.' : 'Active el sonido en la pantalla del reproductor para iniciar el cumpleaños.')
        return acknowledge({ payload: { waiting: true } })
      }
      if (Animation.active(roomId) && Animation.active(roomId)?.status !== 'PENDING') return acknowledge({ payload: { waiting: true } })
      const grant = await service.reserve(roomId, sock.id)
      if (!Rooms.isAuthoritativePlayer(sock)) {
        service.interrupt(roomId, 'El reproductor se desconectó.', sock.id)
        throw new Error('Se perdió la autoridad del reproductor.')
      }
      acknowledge({ payload: grant })
    } else {
      if (!['heartbeat', 'phase', 'finish', 'interrupt', 'introStarted'].includes(payload?.operation)) throw new Error('Acción inválida.')
      service.progress(roomId, sock.id, payload.id, payload.token, payload.operation, payload.phase)
      acknowledge({ payload: { accepted: true, remainingMs: Math.max(0, (getBirthday(roomId, payload.id).leaseUntil ?? 0) - Date.now()) } })
    }
  },
}

import Rooms, { STATUSES } from './Rooms.js'
import { getQueuePrefsValidationError, normalizeQueuePrefs } from '../../shared/queueRules.js'
import { normalizeTransitionVideoPrefs } from '../../shared/transitionVideo.js'
import {
  ROOM_PREFS_PUSH_REQUEST,
  ROOM_PREFS_PUSH,
  _ERROR,
  _SUCCESS,
} from '../../shared/actionTypes.js'

const ACTION_HANDLERS = {
  [ROOM_PREFS_PUSH_REQUEST]: async (sock, { payload }, acknowledge) => {
    const { roomId, prefs } = payload

    if (!sock.user.isAdmin || !roomId) {
      return acknowledge({
        type: ROOM_PREFS_PUSH_REQUEST + _ERROR,
        error: 'No tiene autorización',
      })
    }

    if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) {
      return acknowledge({
        type: ROOM_PREFS_PUSH_REQUEST + _ERROR,
        error: 'Las preferencias de la sala deben ser un objeto',
      })
    }

    const queuePrefsError = getQueuePrefsValidationError(prefs.queue)
    if (queuePrefsError) {
      return acknowledge({
        type: ROOM_PREFS_PUSH_REQUEST + _ERROR,
        error: queuePrefsError,
      })
    }

    const sockets = await sock.server.in(Rooms.prefix(roomId)).fetchSockets()
    // Read after socket discovery so an intervening background save is retained.
    const room = Rooms.get(roomId, { status: STATUSES }).entities[roomId]
    if (!room) {
      return acknowledge({
        type: ROOM_PREFS_PUSH_REQUEST + _ERROR,
        error: 'No se encontró la sala',
      })
    }

    const normalizedPayload = {
      ...payload,
      prefs: {
        ...prefs,
        queue: normalizeQueuePrefs(prefs.queue),
        transitionVideo: normalizeTransitionVideoPrefs(room.prefs?.transitionVideo),
      },
    }

    for (const s of sockets) {
      if (s?.user.isAdmin) {
        sock.server.to(s.id).emit('action', {
          type: ROOM_PREFS_PUSH,
          payload: normalizedPayload,
        })
      }
    }

    acknowledge({ type: ROOM_PREFS_PUSH_REQUEST + _SUCCESS })
  },
}

export default ACTION_HANDLERS

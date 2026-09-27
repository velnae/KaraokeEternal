import Rooms from './Rooms.js'
import { getQueuePrefsValidationError, normalizeQueuePrefs } from '../../shared/queueRules.js'
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
        error: 'Unauthorized',
      })
    }

    if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) {
      return acknowledge({
        type: ROOM_PREFS_PUSH_REQUEST + _ERROR,
        error: 'Room preferences must be an object',
      })
    }

    const queuePrefsError = getQueuePrefsValidationError(prefs.queue)
    if (queuePrefsError) {
      return acknowledge({
        type: ROOM_PREFS_PUSH_REQUEST + _ERROR,
        error: queuePrefsError,
      })
    }

    const normalizedPayload = {
      ...payload,
      prefs: {
        ...prefs,
        queue: normalizeQueuePrefs(prefs.queue),
      },
    }

    const sockets = await sock.server.in(Rooms.prefix(roomId)).fetchSockets()

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

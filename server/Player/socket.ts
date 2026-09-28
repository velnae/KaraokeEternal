import Rooms from '../Rooms/Rooms.js'
import Queue from '../Queue/Queue.js'

import {
  PLAYER_CMD_NEXT,
  PLAYER_CMD_OPTIONS,
  PLAYER_CMD_PAUSE,
  PLAYER_CMD_PLAY,
  PLAYER_CMD_REPLAY,
  PLAYER_CMD_VOLUME,
  PLAYER_REQ_NEXT,
  PLAYER_REQ_OPTIONS,
  PLAYER_REQ_PAUSE,
  PLAYER_REQ_PLAY,
  PLAYER_REQ_REPLAY,
  PLAYER_REQ_VOLUME,
  PLAYER_EMIT_STATUS,
  PLAYER_EMIT_LEAVE,
  PLAYER_EMIT_FAILURE,
  PLAYER_STATUS,
  PLAYER_LEAVE,
  QUEUE_PUSH,
} from '../../shared/actionTypes.js'

// ------------------------------------
// Action Handlers
// ------------------------------------
const ACTION_HANDLERS = {
  [PLAYER_EMIT_FAILURE]: (sock, { payload }, acknowledge) => {
    if (!sock.user.isAdmin) {
      throw new Error('Only administrators can report player failures')
    }

    const queueId = payload?.queueId
    if (!Number.isInteger(queueId) || queueId < 0) {
      return acknowledge?.({
        type: PLAYER_EMIT_FAILURE + '_ERROR',
        error: 'Invalid failed queue item',
      })
    }

    const changed = Queue.transition(sock.user.roomId, queueId, 'FAILED')
    acknowledge?.({ type: PLAYER_EMIT_FAILURE + '_SUCCESS' })

    if (changed) {
      sock.server.to(Rooms.prefix(sock.user.roomId)).emit('action', {
        type: QUEUE_PUSH,
        payload: Queue.get(sock.user.roomId),
      })
    }
  },
  [PLAYER_REQ_OPTIONS]: (sock, { payload }) => {
    // @todo: emit to players only
    sock.server.to(Rooms.prefix(sock.user.roomId)).emit('action', {
      type: PLAYER_CMD_OPTIONS,
      payload,
    })
  },
  [PLAYER_REQ_NEXT]: (sock) => {
    // @todo: emit to players only
    sock.server.to(Rooms.prefix(sock.user.roomId)).emit('action', {
      type: PLAYER_CMD_NEXT,
    })
  },
  [PLAYER_REQ_PAUSE]: (sock) => {
    // @todo: emit to players only
    sock.server.to(Rooms.prefix(sock.user.roomId)).emit('action', {
      type: PLAYER_CMD_PAUSE,
    })
  },
  [PLAYER_REQ_PLAY]: (sock) => {
    // @todo: emit to players only
    sock.server.to(Rooms.prefix(sock.user.roomId)).emit('action', {
      type: PLAYER_CMD_PLAY,
    })
  },
  [PLAYER_REQ_REPLAY]: (sock, { payload }) => {
    // @todo: emit to players only
    sock.server.to(Rooms.prefix(sock.user.roomId)).emit('action', {
      type: PLAYER_CMD_REPLAY,
      payload,
    })
  },
  [PLAYER_REQ_VOLUME]: (sock, { payload }) => {
    // @todo: emit to players only
    sock.server.to(Rooms.prefix(sock.user.roomId)).emit('action', {
      type: PLAYER_CMD_VOLUME,
      payload,
    })
  },
  [PLAYER_EMIT_STATUS]: (sock, { payload }) => {
    if (!sock.user.isAdmin) {
      throw new Error('Only administrators can publish player status')
    }

    if (Queue.syncPlayerLifecycle(sock.user.roomId, payload)) {
      sock.server.to(Rooms.prefix(sock.user.roomId)).emit('action', {
        type: QUEUE_PUSH,
        payload: Queue.get(sock.user.roomId),
      })
    }

    // so we can tell the room when players leave and
    // relay last known player status on client join
    sock._lastPlayerStatus = payload

    sock.server.to(Rooms.prefix(sock.user.roomId)).emit('action', {
      type: PLAYER_STATUS,
      payload,
    })
  },
  [PLAYER_EMIT_LEAVE]: (sock) => {
    sock._lastPlayerStatus = null

    // any players left in room?
    if (!Rooms.isPlayerPresent(sock.server, sock.user.roomId)) {
      if (Queue.requeuePlaying(sock.user.roomId)) {
        sock.server.to(Rooms.prefix(sock.user.roomId)).emit('action', {
          type: QUEUE_PUSH,
          payload: Queue.get(sock.user.roomId),
        })
      }

      sock.server.to(Rooms.prefix(sock.user.roomId)).emit('action', {
        type: PLAYER_LEAVE,
        payload: { socketId: sock.id },
      })
    }
  },
}

export default ACTION_HANDLERS

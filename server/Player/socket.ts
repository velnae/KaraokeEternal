import Rooms from '../Rooms/Rooms.js'
import Queue from '../Queue/Queue.js'
import getLogger from '../lib/Log.js'

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
  PLAYER_AUTHORITY_GRANTED,
  PLAYER_AUTHORITY_DENIED,
  PLAYER_AUTHORITY_AVAILABLE,
  PLAYER_STATUS,
  PLAYER_LEAVE,
  QUEUE_PUSH,
} from '../../shared/actionTypes.js'

const log = getLogger('player-failure')
const youtubeMessages: Record<number, string> = {
  2: 'Invalid YouTube video ID',
  5: 'YouTube HTML5 playback failed',
  100: 'YouTube video is unavailable or has been removed',
  101: 'YouTube video owner does not allow embedded playback',
  150: 'YouTube video owner does not allow embedded playback',
}

const adminOnly = (sock, actionType, acknowledge): boolean => {
  if (sock.user.isAdmin) return true

  acknowledge?.({
    type: actionType + '_ERROR',
    error: 'Solo los administradores pueden controlar la reproducción',
  })
  return false
}

const authoritativeOnly = (sock, actionType, acknowledge): boolean => {
  if (!adminOnly(sock, actionType, acknowledge)) return false
  if (Rooms.isAuthoritativePlayer(sock)) return true

  acknowledge?.({
    type: PLAYER_AUTHORITY_DENIED,
    payload: { message: 'Ya hay otro reproductor activo en esta sala.' },
  })
  return false
}

const sendCommand = (sock, requestType, commandType, payload, acknowledge) => {
  if (!adminOnly(sock, requestType, acknowledge)) return

  sock.server.to(Rooms.prefix(sock.user.roomId)).emit('action', {
    type: commandType,
    ...(payload === undefined ? {} : { payload }),
  })
  acknowledge?.({ type: requestType + '_SUCCESS' })
}

const announcePlayerLeave = (sock) => {
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
  sock.server.to(Rooms.prefix(sock.user.roomId)).emit('action', {
    type: PLAYER_AUTHORITY_AVAILABLE,
  })
}

// ------------------------------------
// Action Handlers
// ------------------------------------
const ACTION_HANDLERS = {
  [PLAYER_EMIT_FAILURE]: (sock, { payload }, acknowledge) => {
    if (!authoritativeOnly(sock, PLAYER_EMIT_FAILURE, acknowledge)) return

    const queueId = payload?.queueId
    if (!Number.isInteger(queueId) || queueId < 0) {
      return acknowledge?.({
        type: PLAYER_EMIT_FAILURE + '_ERROR',
        error: 'La canción de la cola con error no es válida',
      })
    }

    const changed = Queue.transition(sock.user.roomId, queueId, 'FAILED')
    acknowledge?.({ type: PLAYER_EMIT_FAILURE + '_SUCCESS' })

    if (changed) {
      const queue = Queue.get(sock.user.roomId)
      const item = queue.entities[queueId]
      let code: number | null = null
      let category = 'unknown'
      let message = 'Playback failure reported'
      if (payload?.category === 'iframe'
        && Number.isInteger(payload.code) && payload.code >= 0 && payload.code <= 9999) {
        code = payload.code
        category = 'iframe'
        message = youtubeMessages[code] ?? 'YouTube playback failed'
      } else if (payload?.category === 'api-load') {
        category = 'api-load'
        message = 'YouTube IFrame Player API failed to load'
      }
      let videoId: string | null = null
      if (item?.source === 'YOUTUBE' && typeof item.externalId === 'string'
        && /^[A-Za-z0-9_-]{11}$/.test(item.externalId)) {
        videoId = item.externalId
      }
      const source = item?.source === 'YOUTUBE' || item?.source === 'LOCAL' ? item.source : null

      log.info('Playback failure %s', JSON.stringify({
        timestamp: new Date().toISOString(),
        roomId: sock.user.roomId,
        queueId,
        source,
        videoId,
        category,
        code,
        message,
      }))
      sock.server.to(Rooms.prefix(sock.user.roomId)).emit('action', {
        type: QUEUE_PUSH,
        payload: queue,
      })
    }
  },
  [PLAYER_REQ_OPTIONS]: (sock, { payload }, acknowledge) => {
    sendCommand(sock, PLAYER_REQ_OPTIONS, PLAYER_CMD_OPTIONS, payload, acknowledge)
  },
  [PLAYER_REQ_NEXT]: (sock, _action, acknowledge) => {
    sendCommand(sock, PLAYER_REQ_NEXT, PLAYER_CMD_NEXT, undefined, acknowledge)
  },
  [PLAYER_REQ_PAUSE]: (sock, _action, acknowledge) => {
    sendCommand(sock, PLAYER_REQ_PAUSE, PLAYER_CMD_PAUSE, undefined, acknowledge)
  },
  [PLAYER_REQ_PLAY]: (sock, _action, acknowledge) => {
    sendCommand(sock, PLAYER_REQ_PLAY, PLAYER_CMD_PLAY, undefined, acknowledge)
  },
  [PLAYER_REQ_REPLAY]: (sock, { payload }, acknowledge) => {
    sendCommand(sock, PLAYER_REQ_REPLAY, PLAYER_CMD_REPLAY, payload, acknowledge)
  },
  [PLAYER_REQ_VOLUME]: (sock, { payload }, acknowledge) => {
    sendCommand(sock, PLAYER_REQ_VOLUME, PLAYER_CMD_VOLUME, payload, acknowledge)
  },
  [PLAYER_EMIT_STATUS]: (sock, { payload }, acknowledge) => {
    if (!adminOnly(sock, PLAYER_EMIT_STATUS, acknowledge)) return

    if (!Rooms.claimPlayer(sock.server, sock, sock.user.roomId)) {
      return acknowledge?.({
        type: PLAYER_AUTHORITY_DENIED,
        payload: { message: 'Ya hay otro reproductor activo en esta sala.' },
      })
    }

    acknowledge?.({ type: PLAYER_AUTHORITY_GRANTED })

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
  [PLAYER_EMIT_LEAVE]: (sock, _action, acknowledge) => {
    if (!authoritativeOnly(sock, PLAYER_EMIT_LEAVE, acknowledge)) return

    sock._isPlayerAuthoritative = false
    sock._lastPlayerStatus = null

    // any players left in room?
    if (!Rooms.isPlayerPresent(sock.server, sock.user.roomId)) {
      announcePlayerLeave(sock)
    }

    acknowledge?.({ type: PLAYER_EMIT_LEAVE + '_SUCCESS' })
  },
}

export default ACTION_HANDLERS

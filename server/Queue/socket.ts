import Queue from './Queue.js'
import Rooms from '../Rooms/Rooms.js'
import {
  QUEUE_ADD,
  QUEUE_APPROVE,
  QUEUE_MOVE,
  QUEUE_REJECT,
  QUEUE_REMOVE,
  QUEUE_PUSH,
} from '../../shared/actionTypes.js'
import { normalizeQueuePrefs } from '../../shared/queueRules.js'
import {
  QUEUE_ITEM_ORIGINS,
  SONG_SOURCES,
  type QueueItemOrigin,
  type SongSource,
} from '../../shared/queueLifecycle.js'
import { getSongSource } from '../SongSources/index.js'

// ------------------------------------
// Action Handlers
// ------------------------------------
const ACTION_HANDLERS = {
  [QUEUE_ADD]: async (sock, { payload }, acknowledge) => {
    const { songId } = payload
    const origin: QueueItemOrigin = payload.origin ?? 'PARTICIPANT'
    const source: SongSource = payload.source ?? 'LOCAL'
    const sourceId = String(payload.sourceId ?? songId ?? '')
    const roomId = sock.user.roomId

    if (!QUEUE_ITEM_ORIGINS.includes(origin)) {
      return acknowledge({
        type: QUEUE_ADD + '_ERROR',
        error: 'Invalid queue item origin',
      })
    }

    if (origin !== 'PARTICIPANT' && !sock.user.isAdmin) {
      return acknowledge({
        type: QUEUE_ADD + '_ERROR',
        error: 'Only administrators can create house or operator items',
      })
    }

    if (!SONG_SOURCES.includes(source)) {
      return acknowledge({
        type: QUEUE_ADD + '_ERROR',
        error: 'Invalid song source',
      })
    }

    try {
      await Rooms.validate(roomId, null, { validatePassword: false })
    } catch (err) {
      return acknowledge({
        type: QUEUE_ADD + '_ERROR',
        error: err.message,
      })
    }

    const room = Rooms.get(roomId).entities[roomId]
    const queuePrefs = normalizeQueuePrefs(room?.prefs?.queue)
    const maxPending = queuePrefs.maxPendingPerParticipant

    if (!sock.user.isAdmin) {
      const pendingCount = Queue.countPending(roomId, sock.user.userId)

      if (pendingCount >= maxPending) {
        return acknowledge({
          type: QUEUE_ADD + '_ERROR',
          error: `Maximum pending song requests reached (${maxPending})`,
        })
      }
    }

    let song
    try {
      song = await getSongSource(source).resolve(sourceId, { roomId })
      if (!song || !song.isPlayable) throw new Error('Song is unavailable or not playable')
    } catch (err) {
      return acknowledge({
        type: QUEUE_ADD + '_ERROR',
        error: err.message,
      })
    }

    Queue.add({
      roomId,
      song,
      userId: sock.user.userId,
      origin,
      status: origin === 'PARTICIPANT' && !sock.user.isAdmin && queuePrefs.approvalMode === 'MANUAL'
        ? 'PENDING_APPROVAL'
        : 'APPROVED',
    })

    // success
    acknowledge({ type: QUEUE_ADD + '_SUCCESS' })

    // to all in room
    sock.server.to(Rooms.prefix(roomId)).emit('action', {
      type: QUEUE_PUSH,
      payload: Queue.get(roomId),
    })
  },
  [QUEUE_APPROVE]: (sock, { payload }, acknowledge) => {
    moderateRequest(sock, payload.queueId, 'APPROVED', acknowledge)
  },
  [QUEUE_REJECT]: (sock, { payload }, acknowledge) => {
    moderateRequest(sock, payload.queueId, 'REJECTED', acknowledge)
  },
  [QUEUE_MOVE]: async (sock, { payload }, acknowledge) => {
    const { queueId, prevQueueId } = payload

    try {
      await Rooms.validate(sock.user.roomId, null, { validatePassword: false })
    } catch (err) {
      return acknowledge({
        type: QUEUE_MOVE + '_ERROR',
        error: err.message,
      })
    }

    if (!sock.user.isAdmin) {
      return acknowledge({
        type: QUEUE_MOVE + '_ERROR',
        error: 'Only administrators can move queue items',
      })
    }

    Queue.move({
      prevQueueId,
      queueId,
      roomId: sock.user.roomId,
    })

    // success
    acknowledge({ type: QUEUE_MOVE + '_SUCCESS' })

    // tell room
    sock.server.to(Rooms.prefix(sock.user.roomId)).emit('action', {
      type: QUEUE_PUSH,
      payload: Queue.get(sock.user.roomId),
    })
  },
  [QUEUE_REMOVE]: (sock, { payload }, acknowledge) => {
    const { queueId } = payload
    const ids = Array.isArray(queueId) ? queueId : [queueId]

    if (!sock.user.isAdmin && !(Queue.isOwner(sock.user.userId, ids))) {
      return acknowledge({
        type: QUEUE_REMOVE + '_ERROR',
        error: 'Cannot remove another user\'s song',
      })
    }

    for (const id of ids) {
      Queue.remove(id, sock.user.roomId)
    }

    // success
    acknowledge({ type: QUEUE_REMOVE + '_SUCCESS' })

    // tell room
    sock.server.to(Rooms.prefix(sock.user.roomId)).emit('action', {
      type: QUEUE_PUSH,
      payload: Queue.get(sock.user.roomId),
    })
  },
}

const moderateRequest = (
  sock,
  queueId: number,
  status: 'APPROVED' | 'REJECTED',
  acknowledge,
) => {
  const actionType = status === 'APPROVED' ? QUEUE_APPROVE : QUEUE_REJECT

  if (!sock.user.isAdmin) {
    return acknowledge({
      type: actionType + '_ERROR',
      error: 'Only administrators can moderate requests',
    })
  }

  Queue.moderate(sock.user.roomId, queueId, status)
  acknowledge({ type: actionType + '_SUCCESS' })
  sock.server.to(Rooms.prefix(sock.user.roomId)).emit('action', {
    type: QUEUE_PUSH,
    payload: Queue.get(sock.user.roomId),
  })
}

export default ACTION_HANDLERS

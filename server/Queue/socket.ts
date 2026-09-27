import Queue from './Queue.js'
import Rooms from '../Rooms/Rooms.js'
import { QUEUE_ADD, QUEUE_MOVE, QUEUE_REMOVE, QUEUE_PUSH } from '../../shared/actionTypes.js'
import { normalizeQueuePrefs } from '../../shared/queueRules.js'

const getPendingCount = (sock, roomId: number, userId: number): number => {
  const queue = Queue.get(roomId)
  const playerStatus = Rooms.getPlayerStatus(sock.server, roomId)
  const alreadyPlayed = new Set<number>()

  if (playerStatus?.historyJSON) {
    try {
      const history = JSON.parse(playerStatus.historyJSON)
      if (Array.isArray(history)) {
        for (const queueId of history) {
          if (Number.isInteger(queueId)) alreadyPlayed.add(queueId)
        }
      }
    } catch {
      // Ignore malformed player history and conservatively treat all queue items as pending.
    }
  }

  if (Number.isInteger(playerStatus?.queueId) && playerStatus.queueId >= 0) {
    alreadyPlayed.add(playerStatus.queueId)
  }

  return queue.result.filter((queueId) => {
    return !alreadyPlayed.has(queueId) && queue.entities[queueId].userId === userId
  }).length
}

// ------------------------------------
// Action Handlers
// ------------------------------------
const ACTION_HANDLERS = {
  [QUEUE_ADD]: async (sock, { payload }, acknowledge) => {
    const { songId } = payload
    const roomId = sock.user.roomId

    try {
      await Rooms.validate(roomId, null, { validatePassword: false })
    } catch (err) {
      return acknowledge({
        type: QUEUE_ADD + '_ERROR',
        error: err.message,
      })
    }

    const room = Rooms.get(roomId).entities[roomId]
    const maxPending = normalizeQueuePrefs(room?.prefs?.queue).maxPendingPerParticipant

    if (!sock.user.isAdmin) {
      const pendingCount = getPendingCount(sock, roomId, sock.user.userId)

      if (pendingCount >= maxPending) {
        return acknowledge({
          type: QUEUE_ADD + '_ERROR',
          error: `Maximum pending song requests reached (${maxPending})`,
        })
      }
    }

    Queue.add({
      roomId,
      songId,
      userId: sock.user.userId,
    })

    // success
    acknowledge({ type: QUEUE_ADD + '_SUCCESS' })

    // to all in room
    sock.server.to(Rooms.prefix(roomId)).emit('action', {
      type: QUEUE_PUSH,
      payload: Queue.get(roomId),
    })
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

    if (!sock.user.isAdmin && !(Queue.isOwner(sock.user.userId, queueId))) {
      return acknowledge({
        type: QUEUE_MOVE + '_ERROR',
        error: 'Cannot move another user\'s song',
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
      Queue.remove(id)
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

export default ACTION_HANDLERS

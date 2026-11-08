import Queue from './Queue.js'
import Rooms from '../Rooms/Rooms.js'
import { participation } from '../Tables/admission.js'
import {
  QUEUE_ADD,
  QUEUE_APPROVE,
  QUEUE_MOVE,
  QUEUE_REJECT,
  QUEUE_REMOVE,
  QUEUE_PUSH,
  QUEUE_CLEANUP,
  PLAYER_CMD_STOP,
} from '../../shared/actionTypes.js'
import { normalizeQueuePrefs } from '../../shared/queueRules.js'
import {
  QUEUE_ITEM_ORIGINS,
  SONG_SOURCES,
  type QueueItemOrigin,
  type SongSource,
} from '../../shared/queueLifecycle.js'
import { getSongSource } from '../SongSources/index.js'
import { cleanupQueue, cleanupReceipt } from './cleanup.js'
import Greetings from '../Greetings/Greetings.js'
import { requestIntent } from '../../shared/requestIntent.js'
import { db } from '../lib/Database.js'
import Animation from '../Animation/Animation.js'
import { clearedQueuePlayback } from '../../shared/queueCleanup.js'

// ------------------------------------
// Action Handlers
// ------------------------------------
const ACTION_HANDLERS = {
  [QUEUE_CLEANUP]: (sock, { payload }, acknowledge) => {
    if (!sock.user?.isAdmin) return acknowledge({ type: QUEUE_CLEANUP + '_ERROR', error: 'Solo los administradores pueden limpiar la cola' })
    if (!payload || !['pending', 'history'].includes(payload.operation) || typeof payload.requestId !== 'string'
      || !/^[a-zA-Z0-9-]{16,64}$/.test(payload.requestId) || !Number.isSafeInteger(payload.throughQueueId) || payload.throughQueueId < 0
      || (payload.checkOnly !== true && payload.confirmed !== true)) {
      return acknowledge({ type: QUEUE_CLEANUP + '_ERROR', error: 'Confirma una operación de limpieza válida' })
    }
    try {
      const roomId = sock.user.roomId
      const status = Rooms.getPlayerStatus(sock.server, roomId)
      const current = status?.isAtQueueEnd !== true && Number.isSafeInteger(status?.queueId) ? status.queueId : -1
      const previous = cleanupReceipt(roomId, sock.user.userId, payload)
      const result = payload.checkOnly === true ? previous : previous || cleanupQueue(roomId, sock.user.userId, payload, current)
      if (result?.operation === 'pending' && !previous && payload.checkOnly !== true) {
        // Receipt recovery must never stop a newer playback or repeat the clear.
        for (const player of sock.server.of('/').sockets.values()) {
          if (player.user?.roomId === roomId && player._lastPlayerStatus) {
            player._lastPlayerStatus = { ...player._lastPlayerStatus, ...clearedQueuePlayback }
          }
        }
        sock.server.to(Rooms.prefix(roomId)).emit('action', { type: PLAYER_CMD_STOP })
        Animation.cancel(roomId, 'Cola vaciada por el operador')
      }
      const queue = Queue.get(roomId)
      acknowledge({ type: QUEUE_CLEANUP + '_SUCCESS', payload: { found: !!result, result, queue } })
      if (result) sock.server.to(Rooms.prefix(roomId)).emit('action', { type: QUEUE_PUSH, payload: queue })
    } catch (error) {
      acknowledge({ type: QUEUE_CLEANUP + '_ERROR', error: (error as Error).message })
    }
  },
  [QUEUE_ADD]: async (sock, { payload }, acknowledge) => {
    const { songId } = payload
    const origin: QueueItemOrigin = payload.origin ?? 'PARTICIPANT'
    const source: SongSource = payload.source ?? 'LOCAL'
    const sourceId = String(payload.sourceId ?? songId ?? '')
    const roomId = sock.user.roomId
    const requestId = payload.requestId
    const replacesQueueId = payload.replacesQueueId
    if (replacesQueueId !== undefined && (!Number.isSafeInteger(replacesQueueId) || replacesQueueId <= 0 || !requestId || origin !== 'PARTICIPANT')) {
      return acknowledge({ type: QUEUE_ADD + '_ERROR', error: 'Seleccione un pedido fallido válido para reemplazar' })
    }
    const original = replacesQueueId === undefined ? undefined : Queue.get(roomId).entities[replacesQueueId]
    if (replacesQueueId !== undefined && (!original || (!sock.user.isAdmin && original.userId !== sock.user.userId))) {
      return acknowledge({ type: QUEUE_ADD + '_ERROR', error: 'No puedes reemplazar este pedido' })
    }
    const requestUserId = original?.userId ?? sock.user.userId

    if (requestId !== undefined && (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(requestId))) {
      return acknowledge({ type: QUEUE_ADD + '_ERROR', error: 'El identificador del pedido no es válido' })
    }

    const acknowledgeExisting = () => {
      if (!requestId) return false
      const receipt = Queue.getRequest(roomId, requestUserId, requestId)
      if (!receipt) return false
      const matches = receipt.source === source && receipt.origin === origin
        && (receipt.replacesQueueId ?? null) === (replacesQueueId ?? null)
        && (source === 'YOUTUBE' ? receipt.externalId : String(receipt.songId)) === sourceId
      acknowledge(matches
        ? { type: QUEUE_ADD + '_SUCCESS', payload: { requestId, queueId: receipt.queueId, status: receipt.status, queue: Queue.get(roomId), greetingId: receipt.greetingId, requestIntent: receipt.requestIntent } }
        : { type: QUEUE_ADD + '_ERROR', error: 'El identificador ya pertenece a otro pedido' })
      return true
    }

    if (!QUEUE_ITEM_ORIGINS.includes(origin)) {
      return acknowledge({
        type: QUEUE_ADD + '_ERROR',
        error: 'El origen de la canción no es válido',
      })
    }

    if (origin !== 'PARTICIPANT' && !sock.user.isAdmin) {
      return acknowledge({
        type: QUEUE_ADD + '_ERROR',
        error: 'Solo los administradores pueden agregar canciones de la casa o del operador',
      })
    }

    if (!SONG_SOURCES.includes(source)) {
      return acknowledge({
        type: QUEUE_ADD + '_ERROR',
        error: 'La fuente de la canción no es válida',
      })
    }

    if (acknowledgeExisting()) return

    if (replacesQueueId !== undefined) {
      try {
        Queue.getReplacement(roomId, requestUserId, replacesQueueId)
      } catch (error) {
        return acknowledge({ type: QUEUE_ADD + '_ERROR', error: (error as Error).message })
      }
    }

    const generation = Queue.cleanupGeneration(roomId)

    try {
      await Rooms.validate(roomId, null, { validatePassword: false })
    } catch (err) {
      return acknowledge({
        type: QUEUE_ADD + '_ERROR',
        error: err.message,
      })
    }

    let room = Rooms.get(roomId).entities[roomId]
    let queuePrefs = normalizeQueuePrefs(room?.prefs?.queue)
    const maxPending = queuePrefs.maxPendingPerParticipant

    if (!sock.user.isAdmin) {
      const pendingCount = Queue.countPending(roomId, sock.user.userId)

      if (pendingCount >= maxPending) {
        return acknowledge({
          type: QUEUE_ADD + '_ERROR',
          error: `Se alcanzó el máximo de solicitudes de canciones pendientes (${maxPending})`,
        })
      }
    }

    let song
    try {
      song = await getSongSource(source).resolve(sourceId, { roomId })
      if (!song || !song.isPlayable) throw new Error('La canción no está disponible o no se puede reproducir')
    } catch (err) {
      return acknowledge({
        type: QUEUE_ADD + '_ERROR',
        error: err.message,
      })
    }

    // Resolution is asynchronous: another request may have filled the last slot.
    // Receipt lookup, final validation and insert below run without an await.
    if (acknowledgeExisting()) return
    if (generation !== Queue.cleanupGeneration(roomId)) {
      return acknowledge({ type: QUEUE_ADD + '_ERROR', error: 'La cola se vació mientras se preparaba el pedido. Vuelve a solicitar la canción si aún la quieres.' })
    }
    room = Rooms.get(roomId).entities[roomId]
    if (!room) return acknowledge({ type: QUEUE_ADD + '_ERROR', error: 'La sala ya no está abierta' })
    queuePrefs = normalizeQueuePrefs(room.prefs?.queue)
    if (!sock.user.isAdmin && Queue.countPending(roomId, sock.user.userId) >= queuePrefs.maxPendingPerParticipant) {
      return acknowledge({ type: QUEUE_ADD + '_ERROR', error: `Se alcanzó el máximo de solicitudes de canciones pendientes (${queuePrefs.maxPendingPerParticipant})` })
    }

    const tableContext = participation(sock.user, { ...room, status: room.status ?? 'open' })
    if (payload.greeting !== undefined && (!requestId || origin !== 'PARTICIPANT')) throw new Error('El saludo debe acompañar a un pedido de participante')
    if (payload.greeting !== undefined) db.exec('SAVEPOINT request_greeting')
    try {
      const queueId = Queue.add({
        ...(tableContext.tableId ? { tableContext } : {}),
        roomId,
        song,
        userId: requestUserId,
        origin,
        ...(payload.requestIntent !== undefined ? { requestIntent: requestIntent(payload.requestIntent) } : {}),
        ...(requestId ? { requestId } : {}),
        ...(replacesQueueId !== undefined ? { replacesQueueId } : {}),
        status: origin === 'PARTICIPANT' && !sock.user.isAdmin && queuePrefs.approvalMode === 'MANUAL'
          ? 'PENDING_APPROVAL'
          : 'APPROVED',
      })
      if (payload.greeting !== undefined) Greetings.attach(sock.user, queueId, payload.greeting, Rooms.getPlayerStatus(sock.server, roomId) ?? {})
      if (payload.greeting !== undefined) db.exec('RELEASE request_greeting')
    } catch (error) {
      if (payload.greeting !== undefined) db.exec('ROLLBACK TO request_greeting; RELEASE request_greeting')
      const code = (error as { code?: string }).code
      if (code === 'MUSIC_BLOCKED' || code === 'KARAOKE_TITLE_REQUIRED') {
        return acknowledge({ type: QUEUE_ADD + '_ERROR', error: (error as Error).message, payload: { code } })
      }
      throw error
    }

    // success
    if (!acknowledgeExisting()) acknowledge({ type: QUEUE_ADD + '_SUCCESS' })

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
        error: 'Solo los administradores pueden mover canciones en la cola de reproducción',
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
        error: 'No puede quitar la canción de otro usuario',
      })
    }

    if (payload.withReceipt) {
      const queue = Queue.get(sock.user.roomId)
      if (ids.some(id => queue.entities[id] && !['PENDING_APPROVAL', 'APPROVED'].includes(queue.entities[id].status))) {
        return acknowledge({ type: QUEUE_REMOVE + '_ERROR', error: 'El pedido ya no se puede cancelar. Actualiza tus pedidos.' })
      }
    }

    for (const id of ids) {
      Queue.remove(id, sock.user.roomId)
    }

    // success
    acknowledge({ type: QUEUE_REMOVE + '_SUCCESS', ...(payload.withReceipt ? { payload: Queue.get(sock.user.roomId) } : {}) })

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
      error: 'Solo los administradores pueden aprobar o rechazar solicitudes',
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

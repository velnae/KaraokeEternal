import { useMemo, useSyncExternalStore } from 'react'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import store from 'store/store'
import socket from 'lib/socket'
import { QUEUE_ADD } from 'shared/actionTypes'
import { queuePush } from 'routes/Queue/modules/queue'
import { createRequestController } from 'routes/Participant/requests'

export function useSongRequests (origin: 'PARTICIPANT' | 'HOUSE' = 'PARTICIPANT') {
  const { roomId, userId } = useAppSelector(state => state.user)
  const dispatch = useAppDispatch()
  const controller = useMemo(() => createRequestController({
    storage: {
      getItem: key => window.sessionStorage.getItem(key),
      setItem: (key, value) => window.sessionStorage.setItem(key, value),
    },
    key: `karaoke-requests:${roomId}:${userId}${origin === 'HOUSE' ? ':house' : ''}`,
    makeId: () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join(''),
    send: async (sourceId, requestId, greeting) => {
      if (!socket.connected) throw new Error('offline')
      const response = await socket.timeout(12000).emitWithAck('action', {
        type: QUEUE_ADD, payload: { source: 'YOUTUBE', sourceId, origin, requestId, ...(greeting ? { greeting } : {}) },
      })
      const account = store.getState().user
      if (account.userId === userId && account.roomId === roomId && response.payload?.queue) {
        dispatch(queuePush(response.payload.queue))
      }
      return response
    },
  }), [roomId, userId, origin, dispatch])
  const receipts = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  return { controller, receipts }
}

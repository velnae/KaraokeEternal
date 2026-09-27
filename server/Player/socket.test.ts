import { afterEach, describe, expect, it, vi } from 'vitest'
import { PLAYER_EMIT_LEAVE, PLAYER_EMIT_STATUS, PLAYER_LEAVE, PLAYER_STATUS, QUEUE_PUSH } from '../../shared/actionTypes.js'
import Queue from '../Queue/Queue.js'
import Rooms from '../Rooms/Rooms.js'
import ACTION_HANDLERS from './socket.js'

const createSocket = ({ isAdmin = true } = {}) => {
  const emit = vi.fn()
  return {
    socket: {
      id: 'socket-1',
      user: { roomId: 1, userId: 10, isAdmin },
      server: { to: vi.fn(() => ({ emit })) },
      _lastPlayerStatus: null,
    },
    emit,
  }
}

describe('player queue lifecycle', () => {
  afterEach(() => vi.restoreAllMocks())

  it('rejects status reports from non-admin sockets', () => {
    const { socket } = createSocket({ isAdmin: false })

    expect(() => ACTION_HANDLERS[PLAYER_EMIT_STATUS](socket, { payload: {} })).toThrow('Only administrators')
  })

  it('persists player status and pushes the updated queue', () => {
    const payload = { queueId: 4, historyJSON: '[]' }
    const queue = { result: [4], entities: {} }
    const { socket, emit } = createSocket()
    vi.spyOn(Queue, 'syncPlayerLifecycle').mockReturnValue(true)
    vi.spyOn(Queue, 'get').mockReturnValue(queue)

    ACTION_HANDLERS[PLAYER_EMIT_STATUS](socket, { payload })

    expect(Queue.syncPlayerLifecycle).toHaveBeenCalledWith(1, payload)
    expect(socket._lastPlayerStatus).toBe(payload)
    expect(emit).toHaveBeenCalledWith('action', { type: QUEUE_PUSH, payload: queue })
    expect(emit).toHaveBeenCalledWith('action', { type: PLAYER_STATUS, payload })
  })

  it('requeues interrupted playback when the last player leaves', () => {
    const queue = { result: [4], entities: {} }
    const { socket, emit } = createSocket()
    socket._lastPlayerStatus = { queueId: 4 }
    vi.spyOn(Rooms, 'isPlayerPresent').mockReturnValue(false)
    vi.spyOn(Queue, 'requeuePlaying').mockReturnValue(true)
    vi.spyOn(Queue, 'get').mockReturnValue(queue)

    ACTION_HANDLERS[PLAYER_EMIT_LEAVE](socket)

    expect(Queue.requeuePlaying).toHaveBeenCalledWith(1)
    expect(emit).toHaveBeenCalledWith('action', { type: QUEUE_PUSH, payload: queue })
    expect(emit).toHaveBeenCalledWith('action', {
      type: PLAYER_LEAVE,
      payload: { socketId: 'socket-1' },
    })
  })
})

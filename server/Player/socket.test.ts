import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PLAYER_CMD_NEXT,
  PLAYER_CMD_OPTIONS,
  PLAYER_CMD_PAUSE,
  PLAYER_CMD_PLAY,
  PLAYER_CMD_REPLAY,
  PLAYER_CMD_VOLUME,
  PLAYER_EMIT_FAILURE,
  PLAYER_EMIT_LEAVE,
  PLAYER_EMIT_STATUS,
  PLAYER_AUTHORITY_AVAILABLE,
  PLAYER_AUTHORITY_DENIED,
  PLAYER_AUTHORITY_GRANTED,
  PLAYER_LEAVE,
  PLAYER_REQ_NEXT,
  PLAYER_REQ_OPTIONS,
  PLAYER_REQ_PAUSE,
  PLAYER_REQ_PLAY,
  PLAYER_REQ_REPLAY,
  PLAYER_REQ_VOLUME,
  PLAYER_STATUS,
  QUEUE_PUSH,
} from '../../shared/actionTypes.js'
import Queue from '../Queue/Queue.js'
import Rooms from '../Rooms/Rooms.js'
import ACTION_HANDLERS from './socket.js'

const createSocket = ({ isAdmin = true } = {}) => {
  const emit = vi.fn()
  const sockets = new Map()
  const server = {
    of: vi.fn(() => ({ sockets })),
    to: vi.fn(() => ({ emit })),
  }
  const socket = {
    id: 'socket-1',
    user: { roomId: 1, userId: 10, isAdmin },
    server,
    _isPlayerAuthoritative: false,
    _lastPlayerStatus: null as unknown,
  }
  sockets.set(socket.id, socket)

  return {
    socket,
    emit,
    sockets,
  }
}

describe('player queue lifecycle', () => {
  afterEach(() => vi.restoreAllMocks())

  it('rejects status reports from non-admin sockets', () => {
    const { socket } = createSocket({ isAdmin: false })
    const acknowledge = vi.fn()

    ACTION_HANDLERS[PLAYER_EMIT_STATUS](socket, { payload: {} }, acknowledge)

    expect(acknowledge).toHaveBeenCalledWith({
      type: PLAYER_EMIT_STATUS + '_ERROR',
      error: 'Only administrators can control playback',
    })
    expect(socket._lastPlayerStatus).toBeNull()
  })

  it('persists player status and pushes the updated queue', () => {
    const payload = { queueId: 4, historyJSON: '[]' }
    const queue = { result: [4], entities: {} }
    const { socket, emit } = createSocket()
    vi.spyOn(Queue, 'syncPlayerLifecycle').mockReturnValue(true)
    vi.spyOn(Queue, 'get').mockReturnValue(queue)
    const acknowledge = vi.fn()

    ACTION_HANDLERS[PLAYER_EMIT_STATUS](socket, { payload }, acknowledge)

    expect(Queue.syncPlayerLifecycle).toHaveBeenCalledWith(1, payload)
    expect(socket._isPlayerAuthoritative).toBe(true)
    expect(socket._lastPlayerStatus).toBe(payload)
    expect(acknowledge).toHaveBeenCalledWith({ type: PLAYER_AUTHORITY_GRANTED })
    expect(emit).toHaveBeenCalledWith('action', { type: QUEUE_PUSH, payload: queue })
    expect(emit).toHaveBeenCalledWith('action', { type: PLAYER_STATUS, payload })
  })

  it('keeps a second player non-authoritative', () => {
    const first = createSocket()
    first.socket._isPlayerAuthoritative = true
    const second = {
      ...first.socket,
      id: 'socket-2',
      _isPlayerAuthoritative: false,
      _lastPlayerStatus: null,
    }
    first.sockets.set(second.id, second)
    const acknowledge = vi.fn()
    const sync = vi.spyOn(Queue, 'syncPlayerLifecycle')

    ACTION_HANDLERS[PLAYER_EMIT_STATUS](second, { payload: { queueId: 5 } }, acknowledge)

    expect(acknowledge).toHaveBeenCalledWith({
      type: PLAYER_AUTHORITY_DENIED,
      payload: { message: 'Another player is already active in this room.' },
    })
    expect(sync).not.toHaveBeenCalled()
    expect(second._isPlayerAuthoritative).toBe(false)
  })

  it.each([
    PLAYER_REQ_OPTIONS,
    PLAYER_REQ_NEXT,
    PLAYER_REQ_PAUSE,
    PLAYER_REQ_PLAY,
    PLAYER_REQ_REPLAY,
    PLAYER_REQ_VOLUME,
  ])('rejects participant playback command %s', (actionType) => {
    const { socket, emit } = createSocket({ isAdmin: false })
    const acknowledge = vi.fn()

    ACTION_HANDLERS[actionType](socket, { payload: {} }, acknowledge)

    expect(emit).not.toHaveBeenCalled()
    expect(acknowledge).toHaveBeenCalledWith({
      type: actionType + '_ERROR',
      error: 'Only administrators can control playback',
    })
  })

  it.each([
    [PLAYER_REQ_OPTIONS, PLAYER_CMD_OPTIONS, { cdgAlpha: 0.4 }],
    [PLAYER_REQ_NEXT, PLAYER_CMD_NEXT, undefined],
    [PLAYER_REQ_PAUSE, PLAYER_CMD_PAUSE, undefined],
    [PLAYER_REQ_PLAY, PLAYER_CMD_PLAY, undefined],
    [PLAYER_REQ_REPLAY, PLAYER_CMD_REPLAY, { queueId: 4 }],
    [PLAYER_REQ_VOLUME, PLAYER_CMD_VOLUME, 0.5],
  ])('forwards authorized playback command %s', (requestType, commandType, payload) => {
    const { socket, emit } = createSocket()
    const acknowledge = vi.fn()

    ACTION_HANDLERS[requestType](socket, { payload }, acknowledge)

    expect(emit).toHaveBeenCalledWith('action', {
      type: commandType,
      ...(payload === undefined ? {} : { payload }),
    })
    expect(acknowledge).toHaveBeenCalledWith({ type: requestType + '_SUCCESS' })
  })

  it('requeues interrupted playback when the last player leaves', () => {
    const queue = { result: [4], entities: {} }
    const { socket, emit } = createSocket()
    socket._isPlayerAuthoritative = true
    socket._lastPlayerStatus = { queueId: 4 }
    vi.spyOn(Rooms, 'isPlayerPresent').mockReturnValue(false)
    vi.spyOn(Queue, 'requeuePlaying').mockReturnValue(true)
    vi.spyOn(Queue, 'get').mockReturnValue(queue)

    ACTION_HANDLERS[PLAYER_EMIT_LEAVE](socket, {}, vi.fn())

    expect(Queue.requeuePlaying).toHaveBeenCalledWith(1)
    expect(emit).toHaveBeenCalledWith('action', { type: QUEUE_PUSH, payload: queue })
    expect(emit).toHaveBeenCalledWith('action', {
      type: PLAYER_LEAVE,
      payload: { socketId: 'socket-1' },
    })
    expect(emit).toHaveBeenCalledWith('action', { type: PLAYER_AUTHORITY_AVAILABLE })
  })

  it('marks a failed item once and notifies the room with the persisted queue', () => {
    const queue = { result: [4, 5], entities: {} }
    const { socket, emit } = createSocket()
    socket._isPlayerAuthoritative = true
    const transition = vi.spyOn(Queue, 'transition')
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
    vi.spyOn(Queue, 'get').mockReturnValue(queue)
    const acknowledge = vi.fn()

    ACTION_HANDLERS[PLAYER_EMIT_FAILURE](socket, { payload: { queueId: 4, error: 'Unavailable' } }, acknowledge)
    ACTION_HANDLERS[PLAYER_EMIT_FAILURE](socket, { payload: { queueId: 4, error: 'Unavailable' } }, acknowledge)

    expect(transition).toHaveBeenCalledTimes(2)
    expect(transition).toHaveBeenCalledWith(1, 4, 'FAILED')
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('action', { type: QUEUE_PUSH, payload: queue })
    expect(acknowledge).toHaveBeenCalledWith({ type: PLAYER_EMIT_FAILURE + '_SUCCESS' })
  })

  it('rejects failure reports from non-admin sockets', () => {
    const { socket } = createSocket({ isAdmin: false })
    const acknowledge = vi.fn()

    ACTION_HANDLERS[PLAYER_EMIT_FAILURE](
      socket,
      { payload: { queueId: 4 } },
      acknowledge,
    )

    expect(acknowledge).toHaveBeenCalledWith({
      type: PLAYER_EMIT_FAILURE + '_ERROR',
      error: 'Only administrators can control playback',
    })
  })

  it('rejects failure reports from a non-authoritative admin player', () => {
    const { socket } = createSocket()
    const acknowledge = vi.fn()

    ACTION_HANDLERS[PLAYER_EMIT_FAILURE](
      socket,
      { payload: { queueId: 4 } },
      acknowledge,
    )

    expect(acknowledge).toHaveBeenCalledWith({
      type: PLAYER_AUTHORITY_DENIED,
      payload: { message: 'Another player is already active in this room.' },
    })
  })
})

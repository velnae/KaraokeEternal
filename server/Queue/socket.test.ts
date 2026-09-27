import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  QUEUE_ADD,
  QUEUE_APPROVE,
  QUEUE_PUSH,
  QUEUE_REJECT,
} from '../../shared/actionTypes.js'
import Rooms from '../Rooms/Rooms.js'
import Queue from './Queue.js'
import ACTION_HANDLERS from './socket.js'
import type { QueueItem } from '../../shared/types.js'

const handler = ACTION_HANDLERS[QUEUE_ADD]

const createSocket = ({ isAdmin = false } = {}) => {
  const emit = vi.fn()

  return {
    socket: {
      user: { roomId: 1, userId: 10, isAdmin },
      server: {
        to: vi.fn(() => ({ emit })),
      },
    },
    emit,
  }
}

const mockQueue = (userIds: number[]) => {
  const result = userIds.map((_, index) => index + 1)
  const entities: Record<number, QueueItem> = {}

  userIds.forEach((userId, index) => {
    const queueId = index + 1
    entities[queueId] = {
      queueId,
      songId: queueId,
      userId,
      prevQueueId: index,
      mediaId: queueId,
      rgTrackGain: 0,
      rgTrackPeak: 1,
      userDateUpdated: 0,
      userDisplayName: `User ${userId}`,
      mediaType: 'mp4',
      isVideoKeyingEnabled: false,
      origin: 'PARTICIPANT',
      source: 'LOCAL',
      status: 'APPROVED',
      externalId: null,
      title: `Song ${queueId}`,
      artistOrChannel: 'Artist',
      durationSeconds: 180,
      thumbnailUrl: null,
      dateCreated: 0,
      dateUpdated: 0,
    }
  })

  return { result, entities }
}

describe('participant pending request limit', () => {
  afterEach(() => vi.restoreAllMocks())

  it('rejects a participant at the configured pending limit', async () => {
    vi.spyOn(Rooms, 'validate').mockResolvedValue(true)
    vi.spyOn(Rooms, 'get').mockReturnValue({
      result: [1],
      entities: { 1: { prefs: { queue: { maxPendingPerParticipant: 2 } } } },
    })
    vi.spyOn(Queue, 'countPending').mockReturnValue(2)
    const add = vi.spyOn(Queue, 'add').mockImplementation(() => {})
    const acknowledge = vi.fn()
    const { socket } = createSocket()

    await handler(socket, { payload: { songId: 99 } }, acknowledge)

    expect(add).not.toHaveBeenCalled()
    expect(acknowledge).toHaveBeenCalledWith({
      type: QUEUE_ADD + '_ERROR',
      error: 'Maximum pending song requests reached (2)',
    })
  })

  it('creates an approved request in AUTO mode while below the pending limit', async () => {
    const queue = mockQueue([10, 10, 10, 20])
    vi.spyOn(Rooms, 'validate').mockResolvedValue(true)
    vi.spyOn(Rooms, 'get').mockReturnValue({
      result: [1],
      entities: { 1: { prefs: { queue: { maxPendingPerParticipant: 2, approvalMode: 'AUTO' } } } },
    })
    vi.spyOn(Queue, 'countPending').mockReturnValue(1)
    vi.spyOn(Queue, 'get').mockReturnValue(queue)
    const add = vi.spyOn(Queue, 'add').mockImplementation(() => {})
    const acknowledge = vi.fn()
    const { socket, emit } = createSocket()

    await handler(socket, { payload: { songId: 99 } }, acknowledge)

    expect(add).toHaveBeenCalledWith({
      roomId: 1,
      songId: 99,
      userId: 10,
      origin: 'PARTICIPANT',
      status: 'APPROVED',
    })
    expect(acknowledge).toHaveBeenCalledWith({ type: QUEUE_ADD + '_SUCCESS' })
    expect(emit).toHaveBeenCalledWith('action', {
      type: QUEUE_PUSH,
      payload: queue,
    })
  })

  it('uses the default limit and exempts admins', async () => {
    const queue = mockQueue([10, 10, 10])
    vi.spyOn(Rooms, 'validate').mockResolvedValue(true)
    vi.spyOn(Rooms, 'get').mockReturnValue({
      result: [1],
      entities: { 1: { prefs: {} } },
    })
    const countPending = vi.spyOn(Queue, 'countPending')
    vi.spyOn(Queue, 'get').mockReturnValue(queue)
    const add = vi.spyOn(Queue, 'add').mockImplementation(() => {})
    const acknowledge = vi.fn()
    const { socket } = createSocket({ isAdmin: true })

    await handler(socket, { payload: { songId: 99 } }, acknowledge)

    expect(add).toHaveBeenCalledOnce()
    expect(countPending).not.toHaveBeenCalled()
    expect(acknowledge).toHaveBeenCalledWith({ type: QUEUE_ADD + '_SUCCESS' })
  })

  it('creates participant requests pending in MANUAL mode', async () => {
    vi.spyOn(Rooms, 'validate').mockResolvedValue(true)
    vi.spyOn(Rooms, 'get').mockReturnValue({
      result: [1],
      entities: { 1: { prefs: { queue: { approvalMode: 'MANUAL' } } } },
    })
    vi.spyOn(Queue, 'countPending').mockReturnValue(0)
    vi.spyOn(Queue, 'get').mockReturnValue(mockQueue([]))
    const add = vi.spyOn(Queue, 'add').mockImplementation(() => {})
    const { socket } = createSocket()

    await handler(socket, { payload: { songId: 99 } }, vi.fn())

    expect(add).toHaveBeenCalledWith({
      roomId: 1,
      songId: 99,
      userId: 10,
      origin: 'PARTICIPANT',
      status: 'PENDING_APPROVAL',
    })
  })

  it('applies approval-mode changes only to newly created requests', async () => {
    vi.spyOn(Rooms, 'validate').mockResolvedValue(true)
    const getRoom = vi.spyOn(Rooms, 'get')
      .mockReturnValueOnce({ result: [1], entities: { 1: { prefs: { queue: { approvalMode: 'MANUAL' } } } } })
      .mockReturnValueOnce({ result: [1], entities: { 1: { prefs: { queue: { approvalMode: 'AUTO' } } } } })
    vi.spyOn(Queue, 'countPending').mockReturnValue(0)
    vi.spyOn(Queue, 'get').mockReturnValue(mockQueue([]))
    const add = vi.spyOn(Queue, 'add').mockImplementation(() => {})
    const moderate = vi.spyOn(Queue, 'moderate').mockImplementation(() => false)
    const { socket } = createSocket()

    await handler(socket, { payload: { songId: 98 } }, vi.fn())
    await handler(socket, { payload: { songId: 99 } }, vi.fn())

    expect(getRoom).toHaveBeenCalledTimes(2)
    expect(add.mock.calls.map(([request]) => request.status)).toEqual(['PENDING_APPROVAL', 'APPROVED'])
    expect(moderate).not.toHaveBeenCalled()
  })
})

describe('house and operator creation', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each(['HOUSE', 'OPERATOR'] as const)('allows an admin to create an approved %s item', async (origin) => {
    vi.spyOn(Rooms, 'validate').mockResolvedValue(true)
    vi.spyOn(Rooms, 'get').mockReturnValue({ result: [1], entities: { 1: { prefs: {} } } })
    vi.spyOn(Queue, 'get').mockReturnValue(mockQueue([]))
    const add = vi.spyOn(Queue, 'add').mockImplementation(() => {})
    const acknowledge = vi.fn()
    const { socket } = createSocket({ isAdmin: true })

    await handler(socket, { payload: { songId: 99, origin } }, acknowledge)

    expect(add).toHaveBeenCalledWith({
      roomId: 1,
      songId: 99,
      userId: 10,
      origin,
      status: 'APPROVED',
    })
    expect(acknowledge).toHaveBeenCalledWith({ type: QUEUE_ADD + '_SUCCESS' })
  })

  it.each(['HOUSE', 'OPERATOR'] as const)('denies non-admin creation of a %s item', async (origin) => {
    const add = vi.spyOn(Queue, 'add')
    const acknowledge = vi.fn()
    const { socket } = createSocket()

    await handler(socket, { payload: { songId: 99, origin } }, acknowledge)

    expect(add).not.toHaveBeenCalled()
    expect(acknowledge).toHaveBeenCalledWith({
      type: QUEUE_ADD + '_ERROR',
      error: 'Only administrators can create house or operator items',
    })
  })

  it('rejects an unknown queue origin', async () => {
    const add = vi.spyOn(Queue, 'add')
    const acknowledge = vi.fn()
    const { socket } = createSocket({ isAdmin: true })

    await handler(socket, { payload: { songId: 99, origin: 'SYSTEM' } }, acknowledge)

    expect(add).not.toHaveBeenCalled()
    expect(acknowledge).toHaveBeenCalledWith({
      type: QUEUE_ADD + '_ERROR',
      error: 'Invalid queue item origin',
    })
  })
})

describe('request moderation', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each([QUEUE_APPROVE, QUEUE_REJECT])('denies non-admin %s actions', (actionType) => {
    const moderate = vi.spyOn(Queue, 'moderate')
    const acknowledge = vi.fn()
    const { socket } = createSocket()

    ACTION_HANDLERS[actionType](socket, { payload: { queueId: 4 } }, acknowledge)

    expect(moderate).not.toHaveBeenCalled()
    expect(acknowledge).toHaveBeenCalledWith({
      type: actionType + '_ERROR',
      error: 'Only administrators can moderate requests',
    })
  })

  it.each([
    [QUEUE_APPROVE, 'APPROVED'],
    [QUEUE_REJECT, 'REJECTED'],
  ] as const)('allows an admin to process %s', (actionType, status) => {
    const queue = mockQueue([10])
    const moderate = vi.spyOn(Queue, 'moderate').mockReturnValue(true)
    vi.spyOn(Queue, 'get').mockReturnValue(queue)
    const acknowledge = vi.fn()
    const { socket, emit } = createSocket({ isAdmin: true })

    ACTION_HANDLERS[actionType](socket, { payload: { queueId: 4 } }, acknowledge)

    expect(moderate).toHaveBeenCalledWith(1, 4, status)
    expect(acknowledge).toHaveBeenCalledWith({ type: actionType + '_SUCCESS' })
    expect(emit).toHaveBeenCalledWith('action', { type: QUEUE_PUSH, payload: queue })
  })
})

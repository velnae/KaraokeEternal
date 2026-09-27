import { afterEach, describe, expect, it, vi } from 'vitest'
import { QUEUE_ADD, QUEUE_PUSH } from '../../shared/actionTypes.js'
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
    }
  })

  return { result, entities }
}

describe('participant pending request limit', () => {
  afterEach(() => vi.restoreAllMocks())

  it('rejects a participant at the configured pending limit', async () => {
    const queue = mockQueue([10, 10, 20])
    vi.spyOn(Rooms, 'validate').mockResolvedValue(true)
    vi.spyOn(Rooms, 'get').mockReturnValue({
      result: [1],
      entities: { 1: { prefs: { queue: { maxPendingPerParticipant: 2 } } } },
    })
    vi.spyOn(Rooms, 'getPlayerStatus').mockReturnValue(null)
    vi.spyOn(Queue, 'get').mockReturnValue(queue)
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

  it('excludes played and currently playing items from the pending count', async () => {
    const queue = mockQueue([10, 10, 10, 20])
    vi.spyOn(Rooms, 'validate').mockResolvedValue(true)
    vi.spyOn(Rooms, 'get').mockReturnValue({
      result: [1],
      entities: { 1: { prefs: { queue: { maxPendingPerParticipant: 2 } } } },
    })
    vi.spyOn(Rooms, 'getPlayerStatus').mockReturnValue({ historyJSON: '[1]', queueId: 2 })
    vi.spyOn(Queue, 'get').mockReturnValue(queue)
    const add = vi.spyOn(Queue, 'add').mockImplementation(() => {})
    const acknowledge = vi.fn()
    const { socket, emit } = createSocket()

    await handler(socket, { payload: { songId: 99 } }, acknowledge)

    expect(add).toHaveBeenCalledWith({ roomId: 1, songId: 99, userId: 10 })
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
    vi.spyOn(Rooms, 'getPlayerStatus').mockReturnValue(null)
    vi.spyOn(Queue, 'get').mockReturnValue(queue)
    const add = vi.spyOn(Queue, 'add').mockImplementation(() => {})
    const acknowledge = vi.fn()
    const { socket } = createSocket({ isAdmin: true })

    await handler(socket, { payload: { songId: 99 } }, acknowledge)

    expect(add).toHaveBeenCalledOnce()
    expect(acknowledge).toHaveBeenCalledWith({ type: QUEUE_ADD + '_SUCCESS' })
  })
})

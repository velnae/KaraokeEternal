import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  QUEUE_ADD,
  QUEUE_APPROVE,
  QUEUE_MOVE,
  QUEUE_REMOVE,
  QUEUE_PUSH,
  QUEUE_REJECT,
} from '../../shared/actionTypes.js'
import Rooms from '../Rooms/Rooms.js'
import Queue from './Queue.js'
import ACTION_HANDLERS from './socket.js'
import type { QueueItem } from '../../shared/types.js'
import type { ResolvedSong } from '../../shared/songSource.js'
import { localSongSource } from '../SongSources/LocalSongSource.js'
import { youtubeSongSource } from '../SongSources/YouTubeSongSource.js'

const handler = ACTION_HANDLERS[QUEUE_ADD]

const resolvedSong = (songId: number): ResolvedSong => ({
  source: 'LOCAL',
  sourceId: String(songId),
  localSongId: songId,
  externalId: null,
  mediaId: songId,
  mediaType: 'mp4',
  title: `Song ${songId}`,
  artistOrChannel: 'Artist',
  durationSeconds: 180,
  thumbnailUrl: null,
  isPlayable: true,
})

const resolvedYouTubeSong = (isPlayable = true): ResolvedSong => ({
  source: 'YOUTUBE',
  sourceId: 'AAAAAAAAAAA',
  localSongId: null,
  externalId: 'AAAAAAAAAAA',
  mediaId: null,
  mediaType: 'youtube',
  title: 'YouTube song',
  artistOrChannel: 'YouTube channel',
  durationSeconds: 180,
  thumbnailUrl: null,
  isPlayable,
})

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
  beforeEach(() => vi.spyOn(localSongSource, 'resolve').mockImplementation(async sourceId => resolvedSong(Number(sourceId))))
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
      song: resolvedSong(99),
      userId: 10,
      origin: 'PARTICIPANT',
      status: 'APPROVED',
    })
    expect(localSongSource.resolve).toHaveBeenCalledWith('99', { roomId: 1 })
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
      song: resolvedSong(99),
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
  beforeEach(() => vi.spyOn(localSongSource, 'resolve').mockImplementation(async sourceId => resolvedSong(Number(sourceId))))
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
      song: resolvedSong(99),
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

  it('rejects an unknown song source before queue creation', async () => {
    const add = vi.spyOn(Queue, 'add')
    const acknowledge = vi.fn()
    const { socket } = createSocket({ isAdmin: true })

    await handler(socket, { payload: { songId: 99, source: 'ARCHIVE' } }, acknowledge)

    expect(add).not.toHaveBeenCalled()
    expect(acknowledge).toHaveBeenCalledWith({
      type: QUEUE_ADD + '_ERROR',
      error: 'Invalid song source',
    })
  })

  it('rejects a local song that cannot be resolved', async () => {
    vi.mocked(localSongSource.resolve).mockResolvedValue(null)
    vi.spyOn(Rooms, 'validate').mockResolvedValue(true)
    vi.spyOn(Rooms, 'get').mockReturnValue({ result: [1], entities: { 1: { prefs: {} } } })
    const add = vi.spyOn(Queue, 'add')
    const acknowledge = vi.fn()
    const { socket } = createSocket({ isAdmin: true })

    await handler(socket, { payload: { songId: 404 } }, acknowledge)

    expect(add).not.toHaveBeenCalled()
    expect(acknowledge).toHaveBeenCalledWith({
      type: QUEUE_ADD + '_ERROR',
      error: 'Song is unavailable or not playable',
    })
  })
})

describe('YouTube request creation', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each([
    ['AUTO', 'APPROVED'],
    ['MANUAL', 'PENDING_APPROVAL'],
  ] as const)('resolves and creates a YouTube request in %s mode', async (approvalMode, status) => {
    vi.spyOn(youtubeSongSource, 'resolve').mockResolvedValue(resolvedYouTubeSong())
    vi.spyOn(Rooms, 'validate').mockResolvedValue(true)
    vi.spyOn(Rooms, 'get').mockReturnValue({ result: [1], entities: { 1: { prefs: { queue: { approvalMode } } } } })
    vi.spyOn(Queue, 'countPending').mockReturnValue(0)
    vi.spyOn(Queue, 'get').mockReturnValue(mockQueue([]))
    const add = vi.spyOn(Queue, 'add').mockImplementation(() => {})
    const acknowledge = vi.fn()
    const { socket } = createSocket()

    await handler(socket, { payload: { source: 'YOUTUBE', sourceId: 'AAAAAAAAAAA' } }, acknowledge)

    expect(youtubeSongSource.resolve).toHaveBeenCalledWith('AAAAAAAAAAA', { roomId: 1 })
    expect(add).toHaveBeenCalledWith({
      roomId: 1,
      song: resolvedYouTubeSong(),
      userId: 10,
      origin: 'PARTICIPANT',
      status,
    })
    expect(acknowledge).toHaveBeenCalledWith({ type: QUEUE_ADD + '_SUCCESS' })
  })

  it('rejects an unresolvable or non-embeddable YouTube video', async () => {
    vi.spyOn(youtubeSongSource, 'resolve')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(resolvedYouTubeSong(false))
    vi.spyOn(Rooms, 'validate').mockResolvedValue(true)
    vi.spyOn(Rooms, 'get').mockReturnValue({ result: [1], entities: { 1: { prefs: {} } } })
    vi.spyOn(Queue, 'countPending').mockReturnValue(0)
    const add = vi.spyOn(Queue, 'add')
    const { socket } = createSocket()

    for (const sourceId of ['BBBBBBBBBBB', 'CCCCCCCCCCC']) {
      const acknowledge = vi.fn()
      await handler(socket, { payload: { source: 'YOUTUBE', sourceId } }, acknowledge)
      expect(acknowledge).toHaveBeenCalledWith({
        type: QUEUE_ADD + '_ERROR',
        error: 'Song is unavailable or not playable',
      })
    }
    expect(add).not.toHaveBeenCalled()
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

describe('queue ordering permissions', () => {
  afterEach(() => vi.restoreAllMocks())

  it('does not allow a participant to move even their own item', async () => {
    vi.spyOn(Rooms, 'validate').mockResolvedValue(true)
    const move = vi.spyOn(Queue, 'move')
    const acknowledge = vi.fn()
    const { socket } = createSocket()

    await ACTION_HANDLERS[QUEUE_MOVE](
      socket,
      { payload: { queueId: 4, prevQueueId: 3 } },
      acknowledge,
    )

    expect(move).not.toHaveBeenCalled()
    expect(acknowledge).toHaveBeenCalledWith({
      type: QUEUE_MOVE + '_ERROR',
      error: 'Only administrators can move queue items',
    })
  })

  it('allows an administrator to move an approved item', async () => {
    const queue = mockQueue([10, 20])
    vi.spyOn(Rooms, 'validate').mockResolvedValue(true)
    const move = vi.spyOn(Queue, 'move').mockImplementation(() => {})
    vi.spyOn(Queue, 'get').mockReturnValue(queue)
    const acknowledge = vi.fn()
    const { socket, emit } = createSocket({ isAdmin: true })

    await ACTION_HANDLERS[QUEUE_MOVE](
      socket,
      { payload: { queueId: 2, prevQueueId: -1 } },
      acknowledge,
    )

    expect(move).toHaveBeenCalledWith({ queueId: 2, prevQueueId: -1, roomId: 1 })
    expect(acknowledge).toHaveBeenCalledWith({ type: QUEUE_MOVE + '_SUCCESS' })
    expect(emit).toHaveBeenCalledWith('action', { type: QUEUE_PUSH, payload: queue })
  })
})

describe('queue removal permissions', () => {
  afterEach(() => vi.restoreAllMocks())

  it('allows a participant to remove their own eligible request', () => {
    const queue = mockQueue([])
    vi.spyOn(Queue, 'isOwner').mockReturnValue(true)
    const remove = vi.spyOn(Queue, 'remove').mockImplementation(() => {})
    vi.spyOn(Queue, 'get').mockReturnValue(queue)
    const acknowledge = vi.fn()
    const { socket, emit } = createSocket()

    ACTION_HANDLERS[QUEUE_REMOVE](socket, { payload: { queueId: 4 } }, acknowledge)

    expect(remove).toHaveBeenCalledWith(4, 1)
    expect(acknowledge).toHaveBeenCalledWith({ type: QUEUE_REMOVE + '_SUCCESS' })
    expect(emit).toHaveBeenCalledWith('action', { type: QUEUE_PUSH, payload: queue })
  })

  it('does not allow a participant to remove another participant request', () => {
    vi.spyOn(Queue, 'isOwner').mockReturnValue(false)
    const remove = vi.spyOn(Queue, 'remove')
    const acknowledge = vi.fn()
    const { socket } = createSocket()

    ACTION_HANDLERS[QUEUE_REMOVE](socket, { payload: { queueId: 4 } }, acknowledge)

    expect(remove).not.toHaveBeenCalled()
    expect(acknowledge).toHaveBeenCalledWith({
      type: QUEUE_REMOVE + '_ERROR',
      error: 'Cannot remove another user\'s song',
    })
  })
})

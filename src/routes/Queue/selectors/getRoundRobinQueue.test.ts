import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueueItem } from '../../../../shared/types.js'
import type { QueuePrefs } from '../../../../shared/queueRules.js'
import { buildRoundRobinQueue } from './roundRobin'
import { houseInterleaving } from '../../../../shared/roundRobin'

beforeEach(() => vi.useFakeTimers({ now: 1000 }))
afterEach(() => vi.useRealTimers())

const item = (
  queueId: number,
  userId: number,
  status: QueueItem['status'] = 'APPROVED',
  origin: QueueItem['origin'] = 'PARTICIPANT',
  dateCreated: number = queueId,
): QueueItem => ({
  queueId,
  songId: queueId,
  userId,
  prevQueueId: queueId === 1 ? null : queueId - 1,
  mediaId: queueId,
  rgTrackGain: null,
  rgTrackPeak: null,
  userDateUpdated: 0,
  userDisplayName: `Singer ${queueId}`,
  mediaType: 'mp4',
  isVideoKeyingEnabled: false,
  origin,
  source: 'LOCAL',
  status,
  externalId: null,
  title: `Song ${queueId}`,
  artistOrChannel: 'Artist',
  durationSeconds: 180,
  thumbnailUrl: null,
  dateCreated,
  dateUpdated: queueId,
})

const prefs = (
  rotationMode: QueuePrefs['rotationMode'] = 'FAIR',
  maxSongsPerParticipantRound = 1,
  houseTracksBeforeParticipant = 0,
) => ({ rotationMode, maxSongsPerParticipantRound, houseTracksBeforeParticipant })

describe('approval eligibility in participant ordering', () => {
  it('includes approved requests and excludes pending requests', () => {
    const entities = {
      1: item(1, 10),
      2: item(2, 20, 'PENDING_APPROVAL'),
    }

    expect(buildRoundRobinQueue([1, 2], entities, [], -1, null, prefs()).result).toEqual([1])
  })

  it('never makes rejected or non-participant requests eligible', () => {
    const entities = {
      1: item(1, 10, 'REJECTED'),
      2: item(2, 20),
      3: item(3, 30, 'APPROVED', 'HOUSE'),
    }

    expect(buildRoundRobinQueue([1, 2, 3], entities, [], -1, null, prefs()).result).toEqual([2])
  })
})

describe('configurable participant ordering', () => {
  const entities = {
    1: item(1, 10),
    2: item(2, 10),
    3: item(3, 20),
    4: item(4, 20),
  }

  it('rotates one song per FAIR turn while preserving each participant order', () => {
    expect(buildRoundRobinQueue([1, 2, 3, 4], entities, [], -1, null, prefs('FAIR', 1)).result)
      .toEqual([1, 3, 2, 4])
  })

  it('keeps one song per FAIR turn even with legacy multi-song preferences', () => {
    expect(buildRoundRobinQueue([1, 2, 3, 4], entities, [], -1, null, prefs('FAIR', 2)).result)
      .toEqual([1, 3, 2, 4])
  })

  it('orders FIFO by creation time and queue id regardless of linked-list order', () => {
    const fifoEntities = {
      1: item(1, 10, 'APPROVED', 'PARTICIPANT', 30),
      2: item(2, 20, 'APPROVED', 'PARTICIPANT', 20),
      3: item(3, 10, 'APPROVED', 'PARTICIPANT', 10),
    }

    expect(buildRoundRobinQueue([1, 2, 3], fifoEntities, [], -1, null, prefs('FIFO')).result)
      .toEqual([3, 2, 1])
  })

  it('keeps an older waiting request ahead of a late participant', () => {
    const lateEntities = {
      1: item(1, 10, 'PLAYED'),
      2: item(2, 10),
      3: item(3, 20),
    }

    expect(buildRoundRobinQueue([1, 2, 3], lateEntities, [1], -1, null, prefs('FAIR', 1)).result)
      .toEqual([1, 2, 3])
  })

  it('preserves the locked next participant when a late participant arrives', () => {
    const lockedEntities = {
      1: item(1, 10, 'PLAYING'),
      2: item(2, 10),
      3: item(3, 20),
    }

    expect(buildRoundRobinQueue([1, 2, 3], lockedEntities, [], 1, 10, prefs('FAIR', 1)).result)
      .toEqual([1, 2, 3])
  })

  it('keeps current and locked items while a mode change recalculates only later items', () => {
    const modeEntities = {
      1: item(1, 10, 'PLAYING'),
      2: item(2, 10),
      3: item(3, 20),
      4: item(4, 20),
      5: item(5, 30),
    }
    const fair = buildRoundRobinQueue([1, 2, 3, 4, 5], modeEntities, [], 1, 20, prefs('FAIR', 1)).result
    const fifo = buildRoundRobinQueue([1, 2, 3, 4, 5], modeEntities, [], 1, 20, prefs('FIFO')).result

    expect(fair.slice(0, 2)).toEqual([1, 3])
    expect(fifo.slice(0, 2)).toEqual([1, 3])
    expect(fair).toEqual([1, 3, 2, 5, 4])
    expect(fifo).toEqual([1, 3, 2, 4, 5])
  })
})

describe('house and operator ordering', () => {
  it('disables house interleaving when the configured value is zero', () => {
    const entities = {
      1: item(1, 10),
      2: item(2, 99, 'APPROVED', 'HOUSE'),
      3: item(3, 20),
    }

    expect(buildRoundRobinQueue([1, 2, 3], entities, [], -1, null, prefs('FAIR', 1, 0)).result)
      .toEqual([1, 3])
  })

  it.each([
    { available: 2, expected: [1, 3, 2] },
    { available: 1, expected: [1, 3, 2] },
    { available: 3, expected: [1, 3, 2] },
  ])('interleaves at most one house item when $available are available', ({ available, expected }) => {
    const entities: Record<number, QueueItem> = {
      1: item(1, 10),
      2: item(2, 20),
    }
    const result = [1]

    for (let index = 0; index < available; index++) {
      const queueId = index + 3
      entities[queueId] = item(queueId, 99, 'APPROVED', 'HOUSE')
      result.push(queueId)
    }
    result.push(2)

    expect(buildRoundRobinQueue(result, entities, [], -1, null, prefs('FAIR', 1, 2)).result)
      .toEqual(expected)
  })

  it('prioritizes the first participant and uses house music when no participants wait', () => {
    const entities = {
      1: item(1, 99, 'APPROVED', 'HOUSE'),
      2: item(2, 10),
    }

    expect(buildRoundRobinQueue([1, 2], entities, [], -1, null, prefs('FAIR', 1, 2)).result)
      .toEqual([2])
    expect(buildRoundRobinQueue([1], { 1: entities[1] }, [], -1, null, prefs('FAIR', 1, 2)).result)
      .toEqual([1])
  })

  it('does not let house items alter participant fairness history', () => {
    const entities: Record<number, QueueItem> = {
      1: item(1, 10, 'PLAYED'),
      2: item(2, 99, 'PLAYED', 'HOUSE'),
      3: item(3, 10),
      4: item(4, 20),
      5: item(5, 99, 'APPROVED', 'HOUSE'),
    }

    const ordered = buildRoundRobinQueue([1, 2, 3, 4, 5], entities, [1, 2], -1, null, prefs('FAIR', 1, 1)).result

    expect(ordered).toEqual([1, 2, 3, 5, 4])
    expect(ordered.filter(queueId => entities[queueId].origin === 'PARTICIPANT')).toEqual([1, 3, 4])
  })

  it('preserves operator positions without adding them to participant turns', () => {
    const entities = {
      1: item(1, 10),
      2: item(2, 99, 'APPROVED', 'OPERATOR'),
      3: item(3, 20),
      4: item(4, 30, 'APPROVED', 'OPERATOR'),
    }

    expect(buildRoundRobinQueue([1, 2, 3, 4], entities, [], -1, null, prefs()).result)
      .toEqual([1, 2, 3, 4])
    expect(buildRoundRobinQueue([4, 1, 2, 3], entities, [], -1, null, prefs()).result)
      .toEqual([4, 1, 2, 3])
  })
})

describe('customer waiting guarantees', () => {
  it('serves an old Juan request despite a stream of first-time participants', () => {
    const entities = { 1: item(1, 10, 'PLAYED'), 2: item(2, 10) } as Record<number, QueueItem>
    const result = [1, 2]
    for (let id = 3; id < 23; id++) {
      entities[id] = item(id, id * 10)
      result.push(id)
      expect(buildRoundRobinQueue(result, entities, [1], -1, null, prefs()).turns[0].ids).toEqual([2])
    }
  })

  it('returns a served participant to the tail and reconstructs the same order after reconnect', () => {
    const entities = { 1: item(1, 10, 'PLAYED'), 2: item(2, 10), 3: item(3, 20), 4: item(4, 30) }
    entities[1].dateUpdated = 10
    expect(buildRoundRobinQueue([1, 2, 3, 4], entities, [1], -1, null, prefs(), 11).turns.map(turn => turn.ids))
      .toEqual([[3], [4], [2]])
  })

  it('does not count a failed attempt as a served turn', () => {
    const entities = { 1: item(1, 10, 'FAILED'), 2: item(2, 10), 3: item(3, 20) }
    entities[1].dateUpdated = 100
    expect(buildRoundRobinQueue([1, 2, 3], entities, [1], -1, null, prefs(), 101).turns[0].ids).toEqual([2])
  })

  it('puts a completed turn behind a customer who arrived in the same timestamp second', () => {
    const entities = { 1: item(1, 10, 'PLAYED'), 2: item(2, 10), 3: item(3, 20, 'APPROVED', 'PARTICIPANT', 100) }
    entities[1].dateUpdated = 100
    expect(buildRoundRobinQueue([1, 2, 3], entities, [1], 1, null, prefs(), 100).turns.map(turn => turn.ids)).toEqual([[3], [2]])
  })

  it.each([
    { count: 2, wait: 599, limit: 1, reason: null },
    { count: 3, wait: 599, limit: 0, reason: 'backlog' },
    { count: 1, wait: 600, limit: 0, reason: 'wait' },
  ])('applies the house policy for $count requests waiting $wait seconds', ({ count, wait, limit, reason }) => {
    const pending = Array.from({ length: count }, (_, index) => item(index + 1, index + 1, 'APPROVED', 'PARTICIPANT', 1000))
    expect(houseInterleaving(pending, 1000 + wait, 2)).toEqual({ limit, reason, pendingCount: count })
  })

  it('excludes pending approval and current playback from demand and preserves the house pool', () => {
    const entities = { 1: item(1, 10, 'PLAYING'), 2: item(2, 20), 3: item(3, 30, 'PENDING_APPROVAL'), 4: item(4, 99, 'APPROVED', 'HOUSE') }
    const queue = buildRoundRobinQueue([1, 2, 3, 4], entities, [], 1, 20, prefs('FAIR', 1, 2), 5)
    expect(queue.housePolicy.pendingCount).toBe(1)
    expect(queue.result).toEqual([1, 4, 2])
    expect(entities[4].status).toBe('APPROVED')
  })

  it('resumes house interleaving as demand shrinks and suppresses it again when projected waiting exceeds ten minutes', () => {
    const entities = { 1: item(1, 10, 'PLAYED'), 2: item(2, 20), 3: item(3, 30), 4: item(4, 40), 5: item(5, 99, 'APPROVED', 'HOUSE'), 6: item(6, 99, 'APPROVED', 'HOUSE') }
    const queue = buildRoundRobinQueue([1, 2, 3, 4, 5, 6], entities, [1], 1, null, prefs('FAIR', 1, 2), 100)
    expect(queue.result).toEqual([1, 2, 5, 3, 4])
    expect(queue.housePolicy.reason).toBe('backlog')
  })
})

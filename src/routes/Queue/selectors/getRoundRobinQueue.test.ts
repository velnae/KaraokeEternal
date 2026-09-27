import { describe, expect, it } from 'vitest'
import type { QueueItem } from '../../../../shared/types.js'
import type { QueuePrefs } from '../../../../shared/queueRules.js'
import { buildRoundRobinQueue } from './roundRobin'

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

  it('plays multiple songs per FAIR turn up to the configured limit', () => {
    expect(buildRoundRobinQueue([1, 2, 3, 4], entities, [], -1, null, prefs('FAIR', 2)).result)
      .toEqual([1, 2, 3, 4])
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

  it('gives a late participant the next unlocked FAIR turn', () => {
    const lateEntities = {
      1: item(1, 10, 'PLAYED'),
      2: item(2, 10),
      3: item(3, 20),
    }

    expect(buildRoundRobinQueue([1, 2, 3], lateEntities, [1], -1, null, prefs('FAIR', 1)).result)
      .toEqual([1, 3, 2])
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
    expect(fair).toEqual([1, 3, 5, 2, 4])
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
    { available: 2, expected: [1, 3, 4, 2] },
    { available: 1, expected: [1, 3, 2] },
    { available: 3, expected: [1, 3, 4, 2] },
  ])('interleaves up to two house items when $available are available', ({ available, expected }) => {
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

  it('never inserts house items before the first participant or without participants', () => {
    const entities = {
      1: item(1, 99, 'APPROVED', 'HOUSE'),
      2: item(2, 10),
    }

    expect(buildRoundRobinQueue([1, 2], entities, [], -1, null, prefs('FAIR', 1, 2)).result)
      .toEqual([2])
    expect(buildRoundRobinQueue([1], { 1: entities[1] }, [], -1, null, prefs('FAIR', 1, 2)).result)
      .toEqual([])
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

    expect(ordered).toEqual([1, 2, 4, 5, 3])
    expect(ordered.filter(queueId => entities[queueId].origin === 'PARTICIPANT')).toEqual([1, 4, 3])
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

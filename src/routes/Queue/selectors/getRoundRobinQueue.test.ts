import { describe, expect, it } from 'vitest'
import type { QueueItem } from '../../../../shared/types.js'
import { buildRoundRobinQueue } from './roundRobin'

const item = (queueId: number, status: QueueItem['status']): QueueItem => ({
  queueId,
  songId: queueId,
  userId: queueId,
  prevQueueId: queueId === 1 ? null : queueId - 1,
  mediaId: queueId,
  rgTrackGain: null,
  rgTrackPeak: null,
  userDateUpdated: 0,
  userDisplayName: `Singer ${queueId}`,
  mediaType: 'mp4',
  isVideoKeyingEnabled: false,
  origin: 'PARTICIPANT',
  source: 'LOCAL',
  status,
  externalId: null,
  title: `Song ${queueId}`,
  artistOrChannel: 'Artist',
  durationSeconds: 180,
  thumbnailUrl: null,
  dateCreated: queueId,
  dateUpdated: queueId,
})

describe('approval eligibility in participant ordering', () => {
  it('includes approved requests and excludes pending requests', () => {
    const entities = {
      1: item(1, 'APPROVED'),
      2: item(2, 'PENDING_APPROVAL'),
    }

    expect(buildRoundRobinQueue([1, 2], entities, [], -1, null).result).toEqual([1])
  })

  it('never makes rejected requests eligible', () => {
    const entities = {
      1: item(1, 'REJECTED'),
      2: item(2, 'APPROVED'),
    }

    expect(buildRoundRobinQueue([1, 2], entities, [], -1, null).result).toEqual([2])
  })
})

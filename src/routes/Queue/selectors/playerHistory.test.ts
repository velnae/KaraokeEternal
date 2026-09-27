import { describe, expect, it } from 'vitest'
import type { QueueItem } from '../../../../shared/types.js'
import { buildPlayerHistory } from './playerHistory'

const item = (queueId: number, dateUpdated: number): QueueItem => ({
  queueId,
  songId: queueId,
  userId: queueId,
  prevQueueId: null,
  mediaId: queueId,
  rgTrackGain: null,
  rgTrackPeak: null,
  userDateUpdated: 0,
  userDisplayName: 'Singer',
  mediaType: 'mp4',
  isVideoKeyingEnabled: false,
  origin: 'PARTICIPANT',
  source: 'LOCAL',
  status: 'PLAYED',
  externalId: null,
  title: `Song ${queueId}`,
  artistOrChannel: 'Artist',
  durationSeconds: 180,
  thumbnailUrl: null,
  dateCreated: queueId,
  dateUpdated,
})

describe('player history reconstruction', () => {
  it('reconstructs persisted playback chronology after reconnect', () => {
    const entities = { 1: item(1, 30), 2: item(2, 10), 3: item(3, 20) }

    expect(buildPlayerHistory('[]', [1, 2, 3], entities)).toEqual([2, 3, 1])
  })

  it('preserves active player order over persisted tie ordering', () => {
    const entities = { 1: item(1, 10), 2: item(2, 10), 3: item(3, 5) }

    expect(buildPlayerHistory('[2,1]', [1, 2, 3], entities)).toEqual([3, 2, 1])
  })
})

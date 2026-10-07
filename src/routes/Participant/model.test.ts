import { describe, expect, it } from 'vitest'
import type { QueueItem } from '../../../shared/types'
import { estimatedWait, isPendingRequest, karaokeQuery, requestPriority } from './model'

const item = (props: Partial<QueueItem>) => ({ origin: 'PARTICIPANT', ...props }) as QueueItem

describe('participant guidance', () => {
  it('counts approved and waiting requests but releases played, rejected and playing slots', () => {
    expect(['PENDING_APPROVAL', 'APPROVED', 'PLAYING', 'PLAYED', 'REJECTED', 'FAILED', 'REMOVED']
      .filter(status => isPendingRequest(item({ status: status as QueueItem['status'] })))).toEqual(['PENDING_APPROVAL', 'APPROVED'])
    expect(isPendingRequest(item({ status: 'APPROVED', origin: 'HOUSE' }))).toBe(false)
  })
  it('withholds estimates when any intervening duration is unknown', () => {
    expect(estimatedWait([item({ queueId: 1, durationSeconds: 180 }), item({ durationSeconds: null })], 1, 60)).toBeNull()
    expect(estimatedWait([item({ queueId: 1, durationSeconds: 180 }), item({ durationSeconds: 60 })], 1, 60)).toBe(3)
    expect(estimatedWait([item({ queueId: 1, durationSeconds: 180 })], 1, 200)).toBe(0)
  })
  it('makes karaoke filtering optional without duplicating the search term', () => {
    expect(karaokeQuery('  Song  ', true)).toBe('Song karaoke')
    expect(karaokeQuery('Song Karaoke', true)).toBe('Song Karaoke')
    expect(karaokeQuery('Song', false)).toBe('Song')
  })
  it('puts the current song before upcoming requests and past outcomes', () => {
    const items = ['FAILED', 'APPROVED', 'PLAYING', 'REJECTED'].map(status => item({ status: status as QueueItem['status'] }))
    expect(items.sort((a, b) => requestPriority(b) - requestPriority(a)).map(entry => entry.status)).toEqual(['PLAYING', 'APPROVED', 'FAILED', 'REJECTED'])
  })
})

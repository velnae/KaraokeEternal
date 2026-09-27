import { describe, expect, it } from 'vitest'
import { canTransitionQueueItem, isQueueItemStatus } from './queueLifecycle.js'

describe('queue item lifecycle', () => {
  it.each([
    ['PENDING_APPROVAL', 'APPROVED'],
    ['PENDING_APPROVAL', 'REJECTED'],
    ['APPROVED', 'PLAYING'],
    ['APPROVED', 'PLAYED'],
    ['PLAYING', 'APPROVED'],
    ['PLAYING', 'PLAYED'],
    ['PLAYING', 'FAILED'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(canTransitionQueueItem(from, to)).toBe(true)
  })

  it('makes repeated transitions idempotent', () => {
    expect(canTransitionQueueItem('PLAYING', 'PLAYING')).toBe(true)
    expect(canTransitionQueueItem('PLAYED', 'PLAYED')).toBe(true)
  })

  it.each([
    ['PLAYED', 'APPROVED'],
    ['REJECTED', 'APPROVED'],
    ['REMOVED', 'APPROVED'],
    ['FAILED', 'PLAYING'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(canTransitionQueueItem(from, to)).toBe(false)
  })

  it('recognizes only supported statuses', () => {
    expect(isQueueItemStatus('APPROVED')).toBe(true)
    expect(isQueueItemStatus('UNKNOWN')).toBe(false)
    expect(isQueueItemStatus(null)).toBe(false)
  })
})

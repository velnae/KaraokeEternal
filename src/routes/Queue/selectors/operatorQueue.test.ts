import { expect, it } from 'vitest'
import type { QueueItem } from '../../../../shared/types'
import { operatorQueue } from './operatorQueue'

const item = (queueId: number, status: QueueItem['status'], overrides: Partial<QueueItem> = {}) => ({ queueId, status, songId: 1, ...overrides }) as QueueItem

it('places current first, keeps scheduled order, and appends completed plays', () => {
  const entities = { 1: item(1, 'PLAYED'), 2: item(2, 'PLAYING'), 3: item(3, 'APPROVED'), 4: item(4, 'APPROVED') }
  expect(operatorQueue([1, 2, 4, 3], entities, [1], 2, false)).toEqual([2, 4, 3, 1])
})

it('rotates A B C into B C A and then C A B as playback advances', () => {
  const entities = { 1: item(1, 'PLAYING'), 2: item(2, 'APPROVED'), 3: item(3, 'APPROVED') }
  expect(operatorQueue([1, 2, 3], entities, [], 1, false)).toEqual([1, 2, 3])
  entities[1].status = 'PLAYED'
  entities[2].status = 'PLAYING'
  expect(operatorQueue([1, 2, 3], entities, [1], 2, false)).toEqual([2, 3, 1])
  entities[2].status = 'PLAYED'
  entities[3].status = 'PLAYING'
  expect(operatorQueue([1, 2, 3], entities, [1, 2], 3, false)).toEqual([3, 1, 2])
})

it('uses completion order rather than insertion order and never duplicates a replayed current item', () => {
  const entities = { 1: item(1, 'PLAYED'), 2: item(2, 'PLAYED'), 3: item(3, 'PLAYED'), 4: item(4, 'APPROVED') }
  expect(operatorQueue([3, 2, 1, 4], entities, [3, 2, 1], 2, false)).toEqual([2, 4, 3, 1])
})

it('keeps new repeated entries upcoming even when they refer to the same song', () => {
  const entities = { 1: item(1, 'PLAYED'), 2: item(2, 'PLAYING'), 3: item(3, 'APPROVED') }
  expect(operatorQueue([1, 2, 3], entities, [1], 2, false)).toEqual([2, 3, 1])
})

it('shows completed entries at queue end, including transient completion before persistence', () => {
  const entities = { 1: item(1, 'APPROVED'), 2: item(2, 'PENDING_APPROVAL'), 3: item(3, 'FAILED'), 4: item(4, 'APPROVED') }
  expect(operatorQueue([3, 1, 4], entities, [3, 1], 1, true)).toEqual([4, 3, 1])
  expect(operatorQueue([], {}, [], -1, true)).toEqual([])
})

it('retains failed recovery entries, respects cleanup and ignores absent history items', () => {
  const entities = { 1: item(1, 'PLAYED', { historyClearedAt: 1 }), 2: item(2, 'FAILED') }
  expect(operatorQueue([1, 2], entities, [1, 2, 99], -1, true)).toEqual([2])
  expect(operatorQueue([1, 2], entities, [1, 2], 1, false)).toEqual([1, 2])
})

import { expect, it } from 'vitest'
import { shuffleOrder } from './shuffleOrder'

it('produces a complete permutation without changing the saved input', () => {
  const ids = [11, 22, 33, 44]
  const order = shuffleOrder(ids, () => 0)
  expect(order).not.toEqual(ids)
  expect([...order].sort()).toEqual(ids)
  expect(ids).toEqual([11, 22, 33, 44])
})

it('handles empty and single-song lists', () => {
  expect(shuffleOrder([])).toEqual([])
  expect(shuffleOrder([11])).toEqual([11])
})

import { expect, it } from 'vitest'
import { sceneCue } from 'shared/eventScenes'
import { timelineRows } from './timelineRows'

it('stacks overlapping text and reuses a subrow after its preceding element ends', () => {
  const a = { ...sceneCue('text', 'text'), id: 'a' }
  const b = { ...a, id: 'b' }
  const c = { ...a, id: 'c' }
  const layout = timelineRows([a, b, c], [{ ...a, startMs: 0, endMs: 4000 }, { ...b, startMs: 0, endMs: 4000 }, { ...c, startMs: 4000, endMs: 5000 }])
  expect(layout).toEqual({ positions: { a: 0, b: 1, c: 0 }, count: 2 })
})

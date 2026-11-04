import { expect, it } from 'vitest'
import { videoRange } from './stream.js'

it.each([
  ['bytes=0-3', 0, 3], ['bytes=4-', 4, 9], ['bytes=-3', 7, 9], ['bytes=-100', 0, 9],
  ['bytes=0-100', 0, 9], ['bytes=9-9', 9, 9], ['bytes=0-999999999999999999999999999', 0, 9],
])('serves bounded single ranges: %s', (header, start, end) => {
  expect(videoRange(header as string, 10)).toEqual({ start, end })
})
it.each(['bytes=10-', 'bytes=4-3', 'bytes=-0', 'bytes=-', 'bytes=a-4'])('rejects unsatisfiable ranges: %s', (header) => {
  expect(() => videoRange(header, 10)).toThrow(expect.objectContaining({ status: 416 }))
})
it('ignores unsupported units and multi-ranges instead of corrupting the response', () => {
  expect(videoRange('', 10)).toBeNull()
  expect(videoRange('items=0-1', 10)).toBeNull()
  expect(videoRange('bytes=0-1,4-5', 10)).toBeNull()
})

import { describe, expect, it } from 'vitest'
import { selectPlayerKind } from './playerSelection.js'

describe('player selection', () => {
  it.each([
    ['LOCAL', 'cdg', false, 'cdg'],
    ['LOCAL', 'mp4', false, 'mp4'],
    ['LOCAL', 'mp4', true, 'mp4-alpha'],
    ['YOUTUBE', 'youtube', false, 'youtube'],
  ] as const)('selects %s/%s playback', (source, mediaType, keying, expected) => {
    expect(selectPlayerKind(source, mediaType, keying)).toBe(expected)
  })

  it('does not silently select a player for an invalid combination', () => {
    expect(selectPlayerKind('LOCAL', 'youtube', false)).toBeNull()
    expect(selectPlayerKind(undefined, 'mp4', false)).toBeNull()
  })
})

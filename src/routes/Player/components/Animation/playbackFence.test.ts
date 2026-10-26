import { describe, expect, it } from 'vitest'
import { hasLocalPlaybackProof } from './playbackFence'

describe('local playback proof', () => {
  const intervention = { interventionId: 'announcement-1', ownerSocketId: 'player-1' }

  it('mounts safely before both the snapshot and socket identity exist', () => {
    expect(hasLocalPlaybackProof(undefined, undefined, new Set())).toBe(false)
  })

  it('does not bypass the fence without an intervention or connected identity', () => {
    const settled = new Set([intervention.interventionId])
    expect(hasLocalPlaybackProof(undefined, 'player-1', settled)).toBe(false)
    expect(hasLocalPlaybackProof(intervention, undefined, settled)).toBe(false)
    expect(hasLocalPlaybackProof({ ...intervention, ownerSocketId: null }, undefined, settled)).toBe(false)
  })

  it('keeps the fence for a successor socket even with a locally remembered ID', () => {
    expect(hasLocalPlaybackProof(intervention, 'player-2', new Set([intervention.interventionId]))).toBe(false)
  })

  it('only bypasses the fence for an owned, locally settled intervention', () => {
    expect(hasLocalPlaybackProof(intervention, 'player-1', new Set())).toBe(false)
    expect(hasLocalPlaybackProof(intervention, 'player-1', new Set([intervention.interventionId]))).toBe(true)
  })
})

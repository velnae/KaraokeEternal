import { describe, expect, it } from 'vitest'
import {
  appendCompletedToHistory,
  claimPlaybackSettlement,
  playbackToken,
  settlePlayback,
  type PlaybackSettlementState,
} from './playbackSettlement.js'

describe('playback settlement', () => {
  it('allows a YouTube end callback to advance only once', () => {
    const state: PlaybackSettlementState = { token: null, outcome: null }
    const token = playbackToken(12, 0)

    expect(claimPlaybackSettlement(state, token, 'ENDED')).toBe(true)
    expect(claimPlaybackSettlement(state, token, 'ENDED')).toBe(false)
    expect(state).toEqual({ token, outcome: 'ENDED' })
  })

  it('prevents a repeated error or late end callback from settling the same playback twice', () => {
    const state: PlaybackSettlementState = { token: null, outcome: null }
    const token = playbackToken(13, 0)
    const calls: string[] = []
    const handlers = {
      onFailure: () => calls.push('FAILED'),
      onAdvance: (includeCurrent: boolean) => calls.push(`ADVANCE:${includeCurrent}`),
    }

    expect(settlePlayback(state, token, 'FAILED', handlers)).toBe(true)
    expect(settlePlayback(state, token, 'FAILED', handlers)).toBe(false)
    expect(settlePlayback(state, token, 'ENDED', handlers)).toBe(false)
    expect(calls).toEqual(['FAILED', 'ADVANCE:false'])
  })

  it('permits a new replay token and keeps failed items out of played history', () => {
    const state: PlaybackSettlementState = { token: null, outcome: null }

    expect(claimPlaybackSettlement(state, playbackToken(14, 0), 'FAILED')).toBe(true)
    expect(claimPlaybackSettlement(state, playbackToken(14, 123), 'ENDED')).toBe(true)
    expect(appendCompletedToHistory('[1,2]', undefined)).toBe('[1,2]')
    expect(appendCompletedToHistory('[1,2]', 14)).toBe('[1,2,14]')
    expect(appendCompletedToHistory('invalid', 14)).toBe('[14]')
  })
})

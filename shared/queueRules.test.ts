import { describe, expect, it } from 'vitest'
import {
  getQueuePrefsValidationError,
  normalizeQueuePrefs,
  QUEUE_PREF_DEFAULTS,
} from './queueRules.js'

describe('queue room preferences', () => {
  it('supplies every default for missing preferences', () => {
    expect(normalizeQueuePrefs(undefined)).toEqual(QUEUE_PREF_DEFAULTS)
    expect(normalizeQueuePrefs({})).toEqual(QUEUE_PREF_DEFAULTS)
  })

  it('preserves valid configured values', () => {
    const prefs = {
      maxPendingPerParticipant: 20,
      maxSongsPerParticipantRound: 5,
      houseTracksBeforeParticipant: 0,
      approvalMode: 'MANUAL',
      rotationMode: 'FIFO',
    }

    expect(getQueuePrefsValidationError(prefs)).toBeNull()
    expect(normalizeQueuePrefs(prefs)).toEqual(prefs)
  })

  it.each([
    ['maxPendingPerParticipant', 0, 'maxPendingPerParticipant must be an integer between 1 and 20'],
    ['maxPendingPerParticipant', 21, 'maxPendingPerParticipant must be an integer between 1 and 20'],
    ['maxSongsPerParticipantRound', 0, 'maxSongsPerParticipantRound must be an integer between 1 and 5'],
    ['maxSongsPerParticipantRound', 6, 'maxSongsPerParticipantRound must be an integer between 1 and 5'],
    ['houseTracksBeforeParticipant', -1, 'houseTracksBeforeParticipant must be an integer between 0 and 10'],
    ['houseTracksBeforeParticipant', 11, 'houseTracksBeforeParticipant must be an integer between 0 and 10'],
    ['houseTracksBeforeParticipant', 1.5, 'houseTracksBeforeParticipant must be an integer between 0 and 10'],
  ])('rejects an invalid %s value', (key, value, expectedError) => {
    expect(getQueuePrefsValidationError({ [key]: value })).toBe(expectedError)
  })

  it('rejects invalid enum values', () => {
    expect(getQueuePrefsValidationError({ approvalMode: 'SOMETIMES' }))
      .toBe('approvalMode must be one of: AUTO, MANUAL')
    expect(getQueuePrefsValidationError({ rotationMode: 'RANDOM' }))
      .toBe('rotationMode must be one of: FAIR, FIFO')
  })

  it('normalizes invalid stored values without leaking them to clients', () => {
    expect(normalizeQueuePrefs({
      maxPendingPerParticipant: -1,
      maxSongsPerParticipantRound: 99,
      houseTracksBeforeParticipant: 'two',
      approvalMode: 'SOMETIMES',
      rotationMode: 'RANDOM',
    })).toEqual(QUEUE_PREF_DEFAULTS)
  })
})

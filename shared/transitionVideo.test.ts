import { expect, it } from 'vitest'
import { getTransitionVideoPrefsValidationError, normalizeTransitionVideoPrefs, TRANSITION_VIDEO_PREF_DEFAULTS } from './transitionVideo.js'

it('supplies unselected defaults for legacy rooms and normalizes malformed stored values', () => {
  const defaults = { ...TRANSITION_VIDEO_PREF_DEFAULTS }
  const values: unknown[] = [undefined, null, [], 'invalid', { videoId: '../file', dimOpacity: Infinity, revision: -1 }]
  for (const value of values) {
    expect(normalizeTransitionVideoPrefs(value)).toEqual(defaults)
  }
  expect(normalizeTransitionVideoPrefs({ videoId: 'video-id', dimOpacity: 0, revision: 4 }))
    .toEqual({ videoId: 'video-id', dimOpacity: 0, revision: 4 })
})

it.each([
  null, [], {}, { videoId: '' }, { videoId: '../video' }, { videoId: 12 },
  { dimOpacity: -0.01 }, { dimOpacity: 0.851 }, { dimOpacity: NaN }, { dimOpacity: Infinity }, { dimOpacity: '0.55' },
  { revision: -1 }, { revision: 1.5 }, { revision: '1' }, { revision: Number.MAX_SAFE_INTEGER },
  { roomId: 2 },
])('rejects invalid settings rather than silently normalizing a save: %j', (patch) => {
  const value = patch === null || Array.isArray(patch) || Object.keys(patch).length === 0
    ? patch
    : { ...TRANSITION_VIDEO_PREF_DEFAULTS, ...patch }
  expect(getTransitionVideoPrefsValidationError(value)).toBeTypeOf('string')
})

it('accepts clearing a selection and both darkness boundaries', () => {
  for (const dimOpacity of [0, 0.85]) {
    expect(getTransitionVideoPrefsValidationError({ videoId: null, dimOpacity, revision: 0 })).toBeNull()
  }
})

import { expect, it } from 'vitest'
import { characterizeLayer } from './v1-normal-turn.js'

// Reduced incident shapes, not recordings of private room activity.
it.each([
  ['late start receipt cuts a decoded voice', { prepared: true, authorized: true, rendered: true, complete: false }, 'failed', 'interrupted'],
  ['selected backdrop never becomes visible', { authorized: true, rendered: false }, 'failed', 'not-rendered'],
  ['reserved bed evicted before start', { prepared: false, authorized: true, rendered: false }, 'failed', 'not-prepared'],
  ['server grant without browser evidence', { authorized: true }, 'unknown', 'insufficient-evidence'],
  ['no greeting on a house turn', { omission: 'house-track', rendered: false }, 'omitted', 'house-track'],
  ['disabled ambience actually played', { enabled: false, rendered: true }, 'failed', 'unexpected-playback'],
])('%s', (_, facts, outcome, reason) => {
  expect(characterizeLayer(facts)).toMatchObject({ outcome, reason })
})

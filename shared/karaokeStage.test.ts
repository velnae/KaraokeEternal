import { expect, it } from 'vitest'
import type { AnimationClip } from './animation.js'
import { karaokeCountdownTail, karaokeCueClip, karaokeCueDuration, karaokeCueSegment } from './karaokeStage.js'

it('plays the complete six-second applause with a short exit fade at both boundaries', () => {
  const source = { id: 'applause', checksum: 'original-bytes', durationMs: 6000, kind: 'effect' } as AnimationClip
  const start = karaokeCueClip(source, 'countdown')
  const end = karaokeCueClip(source, 'ended')
  expect(start.durationMs).toBe(6000)
  expect(start.checksum).toBe(source.checksum)
  expect(karaokeCueDuration(start)).toBe(6000)
  expect(karaokeCueSegment(start)).toEqual({ offsetMs: 0, durationMs: 6000, fadeOutMs: 300 })
  expect(karaokeCueDuration(end)).toBe(6000)
  expect(karaokeCueSegment(end)).toEqual(karaokeCueSegment(start))
  expect(source).not.toHaveProperty('playbackDurationMs')
})

it('allows a tail only for the same countdown after its one-way release', () => {
  const cue = { kind: 'countdown' as const, queueId: 1, runId: 'run', revision: 3, token: 'token' }
  const turn = { queueId: 1, runId: 'run', revision: 4, phase: 'released' }
  expect(karaokeCountdownTail(cue, turn)).toBe(true)
  expect(karaokeCountdownTail(cue, { ...turn, phase: 'played' })).toBe(true)
  for (const patch of [{ phase: 'waiting' }, { revision: 5 }, { runId: 'new' }, { queueId: 2 }]) {
    expect(karaokeCountdownTail(cue, { ...turn, ...patch })).toBe(false)
  }
})

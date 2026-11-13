import { afterEach, expect, it, vi } from 'vitest'
import { defaultEventScene, resolveSceneVisuals, sceneCue } from 'shared/eventScenes'
import SceneRun from './SceneRun'

afterEach(() => vi.useRealTimers())
it('preserves a first-voice lead-in when authorization arrives after the authored onset', async () => {
  vi.useFakeTimers()
  const scene = defaultEventScene('transition')
  const voice = scene.cues.find(cue => cue.id === 'announcement')!
  voice.offsetMs = 1000
  const text = scene.cues.find(cue => cue.id === 'text')!
  Object.assign(text, { anchor: 'block', referenceId: voice.id, referenceEdge: 'start', offsetMs: -500 })
  const run = new SceneRun(scene, 1, 2, 0, true)
  run.end()
  await vi.advanceTimersByTimeAsync(3000)
  const assets = [{ id: 'voice', role: 'announcement', durationMs: 6000 }]
  run.installAudio(assets)
  let speech = false
  const waiting = run.wait(voice).then((): void => {
    speech = true
    return undefined
  })
  const visibleText = () => resolveSceneVisuals(scene, run.resources, run.mediaEndMs(), run.timing)
    .some(cue => cue.id === text.id && performance.now() - run.startedAt >= cue.startMs)
  await vi.advanceTimersByTimeAsync(480)
  expect(speech).toBe(false)
  expect(visibleText()).toBe(false)
  await vi.advanceTimersByTimeAsync(40)
  expect(visibleText()).toBe(true)
  expect(speech).toBe(false)
  await vi.advanceTimersByTimeAsync(480)
  await waiting
  run.startAudio(assets[0], assets)
  expect(run.timing.starts!.announcement).toBe(1000)
  expect(resolveSceneVisuals(scene, run.resources, run.mediaEndMs(), run.timing).find(cue => cue.id === text.id)?.startMs).toBe(500)
})

it('adds positive template delay to a block relative to scene start', async () => {
  vi.useFakeTimers()
  const run = new SceneRun({ ...defaultEventScene('listen'), startOffsetMs: 2000 }, 1, 2, 0)
  const cue = { ...sceneCue('announcement', 'voice'), offsetMs: 1000 }
  let completed = false
  const waiting = run.wait(cue).then((): void => {
    completed = true
    return undefined
  })
  await vi.advanceTimersByTimeAsync(2900)
  expect(completed).toBe(false)
  await vi.advanceTimersByTimeAsync(100)
  await waiting
  expect(completed).toBe(true)
})
it('releases a deferred ambience wait on cancellation without starting the scene', async () => {
  vi.useFakeTimers()
  const scene = defaultEventScene('transition')
  Object.assign(scene.cues.find(cue => cue.id === 'text')!, { anchor: 'block', referenceId: 'announcement', referenceEdge: 'start', offsetMs: 0 })
  const run = new SceneRun(scene, 1, 2, 0, true)
  const pending = expect(run.wait(scene.cues.find(cue => cue.lane === 'ambience'))).rejects.toThrow('cancelada')
  await vi.advanceTimersByTimeAsync(200)
  expect(run.awaitingAudio).toBe(true)
  run.cancel()
  run.installAudio([{ id: 'voice', role: 'announcement', durationMs: 6000 }])
  await vi.advanceTimersByTimeAsync(40)
  await pending
  expect(run.awaitingAudio).toBe(true)
})
it('waits for the actual media end and cancellation releases a pending end wait', async () => {
  vi.useFakeTimers()
  const run = new SceneRun(defaultEventScene('listen'), 1, 2, 0)
  let completed = false
  const waiting = run.wait(sceneCue('announcement', 'voice', 'mediaEnd')).then((): void => {
    completed = true
    return undefined
  })
  await vi.advanceTimersByTimeAsync(5000)
  expect(completed).toBe(false)
  run.end()
  await waiting
  const cancelled = new SceneRun(defaultEventScene('listen'), 1, 2, 0)
  const pending = expect(cancelled.wait(sceneCue('announcement', 'voice', 'mediaEnd'))).rejects.toThrow('cancelada')
  cancelled.cancel()
  await pending
})

it('uses decoded grouped durations and actual cue ends for downstream waits', async () => {
  vi.useFakeTimers()
  const scene = defaultEventScene('listen')
  const greeting = scene.cues.find(cue => cue.id === 'greeting')!
  Object.assign(greeting, { anchor: 'block', referenceId: 'announcement', referenceEdge: 'end', offsetMs: 300 })
  const run = new SceneRun(scene, 1, 2, 0)
  const assets = [{ id: 'intro', role: 'intro', durationMs: 1000 }, { id: 'call', role: 'call', durationMs: 1000 }, { id: 'greeting', role: 'greeting', durationMs: 1000 }]
  run.installAudio(assets, asset => asset.id === 'greeting' ? 1000 : 1500)
  expect(run.resources.announcement?.durationMs).toBe(3000)
  await vi.advanceTimersByTimeAsync(2200)
  run.startAudio(assets[0], assets, () => 1500)
  await vi.advanceTimersByTimeAsync(1500)
  run.startAudio(assets[1], assets, () => 1500)
  expect(run.resources.announcement?.durationMs).toBe(3000)
  await vi.advanceTimersByTimeAsync(1700)
  run.endAudio(assets[1], assets)
  let ready = false
  const waiting = run.wait(greeting).then((): void => {
    ready = true
    return undefined
  })
  await vi.advanceTimersByTimeAsync(280)
  expect(ready).toBe(false)
  await vi.advanceTimersByTimeAsync(40)
  await waiting
  expect(ready).toBe(true)
  expect(run.timing.ends!.announcement - run.timing.starts!.announcement).toBe(3200)
})

it('updates negative lookahead from live media progress and gates the boundary on actual end', async () => {
  vi.useFakeTimers()
  const scene = { ...defaultEventScene('listen'), startOffsetMs: -2000 }
  const voice = scene.cues.find(cue => cue.id === 'announcement')!
  voice.anchor = 'mediaEnd'
  voice.offsetMs = 0
  const text = scene.cues.find(cue => cue.id === 'text')!
  Object.assign(text, { anchor: 'block', referenceId: voice.id, referenceEdge: 'start', offsetMs: -500 })
  const run = new SceneRun(scene, 1, 2, 0)
  run.installAudio([{ id: 'voice', role: 'call', durationMs: 1000 }])
  let lead = false
  let speech = false
  const waiting = run.wait(text).then((): void => {
    lead = true
    return undefined
  })
  const boundary = run.wait(voice).then((): void => {
    speech = true
    return undefined
  })
  await vi.advanceTimersByTimeAsync(1000)
  run.estimateMediaEnd(2000)
  expect(run.mediaEndMs()).toBe(3000)
  await vi.advanceTimersByTimeAsync(1480)
  expect(lead).toBe(false)
  await vi.advanceTimersByTimeAsync(40)
  await waiting
  expect(lead).toBe(true)
  await vi.advanceTimersByTimeAsync(1000)
  expect(speech).toBe(false)
  run.end()
  await boundary
  expect(speech).toBe(true)
})

it('waits for resource preparation and omits a dependent when its optional reference is absent', async () => {
  vi.useFakeTimers()
  const scene = defaultEventScene('listen')
  const ambience = scene.cues.find(cue => cue.id === 'ambience')!
  Object.assign(ambience, { anchor: 'block', referenceId: 'greeting', referenceEdge: 'start' })
  const run = new SceneRun(scene, 1, 2, 0)
  const waiting = run.wait(ambience)
  await vi.advanceTimersByTimeAsync(200)
  run.installAudio([])
  await vi.advanceTimersByTimeAsync(40)
  expect(await waiting).toBe(false)
})

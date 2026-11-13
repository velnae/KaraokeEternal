import { expect, it } from 'vitest'
import { defaultEventScene, sceneCue } from './eventScenes.js'
import { sceneAudioPlan } from './sceneAudio.js'

it('keeps native durations and attributes delays to the actual following resource', () => {
  const scene = defaultEventScene('listen')
  scene.cues.find(cue => cue.slot === 'greeting')!.offsetMs = 700
  scene.cues.find(cue => cue.slot === 'greeting')!.volume = 0.6
  const assets = [{ role: 'call', durationMs: 5000 }, { role: 'greeting', durationMs: 8000 }, { role: 'signature', durationMs: 1200 }]
  expect(sceneAudioPlan(scene, assets).map(asset => [asset.durationMs, asset.sceneDelayMs, asset.sceneVolume])).toEqual([[5000, 0, 1], [8000, 700, 0.6], [1200, 0, 1]])
})
it('rejects timing that overlaps independently attributed speech', () => {
  const scene = defaultEventScene('listen')
  scene.cues.find(cue => cue.slot === 'greeting')!.anchor = 'start'
  expect(() => sceneAudioPlan(scene, [{ role: 'call', durationMs: 5000 }, { role: 'greeting', durationMs: 2000 }])).toThrow('superponerse')
})
it('keeps the optional introduction and call in one presentation block', () => {
  const scene = defaultEventScene('listen')
  const assets = [{ role: 'intro', durationMs: 6000 }, { role: 'call', durationMs: 5000 }, { role: 'greeting', durationMs: 2000 }]
  expect(sceneAudioPlan(scene, assets).map(asset => asset.sceneDelayMs)).toEqual([0, 0, 0])
})
it('inserts two authorized resource instances without changing the native attribution order', () => {
  const scene = defaultEventScene('listen')
  const fixed = { ...sceneCue('announcement', 'voice', 'previous'), id: 'applause-1', binding: 'resource' as const, resourceId: 'applause' }
  scene.cues.splice(3, 0, fixed, { ...fixed, id: 'applause-2' })
  const native = [{ role: 'call', durationMs: 4000 }, { role: 'greeting', durationMs: 2000 }, { role: 'signature', durationMs: 1000 }]
  const plan = sceneAudioPlan(scene, native, { 'applause-1': { role: 'intro', durationMs: 800 }, 'applause-2': { role: 'intro', durationMs: 800 } })
  expect(plan.map(asset => asset.sceneCueId)).toEqual(['announcement', 'applause-1', 'applause-2', 'greeting', 'signature'])
  expect(plan.map(asset => asset.durationMs)).toEqual([4000, 800, 800, 2000, 1000])
  expect(plan.map(asset => asset.sceneStartMs)).toEqual([2000, 6000, 6800, 7600, 9600])
})

it('orders an earlier-listed fixed effect by its explicit reference to a later native block', () => {
  const scene = defaultEventScene('transition')
  scene.cues.unshift({ ...sceneCue('announcement', 'voice', 'block'), id: 'effect', binding: 'resource', resourceId: 'applause', referenceId: 'announcement', referenceEdge: 'end', offsetMs: 200 })
  const plan = sceneAudioPlan(scene, [{ role: 'announcement', durationMs: 4000 }], { effect: { role: 'intro', durationMs: 800 } })
  expect(plan.map(asset => [asset.sceneCueId, asset.sceneStartMs, asset.sceneDelayMs])).toEqual([['announcement', 2000, 0], ['effect', 6200, 200]])
})

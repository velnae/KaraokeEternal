import { expect, it } from 'vitest'
import { defaultEventScene, defaultEventScenes, defaultSceneTextLayout, resolveEventScene, resolveSceneVisuals, sceneCue, sceneTailDue, splitSceneData, sceneTextValue, validateEventScenes } from './eventScenes.js'

it('keeps old playback until a template is selected and round-trips its defaults', () => {
  const settings = defaultEventScenes()
  expect(validateEventScenes(settings)).toEqual(settings)
  expect(settings.selected).toEqual({})
})
it('uses the actual voice end and omits missing optional slots', () => {
  const scene = defaultEventScene('listen')
  const resolve = (durationMs: number) => resolveEventScene(scene, { announcement: { id: 'call', durationMs }, signature: { id: 'signature', durationMs: 1200 } }).filter(cue => cue.lane === 'voice')
  expect(resolve(4000).map(cue => [cue.startMs, cue.endMs])).toEqual([[2000, 6000], [6000, 7200]])
  expect(resolve(9000)[1].startMs).toBe(11000)
})
it('anchors voice after the real end while ambience starts two seconds before', () => {
  const scene = defaultEventScene('listen')
  scene.startOffsetMs = -2000
  const voice = scene.cues.find(cue => cue.slot === 'announcement')!
  voice.anchor = 'mediaEnd'
  voice.offsetMs = 0
  const resolved = resolveEventScene(scene, { announcement: { id: 'call', durationMs: 4000 } }, 6500)
  expect(resolved.find(cue => cue.slot === 'ambience')!.startMs).toBe(0)
  expect(resolved.find(cue => cue.slot === 'announcement')!.startMs).toBe(6500)
})
it('rejects overlapping foreground, invalid selections and voice cropping', () => {
  const scene = defaultEventScene('listen')
  scene.cues.find(cue => cue.slot === 'greeting')!.anchor = 'start'
  expect(() => resolveEventScene(scene, { announcement: { id: 'call', durationMs: 5000 }, greeting: { id: 'greeting', durationMs: 5000 } })).toThrow('superponerse')
  const settings = defaultEventScenes()
  settings.selected.listen = 'birthday'
  expect(() => validateEventScenes(settings)).toThrow('tipo')
  settings.selected = {}
  settings.templates[0].cues.find(cue => cue.lane === 'voice')!.durationMs = 1000
  expect(() => validateEventScenes(settings)).toThrow('completa')
})
it('clamps past anchors to a delayed scene start and keeps visual recovery available', () => {
  const scene = { ...defaultEventScene('listen'), startOffsetMs: 2000 }
  const voice = scene.cues.find(cue => cue.slot === 'announcement')!
  voice.anchor = 'mediaEnd'
  voice.offsetMs = 0
  const resources = { announcement: { id: 'voice', durationMs: 2000 } }
  expect(resolveEventScene(scene, resources, -2000).find(cue => cue.slot === 'announcement')!.startMs).toBe(0)
  scene.cues.find(cue => cue.slot === 'greeting')!.anchor = 'start'
  expect(resolveSceneVisuals(scene, { ...resources, greeting: { id: 'greeting', durationMs: 2000 } })).toEqual(expect.arrayContaining([expect.objectContaining({ lane: 'text' })]))
})
it('only triggers a negative offset on finite, actively playing media near its tail', () => {
  const scene = { ...defaultEventScene('listen'), startOffsetMs: -2000 }
  expect(sceneTailDue(scene, { position: 98, duration: 100, playing: true })).toBe(true)
  for (const progress of [{ position: 97, duration: 100, playing: true }, { position: 99, duration: 100, playing: false }, { position: 0, duration: 0, playing: true }, { position: 99, duration: Infinity, playing: true }, { position: 100, duration: 100, playing: true }]) expect(sceneTailDue(scene, progress)).toBe(false)
})
it('resolves independent audio and video instances by cue ID without overwriting event data', () => {
  const scene = defaultEventScene('transition')
  const first = { ...sceneCue('announcement', 'voice', 'previous'), id: 'effect-one', binding: 'resource' as const, resourceId: 'applause' }
  const second = { ...first, id: 'effect-two' }
  scene.cues.push(first, second)
  const resolved = resolveEventScene(scene, { 'announcement': { id: 'call', durationMs: 3000 }, 'effect-one': { id: 'applause', durationMs: 800 }, 'effect-two': { id: 'applause', durationMs: 800 } })
  expect(resolved.filter(cue => cue.lane === 'voice').map(cue => [cue.id, cue.startMs, cue.endMs])).toEqual([['announcement', 2000, 5000], ['effect-one', 5000, 5800], ['effect-two', 5800, 6600]])
  const settings = defaultEventScenes()
  settings.templates[0] = scene
  expect(validateEventScenes(settings).templates[0].cues).toHaveLength(scene.cues.length)
  second.enabled = false
  expect(resolveEventScene(scene, { 'announcement': { id: 'call', durationMs: 3000 }, 'effect-one': { id: 'applause', durationMs: 800 }, 'effect-two': { id: 'applause', durationMs: 800 } }).some(cue => cue.id === 'effect-two')).toBe(false)
})
it('persists normalized text geometry and multiline bindings, rejecting overflowing or unsafe styles', () => {
  const settings = defaultEventScenes()
  const cue = settings.templates[0].cues.find(cue => cue.lane === 'text')!
  cue.text = '{name}\n{song}'
  cue.layout = { ...defaultSceneTextLayout(), x: 15, width: 70, fontSize: 100 }
  expect(validateEventScenes(settings).templates[0].cues.find(item => item.id === cue.id)?.layout).toEqual(cue.layout)
  expect(sceneTextValue(cue.text, { name: 'Ana', song: 'Mi canción' })).toBe('Ana\nMi canción')
  cue.layout.x = 40
  expect(() => validateEventScenes(settings)).toThrow('posición')
  cue.layout.x = 15
  cue.layout.color = 'url(javascript:bad)'
  expect(() => validateEventScenes(settings)).toThrow('formato')
})
it('splits a native card into independent event bindings while retaining its timing', () => {
  const scene = defaultEventScene('karaoke')
  scene.cues.find(cue => cue.id === 'text')!.offsetMs = 1500
  const split = splitSceneData(scene, 'text')
  expect(split.cues.filter(cue => cue.lane === 'text').map(cue => cue.text)).toEqual(['{venue}', '{name}', '{table}', '{song}'])
  expect(split.cues.filter(cue => cue.lane === 'text').every(cue => cue.layout && cue.offsetMs === 1500)).toBe(true)
  expect(scene.cues.find(cue => cue.id === 'text')?.text).toBe('')
})

it('resolves forward and backward block references from prepared durations across reorder', () => {
  const scene = defaultEventScene('transition')
  const effect = { ...sceneCue('announcement', 'voice', 'block'), id: 'effect', binding: 'resource' as const, resourceId: 'applause', referenceId: 'announcement', referenceEdge: 'end' as const, offsetMs: 250 }
  const lead = { ...sceneCue('text', 'text', 'block'), id: 'lead', referenceId: effect.id, referenceEdge: 'start' as const, offsetMs: -500, durationMs: 1000 }
  scene.cues.unshift(lead)
  scene.cues.push(effect)
  const resources = { announcement: { id: 'call', durationMs: 4000 }, effect: { id: 'applause', durationMs: 800 } }
  const times = () => Object.fromEntries(resolveEventScene(scene, resources).map(cue => [cue.id, [cue.startMs, cue.endMs]]))
  expect(times().effect).toEqual([6250, 7050])
  expect(times().lead).toEqual([5750, 6750])
  scene.cues.reverse()
  expect(times().effect).toEqual([6250, 7050])
  expect(times().lead).toEqual([5750, 6750])
  resources.announcement.durationMs = 9000
  expect(times().effect).toEqual([11250, 12050])
  expect(times().lead).toEqual([10750, 11750])
  const actual = resolveEventScene(scene, resources, 0, { starts: { announcement: 2300 }, ends: { announcement: 12000 } })
  expect(actual.find(cue => cue.id === 'effect')!.startMs).toBe(12250)
})

it('omits dependencies of absent or disabled optional audio without inventing its duration', () => {
  const scene = defaultEventScene('transition')
  const text = scene.cues.find(cue => cue.lane === 'text')!
  Object.assign(text, { anchor: 'block', referenceId: 'greeting', referenceEdge: 'end', offsetMs: -500 })
  expect(resolveEventScene(scene, {}).some(cue => cue.id === text.id)).toBe(false)
  const resources = { greeting: { id: 'greeting', durationMs: 3000 } }
  expect(resolveEventScene(scene, resources).find(cue => cue.id === text.id)!.startMs).toBe(2500)
  scene.cues.find(cue => cue.id === 'greeting')!.enabled = false
  expect(resolveEventScene(scene, resources).some(cue => cue.id === text.id)).toBe(false)
})

it('rejects explicit and mixed implicit cycles, dangling references and unknown visual ends', () => {
  const settings = defaultEventScenes()
  const scene = settings.templates[0]
  const voice = scene.cues.find(cue => cue.id === 'announcement')!
  Object.assign(voice, { anchor: 'block', referenceId: voice.id, referenceEdge: 'start' })
  expect(() => validateEventScenes(settings)).toThrow('circular')
  voice.referenceId = 'greeting'
  expect(() => validateEventScenes(settings)).toThrow('circular')
  voice.referenceId = 'deleted'
  expect(() => validateEventScenes(settings)).toThrow('ya no existe')
  voice.referenceId = 'text'
  voice.referenceEdge = 'end'
  expect(() => validateEventScenes(settings)).toThrow('duración')
  voice.referenceEdge = 'start'
  expect(validateEventScenes(settings).templates[0].cues.find(cue => cue.id === voice.id)?.referenceId).toBe('text')
})

it('rejects negative scene time and speech overlap while retaining references after splitting data', () => {
  const scene = defaultEventScene('listen')
  const text = scene.cues.find(cue => cue.id === 'text')!
  Object.assign(text, { anchor: 'block', referenceId: 'announcement', referenceEdge: 'start', offsetMs: -3000 })
  const resources = { announcement: { id: 'call', durationMs: 4000 }, greeting: { id: 'greeting', durationMs: 3000 } }
  expect(() => resolveEventScene(scene, resources)).toThrow('antes del inicio')
  text.offsetMs = -500
  const greeting = scene.cues.find(cue => cue.id === 'greeting')!
  Object.assign(greeting, { anchor: 'block', referenceId: 'announcement', referenceEdge: 'end', offsetMs: -100 })
  expect(() => resolveEventScene(scene, resources)).toThrow('superponerse')
  Object.assign(greeting, { referenceId: 'text', referenceEdge: 'start', offsetMs: 5000 })
  const split = splitSceneData(scene, 'text')
  expect(split.cues.some(cue => cue.id === 'text')).toBe(true)
  expect(resolveEventScene(split, resources).find(cue => cue.id === 'greeting')!.startMs).toBe(6500)
})

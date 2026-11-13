import { expect, it } from 'vitest'
import { defaultEventScene, resolveSceneTimeline, sceneCue } from 'shared/eventScenes'
import { sceneLinks, sceneOffsetLabel } from './sceneLinks'

it('keeps dependency direction, edge and signed offset when the dependent starts earlier', () => {
  const scene = defaultEventScene('transition')
  scene.cues.push({ ...sceneCue('text', 'text', 'block'), id: 'lead', referenceId: 'announcement', referenceEdge: 'start', offsetMs: -500, durationMs: 1000 })
  const timeline = resolveSceneTimeline(scene, { announcement: { id: 'voice', durationMs: 4000 } })
  const link = sceneLinks(scene, timeline.cues, 'lead')[0]
  expect([link.source.id, link.target.id, link.edge, link.offsetMs, link.resolved]).toEqual(['announcement', 'lead', 'start', -500, true])
  scene.cues.reverse()
  expect(sceneLinks(scene, timeline.cues, 'lead')[0]).toEqual(link)
  expect(sceneOffsetLabel(-500)).toBe('−0,5 s')
  expect(sceneOffsetLabel(500)).toBe('+0,5 s')
  expect(sceneOffsetLabel(0)).toBe('0 s')
})

it('keeps unavailable dependencies visible without inventing timing or unrelated links', () => {
  const scene = defaultEventScene('transition')
  scene.cues.push({ ...sceneCue('text', 'text', 'block'), id: 'lead', referenceId: 'greeting', referenceEdge: 'end', offsetMs: -500 })
  const timeline = resolveSceneTimeline(scene, {})
  expect(sceneLinks(scene, timeline.cues, 'lead')).toMatchObject([{ source: { id: 'greeting' }, target: { id: 'lead' }, edge: 'end', resolved: false }])
  expect(sceneLinks(scene, timeline.cues, null)).toEqual([])
  expect(sceneLinks(scene, timeline.cues, 'background')).toEqual([])
})

it('shows the previous available audio for implicit references in the prepared case', () => {
  const scene = defaultEventScene('transition')
  const timeline = resolveSceneTimeline(scene, { announcement: { id: 'voice', durationMs: 4000 }, signature: { id: 'signature', durationMs: 1000 } })
  expect(sceneLinks(scene, timeline.cues, 'signature')).toMatchObject([{ source: { id: 'announcement' }, target: { id: 'signature' }, edge: 'end', resolved: true }])
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { close, db, open } from '../../lib/Database.js'
import Rooms from '../../Rooms/Rooms.js'
import { defaultEventScenes, sceneCue } from '../../../shared/eventScenes.js'
import { getEventScenes, saveEventScenes, sceneFixedAudio, sceneAudioUrl } from './Store.js'
import * as catalog from '../catalog.js'

let directory: string
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'event-scenes-'))
  open({ file: path.join(directory, 'database.sqlite3'), ro: false })
  db.run('INSERT INTO rooms(roomId,name,status,data) VALUES(1,\'One\',\'open\',\'{}\'),(2,\'Two\',\'open\',\'{}\')')
})
afterEach(() => {
  vi.restoreAllMocks()
  close()
  fs.rmSync(directory, { recursive: true, force: true })
})

it('rejects known invalid timing without replacing an in-use template or incrementing its revision', () => {
  const clip = { id: 'voice', title: 'Voice', durationMs: 4000, checksum: 'a'.repeat(64), displayText: '', source: 'fixture', license: 'fixture', kind: 'voice' as const }
  vi.spyOn(catalog, 'catalogClips').mockReturnValue([clip, { ...clip, id: 'effect', kind: 'effect', durationMs: 800 }])
  const input = defaultEventScenes()
  input.selected.transition = 'transition'
  input.templates[0].cues.find(cue => cue.id === 'announcement')!.resourceId = clip.id
  const saved = saveEventScenes(1, input)
  const invalid = structuredClone(saved)
  const effect = { ...sceneCue('announcement', 'voice'), id: 'extra', binding: 'resource' as const, resourceId: 'effect', offsetMs: 2000 }
  invalid.templates[0].cues.push(effect)
  expect(() => saveEventScenes(1, invalid)).toThrow('superponerse')
  Object.assign(effect, { anchor: 'block', referenceId: 'announcement', referenceEdge: 'start', offsetMs: -3000 })
  expect(() => saveEventScenes(1, invalid)).toThrow('antes del inicio')
  expect(getEventScenes(1)).toEqual(saved)
})
it('saves only this room and rejects stale saves', () => {
  const input = defaultEventScenes()
  input.selected.listen = 'listen'
  const saved = saveEventScenes(1, input)
  expect(saved.revision).toBe(1)
  expect(getEventScenes(1).selected.listen).toBe('listen')
  expect(getEventScenes(2).selected).toEqual({})
  expect(() => saveEventScenes(1, input)).toThrow('Recargue')
})
it('preserves the latest scenes when an old room editor saves', async () => {
  const old = Rooms.get(1).entities[1]
  const input = defaultEventScenes()
  input.selected.karaoke = 'karaoke'
  saveEventScenes(1, input)
  await Rooms.set(1, { ...old, name: 'Renamed' })
  expect(getEventScenes(1).selected.karaoke).toBe('karaoke')
})
it('rejects unavailable resources without updating the room', () => {
  const input = defaultEventScenes()
  input.templates[0].cues[0].resourceId = 'not-a-video'
  expect(() => saveEventScenes(1, input)).toThrow('recurso disponible')
  expect(getEventScenes(1).revision).toBe(0)
})
it('reuses birthday introductions/music without copying or exposing another room or personalized greeting', () => {
  db.run('INSERT INTO birthdayAssets(id,roomId,kind,title,filename,durationMs,checksum) VALUES(\'own-music\',1,\'music\',\'Music\',\'music.mp3\',1000,?),(\'foreign-music\',2,\'music\',\'Foreign\',\'foreign.mp3\',1000,?),(\'private-greeting\',1,\'greeting\',\'Greeting\',\'greeting.mp3\',1000,?)', ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)])
  const input = defaultEventScenes()
  const scene = input.templates.find(scene => scene.event === 'birthday')!
  const extra = { ...sceneCue('announcement', 'voice', 'previous'), id: 'extra-music', binding: 'resource' as const, resourceId: 'own-music' }
  scene.cues.push(extra)
  const saved = saveEventScenes(1, input)
  const clip = sceneFixedAudio(1, scene)[extra.id]
  expect(sceneAudioUrl(clip)).toBe('api/birthdays/assets/own-music')
  expect(db.get<{ count: number }>('SELECT count(*) count FROM birthdayAssets')!.count).toBe(3)
  input.revision = saved.revision
  for (const id of ['foreign-music', 'private-greeting']) {
    extra.resourceId = id
    expect(() => saveEventScenes(1, input)).toThrow('recurso disponible')
  }
  expect(getEventScenes(1).revision).toBe(saved.revision)
})

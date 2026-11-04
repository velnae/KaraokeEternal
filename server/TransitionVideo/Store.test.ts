import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { close, db, open } from '../lib/Database.js'
import { ValidationError } from '../lib/Errors.js'
import {
  completeTransitionVideo, createTransitionVideo, failTransitionVideo, getTransitionVideo,
  getTransitionVideoSettings, saveTransitionVideoSettings, transitionVideoDTO, TransitionVideoConflictError,
} from './Store.js'

let directory: string
let database: string
const media = { durationMs: 1500, width: 1280, height: 720, frameRate: 29.97, size: 4096, checksum: 'a'.repeat(64) }
const createReady = (roomId = 1, requestId = 'request') => completeTransitionVideo(roomId, createTransitionVideo(roomId, { requestId, title: 'Fondo' }).id, media)

function rollbackFixtureTo (version: number) {
  // Run real down migrations so later features do not survive under a falsified
  // migration history when this fixture reconstructs an older database.
  for (const migration of db.all<{ id: number, down: string }>('SELECT id,down FROM migrations WHERE id>? ORDER BY id DESC', [version])) {
    db.exec(migration.down)
    db.run('DELETE FROM migrations WHERE id=?', [migration.id])
  }
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'transition-video-'))
  database = path.join(directory, 'database.sqlite3')
  open({ file: database, ro: false })
  db.run('INSERT INTO rooms(roomId,name,status,data) VALUES(1,\'One\',\'open\',\'{}\'),(2,\'Two\',\'closed\',\'{}\')')
})

afterEach(() => {
  close()
  fs.rmSync(directory, { recursive: true, force: true })
})

it('creates immutable attempts and deduplicates request IDs within their room', () => {
  const first = createTransitionVideo(1, { requestId: 'same-request', title: '  Original  ' })
  const duplicate = createTransitionVideo(1, { requestId: 'same-request', title: 'Retry' })
  const foreign = createTransitionVideo(2, { requestId: 'same-request', title: 'Other room' })
  expect(duplicate).toEqual(first)
  expect(first).toMatchObject({ state: 'preparing', title: 'Original', reason: null, filename: null, posterFilename: null })
  expect(foreign.id).not.toBe(first.id)
  expect(getTransitionVideo(2, first.id)).toBeUndefined()
  expect(transitionVideoDTO(first)).toMatchObject({ videoUrl: null, posterUrl: null })
  expect(getTransitionVideoSettings(1)).toEqual({ videoId: null, dimOpacity: 0.55, revision: 0 })
})

it('returns base-relative URLs and media metadata without filesystem names', () => {
  const ready = createReady()
  const dto = transitionVideoDTO(ready)
  expect(dto).toMatchObject({ ...media, state: 'ready', reason: null })
  expect(ready.filename).toBe(`${ready.id}.mp4`)
  expect(ready.posterFilename).toBe(`${ready.id}.jpg`)
  expect(dto).not.toHaveProperty('filename')
  expect(dto).not.toHaveProperty('posterFilename')
  expect(new URL(dto.videoUrl!, 'https://example.test/karaoke/').pathname).toBe(`/karaoke/api/animation/background/videos/${ready.id}/video`)
  expect(new URL(dto.posterUrl!, 'https://example.test/karaoke/').pathname).toBe(`/karaoke/api/animation/background/videos/${ready.id}/poster`)
})

it('persists selection and media metadata across a database close/reopen', () => {
  const video = createReady()
  db.run('UPDATE rooms SET data=? WHERE roomId=1', [JSON.stringify({ extra: 'keep', prefs: { roles: { 4: { allowNew: true } }, animation: { enabled: true } } })])
  const saved = saveTransitionVideoSettings(1, { videoId: video.id, dimOpacity: 0.7, revision: 0 })
  close()
  open({ file: database, ro: false })
  expect(getTransitionVideoSettings(1)).toEqual({ ...saved, revision: 1 })
  expect(getTransitionVideo(1, video.id)).toEqual(video)
  expect(JSON.parse(db.get<{ data: string }>('SELECT data FROM rooms WHERE roomId=1')!.data))
    .toMatchObject({ extra: 'keep', prefs: { roles: { 4: { allowNew: true } }, animation: { enabled: true } } })
})

it('upgrades an existing schema-21 database without changing room data', () => {
  // Recreate the pre-feature schema using the real preceding migrations.
  rollbackFixtureTo(21)
  const previous = JSON.stringify({ prefs: { animation: { enabled: true }, queue: { approvalMode: 'MANUAL' } }, extra: 'preserved' })
  db.run('UPDATE rooms SET data=? WHERE roomId=1', [previous])
  close()
  open({ file: database, ro: false })
  expect(db.get<{ data: string }>('SELECT data FROM rooms WHERE roomId=1')!.data).toBe(previous)
  expect(db.get('SELECT id FROM migrations WHERE id=22')).toBeDefined()
  expect(getTransitionVideoSettings(1)).toEqual({ videoId: null, dimOpacity: 0.55, revision: 0 })
  const video = createReady()
  expect(saveTransitionVideoSettings(1, { videoId: video.id, dimOpacity: 0.55, revision: 0 }).videoId).toBe(video.id)
})

it('adds retirement receipts to schema 22 without changing its ready selection', () => {
  const video = createReady()
  const selected = saveTransitionVideoSettings(1, { videoId: video.id, dimOpacity: 0.6, revision: 0 })
  rollbackFixtureTo(22)
  close()
  open({ file: database, ro: false })
  expect(getTransitionVideoSettings(1)).toEqual(selected)
  expect(getTransitionVideo(1, video.id)).toMatchObject({ state: 'ready', retiredAt: null })
})

it('rejects unavailable, foreign and failed selections without changing settings', () => {
  const preparing = createTransitionVideo(1, { requestId: 'pending', title: 'Pending' })
  const failed = createTransitionVideo(1, { requestId: 'failed', title: 'Failed' })
  failTransitionVideo(1, failed.id, 'El archivo no es compatible.')
  const foreign = createReady(2)
  for (const videoId of [preparing.id, failed.id, foreign.id, 'missing']) {
    expect(() => saveTransitionVideoSettings(1, { videoId, dimOpacity: 0.55, revision: 0 })).toThrow(ValidationError)
    expect(getTransitionVideoSettings(1)).toEqual({ videoId: null, dimOpacity: 0.55, revision: 0 })
  }
})

it('allows only one save for an expected revision and gives stale editors a reload instruction', () => {
  const video = createReady()
  const firstEditor = getTransitionVideoSettings(1)
  const secondEditor = getTransitionVideoSettings(1)
  const saved = saveTransitionVideoSettings(1, { ...firstEditor, videoId: video.id })
  expect(() => saveTransitionVideoSettings(1, { ...secondEditor, dimOpacity: 0.8 })).toThrow(TransitionVideoConflictError)
  try {
    saveTransitionVideoSettings(1, secondEditor)
  } catch (error) {
    expect(error).toMatchObject({ status: 409, message: expect.stringContaining('Recargue') })
  }
  expect(getTransitionVideoSettings(1)).toEqual(saved)
  expect(saveTransitionVideoSettings(1, { ...saved, videoId: null, dimOpacity: 0.85 }))
    .toEqual({ videoId: null, dimOpacity: 0.85, revision: 2 })
  expect(getTransitionVideo(1, video.id)?.state).toBe('ready')
})

it('leaves the selected resource intact after a replacement candidate fails', () => {
  const original = createReady()
  const selected = saveTransitionVideoSettings(1, { videoId: original.id, dimOpacity: 0.6, revision: 0 })
  const replacement = createTransitionVideo(1, { requestId: 'replacement', title: 'Replacement' })
  failTransitionVideo(1, replacement.id, 'La preparación se interrumpió. Vuelva a subir el archivo.')
  expect(getTransitionVideoSettings(1)).toEqual(selected)
  expect(getTransitionVideo(1, original.id)).toEqual(original)
  expect(() => completeTransitionVideo(1, replacement.id, media)).toThrow('ya no está en preparación')
  expect(() => completeTransitionVideo(1, original.id, { ...media, checksum: 'b'.repeat(64) })).toThrow('ya no está en preparación')
  expect(() => failTransitionVideo(1, original.id, 'Failed')).toThrow('ya no está en preparación')
})

it('refuses metadata/state mutations from another room', () => {
  const video = createTransitionVideo(1, { requestId: 'pending', title: 'Pending' })
  expect(() => completeTransitionVideo(2, video.id, media)).toThrow('no pertenece a esta sala')
  expect(() => failTransitionVideo(2, video.id, 'Failed')).toThrow('no pertenece a esta sala')
  expect(getTransitionVideo(1, video.id)).toEqual(video)
})

it.each([
  { durationMs: 0 }, { durationMs: 30_001 }, { width: 1921 }, { height: 1081 },
  { frameRate: 31 }, { frameRate: Infinity }, { frameRate: 0 }, { size: 40 * 1024 * 1024 + 1 },
  { size: 2.5 }, { checksum: 'invalid' },
])('refuses invalid prepared metadata: %j', (patch) => {
  const video = createTransitionVideo(1, { requestId: 'pending', title: 'Pending' })
  expect(() => completeTransitionVideo(1, video.id, { ...media, ...patch })).toThrow(ValidationError)
  expect(getTransitionVideo(1, video.id)).toEqual(video)
})

it('validates settings, titles and request IDs before writing', () => {
  for (const dimOpacity of [-0.1, 0.86, NaN, '0.55']) {
    expect(() => saveTransitionVideoSettings(1, { videoId: null, dimOpacity, revision: 0 })).toThrow(ValidationError)
  }
  expect(() => saveTransitionVideoSettings(1, { videoId: null, dimOpacity: 0.55 })).toThrow(ValidationError)
  expect(() => createTransitionVideo(1, { requestId: '../file', title: 'Title' })).toThrow(ValidationError)
  expect(() => createTransitionVideo(1, { requestId: 'valid', title: '  ' })).toThrow(ValidationError)
  expect(() => createTransitionVideo(1, { requestId: 'valid', title: 'a'.repeat(121) })).toThrow(ValidationError)
  expect(() => createTransitionVideo(999, { requestId: 'valid', title: 'Title' })).toThrow('No se encontró la sala')
  expect(() => saveTransitionVideoSettings(999, { videoId: null, dimOpacity: 0, revision: 0 })).toThrow('No se encontró la sala')
  expect(db.get<{ count: number }>('SELECT count(*) count FROM transitionVideos')!.count).toBe(0)
})

it('initializes settings on a legacy room with null preferences', () => {
  db.run('UPDATE rooms SET data=? WHERE roomId=1', ['{"prefs":null}'])
  expect(saveTransitionVideoSettings(1, { videoId: null, dimOpacity: 0, revision: 0 })).toEqual({ videoId: null, dimOpacity: 0, revision: 1 })
  expect(getTransitionVideoSettings(1)).toEqual({ videoId: null, dimOpacity: 0, revision: 1 })
})

it('enforces room ownership and ready-state completeness in the schema', () => {
  const video = createTransitionVideo(1, { requestId: 'pending', title: 'Pending' })
  expect(() => db.run('UPDATE transitionVideos SET state=\'ready\' WHERE id=?', [video.id])).toThrow()
  expect(() => db.run('UPDATE transitionVideos SET roomId=999 WHERE id=?', [video.id])).toThrow()
  db.run('DELETE FROM rooms WHERE roomId=1')
  expect(getTransitionVideo(1, video.id)).toBeUndefined()
})

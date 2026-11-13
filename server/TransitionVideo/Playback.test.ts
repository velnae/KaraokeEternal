import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { open, close, db } from '../lib/Database.js'
import { createTransitionVideo, completeTransitionVideo, getTransitionVideo, saveTransitionVideoSettings, changeTransitionVideo } from './Store.js'
import { captureTransitionBackground, leasedTransitionBackground, transitionVideoScene, leasedEventScene } from './Playback.js'
import { defaultEventScene } from '../../shared/eventScenes.js'
import { TransitionVideoService } from './Service.js'

let directory: string
let service: TransitionVideoService
let now: number
beforeEach(async () => {
  now = Date.now()
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'video-lease-'))
  open({ file: path.join(directory, 'database.sqlite'), ro: false })
  db.run('INSERT INTO rooms(roomId,name,status,data) VALUES(1,\'One\',\'open\',\'{}\'),(2,\'Two\',\'open\',\'{}\')')
  service = new TransitionVideoService(path.join(directory, 'video'), { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' })
  await service.start()
})
afterEach(async () => {
  await service.stop()
  close()
  await fs.rm(directory, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.useRealTimers()
})
async function ready (requestId: string) {
  now++
  const row = createTransitionVideo(1, { requestId, title: requestId })
  for (const extension of ['mp4', 'jpg']) await fs.writeFile(path.join(service.directory, `${row.id}.${extension}`), 'fixture')
  return completeTransitionVideo(1, row.id, { durationMs: 1000, width: 640, height: 360, frameRate: 30, size: 7, checksum: 'a'.repeat(64) })
}
it('captures the choreography with the existing scene lease and binds it to its owner and next request', () => {
  const template = defaultEventScene('listen')
  transitionVideoScene(1, 'template-snapshot', false, null, { template, nextQueueId: 42, ownerSocketId: 'owner' })
  template.startOffsetMs = -9000
  expect(leasedEventScene(1, 42, 'owner')?.startOffsetMs).toBe(0)
  expect(leasedEventScene(1, 43, 'owner')).toBeUndefined()
  expect(leasedEventScene(1, 42, 'other')).toBeUndefined()
  expect(leasedEventScene(2, 42, 'owner')).toBeUndefined()
  transitionVideoScene(1, 'template-snapshot', true)
  expect(leasedEventScene(1, 42, 'owner')).toBeUndefined()
})

it('keeps a frozen grant background after settings replacement and database restart until lease expiry', async () => {
  const first = await ready('first')
  saveTransitionVideoSettings(1, { videoId: first.id, dimOpacity: 0.6, revision: 0 })
  const captured = captureTransitionBackground(1, 'animation:grant', now + 5000)!
  const next = await ready('next')
  saveTransitionVideoSettings(1, { videoId: next.id, dimOpacity: 0.3, revision: 1 })
  await service.cleanup()
  expect(leasedTransitionBackground('animation:grant')).toEqual(captured)
  expect(getTransitionVideo(1, first.id)?.state).toBe('ready')
  await service.stop()
  close()
  open({ file: path.join(directory, 'database.sqlite'), ro: false })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  service = new TransitionVideoService(path.join(directory, 'video'), { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' })
  await service.start()
  expect(leasedTransitionBackground('animation:grant')).toEqual(captured)
  await expect(fs.stat(path.join(service.directory, `${first.id}.mp4`))).resolves.toBeDefined()
  now += 5001
  await vi.advanceTimersByTimeAsync(5001)
  expect(leasedTransitionBackground('animation:grant')).toBeNull()
  expect(getTransitionVideo(1, first.id)?.state).toBe('ready')
  expect(getTransitionVideo(1, next.id)?.state).toBe('ready')
})

it('keeps the same video on renewal and adopts settings only for a new scene', async () => {
  const first = await ready('first')
  saveTransitionVideoSettings(1, { videoId: first.id, dimOpacity: 0.55, revision: 0 })
  captureTransitionBackground(1, 'ambience:grant', now + 5000)
  const next = await ready('next')
  saveTransitionVideoSettings(1, { videoId: next.id, dimOpacity: 0.4, revision: 1 })
  captureTransitionBackground(1, 'ambience:grant', now + 10000)
  await service.cleanup()
  expect(leasedTransitionBackground('ambience:grant')?.resource.id).toBe(first.id)
  expect(getTransitionVideo(1, first.id)).toBeDefined()
  now += 5001
  await service.cleanup()
  expect(getTransitionVideo(1, first.id)).toBeDefined()
  expect(leasedTransitionBackground('ambience:grant')?.resource.id).toBe(first.id)
  expect(captureTransitionBackground(1, 'ambience:next', now + 5000)?.resource.id).toBe(next.id)
})

it('does not grant missing, preparing, foreign or expired visual resources', async () => {
  expect(captureTransitionBackground(1, 'missing', now + 5000)).toBeNull()
  const first = await ready('first')
  saveTransitionVideoSettings(1, { videoId: first.id, dimOpacity: 0.55, revision: 0 })
  expect(captureTransitionBackground(1, 'expired', now)).toBeNull()
  db.run('UPDATE rooms SET data=? WHERE roomId=2', [JSON.stringify({ prefs: { transitionVideo: { videoId: first.id } } })])
  expect(captureTransitionBackground(2, 'foreign', now + 5000)).toBeNull()
  const pending = createTransitionVideo(1, { requestId: 'pending', title: 'Pending' })
  db.run('UPDATE rooms SET data=? WHERE roomId=1', [JSON.stringify({ prefs: { transitionVideo: { videoId: pending.id } } })])
  expect(captureTransitionBackground(1, 'pending', now + 5000)).toBeNull()
  expect(db.all('SELECT * FROM transitionVideoLeases')).toEqual([])
})

it('rotates active videos once per scene, shares speech/bed choices and survives a database reopen', async () => {
  const first = await ready('first')
  const second = await ready('second')
  await ready('inactive')
  changeTransitionVideo(1, first.id, true)
  changeTransitionVideo(1, second.id, true)
  saveTransitionVideoSettings(1, { mode: 'all', videoId: null, dimOpacity: 0.6, revision: 0 })
  const scene = transitionVideoScene(1, 'one')!
  expect(scene.resource.id).toBe(first.id)
  expect(transitionVideoScene(1, 'one')).toEqual(scene)
  expect(captureTransitionBackground(1, 'animation:speech', now + 5000)).toEqual(scene)
  expect(captureTransitionBackground(1, 'ambience:bed', now + 5000)).toEqual(scene)
  expect(captureTransitionBackground(1, 'ambience:bed', now + 10000)).toEqual(scene)
  transitionVideoScene(1, 'one', true)
  expect(transitionVideoScene(1, 'two')?.resource.id).toBe(second.id)
  transitionVideoScene(1, 'two', true)
  close()
  open({ file: path.join(directory, 'database.sqlite'), ro: false })
  expect(transitionVideoScene(1, 'three')?.resource.id).toBe(first.id)
  transitionVideoScene(1, 'three', true)
  changeTransitionVideo(1, first.id, false)
  expect(transitionVideoScene(1, 'four')?.resource.id).toBe(second.id)
  transitionVideoScene(1, 'four', true)
  changeTransitionVideo(1, second.id, false)
  expect(transitionVideoScene(1, 'empty')).toBeNull()
  transitionVideoScene(1, 'empty', true)
})

it('deletes only on request and keeps leased bytes readable until the scene ends', async () => {
  const first = await ready('first')
  await ready('second')
  await ready('third')
  changeTransitionVideo(1, first.id, true)
  saveTransitionVideoSettings(1, { mode: 'all', videoId: null, dimOpacity: 0.55, revision: 0 })
  captureTransitionBackground(1, 'animation:deleting', now + 5000)
  changeTransitionVideo(1, first.id, 'delete')
  await service.cleanup()
  expect(getTransitionVideo(1, first.id)).toBeUndefined()
  const reader = service.acquire(1, first.id)
  reader.release()
  await expect(fs.stat(path.join(service.directory, `${first.id}.mp4`))).resolves.toBeDefined()
  now += 5001
  await service.cleanup()
  expect(() => service.acquire(1, first.id)).toThrow()
  await expect(fs.stat(path.join(service.directory, `${first.id}.mp4`))).rejects.toThrow()
})

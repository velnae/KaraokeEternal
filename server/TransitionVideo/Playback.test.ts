import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { open, close, db } from '../lib/Database.js'
import { createTransitionVideo, completeTransitionVideo, getTransitionVideo, saveTransitionVideoSettings } from './Store.js'
import { captureTransitionBackground, leasedTransitionBackground } from './Playback.js'
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
  expect(getTransitionVideo(1, first.id)).toBeUndefined()
  expect(getTransitionVideo(1, next.id)?.state).toBe('ready')
})

it('adopts new idle settings on renewal while retaining the prior in-flight asset until its old deadline', async () => {
  const first = await ready('first')
  saveTransitionVideoSettings(1, { videoId: first.id, dimOpacity: 0.55, revision: 0 })
  captureTransitionBackground(1, 'ambience:grant', now + 5000)
  const next = await ready('next')
  saveTransitionVideoSettings(1, { videoId: next.id, dimOpacity: 0.4, revision: 1 })
  captureTransitionBackground(1, 'ambience:grant', now + 10000)
  await service.cleanup()
  expect(leasedTransitionBackground('ambience:grant')?.resource.id).toBe(next.id)
  expect(getTransitionVideo(1, first.id)).toBeDefined()
  now += 5001
  await service.cleanup()
  expect(getTransitionVideo(1, first.id)).toBeUndefined()
  expect(leasedTransitionBackground('ambience:grant')?.resource.id).toBe(next.id)
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

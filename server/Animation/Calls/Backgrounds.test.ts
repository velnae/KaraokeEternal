import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import Koa from 'koa'
import { open, close, db } from '../../lib/Database.js'
import { activateBackground, backgroundFile, backgroundOverview, backgroundSettings, captureKaraokeMedia, currentKaraokeMedia, peekKaraokeMedia, saveBackgroundSettings, startKaraokeBackgrounds, uploadBackground } from './Backgrounds.js'
import { createCallRouter } from './router.js'
import type CallJobs from './Jobs.js'
import Animation from '../Animation.js'
import { callControls } from './Store.js'
import { preparationClips } from '../preparation.js'
import { beginKaraokeTurn, operateKaraokeTurn, recoverKaraokeTurns } from './Start.js'

let directory: string
let stop: () => void
let audio: string
let video: string
beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'karaoke-backgrounds-'))
  audio = path.join(directory, 'bed.wav')
  video = path.join(directory, 'video.mp4')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=44100', '-t', '1', audio])
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=blue:s=320x180:r=10', '-t', '1', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', video])
})
beforeEach(async () => {
  open({ file: ':memory:', ro: false })
  db.run(`INSERT INTO rooms(roomId,name,status) VALUES(1,'One','open'),(2,'Two','open')`)
  db.run(`INSERT INTO users(userId,username,name,password,roleId) VALUES(1,'admin','Admin','test',1)`)
  stop = await startKaraokeBackgrounds(await fs.mkdtemp(path.join(directory, 'case-')))
})
afterEach(() => {
  stop()
  close()
})
afterAll(async () => fs.rm(directory, { recursive: true, force: true }))
async function asset (kind: 'video' | 'bed', roomId = 1) {
  return uploadBackground(roomId, kind, `Fixture ${kind}`, kind === 'video' ? video : audio, randomUUID())
}
async function configured () {
  const video = await asset('video')
  const bed = await asset('bed')
  activateBackground(1, video.id, true)
  activateBackground(1, bed.id, true)
  saveBackgroundSettings(1, { ...backgroundSettings(1), videoMode: 'single', videoId: video.id, bedMode: 'single', bedId: bed.id, bedVolume: 0.12 })
  return { video, bed }
}
it('prepares own inactive resources, reuses upload receipts, and keeps other catalogs untouched', async () => {
  const requestId = randomUUID()
  const first = await uploadBackground(1, 'video', 'Own video', video, requestId)
  expect(first).toMatchObject({ state: 'ready', active: false, kind: 'video' })
  expect(await uploadBackground(1, 'video', 'Own video', video, requestId)).toEqual(first)
  expect(backgroundOverview(2).assets).toEqual([])
  expect(db.all('SELECT * FROM transitionVideos')).toEqual([])
  expect(db.all('SELECT * FROM birthdayAssets')).toEqual([])
  expect(db.all('SELECT * FROM audioResources')).toEqual([])
  expect(peekKaraokeMedia(1).background).toBeNull()
  expect((await fs.stat(backgroundFile(1, first.id).file)).size).toBeGreaterThan(0)
}, 30000)
it('rejects stale settings, wrong-room resources, inactive selections and invalid volumes', async () => {
  const video = await asset('video')
  expect(() => saveBackgroundSettings(1, { ...backgroundSettings(1), videoMode: 'single', videoId: video.id })).toThrow('activo')
  activateBackground(1, video.id, true)
  expect(() => saveBackgroundSettings(2, { ...backgroundSettings(2), videoMode: 'single', videoId: video.id })).toThrow('esta sala')
  const current = backgroundSettings(1)
  saveBackgroundSettings(1, current)
  expect(() => saveBackgroundSettings(1, current)).toThrow('cambiaron')
  expect(() => saveBackgroundSettings(1, { ...backgroundSettings(1), bedVolume: NaN })).toThrow('volúmenes')
}, 30000)

it('accepts 130-second Karaoke videos and rejects an overrun rather than trimming it', async () => {
  for (const duration of [130, 130.1]) {
    const source = path.join(directory, `karaoke-limit-${duration}.mp4`)
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=blue:s=160x90:r=10', '-t', String(duration), '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', source])
    const resource = await uploadBackground(1, 'video', `Limit ${duration}`, source, randomUUID())
    if (duration === 130) expect(resource).toMatchObject({ state: 'ready', durationMs: 130000, active: false })
    else expect(resource).toMatchObject({ state: 'failed', error: expect.stringContaining('el máximo es 130 s') })
  }
}, 30000)

it('prepares long Karaoke accompaniment and rejects input beyond 130 seconds', async () => {
  for (const duration of [129.8, 130.1]) {
    const source = path.join(directory, `karaoke-audio-limit-${duration}.wav`)
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=44100', '-t', String(duration), source])
    const resource = await uploadBackground(1, 'bed', `Audio ${duration}`, source, randomUUID())
    if (duration < 130) {
      expect(resource).toMatchObject({ state: 'ready', active: false, kind: 'bed' })
      expect(resource.durationMs).toBeGreaterThan(129000)
      expect(resource.durationMs).toBeLessThanOrEqual(130000)
    } else expect(resource).toMatchObject({ state: 'failed', error: expect.stringContaining('130 s') })
  }
}, 30000)
it('rotates once per scene and keeps a frozen selection through edits and deactivation', async () => {
  const first = await asset('video')
  const second = await asset('video')
  activateBackground(1, first.id, true)
  activateBackground(1, second.id, true)
  saveBackgroundSettings(1, { ...backgroundSettings(1), videoMode: 'all' })
  const before = peekKaraokeMedia(1)
  expect(peekKaraokeMedia(1)).toEqual(before)
  const scene = captureKaraokeMedia(1, 'first', 10)
  expect(scene).toEqual(before)
  expect(captureKaraokeMedia(1, 'first', 10)).toEqual(scene)
  expect(peekKaraokeMedia(1).background?.resource.id).not.toBe(scene.background?.resource.id)
  activateBackground(1, scene.background!.resource.id, false)
  expect(currentKaraokeMedia(1, 10)).toEqual(scene)
  expect(currentKaraokeMedia(2, 10)).toBeNull()
  expect(captureKaraokeMedia(1, 'second', 11).background?.resource.id).not.toBe(scene.background?.resource.id)
}, 30000)
it('uses its own bed and volume with Animator off and shares the existing finite permit', async () => {
  const { bed, video } = await configured()
  db.run('INSERT INTO karaokeCallControls(roomId,enabled,preparing,revision) VALUES(1,1,1,0)')
  const queueId = Number(db.run(`INSERT INTO queue(roomId,userId,origin,requestIntent,status,source,externalId,title,artistOrChannel) VALUES(1,1,'PARTICIPANT','SING','APPROVED','YOUTUBE','test','Test','Test')`).lastID)
  const media = captureKaraokeMedia(1, 'scene', queueId)
  expect(media.background?.resource.id).toBe(video.id)
  expect(preparationClips(1).some(clip => clip.id === bed.id)).toBe(true)
  const identity = { roomId: 1, userId: 1, socketId: randomUUID() }
  Animation.claim(1, identity.socketId)
  Animation.ready(identity, true, [bed.checksum!], true)
  Animation.control(1, Animation.state(1).controlVersion, { enabled: false, ambienceEnabled: false, ambienceVolume: 0 })
  const grant = Animation.reserveTransitionAmbience(identity, Animation.state(1).playerEpoch, { queueId: -1 }, { sourceQueueId: null, expectedNextQueueId: queueId })
  expect(grant).toMatchObject({ karaoke: true, volume: 0.12, clip: { id: bed.id }, background: { resource: { id: video.id } } })
  Animation.stopAmbience(identity, grant!.id)
  expect(Animation.ambience(1)).toBeNull()
  expect(callControls(1).enabled).toBe(true)
}, 30000)
it('persists a failed preparation and leaves saved media and configuration usable', async () => {
  const { video } = await configured()
  const failed = await uploadBackground(1, 'bed', 'Broken', video.url, randomUUID())
  expect(failed.state).toBe('failed')
  expect(failed.error).toBeTruthy()
  expect(peekKaraokeMedia(1).background?.resource.id).toBe(video.id)
}, 30000)
it('restores the same scene after restart even when future background settings changed', async () => {
  const { video } = await configured()
  const queueId = Number(db.run(`INSERT INTO queue(roomId,userId,origin,requestIntent,status,source,externalId,title,artistOrChannel) VALUES(1,1,'PARTICIPANT','SING','APPROVED','YOUTUBE','test','Test','Test')`).lastID)
  const turn = beginKaraokeTurn(1, queueId, 'owner')!
  const frozen = captureKaraokeMedia(1, 'first', queueId)
  operateKaraokeTurn(1, 'owner', { ...turn, operation: 'presented' })
  saveBackgroundSettings(1, { ...backgroundSettings(1), videoMode: 'none', bedMode: 'none' })
  const root = path.dirname(backgroundFile(1, video.id).file)
  stop()
  recoverKaraokeTurns()
  stop = await startKaraokeBackgrounds(root)
  expect(beginKaraokeTurn(1, queueId, 'successor')).toMatchObject({ phase: 'waiting', presented: true })
  expect(captureKaraokeMedia(1, 'restored', queueId)).toEqual(frozen)
}, 30000)
it('protects management and media routes while permitting same-room operators to read', async () => {
  const { video } = await configured()
  const app = new Koa()
  app.use(async (ctx, next) => {
    ctx.user = { isAdmin: false, role: ctx.headers.authorization === 'operator' ? 'operator' : 'standard', roomId: Number(ctx.headers['x-room'] ?? 1), userId: 1 } as typeof ctx.user
    await next()
  })
  app.use(createCallRouter(() => ({} as CallJobs)).routes())
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address() as { port: number }
  const base = `http://127.0.0.1:${address.port}/api/rooms/1/karaoke-calls/backgrounds`
  try {
    expect((await fetch(base)).status).toBe(403)
    expect((await fetch(`${base}/upload`, { method: 'POST' })).status).toBe(403)
    expect((await fetch(`${base}/assets/${video.id}`, { headers: { authorization: 'operator' } })).status).toBe(200)
    expect((await fetch(`${base}/assets/${video.id}`, { headers: { 'authorization': 'operator', 'x-room': '2' } })).status).toBe(403)
    expect((await fetch(base, { method: 'PUT', headers: { authorization: 'operator' } })).status).toBe(403)
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
}, 30000)

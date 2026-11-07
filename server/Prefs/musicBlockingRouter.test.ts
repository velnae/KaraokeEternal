import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import Koa from 'koa'
import { koaBody } from 'koa-body'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { db, open, close } from '../lib/Database.js'
import Prefs from './Prefs.js'
import router from './router.js'
import Queue from '../Queue/Queue.js'
import Rooms from '../Rooms/Rooms.js'
import { defaultMusicBlocking } from '../../shared/musicBlocking.js'
import { PREFS_PUSH, QUEUE_PUSH } from '../../shared/actionTypes.js'

const emit = vi.fn()
const app = new Koa()
app.use(async (ctx, next) => {
  ctx.user = { isAdmin: ctx.get('test-admin') === 'true' } as typeof ctx.user
  ctx.io = { emit, to: () => ({ emit }) } as unknown as typeof ctx.io
  await next()
})
app.use(koaBody())
app.use(router.routes())
const server = createServer(app.callback())
let directory: string
let base: string
const song = { source: 'YOUTUBE' as const, sourceId: 'AAAAAAAAAAA', externalId: 'AAAAAAAAAAA', localSongId: null, mediaId: null, mediaType: 'youtube' as const, title: 'Tema', artistOrChannel: 'Artist', durationSeconds: 120, thumbnailUrl: null, isPlayable: true }
beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'music-blocking-http-'))
  open({ file: path.join(directory, 'db.sqlite'), ro: false })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/prefs/music-blocking`
})
afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
  close()
  fs.rmSync(directory, { recursive: true, force: true })
  vi.restoreAllMocks()
})
beforeEach(() => {
  db.exec('DELETE FROM greetings; DELETE FROM queue; DELETE FROM users; DELETE FROM rooms; DELETE FROM prefs;')
  db.exec(`INSERT INTO rooms(roomId,name,status) VALUES(1,'Room','open'),(2,'Other','closed');
    INSERT INTO users(userId,username,name,password,roleId) VALUES(1,'ana','Ana','',4);`)
  vi.spyOn(Rooms, 'getPlayerStatus').mockReturnValue(null)
  emit.mockClear()
})
const save = (body: unknown, admin = true) => fetch(base, {
  method: 'PUT', headers: { 'content-type': 'application/json', 'test-admin': String(admin) }, body: JSON.stringify(body),
})

it('seeds Faraón, rejects unauthorized/invalid writes and persists removal across reopen', async () => {
  expect(Prefs.getMusicBlocking()).toEqual(defaultMusicBlocking)
  expect(() => Queue.add({ roomId: 1, userId: 1, song: { ...song, artistOrChannel: 'Faraón Love Shady' } })).toThrow('política')
  expect((await save({ rules: [] }, false)).status).toBe(403)
  expect((await save({ rules: [null] })).status).toBe(422)
  expect(emit).not.toHaveBeenCalled()
  expect((await save({ rules: [] })).status).toBe(200)
  close()
  open({ file: path.join(directory, 'db.sqlite'), ro: false })
  expect(Prefs.getMusicBlocking()).toEqual({ rules: [] })
})

it('withdraws matching pending requests in all rooms, preserves current and releases allowance with a durable reason', async () => {
  const current = Queue.add({ roomId: 1, userId: 1, song })
  Queue.transition(1, current, 'PLAYING')
  const pending = Queue.add({ roomId: 1, userId: 1, song, status: 'PENDING_APPROVAL' })
  const approved = Queue.add({ roomId: 2, userId: 1, song })
  const allowed = Queue.add({ roomId: 1, userId: 1, song: { ...song, artistOrChannel: 'Other' } })
  const settings = { rules: [{ kind: 'artist', artist: 'Artist', aliases: [] }] }
  const response = await save(settings)
  expect(response.status).toBe(200)
  expect(Queue.get(1).entities[current].status).toBe('PLAYING')
  expect(Queue.get(1).entities[pending]).toMatchObject({ status: 'REJECTED', rejectionReason: 'MUSIC_BLOCKED', prevQueueId: null })
  expect(Queue.get(2).entities[approved].rejectionReason).toBe('MUSIC_BLOCKED')
  expect(Queue.get(1).entities[allowed].prevQueueId).toBe(current)
  expect(Queue.countPending(1, 1)).toBe(1)
  expect(emit).toHaveBeenCalledWith('action', { type: PREFS_PUSH, payload: { musicBlocking: settings } })
  expect(emit).toHaveBeenCalledWith('action', { type: QUEUE_PUSH, payload: Queue.get(1) })
  expect(() => Queue.add({ roomId: 1, userId: 1, song })).toThrow('política')
  await save({ rules: [] })
  expect(Queue.get(1).entities[pending].status).toBe('REJECTED')
  expect(() => Queue.add({ roomId: 1, userId: 1, song })).not.toThrow()
})

it('revalidates approval and resource IDs for local media', () => {
  const pending = Queue.add({ roomId: 1, userId: 1, song, status: 'PENDING_APPROVAL' })
  Prefs.set('musicBlocking', { rules: [{ kind: 'resource', source: 'YOUTUBE', sourceId: song.sourceId }] })
  expect(() => Queue.moderate(1, pending, 'APPROVED')).toThrow('política')
  Prefs.set('musicBlocking', { rules: [{ kind: 'resource', source: 'LOCAL', sourceId: '7' }] })
  expect(() => Queue.add({ roomId: 1, userId: 1, song: { ...song, source: 'LOCAL', sourceId: '7', localSongId: 7, mediaId: 1, externalId: null, mediaType: 'mp4' } })).toThrow('política')
})

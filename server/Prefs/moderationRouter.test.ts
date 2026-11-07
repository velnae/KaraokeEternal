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
import Greetings from '../Greetings/Greetings.js'
import { greetingSpeechText } from '../Greetings/voiceProfile.js'
import { guestNameError } from '../../shared/guestName.js'
import { defaultModeration } from '../../shared/textModeration.js'
import { PREFS_PUSH, QUEUE_PUSH } from '../../shared/actionTypes.js'

const emit = vi.fn()
const app = new Koa()
app.use(async (ctx, next) => {
  ctx.user = { isAdmin: ctx.get('test-admin') === 'true' } as typeof ctx.user
  ctx.io = { emit, to: () => ({ emit }), sockets: { adapter: { rooms: new Map([['ROOM_ID_1', new Set()]]) } } } as unknown as typeof ctx.io
  await next()
})
app.use(koaBody())
app.use(router.routes())
const server = createServer(app.callback())
let directory: string
let base: string
beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moderation-http-'))
  open({ file: path.join(directory, 'db.sqlite'), ro: false })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/prefs`
})
afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
  close()
  fs.rmSync(directory, { recursive: true, force: true })
})
beforeEach(() => {
  db.exec('DELETE FROM greetings; DELETE FROM queue; DELETE FROM users; DELETE FROM rooms; DELETE FROM prefs;')
  Prefs.set('moderation', defaultModeration)
  Prefs.set('jwtKey', 'private-key')
  db.exec(`INSERT INTO rooms(roomId,name,status) VALUES(1,'Room','open');
    INSERT INTO users(userId,username,name,password,roleId) VALUES(1,'ana','Ana','',4);`)
  emit.mockClear()
})
const save = (body: unknown, admin = true) => fetch(`${base}/moderation`, {
  method: 'PUT', headers: { 'content-type': 'application/json', 'test-admin': String(admin) }, body: JSON.stringify(body),
})

it('persists admin changes, broadcasts only public rules and reloads them on database open', async () => {
  const response = await save({ terms: [' Maravilla ', 'maravilla'] })
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const moderation = { terms: ['maravilla'] }
  expect(await response.json()).toEqual({ moderation })
  expect(guestNameError('Maravilla')).toContain('no está permitido')
  expect(() => greetingSpeechText({ sender: 'Ana', message: 'Una maravilla' })).toThrow('reglas de publicación')
  expect(Prefs.get().moderation).toEqual(moderation)
  expect(emit).toHaveBeenCalledWith('action', { type: PREFS_PUSH, payload: { moderation } })
  const publicPrefs = await (await fetch(base)).json()
  expect(publicPrefs.moderation).toEqual(moderation)
  expect(JSON.stringify(publicPrefs)).not.toContain('private-key')
  close()
  open({ file: path.join(directory, 'db.sqlite'), ro: false })
  expect(guestNameError('Maravilla')).toContain('no está permitido')
  expect((await save({ terms: [] })).status).toBe(200)
  expect(guestNameError('Maravilla')).toBeNull()
})

it('rejects non-admin or invalid updates without changing validation or broadcasting', async () => {
  expect((await save({ terms: ['ana'] }, false)).status).toBe(403)
  expect((await save({ terms: ['x'.repeat(81)] })).status).toBe(422)
  expect((await save({ terms: Array(501).fill('ana') })).status).toBe(422)
  expect(Prefs.get().moderation).toEqual(defaultModeration)
  expect(guestNameError('Ana')).toBeNull()
  expect(emit).not.toHaveBeenCalled()
})

it('revalidates queued greetings and refreshes public names immediately on save', async () => {
  const queueId = Queue.add({ roomId: 1, userId: 1, song: { source: 'YOUTUBE', sourceId: 'AAAAAAAAAAA', externalId: 'AAAAAAAAAAA', localSongId: null, mediaId: null, mediaType: 'youtube', title: 'Song', artistOrChannel: 'Artist', durationSeconds: 120, thumbnailUrl: null, isPlayable: true } })
  Greetings.attach({ roomId: 1, userId: 1 }, queueId, { message: 'Una maravilla' }, {})
  expect((await save({ terms: [...defaultModeration.terms, 'maravilla', 'ana'] })).status).toBe(200)
  expect(Greetings.items(1)[0]).toMatchObject({ status: 'REMOVED', message: 'Saludo no disponible.', sender: 'Invitado' })
  expect(Queue.get(1).entities[queueId]).toMatchObject({ status: 'APPROVED', userDisplayName: 'Invitado' })
  expect(emit).toHaveBeenCalledWith('action', { type: QUEUE_PUSH, payload: expect.objectContaining({ result: [queueId] }) })
})

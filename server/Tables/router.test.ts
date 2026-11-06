import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest'
import Koa from 'koa'
import { koaBody } from 'koa-body'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import jwt from 'jsonwebtoken'
import { Server } from 'socket.io'
import { open, close, db } from '../lib/Database.js'
import tableRouter from './router.js'
import userRouter from '../User/router.js'
import Tables from './Tables.js'
import User from '../User/User.js'
import Queue from '../Queue/Queue.js'
import { participation } from './admission.js'

const app = new Koa()
const key = 'isolated-table-router-test'
app.use(async (ctx, next) => {
  try {
    ctx.jwtKey = key
    ctx.io = io
    try {
      ctx.user = jwt.verify(ctx.cookies.get('keToken') ?? '', key)
    } catch {
      ctx.user = { userId: null }
    }
    await next()
  } catch (error) {
    ctx.status = (error as { status?: number }).status ?? 500
    ctx.body = (error as Error).message
  }
})
app.use(koaBody())
app.use(userRouter.routes())
app.use(tableRouter.routes())
const server = createServer(app.callback())
const io = new Server(server)
let base: string
let dir: string
let token: string
let tableId: number
const adminCookie = `keToken=${jwt.sign({ userId: 100, isAdmin: true }, key)}`
const call = (route: string, body?: unknown, cookie = '', method = body === undefined ? 'GET' : 'POST') => fetch(`${base}/api/${route}`, {
  method,
  headers: { 'content-type': 'application/json', cookie },
  body: body === undefined ? undefined : JSON.stringify(body),
})

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-table-http-'))
  open({ file: path.join(dir, 'db.sqlite3'), ro: false })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  await new Promise<void>(resolve => io.close(() => resolve()))
  close()
  fs.rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  db.exec('DELETE FROM queue; DELETE FROM participantSessions; DELETE FROM roomTables; DELETE FROM rooms; DELETE FROM users;')
  db.run('INSERT INTO rooms(roomId, name, status, data) VALUES (?, ?, ?, ?)', [1, 'Main', 'open', JSON.stringify({ prefs: { roles: { 4: { allowNew: true }, 3: { allowNew: true } }, tables: { mode: 'REQUIRED_QR' } } })])
  tableId = Tables.save(1, undefined, { code: '05', name: 'Terrace' })
  token = Tables.credential(1, tableId)
})

it('protects every table administrative endpoint, including nested credentials', async () => {
  for (const [route, method, body] of [
    ['rooms/1/tables', 'GET', undefined],
    ['rooms/1/tables', 'POST', { code: '2' }],
    [`rooms/1/tables/${tableId}`, 'PUT', { code: '5' }],
    [`rooms/1/tables/${tableId}/qr`, 'GET', undefined],
    [`rooms/1/tables/${tableId}/renew-qr`, 'POST', {}],
    [`rooms/1/tables/${tableId}/close-sessions`, 'POST', {}],
  ] as const) {
    expect((await call(route, body, '', method)).status, `${method} ${route}`).toBe(403)
  }
  const response = await call('rooms/1/tables', undefined, adminCookie)
  expect(response.status).toBe(200)
  expect(JSON.stringify(await response.json())).not.toContain(token)
  expect((await call(`rooms/2/tables/${tableId}/qr`, undefined, adminCookie)).status).toBe(422)
})

it('enforces guest names on direct creation, self edits and administrator edits', async () => {
  for (const name of ['Ana María Pérez', 'Puta', 'a'.repeat(25), 'Ana123', '']) {
    const response = await call('user', { role: 'guest', name, roomId: 1, invitation: token })
    expect(response.status).toBe(403)
    expect(db.all('SELECT * FROM users')).toHaveLength(0)
  }
  const created = await call('user', { role: 'guest', name: '  José   Pérez  ', roomId: 1, invitation: token })
  expect(created.status).toBe(200)
  const user = await created.json()
  expect(user.name).toBe('José Pérez')
  const cookie = created.headers.get('set-cookie')!.split(';')[0]
  db.run('INSERT INTO users(userId,username,name,password,roleId) VALUES(100,?,?,?,1)', ['admin', 'Admin', 'unused'])
  for (const actor of [cookie, adminCookie]) {
    for (const name of ['Huevón', '', 123, 'Ana María Pérez']) {
      expect((await call(`user/${user.userId}`, { name }, actor, 'PUT')).status).toBe(400)
      expect(User.getById(user.userId)).toMatchObject({ name: 'José Pérez' })
    }
  }
  const corrected = await call(`user/${user.userId}`, { name: 'Invitado' }, adminCookie, 'PUT')
  expect(corrected.status).toBe(200)
  expect(User.getById(user.userId)).toMatchObject({ name: 'Invitado' })
})

it('masks a legacy guest name in public queue data until corrected', async () => {
  const userId = await User.create({ name: 'Ana', username: undefined, newPassword: undefined, newPasswordConfirm: undefined, image: undefined }, 'guest')
  db.run('UPDATE users SET name=? WHERE userId=?', ['Puta', userId])
  Queue.add({ roomId: 1, userId, song: { source: 'YOUTUBE', sourceId: 'fixture0001', externalId: 'fixture0001', localSongId: null, mediaId: null, mediaType: 'youtube', title: 'Song', artistOrChannel: 'Artist', thumbnailUrl: null, durationSeconds: 5, isPlayable: true } })
  expect(Object.values(Queue.get(1).entities)[0].userDisplayName).toBe('Invitado')
  expect(User.getById(userId)).toMatchObject({ name: 'Puta' })
  expect((await call(`user/${userId}`, { name: 'José' }, `keToken=${jwt.sign({ userId, isGuest: true }, key)}`, 'PUT')).status).toBe(200)
  expect(Object.values(Queue.get(1).entities)[0].userDisplayName).toBe('José')
})

it('rejects direct guest admission and forged room context before creating accounts', async () => {
  expect((await call('user', { role: 'guest', name: 'Singer', roomId: 1 })).status).toBe(401)
  expect((await call('user', { role: 'guest', name: 'Singer', roomId: 1, invitation: 'forged' })).status).toBe(401)
  expect(db.all('SELECT * FROM users')).toHaveLength(0)
  const resolved = await call('table-join/resolve', { invitation: token })
  expect(await resolved.json()).toMatchObject({ roomId: 1, tableId, tableLabel: 'Mesa 05 · Terrace' })
})

it('creates a bound guest, preserves session on profile edits, and revokes it on logout', async () => {
  const created = await call('user', { role: 'guest', name: 'Singer', roomId: 1, invitation: token, tableId: 999 })
  expect(created.status).toBe(200)
  const user = await created.json()
  const cookie = created.headers.get('set-cookie')!.split(';')[0]
  expect(user.tableId).toBe(tableId)
  expect(user.participantSessionId).toBeTruthy()
  const edited = await call(`user/${user.userId}`, { name: 'Renamed' }, cookie, 'PUT')
  expect(edited.status).toBe(200)
  expect(await edited.json()).toMatchObject({ participantSessionId: user.participantSessionId, expiresAt: user.expiresAt, tableId })
  const account = await call('user', undefined, cookie)
  expect(await account.json()).toMatchObject({ tableId })
  await call('logout', undefined, cookie)
  expect(() => participation(user)).toThrow('terminó')
  const recovery = await call('user', undefined, cookie)
  expect(await recovery.json()).toMatchObject({ userId: user.userId, tableId: null, tableAccessError: expect.any(String) })
})

it('applies table requirement to returning accounts and reuses guest identity on rejoin', async () => {
  await User.create({ username: 'registered', name: 'Registered', newPassword: 'test-password', newPasswordConfirm: 'test-password', image: undefined })
  expect((await call('login', { username: 'registered', password: 'test-password', roomId: 1 })).status).toBe(403)
  const login = await call('login', { username: 'registered', password: 'test-password', roomId: 1, invitation: token })
  expect(login.status).toBe(200)
  const user = await login.json()
  const cookie = login.headers.get('set-cookie')!.split(';')[0]
  const rejoin = await call('table-join', { roomId: 1, invitation: token }, cookie)
  expect(await rejoin.json()).toMatchObject({ userId: user.userId, participantSessionId: user.participantSessionId })
  expect(db.all('SELECT * FROM participantSessions')).toHaveLength(1)
})

it('keeps room-password requirements for table QR admission', async () => {
  const { default: crypto } = await import('../lib/crypto.js')
  db.run('UPDATE rooms SET password = ? WHERE roomId = 1', [await crypto.hash('room-secret')])
  expect((await call('user', { role: 'guest', name: 'Singer', roomId: 1, invitation: token })).status).toBe(401)
  expect((await call('user', { role: 'guest', name: 'Singer', roomId: 1, invitation: token, roomPassword: 'room-secret' })).status).toBe(200)
})

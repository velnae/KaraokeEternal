import Koa from 'koa'
import { koaBody } from 'koa-body'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Server } from 'node:http'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { close, db, open } from '../../lib/Database.js'
import { defaultEventScenes } from '../../../shared/eventScenes.js'
import router from './router.js'

let directory: string
let server: Server
let origin: string
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-router-'))
  open({ file: path.join(directory, 'database.sqlite3'), ro: false })
  db.run('INSERT INTO rooms(roomId,name,status,data) VALUES(1,\'Room\',\'open\',\'{}\')')
  const app = new Koa()
  app.use(koaBody({ multipart: false }))
  app.use(async (ctx, next) => {
    const role = ctx.get('x-test-role')
    ctx.user = { role, isAdmin: role === 'admin', userId: 1, roomId: 1 } as typeof ctx.user
    await next()
  })
  app.use(router.routes())
  server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/animation/scenes/`
})
afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  close()
  fs.rmSync(directory, { recursive: true, force: true })
})
it('allows operator reads but restricts changes to administrators', async () => {
  expect((await fetch(origin, { headers: { 'x-test-role': 'guest' } })).status).toBe(403)
  const read = await fetch(origin, { headers: { 'x-test-role': 'operator' } })
  expect(read.status).toBe(200)
  expect(read.headers.get('cache-control')).toContain('no-store')
  const write = (role: string, body: unknown) => fetch(origin, { method: 'PUT', headers: { 'x-test-role': role, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  expect((await write('operator', defaultEventScenes())).status).toBe(403)
  const saved = await write('admin', defaultEventScenes())
  expect(saved.status).toBe(200)
  expect(await saved.json()).toMatchObject({ revision: 1 })
  expect((await write('admin', defaultEventScenes())).status).toBe(409)
  expect((await write('admin', { revision: 1, templates: [], selected: { listen: 'foreign' } })).status).toBe(422)
})

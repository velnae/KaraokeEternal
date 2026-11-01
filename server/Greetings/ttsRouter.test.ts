import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import Koa from 'koa'
import { koaBody } from 'koa-body'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

vi.mock('../lib/Database.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/Database.js')>()
  const db = new original.DatabaseWrapper(':memory:')
  db.exec('CREATE TABLE prefs(key TEXT PRIMARY KEY,data TEXT); CREATE TABLE roles(roleId INTEGER,name TEXT); CREATE TABLE paths(pathId INTEGER,path TEXT,priority INTEGER,data TEXT);')
  return { ...original, db }
})
import { db } from '../lib/Database.js'
import Prefs from '../Prefs/Prefs.js'
import prefsRouter from '../Prefs/router.js'
import router, { getLocalTts, startLocalTts } from './ttsRouter.js'

const app = new Koa()
app.use(async (ctx, next) => {
  ctx.user = { isAdmin: ctx.get('test-admin') === 'true' } as typeof ctx.user
  await next()
})
app.use(koaBody())
app.use(prefsRouter.routes())
app.use(router.routes())
const server = createServer(app.callback())
let base: string
let directory: string
beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ke-tts-http-'))
  await fs.mkdir(path.join(directory, '.venv/bin'), { recursive: true })
  await fs.symlink(process.execPath, path.join(directory, '.venv/bin/python'))
  for (const name of ['model.sh', 'resident.py', 'speak.py']) await fs.writeFile(path.join(directory, name), '')
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/prefs`
})
afterAll(async () => {
  await startLocalTts()()
  await new Promise<void>(resolve => server.close(() => resolve()))
  await fs.rm(directory, { recursive: true, force: true })
  db.close()
})
const call = (suffix = '', method = 'GET', body?: object, admin = true) => fetch(`${base}/local-tts${suffix}`, {
  method, headers: { 'test-admin': String(admin), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
})

describe('local TTS administration', () => {
  it('denies all local TTS endpoints to participants and anonymous clients', async () => {
    for (const [suffix, method] of [['', 'GET'], ['', 'PUT'], ['/check', 'POST'], ['/start', 'POST']]) {
      expect((await call(suffix, method, method === 'PUT' ? {} : undefined, false)).status).toBe(403)
    }
    expect(db.get('SELECT * FROM prefs WHERE key=?', ['localTts'])).toBeUndefined()
  })

  it('persists only validated admin settings and does not expose paths publicly', async () => {
    expect((await call('/start', 'POST')).status).toBe(422)
    const invalid = await call('', 'PUT', { installationPath: '.', autoStart: false, revision: 0 })
    expect(invalid.status).toBe(422)
    const response = await call('', 'PUT', { installationPath: directory, autoStart: false, revision: 0 })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect((await response.json()).config).toEqual({ installationPath: directory, autoStart: false, revision: 1 })
    expect((Prefs.get() as { localTts?: object }).localTts).toEqual({ installationPath: directory, autoStart: false, revision: 1 })
    expect(JSON.stringify(await (await fetch(base)).json())).not.toContain(directory)
    expect((await call('', 'PUT', { installationPath: directory, autoStart: true, revision: 0 })).status).toBe(409)
  })

  it('returns promptly while the model is unavailable and restores settings on service restart', async () => {
    expect((await call('/check', 'POST')).status).toBe(200)
    await expect.poll(() => getLocalTts().snapshot().state).toBe('unavailable')
    await startLocalTts()()
    expect((await (await call()).json()).config).toEqual({ installationPath: directory, autoStart: false, revision: 1 })
  })
})

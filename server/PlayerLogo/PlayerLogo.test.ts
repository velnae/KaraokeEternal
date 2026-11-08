import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import Koa from 'koa'
import { koaBody } from 'koa-body'
import { validatePlayerDisplay } from '../../shared/playerDisplay.js'
import { inspectLogoImage } from './inspect.js'

vi.mock('../lib/Database.js', async (original) => {
  const module = await original<typeof import('../lib/Database.js')>()
  const db = new module.DatabaseWrapper(':memory:')
  db.exec('CREATE TABLE prefs(key TEXT PRIMARY KEY,data TEXT); CREATE TABLE roles(roleId INTEGER,name TEXT); CREATE TABLE paths(pathId INTEGER,path TEXT,priority INTEGER,data TEXT);')
  return { ...module, db }
})
import { db } from '../lib/Database.js'
import { PlayerLogoStore, getLogoImage } from './Store.js'
import { createPlayerLogoRouter } from './router.js'
import prefsRouter from '../Prefs/router.js'

let directory: string, png: Buffer, gif: Buffer, base: string, store: PlayerLogoStore
const pushes = vi.fn()
const app = new Koa()
app.silent = true
const server = createServer(app.callback())
const upload = (kind: string, bytes: Buffer, admin = true) => {
  const body = new FormData()
  body.set('file', new Blob([new Uint8Array(bytes)], { type: `image/${kind}` }), `fixture.${kind}`)
  return fetch(`${base}/api/player-logo-images/${kind}`, { method: 'POST', headers: { 'test-admin': String(admin) }, body })
}
const save = (value: unknown) => fetch(`${base}/api/prefs/player-display`, {
  method: 'PUT', headers: { 'test-admin': 'true', 'Content-Type': 'application/json' }, body: JSON.stringify(value),
})

beforeAll(async () => {
  directory = await fs.mkdtemp('/tmp/opencode/logo-api-')
  const sql = await fs.readFile(new URL('../lib/schemas/037-player-logo-images.sql', import.meta.url), 'utf8')
  db.exec(sql.split('-- Down')[0])
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=green@0.5:s=96x48,format=rgba', '-frames:v', '1', '-threads', '1', path.join(directory, 'fixture.png')])
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=s=96x48:r=5', '-t', '1', '-threads', '1', '-loop', '0', path.join(directory, 'fixture.gif')])
  png = await fs.readFile(path.join(directory, 'fixture.png'))
  gif = await fs.readFile(path.join(directory, 'fixture.gif'))
  store = new PlayerLogoStore(path.join(directory, 'images'))
  await store.start()
  app.use(async (ctx, next) => {
    ctx.user = { isAdmin: ctx.get('test-admin') === 'true' } as typeof ctx.user
    ctx.io = { emit: pushes } as unknown as typeof ctx.io
    try {
      await next()
    } catch (error) {
      ctx.status = (error as { status?: number }).status ?? 500
      ctx.body = (error as Error).message
    }
  })
  app.use(createPlayerLogoRouter(store).routes())
  app.use(koaBody())
  app.use(prefsRouter.routes())
  // Koa's callback captures middleware composition, so install the final handler now.
  server.removeAllListeners('request')
  server.on('request', app.callback())
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}, 20000)
afterAll(async () => {
  await store?.stop()
  await new Promise<void>(resolve => server.close(() => resolve()))
  db.close()
  await fs.rm(directory, { recursive: true, force: true })
})

describe('screen image resources', () => {
  it('reports a preparation/storage failure without publishing a resource and releases the upload slot', async () => {
    const prepare = vi.spyOn(store, 'prepare').mockRejectedValueOnce(new Error('Fixture storage failure'))
    try {
      const response = await upload('png', png)
      expect(response.status).toBe(503)
      expect(await response.text()).toContain('Revise el espacio disponible')
      expect(db.all('SELECT * FROM playerLogoImages')).toHaveLength(0)
      expect(await fs.readdir(store.staging)).toEqual([])
    } finally { prepare.mockRestore() }
  })

  it('authenticates before creating files and rejects malformed, disguised or oversized images', async () => {
    expect((await upload('png', png, false)).status).toBe(403)
    for (const [kind, bytes] of [['png', Buffer.from('<svg/>')], ['gif', png], ['gif', gif.subarray(0, -1)]] as const) {
      expect((await upload(kind, bytes)).status).toBe(422)
    }
    expect((await upload('png', Buffer.alloc(5 * 1024 * 1024 + 1))).status).toBe(413)
    expect(db.all('SELECT * FROM playerLogoImages')).toHaveLength(0)
    expect(await fs.readdir(store.staging)).toEqual([])
  })

  it('persists original GIF animation, a PNG poster and independent selections', async () => {
    const staticResponse = await upload('png', png)
    expect(staticResponse.status).toBe(201)
    const still = await staticResponse.json()
    const animatedResponse = await upload('gif', gif)
    expect(animatedResponse.status).toBe(201)
    const animated = await animatedResponse.json()
    expect(animated.frames).toBeGreaterThan(1)
    const media = await fetch(`${base}/api/player-logo-images/${animated.id}/image`)
    expect(media.headers.get('content-type')).toContain('image/gif')
    expect(media.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.from(await media.arrayBuffer())).toEqual(gif)
    const poster = await fetch(`${base}/api/player-logo-images/${animated.id}/poster`)
    expect(poster.headers.get('content-type')).toContain('image/png')
    expect(inspectLogoImage(Buffer.from(await poster.arrayBuffer()), 'png')).toMatchObject({ width: 96, height: 48, frames: 1 })
    const settings = validatePlayerDisplay({ logo: { enabled: true, source: 'custom', mode: 'alternating', staticImageId: still.id, animatedImageId: animated.id } })
    expect((await save(settings)).status).toBe(200)
    pushes.mockClear()
    expect((await save({ ...settings, logo: { ...settings.logo, animatedImageId: still.id } })).status).toBe(422)
    expect((await save({ ...settings, logo: { ...settings.logo, animatedImageId: '00000000-0000-0000-0000-000000000000' } })).status).toBe(422)
    expect(pushes).not.toHaveBeenCalled()
    const configured = JSON.parse(db.get<{ data: string }>('SELECT data FROM prefs WHERE key=?', ['playerDisplay'])!.data)
    expect(configured).toEqual(settings)
    expect((await fetch(`${base}/api/player-logo-images/${still.id}`, { method: 'DELETE', headers: { 'test-admin': 'true' } })).status).toBe(409)
    // Active resources survive cleanup even when old; an abandoned draft is removed.
    const draft = await (await upload('png', png)).json()
    db.run('UPDATE playerLogoImages SET updatedAt=?', [Date.now() - 48 * 60 * 60 * 1000])
    await store.cleanup()
    expect(getLogoImage(still.id)).toBeDefined()
    expect(getLogoImage(animated.id)).toBeDefined()
    expect(getLogoImage(draft.id)).toBeUndefined()
    await expect(fs.stat(path.join(store.directory, draft.id))).rejects.toThrow()
    // Replacement grants the previous selection a grace period for connected players.
    expect((await save(validatePlayerDisplay({}))).status).toBe(200)
    await store.cleanup()
    expect(getLogoImage(animated.id)).toBeDefined()
    expect((await fetch(`${base}/api/player-logo-images/${draft.id}/image`)).status).toBe(404)
  }, 20000)

  it('bounds decoded GIF complexity before invoking a decoder', () => {
    const huge = Buffer.from(gif)
    huge.writeUInt16LE(5000, 6)
    expect(() => inspectLogoImage(huge, 'gif')).toThrow('1024')
    const duration = Buffer.from(gif)
    const gce = duration.indexOf(Buffer.from([0x21, 0xf9, 0x04]))
    expect(gce).toBeGreaterThan(0)
    duration.writeUInt16LE(4000, gce + 4)
    expect(() => inspectLogoImage(duration, 'gif')).toThrow('complejo')
    const paletteEnd = 13 + ((gif[10] & 128) ? 3 * 2 ** ((gif[10] & 7) + 1) : 0)
    const header = Buffer.from(gif.subarray(0, paletteEnd))
    header.writeUInt16LE(1024, 6)
    header.writeUInt16LE(1024, 8)
    const body = gif.subarray(paletteEnd, -1)
    expect(() => inspectLogoImage(Buffer.concat([header, body, body, body, body, Buffer.from([0x3b])]), 'gif')).toThrow('complejo')
  })
})

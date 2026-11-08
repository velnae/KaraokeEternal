import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Koa from 'koa'
import { koaBody } from 'koa-body'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { defaultClientBranding } from '../../shared/branding.js'
import { defaultPlayerDisplay } from '../../shared/playerDisplay.js'
import { PREFS_PUSH } from '../../shared/actionTypes.js'
import { defaultModeration } from '../../shared/textModeration.js'

vi.mock('../lib/Database.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/Database.js')>()
  const db = new original.DatabaseWrapper(':memory:')
  db.exec(`
    CREATE TABLE prefs (key TEXT PRIMARY KEY, data TEXT);
    CREATE TABLE roles (roleId INTEGER, name TEXT);
    CREATE TABLE paths (pathId INTEGER, path TEXT, priority INTEGER, data TEXT);
  `)
  return { ...original, db }
})

import { db } from '../lib/Database.js'
import Prefs from './Prefs.js'
import router from './router.js'

const emit = vi.fn()
const app = new Koa()
app.use(async (ctx, next) => {
  ctx.user = { isAdmin: ctx.get('test-admin') === 'true' } as typeof ctx.user
  ctx.io = { emit } as unknown as typeof ctx.io
  await next()
})
app.use(koaBody())
app.use(router.routes())
const server = createServer(app.callback())
let base: string

beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/prefs`
})
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  db.close()
})
beforeEach(() => {
  db.exec('DELETE FROM prefs; DELETE FROM roles; DELETE FROM paths;')
  Prefs.set('jwtKey', 'private-key')
  Prefs.set('privateSetting', 'private-value')
  emit.mockClear()
})

const save = (body: unknown, admin = true) => fetch(`${base}/branding`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'test-admin': String(admin) },
  body: JSON.stringify(body),
})

describe('branding HTTP and persistence contract', () => {
  it('exposes defaults before login without leaking private preferences', async () => {
    const response = await fetch(base)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ roles: { result: [], entities: {} }, branding: defaultClientBranding, moderation: defaultModeration })
  })

  it('persists admin changes and broadcasts only public branding', async () => {
    const branding = {
      ...defaultClientBranding,
      name: 'Venue',
      logoSrc: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
      supportUrl: 'https://example.com/help',
    }
    const response = await save({ ...branding, supportUrl: ' HTTPS:example.com/help ' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ branding })
    expect(Prefs.get().branding).toEqual(branding)
    expect(db.get<{ data: string }>('SELECT data FROM prefs WHERE key = ?', ['branding'])?.data).toBe(JSON.stringify(branding))
    expect(emit).toHaveBeenCalledWith('action', { type: PREFS_PUSH, payload: { branding } })
    expect(await (await fetch(base)).json()).toMatchObject({ roles: { result: [], entities: {} }, branding, moderation: defaultModeration })
  })

  it('denies non-admin writes without persisting or broadcasting', async () => {
    expect((await save({ ...defaultClientBranding, name: 'Unauthorized' }, false)).status).toBe(401)
    expect(Prefs.get().branding).toEqual(defaultClientBranding)
    expect(emit).not.toHaveBeenCalled()
  })

  it('loads older saved brands independently of screen defaults', async () => {
    const legacy = { name: 'Existing venue', logoSrc: '', supportUrl: '' }
    db.run('INSERT INTO prefs (key, data) VALUES (?, ?)', ['branding', JSON.stringify(legacy)])
    expect(await (await fetch(base)).json()).toMatchObject({ branding: legacy, playerDisplay: defaultPlayerDisplay })
    expect(JSON.parse(db.get<{ data: string }>('SELECT data FROM prefs WHERE key = ?', ['branding'])!.data)).toEqual(legacy)
  })

  it('rejects invalid changes atomically and allows resetting the brand', async () => {
    const branding = { ...defaultClientBranding, name: 'Original' }
    await save(branding)
    emit.mockClear()
    const response = await save({ ...branding, supportUrl: 'javascript:alert(1)' })
    expect(response.status).toBe(422)
    expect(Prefs.get().branding).toEqual(branding)
    expect(emit).not.toHaveBeenCalled()
    expect((await save(defaultClientBranding)).status).toBe(200)
    expect(Prefs.get().branding).toEqual(defaultClientBranding)
  })
})

const saveDisplay = (body: unknown, admin = true) => fetch(`${base}/player-display`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json', 'test-admin': String(admin) }, body: JSON.stringify(body),
})

describe('global player display HTTP contract', () => {
  it('persists and broadcasts a global configuration independently from brand identity', async () => {
    const playerDisplay = { ...defaultPlayerDisplay, logo: { ...defaultPlayerDisplay.logo, enabled: true },
      announcement: { ...defaultPlayerDisplay.announcement, enabled: true, alignment: 'center', backgroundColor: '#6b5143' } }
    expect((await saveDisplay(playerDisplay)).status).toBe(200)
    expect(Prefs.get().playerDisplay).toEqual(playerDisplay)
    expect(emit).toHaveBeenCalledWith('action', { type: PREFS_PUSH, payload: { playerDisplay } })
    await save({ ...defaultClientBranding, name: 'New venue', player: { showLogo: false } })
    await save(defaultClientBranding)
    expect(Prefs.get().playerDisplay).toEqual(playerDisplay)
    expect(await (await fetch(base)).json()).toMatchObject({ playerDisplay })
  })

  it('rejects non-admin and invalid writes without persistence or push', async () => {
    expect((await saveDisplay(defaultPlayerDisplay, false)).status).toBe(403)
    expect((await saveDisplay({ announcement: { backgroundColor: 'transparent' } })).status).toBe(422)
    expect((await saveDisplay({ logo: { scale: 301 } })).status).toBe(422)
    expect(Prefs.get().playerDisplay).toEqual(defaultPlayerDisplay)
    expect(db.get('SELECT data FROM prefs WHERE key=?', ['playerDisplay'])).toBeUndefined()
    expect(emit).not.toHaveBeenCalled()
  })

  it('does not broadcast when persistence fails', async () => {
    const set = vi.spyOn(Prefs, 'set').mockReturnValueOnce(false)
    try {
      expect((await saveDisplay(defaultPlayerDisplay)).status).toBe(500)
      expect(emit).not.toHaveBeenCalled()
    } finally { set.mockRestore() }
  })
})

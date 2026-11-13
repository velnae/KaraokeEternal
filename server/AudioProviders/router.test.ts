import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import Koa from 'koa'
import { koaBody } from 'koa-body'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { open, close, db } from '../lib/Database.js'
import { defaultBirthdaySettings } from '../../shared/birthdays.js'
import router from './router.js'

const production = vi.hoisted(() => ({
  capabilities: () => ({ providers: [{ id: 'elevenlabs', models: { voice: 'eleven_v4', effect: 'effect-model' } }] }),
  check: vi.fn().mockResolvedValue([{ voiceId: 'animator-voice', name: 'Animator' }]),
}))
vi.mock('../Animation/Production.js', () => ({ getProduction: () => production }))
const originalFetch = globalThis.fetch
const providerRequests: string[] = []
const app = new Koa()
app.use(async (ctx, next) => {
  ctx.user = { isAdmin: ctx.get('test-admin') === 'true', roomId: Number(ctx.get('test-room') || 1) } as typeof ctx.user
  await next()
})
app.use(koaBody())
app.use(router.routes())
const server = createServer(app.callback())
let base: string
beforeAll(async () => {
  open({ file: ':memory:', ro: false })
  db.run('INSERT INTO rooms(roomId,name,status,data) VALUES(1,\'One\',\'open\',\'{}\'),(2,\'Two\',\'open\',\'{}\')')
  for (const [roomId, model] of [[1, 'birthday-one'], [2, 'birthday-two']] as const) {
    db.run('INSERT INTO birthdaySettings(roomId,data) VALUES(?,?)', [roomId, JSON.stringify({ ...defaultBirthdaySettings, speechModel: model })])
  }
  vi.stubEnv('KES_GEMINI_API_KEY', 'private-provider-key')
  vi.stubEnv('KES_ELEVENLABS_API_KEY', 'private-provider-key')
  vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], options?: RequestInit) => {
    const url = new URL(String(input))
    if (url.hostname !== 'generativelanguage.googleapis.com') return originalFetch(input, options)
    providerRequests.push(url.toString())
    if (url.pathname.endsWith('/voices')) return Response.json({ voices: [{ id: 'Sulafat', display_name: 'Sulafat' }] })
    return Response.json({ name: `models/${url.pathname.split('/').at(-1)}`, supportedGenerationMethods: ['generateContent'] })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/audio-providers`
})
beforeEach(() => {
  providerRequests.length = 0
  production.check.mockClear()
})
afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
  close()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
const call = (suffix = '', method = 'GET', body?: unknown, admin = true, room = 1) => originalFetch(`${base}${suffix}`, {
  method, headers: { 'test-admin': String(admin), 'test-room': String(room), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
})

it('denies provider metadata, checks and voices to non-administrators', async () => {
  expect((await call('', 'GET', undefined, false)).status).toBe(403)
  expect((await call('/gemini/check', 'POST', { use: 'greetings' }, false)).status).toBe(403)
  expect((await call('/gemini/voices?use=greetings', 'GET', undefined, false)).status).toBe(403)
  expect((await call('/call-voice', 'PUT', {}, false)).status).toBe(403)
  expect(providerRequests).toEqual([])
})

it('lists both configured providers with room-specific models without contacting or exposing credentials', async () => {
  const first = await call()
  expect(first.headers.get('cache-control')).toContain('no-store')
  const text = await first.text()
  expect(text).not.toContain('private-provider-key')
  const overview = JSON.parse(text)
  expect(overview.providers.map(item => item.id)).toEqual(['elevenlabs', 'gemini'])
  expect(overview.providers[1].checks).toContainEqual({ use: 'birthdays', model: 'birthday-one' })
  const second = await (await call('', 'GET', undefined, true, 2)).json()
  expect(second.providers[1].checks).toContainEqual({ use: 'birthdays', model: 'birthday-two' })
  expect(providerRequests).toEqual([])
})

it('preserves the catalog verification side effect for voice and sound-effect lookups', async () => {
  expect((await call('/elevenlabs/voices?use=catalog&kind=effect')).status).toBe(200)
  expect(production.check).toHaveBeenCalledWith('elevenlabs', 'effect')
  expect((await call('/elevenlabs/check', 'POST', { use: 'catalog' })).status).toBe(200)
  expect(production.check).toHaveBeenCalledWith('elevenlabs', 'voice')
})

it('checks saved models and queries regional voices without generating audio or consuming a request', async () => {
  expect((await call('/gemini/check', 'POST', { use: 'birthdays' }, true, 2)).status).toBe(200)
  expect(providerRequests[0]).toContain('birthday-two')
  const response = await call('/gemini/voices?use=birthdays&model=birthday-one&language=es-PE')
  expect(await response.json()).toEqual({ voices: [{ voiceId: 'Sulafat', name: 'Sulafat' }] })
  expect(providerRequests.at(-1)).toContain('language_code=es-PE')
  expect(providerRequests.every(url => !url.includes(':generateContent'))).toBe(true)
  expect(db.get<{ n: number }>('SELECT count(*) n FROM greetingVoiceRequests')!.n).toBe(0)
})

it('rejects unsupported uses and malformed selections before contacting a provider', async () => {
  for (const [provider, body] of [['gemini', { use: 'catalog' }], ['elevenlabs', { use: 'names' }], ['missing', { use: 'greetings' }], ['gemini', { use: 'names', model: [] }], ['gemini', []]] as const) {
    expect((await call(`/${provider}/check`, 'POST', body)).status).toBe(422)
  }
  expect((await call('/gemini/voices?use=birthday-text')).status).toBe(422)
  expect((await call('/gemini/voices?use=birthdays&language=invalid')).status).toBe(422)
  expect((await call('/elevenlabs/check', 'POST', { use: 'catalog', model: 'wrong-model' })).status).toBe(422)
  expect(production.check).not.toHaveBeenCalled()
  expect(providerRequests).toEqual([])
})

it('saves versioned call defaults independently without provider calls and rejects stale writes', async () => {
  const initial = await (await call('/call-voice')).json()
  const updated = await call('/call-voice', 'PUT', { ...initial, model: 'gemini-3.8-flash-tts', voice: 'Kore' })
  expect(updated.status).toBe(200)
  expect(await updated.json()).toMatchObject({ voice: 'Kore', revision: initial.revision + 1 })
  expect((await call('/call-voice', 'PUT', initial)).status).toBe(409)
  expect((await call('/call-voice', 'PUT', { ...initial, apiKey: 'secret' })).status).toBe(422)
  expect(providerRequests).toEqual([])
})

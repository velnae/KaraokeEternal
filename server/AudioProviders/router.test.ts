import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import Koa from 'koa'
import { koaBody } from 'koa-body'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { open, close, db } from '../lib/Database.js'
import { defaultBirthdaySettings } from '../../shared/birthdays.js'
import router from './router.js'
import greetingRouter from '../Greetings/voiceRouter.js'
import birthdayRouter from '../Birthdays/router.js'

const production = vi.hoisted(() => ({
  capabilities: () => ({ providers: [{ id: 'elevenlabs', models: { voice: 'eleven_v4', effect: 'effect-model' } }] }),
  check: vi.fn().mockResolvedValue([{ voiceId: 'animator-voice', name: 'Animator' }]),
}))
vi.mock('../Animation/Production.js', () => ({ getProduction: () => production }))
const originalFetch = globalThis.fetch
const providerRequests: string[] = []
const generatedProfiles: Record<string, unknown>[] = []
const app = new Koa()
app.use(async (ctx, next) => {
  ctx.user = { isAdmin: ctx.get('test-admin') === 'true', roomId: Number(ctx.get('test-room') || 1) } as typeof ctx.user
  await next()
})
app.use(koaBody())
app.use(router.routes())
app.use(greetingRouter.routes())
app.use(birthdayRouter.routes())
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
    if (url.pathname.endsWith(':generateContent')) {
      generatedProfiles.push(JSON.parse(options!.body as string))
      return Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from('524946462800000057415645666d74201000000001000100c05d000080bb000002001000646174610400000000000000', 'hex').toString('base64') } }] } }] })
    }
    if (url.pathname.endsWith('/voices/voice_host')) return Response.json({ id: 'voice_host', display_name: 'Warm Host' })
    if (url.searchParams.get('search') === 'Warm Host') return Response.json({ voices: [{ id: 'voice_host', display_name: 'Warm Host' }] })
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
  expect((await call('/gemini/resolve-voice', 'POST', { model: 'gemini-3.8-flash-tts', voice: 'Orus' }, false)).status).toBe(403)
  expect((await call('/gemini/preview', 'POST', {}, false)).status).toBe(403)
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

it('validates exact names without audio and prevents invalid call defaults from being saved', async () => {
  const initial = await (await call('/call-voice')).json()
  const resolved = await call('/gemini/resolve-voice', 'POST', { model: initial.model, voice: 'Orus' })
  expect(await resolved.json()).toEqual({ voiceId: 'Orus', name: 'Orus' })
  expect(providerRequests).toEqual([])
  expect((await call('/call-voice', 'PUT', { ...initial, voice: 'Typo' })).status).toBe(422)
  expect(await (await call('/call-voice')).json()).toEqual(initial)
  const saved = await call('/call-voice', 'PUT', { ...initial, voice: 'Warm Host', style: '' })
  expect(await saved.json()).toMatchObject({ voice: 'voice_host', style: '' })
  expect(providerRequests.every(url => !url.includes(':generateContent'))).toBe(true)
})

const sibling = (suffix: string, method = 'GET', body?: unknown) => originalFetch(`${base.replace('/audio-providers', '')}/${suffix}`, {
  method, headers: { 'test-admin': 'true', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
})

it('validates greeting and birthday names on save and preserves settings on an invalid audition', async () => {
  const greeting = await (await sibling('prefs/greeting-voice')).json()
  expect((await sibling('prefs/greeting-voice', 'PUT', { ...greeting.config, voice: 'Typo' })).status).toBe(422)
  expect((await (await sibling('prefs/greeting-voice')).json()).config).toEqual(greeting.config)
  const saved = await sibling('prefs/greeting-voice', 'PUT', { ...greeting.config, voice: 'Warm Host', style: '' })
  expect((await saved.json()).config).toMatchObject({ voice: 'voice_host', style: '' })
  const initial = (await (await sibling('birthdays/')).json()).settings
  const config = { ...initial, defaultVoiceId: 'Warm Host', speechStyle: '', rules: [{ id: 'all', sex: 'any', minAge: 0, maxAge: 120, voiceId: 'Orus' }] }
  const birthday = await sibling('birthdays/settings', 'PUT', config)
  expect(birthday.status).toBe(200)
  const current = await birthday.json()
  expect(current).toMatchObject({ defaultVoiceId: 'voice_host', speechStyle: '', rules: [{ voiceId: 'voice_host', style: '', history: false }] })
  expect((await sibling('birthdays/audition', 'POST', { config: { ...current, defaultVoiceId: 'Typo' } })).status).toBe(422)
  expect((await (await sibling('birthdays/')).json()).settings).toEqual(current)
  expect(providerRequests.every(url => !url.includes(':generateContent'))).toBe(true)
})

it('previews drafts without persisting them and accounts each generation against the shared budget', async () => {
  const calls = await (await call('/call-voice')).json()
  const greeting = await (await sibling('prefs/greeting-voice')).json()
  const before = db.get<{ n: number }>('SELECT count(*) n FROM greetingVoiceRequests')!.n
  const response = await call('/gemini/preview', 'POST', { use: 'calls', model: 'gemini-3.8-flash-lite-tts', voice: 'Orus', style: 'Warm and upbeat.' })
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('audio/wav')
  expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(44)
  expect(generatedProfiles.at(-1)).toMatchObject({ contents: [{ parts: [{ speech_metadata: { style: 'Warm and upbeat.' } }] }], generationConfig: { speechConfig: { voiceConfig: { voice: 'Orus' } } } })
  expect(await (await call('/call-voice')).json()).toEqual(calls)
  expect((await (await sibling('prefs/greeting-voice')).json()).config).toEqual(greeting.config)
  expect(db.get<{ n: number }>('SELECT count(*) n FROM greetingVoiceRequests')!.n).toBe(before + 1)
  expect(db.get<{ n: number }>('SELECT count(*) n FROM animationInterventions')!.n).toBe(0)
  for (let i = 0; i < 2; i++) expect((await call('/gemini/preview', 'POST', { use: 'names', model: 'gemini-3.8-flash-tts', voice: 'Kore', style: '' })).status).toBe(200)
  expect(generatedProfiles.at(-1)).toMatchObject({ contents: [{ parts: [{ text: 'María', speech_metadata: { style: '' } }] }], generationConfig: { speechConfig: { voiceConfig: { voice: calls.voice } } } })
  expect((await call('/gemini/preview', 'POST', { use: 'greetings', model: 'gemini-3.8-flash-tts', voice: 'Orus', style: '' })).status).toBe(422)
  expect(db.get<{ n: number }>('SELECT count(*) n FROM greetingVoiceRequests')!.n).toBe(before + 3)
})

import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import Koa from 'koa'
import { koaBody } from 'koa-body'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { open, close, db } from '../lib/Database.js'
import prefsRouter from '../Prefs/router.js'
import router from './voiceRouter.js'
import { startGreetingAudio } from './audioRouter.js'
import { defaultGreetingVoiceConfig } from '../../shared/greetingVoice.js'

const originalFetch = globalThis.fetch
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
let stop: () => Promise<void>
let generated = 0
beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ke-gemini-http-'))
  const file = path.join(directory, 'fixture.wav')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=24000', '-t', '0.4', file])
  const wav = await fs.readFile(file)
  vi.stubEnv('KES_GEMINI_API_KEY', 'fixture-secret')
  vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], options?: RequestInit) => {
    if (!String(input).startsWith('https://generativelanguage.googleapis.com/')) return originalFetch(input, options)
    if (String(input).endsWith(':generateContent')) {
      generated++
      return Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: wav.toString('base64') } }] } }] })
    }
    return Response.json({ name: `models/${defaultGreetingVoiceConfig.model}`, supportedGenerationMethods: ['generateContent'] })
  })
  open({ file: ':memory:', ro: false })
  db.run(`UPDATE prefs SET data='false' WHERE key='isFirstRun'`)
  stop = startGreetingAudio(path.join(directory, 'audio'))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/prefs`
})
afterAll(async () => {
  await stop()
  await new Promise<void>(resolve => server.close(() => resolve()))
  close()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await fs.rm(directory, { recursive: true, force: true })
})
const call = (suffix = '', method = 'GET', body?: object, admin = true) => fetch(`${base}/greeting-voice${suffix}`, {
  method, headers: { 'test-admin': String(admin), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
})

it('denies settings, checks and previews to non-admins without generating speech', async () => {
  for (const [suffix, method] of [['', 'GET'], ['', 'PUT'], ['/check', 'POST'], ['/preview', 'POST']]) {
    expect((await call(suffix, method, method === 'PUT' ? {} : undefined, false)).status).toBe(403)
  }
  expect(generated).toBe(0)
})

it('stores only validated versioned settings and never exposes the server key', async () => {
  const first = await (await call()).json()
  expect(first.config).toEqual(defaultGreetingVoiceConfig)
  expect((await call('', 'PUT', { ...first.config, apiKey: 'secret' })).status).toBe(422)
  const response = await call('', 'PUT', { ...first.config, enabled: true })
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toContain('no-store')
  expect(JSON.stringify(await response.json())).not.toContain('fixture-secret')
  expect((await call('', 'PUT', first.config)).status).toBe(409)
  expect(JSON.stringify(await (await fetch(base)).json())).not.toContain('greetingVoice')
  expect(JSON.stringify(db.all('SELECT * FROM prefs'))).not.toContain('fixture-secret')
  expect((await fetch(`${base}/local-tts`)).status).toBe(404)
})

it('checks model access without consuming the generation budget', async () => {
  expect((await call('/check', 'POST')).status).toBe(200)
  expect(generated).toBe(0)
  expect(db.get<{ n: number }>('SELECT count(*) n FROM greetingVoiceRequests')?.n).toBe(0)
})

it('generates a private normalized preview under the same persistent budget', async () => {
  const response = await call('/preview', 'POST')
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('audio/mpeg')
  expect(response.headers.get('cache-control')).toContain('private')
  expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(1000)
  expect(generated).toBe(1)
  expect(db.get<{ n: number }>('SELECT count(*) n FROM greetingVoiceRequests')?.n).toBe(1)
  expect(await fs.readdir(path.join(directory, 'audio/production'))).toEqual([])
  expect(db.get<{ n: number }>('SELECT count(*) n FROM greetingTurns')?.n).toBe(0)
})

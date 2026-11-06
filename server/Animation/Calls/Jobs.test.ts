import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { parseBuffer } from 'music-metadata'
import Koa from 'koa'
import { koaBody } from 'koa-body'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { open, close, db } from '../../lib/Database.js'
import Tables from '../../Tables/Tables.js'
import GreetingVoice from '../../Greetings/GreetingVoice.js'
import { GreetingVoiceError, type GreetingVoiceProvider } from '../../Greetings/GeminiGreetingTts.js'
import { callContinuation, callText, defaultTableCallText, type CallJob } from '../../../shared/karaokeCalls.js'
import CallJobs from './Jobs.js'
import { createCallRouter } from './router.js'
import { binding, job, tableVoice } from './Store.js'

let directory: string
let fixture: Buffer
let worker: CallJobs
let voice: GreetingVoice
let provider: GreetingVoiceProvider
let tableId: number
const input = () => ({ requestId: randomUUID() })
beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'call-pilot-test-'))
  const source = path.join(directory, 'fixture.wav')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=24000', '-t', '0.4', source])
  fixture = await fs.readFile(source)
})
beforeEach(async () => {
  open({ file: ':memory:', ro: false })
  db.run('INSERT OR IGNORE INTO rooms(roomId,name,status) VALUES(1,\'One\',\'open\'),(2,\'Two\',\'open\')')
  tableId = Tables.save(1, undefined, { code: '07' })
  provider = { configured: true, check: vi.fn().mockResolvedValue(undefined), generate: vi.fn().mockResolvedValue(fixture) }
  voice = new GreetingVoice(provider)
  voice.configure({ ...voice.config(), requestsPerMinute: 1000, requestsPerDay: 1000 })
  worker = new CallJobs(await fs.mkdtemp(path.join(directory, 'case-')), voice)
  await worker.start()
})
afterEach(async () => {
  await worker.stop()
  close()
})
afterAll(async () => fs.rm(directory, { recursive: true, force: true }))
const intro = () => worker.submit(1, 'intro', { ...input(), title: 'Vamos', text: '¡Vamos con el karaoke!' })
const table = () => worker.submit(1, 'table', { ...input(), revision: binding(1, tableId)?.revision ?? 0, text: 'Desde la mesa siete,' }, tableId)
async function finish (item: CallJob) {
  await worker.tick()
  const result = worker.snapshot(1).jobs.find(row => row.id === item.id)!
  expect(result.status, result.error ?? '').toBe('ready')
  return result.result!
}
async function setup () {
  const first = await finish(intro())
  await finish(table())
  return { ...input(), introId: first.id, tableId, performer: 'Ana', song: 'Rayando el sol' }
}

it('validates plain spoken content and renders numeric and custom table codes', () => {
  expect(defaultTableCallText('01')).toBe('Desde la mesa uno,')
  expect(defaultTableCallText('14')).toBe('Desde la mesa catorce,')
  expect(defaultTableCallText('Terraza')).toBe('Desde la mesa Terraza,')
  expect(callContinuation(' Ana ', 'Rayando el sol')).toBe('recibamos a Ana con Rayando el sol. ¡Un aplauso!')
  for (const text of ['', '<laugh>', '[excited]', 'hola\u0000', 'a'.repeat(221)]) expect(() => callText(text)).toThrow()
})

it('prepares a private hybrid and full reference, sharing Gemini budget without enabling public speech', async () => {
  const body = await setup()
  const hybrid = await finish(worker.submit(1, 'hybrid', body))
  const full = await finish(worker.submit(1, 'reference', { ...body, ...input() }))
  expect(hybrid.text).toBe('¡Vamos con el karaoke! Desde la mesa siete, recibamos a Ana con Rayando el sol. ¡Un aplauso!')
  const audio = await worker.bytes(1, hybrid.id)
  const info = await parseBuffer(audio, { mimeType: 'audio/mpeg' }, { duration: true })
  expect(info.format.duration).toBeGreaterThan(1)
  expect(info.format.duration).toBeLessThan(10)
  expect(full.kind).toBe('reference')
  expect(provider.generate).toHaveBeenCalledTimes(4)
  expect(voice.snapshot().usage.day).toBe(4)
  expect(voice.config().enabled).toBe(false)
  expect(db.get<{ n: number }>('SELECT count(*) n FROM audioResources')!.n).toBe(0)
  expect(db.get<{ n: number }>('SELECT count(*) n FROM animationInterventions')!.n).toBe(0)
  expect(db.get<{ n: number }>('SELECT count(*) n FROM audioUsage')!.n).toBe(0)
  expect(JSON.stringify(worker.snapshot(1))).not.toContain('masters/')
  const calls = vi.mocked(provider.generate).mock.calls
  expect(calls[1][0]).toBe('Desde la mesa siete,')
  expect(calls[1][1].style).toContain('continuing intonation')
})

it('deduplicates lost acknowledgments and unchanged compositions without new generation', async () => {
  const body = await setup()
  const initial = worker.submit(1, 'hybrid', body)
  expect(worker.submit(1, 'hybrid', body).id).toBe(initial.id)
  const prepared = await finish(initial)
  expect(() => worker.submit(1, 'hybrid', { ...body, song: 'Changed' })).toThrow('otra preparación')
  const reused = await finish(worker.submit(1, 'hybrid', { ...body, ...input() }))
  expect(reused.id).toBe(prepared.id)
  expect(provider.generate).toHaveBeenCalledTimes(3)
})

it('reuses an unchanged introduction and regenerates only an explicitly requested new take', async () => {
  const original = await finish(intro())
  const repeated = await finish(intro())
  expect(repeated.id).toBe(original.id)
  expect(provider.generate).toHaveBeenCalledTimes(1)
  const replacement = await finish(worker.submit(1, 'intro', { ...input(), title: 'Vamos', text: original.text, previousId: original.id, regenerate: true }))
  expect(replacement.id).not.toBe(original.id)
  expect(worker.snapshot(1).intros).toHaveLength(1)
  expect(provider.generate).toHaveBeenCalledTimes(2)
})

it('rejects foreign room pieces and unchanged request IDs with changed table input', async () => {
  const body = await setup()
  const foreign = Tables.save(2, undefined, { code: '07' })
  expect(() => worker.submit(2, 'hybrid', { ...body, tableId: foreign })).toThrow('introducción')
  await expect(worker.bytes(2, body.introId)).rejects.toThrow('disponible')
  const request = { ...input(), text: 'Desde la mesa siete,', revision: 1 }
  const first = worker.submit(1, 'table', request, tableId)
  expect(worker.submit(1, 'table', request, tableId).id).toBe(first.id)
  await finish(first)
  expect(() => worker.submit(1, 'table', { ...request, ...input() }, tableId)).toThrow('cambió')
})

it('preserves QR and old audio when a replacement fails, and flags changed speech', async () => {
  const old = await finish(table())
  const token = Tables.credential(1, tableId)
  vi.mocked(provider.generate).mockRejectedValueOnce(new GreetingVoiceError('No reply', 'uncertain'))
  const failed = worker.submit(1, 'table', { ...input(), revision: 1, text: 'Desde nuestra mesa siete,', regenerate: true }, tableId)
  await worker.tick()
  expect(job(1, failed.id)?.status).toBe('uncertain')
  expect(binding(1, tableId)?.partId).toBe(old.id)
  expect(tableVoice(1, tableId, voice.profile()).outdated).toBe(true)
  expect(Tables.credential(1, tableId)).toBe(token)
  await worker.tick()
  expect(provider.generate).toHaveBeenCalledTimes(2)
})

it('rejects stale code/profile results and cancelled late provider responses', async () => {
  let release!: (bytes: Buffer) => void
  vi.mocked(provider.generate).mockImplementationOnce(() => new Promise((resolve) => {
    release = resolve
  }))
  const pending = table()
  Tables.save(1, tableId, { code: '08' })
  release(fixture)
  await worker.tick()
  expect(job(1, pending.id)?.status).toBe('failed')
  expect(binding(1, tableId)?.partId).toBeNull()
  vi.mocked(provider.generate).mockImplementationOnce(() => new Promise((resolve) => {
    release = resolve
  }))
  const cancelled = intro()
  worker.cancel(1, cancelled.id)
  release(fixture)
  await worker.tick()
  expect(job(1, cancelled.id)?.status).toBe('cancelled')
  expect(worker.snapshot(1).intros).toHaveLength(0)
  const saved = await finish(intro())
  voice.configure({ ...voice.config(), voice: 'Kore' })
  expect(worker.snapshot(1).profileKey).not.toBe(saved.profileKey)
})

it('invalidates a previously ready composite when table binding changes', async () => {
  const body = await setup()
  const item = worker.submit(1, 'hybrid', body)
  await finish(item)
  Tables.save(1, tableId, { code: '14' })
  expect(worker.snapshot(1).jobs.find(row => row.id === item.id)?.outdated).toBe(true)
  expect(() => worker.submit(1, 'hybrid', { ...body, ...input() })).toThrow('Prepare')
})

it('rejects a queued composition when a replacement finishes after its table snapshot was taken', async () => {
  const body = await setup()
  let release!: (bytes: Buffer) => void
  vi.mocked(provider.generate).mockImplementationOnce(() => new Promise((resolve) => {
    release = resolve
  }))
  const replacing = worker.submit(1, 'table', { ...input(), revision: 1, text: 'Desde la mesa siete,', regenerate: true }, tableId)
  const preview = worker.submit(1, 'hybrid', body)
  release(fixture)
  await finish(replacing)
  await worker.tick()
  expect(job(1, preview.id)?.status).toBe('failed')
  expect(job(1, preview.id)?.error).toContain('cambiaron')
  expect(provider.generate).toHaveBeenCalledTimes(3)
})

it('does not replay an interrupted provider request after worker restart', async () => {
  await worker.stop()
  db.run(`INSERT INTO karaokeCallJobs(id,roomId,requestId,operation,requestJSON,inputJSON,profileJSON,text,status,createdAt,updatedAt)
    VALUES('interrupted',1,'interrupted','intro','{}','{}',?,'Hola','generating',0,0)`, [JSON.stringify(voice.profile())])
  worker = new CallJobs(await fs.mkdtemp(path.join(directory, 'restart-')), voice)
  await worker.start()
  await worker.tick()
  expect(job(1, 'interrupted')?.status).toBe('uncertain')
  expect(provider.generate).not.toHaveBeenCalled()
})

it('rejects malformed or overlong audio without attaching a table recording', async () => {
  vi.mocked(provider.generate).mockResolvedValueOnce(Buffer.from('not wave'))
  const failed = table()
  await worker.tick()
  expect(job(1, failed.id)?.status).toBe('failed')
  expect(binding(1, tableId)?.partId).toBeNull()
  const long = path.join(directory, 'long.wav')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=24000', '-t', '10.1', long])
  vi.mocked(provider.generate).mockResolvedValueOnce(await fs.readFile(long))
  const tooLong = table()
  await worker.tick()
  expect(job(1, tooLong.id)?.error).toContain('10 segundos')
})

it('serves only authenticated room-scoped previews without exposing source files', async () => {
  const app = new Koa()
  app.use(async (ctx, next) => {
    ctx.user = { isAdmin: ctx.get('test-admin') === 'true' } as typeof ctx.user
    await next()
  })
  app.use(koaBody())
  app.use(createCallRouter(() => worker).routes())
  const server = createServer(app.callback())
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/rooms`
  try {
    expect((await fetch(`${base}/1/karaoke-calls`)).status).toBe(403)
    const response = await fetch(`${base}/1/karaoke-calls/intros`, { method: 'POST', headers: { 'test-admin': 'true', 'content-type': 'application/json' }, body: JSON.stringify({ ...input(), title: 'Hello', text: 'Hola' }) })
    expect(response.status).toBe(202)
    const audio = await finish(await response.json() as CallJob)
    const get = (room: number, admin = true) => fetch(`${base}/${room}/karaoke-calls/audio/${audio.id}`, { headers: { 'test-admin': String(admin) } })
    expect((await get(1, false)).status).toBe(403)
    expect((await get(2)).status).toBe(404)
    const valid = await get(1)
    expect(valid.headers.get('content-type')).toContain('audio/mpeg')
    expect(valid.headers.get('cache-control')).toContain('private')
    expect((await valid.arrayBuffer()).byteLength).toBeGreaterThan(1000)
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})

it('rejects the complete composition when individually valid pieces exceed ten seconds together', async () => {
  const file = path.join(directory, 'long-pieces.wav')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=24000', '-t', '3.5', file])
  vi.mocked(provider.generate).mockResolvedValue(await fs.readFile(file))
  const body = await setup()
  const combined = worker.submit(1, 'hybrid', body)
  await worker.tick()
  expect(job(1, combined.id)?.status).toBe('failed')
  expect(job(1, combined.id)?.error).toContain('10')
  expect(job(1, combined.id)?.resultId).toBeNull()
})

it('retires old pilot outputs while preserving current table and introduction assets', async () => {
  const body = await setup()
  let first = ''
  for (let index = 0; index < 11; index++) {
    const result = await finish(worker.submit(1, 'reference', { ...body, ...input(), performer: `Cantante ${index}` }))
    if (!index) first = result.id
  }
  await expect(worker.bytes(1, first)).rejects.toThrow('disponible')
  const state = worker.snapshot(1)
  expect(state.jobs.filter(item => item.operation === 'reference' && item.result)).toHaveLength(10)
  expect((await worker.bytes(1, state.intros[0].id)).length).toBeGreaterThan(1000)
  expect((await worker.bytes(1, state.tables[0].part!.id)).length).toBeGreaterThan(1000)
}, 20000)

import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import Koa from 'koa'
import { koaBody } from 'koa-body'
import { open, close, db } from '../../lib/Database.js'
import Tables from '../../Tables/Tables.js'
import GreetingVoice from '../../Greetings/GreetingVoice.js'
import type { SpeechProvider } from '../../AudioProviders/types.js'
import CallJobs from './Jobs.js'
import { job, binding } from './Store.js'
import { prepareKaraokePreview, readKaraokePreview, saveKaraokePreview } from './Preview.js'
import { createCallRouter } from './router.js'
import type { CallJob } from '../../../shared/karaokeCalls.js'
import type { KaraokePreviewDraft } from '../../../shared/karaokePreview.js'

let root: string
let directory: string
let wave: Buffer
let worker: CallJobs
let provider: SpeechProvider
let voice: GreetingVoice
let tableId: number
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'karaoke-preview-'))
  const fixture = path.join(root, 'voice.wav')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=24000', '-t', '0.15', fixture])
  wave = await fs.readFile(fixture)
})
beforeEach(async () => {
  open({ file: ':memory:', ro: false })
  db.run(`INSERT INTO rooms(roomId,name,status) VALUES(1,'One','open'),(2,'Two','open')`)
  db.run(`INSERT INTO users(userId,username,name,password,roleId) VALUES(1,'one','One','test',1),(2,'two','Two','test',1)`)
  tableId = Tables.save(1, undefined, { code: '07' })
  provider = { configured: true, check: vi.fn(), generate: vi.fn().mockResolvedValue(wave) }
  voice = new GreetingVoice(provider)
  voice.configure({ ...voice.config(), requestsPerMinute: 1000, requestsPerDay: 10000 })
  directory = await fs.mkdtemp(path.join(root, 'case-'))
  worker = new CallJobs(directory, voice)
  await worker.start()
})
afterEach(async () => {
  await worker.stop()
  close()
})
afterAll(async () => fs.rm(root, { recursive: true, force: true }))
async function finished (value: CallJob) {
  await worker.tick()
  const saved = job(1, value.id)!
  expect(saved.status, saved.error ?? '').toBe('ready')
  return saved
}
async function defaults () {
  await finished(worker.submit(1, 'intro', { requestId: randomUUID(), title: 'Vamos', text: '¡Vamos con el karaoke!' }))
  await finished(worker.submit(1, 'table', { requestId: randomUUID(), text: 'Desde la mesa siete,', revision: binding(1, tableId)?.revision ?? 0 }, tableId))
  for (const kind of ['video', 'bed']) db.run(`INSERT INTO karaokeBackgroundAssets(id,roomId,requestId,kind,title,state,createdAt) VALUES(?,1,?,?,?,'ready',1)`, [kind, kind, kind, kind])
  return (await readKaraokePreview(worker, 1, 1)).draft
}
function save (draft: KaraokePreviewDraft, revision = 0, userId = 1, roomId = 1) {
  return saveKaraokePreview(worker, userId, roomId, draft, revision).revision
}
it('supplies complete compatible test defaults and inactive media without generating on read', async () => {
  const draft = await defaults()
  const count = vi.mocked(provider.generate).mock.calls.length
  expect(draft).toMatchObject({ performer: 'Ana', song: 'Rayando el sol', tableId: String(tableId), mode: 'hybrid', videoId: 'video', bedId: 'bed', volume: 0.2 })
  expect(draft.introId).toBeTruthy()
  expect((await readKaraokePreview(worker, 1, 1)).persisted).toBe(false)
  expect(provider.generate).toHaveBeenCalledTimes(count)
  expect(db.all('SELECT active FROM karaokeBackgroundAssets')).toEqual([{ active: 0 }, { active: 0 }])
})
it('persists editable blanks and explicit no-background choices with CAS and room validation', async () => {
  const draft = await defaults()
  const edited = { ...draft, performer: '', videoId: '', bedId: '', volume: 0.12 }
  expect(save(edited)).toBe(1)
  expect((await readKaraokePreview(worker, 1, 1)).draft).toEqual(edited)
  expect(() => save(draft)).toThrow('otra ventana')
  expect(() => save(draft, 0, 1, 2)).toThrow('esta sala')
  expect(() => save({ ...draft, volume: NaN }, 1)).toThrow('datos')
})
it('keeps users isolated and reuses the matching sample across media changes without synthesis', async () => {
  const draft = await defaults()
  let revision = save(draft)
  const submitted = await prepareKaraokePreview(worker, 1, 1, { revision, requestId: randomUUID() })
  await finished(submitted.job)
  const count = vi.mocked(provider.generate).mock.calls.length
  const first = await readKaraokePreview(worker, 1, 1)
  expect(first.samples[submitted.key].result).toBeTruthy()
  expect((await readKaraokePreview(worker, 2, 1)).samples).toEqual({})
  expect((await readKaraokePreview(worker, 1, 2)).samples).toEqual({})
  revision = save({ ...draft, videoId: '', bedId: '', volume: 0.4 }, revision)
  expect((await prepareKaraokePreview(worker, 1, 1, { revision, requestId: randomUUID() })).job.id).toBe(submitted.job.id)
  expect(provider.generate).toHaveBeenCalledTimes(count)
  expect(db.all('SELECT * FROM animationInterventions')).toEqual([])
  expect(db.all('SELECT * FROM audioUsage')).toEqual([])
}, 30000)
it('retains a saved audio beyond recent history and restarts with the same files and no provider calls', async () => {
  const draft = await defaults()
  const revision = save(draft)
  const sample = await prepareKaraokePreview(worker, 1, 1, { revision, requestId: randomUUID() })
  const saved = await finished(sample.job)
  for (let index = 0; index < 22; index++) await finished(worker.submit(1, 'reference', { ...draft, tableId, song: `Otra canción ${index}`, requestId: randomUUID() }))
  expect(worker.snapshot(1).jobs.some(value => value.id === sample.job.id)).toBe(false)
  await worker['cleanup']()
  const bytes = await worker.bytes(1, saved.resultId!)
  const count = vi.mocked(provider.generate).mock.calls.length
  await worker.stop()
  worker = new CallJobs(directory, voice)
  await worker.start()
  const restored = await readKaraokePreview(worker, 1, 1)
  expect(restored.draft).toEqual(draft)
  expect(restored.samples[sample.key].result?.id).toBe(saved.resultId)
  expect(await worker.bytes(1, saved.resultId!)).toEqual(bytes)
  expect(provider.generate).toHaveBeenCalledTimes(count)
}, 60000)
it('does not bill a stale save and reports a missing persisted audio without automatic regeneration', async () => {
  const draft = await defaults()
  const revision = save(draft)
  const sample = await prepareKaraokePreview(worker, 1, 1, { revision, requestId: randomUUID() })
  const saved = await finished(sample.job)
  const part = db.get<{ filename: string }>('SELECT filename FROM karaokeCallParts WHERE id=?', [saved.resultId])!
  await fs.rm(path.join(directory, part.filename))
  const count = vi.mocked(provider.generate).mock.calls.length
  const state = await readKaraokePreview(worker, 1, 1)
  expect(state.samples[sample.key]).toMatchObject({ result: null, error: expect.stringContaining('No se pudo abrir') })
  await expect(prepareKaraokePreview(worker, 1, 1, { revision: 0, requestId: randomUUID() })).rejects.toThrow('otra ventana')
  expect(provider.generate).toHaveBeenCalledTimes(count)
}, 30000)

it('retains more than ten saved samples, original drafts and dependencies after later table changes', async () => {
  const draft = await defaults()
  let revision = save(draft)
  let firstKey = ''
  let firstId = ''
  for (let index = 0; index < 12; index++) {
    const variant = { ...draft, song: `Saved song ${index}` }
    revision = save(variant, revision)
    const prepared = await prepareKaraokePreview(worker, 1, 1, { revision, requestId: randomUUID() })
    const result = await finished(prepared.job)
    if (!index) {
      firstKey = prepared.key
      firstId = result.resultId!
    }
  }
  await finished(worker.submit(1, 'table', { requestId: randomUUID(), text: 'Nueva voz de mesa siete,', revision: binding(1, tableId)!.revision }, tableId))
  await worker['cleanup']()
  const count = vi.mocked(provider.generate).mock.calls.length
  await worker.stop()
  worker = new CallJobs(directory, voice)
  await worker.start()
  const restored = await readKaraokePreview(worker, 1, 1)
  expect(Object.keys(restored.samples)).toHaveLength(12)
  expect(restored.savedDrafts![firstKey]).toEqual({ ...draft, song: 'Saved song 0' })
  expect(restored.samples[firstKey]).toMatchObject({ outdated: false, result: { id: firstId } })
  expect(await worker.bytes(1, firstId)).toBeTruthy()
  expect(provider.generate).toHaveBeenCalledTimes(count)
}, 60000)
it('exposes preview persistence only to authenticated administrators and scopes it by user', async () => {
  const draft = await defaults()
  save({ ...draft, performer: 'Guardado por uno' })
  const app = new Koa()
  app.use(async (ctx, next) => {
    ctx.user = { userId: Number(ctx.headers['x-user'] ?? 1), isAdmin: ctx.headers.authorization === 'admin', role: ctx.headers.authorization === 'admin' ? 'admin' : 'operator', roomId: 1 } as typeof ctx.user
    await next()
  })
  app.use(koaBody())
  app.use(createCallRouter(() => worker).routes())
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/rooms/1/karaoke-calls/preview`
  try {
    for (const method of ['GET', 'PUT', 'POST']) expect((await fetch(url, { method })).status).toBe(403)
    const first = await (await fetch(url, { headers: { authorization: 'admin' } })).json()
    const second = await (await fetch(url, { headers: { 'authorization': 'admin', 'x-user': '2' } })).json()
    expect(first.draft.performer).toBe('Guardado por uno')
    expect(second.draft.performer).toBe('Ana')
    expect(second.samples).toEqual({})
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
}, 30000)

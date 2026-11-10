import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import Koa from 'koa'
import { koaBody } from 'koa-body'
import { open, close, db } from '../../lib/Database.js'
import GreetingVoice from '../../Greetings/GreetingVoice.js'
import { GreetingVoiceError, type GreetingVoiceProvider } from '../../Greetings/GeminiGreetingTts.js'
import Greetings from '../../Greetings/Greetings.js'
import CallJobs from './Jobs.js'
import CallAutomation from './Automation.js'
import { callControls } from './Store.js'
import { defaultListeningTemplates } from './ListeningTemplates.js'
import { createCallRouter } from './router.js'

let directory: string
let wave: Buffer
let worker: CallJobs
let automatic: CallAutomation
let voice: GreetingVoice
let generate: ReturnType<typeof vi.fn<GreetingVoiceProvider['generate']>>
beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'listening-templates-'))
  const source = path.join(directory, 'voice.wav')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=520:sample_rate=24000', '-t', '0.15', source])
  wave = await fs.readFile(source)
})
beforeEach(async () => {
  open({ file: ':memory:', ro: false })
  db.exec(`INSERT INTO rooms(roomId,name,status) VALUES(1,'One','open'),(2,'Two','open');
    INSERT INTO users(userId,username,name,password,roleId) VALUES(1,'ana','Ana','test',1);`)
  generate = vi.fn<GreetingVoiceProvider['generate']>().mockResolvedValue(wave)
  voice = new GreetingVoice({ configured: true, check: vi.fn(), generate })
  voice.configure({ ...voice.config(), enabled: true, requestsPerMinute: 1000, requestsPerDay: 10000 })
  worker = new CallJobs(await fs.mkdtemp(path.join(directory, 'case-')), voice)
  await worker.start()
  automatic = new CallAutomation(worker, voice)
  automatic.start()
})
afterEach(async () => {
  automatic.stop()
  await worker.stop()
  close()
})
afterAll(async () => fs.rm(directory, { recursive: true, force: true }))
const templates = () => automatic.listening.templates
const create = (text = 'Este tema llega gracias a…') => templates().save(1, undefined, { requestId: randomUUID(), text })
const add = () => Number(db.run(`INSERT INTO queue(roomId,userId,origin,requestIntent,status,source,externalId,title,artistOrChannel)
  VALUES(1,1,'PARTICIPANT','LISTEN','APPROVED','YOUTUBE',?,'Song','Artist')`, [randomUUID()]).lastID)
const enable = () => automatic.configure(1, { ...callControls(1), listeningEnabled: true })
function disableDefaults () {
  for (const item of templates().list(1)) if (defaultListeningTemplates.some(text => text === item.text)) templates().configure(1, item.id, { revision: item.revision, enabled: false })
}
async function until (condition: () => boolean) {
  for (let count = 0; count < 120; count++) {
    automatic.reconcile()
    await worker.tick()
    if (condition()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error(JSON.stringify(templates().list(1)))
}

it('lists the three defaults without synthesis and deduplicates explicit creation and lost acknowledgments', async () => {
  expect(templates().list(1).map(item => item.text)).toEqual(defaultListeningTemplates)
  expect(generate).not.toHaveBeenCalled()
  voice.configure({ ...voice.config(), enabled: false })
  const input = { requestId: randomUUID(), text: 'Este tema llega gracias a…' }
  const saved = templates().save(1, undefined, input)
  await worker.tick()
  const repeated = templates().save(1, undefined, input)
  expect(repeated.id).toBe(saved.id)
  expect(repeated.audio?.text).toBe(input.text)
  expect(generate).toHaveBeenCalledTimes(1)
  expect(db.all('SELECT * FROM animationInterventions')).toEqual([])
  expect(() => create('  Este tema llega gracias a…  ')).toThrow('ya existe')
}, 15000)

it('preserves pending assignments when the bank grows and does not regenerate names', async () => {
  enable()
  const first = add()
  await until(() => !!automatic.preparation(1, first)?.assets.length)
  const original = automatic.preparation(1, first)!.assets[0]
  const binding = db.get('SELECT templateId,templatePartId FROM listeningPresentations WHERE queueId=?', [first])
  const saved = create()
  await worker.tick()
  expect(templates().list(1).find(item => item.id === saved.id)?.status).toBe('ready')
  automatic.reconcile()
  expect(automatic.preparation(1, first)!.assets[0].partId).toBe(original.partId)
  expect(db.get('SELECT templateId,templatePartId FROM listeningPresentations WHERE queueId=?', [first])).toEqual(binding)
  const second = add()
  await until(() => !!automatic.preparation(1, second)?.assets.length)
  expect(generate.mock.calls.filter(call => call[0] === 'Ana')).toHaveLength(1)
}, 15000)

it('keeps the previous audio during an edit and pending requests keep their immutable version afterward', async () => {
  disableDefaults()
  const saved = create()
  await worker.tick()
  const original = templates().list(1).find(item => item.id === saved.id)!
  enable()
  const first = add()
  await until(() => !!automatic.preparation(1, first)?.assets.length)
  const before = automatic.preparation(1, first)!.assets[0].partId
  let release!: (bytes: Buffer) => void
  generate.mockImplementationOnce(() => new Promise((resolve) => {
    release = resolve
  }))
  const text = 'Esta canción llega por pedido de…'
  const editing = templates().save(1, saved.id, { requestId: randomUUID(), revision: original.revision, text })
  expect(editing.audio?.id).toBe(original.audio!.id)
  automatic.reconcile()
  expect(automatic.preparation(1, first)!.assets[0].partId).toBe(before)
  release(wave)
  await worker.tick()
  const edited = templates().list(1).find(item => item.id === saved.id)!
  expect(edited.audio?.text).toBe(text)
  const second = add()
  await until(() => !!automatic.preparation(1, second)?.assets.length)
  expect(automatic.preparation(1, first)!.assets[0].partId).toBe(before)
  expect(automatic.preparation(1, second)!.assets[0].displayText).toContain(text)
  expect(generate.mock.calls.filter(call => call[0] === 'Ana')).toHaveLength(1)
}, 15000)

it('does not blindly retry an uncertain edit and explicit retry preserves the previous usable version', async () => {
  disableDefaults()
  const saved = create()
  await worker.tick()
  const original = templates().list(1).find(item => item.id === saved.id)!
  generate.mockRejectedValueOnce(new GreetingVoiceError('No se confirmó la generación.', 'uncertain'))
  templates().save(1, saved.id, { requestId: randomUUID(), revision: original.revision, text: 'Ahora disfrutamos la elección de…' })
  await worker.tick()
  const failed = templates().list(1).find(item => item.id === saved.id)!
  expect(failed.status).toBe('uncertain')
  expect(failed.audio?.id).toBe(original.audio!.id)
  const count = generate.mock.calls.length
  templates().reconcile(1)
  await worker.tick()
  expect(generate).toHaveBeenCalledTimes(count)
  templates().save(1, saved.id, { requestId: randomUUID(), revision: failed.revision, text: failed.text })
  await worker.tick()
  expect(templates().list(1).find(item => item.id === saved.id)?.audio?.text).toBe(failed.text)
}, 15000)

it('keeps failed new introductions out of rotation while usable alternatives exist', async () => {
  enable()
  await until(() => templates().list(1).every(item => item.audio !== null))
  generate.mockRejectedValueOnce(new GreetingVoiceError('Sin confirmación.', 'uncertain'))
  const failed = create()
  await worker.tick()
  expect(templates().list(1).find(item => item.id === failed.id)?.status).toBe('uncertain')
  const id = add()
  await until(() => !!automatic.preparation(1, id)?.assets.length)
  expect(db.get<{ templateId: string }>('SELECT templateId FROM listeningPresentations WHERE queueId=?', [id])?.templateId).not.toBe(failed.id)
}, 15000)

it('omits presentation with no active templates and retains attributed greetings', async () => {
  disableDefaults()
  enable()
  const id = add()
  automatic.reconcile()
  await worker.tick()
  expect(generate).not.toHaveBeenCalled()
  expect(automatic.preparation(1, id)).toBeNull()
  Greetings.attach({ roomId: 1, userId: 1 }, id, { message: 'Una noche especial.' }, {})
  Greetings.configurePlayback(1, { enabled: true, introClipId: null, ambienceEnabled: false }, 0)
  await until(() => automatic.preparation(1, id)?.assets.some(asset => asset.role === 'signature') === true)
  expect(automatic.preparation(1, id)?.assets.map(asset => asset.role)).toEqual(['signature'])
}, 15000)

it('keeps an active greeting signature valid while a new template bank becomes ready', async () => {
  const id = add()
  Greetings.attach({ roomId: 1, userId: 1 }, id, { message: 'Una noche especial.' }, {})
  Greetings.configurePlayback(1, { enabled: true, introClipId: null, ambienceEnabled: false }, 0)
  await until(() => automatic.preparation(1, id)?.assets.some(asset => asset.role === 'signature') === true)
  const prepared = automatic.preparation(1, id)!
  const context = { kind: 'signature' as const, ...prepared, partId: prepared.assets.find(asset => asset.role === 'signature')!.partId }
  automatic.started(1, context)
  enable()
  await until(() => templates().list(1).every(item => item.audio !== null))
  expect(automatic.valid(1, context, true)).toBe(true)
}, 15000)

it('archiving an assigned template invalidates unstarted speech but does not interrupt a started sequence', async () => {
  disableDefaults()
  const saved = create()
  await worker.tick()
  enable()
  const id = add()
  await until(() => !!automatic.preparation(1, id)?.assets.length)
  const prepared = automatic.preparation(1, id)!
  const context = { kind: 'listening' as const, ...prepared, partId: prepared.assets[0].partId }
  automatic.started(1, context)
  const current = templates().list(1).find(item => item.id === saved.id)!
  templates().configure(1, current.id, { revision: current.revision, archived: true })
  expect(templates().list(1).some(item => item.id === saved.id)).toBe(false)
  expect(automatic.valid(1, context, true)).toBe(true)
  expect(automatic.valid(1, context)).toBe(false)
  const next = add()
  automatic.reconcile()
  expect(automatic.preparation(1, next)).toBeNull()
}, 15000)

it('enforces room ownership, version checks and plain-text validation without generating invalid input', async () => {
  const initial = templates().list(1)[0]
  expect(() => templates().save(2, initial.id, { requestId: randomUUID(), revision: 1, text: 'Foreign' })).toThrow('disponible')
  expect(() => templates().configure(2, initial.id, { revision: 1, enabled: false })).toThrow('disponible')
  const configured = templates().configure(1, initial.id, { revision: initial.revision, enabled: false })!
  expect(() => templates().configure(1, initial.id, { revision: initial.revision, enabled: true })).toThrow('cambió')
  expect(configured.enabled).toBe(false)
  for (const text of ['', '[excited] hola', 'a'.repeat(101)]) expect(() => create(text)).toThrow()
  expect(generate).not.toHaveBeenCalled()
})

it('restricts template mutations to authenticated administrators and scopes IDs to their room', async () => {
  const app = new Koa()
  app.use(koaBody())
  app.use(async (ctx, next) => {
    ctx.user = { isAdmin: ctx.get('x-test-admin') === 'yes', roomId: 1 }
    await next()
  })
  const router = createCallRouter(() => worker, () => automatic)
  app.use(router.routes())
  const server = createServer(app.callback())
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/rooms`
  const body = { requestId: randomUUID(), text: 'Esta elección llega gracias a…' }
  try {
    const denied = await fetch(`${origin}/1/karaoke-calls/listening-intros`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    expect(denied.status).toBe(403)
    expect(generate).not.toHaveBeenCalled()
    const response = await fetch(`${origin}/1/karaoke-calls/listening-intros`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-admin': 'yes' }, body: JSON.stringify(body) })
    expect(response.status).toBe(202)
    const created = await response.json() as { id: string, revision: number }
    const foreign = await fetch(`${origin}/2/karaoke-calls/listening-intros/${created.id}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-test-admin': 'yes' }, body: JSON.stringify({ revision: created.revision, enabled: false }) })
    expect(foreign.status).toBe(404)
    await worker.tick()
    expect(generate).toHaveBeenCalledTimes(1)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

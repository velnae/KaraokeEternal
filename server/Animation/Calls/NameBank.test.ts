import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { open, close, db, DatabaseWrapper } from '../../lib/Database.js'
import GreetingVoice from '../../Greetings/GreetingVoice.js'
import { GreetingVoiceError, type GreetingVoiceProvider } from '../../Greetings/GeminiGreetingTts.js'
import CallJobs from './Jobs.js'
import NameBank from './NameBank.js'
import { key, job, type PartRow } from './Store.js'
import Koa from 'koa'
import http from 'node:http'
import createNameVoiceRouter from './nameRouter.js'
import { createCallRouter } from './router.js'
import { koaBody } from 'koa-body'
import { getNameVoiceStyle, saveNameVoiceStyle } from './nameStyle.js'

let directory: string
let wave: Buffer
let worker: CallJobs
let voice: GreetingVoice
let provider: GreetingVoiceProvider
beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'name-bank-'))
  const source = path.join(directory, 'voice.wav')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=600:sample_rate=24000', '-t', '0.25', source])
  wave = await fs.readFile(source)
})
beforeEach(async () => {
  open({ file: ':memory:', ro: false })
  db.exec(`INSERT INTO rooms(roomId,name,status) VALUES(1,'One','open'),(2,'Two','open');
    INSERT INTO karaokeCallControls(roomId,listeningEnabled) VALUES(1,1),(2,1);`)
  provider = { configured: true, check: vi.fn(), generate: vi.fn().mockResolvedValue(wave) }
  voice = new GreetingVoice(provider)
  voice.configure({ ...voice.config(), enabled: true, requestsPerMinute: 1000, requestsPerDay: 10000 })
  worker = new CallJobs(await fs.mkdtemp(path.join(directory, 'case-')), voice)
  await worker.start()
})
afterEach(async () => {
  await worker.stop()
  close()
  vi.restoreAllMocks()
})
afterAll(async () => fs.rm(directory, { recursive: true, force: true }))

async function audio (text: string) {
  NameBank.ensureAudio(worker, 1, text, voice.profile(), true)
  await worker.tick()
  return NameBank.selected(text, voice.profile())!
}

it('shares one paid generation across rooms and survives cleanup, room removal and restart', async () => {
  NameBank.ensureAudio(worker, 1, 'Ana', voice.profile(), true)
  NameBank.ensureAudio(worker, 2, 'ana', voice.profile(), true)
  expect(db.all(`SELECT * FROM karaokeCallJobs WHERE json_extract(inputJSON,'$.sourceKind')='name'`)).toHaveLength(1)
  await worker.tick()
  const selected = NameBank.selected('Ana', voice.profile())!
  expect(selected.roomId).toBeNull()
  expect(NameBank.ensureAudio(worker, 2, 'ANA', voice.profile(), true)?.id).toBe(selected.id)
  await expect(worker.bytes(2, selected.id)).resolves.toBeInstanceOf(Buffer)
  NameBank.recordUse('execution', 'call', selected.id, 1, Date.now())
  db.run('DELETE FROM karaokeCallJobs WHERE roomId=1')
  db.run('DELETE FROM karaokeCallControls WHERE roomId=1')
  db.run('DELETE FROM rooms WHERE roomId=1')
  await worker['cleanup']()
  expect(NameBank.detail(selected.nameId!, voice.profile()).uses).toBe(1)
  await expect(worker.bytes(2, selected.id)).resolves.toBeInstanceOf(Buffer)
  await worker.stop()
  worker = new CallJobs(worker['directory'], voice)
  await worker.start()
  expect(NameBank.selected('Ana', voice.profile())?.id).toBe(selected.id)
  expect(provider.generate).toHaveBeenCalledTimes(1)
}, 10000)

it('finishes admitted global generation after its originating room closes', async () => {
  NameBank.ensureAudio(worker, 1, 'Ana', voice.profile(), true)
  db.run(`UPDATE rooms SET status='closed' WHERE roomId=1`)
  NameBank.ensureAudio(worker, 2, 'Ana', voice.profile(), true)
  await worker.tick()
  expect(NameBank.selected('Ana', voice.profile())?.roomId).toBeNull()
  expect(provider.generate).toHaveBeenCalledTimes(1)
})

it('leaves a full preparation queue available to other rooms instead of aborting reconciliation', async () => {
  for (let n = 0; n < 10; n++) worker.submit(1, 'source', { requestId: randomUUID(), sourceKind: 'template', text: `Fixture ${n}` })
  expect(() => NameBank.ensureAudio(worker, 1, 'Ana', voice.profile(), true)).not.toThrow()
  expect(() => NameBank.ensureAudio(worker, 2, 'Luis', voice.profile(), true)).not.toThrow()
  expect(db.all(`SELECT * FROM karaokeCallJobs WHERE json_extract(inputJSON,'$.sourceKind')='name'`)).toEqual([])
  await worker.tick()
})

it('manually reassigns equivalent aliases without synthesis, preserving accent distinctions and historical versions', async () => {
  const john = NameBank.ensure('John')
  const yon = await audio('Yon')
  const group = NameBank.get(yon.nameId!)
  expect(() => NameBank.update(group.id, { spokenText: 'John', revision: group.revision, aliases: ['Ion'] })).toThrow('Ya existe una pronunciación')
  expect(() => NameBank.update(group.id, { revision: group.revision, aliases: ['John', 'Jhon', 'Ion'] })).toThrow('reasignación')
  NameBank.update(group.id, { revision: group.revision, aliases: ['John', 'Jhon', 'Ion', 'Fgr'], reassign: true })
  for (const alias of ['john', 'JHON', 'Ion', 'Yon']) expect(NameBank.ensureAudio(worker, 2, alias, voice.profile(), true)?.id).toBe(yon.id)
  expect(NameBank.get(john.id)).toBeDefined()
  NameBank.update(john.id, { revision: john.revision, aliases: [], archived: true })
  expect(NameBank.find('John')?.id).toBe(group.id)
  expect(NameBank.ensure('José').id).not.toBe(NameBank.ensure('Jose').id)
  expect(() => NameBank.ensure('<bad>')).toThrow()
  expect(NameBank.speechName('fgr')).toBe('fgr')
  expect(NameBank.ensureAudio(worker, 2, NameBank.speechName('fgr'), voice.profile(), true)?.id).toBe(yon.id)
  expect(NameBank.speechName('zz')).toBe('un invitado')
  expect(provider.generate).toHaveBeenCalledTimes(1)
}, 10000)

it('keeps the chosen version through regeneration and uncertainty and audits the exact effective style', async () => {
  const original = await audio('Ana')
  const group = NameBank.get(original.nameId!)
  const result = worker.submit(2, 'source', { requestId: randomUUID(), sourceKind: 'name', nameId: group.id, text: group.spokenText, regenerate: true })
  await worker.tick()
  const candidate = job(2, result.id)!
  expect(candidate.status).toBe('ready')
  expect(NameBank.selected('Ana', voice.profile())?.id).toBe(original.id)
  const detail = NameBank.detail(group.id, voice.profile())
  expect(detail.versions).toHaveLength(2)
  const version = detail.versions.find(version => version.part.id === candidate.resultId)!
  expect(version.style).toContain('resonant')
  expect(version.recipeRevision).toBe(2)
  expect(vi.mocked(provider.generate).mock.calls[1][1].style).toBe(version.style)
  NameBank.choose(group.id, candidate.resultId!, group.revision)
  expect(NameBank.selected('Ana', voice.profile())?.id).toBe(candidate.resultId)
  vi.mocked(provider.generate).mockRejectedValueOnce(new GreetingVoiceError('Uncertain fixture', 'uncertain'))
  const failed = worker.submit(1, 'source', { requestId: randomUUID(), sourceKind: 'name', nameId: group.id, text: group.spokenText, regenerate: true })
  await worker.tick()
  expect(job(1, failed.id)?.status).toBe('uncertain')
  for (let n = 0; n < 3; n++) NameBank.ensureAudio(worker, 2, 'Ana', voice.profile(), true)
  expect(NameBank.selected('Ana', voice.profile())?.id).toBe(candidate.resultId)
  expect(provider.generate).toHaveBeenCalledTimes(3)
}, 10000)

it('reprocesses an existing version locally without consuming the provider', async () => {
  const original = await audio('Ana')
  const result = worker.submit(1, 'source', { requestId: randomUUID(), sourceKind: 'name', nameId: original.nameId, text: original.text,
    reprocessPartId: original.id, regenerate: true })
  await worker.tick()
  expect(job(1, result.id)?.status).toBe('ready')
  expect(job(1, result.id)?.resultId).not.toBe(original.id)
  expect(NameBank.selected('Ana', voice.profile())?.id).toBe(original.id)
  expect(provider.generate).toHaveBeenCalledTimes(1)
}, 10000)

it('keeps approved names across style changes while rejecting incompatible voices', async () => {
  const original = await audio('Ana')
  voice.configure({ ...voice.config(), style: voice.config().style + ' Project clearly.' })
  expect(NameBank.ensureAudio(worker, 2, 'Ana', voice.profile(), true)?.id).toBe(original.id)
  const composed = worker.submit(2, 'compose', { requestId: randomUUID(), sourceIds: [original.id, original.id] })
  await worker.tick()
  expect(job(2, composed.id)?.status).toBe('ready')
  expect(provider.generate).toHaveBeenCalledTimes(1)
  voice.configure({ ...voice.config(), voice: 'Kore' })
  expect(NameBank.selected('Ana', voice.profile())).toBeUndefined()
  expect(NameBank.detail(original.nameId!, voice.profile()).versions[0].compatible).toBe(false)
}, 10000)

it('freezes queued name directions and applies a new global style only to future synthesis', async () => {
  const original = await audio('Ana')
  const oldStyle = NameBank.info(original).style
  const queued = worker.submit(1, 'source', { requestId: randomUUID(), sourceKind: 'name', nameId: original.nameId, text: 'Ana', regenerate: true }, undefined, 'setup')
  const count = vi.mocked(provider.generate).mock.calls.length
  const current = getNameVoiceStyle(voice.profile())
  const style = 'Pronounce only this name in a clear, projected voice.'
  saveNameVoiceStyle({ style, revision: current.revision }, voice.profile())
  expect(provider.generate).toHaveBeenCalledTimes(count)
  expect(NameBank.ensureAudio(worker, 2, 'Ana', voice.profile(), true)?.id).toBe(original.id)
  await worker.tick()
  expect(NameBank.info(db.get<PartRow>('SELECT * FROM karaokeCallParts WHERE id=?', [job(1, queued.id)!.resultId])!).style).toBe(oldStyle)
  const next = worker.submit(2, 'source', { requestId: randomUUID(), sourceKind: 'name', nameId: original.nameId, text: 'Ana', regenerate: true })
  await worker.tick()
  expect(vi.mocked(provider.generate).mock.calls[2][1].style).toBe(style)
  expect(NameBank.info(db.get<PartRow>('SELECT * FROM karaokeCallParts WHERE id=?', [job(2, next.id)!.resultId])!).style).toBe(style)
  expect(NameBank.info(original).style).toBe(oldStyle)
  expect(NameBank.selected('Ana', voice.profile())?.id).toBe(original.id)
}, 10000)

it('freezes the chosen model, retains approved names and records the actual model through selection and reprocessing', async () => {
  const original = await audio('Ana')
  const settings = getNameVoiceStyle(voice.profile())
  const request = () => ({ requestId: randomUUID(), sourceKind: 'name', nameId: original.nameId, text: 'Ana', regenerate: true })
  const queued = worker.submit(1, 'source', request(), undefined, 'setup')
  saveNameVoiceStyle({ style: settings.style, revision: settings.revision, model: 'gemini-3.8-flash-tts' }, voice.profile())
  expect(provider.generate).toHaveBeenCalledTimes(1)
  expect(NameBank.ensureAudio(worker, 2, 'Ana', voice.profile(), true)?.id).toBe(original.id)
  await worker.tick()
  expect(job(1, queued.id)?.status).toBe('ready')
  expect(vi.mocked(provider.generate).mock.calls[1][1].model).toBe('gemini-3.8-flash-lite-tts')
  const candidate = worker.submit(2, 'source', request())
  await worker.tick()
  expect(job(2, candidate.id)?.status).toBe('ready')
  expect(vi.mocked(provider.generate).mock.calls[2][1].model).toBe('gemini-3.8-flash-tts')
  const generated = db.get<PartRow>('SELECT * FROM karaokeCallParts WHERE id=?', [job(2, candidate.id)!.resultId])!
  expect(NameBank.info(generated).profile?.model).toBe('gemini-3.8-flash-tts')
  expect(NameBank.selected('Ana', voice.profile())?.id).toBe(original.id)
  const group = NameBank.get(original.nameId!)
  NameBank.choose(group.id, generated.id, group.revision)
  expect(NameBank.list(voice.profile()).items[0].active?.part.id).toBe(generated.id)
  expect(NameBank.detail(group.id, voice.profile()).versions.filter(version => version.selected)).toHaveLength(1)
  const composed = worker.submit(2, 'compose', { requestId: randomUUID(), sourceIds: [generated.id, generated.id] })
  await worker.tick()
  expect(job(2, composed.id)?.status).toBe('ready')
  const current = getNameVoiceStyle(voice.profile())
  saveNameVoiceStyle({ style: current.style, revision: current.revision, model: 'gemini-3.8-flash-lite-tts' }, voice.profile())
  const reprocessed = worker.submit(2, 'source', { ...request(), reprocessPartId: generated.id })
  await worker.tick()
  expect(job(2, reprocessed.id)?.status).toBe('ready')
  expect(NameBank.info(db.get<PartRow>('SELECT * FROM karaokeCallParts WHERE id=?', [job(2, reprocessed.id)!.resultId])!).profile?.model).toBe('gemini-3.8-flash-tts')
  expect(provider.generate).toHaveBeenCalledTimes(3)
  expect(voice.profile().model).toBe('gemini-3.8-flash-lite-tts')
  expect(NameBank.compatible(generated, { ...voice.profile(), model: 'unrelated-model' })).toBe(false)
}, 15000)

it('counts immutable name dependencies once per completed resource and retains archived versions', async () => {
  const name = await audio('Ana')
  const group = NameBank.get(name.nameId!)
  const countBefore = NameBank.detail(group.id, voice.profile()).uses
  NameBank.recordUse('one', 'composition', name.id, 1, 1234)
  NameBank.recordUse('one', 'composition', name.id, 1, 1234)
  expect(NameBank.detail(group.id, voice.profile())).toMatchObject({ uses: countBefore + 1, lastUsedAt: 1234 })
  NameBank.update(group.id, { revision: group.revision, aliases: ['Ana'], archived: true })
  expect(NameBank.selected('Ana', voice.profile())).toBeUndefined()
  expect(NameBank.ensureAudio(worker, 2, 'Ana', voice.profile(), true)).toBeUndefined()
  await worker['cleanup']()
  await expect(worker.bytes(2, name.id)).resolves.toBeInstanceOf(Buffer)
}, 10000)

it('searches aliases and sorts confirmed usage, generation and paginated global results', async () => {
  const ana = await audio('Ana')
  const yon = await audio('Yon')
  NameBank.update(yon.nameId!, { revision: 0, aliases: ['John', 'Ion'] })
  NameBank.recordUse('one', 'call', ana.id, 1, 1000)
  NameBank.recordUse('two', 'call', ana.id, 2, 2000)
  NameBank.recordUse('three', 'call', yon.id, 2, 3000)
  expect(NameBank.list(voice.profile(), { q: 'JOHN' }).items.map(row => row.id)).toEqual([yon.nameId])
  expect(NameBank.list(voice.profile(), { sort: 'uses' }).items[0].id).toBe(ana.nameId)
  expect(NameBank.list(voice.profile(), { sort: 'lastUsed' }).items[0].id).toBe(yon.nameId)
  expect(NameBank.list(voice.profile(), { sort: 'generated' }).items[0].id).toBe(yon.nameId)
  for (let n = 0; n < 52; n++) NameBank.ensure(`Nombre ${String.fromCharCode(97 + Math.floor(n / 26))}${String.fromCharCode(97 + n % 26)}`)
  expect(NameBank.list(voice.profile()).items).toHaveLength(50)
  expect(NameBank.list(voice.profile(), { offset: 50 })).toMatchObject({ total: 54, offset: 50, limit: 50, items: expect.any(Array) })
  expect(NameBank.list(voice.profile(), { offset: 50 }).items).toHaveLength(4)
}, 10000)

it('backfills only completed historical resources with a proven start and deduplicates restarts', async () => {
  const name = await audio('Ana')
  const now = Date.now() + 1000
  db.run(`INSERT INTO users(userId,username,name,password,roleId) VALUES(1,'operator','Operator','test',1)`)
  for (const [id, status, confirmed] of [['completed', 'PLAYED', true], ['missing-receipt', 'PLAYED', false], ['interrupted', 'INTERRUPTED', true]] as const) {
    db.run(`INSERT INTO animationInterventions(interventionId,roomId,requestId,requestedByUserId,clipId,clipChecksum,displayText,durationMs,status,requestedAt,expiresAt,startedAt,finishedAt,sequenceJSON)
      VALUES(?,1,?,1,'intro','fixture','Fixture',4000,?,?,?,?,?,?)`, [id, id, status, now, now + 10000, now, now + 4000,
      JSON.stringify([{ id: 'intro' }, { id: 'name-asset', partId: name.id }])])
    if (confirmed) db.run(`INSERT INTO audioUsage(roomId,sourceId,clipId,sourceType,businessDate,startedAt) VALUES(1,?,'name-asset','intervention','2026-11-10',?)`, [`intervention:${id}`, now + 1000])
  }
  NameBank.backfillUses()
  NameBank.backfillUses()
  expect(NameBank.detail(name.nameId!, voice.profile())).toMatchObject({ uses: 1, lastUsedAt: now + 4000 })
  expect(db.get('SELECT executionId FROM nameVoiceUses')).toEqual({ executionId: 'completed' })
}, 10000)

it('rolls back an invalid referenced-table rebuild and restores foreign key enforcement', async () => {
  const schemas = await fs.mkdtemp(path.join(directory, 'invalid-migration-'))
  await fs.writeFile(path.join(schemas, '001-invalid.sql'), `-- Up\n-- Rebuild referenced tables\nUPDATE child SET owner='missing';`)
  const database = new DatabaseWrapper(':memory:')
  try {
    database.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE owner(id TEXT PRIMARY KEY);
      CREATE TABLE child(owner TEXT REFERENCES owner(id));
      INSERT INTO owner VALUES('original'); INSERT INTO child VALUES('original');`)
    expect(() => database.migrate({ migrationsPath: schemas })).toThrow('foreign keys')
    expect(database.get('SELECT owner FROM child')).toEqual({ owner: 'original' })
    expect(database.all('PRAGMA foreign_key_check')).toEqual([])
    expect(database.get('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 })
    expect(database.all('SELECT * FROM migrations')).toEqual([])
  } finally { database.close() }
})

it('restricts global administration and audio to administrators and deduplicates private generation across rooms', async () => {
  const original = await audio('Ana')
  const group = NameBank.get(original.nameId!)
  const app = new Koa()
  app.use(async (ctx, next) => {
    Object.assign(ctx, { user: { isAdmin: ctx.get('test-admin') === 'true', role: ctx.get('test-operator') === 'true' ? 'operator' : 'guest', roomId: Number(ctx.get('test-room') || 1) } })
    await next()
  })
  const router = createNameVoiceRouter(() => worker, () => voice)
  app.use(koaBody())
  app.use(router.routes())
  app.use(createCallRouter(() => worker).routes())
  const server = http.createServer(app.callback())
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/name-voices`
  const headers = { 'test-admin': 'true', 'test-room': '2', 'content-type': 'application/json' }
  try {
    expect((await fetch(origin)).status).toBe(403)
    expect((await fetch(`${origin}/style`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ style: 'Unauthorized', revision: 0 }) })).status).toBe(403)
    expect((await fetch(origin.replace('/name-voices', `/rooms/2/karaoke-calls/audio/${original.id}`), { headers: { 'test-operator': 'true', 'test-room': '2' } })).status).toBe(403)
    expect((await fetch(`${origin}/${group.id}`, { method: 'PUT', body: '{}', headers: { 'content-type': 'application/json' } })).status).toBe(403)
    const list = await (await fetch(origin, { headers })).json()
    expect(list.items[0].id).toBe(group.id)
    const prompt = await (await fetch(`${origin}/style`, { headers })).json()
    expect(prompt.revision).toBe(0)
    const styleResponse = await fetch(`${origin}/style`, { method: 'PUT', headers, body: JSON.stringify({ style: 'Publicly project only the supplied name.', revision: 0 }) })
    expect(styleResponse.status).toBe(200)
    expect(provider.generate).toHaveBeenCalledTimes(1)
    const response = await fetch(`${origin}/${group.id}/audio/${original.id}`, { headers })
    expect(response.headers.get('content-type')).toContain('audio/mpeg')
    expect(response.headers.get('cache-control')).toContain('private')
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(1000)
    const other = NameBank.ensure('Other')
    expect((await fetch(`${origin}/${other.id}/audio/${original.id}`, { headers })).status).toBe(404)
    const body = JSON.stringify({ requestId: randomUUID() })
    const generation = await fetch(`${origin}/${group.id}/generate`, { method: 'POST', headers, body })
    expect(generation.status, await generation.clone().text()).toBe(202)
    const first = await generation.json()
    const second = await (await fetch(`${origin}/${group.id}/generate`, { method: 'POST', headers, body })).json()
    expect(second.id).toBe(first.id)
    await worker.tick()
    const third = await (await fetch(`${origin}/${group.id}/generate`, { method: 'POST', headers, body })).json()
    expect(third.id).toBe(first.id)
    expect(NameBank.selected('Ana', voice.profile())?.id).toBe(original.id)
    expect(provider.generate).toHaveBeenCalledTimes(2)
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
}, 10000)

it('migrates populated legacy room-owned names without changing IDs, hashes or foreign references', async () => {
  const profile = voice.profile()
  await worker.stop()
  close()
  const schemas = path.join(import.meta.dirname, '../../lib/schemas')
  const legacy = await fs.mkdtemp(path.join(directory, 'schemas-'))
  for (const file of await fs.readdir(schemas)) if (Number(file.slice(0, 3)) < 47) await fs.copyFile(path.join(schemas, file), path.join(legacy, file))
  const file = path.join(legacy, 'legacy.sqlite')
  const old = new DatabaseWrapper(file)
  old.migrate({ migrationsPath: legacy })
  old.exec(`INSERT INTO rooms(roomId,name,status) VALUES(1,'One','open');
    INSERT INTO karaokeCallParts(id,roomId,kind,variantId,title,text,profileKey,cacheKey,master,filename,checksum,masterChecksum,durationMs,createdAt)
      VALUES('legacy-name',1,'name','variant','Ana','Ana','${key(profile)}','cache','masters/name.wav','production/name.mp3','mp3-hash','wav-hash',1000,1);
    INSERT INTO karaokeCallJobs(id,roomId,requestId,operation,requestJSON,inputJSON,profileJSON,text,status,resultId,createdAt,updatedAt)
      VALUES('legacy-job',1,'legacy-request','source','{}','{"sourceKind":"name"}','{}','Ana','ready','legacy-name',1,1);`)
  old.close()
  open({ file, ro: false })
  NameBank.initialize()
  db.migrate({ migrationsPath: schemas })
  NameBank.initialize()
  const migrated = db.get<PartRow>('SELECT * FROM karaokeCallParts WHERE id=?', ['legacy-name'])!
  expect(migrated).toMatchObject({ roomId: null, checksum: 'mp3-hash', masterChecksum: 'wav-hash', createdAt: 1 })
  expect(NameBank.selected('Ana', profile)?.id).toBe('legacy-name')
  expect(NameBank.detail(migrated.nameId!, profile).versions[0].style).toBeNull()
  expect(db.get('SELECT resultId FROM karaokeCallJobs WHERE id=?', ['legacy-job'])).toEqual({ resultId: 'legacy-name' })
  expect(db.all('PRAGMA foreign_key_check')).toEqual([])
  expect(db.get('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 })
  expect(db.all('SELECT * FROM namePronunciations')).toHaveLength(1)
})

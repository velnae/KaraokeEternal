import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { beforeAll, beforeEach, afterAll, afterEach, expect, it, vi } from 'vitest'
import Koa from 'koa'
import { open, close, db } from '../../lib/Database.js'
import GreetingVoice from '../../Greetings/GreetingVoice.js'
import CallJobs from './Jobs.js'
import NameBank from './NameBank.js'
import { preparedPart } from './Composition.js'
import { key } from './Store.js'
import { callPromotionSnapshot, importCallResource, type CallPromotionResource } from './Promotion.js'
import { createCallPromotionRouter } from './promotionRouter.js'
import { planCallPromotion, applyCallPromotion } from '../../../config/promote-call-resources.js' // eslint-disable-line n/no-missing-import -- Source-only CLI outside the server build root.
import { readJSON, writeJSON } from '../../../config/media-import.js' // eslint-disable-line n/no-missing-import -- Source-only CLI outside the server build root.

let root: string, directory: string, master: Buffer, audio: Buffer, media: Awaited<ReturnType<typeof preparedPart>>
let worker: CallJobs, voice: GreetingVoice
const generate = vi.fn()
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'call-promotion-'))
  const wave = path.join(root, 'fixture.wav')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=600:sample_rate=24000', '-t', '0.5', wave])
  media = await preparedPart(root, await fs.readFile(wave), 'ffmpeg', new AbortController().signal)
  master = await fs.readFile(path.join(root, media.master))
  audio = await fs.readFile(path.join(root, media.filename))
})
beforeEach(async () => {
  open({ file: ':memory:', ro: false })
  db.exec('INSERT INTO rooms(roomId,name,status) VALUES(1,\'One\',\'open\'),(2,\'Two\',\'open\')')
  voice = new GreetingVoice({ configured: false, check: vi.fn(), generate })
  directory = await fs.mkdtemp(path.join(root, 'case-'))
  worker = new CallJobs(directory, voice)
  await worker.start()
  generate.mockReset().mockRejectedValue(new Error('Synthesis is forbidden during promotion'))
})
afterEach(async () => {
  await worker.stop()
  close()
})
afterAll(async () => fs.rm(root, { recursive: true, force: true }))

function source (type: 'name' | 'listening' = 'name'): CallPromotionResource {
  const profile = voice.profile()
  const text = type === 'name' ? 'Ana' : 'Vamos con el pedido de…'
  return { type, sourceId: type === 'name' ? 'source-ana' : 'listening-default-1-1', text, tag: 'a'.repeat(64), profile,
    ...(type === 'name' ? { aliases: ['Ana', 'Anita'], archived: false } : { enabled: true }),
    metadata: type === 'name' ? { profile, style: 'Speak only the approved name.', recipeRevision: 2, legacy: false } : null,
    part: { id: media.id, kind: type === 'name' ? 'name' : 'template', title: text, text, durationMs: media.durationMs,
      variantId: media.id, profileKey: key(profile), createdAt: 1, checksum: media.checksum, masterChecksum: media.masterChecksum } }
}

it('imports an exact globally reusable name, preserves aliases and reconciles a lost response without synthesis', async () => {
  const input = source()
  const first = await importCallResource(worker, 1, voice.profile(), input, null, master, audio)
  expect(await worker.bytes(2, first.part!.id, true)).toEqual(master)
  expect(await worker.bytes(2, first.part!.id)).toEqual(audio)
  expect(NameBank.selected('Anita', voice.profile())?.id).toBe(first.part!.id)
  expect(await importCallResource(worker, 1, voice.profile(), input, null, master, audio)).toEqual(first)
  expect(db.all('SELECT * FROM karaokeCallJobs')).toHaveLength(0)
  expect(db.all('SELECT * FROM nameVoiceUses')).toHaveLength(0)
  expect(generate).not.toHaveBeenCalled()
}, 10000)

it('rejects tampered bytes, incompatible voices and stale binding comparisons', async () => {
  const input = source()
  await expect(importCallResource(worker, 1, voice.profile(), input, null, Buffer.from('bad'), audio)).rejects.toThrow('archivos')
  await expect(importCallResource(worker, 1, { ...voice.profile(), voice: 'Other' }, input, null, master, audio)).rejects.toThrow('perfil')
  const existing = NameBank.ensure('Ana')
  NameBank.update(existing.id, { revision: existing.revision, aliases: ['Ana', 'Anabel'] })
  await expect(importCallResource(worker, 1, voice.profile(), input, null, master, audio)).rejects.toThrow('destino cambió')
  expect(NameBank.selected('Ana', voice.profile())).toBeUndefined()
  expect(db.all('SELECT * FROM karaokeCallParts')).toHaveLength(0)
})

it('binds listening introductions to their room, replaces approved defaults and preserves destination-only templates', async () => {
  db.run('INSERT INTO listeningTemplates(id,roomId,text,createdAt) VALUES(?,1,?,1)', ['listening-default-1-1', 'Old introduction'])
  db.run('INSERT INTO listeningTemplates(id,roomId,text,createdAt) VALUES(?,1,?,2)', ['local-only', 'Destination only'])
  const input = source('listening')
  const old = callPromotionSnapshot(1, voice.profile()).listening[0]
  const imported = await importCallResource(worker, 1, voice.profile(), input, old.tag, master, audio)
  expect(imported.part?.checksum).toBe(media.checksum)
  expect(imported.text).toBe(input.text)
  expect(callPromotionSnapshot(1, voice.profile()).listening).toHaveLength(2)
  await expect(worker.bytes(2, imported.part!.id)).rejects.toThrow('disponible')
  expect(db.get<{ jobId: string | null }>('SELECT jobId FROM listeningTemplates WHERE id=?', [old.sourceId])!.jobId).toBeNull()
  expect(generate).not.toHaveBeenCalled()
}, 10000)

it('rolls back alias conflicts without stealing another pronunciation or recording usage', async () => {
  NameBank.ensure('Anita')
  await expect(importCallResource(worker, 1, voice.profile(), source(), null, master, audio)).rejects.toThrow('otra pronunciación')
  expect(NameBank.find('Ana')).toBeUndefined()
  expect(NameBank.find('Anita')?.spokenText).toBe('Anita')
  expect(db.all('SELECT * FROM karaokeCallParts')).toHaveLength(0)
}, 10000)

it('runs the authenticated CLI plan/apply over HTTP, checks both original hashes and blocks changed completed bindings', async () => {
  const name = source(), template = source('listening')
  const servers: http.Server[] = []
  const start = async (sourceServer: boolean) => {
    const app = new Koa()
    app.use(async (ctx, next) => {
      Object.assign(ctx, { user: { isAdmin: ctx.cookies.get('keToken') === 'fixture', roomId: Number(ctx.get('test-room') || 1) } })
      if (ctx.path === '/api/user') {
        ctx.body = ctx.user
        return
      }
      await next()
    })
    if (sourceServer) app.use((ctx) => {
      if (!ctx.user.isAdmin) return ctx.throw(403)
      if (ctx.path.endsWith('/master')) {
        ctx.type = 'audio/wav'
        ctx.body = master
      } else if (ctx.path.endsWith('/audio')) {
        ctx.type = 'audio/mpeg'
        ctx.body = audio
      } else ctx.body = { profile: voice.profile(), names: [name], listening: [template] }
    })
    else app.use(createCallPromotionRouter(() => worker).routes())
    const server = http.createServer(app.callback())
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  }
  try {
    const from = await start(true), to = await start(false)
    expect((await fetch(`${to}api/resource-promotion/calls/import`, { method: 'POST', body: 'unauthorized' })).status).toBe(403)
    const state = { cookies: [{ name: 'keToken', value: 'fixture', domain: '127.0.0.1', path: '/', httpOnly: true, secure: false, expires: -1, sameSite: 'Lax' }] }
    const credentials = { source: state, target: state }
    const planned = await planCallPromotion({ source: { baseUrl: from, roomId: 1 }, target: { baseUrl: to, roomId: 1 }, names: 'all', listeningIntros: 'all' }, path.join(directory, 'bundle'), credentials)
    expect(db.all('SELECT * FROM karaokeCallParts')).toHaveLength(0)
    await expect(applyCallPromotion(planned.planPath, 'wrong', credentials)).rejects.toThrow('fingerprint')
    const first = await applyCallPromotion(planned.planPath, planned.fingerprint, credentials)
    expect(first.status).toBe('verified')
    expect(Object.values(first.resources)).toHaveLength(2)
    const receipt = await readJSON(first.receiptPath)
    receipt.resources = {}
    await writeJSON(first.receiptPath, receipt)
    expect((await applyCallPromotion(planned.planPath, planned.fingerprint, credentials)).status).toBe('verified')
    expect(db.all('SELECT * FROM karaokeCallParts')).toHaveLength(2)
    const group = NameBank.find('Ana')!
    NameBank.update(group.id, { revision: group.revision, aliases: ['Ana', 'Anita', 'Other'] })
    await expect(applyCallPromotion(planned.planPath, planned.fingerprint, credentials)).rejects.toThrow('Completed binding changed')
    const savedPlan = await readJSON(planned.planPath)
    await fs.appendFile(path.join(directory, 'bundle', savedPlan.items[0].files.master), 'changed')
    await expect(applyCallPromotion(planned.planPath, planned.fingerprint, credentials)).rejects.toThrow('Bundle files changed')
    const templatePart = callPromotionSnapshot(1, voice.profile()).listening[0].part!.id
    expect((await fetch(`${to}api/resource-promotion/calls/parts/${templatePart}/master`, { headers: { 'Cookie': 'keToken=fixture', 'test-room': '2' } })).status).toBe(404)
    expect(generate).not.toHaveBeenCalled()
  } finally { for (const server of servers) await new Promise<void>(resolve => server.close(() => resolve())) }
}, 20000)

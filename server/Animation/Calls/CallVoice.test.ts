import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { open, close, db } from '../../lib/Database.js'
import GreetingVoice from '../../Greetings/GreetingVoice.js'
import { CallVoice } from './CallVoice.js'
import CallJobs from './Jobs.js'
import CallAutomation from './Automation.js'
import Tables from '../../Tables/Tables.js'
import { callControls } from './Store.js'
import type { SpeechProvider } from '../../AudioProviders/types.js'
import NameBank from './NameBank.js'
import Greetings from '../../Greetings/Greetings.js'

let directory: string
let wave: Buffer
let greetings: GreetingVoice
let calls: CallVoice
let worker: CallJobs
let automatic: CallAutomation
let generate: ReturnType<typeof vi.fn<SpeechProvider['generate']>>
beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'persistent-bank-'))
  const source = path.join(directory, 'source.wav')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=24000', '-t', '0.15', source])
  wave = await fs.readFile(source)
})
beforeEach(async () => {
  open({ file: ':memory:', ro: false })
  db.run('INSERT INTO rooms(roomId,name,status,data) VALUES(1,\'Room\',\'open\',\'{}\')')
  Tables.save(1, undefined, { code: '01' })
  generate = vi.fn<SpeechProvider['generate']>().mockResolvedValue(wave)
  greetings = new GreetingVoice({ configured: true, check: vi.fn(), generate })
  greetings.configure({ ...greetings.config(), enabled: true, requestsPerMinute: 1000, requestsPerDay: 10000 })
  calls = new CallVoice(greetings)
  calls.configure({ ...calls.config(), model: 'gemini-3.8-flash-tts' })
  worker = new CallJobs(await fs.mkdtemp(path.join(directory, 'case-')), calls)
  await worker.start()
  automatic = new CallAutomation(worker, calls)
  automatic.start()
})
afterEach(async () => {
  automatic.stop()
  await worker.stop()
  close()
})
afterAll(async () => fs.rm(directory, { recursive: true, force: true }))
async function drain () {
  for (let count = 0; count < 150; count++) {
    automatic.reconcile()
    await worker.tick()
    automatic.reconcile()
    if (!automatic.snapshot(1).bankPreparing && !db.get('SELECT id FROM karaokeCallJobs WHERE status IN (\'queued\',\'generating\',\'preparing\') LIMIT 1')) return
  }
  throw new Error('Bank did not settle')
}

it('keeps an independent quality profile and a shared budget while participant greetings use Lite', async () => {
  const captured = calls.profile()
  greetings.configure({ ...greetings.config(), voice: 'Kore', style: 'Economical participant speech.' })
  expect(calls.profile()).toEqual(captured)
  calls.configure({ ...calls.config(), voice: 'Aoede' })
  await calls.generate('Fixed bank request', captured, new AbortController().signal, true, 'intro')
  await greetings.generate('Participant greeting', greetings.profile(), new AbortController().signal, true)
  expect(generate.mock.calls[0][1]).toMatchObject({ model: 'gemini-3.8-flash-tts', voice: 'Puck' })
  expect(generate.mock.calls[1][1]).toMatchObject({ model: 'gemini-3.8-flash-lite-tts', voice: 'Kore' })
  expect(db.get<{ n: number }>('SELECT count(*) n FROM greetingVoiceRequests')!.n).toBe(2)
  expect(new CallVoice(greetings).config().voice).toBe('Aoede')
})

it('spends zero on reads, enabling automation, profile changes and restart; a manual bank is bounded and idempotent', async () => {
  automatic.configure(1, { ...callControls(1), enabled: true, preparing: true, listeningEnabled: true })
  for (let count = 0; count < 3; count++) {
    worker.snapshot(1)
    automatic.snapshot(1)
    automatic.reconcile()
    await worker.tick()
  }
  expect(generate).not.toHaveBeenCalled()
  const expected = automatic.snapshot(1).missingBankParts!.length
  const request = { requestId: randomUUID(), revision: callControls(1).revision }
  const accepted = automatic.setup(1, request)
  expect(automatic.setup(1, request)).toEqual(accepted)
  expect(() => automatic.setup(1, { requestId: randomUUID(), revision: accepted.revision })).toThrow('lote')
  Tables.save(1, undefined, { code: '02' })
  greetings.configure({ ...greetings.config(), voice: 'Kore', style: 'Cheap participant voice.' })
  calls.configure({ ...calls.config(), voice: 'Aoede', style: 'Defaults for future manual requests.' })
  automatic.configure(1, { ...callControls(1), enabled: false, preparing: false })
  await worker.tick()
  expect(generate).not.toHaveBeenCalled()
  automatic.configure(1, { ...callControls(1), enabled: true, preparing: true })
  await worker.tick()
  expect(generate).not.toHaveBeenCalled()
  automatic.stop()
  await worker.stop()
  worker = new CallJobs(worker.directory, calls)
  await worker.start()
  automatic = new CallAutomation(worker, calls)
  automatic.start()
  await worker.tick()
  expect(generate).not.toHaveBeenCalled()
  automatic.setup(1, { requestId: randomUUID(), revision: callControls(1).revision })
  await drain()
  expect(generate).toHaveBeenCalledTimes(expected)
  expect(generate.mock.calls.every(call => call[1].voice === 'Puck' && call[1].model === 'gemini-3.8-flash-tts')).toBe(true)
  expect(automatic.snapshot(1).missingBankParts).toEqual(['Mesa 02'])
  const recordings = db.all<{ id: string, checksum: string }>('SELECT id,checksum FROM karaokeCallParts WHERE retired=0 AND kind!=\'composition\' ORDER BY id')
  greetings.configure({ ...greetings.config(), voice: 'Kore', model: 'gemini-3.8-flash-lite-tts', style: 'New participant style.' })
  calls.configure({ ...calls.config(), voice: 'Aoede', model: 'gemini-3.8-flash-lite-tts', style: 'New defaults only.' })
  await drain()
  automatic.stop()
  await worker.stop()
  db.run('UPDATE karaokeCallParts SET profileJSON=NULL')
  worker = new CallJobs(worker.directory, calls)
  await worker.start()
  automatic = new CallAutomation(worker, calls)
  automatic.start()
  await drain()
  expect(generate).toHaveBeenCalledTimes(expected)
  expect(db.all('SELECT id,checksum FROM karaokeCallParts WHERE retired=0 AND kind!=\'composition\' ORDER BY id')).toEqual(recordings)
  expect(db.get<{ n: number }>('SELECT count(*) n FROM karaokeCallParts WHERE retired=0 AND profileJSON IS NULL')!.n).toBe(0)
  for (const recording of recordings) await expect(worker.bytes(1, recording.id)).resolves.toBeInstanceOf(Buffer)
}, 30000)

it('cancels a legacy queued fixed-bank receipt without synthesis', async () => {
  automatic.stop()
  await worker.stop()
  db.run(`INSERT INTO karaokeCallJobs(id,roomId,requestId,operation,requestJSON,inputJSON,profileJSON,text,status,createdAt,updatedAt,purpose)
    VALUES('legacy',1,'old-auto','intro','{}',?,?,?,'queued',1,1,'setup')`, [JSON.stringify({ title: 'Legacy', text: 'Old automatic request', variantId: 'legacy' }), JSON.stringify(calls.profile()), 'Old automatic request'])
  worker = new CallJobs(worker.directory, calls)
  await worker.start()
  expect(db.get<{ status: string }>('SELECT status FROM karaokeCallJobs WHERE id=\'legacy\'')!.status).toBe('cancelled')
  await worker.tick()
  expect(generate).not.toHaveBeenCalled()
})

it('rejects a stale quoted bank before creating any paid job', () => {
  const quote = automatic.snapshot(1).bankQuote
  Tables.save(1, undefined, { code: '03' })
  expect(() => automatic.setup(1, { requestId: randomUUID(), revision: 0, quote })).toThrow('lista de audios')
  expect(db.all('SELECT id FROM karaokeCallJobs')).toEqual([])
  expect(generate).not.toHaveBeenCalled()
})

it('does not fund an admitted template archived before dispatch', async () => {
  const expected = automatic.snapshot(1).missingBankParts!.length
  automatic.setup(1, { requestId: randomUUID(), revision: 0 })
  const template = automatic.listening.templates.list(1)[0]
  automatic.listening.templates.configure(1, template.id, { revision: template.revision, archived: true })
  await drain()
  expect(generate.mock.calls.some(call => call[0] === template.text)).toBe(false)
  expect(generate).toHaveBeenCalledTimes(expected - 1)
}, 15000)

it('preparing a fixed bank does not authorize singing continuations for existing requests', async () => {
  db.run('INSERT INTO users(userId,username,name,password,roleId) VALUES(1,\'ana\',\'Ana\',\'test\',1)')
  const table = Tables.list(1)[0]
  db.run(`INSERT INTO queue(roomId,userId,origin,requestIntent,status,source,externalId,title,artistOrChannel,tableId,tableLabelSnapshot)
    VALUES(1,1,'PARTICIPANT','SING','APPROVED','YOUTUBE','fixed-bank-test','Song','Artist',?,'Mesa 01')`, [table.tableId])
  const expected = automatic.snapshot(1).missingBankParts!.length
  automatic.setup(1, { requestId: randomUUID(), revision: 0 })
  await drain()
  expect(generate).toHaveBeenCalledTimes(expected)
  expect(db.get<{ n: number }>('SELECT count(*) n FROM karaokeCallJobs WHERE purpose=\'automatic\'')!.n).toBe(0)
}, 15000)

it('uses the selected quality model for new pieces without replacing an existing Lite introduction', async () => {
  calls.configure({ ...calls.config(), model: 'gemini-3.8-flash-lite-tts' })
  const saved = worker.submit(1, 'intro', { requestId: randomUUID(), title: 'Recorded intro', text: '¡Vamos con el karaoke!' })
  await worker.tick()
  const original = worker.snapshot(1).intros[0]
  expect(original).toBeTruthy()
  calls.configure({ ...calls.config(), model: 'gemini-3.8-flash-tts' })
  automatic.setup(1, { requestId: randomUUID(), revision: 0 })
  await drain()
  expect(generate.mock.calls.slice(1).every(call => call[1].model === 'gemini-3.8-flash-tts')).toBe(true)
  expect(worker.snapshot(1).intros[0].id).toBe(original.id)
  expect(db.get<{ resultId: string }>('SELECT resultId FROM karaokeCallJobs WHERE id=?', [saved.id])!.resultId).toBe(original.id)
}, 15000)

it('does not buy another name voice for a greeting because an unused listening template has a different speaker', async () => {
  automatic.setup(1, { requestId: randomUUID(), revision: 0 })
  await drain()
  const original = calls.profile()
  NameBank.ensureAudio(worker, 1, 'Ana', original, true)
  await drain()
  calls.configure({ ...calls.config(), voice: 'Kore' })
  const template = automatic.listening.templates.list(1)[0]
  automatic.listening.templates.save(1, template.id, { requestId: randomUUID(), revision: template.revision, text: template.text })
  await drain()
  db.run('INSERT INTO users(userId,username,name,password,roleId) VALUES(1,\'ana\',\'Ana\',\'test\',1)')
  const table = Tables.list(1)[0]
  const result = db.run(`INSERT INTO queue(roomId,userId,origin,requestIntent,status,source,externalId,title,artistOrChannel,tableId,tableLabelSnapshot)
    VALUES(1,1,'PARTICIPANT','SING','APPROVED','YOUTUBE','signature-test','Song karaoke','Artist',?,'Mesa 01')`, [table.tableId])
  Greetings.attach({ roomId: 1, userId: 1 }, Number(result.lastID), { message: 'Una noche especial.' }, {})
  Greetings.configurePlayback(1, { enabled: true, introClipId: null, ambienceEnabled: false }, 0)
  const before = generate.mock.calls.length
  await drain()
  expect(generate).toHaveBeenCalledTimes(before)
  expect(db.get<{ signatureId: string }>('SELECT signatureId FROM listeningPresentations WHERE queueId=?', [Number(result.lastID)])!.signatureId).toBeTruthy()
}, 15000)

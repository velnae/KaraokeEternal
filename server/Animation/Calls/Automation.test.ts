import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { open, close, db } from '../../lib/Database.js'
import Tables from '../../Tables/Tables.js'
import GreetingVoice from '../../Greetings/GreetingVoice.js'
import { GreetingVoiceError, type GreetingVoiceProvider } from '../../Greetings/GeminiGreetingTts.js'
import CallJobs from './Jobs.js'
import CallAutomation from './Automation.js'
import { callControls, job, key, part, requestCall } from './Store.js'
import Animation from '../Animation.js'
import Greetings from '../../Greetings/Greetings.js'
import { prepareGreetingTransition } from '../../Greetings/transition.js'
import * as greetingAudio from '../../Greetings/audioRouter.js'
import * as catalog from '../catalog.js'
import { listeningTemplate, listeningTemplates } from './Listening.js'
import { callTransitionFailure, recordCallOmission } from './Playback.js'
import NameBank from './NameBank.js'

let directory: string
let wave: Buffer
let worker: CallJobs
let automatic: CallAutomation
let voice: GreetingVoice
let provider: GreetingVoiceProvider
let tableId: number
beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'automatic-calls-'))
  const file = path.join(directory, 'voice.wav')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=600:sample_rate=24000', '-t', '0.15', file])
  wave = await fs.readFile(file)
})
beforeEach(async () => {
  open({ file: ':memory:', ro: false })
  db.run(`INSERT INTO rooms(roomId,name,status) VALUES(1,'One','open'),(2,'Two','open')`)
  db.run(`INSERT INTO users(userId,username,name,password,roleId) VALUES(1,'ana','Ana','test',1)`)
  tableId = Tables.save(1, undefined, { code: '07' })
  provider = { configured: true, check: vi.fn(), generate: vi.fn().mockResolvedValue(wave) }
  voice = new GreetingVoice(provider)
  voice.configure({ ...voice.config(), enabled: true, requestsPerMinute: 1000, requestsPerDay: 10000 })
  worker = new CallJobs(await fs.mkdtemp(path.join(directory, 'case-')), voice)
  await worker.start()
  automatic = new CallAutomation(worker, voice)
  automatic.start()
})
afterEach(async () => {
  automatic?.stop()
  await worker?.stop()
  close()
  vi.restoreAllMocks()
})
afterAll(async () => fs.rm(directory, { recursive: true, force: true }))
function add (intent = 'SING', status = 'APPROVED', origin = 'PARTICIPANT', title = 'Rayando el sol') {
  const result = db.run(`INSERT INTO queue(roomId,userId,origin,requestIntent,status,source,externalId,title,tableId,tableLabelSnapshot,artistOrChannel,prevQueueId)
    VALUES(1,1,?,?,?,'YOUTUBE',?,?,?,?,'Test',(SELECT max(queueId) FROM queue WHERE roomId=1))`,
  [origin, intent, status, randomUUID(), title, tableId, 'Mesa 07'])
  return Number(result.lastID)
}
function enable () {
  return automatic.configure(1, { ...callControls(1), preparing: true, enabled: true })
}
async function until (condition: () => boolean) {
  for (let n = 0; n < 120; n++) {
    automatic.reconcile()
    await worker.tick()
    automatic.reconcile()
    if (condition()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(JSON.stringify(automatic.snapshot(1)))
}
async function bank () {
  enable()
  await until(() => automatic.snapshot(1).tablesReady === 1)
}

it('retains singing history and privately recovers original speech after identity and profile changes', async () => {
  await bank()
  const id = add()
  await until(() => requestCall(1, id)?.status === 'ready')
  const original = part(1, requestCall(1, id)!.resultId!)!
  const count = vi.mocked(provider.generate).mock.calls.length
  db.run(`UPDATE queue SET status='PLAYED',title='Changed title' WHERE queueId=?`, [id])
  db.run(`UPDATE users SET name='Changed name' WHERE userId=1`)
  voice.configure({ ...voice.config(), voice: 'Kore', enabled: false })
  expect(() => worker.submit(1, 'compose', { requestId: randomUUID(), sourceIds: JSON.parse(original.dependenciesJSON), historical: true })).toThrow('pieza')
  await worker['cleanup']()
  expect(automatic.snapshot(1).requests.find(row => row.queueId === id)).toMatchObject({
    title: 'Rayando el sol', performer: 'Ana', playback: 'omitted', result: { id: original.id },
  })
  await expect(worker.bytes(1, original.id)).resolves.toBeInstanceOf(Buffer)
  db.run('UPDATE karaokeCallParts SET retired=1 WHERE id=?', [original.id])
  await Promise.all([original.master, original.filename].map(file => fs.rm(path.join(worker['directory'], file))))
  const input = { requestId: randomUUID() }
  const submitted = await automatic.recover(1, id, input)
  await worker.tick()
  const recovered = await automatic.recover(1, id, input)
  expect(recovered.id).toBe(submitted.id)
  expect(recovered.result?.text).toBe(original.text)
  expect(requestCall(1, id)?.resultId).toBe(original.id)
  expect(automatic.snapshot(1).requests.find(row => row.queueId === id)?.result?.id).toBe(recovered.result?.id)
  await expect(automatic.recover(2, id, input)).rejects.toThrow('pedido')
  db.run('UPDATE karaokeCallParts SET retired=1 WHERE id=?', [JSON.parse(original.dependenciesJSON)[0]])
  await expect(automatic.recover(1, id, { requestId: randomUUID() })).rejects.toThrow('No se conservan los archivos')
  expect(db.get('SELECT status FROM queue WHERE queueId=?', [id])).toEqual({ status: 'PLAYED' })
  expect(db.all('SELECT * FROM animationInterventions')).toEqual([])
  expect(provider.generate).toHaveBeenCalledTimes(count)
}, 30000)

it('records singing omission at authoritative music start and preserves an earlier precise reason', async () => {
  await bank()
  player()
  const id = add()
  await until(() => requestCall(1, id)?.status === 'ready')
  db.run(`UPDATE queue SET status='PLAYING' WHERE queueId=?`, [id])
  const count = vi.mocked(provider.generate).mock.calls.length
  recordCallOmission(1, id)
  expect(requestCall(1, id)?.playbackReason).toBe('not-reserved')
  expect(automatic.snapshot(1).requests.find(row => row.queueId === id)?.playback).toBe('omitted')
  db.run(`UPDATE karaokeCallRequests SET playbackReason='audio-not-ready' WHERE queueId=?`, [id])
  recordCallOmission(1, id)
  expect(requestCall(1, id)?.playbackReason).toBe('audio-not-ready')
  expect(provider.generate).toHaveBeenCalledTimes(count)
}, 30000)

it('reports the confirmed singing fallback and interruption instead of equating started with announced', async () => {
  await bank()
  const identity = player()
  const id = add()
  await until(() => requestCall(1, id)?.status === 'ready')
  const prepared = (await prepareGreetingTransition(1, id))!
  const fallback = prepared.call!.assets.find(asset => !asset.identifiesSender)!
  const available = { ...prepared, call: { ...prepared.call!, assets: [fallback] } }
  const grant = Greetings.reserve(1, identity.socketId, id, { queueId: -1 }, undefined, available, [fallback.checksum], 1)!
  expect(grant.transition!.call!.partId).toBe(fallback.partId)
  const intervention = grant.transition!.intervention
  Animation.event(identity, intervention.interventionId, intervention.playerEpoch!, 'STARTED')
  Animation.event(identity, intervention.interventionId, intervention.playerEpoch!, 'STOPPED')
  db.run(`UPDATE queue SET status='PLAYED' WHERE queueId=?`, [id])
  await worker['cleanup']()
  expect(automatic.snapshot(1).requests.find(row => row.queueId === id)).toMatchObject({ playback: 'interrupted', usedFallback: true, playedResult: { id: fallback.partId } })
}, 30000)

it('bounds terminal singing history without displacing pending requests', async () => {
  await bank()
  const pending = add()
  await until(() => requestCall(1, pending)?.status === 'ready')
  const original = requestCall(1, pending)!
  const terminal: number[] = []
  for (let index = 0; index < 31; index++) {
    const id = add('SING', 'PLAYED')
    terminal.push(id)
    db.run(`INSERT INTO karaokeCallRequests(queueId,roomId,inputKey,introId,jobId,resultId,status,updatedAt) VALUES(?,1,?,?,?,?,'ready',?)`,
      [id, original.inputKey, original.introId, original.jobId, original.resultId, Date.now()])
  }
  await worker['cleanup']()
  const history = automatic.snapshot(1).requests
  expect(history).toHaveLength(31)
  expect(history.some(row => row.queueId === pending)).toBe(true)
  expect(history.some(row => row.queueId === terminal[0])).toBe(false)
  await expect(worker.bytes(1, original.resultId!)).resolves.toBeInstanceOf(Buffer)
  expect(automatic.snapshot(2).requests).toEqual([])
  db.run('UPDATE queue SET historyClearedAt=? WHERE queueId=?', [Date.now(), terminal[30]])
  expect(automatic.snapshot(1).requests.some(row => row.queueId === terminal[30])).toBe(false)
}, 30000)

it('prepares the bank once and supports idempotent setup without enabling public calls', async () => {
  const request = { requestId: randomUUID(), revision: 0 }
  const controls = automatic.setup(1, request)
  expect(controls.enabled).toBe(false)
  expect(automatic.setup(1, request)).toEqual(controls)
  await until(() => automatic.snapshot(1).tablesReady === 1)
  const count = vi.mocked(provider.generate).mock.calls.length
  automatic.setup(1, { requestId: randomUUID(), revision: controls.revision })
  automatic.reconcile()
  await worker.tick()
  expect(provider.generate).toHaveBeenCalledTimes(count)
  expect(db.get<{ n: number }>('SELECT count(*) n FROM audioUsage')!.n).toBe(0)
}, 30000)

it('automatically prepares only approved singing requests and reuses speech after reordering', async () => {
  await bank()
  const singing = add()
  add('LISTEN')
  add('SING', 'PENDING_APPROVAL')
  add('SING', 'APPROVED', 'HOUSE')
  await until(() => requestCall(1, singing)?.status === 'ready')
  expect(db.all('SELECT * FROM karaokeCallRequests')).toHaveLength(1)
  const prepared = automatic.preparation(1, singing)!
  expect(prepared.assets[0].displayText).toContain('recibamos a Ana con Rayando el sol')
  const count = vi.mocked(provider.generate).mock.calls.length
  db.run('UPDATE queue SET prevQueueId=NULL WHERE queueId=?', [singing])
  automatic.reconcile()
  await worker.tick()
  expect(provider.generate).toHaveBeenCalledTimes(count)
  expect(automatic.preparation(2, singing)).toBeNull()
  await expect(automatic.audio(2, singing, prepared.assets[0].partId)).rejects.toThrow('pedido')
  expect(db.all('SELECT * FROM animationInterventions')).toHaveLength(0)
}, 30000)

it('obeys disabled automatic generation while retaining explicit private preview', async () => {
  voice.configure({ ...voice.config(), enabled: false })
  enable()
  add()
  automatic.reconcile()
  await worker.tick()
  expect(provider.generate).not.toHaveBeenCalled()
  worker.submit(1, 'intro', { requestId: randomUUID(), title: 'Private', text: 'Prueba privada.' })
  await worker.tick()
  expect(provider.generate).toHaveBeenCalledTimes(1)
  automatic.reconcile()
  await worker.tick()
  expect(provider.generate).toHaveBeenCalledTimes(1)
})

it('keeps all pending requests and individual inspection outside the terminal history window', () => {
  voice.configure({ ...voice.config(), enabled: false })
  enable()
  const ids = Array.from({ length: 35 }, (_, index) => add('SING', 'APPROVED', 'PARTICIPANT', `Canción ${index}`))
  automatic.reconcile()
  expect(automatic.snapshot(1).requests).toHaveLength(35)
  expect(automatic.snapshot(1, ids[0]).requests[0].queueId).toBe(ids[0])
  expect(automatic.snapshot(2, ids[0]).requests).toEqual([])
})

it('exposes setup failures and retries only after an explicit new setup request', async () => {
  vi.mocked(provider.generate).mockRejectedValueOnce(new GreetingVoiceError('Sin confirmación', 'uncertain'))
  automatic.setup(1, { requestId: randomUUID(), revision: 0 })
  await worker.tick()
  expect(automatic.snapshot(1).message).toContain('Preparar mesas')
  automatic.reconcile()
  await worker.tick()
  expect(vi.mocked(provider.generate).mock.calls.filter(call => call[0] === '¡Vamos con el karaoke!')).toHaveLength(1)
  automatic.setup(1, { requestId: randomUUID(), revision: callControls(1).revision })
  await until(() => automatic.snapshot(1).tablesReady === 1)
  expect(automatic.snapshot(1).message).toBeNull()
}, 30000)

it('uses prepared fallback on uncertain generation and does not blindly retry', async () => {
  await bank()
  vi.mocked(provider.generate).mockRejectedValueOnce(new GreetingVoiceError('Sin confirmación', 'uncertain'))
  const id = add()
  await until(() => requestCall(1, id)?.status === 'fallback')
  const row = requestCall(1, id)!
  expect(job(1, row.jobId!)?.status).toBe('uncertain')
  const prepared = automatic.preparation(1, id)!
  expect(prepared.assets[0].title).toContain('básico')
  const count = vi.mocked(provider.generate).mock.calls.length
  automatic.reconcile()
  await worker.tick()
  expect(provider.generate).toHaveBeenCalledTimes(count)
  automatic.configure(1, { ...callControls(1), preparing: false, enabled: false })
  expect(() => automatic.retry(1, id, row.inputKey)).toThrow('antes de reintentar')
  enable()
  automatic.retry(1, id, row.inputKey)
  await until(() => requestCall(1, id)?.status === 'ready')
}, 30000)

it('resumes queued preparation after disable/re-enable without repeating existing speech', async () => {
  await bank()
  const id = add()
  automatic.reconcile()
  const pending = requestCall(1, id)!
  expect(job(1, pending.jobId!)?.status).toBe('queued')
  const count = vi.mocked(provider.generate).mock.calls.length
  automatic.configure(1, { ...callControls(1), preparing: false, enabled: false })
  await worker.tick()
  expect(provider.generate).toHaveBeenCalledTimes(count)
  expect(job(1, pending.jobId!)?.status).toBe('queued')
  enable()
  await until(() => requestCall(1, id)?.status === 'ready')
  expect(provider.generate).toHaveBeenCalledTimes(count + 1)
}, 30000)

it('rebuilds incompatible intro/table dependencies after an explicit profile change', async () => {
  await bank()
  const original = worker.snapshot(1).intros[0]
  voice.configure({ ...voice.config(), voice: 'Kore' })
  await until(() => automatic.snapshot(1).tablesReady === 1 && worker.snapshot(1).intros[0].profileKey !== original.profileKey)
  expect(worker.snapshot(1).intros[0].variantId).toBe(original.variantId)
  const id = add()
  await until(() => requestCall(1, id)?.status === 'ready')
  const result = part(1, requestCall(1, id)!.resultId!)!
  expect(result.profileKey).toBe(worker.snapshot(1).profileKey)
}, 30000)

it('invalidates changed names and never speaks another table after a code rename', async () => {
  await bank()
  const id = add()
  await until(() => requestCall(1, id)?.status === 'ready')
  const original = automatic.preparation(1, id)!
  const context = { ...original, partId: original.assets[0].partId }
  expect(automatic.valid(1, context)).toBe(true)
  db.run(`UPDATE users SET name='Carla' WHERE userId=1`)
  expect(automatic.valid(1, context)).toBe(false)
  await until(() => automatic.preparation(1, id)?.assets[0].displayText.includes('Carla') === true)
  Tables.save(1, tableId, { code: '14' })
  const renamed = automatic.preparation(1, id)!
  expect(renamed.assets).toHaveLength(1)
  expect(renamed.assets[0].displayText).not.toContain('siete')
  expect(renamed.assets[0].displayText).not.toContain('catorce')
}, 30000)

it('keeps request audio beyond ten private previews and releases cancelled request access', async () => {
  await bank()
  const id = add()
  await until(() => requestCall(1, id)?.status === 'ready')
  const audio = automatic.preparation(1, id)!.assets[0]
  const intro = worker.snapshot(1).intros[0]
  for (let index = 0; index < 11; index++) {
    worker.submit(1, 'reference', { requestId: randomUUID(), introId: intro.id, tableId, performer: 'Test', song: `Prueba ${index}` })
    await worker.tick()
  }
  expect(part(1, audio.partId)).toBeTruthy()
  await expect(automatic.audio(1, id, audio.partId)).resolves.toBeInstanceOf(Buffer)
  db.run(`UPDATE queue SET status='REMOVED' WHERE queueId=?`, [id])
  automatic.reconcile()
  expect(automatic.preparation(1, id)).toBeNull()
  await expect(automatic.audio(1, id, audio.partId)).rejects.toThrow('pedido')
}, 60000)

it('admits fourteen tables through the bounded worker instead of rejecting the bulk setup', async () => {
  for (let number = 1; number <= 14; number++) if (number !== 7) Tables.save(1, undefined, { code: String(number).padStart(2, '0') })
  enable()
  await until(() => automatic.snapshot(1).tablesReady === 14)
  expect(automatic.snapshot(1)).toMatchObject({ tablesTotal: 14, fallbackReady: true })
  expect(db.get<{ n: number }>(`SELECT count(*) n FROM karaokeCallJobs WHERE status IN ('queued','generating','preparing')`)!.n).toBeLessThanOrEqual(10)
}, 90000)

function player () {
  Animation.control(1, Animation.state(1).controlVersion, { enabled: true, automation: true })
  const identity = { roomId: 1, userId: 1, socketId: randomUUID() }
  Animation.claim(1, identity.socketId)
  Animation.ready(identity, true, [])
  return identity
}

it('delivers a call without a greeting through the existing exclusive reservation and counts only confirmed starts', async () => {
  await bank()
  const identity = player()
  const id = add()
  await until(() => requestCall(1, id)?.status === 'ready')
  const preparation = (await prepareGreetingTransition(1, id))!
  const grant = Greetings.reserve(1, identity.socketId, id, { queueId: -1 }, undefined, preparation, preparation.assets.map(asset => asset.checksum), 1, 23000)!
  expect(grant.items).toEqual([])
  expect(grant.callMode).toBe(true)
  expect(grant.transition?.assets.map(asset => asset.role)).toEqual(['call'])
  const intervention = grant.transition!.intervention
  expect(db.all('SELECT * FROM audioUsage')).toHaveLength(0)
  Animation.event(identity, intervention.interventionId, intervention.playerEpoch!, 'STARTED')
  Animation.event(identity, intervention.interventionId, intervention.playerEpoch!, 'STARTED')
  expect(db.all('SELECT * FROM audioUsage')).toHaveLength(1)
  expect(requestCall(1, id)?.startedAt).toBeTruthy()
  Animation.event(identity, intervention.interventionId, intervention.playerEpoch!, 'ENDED')
  Greetings.finish(1, identity.socketId, id)
  expect(Greetings.reserve(1, identity.socketId, id, { queueId: -1 }, undefined, preparation, preparation.assets.map(asset => asset.checksum), 1)).toBeNull()
  expect(automatic.preparation(1, id)?.assets).toEqual([])
}, 30000)

it('rejects a stale name before speech and permits a proven pre-start cancellation to retry', async () => {
  await bank()
  const identity = player()
  const id = add()
  await until(() => requestCall(1, id)?.status === 'ready')
  const preparation = (await prepareGreetingTransition(1, id))!
  const grant = Greetings.reserve(1, identity.socketId, id, { queueId: -1 }, undefined, preparation, preparation.assets.map(asset => asset.checksum), 1)!
  const intervention = grant.transition!.intervention
  db.run(`UPDATE users SET name='Carla' WHERE userId=1`)
  expect(() => Animation.event(identity, intervention.interventionId, intervention.playerEpoch!, 'STARTED')).toThrow('pedido')
  Animation.event(identity, intervention.interventionId, intervention.playerEpoch!, 'NOT_STARTED')
  Greetings.finish(1, identity.socketId, id)
  expect(db.all('SELECT * FROM audioUsage')).toHaveLength(0)
  expect(db.all('SELECT * FROM greetingTurns')).toHaveLength(0)
  await until(() => automatic.preparation(1, id)?.assets[0].displayText.includes('Carla') === true)
  const fresh = (await prepareGreetingTransition(1, id))!
  const retried = Greetings.reserve(1, identity.socketId, id, { queueId: -1 }, undefined, fresh, fresh.assets.map(asset => asset.checksum), 1)!
  expect(retried.transition!.intervention.interventionId).not.toBe(intervention.interventionId)
}, 30000)

it('shares one reservation with a greeting and keeps a long greeting visual instead of dropping the call', async () => {
  await bank()
  const identity = player()
  const id = add()
  const greetingId = Greetings.attach({ roomId: 1, userId: 1 }, id, { message: 'Una noche para celebrar.' }, {})
  Greetings.configurePlayback(1, { enabled: true, introClipId: null, ambienceEnabled: false }, 0)
  await until(() => requestCall(1, id)?.status === 'ready')
  vi.spyOn(greetingAudio, 'getGreetingAudioAsset').mockResolvedValue({ id: 'fixture-greeting', role: 'greeting', durationMs: 20000,
    checksum: 'a'.repeat(64), kind: 'voice', title: 'Greeting', displayText: 'Saludo', source: 'fixture', license: 'fixture', url: 'api/fixture' })
  const preparation = (await prepareGreetingTransition(1, id))!
  const grant = Greetings.reserve(1, identity.socketId, id, { queueId: -1 }, undefined, preparation, preparation.assets.map(asset => asset.checksum), 1, 23000)!
  expect(grant.items[0].greetingId).toBe(greetingId)
  expect(grant.transition?.assets.map(asset => asset.role)).toEqual(['call'])
  expect(grant.displayMs).toBeGreaterThanOrEqual(10000)
  expect(grant.transition!.durationMs).toBeLessThanOrEqual(20000)
  expect(db.all('SELECT * FROM animationInterventions')).toHaveLength(1)
  expect(Greetings.items(1)[0].playback?.status).toBe('SCREEN')
}, 30000)

it('respects closing and finished jornadas without implicitly reopening public calls', async () => {
  await bank()
  player()
  Animation.session(1, 1, 'open')
  expect(Animation.snapshot(1).karaokeCallsEnabled).toBe(true)
  Animation.session(1, 1, 'close')
  expect(Animation.snapshot(1).karaokeCallsEnabled).toBe(false)
  Animation.session(1, 1, 'finish')
  expect(Animation.snapshot(1).karaokeCallsEnabled).toBe(false)
  Animation.session(1, 1, 'open')
  expect(Animation.snapshot(1).karaokeCallsEnabled).toBe(true)
}, 30000)

function enableListening () {
  automatic.configure(1, { ...callControls(1), listeningEnabled: true })
}

it('shares one name across concurrent listening requests, users, tables and reorder', async () => {
  await bank()
  db.run(`UPDATE users SET name='Luis' WHERE userId=1`)
  db.run(`INSERT INTO users(userId,username,name,password,roleId) VALUES(2,'another-luis','luis','test',1)`)
  enableListening()
  const first = add('LISTEN')
  const second = add('LISTEN')
  db.run('UPDATE queue SET userId=2,tableId=NULL,tableLabelSnapshot=NULL WHERE queueId=?', [second])
  add('LISTEN', 'PENDING_APPROVAL')
  add('LISTEN', 'APPROVED', 'HOUSE')
  await until(() => !!automatic.preparation(1, first)?.assets.length && !!automatic.preparation(1, second)?.assets.length)
  expect(vi.mocked(provider.generate).mock.calls.filter(call => call[0] === 'Luis')).toHaveLength(1)
  expect(vi.mocked(provider.generate).mock.calls.filter(call => call[0] === listeningTemplate)).toHaveLength(1)
  expect(automatic.preparation(1, second)?.assets[0].displayText).toContain(listeningTemplates[1])
  const firstAudio = automatic.preparation(1, first)!.assets[0]
  expect(firstAudio.displayText).toBe(`Desde la mesa siete, ${listeningTemplate} Luis`)
  const dependencies = JSON.parse(part(1, firstAudio.partId)!.dependenciesJSON) as string[]
  expect(dependencies.map(id => part(1, id)!.kind)).toEqual(['table', 'template', 'name'])
  expect(automatic.preparation(1, second)?.assets[0].displayText).toBe(`${listeningTemplates[1]} Luis`)
  const count = vi.mocked(provider.generate).mock.calls.length
  db.run('UPDATE queue SET prevQueueId=NULL WHERE queueId=?', [first])
  automatic.reconcile()
  await worker.tick()
  expect(provider.generate).toHaveBeenCalledTimes(count)
  expect(db.all('SELECT * FROM listeningPresentations')).toHaveLength(2)
}, 30000)

async function legacyListeningPresentation () {
  await bank()
  enableListening()
  const id = add('LISTEN')
  await until(() => !!automatic.preparation(1, id)?.assets.length)
  const prepared = automatic.preparation(1, id)!
  const sources = (JSON.parse(part(1, prepared.assets[0].partId)!.dependenciesJSON) as string[]).map(id => part(1, id)!)
  const template = sources.find(source => source.kind === 'template')!
  const name = sources.find(source => source.kind === 'name')!
  const table = sources.find(source => source.kind === 'table')!
  const legacyJob = worker.submit(1, 'compose', { requestId: randomUUID(), sourceIds: [template.id, name.id, table.id] }, undefined, 'setup')
  await worker.tick()
  expect(job(1, legacyJob.id)?.status).toBe('ready')
  const legacy = part(1, job(1, legacyJob.id)!.resultId!)!
  const inputKey = key(['listening-v1', id, 'Ana', tableId, 'Mesa 07', 'LISTEN', 'PARTICIPANT', template.text, table.id, voice.profile()])
  db.run('UPDATE listeningPresentations SET inputKey=?,resultId=? WHERE roomId=1 AND queueId=?', [inputKey, legacy.id, id])
  return { id, legacy, context: { kind: 'listening' as const, queueId: id, inputKey, revision: prepared.revision, partId: legacy.id } }
}

it('reassembles pending legacy presentations table-first without regenerating any voice sources', async () => {
  const { id, legacy, context } = await legacyListeningPresentation()
  expect(legacy.text).toBe(`${listeningTemplate} Ana Desde la mesa siete,`)
  expect(automatic.valid(1, context)).toBe(false)
  const count = vi.mocked(provider.generate).mock.calls.length
  await until(() => automatic.preparation(1, id)?.assets[0].displayText.startsWith('Desde la mesa siete,') === true)
  const current = automatic.preparation(1, id)!.assets[0]
  expect(current.partId).not.toBe(legacy.id)
  expect(current.displayText).toBe(`Desde la mesa siete, ${listeningTemplate} Ana`)
  expect(provider.generate).toHaveBeenCalledTimes(count)
}, 30000)

it('lets a started legacy presentation finish with its original order and identity', async () => {
  const { id, legacy, context } = await legacyListeningPresentation()
  automatic.started(1, context)
  const count = vi.mocked(provider.generate).mock.calls.length
  automatic.reconcile()
  expect(automatic.valid(1, context, true)).toBe(true)
  expect(automatic.preparation(1, id, true)?.assets[0].partId).toBe(legacy.id)
  expect(automatic.preparation(1, id, true)?.assets[0].displayText).toBe(`${listeningTemplate} Ana Desde la mesa siete,`)
  expect(automatic.preparation(1, id)).toBeNull()
  expect(provider.generate).toHaveBeenCalledTimes(count)
}, 30000)

it('uses the reusable neutral name without generating doubtful input', async () => {
  db.run(`UPDATE users SET name='fgr' WHERE userId=1`)
  enableListening()
  const id = add('LISTEN')
  await until(() => !!automatic.preparation(1, id)?.assets.length)
  expect(automatic.preparation(1, id)?.assets[0].displayText).toContain('un invitado')
  expect(vi.mocked(provider.generate).mock.calls.some(call => call[0].includes('fgr'))).toBe(false)
  expect(vi.mocked(provider.generate).mock.calls.filter(call => call[0] === 'un invitado')).toHaveLength(1)
}, 30000)

it('keeps source audio through cleanup, a new jornada and restart without synthesis', async () => {
  enableListening()
  const id = add('LISTEN')
  await until(() => !!automatic.preparation(1, id)?.assets.length)
  const sourceCount = vi.mocked(provider.generate).mock.calls.length
  const directory = worker['directory']
  automatic.stop()
  await worker.stop()
  worker = new CallJobs(directory, voice)
  await worker.start()
  automatic = new CallAutomation(worker, voice)
  automatic.start()
  player()
  Animation.session(1, 1, 'open')
  Animation.session(1, 1, 'finish')
  Animation.session(1, 1, 'open')
  const second = add('LISTEN')
  voice.configure({ ...voice.config(), enabled: false })
  await until(() => !!automatic.preparation(1, second)?.assets.length)
  expect(provider.generate).toHaveBeenCalledTimes(sourceCount)
  expect(db.all(`SELECT * FROM karaokeCallParts WHERE kind IN ('name','template') AND retired=0`)).toHaveLength(4)
}, 30000)

it('keeps a completed listening presentation available for private review after cleanup and restart', async () => {
  enableListening()
  const id = add('LISTEN')
  await until(() => !!automatic.preparation(1, id)?.assets.length)
  const resultId = automatic.preparation(1, id)!.assets[0].partId
  const count = vi.mocked(provider.generate).mock.calls.length
  db.run(`UPDATE queue SET status='PLAYED' WHERE queueId=?`, [id])
  db.run('UPDATE karaokeCallJobs SET updatedAt=? WHERE resultId=?', [Date.now() - 6000, resultId])
  await worker['cleanup']()
  const state = automatic.snapshot(1).listeningRequests!.find(item => item.queueId === id)!
  expect(state.result?.id).toBe(resultId)
  expect(state.playback).toBe('omitted')
  await expect(worker.bytes(1, resultId)).resolves.toBeInstanceOf(Buffer)
  await worker.stop()
  worker = new CallJobs(worker['directory'], voice)
  await worker.start()
  await expect(worker.bytes(1, resultId)).resolves.toBeInstanceOf(Buffer)
  expect(provider.generate).toHaveBeenCalledTimes(count)
}, 30000)

it('bounds completed presentation retention at thirty per room while protecting pending audio and shared names', async () => {
  enableListening()
  const id = add('LISTEN')
  await until(() => !!automatic.preparation(1, id)?.assets.length)
  const original = part(1, automatic.preparation(1, id)!.assets[0].partId)!
  const copies: string[] = []
  for (let index = 0; index < 31; index++) {
    const queueId = add('LISTEN', 'PLAYED')
    const copyId = randomUUID()
    const master = `masters/${copyId}.wav`
    const filename = `production/${copyId}.mp3`
    await fs.copyFile(path.join(worker['directory'], original.master), path.join(worker['directory'], master))
    await fs.copyFile(path.join(worker['directory'], original.filename), path.join(worker['directory'], filename))
    db.run(`INSERT INTO karaokeCallParts(id,roomId,kind,variantId,title,text,profileKey,cacheKey,master,filename,checksum,masterChecksum,durationMs,createdAt,dependenciesJSON,retired)
      SELECT ?,roomId,kind,variantId,title,text,profileKey,cacheKey,?,?,checksum,masterChecksum,durationMs,createdAt,dependenciesJSON,retired
      FROM karaokeCallParts WHERE id=?`, [copyId, master, filename, original.id])
    db.run('INSERT INTO listeningPresentations(roomId,queueId,inputKey,resultId) VALUES(1,?,?,?)', [queueId, 'history', copyId])
    copies.push(copyId)
  }
  await worker['cleanup']()
  expect(part(1, copies[0])).toBeUndefined()
  await expect(worker.bytes(1, copies[30])).resolves.toBeInstanceOf(Buffer)
  await expect(worker.bytes(1, original.id)).resolves.toBeInstanceOf(Buffer)
  const state = automatic.snapshot(1).listeningRequests!
  expect(state).toHaveLength(31)
  expect(state.find(row => row.queueId === id)?.result?.id).toBe(original.id)
  const withoutAudio = add('LISTEN', 'PLAYED')
  db.run('INSERT INTO listeningPresentations(roomId,queueId,inputKey) VALUES(1,?,?)', [withoutAudio, 'no-audio'])
  expect(automatic.snapshot(1).listeningRequests!.find(row => row.queueId === withoutAudio)).toMatchObject({ canRecover: false, reason: 'No se generó una presentación para este pedido.' })
  expect(worker.snapshot(1).names?.some(row => row.text === 'Ana')).toBe(true)
  expect(worker.snapshot(2).names).toEqual(worker.snapshot(1).names)
}, 30000)

it('explains and persists a missing player asset separately from voice budget and transition time', async () => {
  enableListening()
  const identity = player()
  const id = add('LISTEN')
  await until(() => !!automatic.preparation(1, id)?.assets.length)
  const prepared = (await prepareGreetingTransition(1, id))!
  const ready = prepared.assets.map(asset => asset.checksum)
  expect(callTransitionFailure(1, null, prepared, [], 120000, 25000)).toBe('audio-not-ready')
  expect(callTransitionFailure(1, null, prepared, ready, 0, 25000)).toBe('voice-budget')
  expect(callTransitionFailure(1, null, prepared, ready, 120000, 0)).toBe('transition-time')
  const grant = Greetings.reserve(1, identity.socketId, id, { queueId: -1 }, undefined, prepared, [], 1)
  expect(grant?.transition).toBeUndefined()
  expect(db.get('SELECT playbackReason FROM listeningPresentations WHERE queueId=?', [id])).toEqual({ playbackReason: 'audio-not-ready' })
  expect(automatic.snapshot(1).listeningRequests!.find(item => item.queueId === id)).toMatchObject({ playback: 'omitted', playbackReason: expect.stringContaining('reproductor') })
  expect(db.all('SELECT * FROM animationInterventions')).toEqual([])
}, 30000)

it('recovers retired historical compositions privately and idempotently without synthesis', async () => {
  enableListening()
  const id = add('LISTEN')
  await until(() => !!automatic.preparation(1, id)?.assets.length)
  const original = part(1, automatic.preparation(1, id)!.assets[0].partId)!
  const count = vi.mocked(provider.generate).mock.calls.length
  db.run(`UPDATE queue SET status='PLAYED' WHERE queueId=?`, [id])
  db.run('UPDATE karaokeCallParts SET retired=1 WHERE id=?', [original.id])
  await Promise.all([original.master, original.filename].map(file => fs.rm(path.join(worker['directory'], file))))
  const input = { requestId: randomUUID() }
  const submitted = await automatic.listening.recover(1, id, input)
  await expect(automatic.listening.recover(2, id, input)).rejects.toThrow('pedido')
  await worker.tick()
  const recovered = await automatic.listening.recover(1, id, input)
  expect(recovered.id).toBe(submitted.id)
  expect(recovered.status).toBe('ready')
  expect(recovered.result!.text).toBe(original.text)
  expect(recovered.result!.id).not.toBe(original.id)
  expect(automatic.snapshot(1).listeningRequests!.find(item => item.queueId === id)!.result?.id).toBe(recovered.result!.id)
  expect(db.get('SELECT status FROM queue WHERE queueId=?', [id])).toEqual({ status: 'PLAYED' })
  expect(db.all('SELECT * FROM animationInterventions')).toEqual([])
  db.run('UPDATE karaokeCallParts SET retired=1 WHERE id=?', [JSON.parse(original.dependenciesJSON)[0]])
  await expect(automatic.listening.recover(1, id, { requestId: randomUUID() })).rejects.toThrow('No se conservan los archivos')
  expect(provider.generate).toHaveBeenCalledTimes(count)
}, 30000)

it('keeps a greeting attributed with presentation off and reuses its message when enabled', async () => {
  const identity = player()
  const id = add('LISTEN')
  Greetings.attach({ roomId: 1, userId: 1 }, id, { message: '¡Feliz cumpleaños!' }, {})
  Greetings.configurePlayback(1, { enabled: true, introClipId: null, ambienceEnabled: false }, 0)
  await until(() => automatic.preparation(1, id)?.assets.some(asset => asset.role === 'signature') === true)
  const message = { id: 'message-only', role: 'greeting' as const, senderIncluded: false, durationMs: 1500, checksum: 'f'.repeat(64),
    kind: 'voice' as const, title: 'Message', displayText: '¡Feliz cumpleaños!', source: 'fixture', license: 'fixture', url: 'api/fixture' }
  vi.spyOn(greetingAudio, 'getGreetingAudioAsset').mockResolvedValue(message)
  const signed = (await prepareGreetingTransition(1, id))!
  const off = Greetings.reserve(1, identity.socketId, id, { queueId: -1 }, undefined, signed, signed.assets.map(asset => asset.checksum), 1)!
  expect(off.transition?.assets.map(asset => asset.role)).toEqual(['greeting', 'signature'])
  expect(off.transition?.assets.at(-1)?.displayText).toBe('De Ana')
  Animation.event(identity, off.transition!.intervention.interventionId, off.transition!.intervention.playerEpoch!, 'NOT_STARTED')
  Greetings.finish(1, identity.socketId, id)
  enableListening()
  await until(() => automatic.preparation(1, id)?.assets.some(asset => asset.role === 'call') === true)
  const prepared = (await prepareGreetingTransition(1, id))!
  const on = Greetings.reserve(1, identity.socketId, id, { queueId: -1 }, undefined, prepared, prepared.assets.map(asset => asset.checksum), 1)!
  expect(on.transition?.assets.map(asset => asset.role)).toEqual(['call', 'greeting'])
  expect(on.transition?.assets.find(asset => asset.role === 'greeting')?.checksum).toBe(message.checksum)
  expect(vi.mocked(provider.generate).mock.calls.filter(call => call[0] === 'Ana')).toHaveLength(1)
}, 30000)

it.each(['RESERVED', 'DISPLAYING'] as const)('keeps a fallback signature valid during %s reconciliation when the listening composition failed', async (status) => {
  enableListening()
  const identity = player()
  const id = add('LISTEN')
  Greetings.attach({ roomId: 1, userId: 1 }, id, { message: 'Una noche especial.' }, {})
  Greetings.configurePlayback(1, { enabled: true, introClipId: null, ambienceEnabled: false }, 0)
  await until(() => automatic.preparation(1, id)?.assets.length === 2)
  const presentation = automatic.preparation(1, id)!.assets.find(asset => asset.role === 'call')!
  db.run('UPDATE karaokeCallParts SET retired=1 WHERE id=?', [presentation.partId])
  db.run(`UPDATE karaokeCallJobs SET status='failed',resultId=NULL,error='Fixture assembly failed' WHERE resultId=?`, [presentation.partId])
  automatic.reconcile()
  vi.spyOn(greetingAudio, 'getGreetingAudioAsset').mockResolvedValue({ id: 'message', role: 'greeting', senderIncluded: false, durationMs: 2000,
    checksum: 'e'.repeat(64), kind: 'voice', title: 'Message', displayText: 'Una noche especial.', source: 'fixture', license: 'fixture', url: 'api/fixture' })
  const prepared = (await prepareGreetingTransition(1, id))!
  const grant = Greetings.reserve(1, identity.socketId, id, { queueId: -1 }, undefined, prepared, prepared.assets.map(asset => asset.checksum), 1)!
  expect(grant.transition?.assets.map(asset => asset.role)).toEqual(['greeting', 'signature'])
  const intervention = grant.transition!.intervention
  const context = grant.transition!.call!
  if (status === 'DISPLAYING') Greetings.event(1, identity.socketId, id, grant.items[0].greetingId, 'start')
  automatic.reconcile()
  expect(automatic.valid(1, context)).toBe(true)
  Animation.sweep()
  expect(Animation.active(1)?.stopRequestedAt).toBeNull()
  expect(() => Animation.event(identity, intervention.interventionId, intervention.playerEpoch!, 'STARTED')).not.toThrow()
  // Preserving the reserved signature must not authorize a different sender.
  db.run(`UPDATE users SET name='Carla' WHERE userId=1`)
  Animation.sweep()
  expect(Animation.active(1)?.stopRequestedAt).toEqual(expect.any(Number))
}, 30000)

it('reserves animator, presentation and greeting in order and records each confirmed source once', async () => {
  enableListening()
  const identity = player()
  Animation.session(1, 1, 'open')
  const id = add('LISTEN')
  Greetings.attach({ roomId: 1, userId: 1 }, id, { message: 'Una noche especial.' }, {})
  Greetings.configurePlayback(1, { enabled: true, introClipId: null, ambienceEnabled: false }, 0)
  await until(() => automatic.preparation(1, id)?.assets.length === 2)
  vi.spyOn(greetingAudio, 'getGreetingAudioAsset').mockResolvedValue({ id: 'message', role: 'greeting', senderIncluded: false, durationMs: 2000,
    checksum: 'e'.repeat(64), kind: 'voice', title: 'Message', displayText: 'Una noche especial.', source: 'fixture', license: 'fixture', url: 'api/fixture' })
  vi.spyOn(catalog, 'catalogClips').mockReturnValue([{ id: 'general', kind: 'voice', family: 'turn', approvedForAuto: true, modes: ['mixed'],
    title: 'General', displayText: 'Seguimos disfrutando la noche.', durationMs: 1000, checksum: 'd'.repeat(64), source: 'fixture', license: 'fixture' }])
  const prepared = (await prepareGreetingTransition(1, id))!
  const grant = Greetings.reserve(1, identity.socketId, id, { queueId: -1 }, undefined, prepared, prepared.assets.map(asset => asset.checksum), 1)!
  expect(grant.transition?.assets.map(asset => asset.role)).toEqual(['intro', 'call', 'greeting'])
  const intervention = grant.transition!.intervention
  Animation.event(identity, intervention.interventionId, intervention.playerEpoch!, 'STARTED')
  Animation.event(identity, intervention.interventionId, intervention.playerEpoch!, 'ASSET_STARTED', grant.transition!.assets[1].id)
  expect(db.all('SELECT * FROM audioUsage')).toHaveLength(2)
  automatic.configure(1, { ...callControls(1), listeningEnabled: false })
  Animation.sweep()
  expect(Animation.active(1)?.stopRequestedAt).toBeNull()
  Animation.event(identity, intervention.interventionId, intervention.playerEpoch!, 'ENDED')
  expect(automatic.preparation(1, id)).toBeNull()
}, 30000)

it('invalidates names and removed requests and never retries uncertain name generation', async () => {
  enableListening()
  const id = add('LISTEN')
  await until(() => !!automatic.preparation(1, id)?.assets.length)
  const prepared = automatic.preparation(1, id)!
  const context = { kind: 'listening' as const, ...prepared, partId: prepared.assets[0].partId }
  expect(automatic.valid(1, context)).toBe(true)
  db.run(`UPDATE users SET name='Carla' WHERE userId=1`)
  expect(automatic.valid(1, context)).toBe(false)
  vi.mocked(provider.generate).mockRejectedValueOnce(new GreetingVoiceError('Sin confirmación', 'uncertain'))
  await until(() => !!db.get(`SELECT 1 FROM karaokeCallJobs WHERE operation='source' AND status='uncertain'`))
  const count = vi.mocked(provider.generate).mock.calls.length
  for (let index = 0; index < 3; index++) {
    automatic.reconcile()
    await worker.tick()
  }
  expect(provider.generate).toHaveBeenCalledTimes(count)
  expect(automatic.preparation(1, id)).toBeNull()
  db.run(`UPDATE queue SET status='REMOVED' WHERE queueId=?`, [id])
  expect(automatic.preparation(1, id)).toBeNull()
}, 30000)

it('prioritizes upcoming listening speech and exposes failed local assembly instead of endless preparation', async () => {
  enableListening()
  const id = add('LISTEN')
  automatic.reconcile()
  automatic.prioritize(1, id)
  expect(db.get<{ priority: number }>(`SELECT priority FROM karaokeCallJobs WHERE operation='source' AND text='Ana'`)?.priority).toBe(100)
  await until(() => !!automatic.preparation(1, id)?.assets.length)
  db.run(`UPDATE karaokeCallJobs SET status='failed',error='La presentación supera diez segundos.' WHERE operation='compose'`)
  db.run(`UPDATE listeningPresentations SET resultId=NULL WHERE queueId=?`, [id])
  const state = automatic.snapshot(1).listeningRequests!.find(item => item.queueId === id)!
  expect(state.status).toBe('fallback')
  expect(state.reason).toContain('supera diez segundos')
}, 30000)

it.each(['failed', 'uncertain'] as const)('rebuilds a shared %s composition once for a new request without synthesizing sources', async (status) => {
  enableListening()
  const first = add('LISTEN')
  await until(() => !!automatic.preparation(1, first)?.assets.length)
  const original = automatic.preparation(1, first)!.assets[0].partId
  const binding = db.get<{ templateId: string, templatePartId: string }>('SELECT templateId,templatePartId FROM listeningPresentations WHERE queueId=?', [first])!
  const receipt = db.get<{ id: string }>('SELECT id FROM karaokeCallJobs WHERE resultId=?', [original])!
  db.run(`UPDATE queue SET status='PLAYED' WHERE queueId=?`, [first])
  db.run('UPDATE karaokeCallParts SET retired=1 WHERE id=?', [original])
  db.run('UPDATE karaokeCallJobs SET status=?,error=?,resultId=NULL WHERE id=?', [status, 'Original local failure', receipt.id])
  const sourceCount = vi.mocked(provider.generate).mock.calls.length
  const second = add('LISTEN')
  db.run('INSERT INTO listeningPresentations(roomId,queueId,inputKey,templateId,templatePartId) VALUES(1,?,?,?,?)', [second, 'pending', binding.templateId, binding.templatePartId])
  await until(() => !!automatic.preparation(1, second)?.assets.length)
  const rebuilt = automatic.preparation(1, second)!.assets[0].partId
  expect(rebuilt).not.toBe(original)
  expect(db.get('SELECT status,error FROM karaokeCallJobs WHERE id=?', [receipt.id])).toEqual({ status, error: 'Original local failure' })
  const jobCount = db.get<{ n: number }>('SELECT count(*) n FROM karaokeCallJobs')!.n
  for (let n = 0; n < 5; n++) {
    automatic.reconcile()
    await worker.tick()
  }
  expect(db.get<{ n: number }>('SELECT count(*) n FROM karaokeCallJobs')!.n).toBe(jobCount)
  expect(provider.generate).toHaveBeenCalledTimes(sourceCount)
}, 30000)

it('bounds a failed local rebuild and records omission when music starts without a reservation', async () => {
  enableListening()
  player()
  const first = add('LISTEN')
  await until(() => !!automatic.preparation(1, first)?.assets.length)
  const original = part(1, automatic.preparation(1, first)!.assets[0].partId)!
  const binding = db.get<{ templateId: string, templatePartId: string }>('SELECT templateId,templatePartId FROM listeningPresentations WHERE queueId=?', [first])!
  db.run(`UPDATE queue SET status='PLAYED' WHERE queueId=?`, [first])
  db.run('UPDATE karaokeCallParts SET retired=1 WHERE id=?', [original.id])
  db.run(`UPDATE karaokeCallJobs SET status='failed',error='Original local failure',resultId=NULL WHERE resultId=?`, [original.id])
  const template = part(1, binding.templatePartId)!
  await fs.rm(path.join(worker['directory'], template.master))
  const count = vi.mocked(provider.generate).mock.calls.length
  const jobsBefore = db.get<{ n: number }>('SELECT count(*) n FROM karaokeCallJobs')!.n
  const second = add('LISTEN')
  db.run('INSERT INTO listeningPresentations(roomId,queueId,inputKey,templateId,templatePartId) VALUES(1,?,?,?,?)', [second, 'pending', binding.templateId, binding.templatePartId])
  for (let n = 0; n < 5; n++) {
    automatic.reconcile()
    await worker.tick()
  }
  expect(db.get<{ n: number }>('SELECT count(*) n FROM karaokeCallJobs')!.n).toBe(jobsBefore + 1)
  expect(automatic.preparation(1, second)).toBeNull()
  db.run(`UPDATE queue SET status='PLAYING' WHERE queueId=?`, [second])
  recordCallOmission(1, second)
  recordCallOmission(1, second)
  expect(db.get('SELECT playbackReason FROM listeningPresentations WHERE queueId=?', [second])).toEqual({ playbackReason: 'preparation-unavailable' })
  expect(automatic.snapshot(1).listeningRequests!.find(item => item.queueId === second)?.playback).toBe('omitted')
  expect(provider.generate).toHaveBeenCalledTimes(count)
}, 30000)

it.each([false, true])('resolves John through Yon and selects a new version without disrupting started=%s', async (started) => {
  enableListening()
  const identity = player()
  db.run(`UPDATE users SET name='Yon' WHERE userId=1`)
  const first = add('LISTEN')
  await until(() => !!automatic.preparation(1, first)?.assets.length)
  const group = NameBank.find('Yon')!
  NameBank.update(group.id, { revision: group.revision, aliases: ['John', 'Jhon', 'Ion'] })
  db.run(`UPDATE queue SET status='PLAYED' WHERE queueId=?`, [first])
  db.run(`UPDATE users SET name='John' WHERE userId=1`)
  const id = add('LISTEN')
  Greetings.attach({ roomId: 1, userId: 1 }, id, { message: 'Una noche especial.' }, {})
  Greetings.configurePlayback(1, { enabled: true, introClipId: null, ambienceEnabled: false }, 0)
  await until(() => automatic.preparation(1, id)?.assets.length === 2)
  const signature = automatic.preparation(1, id)!.assets.find(asset => asset.role === 'signature')!
  expect(signature.displayText).toBe('De Yon')
  expect(automatic.snapshot(1).listeningRequests!.find(row => row.queueId === id)?.performer).toBe('John')
  expect(vi.mocked(provider.generate).mock.calls.filter(call => call[0] === 'Yon')).toHaveLength(1)
  expect(vi.mocked(provider.generate).mock.calls.some(call => call[0] === 'John')).toBe(false)
  vi.spyOn(greetingAudio, 'getGreetingAudioAsset').mockResolvedValue({ id: 'message', role: 'greeting', senderIncluded: false, durationMs: 1500,
    checksum: 'e'.repeat(64), kind: 'voice', title: 'Message', displayText: 'Una noche especial.', source: 'fixture', license: 'fixture', url: 'api/fixture' })
  const prepared = (await prepareGreetingTransition(1, id))!
  const grant = Greetings.reserve(1, identity.socketId, id, { queueId: -1 }, undefined, prepared, prepared.assets.map(asset => asset.checksum), 1)!
  const intervention = grant.transition!.intervention
  if (started) Animation.event(identity, intervention.interventionId, intervention.playerEpoch!, 'STARTED')
  const generated = worker.submit(1, 'source', { requestId: randomUUID(), sourceKind: 'name', nameId: group.id, text: 'Yon', regenerate: true })
  await worker.tick()
  NameBank.choose(group.id, job(1, generated.id)!.resultId!, NameBank.get(group.id).revision)
  automatic.reconcile()
  expect(automatic.valid(1, grant.transition!.call!, started)).toBe(started)
  if (started) expect(automatic.snapshot(1).listeningRequests!.find(row => row.queueId === id)?.result?.id).toBe(grant.transition!.call!.partId)
  Animation.sweep()
  expect(!!Animation.active(1)?.stopRequestedAt).toBe(!started)
}, 30000)

it('reports a failed alias assembly against the actual spoken recipe rather than preparing forever', async () => {
  enableListening()
  db.run(`UPDATE users SET name='Yon' WHERE userId=1`)
  const first = add('LISTEN')
  await until(() => !!automatic.preparation(1, first)?.assets.length)
  const group = NameBank.find('Yon')!
  NameBank.update(group.id, { revision: group.revision, aliases: ['John'] })
  const original = part(1, automatic.preparation(1, first)!.assets[0].partId)!
  const binding = db.get<{ templateId: string, templatePartId: string }>('SELECT templateId,templatePartId FROM listeningPresentations WHERE queueId=?', [first])!
  db.run(`UPDATE queue SET status='PLAYED' WHERE queueId=?`, [first])
  db.run('UPDATE karaokeCallParts SET retired=1 WHERE id=?', [original.id])
  db.run(`UPDATE karaokeCallJobs SET status='failed',resultId=NULL,error='Original local failure' WHERE resultId=?`, [original.id])
  await fs.rm(path.join(worker['directory'], part(1, binding.templatePartId)!.master))
  db.run(`UPDATE users SET name='John' WHERE userId=1`)
  const second = add('LISTEN')
  db.run('INSERT INTO listeningPresentations(roomId,queueId,inputKey,templateId,templatePartId) VALUES(1,?,?,?,?)', [second, 'pending', binding.templateId, binding.templatePartId])
  for (let n = 0; n < 3; n++) {
    automatic.reconcile()
    await worker.tick()
  }
  expect(automatic.snapshot(1).listeningRequests!.find(row => row.queueId === second)).toMatchObject({ status: 'fallback', reason: expect.stringContaining('archivo') })
}, 30000)

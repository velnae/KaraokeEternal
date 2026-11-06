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
import { callControls, job, part, requestCall } from './Store.js'
import Animation from '../Animation.js'
import Greetings from '../../Greetings/Greetings.js'
import { prepareGreetingTransition } from '../../Greetings/transition.js'
import * as greetingAudio from '../../Greetings/audioRouter.js'

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

it('keeps an individual pending request inspectable outside the recent thirty-item window', () => {
  voice.configure({ ...voice.config(), enabled: false })
  enable()
  const ids = Array.from({ length: 35 }, (_, index) => add('SING', 'APPROVED', 'PARTICIPANT', `Canción ${index}`))
  automatic.reconcile()
  expect(automatic.snapshot(1).requests).toHaveLength(30)
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

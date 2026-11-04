import { afterEach, beforeEach, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseBuffer } from 'music-metadata'
import { open, close, db } from '../lib/Database.js'
import Queue from '../Queue/Queue.js'
import Greetings from './Greetings.js'
import GreetingVoice from './GreetingVoice.js'
import { GreetingVoiceError, type GreetingVoiceProvider } from './GeminiGreetingTts.js'
import GreetingAudioJobs, { type GreetingAudioJob } from './AudioJobs.js'

function wave (seconds = 0.4, silent = false) {
  const samples = Math.floor(24000 * seconds)
  const bytes = Buffer.alloc(44 + samples * 2)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(24000, 24)
  bytes.writeUInt32LE(48000, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(samples * 2, 40)
  if (!silent) for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(4000 * Math.sin(2 * Math.PI * 300 * i / 24000)), 44 + i * 2)
  return bytes
}

function fixture () {
  const state = { hold: false, mode: 'ok', received: [] as string[] }
  const waiting = new Set<() => void>()
  const provider: GreetingVoiceProvider = {
    configured: true,
    check: async () => {},
    generate: async (text, _profile, signal) => {
      state.received.push(text)
      const mode = state.mode
      if (state.hold) await new Promise<void>((resolve, reject) => {
        const done = () => {
          waiting.delete(done)
          signal.removeEventListener('abort', abort)
          resolve()
        }
        const abort = () => {
          waiting.delete(done)
          signal.removeEventListener('abort', abort)
          reject(new GreetingVoiceError('Cancelled request', 'uncertain'))
        }
        waiting.add(done)
        signal.addEventListener('abort', abort, { once: true })
      })
      if (mode === 'lost') throw new GreetingVoiceError('Lost reply', 'uncertain')
      if (mode === 'reject') throw new GreetingVoiceError('Rejected', 'invalid')
      if (mode === 'rate') throw new GreetingVoiceError('Rate limited', 'rate', Date.now() + 60)
      if (mode === 'quota') throw new GreetingVoiceError('Daily quota', 'quota')
      return mode === 'bad' ? Buffer.from('not audio') : wave(mode === 'long' ? 21 : 0.4, mode === 'silent')
    },
  }
  return {
    state, provider,
    release: () => {
      state.hold = false
      for (const done of waiting) done()
    },
  }
}

let directory: string
let data: string
let model: ReturnType<typeof fixture>
let tts: GreetingVoice
let jobs: GreetingAudioJobs
const options = { intervalMs: 20, maxPending: 10, retentionMs: 30 * 86400000, retryMs: 20 }
const allJobs = () => db.all<GreetingAudioJob>('SELECT * FROM greetingAudioJobs ORDER BY createdAt,rowid')
const jobFor = (greetingId: number) => db.get<GreetingAudioJob>('SELECT j.* FROM greetingAudioJobs j JOIN greetings g ON g.audioJobId=j.jobId WHERE g.greetingId=?', [greetingId])
const waitReady = (greetingId: number) => expect.poll(() => jobFor(greetingId)?.status, { timeout: 6000 }).toBe('ready')

async function startJobs (maxPending = 10) {
  tts = new GreetingVoice(model.provider)
  if (!tts.config().revision) tts.configure({ ...tts.config(), enabled: true, requestsPerMinute: 1000, requestsPerDay: 10000 })
  jobs = new GreetingAudioJobs(data, tts, 'ffmpeg', { ...options, maxPending })
  await jobs.start()
}

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g-audio-'))
  data = path.join(directory, 'audio')
  model = fixture()
  open({ file: path.join(directory, 'db.sqlite'), ro: false })
  db.exec(`INSERT INTO rooms(roomId,name,status,data) VALUES(1,'Main','open','{}'),(2,'Other','open','{}');
    INSERT INTO users(userId,username,password,name,roleId) VALUES(1,'ana','','Ana',1),(2,'juan','','Juan',3);`)
  Greetings.prepareAudio(1, true)
})
afterEach(async () => {
  await jobs?.stop()
  model.release()
  close()
  await fs.rm(directory, { recursive: true, force: true })
})

function greeting (message = '¡Feliz cumpleaños!', roomId = 1, approval: 'APPROVED' | 'PENDING_APPROVAL' = 'APPROVED') {
  const queueId = Queue.add({ roomId, userId: 1, status: approval, song: { source: 'YOUTUBE', sourceId: 'AAAAAAAAAAA', externalId: 'AAAAAAAAAAA', localSongId: null, mediaId: null, mediaType: 'youtube', title: 'Song', artistOrChannel: 'Artist', durationSeconds: 120, thumbnailUrl: null, isPlayable: true } })
  const greetingId = Greetings.attach({ roomId, userId: 1 }, queueId, { recipient: 'Rocío', message }, {})
  return { greetingId, queueId }
}

it('prepares approved, enabled greetings while preserving the queued musical and visual requests', async () => {
  Greetings.prepareAudio(1, false)
  const first = greeting('En espera', 1, 'PENDING_APPROVAL')
  await startJobs()
  await jobs.tick()
  expect(allJobs()).toHaveLength(0)
  Greetings.prepareAudio(1, true)
  await jobs.tick()
  expect(allJobs()).toHaveLength(0)
  Queue.transition(1, first.queueId, 'APPROVED')
  await waitReady(first.greetingId)
  expect(Queue.get(1).entities[first.queueId].status).toBe('APPROVED')
  expect(Greetings.items(1)[0]).toMatchObject({ status: 'QUEUED', audio: { status: 'ready' } })
  const bytes = await jobs.audio(1, first.greetingId)
  expect(bytes).toBeInstanceOf(Buffer)
  expect((await parseBuffer(bytes!, undefined, { duration: true })).format.duration).toBeGreaterThan(0)
  expect(await jobs.audio(2, first.greetingId)).toBeNull()
})

it('shares validated audio for equal normalized text, keeping requests and room caches separate', async () => {
  const first = greeting('Feliz día')
  const second = greeting('Feliz di\u0301a')
  await startJobs()
  await waitReady(first.greetingId)
  await waitReady(second.greetingId)
  expect(jobFor(first.greetingId)?.jobId).toBe(jobFor(second.greetingId)?.jobId)
  expect(Greetings.items(1)).toHaveLength(2)
  const third = greeting('Feliz día')
  await waitReady(third.greetingId)
  expect(model.state.received).toHaveLength(1)
  Greetings.prepareAudio(2, true)
  const foreign = greeting('Feliz día', 2)
  await waitReady(foreign.greetingId)
  expect(model.state.received).toHaveLength(2)
  expect(jobFor(foreign.greetingId)?.jobId).not.toBe(jobFor(first.greetingId)?.jobId)
})

it('sends one generation at a time and retains a shared job when one consumer cancels', async () => {
  model.state.hold = true
  const first = greeting()
  const shared = greeting()
  const next = greeting('Otro saludo')
  await startJobs()
  await expect.poll(() => model.state.received.length).toBe(1)
  Greetings.remove({ roomId: 1, userId: 1 }, first.greetingId)
  await jobs.tick()
  expect(jobFor(shared.greetingId)?.cancelRequested).toBe(0)
  expect(model.state.received).toHaveLength(1)
  expect(jobFor(next.greetingId)?.status).toBe('queued')
  expect(() => db.run(`UPDATE greetingAudioJobs SET status='generating' WHERE jobId=?`, [jobFor(next.greetingId)!.jobId])).toThrow()
  model.release()
  await waitReady(shared.greetingId)
  await waitReady(next.greetingId)
  expect(model.state.received).toHaveLength(2)
  expect(await jobs.audio(1, first.greetingId)).toBeNull()
})

it('aborts a cancelled generation and discards its late result', async () => {
  model.state.hold = true
  const first = greeting()
  const next = greeting('Siguiente saludo')
  await startJobs()
  await expect.poll(() => model.state.received.length).toBe(1)
  const original = jobFor(first.greetingId)!
  Greetings.remove({ roomId: 1, userId: 1 }, first.greetingId)
  await jobs.tick()
  expect(allJobs().find(job => job.jobId === original.jobId)).toMatchObject({ cancelRequested: 1 })
  model.release()
  await waitReady(next.greetingId)
  expect(allJobs().find(job => job.jobId === original.jobId)?.status).toBe('cancelled')
  expect(await jobs.audio(1, first.greetingId)).toBeNull()
  await expect.poll(() => fs.readdir(path.join(data, 'staging'))).toEqual([])
})

it('keeps visual reservation available while generation is pending and discards its late result', async () => {
  model.state.hold = true
  const first = greeting()
  await startJobs()
  await expect.poll(() => model.state.received.length).toBe(1)
  const grant = Greetings.reserve(1, 'player', first.queueId, {})!
  expect(grant.items[0].greetingId).toBe(first.greetingId)
  Greetings.event(1, 'player', grant.turnKey, first.greetingId, 'start')
  await jobs.tick()
  model.release()
  await expect.poll(() => allJobs()[0].status).toBe('cancelled')
  expect(Greetings.items(1)[0].status).toBe('DISPLAYING')
})

it('cancels an in-flight generation when its room is deleted and continues with another room', async () => {
  model.state.hold = true
  const first = greeting()
  Greetings.prepareAudio(2, true)
  const second = greeting('Otra sala', 2)
  await startJobs()
  await expect.poll(() => model.state.received.length).toBe(1)
  const original = jobFor(first.greetingId)!
  db.exec('DELETE FROM queue WHERE roomId=1; DELETE FROM rooms WHERE roomId=1')
  await jobs.tick()
  expect(allJobs().find(job => job.jobId === original.jobId)).toMatchObject({ roomId: null, cancelRequested: 1 })
  model.release()
  await waitReady(second.greetingId)
  expect(allJobs().find(job => job.jobId === original.jobId)?.status).toBe('cancelled')
})

it.each(['bad', 'silent', 'long', 'reject'])('rejects %s output and preserves visual delivery without repeating synthesis', async (mode) => {
  model.state.mode = mode
  const first = greeting()
  await startJobs()
  await expect.poll(() => jobFor(first.greetingId)?.status, { timeout: 6000 }).toBe('failed')
  await jobs.tick()
  expect(model.state.received).toHaveLength(1)
  expect(Greetings.items(1)[0]).toMatchObject({ status: 'QUEUED', audio: { status: 'failed' } })
  expect(await jobs.audio(1, first.greetingId)).toBeNull()
  expect(Greetings.reserve(1, 'player', first.queueId, {})?.items).toHaveLength(1)
})

it('keeps an uncertain result terminal without blocking other greetings', async () => {
  model.state.mode = 'lost'
  const first = greeting()
  await startJobs()
  await expect.poll(() => jobFor(first.greetingId)?.status).toBe('uncertain')
  expect(model.state.received).toHaveLength(1)
  model.state.mode = 'ok'
  const next = greeting('Segundo')
  await waitReady(next.greetingId)
  expect(jobFor(first.greetingId)).toMatchObject({ status: 'uncertain', attempts: 1 })
  expect(model.state.received).toHaveLength(2)
})

it('does not automatically resend a request interrupted by server restart', async () => {
  model.state.hold = true
  const first = greeting()
  await startJobs()
  await expect.poll(() => model.state.received.length).toBe(1)
  await jobs.stop()
  expect(jobFor(first.greetingId)?.status).toBe('uncertain')
  close()
  open({ file: path.join(directory, 'db.sqlite'), ro: false })
  await startJobs()
  expect(model.state.received).toHaveLength(1)
  model.release()
  const next = greeting('Siguiente solicitud')
  await waitReady(next.greetingId)
  expect(model.state.received).toHaveLength(2)
  expect(jobFor(first.greetingId)).toMatchObject({ status: 'uncertain', attempts: 1 })
  expect(tts.snapshot().usage.day).toBe(2)
})

it('bounds retries for explicit transient rate-limit rejections', async () => {
  model.state.mode = 'rate'
  const first = greeting()
  await startJobs()
  await expect.poll(() => jobFor(first.greetingId)?.status, { timeout: 6000 }).toBe('failed')
  expect(jobFor(first.greetingId)?.attempts).toBe(2)
  expect(model.state.received).toHaveLength(2)
  expect(Greetings.items(1)[0].status).toBe('QUEUED')
})

it('stops preparing when the room opts out and can prepare the same valid greeting after re-enabling', async () => {
  model.state.hold = true
  const first = greeting()
  await startJobs()
  await expect.poll(() => model.state.received.length).toBe(1)
  const original = jobFor(first.greetingId)!
  Greetings.prepareAudio(1, false)
  await jobs.tick()
  expect(Greetings.items(1)[0].audio).toBeUndefined()
  model.release()
  await expect.poll(() => allJobs().find(job => job.jobId === original.jobId)?.status).toBe('cancelled')
  Greetings.prepareAudio(1, true)
  await waitReady(first.greetingId)
  expect(jobFor(first.greetingId)?.jobId).not.toBe(original.jobId)
  expect(Greetings.items(1)[0].status).toBe('QUEUED')
})

it('discards an older configuration and prepares the pending greeting with the new revision', async () => {
  model.state.hold = true
  const first = greeting()
  await startJobs()
  await expect.poll(() => model.state.received.length).toBe(1)
  const original = jobFor(first.greetingId)!
  tts.configure({ ...tts.config(), voice: 'Kore' })
  await jobs.tick()
  model.release()
  await waitReady(first.greetingId)
  expect(jobFor(first.greetingId)?.jobId).not.toBe(original.jobId)
  expect(JSON.parse(jobFor(first.greetingId)!.profileJSON).voice).toBe('Kore')
  expect(allJobs().find(job => job.jobId === original.jobId)?.status).toBe('cancelled')
})

it('bounds the preparation queue and leaves excess greetings available visually', async () => {
  model.state.hold = true
  const first = greeting()
  const second = greeting('No perder este mensaje')
  await startJobs(1)
  await expect.poll(() => model.state.received.length).toBe(1)
  expect(allJobs()).toHaveLength(1)
  expect(Greetings.items(1).find(item => item.greetingId === second.greetingId)?.audio).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('ocupada') })
  model.release()
  await waitReady(first.greetingId)
  await waitReady(second.greetingId)
})

it('validates cached bytes before reuse and cleans expired audio without deleting active requests', async () => {
  const first = greeting()
  await startJobs()
  await waitReady(first.greetingId)
  const original = jobFor(first.greetingId)!
  await fs.writeFile(path.join(data, original.filename!), 'corrupt')
  expect(await jobs.audio(1, first.greetingId)).toBeNull()
  const second = greeting()
  await waitReady(second.greetingId)
  expect(model.state.received).toHaveLength(2)
  const current = jobFor(second.greetingId)!
  db.run('UPDATE greetingAudioJobs SET updatedAt=?', [Date.now() - 40 * 86400000])
  await jobs.cleanup()
  expect(await fs.stat(path.join(data, current.filename!))).toBeDefined()
  Greetings.remove({ roomId: 1, userId: 1 }, second.greetingId)
  await jobs.cleanup()
  expect(jobFor(second.greetingId)).toBeUndefined()
  await expect(fs.stat(path.join(data, current.filename!))).rejects.toThrow()
})

it('does not serve a prepared file after its display reservation expires', async () => {
  const first = greeting()
  await startJobs()
  await waitReady(first.greetingId)
  const grant = Greetings.reserve(1, 'player', first.queueId, {})!
  expect(await jobs.audio(1, first.greetingId)).toBeInstanceOf(Buffer)
  db.run('UPDATE greetingTurns SET untilAt=0 WHERE turnKey=?', [grant.turnKey])
  expect(await jobs.audio(1, first.greetingId)).toBeNull()
})

it('sends only plain greeting text with fixed options, while tagged text keeps visual delivery', async () => {
  const first = greeting('--seed 999 Un saludo para todos')
  const tagged = greeting('[laughs] Texto visible')
  await startJobs()
  await waitReady(first.greetingId)
  expect(model.state.received).toHaveLength(1)
  expect(model.state.received[0]).toBe('Para Rocío: --seed 999 Un saludo para todos — De Ana')
  expect(Greetings.items(1).find(item => item.greetingId === tagged.greetingId)).toMatchObject({ status: 'QUEUED', audio: { status: 'unavailable' } })
})

it('exhausted daily quota preserves visual delivery without repeated provider calls', async () => {
  model.state.mode = 'quota'
  const first = greeting()
  await startJobs()
  await expect.poll(() => jobFor(first.greetingId)?.status).toBe('failed')
  const second = greeting('Segunda sala sin cuota', 2)
  Greetings.prepareAudio(2, true)
  await expect.poll(() => jobFor(second.greetingId)?.status).toBe('failed')
  expect(model.state.received).toHaveLength(1)
  expect(Greetings.reserve(1, 'player', first.queueId, {})?.items).toHaveLength(1)
})

import { afterEach, beforeEach, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer, type Socket } from 'node:net'
import { parseBuffer } from 'music-metadata'
import { open, close, db } from '../lib/Database.js'
import Queue from '../Queue/Queue.js'
import Greetings from './Greetings.js'
import LocalTts from './LocalTts.js'
import GreetingAudioJobs, { type GreetingAudioJob } from './AudioJobs.js'
import type { LocalTtsConfig } from '../../shared/localTts.js'

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

async function fixture (directory: string) {
  await fs.mkdir(path.join(directory, '.tmp'), { recursive: true })
  await fs.mkdir(path.join(directory, '.venv/bin'), { recursive: true })
  await fs.mkdir(path.join(directory, 'reference'))
  await fs.symlink(process.execPath, path.join(directory, '.venv/bin/python'))
  for (const file of ['model.sh', 'resident.py', 'speak.py']) await fs.writeFile(path.join(directory, file), '# Test fixture\n')
  await fs.writeFile(path.join(directory, 'reference/es_mx_f1.wav'), wave())
  const sockets = new Set<Socket>()
  const waiting: Array<{ socket: Socket, action: string, args?: string[] }> = []
  const state = { hold: false, mode: 'ok', received: [] as string[][], completed: 0 }
  let release: (() => void) | undefined
  let running: Promise<void> | null = null
  let stopped = false
  const drain = async () => {
    while (waiting.length && !stopped) {
      const item = waiting.shift()!
      try {
        let result: object
        if (item.action === 'say') {
          const args = item.args!
          const output = args[args.indexOf('--output') + 1]
          const mode = state.mode
          if (state.hold) await new Promise<void>((resolve) => {
            release = resolve
          })
          if (stopped) return
          if (mode === 'reject') throw new Error('Fixture rejection')
          const bytes = mode === 'bad' ? Buffer.from('not audio') : wave(mode === 'long' ? 21 : 0.4, mode === 'silent')
          await fs.writeFile(output, bytes)
          await fs.writeFile(output.replace(/\.wav$/, '.json'), '{}')
          result = { output, audio_seconds: mode === 'long' ? 21 : 0.4, sample_rate: 24000 }
          state.completed++
          if (mode === 'lost') {
            item.socket.destroy()
            continue
          }
        } else result = { status: 'ready', pid: process.pid }
        if (!item.socket.destroyed) item.socket.end(JSON.stringify({ ok: true, result }) + '\n')
      } catch {
        if (!item.socket.destroyed) item.socket.end('{"ok":false,"error":"Fixture failure"}\n')
      }
    }
  }
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.once('close', () => sockets.delete(socket))
    socket.once('data', (data) => {
      const request = JSON.parse(data.toString())
      if (request.action === 'say') state.received.push(request.args)
      waiting.push({ socket, ...request })
      if (!running) running = drain().finally(() => {
        running = null
      })
    })
  })
  await new Promise<void>(resolve => server.listen(path.join(directory, '.tmp/model.sock'), resolve))
  return {
    state,
    release: () => {
      state.hold = false
      release?.()
    },
    close: async () => {
      stopped = true
      release?.()
      await running
      for (const socket of sockets) socket.destroy()
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}

let directory: string
let installation: string
let data: string
let model: Awaited<ReturnType<typeof fixture>>
let tts: LocalTts
let jobs: GreetingAudioJobs
let config: LocalTtsConfig
const options = { intervalMs: 20, maxPending: 10, retentionMs: 30 * 86400000, retryMs: 20 }
const allJobs = () => db.all<GreetingAudioJob>('SELECT * FROM greetingAudioJobs ORDER BY createdAt,rowid')
const jobFor = (greetingId: number) => db.get<GreetingAudioJob>('SELECT j.* FROM greetingAudioJobs j JOIN greetings g ON g.audioJobId=j.jobId WHERE g.greetingId=?', [greetingId])
const waitReady = (greetingId: number) => expect.poll(() => jobFor(greetingId)?.status, { timeout: 6000 }).toBe('ready')

async function startJobs (generationTimeoutMs = 3000, maxPending = 10) {
  tts = new LocalTts(config, (next) => {
    config = next
  }, { waitingMs: 20, timeoutMs: 3000, startupMs: 1000, retryMs: 20 }, generationTimeoutMs)
  tts.check()
  await expect.poll(() => tts.snapshot().state).toBe('ready')
  jobs = new GreetingAudioJobs(data, tts, 'ffmpeg', { ...options, maxPending })
  await jobs.start()
}

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g-audio-'))
  installation = path.join(directory, 'tts')
  data = path.join(directory, 'audio')
  model = await fixture(installation)
  config = { installationPath: installation, autoStart: false, revision: 1 }
  open({ file: path.join(directory, 'db.sqlite'), ro: false })
  db.exec(`INSERT INTO rooms(roomId,name,status,data) VALUES(1,'Main','open','{}'),(2,'Other','open','{}');
    INSERT INTO users(userId,username,password,name,roleId) VALUES(1,'ana','','Ana',1),(2,'juan','','Juan',3);`)
  Greetings.prepareAudio(1, true)
})
afterEach(async () => {
  await Promise.all([jobs?.stop(), tts?.close()])
  await model.close()
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

it('discards a cancelled generation after completion before sending the next request', async () => {
  model.state.hold = true
  const first = greeting()
  const next = greeting('Siguiente saludo')
  await startJobs()
  await expect.poll(() => model.state.received.length).toBe(1)
  const original = jobFor(first.greetingId)!
  Greetings.remove({ roomId: 1, userId: 1 }, first.greetingId)
  await jobs.tick()
  expect(allJobs().find(job => job.jobId === original.jobId)).toMatchObject({ status: 'generating', cancelRequested: 1 })
  expect(model.state.received).toHaveLength(1)
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

it('retains the in-flight barrier when its room is deleted and then continues with another room', async () => {
  model.state.hold = true
  const first = greeting()
  Greetings.prepareAudio(2, true)
  const second = greeting('Otra sala', 2)
  await startJobs()
  await expect.poll(() => model.state.received.length).toBe(1)
  const original = jobFor(first.greetingId)!
  db.exec('DELETE FROM queue WHERE roomId=1; DELETE FROM rooms WHERE roomId=1')
  await jobs.tick()
  expect(allJobs().find(job => job.jobId === original.jobId)).toMatchObject({ roomId: null, status: 'generating', cancelRequested: 1 })
  expect(model.state.received).toHaveLength(1)
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

it('holds an uncertain generation as a barrier and retries it at most once after the worker is free', async () => {
  model.state.hold = true
  const first = greeting()
  const next = greeting('Segundo')
  await startJobs(80)
  await expect.poll(() => jobFor(first.greetingId)?.status).toBe('uncertain')
  const originalAttempt = jobFor(first.greetingId)!.attemptId
  expect(model.state.received).toHaveLength(1)
  expect(jobFor(next.greetingId)?.status).toBe('queued')
  model.release()
  await waitReady(first.greetingId)
  await waitReady(next.greetingId)
  expect(jobFor(first.greetingId)?.attempts).toBe(2)
  expect(model.state.received).toHaveLength(3)
  await expect(fs.stat(path.join(data, 'staging', `${originalAttempt}.wav`))).rejects.toThrow()
})

it('fences an interrupted external worker across database reopen before retrying', async () => {
  model.state.hold = true
  const first = greeting()
  await startJobs()
  await expect.poll(() => model.state.received.length).toBe(1)
  await Promise.all([jobs.stop(), tts.close()])
  expect(jobFor(first.greetingId)?.status).toBe('uncertain')
  close()
  open({ file: path.join(directory, 'db.sqlite'), ro: false })
  tts = new LocalTts(config, () => {}, { waitingMs: 20, timeoutMs: 3000, startupMs: 1000, retryMs: 20 }, 3000)
  jobs = new GreetingAudioJobs(data, tts, 'ffmpeg', options)
  await jobs.start()
  expect(model.state.received).toHaveLength(1)
  model.release()
  await waitReady(first.greetingId)
  expect(model.state.received).toHaveLength(2)
  expect(jobFor(first.greetingId)?.attempts).toBe(2)
})

it('exhausts exactly one retry when the worker repeatedly loses the generation acknowledgment', async () => {
  model.state.mode = 'lost'
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
  await tts.configure({ ...config })
  await jobs.tick()
  expect(tts.snapshot().pending).toBe(true)
  model.release()
  await waitReady(first.greetingId)
  expect(jobFor(first.greetingId)?.jobId).not.toBe(original.jobId)
  expect(JSON.parse(jobFor(first.greetingId)!.profileJSON).configurationRevision).toBe(2)
  expect(allJobs().find(job => job.jobId === original.jobId)?.status).toBe('cancelled')
})

it('bounds the preparation queue and leaves excess greetings available visually', async () => {
  model.state.hold = true
  const first = greeting()
  const second = greeting('No perder este mensaje')
  await startJobs(3000, 1)
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
  const args = model.state.received[0]
  expect(args.slice(-2)).toEqual(['--', 'Para Rocío: --seed 999 Un saludo para todos — De Ana'])
  expect(args[args.indexOf('--seed') + 1]).toBe('42')
  expect(args[args.indexOf('--reference') + 1]).toContain(path.join(data, 'staging'))
  expect(Greetings.items(1).find(item => item.greetingId === tagged.greetingId)).toMatchObject({ status: 'QUEUED', audio: { status: 'unavailable' } })
})

import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { db } from '../lib/Database.js'
import getLogger from '../lib/Log.js'
import { prepareAudio, AudioValidationError } from '../Animation/AudioPreparation.js'
import type GreetingVoice from './GreetingVoice.js'
import { VoiceError as GreetingVoiceError } from '../AudioProviders/errors.js'
import { greetingAudioKey, greetingSpeechText } from './voiceProfile.js'
import type { Greeting, GreetingAudioStatus, GreetingAsset } from '../../shared/greetings.js'
import { greetingVoiceSample } from '../../shared/greetingVoice.js'
import { isGreetingAllowed } from '../../shared/greetings.js'

const run = promisify(execFile)
const log = getLogger('greeting-audio')
const eligible = `g.status='QUEUED' AND q.status='APPROVED' AND r.status='open' AND c.audioEnabled=1 AND c.paused=0
  AND NOT EXISTS(SELECT 1 FROM greetingTurns t WHERE t.turnKey=g.queueId)`
const joins = 'FROM greetings g JOIN queue q USING(queueId) JOIN rooms r ON r.roomId=g.roomId LEFT JOIN greetingControls c ON c.roomId=g.roomId'
interface PendingGreeting extends Greeting { audioJobId: string | null, audioReason: string | null }
export interface GreetingAudioJob {
  jobId: string
  roomId: number | null
  cacheKey: string
  spokenText: string
  profileJSON: string
  status: Exclude<GreetingAudioStatus, 'unavailable'>
  cancelRequested: number
  attempts: number
  attemptId: string | null
  createdAt: number
  updatedAt: number
  retryAt: number
  filename: string | null
  checksum: string | null
  durationMs: number | null
  error: string | null
}
const defaultOptions = { intervalMs: 500, maxPending: 10, retentionMs: 30 * 86400000, retryMs: 1000 }

/** A durable, single-consumer queue. Musical submission never waits for synthesis. */
export default class GreetingAudioJobs {
  private stopped = false
  private processorReady = false
  private working: Promise<void> | null = null
  private scanning: Promise<void> | null = null
  private timer?: ReturnType<typeof setInterval>
  private activeJob: string | null = null
  private preparation?: AbortController
  private previewController?: AbortController
  private previewWork: Promise<Buffer> | null = null
  private profileError = ''
  private cleanedAt = 0

  constructor (private directory: string, private tts: Pick<GreetingVoice, 'profile' | 'snapshot' | 'generate'>, private ffmpeg = 'ffmpeg', private options = defaultOptions) {}

  async start () {
    await fs.mkdir(path.join(this.directory, 'staging'), { recursive: true, mode: 0o700 })
    db.run(`UPDATE greetingAudioJobs SET status='uncertain',error='La preparación se interrumpió. No se repetirá automáticamente; el saludo continúa en pantalla.'
      WHERE status IN ('generating','preparing')`)
    for (const job of db.all<GreetingAudioJob>(`SELECT * FROM greetingAudioJobs WHERE status='uncertain'`)) await this.removeAttempt(job)
    try {
      await run(this.ffmpeg, ['-version'], { timeout: 5000 })
      this.processorReady = true
    } catch { this.profileError = 'Revise FFmpeg y reinicie el servidor. El saludo se mostrará en pantalla.' }
    if (this.stopped) return
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs)
    this.timer.unref()
    await this.tick()
  }

  tick (): Promise<void> {
    if (this.stopped) return Promise.resolve()
    if (this.scanning) return this.scanning
    this.scanning = this.scan().catch((error) => {
      log.error('Could not reconcile greeting audio: %s', error instanceof Error ? error.message : 'Unknown error')
    }).finally(() => { this.scanning = null })
    return this.scanning
  }

  private job (id: string) { return db.get<GreetingAudioJob>('SELECT * FROM greetingAudioJobs WHERE jobId=?', [id]) }

  private hasConsumers (jobId: string) {
    const job = this.job(jobId)
    return db.all<Greeting>(`SELECT g.* ${joins} WHERE g.audioJobId=? AND ${eligible}`, [jobId])
      .some((greeting) => {
        try {
          return greetingSpeechText(greeting) === job?.spokenText
        } catch { return false }
      })
  }

  private async scan () {
    // Detach preparation from ineligible requests without changing visual delivery.
    db.run(`UPDATE greetings SET audioJobId=NULL,audioReason=NULL WHERE status='QUEUED' AND audioJobId IS NOT NULL
      AND greetingId NOT IN (SELECT g.greetingId ${joins} WHERE ${eligible})`)
    const pending = db.all<PendingGreeting>(`SELECT g.* ${joins} WHERE ${eligible} ORDER BY g.createdAt,g.greetingId LIMIT 200`)
    const voice = this.tts.profile()
    if (this.stopped) return
    for (const greeting of pending) {
      if (!isGreetingAllowed(greeting)) {
        db.run(`UPDATE greetings SET status='REMOVED',reason='El saludo no cumple las reglas de publicación.',audioJobId=NULL WHERE greetingId=?`, [greeting.greetingId])
        continue
      }
      try {
        const text = greetingSpeechText(greeting)
        const key = greetingAudioKey(greeting.roomId, text, voice)
        const previous = greeting.audioJobId && this.job(greeting.audioJobId)
        if (previous && previous.cacheKey === key) continue
        let cached = db.get<GreetingAudioJob>(`SELECT * FROM greetingAudioJobs WHERE roomId=? AND cacheKey=? AND cancelRequested=0
          AND status IN ('queued','generating','preparing','ready','uncertain')`, [greeting.roomId, key])
        if (cached?.status === 'ready') {
          try {
            await this.preparedBytes(cached)
          } catch {
            db.run(`UPDATE greetingAudioJobs SET status='failed',error='El archivo de voz ya no está disponible.',updatedAt=? WHERE jobId=? AND status='ready'`, [Date.now(), cached.jobId])
            cached = undefined
          }
        }
        if (this.stopped || !db.get(`SELECT 1 ${joins} WHERE g.greetingId=? AND ${eligible}`, [greeting.greetingId])) continue
        const provider = this.tts.snapshot()
        if (!cached && (!provider.config.enabled || !provider.configured || provider.state === 'error')) throw new AudioValidationError(provider.message)
        if (!cached && !this.processorReady) throw new AudioValidationError(this.profileError)
        const count = db.get<{ n: number }>(`SELECT count(*) n FROM greetingAudioJobs WHERE status IN ('queued','generating','preparing')`)!.n
        if (!cached && count >= this.options.maxPending) throw new AudioValidationError('La preparación de voz está ocupada. El saludo conserva su entrega en pantalla.')
        db.exec('SAVEPOINT greeting_audio_enqueue')
        try {
          const jobId = cached?.jobId ?? randomUUID()
          if (!cached) db.run(`INSERT INTO greetingAudioJobs(jobId,roomId,cacheKey,spokenText,profileJSON,status,createdAt,updatedAt)
            VALUES(?,?,?,?,?,'queued',?,?)`, [jobId, greeting.roomId, key, text, JSON.stringify(voice), Date.now(), Date.now()])
          db.run('UPDATE greetings SET audioJobId=?,audioReason=NULL WHERE greetingId=? AND status=\'QUEUED\'', [jobId, greeting.greetingId])
          db.exec('RELEASE greeting_audio_enqueue')
        } catch (error) {
          db.exec('ROLLBACK TO greeting_audio_enqueue; RELEASE greeting_audio_enqueue')
          throw error
        }
      } catch (error) {
        if (!(error instanceof AudioValidationError)) throw error
        db.run('UPDATE greetings SET audioJobId=NULL,audioReason=? WHERE greetingId=? AND status=\'QUEUED\'', [error.message, greeting.greetingId])
      }
    }
    for (const job of db.all<GreetingAudioJob>(`SELECT * FROM greetingAudioJobs WHERE status IN ('queued','generating','preparing') AND cancelRequested=0`)) {
      if (this.hasConsumers(job.jobId)) continue
      db.run(`UPDATE greetingAudioJobs SET cancelRequested=1,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,
        error='El saludo ya no necesita preparación.',updatedAt=? WHERE jobId=?`, [Date.now(), job.jobId])
      if (job.jobId === this.activeJob) this.preparation?.abort()
    }
    if (!this.tts.snapshot().config.enabled) this.preparation?.abort()
    if (!this.working) {
      const next = db.get<GreetingAudioJob>(`SELECT * FROM greetingAudioJobs WHERE status='queued' AND cancelRequested=0 AND retryAt<=? ORDER BY createdAt,rowid LIMIT 1`, [Date.now()])
      if (next && this.processorReady) {
        const attemptId = randomUUID()
        const claimed = db.run(`UPDATE greetingAudioJobs SET status='generating',attempts=attempts+1,attemptId=?,updatedAt=?,error=NULL
          WHERE jobId=? AND status='queued' AND NOT EXISTS(SELECT 1 FROM greetingAudioJobs WHERE status IN ('generating','preparing'))`, [attemptId, Date.now(), next.jobId])
        if (claimed.changes) this.launchWork(() => this.process(this.job(next.jobId)!), next.jobId)
      }
    }
    if (!this.working && Date.now() - this.cleanedAt > 3600000) await this.cleanup()
  }

  private launchWork (work: () => Promise<void>, jobId: string) {
    this.activeJob = jobId
    this.working = work().catch((error) => {
      log.error('Greeting audio worker failed (%s)', error instanceof Error ? error.name : 'Unknown error')
      db.run(`UPDATE greetingAudioJobs SET status='uncertain',error='La preparación se interrumpió.' WHERE jobId=? AND status IN ('generating','preparing')`, [jobId])
    }).finally(() => {
      this.working = null
      this.activeJob = null
      this.preparation = undefined
    })
  }

  private attemptPaths (attemptId: string) {
    if (!/^[a-f0-9-]{36}$/.test(attemptId)) throw new Error('Invalid audio attempt')
    // Also clean artifacts left by the previous local provider during migration.
    return { wav: path.join(this.directory, 'staging', `${attemptId}.wav`), reference: path.join(this.directory, 'staging', `${attemptId}.reference.wav`), metadata: path.join(this.directory, 'staging', `${attemptId}.json`),
      raw: path.join(this.directory, 'production', `${attemptId}.download`), partial: path.join(this.directory, 'production', `${attemptId}.part`) }
  }

  private async removeAttempt (job: GreetingAudioJob) {
    if (!job.attemptId) return
    await Promise.all(Object.values(this.attemptPaths(job.attemptId)).map(file => fs.rm(file, { force: true }).catch(() => {})))
    if (this.job(job.jobId)?.status !== 'ready') await fs.rm(path.join(this.directory, 'production', `${job.attemptId}.mp3`), { force: true }).catch(() => {})
  }

  private async stillCurrent (job: GreetingAudioJob) {
    if (job.roomId === null || this.stopped || this.job(job.jobId)?.cancelRequested || !this.hasConsumers(job.jobId)) return false
    try {
      const current = this.tts.profile()
      return !this.stopped && !this.job(job.jobId)?.cancelRequested && this.hasConsumers(job.jobId)
        && this.tts.snapshot().config.enabled && greetingAudioKey(job.roomId, job.spokenText, current) === job.cacheKey
    } catch { return false }
  }

  private async process (job: GreetingAudioJob) {
    let prepared: Awaited<ReturnType<typeof prepareAudio>> | undefined
    try {
      const current = this.tts.profile()
      if (job.roomId === null || greetingAudioKey(job.roomId, job.spokenText, current) !== job.cacheKey || !this.hasConsumers(job.jobId)) {
        this.cancelOrInterrupt(job)
        return
      }
      if (this.stopped || this.job(job.jobId)?.cancelRequested || !this.hasConsumers(job.jobId)) {
        this.cancelOrInterrupt(job)
        return
      }
      this.preparation = new AbortController()
      const bytes = await this.tts.generate(job.spokenText, current, this.preparation.signal)
      if (!await this.stillCurrent(job)) {
        this.cancelOrInterrupt(job)
        return
      }
      db.run(`UPDATE greetingAudioJobs SET status='preparing',updatedAt=? WHERE jobId=?`, [Date.now(), job.jobId])
      prepared = await prepareAudio(this.directory, job.attemptId!, 'voice', bytes, this.ffmpeg, this.preparation.signal, undefined, { durationMs: 20000 })
      if (!await this.stillCurrent(job)) {
        await fs.rm(path.join(this.directory, prepared.filename), { force: true })
        this.cancelOrInterrupt(job)
        return
      }
      const published = db.run(`UPDATE greetingAudioJobs SET status='ready',filename=?,checksum=?,durationMs=?,updatedAt=?,error=NULL
        WHERE jobId=? AND status='preparing' AND cancelRequested=0 AND EXISTS(SELECT 1 ${joins} WHERE g.audioJobId=? AND ${eligible})`,
      [prepared.filename, prepared.checksum, prepared.durationMs, Date.now(), job.jobId, job.jobId])
      if (!published.changes) {
        await fs.rm(path.join(this.directory, prepared.filename), { force: true })
        this.cancel(job.jobId)
      }
    } catch (error) {
      if (this.stopped) this.cancelOrInterrupt(job)
      else if (!this.hasConsumers(job.jobId) || this.job(job.jobId)?.cancelRequested || !this.tts.snapshot().config.enabled) this.cancel(job.jobId)
      else if (error instanceof GreetingVoiceError && error.kind === 'uncertain') {
        db.run(`UPDATE greetingAudioJobs SET status='uncertain',error='La generación no confirmó su resultado. El saludo sigue en pantalla.',updatedAt=? WHERE jobId=?`, [Date.now(), job.jobId])
      } else if (error instanceof GreetingVoiceError && ['rate', 'busy'].includes(error.kind) && (!error.attempted || job.attempts < 2)) {
        db.run(`UPDATE greetingAudioJobs SET status='queued',attempts=attempts-?,retryAt=?,updatedAt=?,error=? WHERE jobId=?`,
          [error.attempted ? 0 : 1, Math.max(Date.now() + this.options.retryMs, error.retryAt), Date.now(), error.message, job.jobId])
      } else {
        const reason = error instanceof AudioValidationError || error instanceof GreetingVoiceError ? error.message : 'No se pudo preparar la voz. El saludo se mostrará en pantalla.'
        db.run(`UPDATE greetingAudioJobs SET status='failed',error=?,updatedAt=? WHERE jobId=?`, [reason, Date.now(), job.jobId])
      }
    } finally {
      if (prepared && this.job(job.jobId)?.status !== 'ready') await fs.rm(path.join(this.directory, prepared.filename), { force: true }).catch(() => {})
      await this.removeAttempt(job)
    }
  }

  private cancel (jobId: string) {
    db.run(`UPDATE greetingAudioJobs SET status='cancelled',cancelRequested=1,error='El saludo dejó de estar disponible para esta preparación.',updatedAt=? WHERE jobId=?`, [Date.now(), jobId])
  }

  private cancelOrInterrupt (job: GreetingAudioJob) {
    if (this.stopped && !this.job(job.jobId)?.cancelRequested && this.hasConsumers(job.jobId)) {
      db.run(`UPDATE greetingAudioJobs SET status='uncertain',error='El servidor se cerró durante la preparación.',updatedAt=? WHERE jobId=?`, [Date.now(), job.jobId])
    } else this.cancel(job.jobId)
  }

  async audio (roomId: number, greetingId: number): Promise<Buffer | null> {
    const read = () => db.get<PendingGreeting>(`SELECT g.* ${joins} WHERE g.greetingId=? AND g.roomId=? AND g.status IN ('QUEUED','RESERVED','DISPLAYING')
      AND q.status='APPROVED' AND r.status='open' AND c.audioEnabled=1 AND c.paused=0
      AND (g.status='QUEUED' OR EXISTS(SELECT 1 FROM greetingTurns t WHERE t.turnKey=g.turnKey AND t.finished=0 AND t.untilAt>?))`, [greetingId, roomId, Date.now()])
    const greeting = read()
    const job = greeting?.audioJobId && this.job(greeting.audioJobId)
    if (!greeting || !isGreetingAllowed(greeting) || !job || job.status !== 'ready' || job.cancelRequested || !job.filename?.match(/^production\/[a-f0-9-]{36}\.mp3$/)) return null
    const profile = this.tts.profile()
    if (greetingAudioKey(roomId, greetingSpeechText(greeting), profile) !== job.cacheKey) return null
    try {
      const bytes = await this.preparedBytes(job)
      const current = read()
      if (current?.audioJobId !== job.jobId || current.message !== greeting.message || current.sender !== greeting.sender
        || greetingAudioKey(roomId, greetingSpeechText(greeting), this.tts.profile()) !== job.cacheKey) return null
      return bytes
    } catch {
      db.run(`UPDATE greetingAudioJobs SET status='failed',error='El archivo de voz ya no está disponible.',updatedAt=? WHERE jobId=? AND status='ready'`, [Date.now(), job.jobId])
      return null
    }
  }

  async asset (roomId: number, greetingId: number): Promise<GreetingAsset | null> {
    const bytes = await this.audio(roomId, greetingId)
    if (!bytes) return null
    const job = db.get<GreetingAudioJob>(`SELECT j.* FROM greetingAudioJobs j JOIN greetings g ON g.audioJobId=j.jobId WHERE g.greetingId=? AND g.roomId=?`, [greetingId, roomId])
    if (!job || job.status !== 'ready' || !job.durationMs || createHash('sha256').update(bytes).digest('hex') !== job.checksum) return null
    return { id: `greeting-${greetingId}-${job.jobId}`, role: 'greeting', senderIncluded: false, url: `api/greetings/${greetingId}/audio`, kind: 'voice',
      checksum: job.checksum!, durationMs: job.durationMs, displayText: job.spokenText, title: 'Saludo', source: 'Gemini', license: 'Private participant greeting', roomId }
  }

  private async preparedBytes (job: GreetingAudioJob) {
    if (!job.filename?.match(/^production\/[a-f0-9-]{36}\.mp3$/)) throw new Error('Invalid cached path')
    const file = path.join(this.directory, job.filename)
    const stat = await fs.lstat(file)
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new Error('Invalid cached file')
    const bytes = await fs.readFile(file)
    if (createHash('sha256').update(bytes).digest('hex') !== job.checksum) throw new Error('Invalid cached checksum')
    return bytes
  }

  async cleanup () {
    this.cleanedAt = Date.now()
    const expired = db.all<GreetingAudioJob>(`SELECT * FROM greetingAudioJobs j WHERE updatedAt<? AND status IN ('ready','failed','cancelled','uncertain')
      AND NOT EXISTS(SELECT 1 FROM greetings g WHERE g.audioJobId=j.jobId AND g.status IN ('QUEUED','RESERVED','DISPLAYING'))`, [Date.now() - this.options.retentionMs])
    for (const job of expired) {
      if (job.jobId === this.activeJob) continue
      const claimed = db.run(`UPDATE greetingAudioJobs SET status='cancelled',cancelRequested=1 WHERE jobId=?
        AND NOT EXISTS(SELECT 1 FROM greetings WHERE audioJobId=? AND status IN ('QUEUED','RESERVED','DISPLAYING'))`, [job.jobId, job.jobId])
      if (!claimed.changes) continue
      await this.removeAttempt(job)
      if (job.filename?.match(/^production\/[a-f0-9-]{36}\.mp3$/)) await fs.rm(path.join(this.directory, job.filename), { force: true })
      db.run('DELETE FROM greetingAudioJobs WHERE jobId=?', [job.jobId])
    }
  }

  preview (signal: AbortSignal): Promise<Buffer> {
    if (this.stopped || this.previewWork) return Promise.reject(new GreetingVoiceError('Hay otra prueba en curso o el servidor se está cerrando.', 'busy', 0, false))
    if (!this.processorReady) return Promise.reject(new AudioValidationError(this.profileError))
    this.previewController = new AbortController()
    const combined = AbortSignal.any([signal, this.previewController.signal])
    this.previewWork = (async () => {
      let prepared: Awaited<ReturnType<typeof prepareAudio>> | undefined
      try {
        const bytes = await this.tts.generate(greetingVoiceSample, this.tts.profile(), combined, true)
        prepared = await prepareAudio(this.directory, randomUUID(), 'voice', bytes, this.ffmpeg, combined, undefined, { durationMs: 20000 })
        return await fs.readFile(path.join(this.directory, prepared.filename))
      } finally {
        if (prepared) await fs.rm(path.join(this.directory, prepared.filename), { force: true })
      }
    })().finally(() => {
      this.previewWork = null
      this.previewController = undefined
    })
    return this.previewWork
  }

  async stop () {
    this.stopped = true
    clearInterval(this.timer)
    this.preparation?.abort()
    this.previewController?.abort()
    await this.scanning
    await this.working
    await this.previewWork?.catch(() => {})
  }
}

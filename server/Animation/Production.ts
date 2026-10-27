import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseBuffer } from 'music-metadata'
import { db } from '../lib/Database.js'
import getLogger from '../lib/Log.js'
import { clipDurationLimit, VOICE_FAMILIES } from '../../shared/animation.js'
import { voicePrompt, type GenerationJob, type ProductionConfig, type ProductionInput, type ProductionStatus } from '../../shared/catalogProduction.js'
import { catalogAsset, saveCatalogRecord } from './catalog.js'
import { ElevenLabs, ProviderError } from './ElevenLabs.js'

const run = promisify(execFile)
class AudioValidationError extends Error {}
type StoredJob = Omit<GenerationJob, 'config'> & { configJSON: string, filename: string | null, checksum: string | null }
const positive = (value: string | undefined, fallback: number) => Number.isFinite(Number(value)) && Number(value) >= 0 && value !== '' && value !== undefined ? Number(value) : fallback
export interface ProductionOptions {
  key: string
  baseUrl?: string
  voiceId: string
  model: string
  characterLimit: number
  effectSecondsLimit: number
  pricePerThousandCharacters: number | null
  pricePerEffectSecond: number | null
  ffmpeg: string
}
export const productionOptions = (): ProductionOptions => ({
  key: process.env.KES_ELEVENLABS_API_KEY ?? '',
  baseUrl: process.env.KES_ELEVENLABS_BASE_URL,
  voiceId: process.env.KES_ELEVENLABS_VOICE_ID ?? '',
  model: process.env.KES_ELEVENLABS_MODEL ?? 'eleven_v4',
  characterLimit: positive(process.env.KES_ELEVENLABS_CHARACTER_LIMIT, 10000),
  effectSecondsLimit: positive(process.env.KES_ELEVENLABS_EFFECT_SECONDS_LIMIT, 300),
  pricePerThousandCharacters: process.env.KES_ELEVENLABS_PRICE_PER_1K_CHARS ? positive(process.env.KES_ELEVENLABS_PRICE_PER_1K_CHARS, 0) : null,
  pricePerEffectSecond: process.env.KES_ELEVENLABS_PRICE_PER_EFFECT_SECOND ? positive(process.env.KES_ELEVENLABS_PRICE_PER_EFFECT_SECOND, 0) : null,
  ffmpeg: process.env.KES_FFMPEG_PATH || 'ffmpeg',
})

export class CatalogProduction {
  private provider: ElevenLabs
  private processorAvailable = false
  private unavailableReason: string | null = null
  private verifiedVoices: { voiceId: string, name: string }[] | null = null
  private stopped = false
  private working: Promise<void> | null = null
  private activeAbort: AbortController | null = null
  private timer?: ReturnType<typeof setInterval>

  constructor (private directory: string, private options: ProductionOptions, private onPublished: (roomId: number) => void = () => {}) {
    this.provider = new ElevenLabs(options.key, options.baseUrl)
  }

  async start () {
    try {
      await fs.mkdir(path.join(this.directory, 'production'), { recursive: true })
      await run(this.options.ffmpeg, ['-version'], { timeout: 5000 })
      this.processorAvailable = true
    } catch {
      this.processorAvailable = false
      this.unavailableReason = 'Revise FFmpeg y los permisos de la carpeta de producción en el servidor.'
    }
    db.run('UPDATE catalogGenerationJobs SET status=\'uncertain\', error=\'Servidor reiniciado durante la generación. Revise el consumo antes de regenerar.\', finishedAt=? WHERE status=\'generating\'', [Date.now()])
    for (const job of db.all<StoredJob>('SELECT * FROM catalogGenerationJobs WHERE status=\'publishing\'')) {
      db.run('UPDATE catalogGenerationJobs SET status=? WHERE jobId=?', [catalogAsset(`generated-${job.jobId}`) ? 'published' : 'ready_for_review', job.jobId])
    }
    this.timer = setInterval(() => {
      void this.drain()
    }, 500)
    this.timer.unref()
    void this.drain()
  }

  async stop () {
    this.stopped = true
    clearInterval(this.timer)
    this.activeAbort?.abort()
    await this.working
  }

  status (): ProductionStatus {
    const now = new Date()
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
    const totals = db.all<{ unitType: string, total: number }>(`SELECT unitType,SUM(units) total FROM catalogGenerationJobs
      WHERE startedAt >= ? OR (startedAt IS NULL AND status='queued') GROUP BY unitType`, [monthStart])
    const { model, characterLimit, effectSecondsLimit, pricePerThousandCharacters, pricePerEffectSecond } = this.options
    const voices = (this.verifiedVoices ?? []).map(voice => ({ ...voice }))
    const voiceId = voices.some(voice => voice.voiceId === this.options.voiceId)
      ? this.options.voiceId
      : voices[0]?.voiceId ?? this.options.voiceId
    return { configured: !!this.options.key, connectionVerified: this.verifiedVoices !== null, processorAvailable: this.processorAvailable,
      unavailableReason: this.unavailableReason, model, voiceId, voices,
      characterLimit, effectSecondsLimit, pricePerThousandCharacters, pricePerEffectSecond,
      usedCharacters: totals.find(row => row.unitType === 'characters')?.total ?? 0,
      usedEffectSeconds: totals.find(row => row.unitType === 'seconds')?.total ?? 0 }
  }

  async check () {
    if (!this.options.key) throw new Error('Configure KES_ELEVENLABS_API_KEY en el servidor.')
    this.verifiedVoices = null
    const voices = await this.provider.check(this.options.model)
    this.verifiedVoices = voices
    return voices
  }

  list (roomId: number, include: string[] = []): GenerationJob[] {
    const rows = db.all<StoredJob>('SELECT * FROM catalogGenerationJobs WHERE roomId=? ORDER BY createdAt DESC,rowid DESC LIMIT 100', [roomId])
    for (const jobId of include.slice(0, 9)) {
      if (rows.some(row => row.jobId === jobId)) continue
      const row = db.get<StoredJob>('SELECT * FROM catalogGenerationJobs WHERE roomId=? AND jobId=?', [roomId, jobId])
      if (row) rows.push(row)
    }
    return rows
      .map(({ configJSON, filename, checksum, ...job }) => {
        void filename
        void checksum
        return { ...job, config: JSON.parse(configJSON), active: !!catalogAsset(`generated-${job.jobId}`) }
      })
  }

  private config (input: ProductionInput): ProductionConfig {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Recurso de producción no válido.')
    const kind = input.kind
    if (!['voice', 'effect', 'ambience'].includes(kind)) throw new Error('Tipo de recurso no válido')
    const text = typeof input.text === 'string' ? input.text.normalize('NFC').replace(/\s+/g, ' ').trim() : ''
    const title = typeof input.title === 'string' ? input.title.trim() : ''
    if ([...text].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error('El texto contiene caracteres de control.')
    if (!title || title.length > 80 || !text || text.length > (kind === 'voice' ? 220 : 450)) throw new Error('Revise el título y la longitud del texto.')
    if (/[<>[\]]/.test(text)) throw new Error('Use el perfil de interpretación; no introduzca etiquetas de motor ni HTML.')
    if (!['manual', ...VOICE_FAMILIES].includes(input.family)) throw new Error('Familia no válida')
    if (input.family === 'promotion' && (!Number.isFinite(input.validUntil) || input.validUntil! <= Date.now())) throw new Error('Indique hasta cuándo estará vigente la promoción.')
    if (!['warm', 'cheerful', 'celebration'].includes(input.style)) throw new Error('Perfil de interpretación no válido')
    const voiceId = input.voiceId || this.options.voiceId
    if (kind === 'voice' && !/^[a-zA-Z0-9_-]{1,120}$/.test(voiceId)) throw new Error('Seleccione una voz de ElevenLabs.')
    const durationSeconds = kind === 'voice' ? undefined : input.durationSeconds ?? (kind === 'effect' ? 2 : 8)
    if (durationSeconds !== undefined && (!Number.isFinite(durationSeconds) || durationSeconds < 0.5 || durationSeconds * 1000 > clipDurationLimit(kind))) throw new Error('Duración fuera del límite del recurso.')
    const revision = input.revision ?? 0
    if (!Number.isInteger(revision) || revision < 0 || revision > 1000) throw new Error('Revisión no válida')
    const modes = input.modes ?? ['dinner', 'mixed', 'party']
    if (!Array.isArray(modes) || !modes.length || modes.some(mode => !['dinner', 'mixed', 'party'].includes(mode))) throw new Error('Perfil de sala no válido')
    return { title, text, kind, family: input.family, style: input.style, voiceId: kind === 'voice' ? voiceId : undefined,
      durationSeconds, revision, modes: [...new Set(modes)].sort(), validUntil: input.family === 'promotion' ? input.validUntil : undefined,
      model: kind === 'voice' ? this.options.model : 'eleven_text_to_sound_v2',
      spokenText: kind === 'voice' ? voicePrompt(text, input.style) : text,
      settings: { stability: input.style === 'warm' ? 0.6 : 0.4, similarity_boost: 0.75 }, processingRevision: 1 }
  }

  enqueue (roomId: number, userId: number, inputs: ProductionInput[]) {
    if (!this.options.key) throw new Error('Configure KES_ELEVENLABS_API_KEY en el servidor.')
    if (!this.verifiedVoices) throw new Error('Verifique la conexión de ElevenLabs antes de generar.')
    if (!this.processorAvailable) throw new Error('Instale FFmpeg para validar y preparar el audio generado.')
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > 9) throw new Error('Seleccione entre uno y nueve recursos por lote.')
    const configs = inputs.map(input => this.config(input))
    if (configs.some(config => config.kind === 'voice' && !this.verifiedVoices!.some(voice => voice.voiceId === config.voiceId))) throw new Error('Seleccione una voz disponible en la cuenta verificada.')
    const submitted = new Set<string>()
    db.exec('SAVEPOINT generation_batch')
    try {
      for (const config of configs) {
        const encoded = JSON.stringify(config)
        const generationKey = createHash('sha256').update(`${roomId}:${encoded}`).digest('hex')
        const existing = db.get<{ jobId: string }>('SELECT jobId FROM catalogGenerationJobs WHERE roomId=? AND generationKey=?', [roomId, generationKey])
        if (existing) {
          submitted.add(existing.jobId)
          continue
        }
        const unitType = config.kind === 'voice' ? 'characters' : 'seconds'
        const units = config.kind === 'voice' ? config.spokenText.length : config.durationSeconds!
        const usage = this.status()
        if ((unitType === 'characters' ? usage.usedCharacters + units > usage.characterLimit : usage.usedEffectSeconds + units > usage.effectSecondsLimit)) throw new Error('El lote supera el límite mensual de producción configurado.')
        const price = unitType === 'characters' ? this.options.pricePerThousandCharacters : this.options.pricePerEffectSecond
        const estimatedCost = price === null ? null : price * units / (unitType === 'characters' ? 1000 : 1)
        const jobId = randomUUID()
        db.run(`INSERT INTO catalogGenerationJobs(jobId,roomId,generationKey,configJSON,status,createdAt,createdBy,units,unitType,estimatedCost)
          VALUES(?,?,?,?,'queued',?,?,?,?,?)`, [jobId, roomId, generationKey, encoded, Date.now(), userId, units, unitType, estimatedCost])
        submitted.add(jobId)
      }
      db.exec('RELEASE generation_batch')
    } catch (error) {
      db.exec('ROLLBACK TO generation_batch')
      db.exec('RELEASE generation_batch')
      throw error
    }
    void this.drain()
    return this.list(roomId, [...submitted]).filter(job => submitted.has(job.jobId))
  }

  drain (): Promise<void> {
    if (this.working) return this.working
    if (this.stopped || !this.options.key || !this.processorAvailable) return Promise.resolve()
    this.working = this.process().catch((error) => {
      getLogger('animation-production').error('Production worker stopped: %s', error instanceof Error ? error.message : 'Unknown error')
      this.processorAvailable = false
      this.unavailableReason = 'La producción se detuvo por un error de almacenamiento. Revise el servidor antes de reanudarla.'
    }).finally(() => {
      this.working = null
    })
    return this.working
  }

  private async process () {
    let job: StoredJob | undefined
    while (!this.stopped && (job = db.get<StoredJob>('SELECT * FROM catalogGenerationJobs WHERE status=\'queued\' ORDER BY createdAt,rowid LIMIT 1'))) {
      const config: ProductionConfig = JSON.parse(job.configJSON)
      const raw = path.join(this.directory, 'production', `${job.jobId}.download`)
      const temporary = path.join(this.directory, 'production', `${job.jobId}.part`)
      const filename = `production/${job.jobId}.mp3`
      const budget = this.status()
      if ((job.unitType === 'characters' && budget.usedCharacters > budget.characterLimit)
        || (job.unitType === 'seconds' && budget.usedEffectSeconds > budget.effectSecondsLimit)) {
        db.run('UPDATE catalogGenerationJobs SET status=\'failed\',error=\'El límite de producción cambió; esta generación no se envió.\' WHERE jobId=?', [job.jobId])
        continue
      }
      this.activeAbort = new AbortController()
      db.run('UPDATE catalogGenerationJobs SET status=\'generating\',startedAt=? WHERE jobId=?', [Date.now(), job.jobId])
      try {
        const result = await this.provider.generate(config, this.activeAbort.signal)
        db.run('UPDATE catalogGenerationJobs SET providerRequestId=? WHERE jobId=?', [result.requestId, job.jobId])
        const metadata = await parseBuffer(result.bytes, undefined, { duration: true })
        if (!metadata.format.duration) throw new AudioValidationError('El archivo generado no contiene audio válido.')
        if (metadata.format.duration * 1000 > clipDurationLimit(config.kind)) throw new AudioValidationError(`El audio generado dura ${metadata.format.duration.toFixed(1)} s y el máximo es ${clipDurationLimit(config.kind) / 1000} s. Acorte el texto o la duración y genere otra revisión.`)
        await fs.writeFile(raw, result.bytes)
        const analysis = await run(this.options.ffmpeg, ['-hide_banner', '-i', raw, '-af', 'volumedetect', '-vn', '-sn', '-f', 'null', '-'], { timeout: 15000, maxBuffer: 16384, signal: this.activeAbort.signal })
        const peak = /max_volume:\s*([\d.-]+) dB/.exec(analysis.stderr)
        if (!peak || Number(peak[1]) < -75) throw new AudioValidationError('El archivo generado no contiene una señal de audio útil. Revíselo antes de generar otra revisión.')
        const loudness = config.kind === 'voice' ? -16 : config.kind === 'effect' ? -20 : -24
        await run(this.options.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw,
          '-af', `loudnorm=I=${loudness}:TP=-1:LRA=7`, '-ar', '44100', '-b:a', '128k', '-f', 'mp3', temporary], { timeout: 45000, maxBuffer: 16384, signal: this.activeAbort.signal })
        const bytes = await fs.readFile(temporary)
        const processed = await parseBuffer(bytes, { mimeType: 'audio/mpeg' }, { duration: true })
        const durationMs = Math.ceil((processed.format.duration ?? 0) * 1000)
        if (!durationMs || durationMs > clipDurationLimit(config.kind) || bytes.length > 5 * 1024 * 1024) throw new AudioValidationError('El audio preparado supera los límites de duración o tamaño del catálogo. Acorte el contenido antes de generar otra revisión.')
        await fs.rename(temporary, path.join(this.directory, filename))
        db.run('UPDATE catalogGenerationJobs SET status=\'ready_for_review\',finishedAt=?,filename=?,durationMs=?,checksum=? WHERE jobId=?',
          [Date.now(), filename, durationMs, createHash('sha256').update(bytes).digest('hex'), job.jobId])
      } catch (error) {
        const uncertain = error instanceof ProviderError && error.uncertain
        const message = error instanceof ProviderError || error instanceof AudioValidationError ? error.message : 'No se pudo validar o preparar el audio. Revise duración, formato y FFmpeg antes de regenerar.'
        db.run('UPDATE catalogGenerationJobs SET status=?,finishedAt=?,error=? WHERE jobId=?', [uncertain ? 'uncertain' : 'failed', Date.now(), message, job.jobId])
      } finally {
        this.activeAbort = null
        await Promise.all([raw, temporary].map(file => fs.rm(file, { force: true }).catch(() => {})))
      }
    }
  }

  async audio (roomId: number, jobId: string) {
    const job = db.get<StoredJob>('SELECT * FROM catalogGenerationJobs WHERE roomId=? AND jobId=?', [roomId, jobId])
    if (!job?.filename || !['ready_for_review', 'published'].includes(job.status)) throw new Error('El audio todavía no está disponible para revisión.')
    return fs.readFile(path.join(this.directory, job.filename))
  }

  cancel (roomId: number, jobId: string) {
    const result = db.run('UPDATE catalogGenerationJobs SET status=\'cancelled\',finishedAt=? WHERE roomId=? AND jobId=? AND status=\'queued\'', [Date.now(), roomId, jobId])
    if (!result.changes) throw new Error('La generación ya se envió o terminó. Espere su resultado antes de revisarla.')
  }

  async review (roomId: number, userId: number, jobId: string, approve: boolean) {
    const job = db.get<StoredJob>('SELECT * FROM catalogGenerationJobs WHERE roomId=? AND jobId=?', [roomId, jobId])
    if (!job) throw new Error('No se encontró el recurso')
    if (approve && job.status === 'published') return
    if (job.status !== 'ready_for_review') throw new Error('Este recurso no está pendiente de revisión.')
    if (!approve) {
      db.run('UPDATE catalogGenerationJobs SET status=\'rejected\',reviewedBy=?,reviewedAt=? WHERE jobId=?', [userId, Date.now(), jobId])
      return
    }
    const config: ProductionConfig = JSON.parse(job.configJSON)
    db.run('UPDATE catalogGenerationJobs SET status=\'publishing\',reviewedBy=?,reviewedAt=? WHERE jobId=?', [userId, Date.now(), jobId])
    try {
      await saveCatalogRecord({ id: `generated-${job.jobId}`, filename: job.filename!, active: true, title: config.title,
        displayText: config.kind === 'voice' ? config.text : config.title, checksum: job.checksum!, kind: config.kind,
        family: config.family, modes: config.modes, validUntil: config.validUntil, approvedForAuto: true, roomId,
        source: `ElevenLabs ${config.model}; job ${job.jobId}`,
        license: 'Generated under the configured ElevenLabs account; approved by the room administrator.' })
      if (!catalogAsset(`generated-${job.jobId}`)) throw new Error('El recurso no pasó la validación del catálogo.')
      db.run('UPDATE catalogGenerationJobs SET status=\'published\',error=NULL WHERE jobId=?', [job.jobId])
      this.onPublished(roomId)
    } catch (error) {
      db.run('UPDATE catalogGenerationJobs SET status=\'ready_for_review\',error=\'Publicación incompleta. Puede volver a publicar sin generar otra vez.\' WHERE jobId=?', [job.jobId])
      throw error
    }
  }
}

let current: CatalogProduction | undefined
export function getProduction () {
  if (!current) throw new Error('La producción de catálogo está iniciándose.')
  return current
}
export async function startProduction (directory: string, onPublished: (roomId: number) => void) {
  current = new CatalogProduction(directory, productionOptions(), onPublished)
  const instance = current
  await instance.start()
  return () => instance.stop()
}

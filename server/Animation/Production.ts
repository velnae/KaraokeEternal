import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { db } from '../lib/Database.js'
import getLogger from '../lib/Log.js'
import { clipDurationLimit, normalizeEffectType, VOICE_FAMILIES, type AudioKind, type EffectType } from '../../shared/animation.js'
import { voicePrompt, type GenerationJob, type ProductionConfig, type ProductionInput, type ProductionStatus } from '../../shared/catalogProduction.js'
import type { AudioMetadata } from '../../shared/audioCatalog.js'
import { catalogAsset, catalogChanged, resourceFile, saveCatalogRecord, removeUnreferencedFile } from './catalog.js'
import { ElevenLabs, ProviderError } from './ElevenLabs.js'
import type { AudioProvider } from './AudioProvider.js'
import { prepareAudio, AudioValidationError } from './AudioPreparation.js'
import { assertResourceUnused, completeResource, createResource, getResource, isResourceDeleted, prepareResource, resourceDTO, validateMetadata } from './Resources.js'
import { generationKey } from './generationKey.js'
import { DEFAULT_ANIMATOR_VOICE_ID, normalizeTaggedText, validAudioTagSyntax, withoutAudioTags, VOICE_SCRIPT_LIMIT } from '../../shared/audioTags.js'
import { effectCategoryValue } from '../../shared/effectCategories.js'

const run = promisify(execFile)
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
  key: process.env.KES_ELEVENLABS_API_KEY ?? '', baseUrl: process.env.KES_ELEVENLABS_BASE_URL,
  voiceId: process.env.KES_ELEVENLABS_VOICE_ID || DEFAULT_ANIMATOR_VOICE_ID, model: process.env.KES_ELEVENLABS_MODEL ?? 'eleven_v4',
  characterLimit: positive(process.env.KES_ELEVENLABS_CHARACTER_LIMIT, 10000), effectSecondsLimit: positive(process.env.KES_ELEVENLABS_EFFECT_SECONDS_LIMIT, 300),
  pricePerThousandCharacters: process.env.KES_ELEVENLABS_PRICE_PER_1K_CHARS ? positive(process.env.KES_ELEVENLABS_PRICE_PER_1K_CHARS, 0) : null,
  pricePerEffectSecond: process.env.KES_ELEVENLABS_PRICE_PER_EFFECT_SECOND ? positive(process.env.KES_ELEVENLABS_PRICE_PER_EFFECT_SECOND, 0) : null,
  ffmpeg: process.env.KES_FFMPEG_PATH || 'ffmpeg',
})

export class CatalogProduction {
  private providers: Map<string, AudioProvider>
  private verified = new Map<string, { voiceId: string, name: string }[]>()
  private processorAvailable = false
  private unavailableReason: string | null = null
  private stopped = false
  private working: Promise<void> | null = null
  private activeAbort: AbortController | null = null
  private timer?: ReturnType<typeof setInterval>
  private uploads = new Set<Promise<unknown>>()
  private replacements = new Set<string>()

  constructor (private directory: string, private options: ProductionOptions, private onPublished: (roomId: number) => void = () => {}, providers?: AudioProvider[]) {
    this.providers = new Map((providers ?? [new ElevenLabs(options.key, options.baseUrl, options.model, options.voiceId || DEFAULT_ANIMATOR_VOICE_ID)]).map(provider => [provider.capabilities.id, provider] as const))
  }

  capabilities () {
    return { providers: [...this.providers.values()].map(provider => provider.capabilities), processorAvailable: this.processorAvailable }
  }

  async start () {
    try {
      await fs.mkdir(path.join(this.directory, 'production'), { recursive: true })
      await run(this.options.ffmpeg, ['-version'], { timeout: 5000 })
      this.processorAvailable = true
    } catch { this.unavailableReason = 'Revise FFmpeg y los permisos de almacenamiento del servidor.' }
    db.run('UPDATE catalogGenerationJobs SET status=\'uncertain\',error=\'La generación se interrumpió sin confirmación.\',finishedAt=? WHERE status=\'generating\'', [Date.now()])
    for (const job of db.all<StoredJob>('SELECT * FROM catalogGenerationJobs ORDER BY createdAt,rowid')) {
      if (isResourceDeleted(`generated-${job.jobId}`)) continue
      const config = JSON.parse(job.configJSON)
      const key = generationKey(job.roomId, config)
      if (!db.get('SELECT jobId FROM catalogGenerationJobs WHERE roomId=? AND generationKey=?', [job.roomId, key])) db.run('UPDATE catalogGenerationJobs SET generationKey=? WHERE jobId=?', [key, job.jobId])
      this.track(job.roomId, job.jobId, config)
      if (['publishing', 'ready_for_review'].includes(job.status)) await this.register(job.roomId, job.jobId).catch(() => {})
      else if (['queued', 'uncertain', 'failed', 'cancelled'].includes(job.status)) prepareResource(`generated-${job.jobId}`, job.status as 'queued' | 'uncertain' | 'failed' | 'cancelled', job.error)
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
    await Promise.allSettled(this.uploads)
  }

  // Legacy accounting is internal; the new UI consumes capabilities instead.
  status (): ProductionStatus {
    const now = new Date()
    const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
    const totals = db.all<{ unitType: string, total: number }>('SELECT unitType,SUM(units) total FROM catalogGenerationJobs WHERE startedAt>=? OR (startedAt IS NULL AND status=\'queued\') GROUP BY unitType', [start])
    const voices = this.verified.get('elevenlabs:voice') ?? []
    return { configured: !!this.options.key, connectionVerified: this.verified.size > 0, processorAvailable: this.processorAvailable, unavailableReason: this.unavailableReason,
      voices, voiceId: voices.some(voice => voice.voiceId === this.options.voiceId) ? this.options.voiceId : voices[0]?.voiceId ?? this.options.voiceId,
      model: this.options.model, characterLimit: this.options.characterLimit, effectSecondsLimit: this.options.effectSecondsLimit,
      pricePerThousandCharacters: this.options.pricePerThousandCharacters, pricePerEffectSecond: this.options.pricePerEffectSecond,
      usedCharacters: totals.find(row => row.unitType === 'characters')?.total ?? 0, usedEffectSeconds: totals.find(row => row.unitType === 'seconds')?.total ?? 0 }
  }

  async check (providerId = 'elevenlabs', kind: AudioKind = 'voice') {
    const provider = this.providers.get(providerId)
    if (!provider?.capabilities.configured || !provider.capabilities.kinds.includes(kind)) throw new Error('Configure un proveedor compatible en el servidor.')
    const voices = await provider.check(provider.capabilities.models[kind] ?? '', kind)
    this.verified.set(`${providerId}:${kind}`, voices)
    return voices
  }

  list (roomId: number, include: string[] = []): GenerationJob[] {
    const rows = db.all<StoredJob>('SELECT * FROM catalogGenerationJobs WHERE roomId=? ORDER BY createdAt DESC,rowid DESC LIMIT 100', [roomId])
    for (const id of include.slice(0, 9)) {
      if (rows.some(row => row.jobId === id)) continue
      const row = db.get<StoredJob>('SELECT * FROM catalogGenerationJobs WHERE roomId=? AND jobId=?', [roomId, id])
      if (row) rows.push(row)
    }
    return rows.map(({ configJSON, filename, checksum, ...job }) => {
      void filename
      void checksum
      return { ...job, config: JSON.parse(configJSON), active: !!catalogAsset(`generated-${job.jobId}`) }
    })
  }

  private track (roomId: number, jobId: string, config: ProductionConfig) {
    return createResource({ id: `generated-${jobId}`, roomId, kind: config.kind, title: config.title, preparation: 'queued',
      metadata: { ...config, origin: 'generated', family: config.family, modes: config.modes ?? ['dinner', 'mixed', 'party'], automatic: true,
        providerId: config.providerId ?? 'elevenlabs', generationInput: { ...config },
        source: `${config.providerId ?? 'elevenlabs'} ${config.model}; job ${jobId}`, license: 'Generated using the configured provider account.',
        voiceName: this.verified.get(`${config.providerId ?? 'elevenlabs'}:voice`)?.find(voice => voice.voiceId === config.voiceId)?.name } })
  }

  private config (input: ProductionInput): ProductionConfig {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Recurso no válido.')
    const kind = input.kind
    if (!['voice', 'effect', 'ambience'].includes(kind)) throw new Error('Tipo no válido.')
    const effectType = normalizeEffectType(kind, input.effectType)
    const providerId = input.providerId ?? 'elevenlabs'
    const provider = this.providers.get(providerId)
    if (!provider?.capabilities.configured || !provider.capabilities.kinds.includes(kind)) throw new Error('El proveedor no admite este tipo de audio.')
    const tagged = kind === 'voice' && provider.capabilities.audioTags
    const text = typeof input.text === 'string' ? tagged ? normalizeTaggedText(input.text) : input.text.normalize('NFC').replace(/\s+/g, ' ').trim() : ''
    const title = typeof input.title === 'string' ? input.title.trim() : ''
    if (!title || title.length > 80 || !text || text.length > (tagged ? VOICE_SCRIPT_LIMIT : kind === 'voice' ? 220 : 450)) throw new Error('Revise el nombre y el texto del audio.')
    if (tagged && withoutAudioTags(text).length > 220) throw new Error('Use hasta 220 caracteres de texto hablado, además de las etiquetas.')
    if (/[<>]/.test(text) || [...text].some(char => (char.charCodeAt(0) < 32 && char !== '\n') || char.charCodeAt(0) === 127)) throw new Error('Use texto sin HTML ni SSML.')
    if (tagged ? !validAudioTagSyntax(text) : /[[\]]/.test(text)) throw new Error(tagged ? 'Revise los corchetes: cada etiqueta debe estar cerrada y tener hasta 120 caracteres.' : 'El proveedor no admite etiquetas de audio en este recurso.')
    if (!['manual', ...VOICE_FAMILIES].includes(input.family)) throw new Error('Uso no válido.')
    if (input.celebrationMode !== undefined && !['confirmed', 'song_end'].includes(input.celebrationMode)) throw new Error('Uso de celebración no válido.')
    if (input.family === 'promotion' && !(Number.isFinite(input.validUntil) && input.validUntil! > Date.now())) throw new Error('Indique una vigencia futura.')
    if (kind === 'voice' && providerId !== 'elevenlabs' && input.style && !provider.capabilities.styles.includes(input.style)) throw new Error('Interpretación no compatible.')
    if (input.language && !provider.capabilities.languages.includes(input.language)) throw new Error('Idioma no compatible.')
    if (input.loop && !provider.capabilities.loop) throw new Error('El proveedor no admite bucles.')
    const voiceId = input.voiceId || provider.capabilities.defaultVoiceId || this.options.voiceId
    if (kind === 'voice' && !/^[a-zA-Z0-9_-]{1,120}$/.test(voiceId)) throw new Error('Seleccione una voz.')
    const durationSeconds = kind === 'voice' ? undefined : input.durationSeconds ?? (kind === 'effect' && effectType !== 'transition' ? 2 : 8)
    const generationLimit = Math.min(clipDurationLimit(kind, effectType) / 1000, provider.capabilities.maxDurationSeconds?.[kind] ?? Infinity)
    if (durationSeconds !== undefined && (!Number.isFinite(durationSeconds) || durationSeconds < 0.5 || durationSeconds > generationLimit)) throw new Error(`Duración fuera del límite de este tipo (máximo ${generationLimit} s).`)
    const revision = input.revision ?? 0
    if (!Number.isInteger(revision) || revision < 0 || revision > 1000) throw new Error('Versión no válida.')
    if (input.versionRequestId !== undefined && (!input.parentId || typeof input.versionRequestId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(input.versionRequestId))) throw new Error('Solicitud de versión no válida.')
    const modes = input.modes ?? ['dinner', 'mixed', 'party']
    if (!Array.isArray(modes) || !modes.length || modes.some(mode => !['dinner', 'mixed', 'party'].includes(mode))) throw new Error('Seleccione un perfil válido.')
    if (input.category !== undefined && (typeof input.category !== 'string' || input.category.length > 120)) throw new Error('Categoría no válida.')
    return { title, text, kind, effectType, celebrationMode: kind === 'voice' && input.family === 'celebration' ? input.celebrationMode : undefined, providerId, category: kind === 'effect' ? effectCategoryValue(input.category) : input.category, language: kind === 'voice' ? input.language ?? provider.capabilities.languages[0] : undefined,
      loop: kind === 'ambience' ? input.loop ?? provider.capabilities.loop : undefined, parentId: input.parentId, versionRequestId: input.versionRequestId,
      family: effectType === 'transition' ? 'manual' : input.family, style: providerId === 'elevenlabs' ? undefined : input.style, voiceId: kind === 'voice' ? voiceId : undefined,
      durationSeconds, revision, modes: [...new Set(modes)].sort(), validUntil: input.family === 'promotion' ? input.validUntil : undefined,
      model: provider.capabilities.models[kind] ?? '',
      spokenText: kind === 'voice' && providerId !== 'elevenlabs' && input.style ? voicePrompt(text, input.style) : text,
      settings: { stability: 0.5, similarity_boost: 0.75 }, processingRevision: 1 }
  }

  enqueue (roomId: number, userId: number, inputs: ProductionInput[]) {
    if (!this.processorAvailable) throw new Error('Revise FFmpeg en el servidor.')
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > 9) throw new Error('Seleccione entre uno y nueve audios.')
    const configs = inputs.map(input => this.config(input))
    for (const config of configs) {
      const voices = this.verified.get(`${config.providerId}:${config.kind}`) ?? this.verified.get(`${config.providerId}:voice`)
      if (!voices) throw new Error('Compruebe la conexión del proveedor.')
      if (config.kind === 'voice' && !voices.some(voice => voice.voiceId === config.voiceId)) throw new Error('Seleccione una voz disponible.')
      if (config.parentId && !getResource(config.parentId, roomId)) throw new Error('El audio original no pertenece a esta sala.')
    }
    const submitted = new Set<string>()
    db.exec('SAVEPOINT generation_batch')
    try {
      for (const config of configs) {
        const encoded = JSON.stringify(config)
        const key = generationKey(roomId, config)
        const existing = db.get<{ jobId: string }>('SELECT jobId FROM catalogGenerationJobs WHERE roomId=? AND generationKey=?', [roomId, key])
        if (existing) {
          submitted.add(existing.jobId)
          continue
        }
        const unitType = config.kind === 'voice' ? 'characters' : 'seconds'
        const units = config.kind === 'voice' ? config.spokenText.length : config.durationSeconds!
        const usage = this.status()
        if (unitType === 'characters' ? usage.usedCharacters + units > usage.characterLimit : usage.usedEffectSeconds + units > usage.effectSecondsLimit) throw new Error('El lote supera el límite mensual de producción configurado.')
        const price = unitType === 'characters' ? usage.pricePerThousandCharacters : usage.pricePerEffectSecond
        const jobId = randomUUID()
        db.run('INSERT INTO catalogGenerationJobs(jobId,roomId,generationKey,configJSON,status,createdAt,createdBy,units,unitType,estimatedCost) VALUES(?,?,?,?,\'queued\',?,?,?,?,?)',
          [jobId, roomId, key, encoded, Date.now(), userId, units, unitType, price === null ? null : price * units / (unitType === 'characters' ? 1000 : 1)])
        this.track(roomId, jobId, config)
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
    if (this.stopped || !this.processorAvailable) return Promise.resolve()
    this.working = this.process().catch((error) => {
      getLogger('animation-production').error('Production worker stopped: %s', error instanceof Error ? error.message : 'Unknown error')
      this.processorAvailable = false
      this.unavailableReason = 'Revise el almacenamiento del servidor.'
    }).finally(() => { this.working = null })
    return this.working
  }

  private async process () {
    let job: StoredJob | undefined
    while (!this.stopped && (job = db.get<StoredJob>('SELECT * FROM catalogGenerationJobs WHERE status=\'queued\' ORDER BY createdAt,rowid LIMIT 1'))) {
      const config: ProductionConfig = JSON.parse(job.configJSON)
      const id = `generated-${job.jobId}`
      this.activeAbort = new AbortController()
      db.run('UPDATE catalogGenerationJobs SET status=\'generating\',startedAt=? WHERE jobId=?', [Date.now(), job.jobId])
      prepareResource(id, 'generating')
      try {
        const budget = this.status()
        if (job.unitType === 'characters' ? budget.usedCharacters > budget.characterLimit : budget.usedEffectSeconds > budget.effectSecondsLimit) throw new AudioValidationError('Se alcanzó el límite de producción configurado.')
        const provider = this.providers.get(config.providerId ?? 'elevenlabs')
        if (!provider?.capabilities.configured) throw new AudioValidationError('El proveedor no está disponible.')
        const result = await provider.generate(config, this.activeAbort.signal)
        db.run('UPDATE catalogGenerationJobs SET providerRequestId=? WHERE jobId=?', [result.requestId, job.jobId])
        prepareResource(id, 'preparing')
        const media = await prepareAudio(this.directory, job.jobId, config.kind, result.bytes, this.options.ffmpeg, this.activeAbort.signal, config.effectType)
        db.run('UPDATE catalogGenerationJobs SET status=\'ready_for_review\',finishedAt=?,filename=?,durationMs=?,checksum=? WHERE jobId=?', [Date.now(), media.filename, media.durationMs, media.checksum, job.jobId])
        // Keep a registration failure recoverable without another provider call.
        await this.register(job.roomId, job.jobId).catch(() => {})
      } catch (error) {
        const uncertain = error instanceof ProviderError && error.uncertain
        const message = error instanceof ProviderError || error instanceof AudioValidationError ? error.message : 'No se pudo preparar el audio. Revise el archivo y el servidor.'
        db.run('UPDATE catalogGenerationJobs SET status=?,finishedAt=?,error=? WHERE jobId=?', [uncertain ? 'uncertain' : 'failed', Date.now(), message, job.jobId])
        prepareResource(id, uncertain ? 'uncertain' : 'failed', message)
      } finally { this.activeAbort = null }
    }
  }

  async audio (roomId: number, jobId: string) {
    const { file } = await resourceFile(`generated-${jobId}`, roomId)
    return fs.readFile(file)
  }

  cancel (roomId: number, jobId: string) {
    const result = db.run('UPDATE catalogGenerationJobs SET status=\'cancelled\',finishedAt=? WHERE roomId=? AND jobId=? AND status=\'queued\'', [Date.now(), roomId, jobId])
    if (!result.changes) throw new Error('La generación ya se envió o terminó.')
    prepareResource(`generated-${jobId}`, 'cancelled')
  }

  async register (roomId: number, jobId: string) {
    if (isResourceDeleted(`generated-${jobId}`)) throw new Error('Este audio fue eliminado.')
    const job = db.get<StoredJob>('SELECT * FROM catalogGenerationJobs WHERE roomId=? AND jobId=?', [roomId, jobId])
    if (!job) throw new Error('No se encontró el audio.')
    if (job.status === 'published') return
    if (!['ready_for_review', 'publishing'].includes(job.status)) throw new Error('El audio todavía no está preparado.')
    const config: ProductionConfig = JSON.parse(job.configJSON)
    db.run('UPDATE catalogGenerationJobs SET status=\'publishing\' WHERE jobId=?', [jobId])
    try {
      await saveCatalogRecord({ id: `generated-${jobId}`, filename: job.filename!, active: true, title: config.title, displayText: config.kind === 'voice' ? config.text : config.title,
        checksum: job.checksum!, kind: config.kind, effectType: config.effectType, celebrationMode: config.celebrationMode, family: config.family, modes: config.modes, validUntil: config.validUntil, approvedForAuto: true, roomId,
        source: `${config.providerId ?? 'elevenlabs'} ${config.model}; job ${jobId}`, license: 'Generated by an administrator using the configured provider account.' })
      db.run('UPDATE catalogGenerationJobs SET status=\'published\',error=NULL WHERE jobId=?', [jobId])
      this.onPublished(roomId)
    } catch (error) {
      const message = 'No se pudo registrar el audio. Reintente sin generar otra vez.'
      db.run('UPDATE catalogGenerationJobs SET status=\'ready_for_review\',error=? WHERE jobId=?', [message, jobId])
      prepareResource(`generated-${jobId}`, 'failed', message)
      throw error
    }
  }

  async replaceUpload (roomId: number, id: string, bytes: Buffer, originalName: string, effectType?: EffectType, category?: string) {
    if (!this.processorAvailable || this.stopped) throw new Error('El servidor no puede preparar audios. Revise FFmpeg.')
    const original = getResource(id, roomId)
    if (!original || original.roomId !== roomId || JSON.parse(original.metadataJSON).origin !== 'uploaded') throw new Error('Solo puede reemplazar archivos subidos a esta sala.')
    const originalMetadata: AudioMetadata = JSON.parse(original.metadataJSON)
    const nextType = normalizeEffectType(original.kind, effectType ?? originalMetadata.effectType)
    if (category !== undefined && (typeof category !== 'string' || category.length > 120)) throw new Error('Categoría no válida.')
    if (!/\.(mp3|wav|ogg)$/i.test(originalName)) throw new Error('Use un archivo MP3, WAV u OGG.')
    if (this.replacements.has(id) || ['queued', 'generating', 'preparing'].includes(original.preparation)) throw new Error('El audio sigue en preparación. Espere a que termine.')
    if (this.uploads.size >= 2) throw new Error('Hay otras cargas en preparación. Espere y vuelva a intentar.')
    assertResourceUnused(roomId, id)
    this.replacements.add(id)
    // Prepare a distinct file first; invalid replacements never discard valid audio.
    const prepareReplacement = async () => {
      const media = await prepareAudio(this.directory, randomUUID(), original.kind, bytes, this.options.ffmpeg, undefined, nextType)
      try {
        const current = getResource(id, roomId)
        if (!current || this.stopped) throw new Error('El audio ya no está disponible para reemplazarlo.')
        assertResourceUnused(roomId, id)
        const metadata: AudioMetadata = JSON.parse(current.metadataJSON)
        db.exec('SAVEPOINT replace_audio')
        try {
          completeResource(id, media)
          db.run('UPDATE audioResources SET metadataJSON=? WHERE id=?', [JSON.stringify({ ...metadata, category: category === undefined ? metadata.category : original.kind === 'effect' ? effectCategoryValue(category) : category, effectType: nextType, family: nextType === 'transition' ? 'manual' : metadata.family, originalName: path.basename(originalName) }), id])
          db.exec('RELEASE replace_audio')
        } catch (error) {
          db.exec('ROLLBACK TO replace_audio; RELEASE replace_audio')
          throw error
        }
        catalogChanged()
        this.onPublished(roomId)
        if (current.filename) await removeUnreferencedFile(current.filename).catch(error => getLogger('animation-production').warn('Retired upload cleanup: %s', error.message))
      } catch (error) {
        await removeUnreferencedFile(media.filename).catch(() => {})
        throw error
      }
    }
    const work = prepareReplacement()
    this.uploads.add(work)
    try {
      await work
    } finally {
      this.uploads.delete(work)
      this.replacements.delete(id)
    }
    const updated = getResource(id, roomId)
    if (!updated) throw new Error('El audio ya no está disponible.')
    return resourceDTO(updated)
  }

  async upload (roomId: number, id: string, kind: AudioKind, title: string, metadata: Partial<AudioMetadata>, bytes: Buffer, originalName: string) {
    if (!this.processorAvailable || this.stopped) throw new Error('El servidor no puede preparar audios. Revise FFmpeg.')
    if (!/\.(mp3|wav|ogg)$/i.test(originalName)) throw new Error('Use un archivo MP3, WAV u OGG.')
    if (getResource(id, roomId)) return resourceDTO(getResource(id, roomId)!)
    if (this.uploads.size >= 2) throw new Error('Hay otras cargas en preparación. Espere y vuelva a intentar.')
    const clean = validateMetadata(kind, { text: metadata.text, celebrationMode: metadata.celebrationMode, effectType: metadata.effectType, family: metadata.family, modes: metadata.modes, category: metadata.category,
      language: metadata.language, voiceName: metadata.voiceName, style: metadata.style, loop: metadata.loop, validUntil: metadata.validUntil,
      origin: 'uploaded', automatic: true, originalName: path.basename(originalName) })
    createResource({ id, roomId, kind, title, metadata: clean })
    const work = prepareAudio(this.directory, id, kind, bytes, this.options.ffmpeg, undefined, clean.effectType).then((media) => {
      completeResource(id, media)
      catalogChanged()
      this.onPublished(roomId)
      return undefined
    }).catch(error => prepareResource(id, 'failed', error instanceof AudioValidationError ? error.message : 'No se pudo preparar el archivo.'))
    this.uploads.add(work)
    try {
      await work
    } finally { this.uploads.delete(work) }
    return resourceDTO(getResource(id, roomId)!)
  }
}

let current: CatalogProduction | undefined
export function getProduction () {
  if (!current) throw new Error('La producción de audios está iniciándose.')
  return current
}
export async function startProduction (directory: string, onPublished: (roomId: number) => void) {
  current = new CatalogProduction(directory, productionOptions(), onPublished)
  const instance = current
  await instance.start()
  return () => instance.stop()
}

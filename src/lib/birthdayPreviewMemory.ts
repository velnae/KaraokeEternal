import { birthdayPreviewKey, birthdayPreviewName, birthdayPreviewScript, validateBirthdaySample, type BirthdayPreviewAsset, type BirthdayPreviewDraft, type BirthdayPreviewState } from '../../shared/birthdayPreview.js'
import type { BirthdayAsset, BirthdaySettings } from '../../shared/birthdays.js'

export type { BirthdayPreviewDraft } from '../../shared/birthdayPreview.js'
export interface BirthdayPreviewPersistence {
  load(): Promise<BirthdayPreviewState>
  save(draft: BirthdayPreviewDraft, revision: number): Promise<{ revision: number }>
}
interface Snapshot {
  draft: BirthdayPreviewDraft
  samples: Record<string, BirthdayAsset>
  busy: boolean
  error: string
  saving: boolean
}
interface Audition {
  config: BirthdaySettings
  voiceId: string
  style?: string
  sample: ReturnType<typeof validateBirthdaySample>
  previewRevision?: number
  previewScript?: string
}
type Request = (body: Audition, signal: AbortSignal) => Promise<BirthdayPreviewAsset>

function speech (config: BirthdaySettings, draft: BirthdayPreviewDraft) {
  const profile = draft.profileIndex === '' ? undefined : config.rules[Number(draft.profileIndex)]
  if (draft.profileIndex !== '' && !profile) throw new Error('Seleccione un perfil de voz disponible.')
  return { voiceId: config.defaultVoiceId, style: config.speechStyle }
}
function sampleKey (config: BirthdaySettings, draft: BirthdayPreviewDraft) {
  const { voiceId, style } = speech(config, draft)
  return birthdayPreviewKey(config, draft, voiceId, style)
}

export class BirthdayPreviewEntry {
  private state: Snapshot
  private listeners = new Set<() => void>()
  private pending: { controller: AbortController, promise: Promise<BirthdayAsset | undefined> } | null = null
  private contentRevision = 0
  private disposed = false
  private revision = 0
  private savedDraft = ''
  private ready: Promise<void>
  private writing: Promise<boolean> | null = null
  private generating = false
  private loadFailed = false

  constructor (config: BirthdaySettings, private persistence?: BirthdayPreviewPersistence) {
    this.state = { draft: { name: birthdayPreviewName, script: birthdayPreviewScript(birthdayPreviewName), introId: config.introId ?? '', videoId: config.videoId ?? '',
      musicId: config.musicId ?? '', bedId: config.bedId ?? '', bedVolume: config.bedVolume ?? 0.2, applauseId: config.applauseId ?? '', profileIndex: '' }, samples: {}, busy: !!persistence, saving: false, error: '' }
    this.ready = persistence
      ? persistence.load().then((saved): void => {
          if (this.disposed) return
          this.revision = saved.revision
          const draft = { ...this.state.draft, ...saved.draft }
          this.savedDraft = saved.draft ? JSON.stringify(draft) : ''
          this.publish({ draft, samples: saved.samples, busy: false })
          return undefined
        }).catch(() => {
          this.loadFailed = true
          this.publish({ busy: false, error: 'No se pudo recuperar la previsualización. Recargue antes de generar o guardar cambios.' })
        })
      : Promise.resolve()
  }

  async flush (): Promise<boolean> {
    await this.ready
    if (!this.persistence || this.disposed) return true
    if (this.loadFailed) return false
    if (this.generating) return true
    if (this.writing) return this.writing
    this.writing = (async () => {
      while (!this.disposed && this.savedDraft !== JSON.stringify(this.state.draft)) {
        const draft = { ...this.state.draft }
        this.publish({ saving: true })
        const result = await this.persistence!.save(draft, this.revision)
        this.revision = result.revision
        this.savedDraft = JSON.stringify(draft)
      }
      return true
    })().catch((failure) => {
      this.publish({ error: `No se guardó la previsualización. ${(failure as Error).message}` })
      return false
    }).finally(() => {
      this.writing = null
      this.publish({ saving: false })
    })
    return this.writing
  }

  getSnapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private publish (patch: Partial<Snapshot>) {
    if (this.disposed) return
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  update (patch: Partial<BirthdayPreviewDraft>) {
    if (this.disposed) return
    if (['name', 'script', 'profileIndex'].some(key => key in patch && patch[key as keyof BirthdayPreviewDraft] !== this.state.draft[key as keyof BirthdayPreviewDraft])) this.contentRevision++
    this.publish({ draft: { ...this.state.draft, ...patch }, error: '' })
    void this.flush()
  }

  sample (config: BirthdaySettings) {
    try {
      const asset = this.state.samples[sampleKey(config, this.state.draft)]
      return asset && asset.durationMs <= config.maxVoiceSeconds * 1000 ? asset : undefined
    } catch { return undefined }
  }

  generate (config: BirthdaySettings, request: Request, regenerate = false): Promise<BirthdayAsset | undefined> {
    if (this.disposed) return Promise.resolve(undefined)
    if (this.pending) return this.pending.promise
    const cached = !regenerate && this.sample(config)
    if (cached) {
      this.publish({ error: '' })
      return Promise.resolve(cached)
    }
    const draft = { ...this.state.draft }
    let body: Audition
    try {
      body = { config: structuredClone(config), ...speech(config, draft), sample: validateBirthdaySample({ ...draft, regenerate, profileId: draft.profileIndex === '' ? undefined : config.rules[Number(draft.profileIndex)]?.id }) }
    } catch (failure) {
      this.publish({ error: (failure as Error).message })
      return Promise.resolve(undefined)
    }
    const revision = this.contentRevision
    const controller = new AbortController()
    const promise: Promise<BirthdayAsset | undefined> = Promise.resolve().then(async () => {
      if (this.persistence && !await this.flush()) throw new Error('Guarde el borrador antes de generar. Si cambió en otra ventana, recargue la página.')
      this.generating = true
      controller.signal.throwIfAborted()
      if (this.persistence) {
        body.previewRevision = this.revision
        body.previewScript = draft.script
      }
      return request(body, controller.signal)
    }).then(async (asset) => {
      if (this.disposed || controller.signal.aborted) return undefined
      if (!asset.script) throw new Error('No se recibió el texto del audio de prueba. Vuelva a generar.')
      const generated = { ...draft, script: asset.script }
      const key = sampleKey(body.config, generated)
      const samples = { ...this.state.samples, [key]: asset }
      // Keep lightweight references, never blobs, for the latest audition variants.
      const bounded = Object.fromEntries(Object.entries(samples).slice(-20))
      this.publish({ samples: bounded, ...(this.contentRevision === revision ? { draft: { ...this.state.draft, script: asset.script } } : {}) })
      if (asset.previewRevision !== undefined) {
        this.revision = asset.previewRevision
        this.savedDraft = JSON.stringify({ ...draft, script: asset.script })
      }
      this.generating = false
      await this.flush()
      return asset
    }).catch((failure): undefined => {
      if (!controller.signal.aborted) this.publish({ error: (failure as Error).message })
      return undefined
    }).finally(() => {
      if (this.pending?.controller === controller) {
        this.generating = false
        this.pending = null
        this.publish({ busy: false })
        void this.flush()
      }
    })
    this.pending = { controller, promise }
    this.publish({ busy: true, error: '' })
    return promise
  }

  dispose () {
    this.pending?.controller.abort()
    this.disposed = true
    this.listeners.clear()
    this.state = { ...this.state, samples: {}, busy: false, error: '' }
  }
}

export class BirthdayPreviewMemory {
  private userId: number | null = null
  private rooms = new Map<number, BirthdayPreviewEntry>()
  setUser (userId: number | null) {
    if (userId === this.userId) return
    for (const entry of this.rooms.values()) entry.dispose()
    this.rooms.clear()
    this.userId = userId
  }

  room (roomId: number, config: BirthdaySettings, persistence?: BirthdayPreviewPersistence) {
    let entry = this.rooms.get(roomId)
    if (!entry) {
      entry = new BirthdayPreviewEntry(config, persistence)
      this.rooms.set(roomId, entry)
    }
    return entry
  }
}
export const birthdayPreviewMemory = new BirthdayPreviewMemory()

import { birthdayPreviewKey, birthdayPreviewName, birthdayPreviewScript, validateBirthdayPreviewDraft, validateBirthdaySample, type BirthdayPreviewAsset, type BirthdayPreviewDraft, type BirthdayPreviewState } from '../../shared/birthdayPreview.js'
import type { BirthdayAsset, BirthdaySettings } from '../../shared/birthdays.js'
import { recoverPreviewDraft } from './previewDraftRecovery'

export type { BirthdayPreviewDraft } from '../../shared/birthdayPreview.js'
export interface BirthdayPreviewPersistence {
  load(): Promise<BirthdayPreviewState>
  save(draft: BirthdayPreviewDraft, revision: number): Promise<{ revision: number }>
  stage?(draft: BirthdayPreviewDraft, revision: number): void
}
interface Snapshot {
  draft: BirthdayPreviewDraft
  samples: Record<string, BirthdayAsset>
  savedDrafts: Record<string, BirthdayPreviewDraft>
  unavailable: Record<string, string>
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
      musicId: config.musicId ?? '', bedId: config.bedId ?? '', bedVolume: config.bedVolume ?? 0.2, applauseId: config.applauseId ?? '', profileIndex: '' }, samples: {}, savedDrafts: {}, unavailable: {}, busy: !!persistence, saving: false, error: '' }
    this.ready = persistence
      ? persistence.load().then((saved): void => {
          if (this.disposed) return
          this.revision = saved.revision
          const draft = { ...this.state.draft, ...saved.draft }
          this.savedDraft = saved.draft && !saved.pending ? JSON.stringify(draft) : ''
          this.publish({ draft, samples: saved.samples, savedDrafts: saved.savedDrafts ?? {}, unavailable: saved.unavailable ?? {}, busy: false })
          if (saved.pending) void this.flush()
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
    try {
      this.persistence?.stage?.(this.state.draft, this.revision)
    } catch {
      this.publish({ error: 'No se pudo guardar la copia pendiente en este navegador. Espere a que termine el guardado antes de salir.' })
    }
    void this.flush()
  }

  sample (config: BirthdaySettings, exact = false) {
    try {
      const key = birthdayPreviewKey(config, this.state.draft, config.defaultVoiceId, config.speechStyle)
      if (this.state.samples[key] || exact) return this.state.samples[key]
      const [name, script] = JSON.parse(key)
      return Object.entries(this.state.samples).reverse().find(([saved]) => {
        const identity = JSON.parse(saved)
        return identity[0] === name && identity[1] === script
      })?.[1]
    } catch { return undefined }
  }

  restore (key: string) {
    const draft = this.state.savedDrafts[key]
    if (draft) this.update(draft)
  }

  async refreshSamples () {
    if (!this.persistence || this.writing || this.pending || this.loadFailed || this.disposed) return
    try {
      const saved = await this.persistence.load()
      if (!this.disposed) this.publish({ samples: saved.samples, savedDrafts: saved.savedDrafts ?? {}, unavailable: saved.unavailable ?? {} })
    } catch { /* Retain known samples until a later explicit reopen can retry. */ }
  }

  generate (config: BirthdaySettings, request: Request, regenerate = false): Promise<BirthdayAsset | undefined> {
    if (this.disposed) return Promise.resolve(undefined)
    if (this.pending) return this.pending.promise
    const cached = !regenerate && this.sample(config, true)
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
      this.publish({ samples, savedDrafts: { ...this.state.savedDrafts, [key]: generated }, ...(this.contentRevision === revision ? { draft: { ...this.state.draft, script: asset.script } } : {}) })
      if (asset.previewRevision !== undefined) {
        this.revision = asset.previewRevision
        this.savedDraft = JSON.stringify({ ...draft, script: asset.script })
        if (this.savedDraft !== JSON.stringify(this.state.draft)) this.persistence?.stage?.(this.state.draft, this.revision)
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
  async flush () {
    return (await Promise.all([...this.rooms.values()].map(entry => entry.flush()))).every(Boolean)
  }

  setUser (userId: number | null) {
    if (userId === this.userId) return
    for (const entry of this.rooms.values()) entry.dispose()
    this.rooms.clear()
    this.userId = userId
  }

  room (roomId: number, config: BirthdaySettings, persistence?: BirthdayPreviewPersistence) {
    let entry = this.rooms.get(roomId)
    if (!entry) {
      const durable = persistence && this.userId !== null
        ? recoverPreviewDraft(`birthday-preview-pending:${this.userId}:${roomId}`, persistence, validateBirthdayPreviewDraft)
        : persistence
      entry = new BirthdayPreviewEntry(config, durable)
      this.rooms.set(roomId, entry)
    }
    return entry
  }
}
export const birthdayPreviewMemory = new BirthdayPreviewMemory()

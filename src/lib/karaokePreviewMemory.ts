import { karaokePreviewKey, validateKaraokePreviewDraft, type KaraokePreviewDraft, type KaraokePreviewState } from '../../shared/karaokePreview.js'
import type { CallJob, CallSnapshot } from '../../shared/karaokeCalls.js'
import { recoverPreviewDraft } from './previewDraftRecovery'

export interface KaraokePreviewPersistence {
  load(): Promise<KaraokePreviewState>
  save(draft: KaraokePreviewDraft, revision: number): Promise<{ revision: number }>
  stage?(draft: KaraokePreviewDraft, revision: number): void
  generate(input: { revision: number, requestId: string, retry: boolean }): Promise<{ key: string, job: CallJob }>
}
interface Snapshot {
  draft: KaraokePreviewDraft | null
  samples: Record<string, CallJob>
  savedDrafts: Record<string, KaraokePreviewDraft>
  recipeRevision: number
  loading: boolean
  saving: boolean
  busy: boolean
  error: string
  blocked: boolean
}
const pending = (job: CallJob) => ['queued', 'generating', 'preparing'].includes(job.status)
function message (failure: unknown) {
  const text = failure instanceof Error ? failure.message : String(failure)
  try {
    return JSON.parse(text).error || text
  } catch { return text }
}
export class KaraokePreviewEntry {
  private state: Snapshot = { draft: null, samples: {}, savedDrafts: {}, recipeRevision: 1, loading: true, saving: false, busy: false, error: '', blocked: false }
  private listeners = new Set<() => void>()
  private revision = 0
  private savedDraft = ''
  private ready: Promise<void>
  private writing: Promise<boolean> | null = null
  private generating: Promise<CallJob | undefined> | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  private receipt: { key: string, id: string } | null = null

  constructor (private persistence: KaraokePreviewPersistence) {
    this.ready = this.load()
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

  private async load () {
    try {
      const saved = await this.persistence.load()
      if (this.disposed) return
      this.revision = saved.revision
      this.savedDraft = saved.persisted && !saved.pending ? JSON.stringify(saved.draft) : ''
      this.publish({ draft: saved.draft, samples: saved.samples, savedDrafts: saved.savedDrafts ?? {}, recipeRevision: saved.recipeRevision, loading: false, blocked: false, error: '' })
      if (!saved.persisted || saved.pending) void this.flush()
    } catch (failure) {
      this.publish({ loading: false, blocked: true, error: `No se pudo recuperar la prueba. ${message(failure)}` })
    }
  }

  reload = () => {
    if (this.state.busy || this.writing) return this.ready
    clearTimeout(this.timer)
    this.publish({ loading: true })
    this.ready = this.load()
    return this.ready
  }

  update (patch: Partial<KaraokePreviewDraft>) {
    if (!this.state.draft || this.disposed) return
    this.publish({ draft: { ...this.state.draft, ...patch }, saving: !this.state.blocked, ...(!this.state.blocked ? { error: '' } : {}) })
    try {
      this.persistence.stage?.(this.state.draft!, this.revision)
    } catch {
      this.publish({ error: 'No se pudo guardar la copia pendiente en este navegador. Espere a que termine el guardado antes de salir.' })
    }
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      void this.flush()
    }, 400)
  }

  async flush (): Promise<boolean> {
    await this.ready
    clearTimeout(this.timer)
    if (this.disposed || this.state.blocked || !this.state.draft) return false
    if (this.writing) return this.writing
    this.writing = (async () => {
      while (!this.disposed && this.state.draft && this.savedDraft !== JSON.stringify(this.state.draft)) {
        const draft = { ...this.state.draft }
        this.publish({ saving: true })
        const result = await this.persistence.save(draft, this.revision)
        this.revision = result.revision
        this.savedDraft = JSON.stringify(draft)
      }
      return !this.disposed
    })().catch((failure) => {
      this.publish({ blocked: true, error: `No se guardó la prueba. ${message(failure)}` })
      return false
    }).finally(() => {
      this.writing = null
      this.publish({ saving: false })
    })
    return this.writing
  }

  sample (snapshot: Pick<CallSnapshot, 'intros' | 'tables'>) {
    const draft = this.state.draft
    if (!draft) return undefined
    const exact = this.state.samples[karaokePreviewKey(draft, snapshot, this.state.recipeRevision)]
    if (exact) return exact
    const historical = Object.entries(this.state.savedDrafts).reverse().find(([key, saved]) =>
      (['introId', 'tableId', 'performer', 'song', 'mode'] as const).every(field => saved[field] === draft[field]) && this.state.samples[key]?.result)
    return historical ? this.state.samples[historical[0]] : undefined
  }

  restore (key: string) {
    const draft = this.state.savedDrafts[key]
    if (draft) this.update(draft)
  }

  async refreshSamples (retryUnavailable = false) {
    if (this.disposed || this.state.loading || this.state.busy || (!retryUnavailable && !Object.values(this.state.samples).some(pending))) return
    try {
      const saved = await this.persistence.load()
      if (!this.state.busy && !this.disposed) this.publish({ samples: saved.samples, savedDrafts: saved.savedDrafts ?? {}, recipeRevision: saved.recipeRevision })
    } catch { /* A later snapshot refresh can recover an interrupted status read. */ }
  }

  generate (snapshot: Pick<CallSnapshot, 'intros' | 'tables'>): Promise<CallJob | undefined> {
    if (this.generating) return this.generating
    const work = (async () => {
      if (!await this.flush() || this.disposed || !this.state.draft) return undefined
      const generatedDraft = { ...this.state.draft }
      const key = karaokePreviewKey(generatedDraft, snapshot, this.state.recipeRevision)
      const sample = this.sample(snapshot)
      if (sample && !sample.outdated && (sample.result || pending(sample))) return sample
      this.publish({ busy: true, error: '' })
      if (this.receipt?.key !== key) this.receipt = { key, id: crypto.randomUUID() }
      try {
        const result = await this.persistence.generate({ revision: this.revision, requestId: this.receipt.id, retry: !!sample && ['failed', 'uncertain', 'cancelled'].includes(sample.status) })
        this.receipt = null
        const samples = [...Object.entries(this.state.samples).filter(([key]) => key !== result.key), [result.key, result.job]]
        this.publish({ samples: Object.fromEntries(samples), savedDrafts: { ...this.state.savedDrafts, [result.key]: generatedDraft } })
        return result.job
      } catch (failure) {
        this.publish({ error: message(failure) })
        return undefined
      } finally { this.publish({ busy: false }) }
    })().finally(() => { this.generating = null })
    this.generating = work
    return work
  }

  dispose () {
    clearTimeout(this.timer)
    this.disposed = true
    this.listeners.clear()
  }
}
export class KaraokePreviewMemory {
  private userId: number | null = null
  private rooms = new Map<number, KaraokePreviewEntry>()
  async flush () {
    return (await Promise.all([...this.rooms.values()].map(entry => entry.flush()))).every(Boolean)
  }

  setUser (userId: number | null) {
    if (this.userId === userId) return
    for (const entry of this.rooms.values()) entry.dispose()
    this.rooms.clear()
    this.userId = userId
  }

  room (roomId: number, persistence: KaraokePreviewPersistence) {
    let entry = this.rooms.get(roomId)
    if (!entry) {
      const durable = this.userId !== null
        ? { ...persistence, ...recoverPreviewDraft(`karaoke-preview-pending:${this.userId}:${roomId}`, persistence, validateKaraokePreviewDraft) }
        : persistence
      entry = new KaraokePreviewEntry(durable)
      this.rooms.set(roomId, entry)
    }
    return entry
  }
}
export const karaokePreviewMemory = new KaraokePreviewMemory()

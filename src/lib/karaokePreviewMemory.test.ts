import { afterEach, expect, it, vi } from 'vitest'
import { KaraokePreviewEntry, KaraokePreviewMemory, type KaraokePreviewPersistence } from './karaokePreviewMemory'
import { karaokePreviewKey, type KaraokePreviewState } from '../../shared/karaokePreview.js'
import type { CallJob, CallSnapshot } from '../../shared/karaokeCalls.js'

const entries: KaraokePreviewEntry[] = []
afterEach(() => entries.splice(0).forEach(entry => entry.dispose()))
const draft = { introId: 'intro', tableId: '1', performer: 'Ana', song: 'Rayando el sol', mode: 'hybrid' as const, videoId: 'video', bedId: 'bed', volume: 0.2 }
const part = { id: 'intro', kind: 'intro' as const, title: 'Intro', text: 'Vamos', durationMs: 1000, profileKey: 'voice', createdAt: 1, variantId: 'variant' }
const snapshot: Pick<CallSnapshot, 'intros' | 'tables'> = { intros: [part], tables: [{ tableId: 1, code: '01', spokenText: 'Desde la mesa uno', revision: 1, outdated: false, part: { ...part, id: 'table', kind: 'table' } }] }
const readyJob: CallJob = { id: 'job', operation: 'hybrid', text: 'Prueba', status: 'ready', error: null, createdAt: 1, providerMs: 0, preparationMs: 0, result: { ...part, id: 'result', kind: 'composition' }, outdated: false }
const key = karaokePreviewKey(draft, snapshot, 1)
function state (patch: Partial<KaraokePreviewState> = {}): KaraokePreviewState {
  return { revision: 0, persisted: true, recipeRevision: 1, draft, samples: {}, ...patch }
}
function create (patch: Partial<KaraokePreviewPersistence> = {}) {
  const persistence = { load: vi.fn().mockResolvedValue(state()), save: vi.fn(async (_draft, revision) => ({ revision: revision + 1 })), generate: vi.fn().mockResolvedValue({ key, job: readyJob }), ...patch }
  const entry = new KaraokePreviewEntry(persistence)
  entries.push(entry)
  return { entry, persistence }
}
it('persists initial defaults but does not synthesize or rewrite restored data on load', async () => {
  const { entry, persistence } = create({ load: vi.fn().mockResolvedValue(state({ persisted: false })) })
  await entry.flush()
  expect(persistence.save).toHaveBeenCalledExactlyOnceWith(draft, 0)
  expect(persistence.generate).not.toHaveBeenCalled()
  const second = create()
  await second.entry.flush()
  expect(second.persistence.save).not.toHaveBeenCalled()
})
it('serializes saves and preserves edits made while a previous save was pending', async () => {
  let release!: (value: { revision: number }) => void
  const save = vi.fn().mockImplementationOnce(() => new Promise((resolve) => {
    release = resolve
  })).mockResolvedValue({ revision: 2 })
  const { entry } = create({ save })
  await entry.flush()
  entry.update({ song: 'Otra canción' })
  const pending = entry.flush()
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  entry.update({ performer: 'Lucía' })
  release({ revision: 1 })
  expect(await pending).toBe(true)
  expect(save).toHaveBeenLastCalledWith({ ...draft, song: 'Otra canción', performer: 'Lucía' }, 1)
  expect(entry.getSnapshot().saving).toBe(false)
})
it('blocks stale/failed saves and cannot generate until the stored draft is recovered', async () => {
  const { entry, persistence } = create({ save: vi.fn().mockRejectedValue(new Error('La prueba cambió en otra ventana.')) })
  await entry.flush()
  entry.update({ performer: 'Otra persona' })
  expect(await entry.flush()).toBe(false)
  expect(entry.getSnapshot().blocked).toBe(true)
  await entry.generate(snapshot)
  expect(persistence.generate).not.toHaveBeenCalled()
  await entry.reload()
  expect(entry.getSnapshot().draft?.performer).toBe('Ana')
  expect(entry.getSnapshot().blocked).toBe(false)
})
it('deduplicates generation and keeps voice reusable across background changes but not speech changes', async () => {
  let release!: (value: { key: string, job: CallJob }) => void
  const { entry, persistence } = create({ generate: vi.fn(() => new Promise<{ key: string, job: CallJob }>((resolve) => {
    release = resolve
  })) })
  await entry.flush()
  const first = entry.generate(snapshot)
  expect(entry.generate(snapshot)).toBe(first)
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  release({ key, job: readyJob })
  expect(await first).toEqual(readyJob)
  entry.update({ videoId: '', bedId: '', volume: 0.5 })
  expect(entry.sample(snapshot)?.result?.id).toBe('result')
  await entry.generate(snapshot)
  expect(persistence.generate).toHaveBeenCalledTimes(1)
  expect(entry.sample({ ...snapshot, tables: [{ ...snapshot.tables[0], outdated: true }] })?.id).toBe('job')
  entry.update({ song: 'Otra canción' })
  expect(entry.sample(snapshot)).toBeUndefined()
  expect(entry.sample({ ...snapshot, tables: [{ ...snapshot.tables[0], revision: 2 }] })).toBeUndefined()
})
it('recovers a pending persisted job without replacing newer local edits', async () => {
  const load = vi.fn().mockResolvedValueOnce(state({ samples: { [key]: { ...readyJob, status: 'queued', result: null } } })).mockResolvedValue(state({ samples: { [key]: readyJob } }))
  const { entry, persistence } = create({ load })
  await entry.flush()
  entry.update({ videoId: '' })
  await entry.refreshSamples()
  expect(entry.getSnapshot().draft?.videoId).toBe('')
  expect(entry.sample(snapshot)).toEqual(readyJob)
  expect(persistence.generate).not.toHaveBeenCalled()
})
it('clears account caches and cannot flush a disposed draft into another account', async () => {
  const manager = new KaraokePreviewMemory()
  manager.setUser(1)
  const persistence = { load: vi.fn().mockResolvedValue(state()), save: vi.fn(), generate: vi.fn() }
  const entry = manager.room(1, persistence)
  entries.push(entry)
  await entry.flush()
  entry.update({ performer: 'Private sample' })
  manager.setUser(2)
  expect(await entry.flush()).toBe(false)
  expect(persistence.save).not.toHaveBeenCalled()
  expect(manager.room(1, persistence)).not.toBe(entry)
  manager.setUser(null)
})

it('restores a saved trial without mixing its audio with a different table or later resource revisions', async () => {
  const { entry, persistence } = create({ load: vi.fn().mockResolvedValue(state({ draft: { ...draft, tableId: '14' }, samples: { [key]: readyJob }, savedDrafts: { [key]: draft } })) })
  await entry.flush()
  expect(entry.sample(snapshot)).toBeUndefined()
  entry.restore(key)
  expect(entry.getSnapshot().draft).toEqual(draft)
  const newer = { ...snapshot, tables: [{ ...snapshot.tables[0], revision: 2 }] }
  expect(entry.sample(newer)?.result?.id).toBe('result')
  await entry.generate(newer)
  expect(persistence.generate).not.toHaveBeenCalled()
})

it('binds a late audio response to its captured draft rather than newer singer/song edits', async () => {
  let release!: (value: { key: string, job: CallJob }) => void
  const { entry } = create({ generate: vi.fn(() => new Promise<{ key: string, job: CallJob }>((resolve) => {
    release = resolve
  })) })
  await entry.flush()
  const work = entry.generate(snapshot)
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  entry.update({ performer: 'Different singer' })
  release({ key, job: readyJob })
  await work
  expect(entry.getSnapshot().savedDrafts[key]).toEqual(draft)
  expect(entry.sample(snapshot)).toBeUndefined()
  entry.restore(key)
  expect(entry.sample(snapshot)?.id).toBe('job')
  await entry.flush()
})

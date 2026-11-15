import { expect, it, vi } from 'vitest'
import { BirthdayPreviewEntry, BirthdayPreviewMemory } from './birthdayPreviewMemory'
import { defaultBirthdaySettings, type BirthdayAsset } from '../../shared/birthdays.js'
import { birthdayPreviewKey } from '../../shared/birthdayPreview.js'

const config = { ...defaultBirthdaySettings, defaultVoiceId: 'voice', introId: 'intro', videoId: 'video', musicId: 'music' }
const asset = (script: string, id = 'sample'): BirthdayAsset => ({ id, kind: 'greeting', script, title: 'Sample', checksum: id, durationMs: 12000, url: `api/birthdays/assets/${id}` })
function deferred<T> () {
  let complete!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    complete = resolve
  })
  return { promise, resolve: complete }
}

it('restores the latest edited draft and matching sample after subscribers unmount and return', async () => {
  const memory = new BirthdayPreviewMemory()
  memory.setUser(1)
  const entry = memory.room(1, config)
  entry.update({ name: 'Lucía', script: 'Lucía… que cada canción te traiga una sonrisa. La pizzería Il Gatto se suma con alegría. ¡feliz cumpleaños, Lucía!' })
  const request = vi.fn(async () => asset(entry.getSnapshot().draft.script))
  const unsubscribe = entry.subscribe(vi.fn())
  await entry.generate(config, request)
  unsubscribe()
  const reopened = memory.room(1, config)
  expect(reopened.getSnapshot().draft.name).toBe('Lucía')
  expect(reopened.sample(config)?.id).toBe('sample')
  await reopened.generate(config, request)
  expect(request).toHaveBeenCalledOnce()
})

it('normalizes content keys, retains cached variants and ignores visual or background changes', async () => {
  const entry = new BirthdayPreviewEntry(config)
  const original = entry.getSnapshot().draft.script
  const request = vi.fn(async () => asset(original))
  await entry.generate(config, request)
  entry.update({ script: `  ${original.split(' ').join('  ')} `, videoId: 'other', bedId: 'bed', bedVolume: 0.4 })
  await entry.generate({ ...config, videoId: 'other', bedVolume: 0.4, targetSeconds: 30 }, request)
  expect(request).toHaveBeenCalledOnce()
  entry.update({ script: 'Carlos, celebremos otra noche llena de música. ¡Feliz cumpleaños!' })
  expect(entry.sample(config)).toBeUndefined()
  entry.update({ script: original })
  expect(entry.sample(config)?.id).toBe('sample')
})

it('keeps saved playback after voice changes and uses the new voice only for explicit synthesis', async () => {
  const entry = new BirthdayPreviewEntry(config)
  const request = vi.fn(async () => asset(entry.getSnapshot().draft.script))
  await entry.generate(config, request)
  expect(entry.sample({ ...config, defaultVoiceId: 'other' })?.id).toBe('sample')
  expect(entry.sample({ ...config, speechModel: 'other-model' })?.id).toBe('sample')
  expect(entry.sample({ ...config, speechStyle: 'Different delivery.' })?.id).toBe('sample')
  expect(entry.sample({ ...config, speechStyle: 'Different delivery.' }, true)).toBeUndefined()
  expect(entry.sample(config)?.id).toBe('sample')
  await entry.generate(config, request, true)
  expect(request).toHaveBeenCalledTimes(2)
})

it('restores original text/media choices and keeps all saved variants after global voice settings change', async () => {
  const original = new BirthdayPreviewEntry(config).getSnapshot().draft
  const samples = Object.fromEntries(Array.from({ length: 25 }, (_, index) => [birthdayPreviewKey({ ...config, defaultVoiceId: `voice-${index}` }, original, `voice-${index}`), asset(original.script, `sample-${index}`)]))
  const first = Object.keys(samples)[0]
  const stored = { ...original, musicId: 'original-music' }
  const entry = new BirthdayPreviewEntry({ ...config, speechStyle: 'New style' }, {
    load: async () => ({ revision: 1, draft: { ...original, script: 'Other edited draft' }, samples, savedDrafts: { [first]: stored } }),
    save: vi.fn(async () => ({ revision: 2 })),
  })
  await entry.flush()
  entry.restore(first)
  expect(entry.getSnapshot().draft).toEqual(stored)
  expect(Object.keys(entry.getSnapshot().samples)).toHaveLength(25)
  expect(entry.sample({ ...config, speechStyle: 'New style' })).toBeTruthy()
  expect(entry.sample({ ...config, speechStyle: 'New style' }, true)).toBeUndefined()
  await entry.flush()
})

it('deduplicates a pending request across close/reopen and applies its result after reopening', async () => {
  const memory = new BirthdayPreviewMemory()
  memory.setUser(1)
  const entry = memory.room(1, config)
  const response = deferred<BirthdayAsset>()
  const request = vi.fn(() => response.promise)
  const first = entry.generate(config, request)
  const unsubscribe = entry.subscribe(vi.fn())
  unsubscribe()
  const reopened = memory.room(1, config)
  expect(reopened.getSnapshot().busy).toBe(true)
  expect(reopened.generate(config, request)).toBe(first)
  await Promise.resolve()
  expect(request).toHaveBeenCalledOnce()
  response.resolve(asset(entry.getSnapshot().draft.script))
  await first
  expect(reopened.getSnapshot().busy).toBe(false)
  expect(reopened.sample(config)?.id).toBe('sample')
})

it('never replaces newer text with a late result but can reuse that result when returning to the original text', async () => {
  const entry = new BirthdayPreviewEntry(config)
  const original = entry.getSnapshot().draft.script
  const response = deferred<BirthdayAsset>()
  const work = entry.generate(config, () => response.promise, true)
  const modified = 'Carlos, este saludo nuevo debe conservarse. ¡Feliz cumpleaños!'
  entry.update({ script: modified })
  response.resolve(asset(original))
  await work
  expect(entry.getSnapshot().draft.script).toBe(modified)
  expect(entry.sample(config)).toBeUndefined()
  entry.update({ script: original })
  expect(entry.sample(config)?.id).toBe('sample')
})

it('isolates rooms and clears drafts, audio and pending work on logout or account changes', async () => {
  const memory = new BirthdayPreviewMemory()
  memory.setUser(1)
  const first = memory.room(1, config)
  const original = first.getSnapshot().draft.script
  first.update({ name: 'Lucía', script: 'Lucía… mucha felicidad y música para ti. La pizzería Il Gatto se suma con alegría. ¡feliz cumpleaños, Lucía!' })
  expect(memory.room(2, config).getSnapshot().draft.name).toBe('Carlos')
  expect(memory.room(1, config)).toBe(first)
  const response = deferred<BirthdayAsset>()
  let signal: AbortSignal | undefined
  const work = first.generate(config, (_, requestSignal) => {
    signal = requestSignal
    return response.promise
  })
  await Promise.resolve()
  memory.setUser(null)
  expect(signal?.aborted).toBe(true)
  response.resolve(asset(original))
  await work
  memory.setUser(1)
  const next = memory.room(1, config)
  expect(next.getSnapshot().draft.name).toBe('Carlos')
  expect(next.sample(config)).toBeUndefined()
  memory.setUser(2)
  expect(memory.room(1, config)).not.toBe(next)
})

it('reports failures without retrying and retains an existing sample for explicit retry playback', async () => {
  const entry = new BirthdayPreviewEntry(config)
  await entry.generate(config, async () => asset(entry.getSnapshot().draft.script))
  const fail = vi.fn(async () => {
    throw new Error('Provider unavailable')
  })
  await entry.generate(config, fail, true)
  expect(entry.getSnapshot()).toMatchObject({ busy: false, error: 'Provider unavailable' })
  expect(fail).toHaveBeenCalledOnce()
  expect(entry.sample(config)?.id).toBe('sample')
})

it('hydrates a new browser entry from durable state and reuses audio without calling providers', async () => {
  const original = new BirthdayPreviewEntry(config)
  const draft = { ...original.getSnapshot().draft, name: 'Lucía', script: 'Lucía… celebramos contigo esta noche. La pizzería Il Gatto se suma con alegría. ¡feliz cumpleaños, Lucía!' }
  original.update(draft)
  await original.generate(config, async () => asset(draft.script))
  const state = original.getSnapshot()
  const load = vi.fn(async () => ({ draft, samples: state.samples, revision: 3 }))
  const save = vi.fn(async () => ({ revision: 4 }))
  const reopened = new BirthdayPreviewEntry(config, { load, save })
  await reopened.flush()
  expect(reopened.getSnapshot().draft).toEqual(draft)
  expect(reopened.sample(config)?.id).toBe('sample')
  const generate = vi.fn()
  await reopened.generate(config, generate)
  expect(generate).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
})

it('serializes draft saves and sends the newest edit after a slow earlier write', async () => {
  const original = new BirthdayPreviewEntry(config).getSnapshot().draft
  const response = deferred<{ revision: number }>()
  const save = vi.fn().mockReturnValueOnce(response.promise).mockResolvedValueOnce({ revision: 2 })
  const entry = new BirthdayPreviewEntry(config, { load: async () => ({ revision: 0, draft: original, samples: {} }), save })
  await entry.flush()
  entry.update({ name: 'Lucía' })
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce())
  entry.update({ name: 'María' })
  response.resolve({ revision: 1 })
  await entry.flush()
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'María' }), 1)
})

it('does not overwrite durable data or generate after a restoration failure', async () => {
  const save = vi.fn()
  const entry = new BirthdayPreviewEntry(config, { load: async () => {
    throw new Error('Offline')
  }, save })
  await entry.flush()
  entry.update({ name: 'Lucía' })
  const generate = vi.fn()
  await entry.generate(config, generate)
  expect(save).not.toHaveBeenCalled()
  expect(generate).not.toHaveBeenCalled()
  expect(entry.getSnapshot().error).not.toBe('')
})

it('saves a first draft before generation and uses the server revision when saving later edits', async () => {
  const save = vi.fn(async () => ({ revision: 1 }))
  const entry = new BirthdayPreviewEntry(config, { load: async () => ({ revision: 0, draft: null, samples: {} }), save })
  const script = entry.getSnapshot().draft.script
  const request = vi.fn(async (body) => {
    expect(save).toHaveBeenCalledOnce()
    expect(body.previewRevision).toBe(1)
    expect(body.previewScript).toBe(script)
    return { ...asset(script), previewRevision: 2 }
  })
  await entry.generate(config, request)
  expect(entry.sample(config)?.id).toBe('sample')
  entry.update({ script: `${script} ¡Muchas felicidades!` })
  await entry.flush()
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ script: `${script} ¡Muchas felicidades!` }), 2)
})

it('can still restore a prepared legacy sample without silently regenerating its old text', async () => {
  const draft = { ...new BirthdayPreviewEntry(config).getSnapshot().draft, script: 'Carlos, celebramos contigo esta noche. ¡Feliz cumpleaños!' }
  const legacy = asset(draft.script, 'legacy')
  const key = birthdayPreviewKey(config, draft, config.defaultVoiceId, config.speechStyle)
  const entry = new BirthdayPreviewEntry(config, {
    load: async () => ({ revision: 1, draft, samples: { [key]: legacy } }),
    save: vi.fn(),
  })
  await entry.flush()
  expect(entry.sample(config)?.id).toBe('legacy')
  const generate = vi.fn()
  await entry.generate(config, generate)
  expect(generate).not.toHaveBeenCalled()
})

it('rejects an impossible repeated-name budget before an explicit text regeneration request', async () => {
  const entry = new BirthdayPreviewEntry(config)
  entry.update({ name: Array(21).fill('A').join(' ') })
  const request = vi.fn()
  await entry.generate(config, request, true)
  expect(request).not.toHaveBeenCalled()
  expect(entry.getSnapshot().error).toContain('nombre completo')
})

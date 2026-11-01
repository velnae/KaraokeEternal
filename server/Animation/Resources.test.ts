import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { beforeEach, afterEach, expect, it } from 'vitest'
import { open, close, db } from '../lib/Database.js'
import { loadCatalog, catalogClips, resourceFile, saveCatalogRecord } from './catalog.js'
import { completeResource, createResource, editResource, getResource, listResources, resourceDTO } from './Resources.js'
import Animation from './Animation.js'
import { preparationClips } from './preparation.js'

let directory: string
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-resources-'))
  open({ file: path.join(directory, 'db.sqlite'), ro: false })
  db.run('INSERT INTO rooms(roomId,name,status,data) VALUES(1,\'One\',\'open\',\'{}\'),(2,\'Two\',\'open\',\'{}\')')
  await loadCatalog(directory, path.resolve('assets/animation'))
})
afterEach(async () => {
  close()
  await fs.rm(directory, { recursive: true, force: true })
})
const metadata = { origin: 'uploaded' as const, text: 'Aplauso', family: 'manual' as const, modes: ['mixed' as const], category: 'Celebración' }

it('paginates a complete typed inventory beyond legacy limits and scopes queries to rooms', () => {
  for (let i = 0; i < 240; i++) createResource({ id: `test-${i}`, roomId: 1, kind: 'effect', title: `Audio ${String(i).padStart(3, '0')}`, metadata })
  createResource({ id: 'other', roomId: 2, kind: 'effect', title: 'Private', metadata })
  const page = listResources(1, { kind: 'effect', page: '12', sort: 'title', direction: 'asc', category: 'Celebración', profile: 'mixed' })
  expect(page.total).toBe(240)
  expect(page.items).toHaveLength(20)
  expect(page.items[0].title).toBe('Audio 220')
  expect(listResources(2, { kind: 'effect' }).total).toBe(1)
  expect(getResource('other', 1)).toBeUndefined()
  expect(() => editResource(1, 'other', { title: 'Changed' })).toThrow('otra sala')
  expect(() => listResources(1, { sort: 'title;DROP TABLE rooms' })).toThrow('Orden')
})

it('normalizes known legacy categories without changing files, generation inputs or unknown labels', async () => {
  createResource({ id: 'legacy-effect', roomId: 1, kind: 'effect', title: 'Separador', metadata: { ...metadata, category: 'separador', origin: 'generated', generationInput: { category: 'separador', effectType: 'short' } } })
  createResource({ id: 'legacy-custom', roomId: 1, kind: 'effect', title: 'Custom', metadata: { ...metadata, category: 'Etiqueta anterior' } })
  db.run('UPDATE audioResources SET metadataJSON=json_set(metadataJSON,\'$.category\',\'SEPARADOR\') WHERE id=\'legacy-effect\'')
  await loadCatalog(directory)
  const migrated = resourceDTO(getResource('legacy-effect')!)
  expect(migrated.metadata).toMatchObject({ category: 'transition', generationInput: { category: 'separador', effectType: 'short' } })
  expect(listResources(1, { kind: 'effect', category: 'Transición musical' }).items.map(row => row.id)).toEqual(['legacy-effect'])
  expect(resourceDTO(getResource('legacy-custom')!).metadata.category).toBe('Etiqueta anterior')
  expect(migrated.metadata.family).toBe('manual')
})

it('preserves edits/inactive state across reimport and previews inactive audio', async () => {
  const demo = catalogClips()[0]
  const original = getResource(demo.id)!
  await saveCatalogRecord({ id: 'owned', roomId: 1, filename: original.filename!, title: 'Own', active: true, kind: 'voice', displayText: 'Texto', family: 'manual' })
  editResource(1, 'owned', { title: 'Renamed', state: 'disabled' })
  await loadCatalog(directory)
  expect(getResource('owned')).toMatchObject({ title: 'Renamed', state: 'disabled', preparation: 'ready' })
  expect(catalogClips(1).some(clip => clip.id === 'owned')).toBe(false)
  expect((await resourceFile('owned', 1)).file).toContain(directory)
  await expect(resourceFile('owned', 2)).rejects.toThrow('disponible')
  expect(() => editResource(1, demo.id, { state: 'disabled' })).toThrow('compartido')
})

it('migrates historical prepared jobs without synthesis and preserves rejected records', async () => {
  const file = getResource(catalogClips()[0].id)!
  const config = JSON.stringify({ title: 'Old voice', text: 'Hola', kind: 'voice', family: 'welcome', style: 'warm', modes: ['mixed'], model: 'legacy' })
  for (const [id, status] of [['old', 'ready_for_review'], ['rejected', 'rejected']]) {
    db.run('INSERT INTO catalogGenerationJobs(jobId,roomId,generationKey,configJSON,status,createdAt,createdBy,units,unitType,filename,checksum) VALUES(?,1,?,?,?,1,1,4,?,?,?)', [id, id, config, status, 'characters', file.filename, file.checksum])
  }
  await loadCatalog(directory)
  await loadCatalog(directory)
  expect(resourceDTO(getResource('generated-old')!)).toMatchObject({ preparation: 'ready', state: 'active', metadata: { model: 'legacy', origin: 'generated' } })
  expect(getResource('generated-rejected')).toMatchObject({ preparation: 'ready', state: 'archived' })
  expect(db.get<{ n: number }>('SELECT count(*) n FROM audioResources WHERE id=?', ['generated-old'])?.n).toBe(1)
})

it('refuses escaped files and does not turn a missing file into an available resource', async () => {
  await expect(saveCatalogRecord({ id: 'escaped', roomId: 1, title: 'No', filename: '../outside.wav', active: true })).rejects.toThrow()
  expect(getResource('escaped')?.preparation).toBe('failed')
  expect(catalogClips(1).some(clip => clip.id === 'escaped')).toBe(false)
})

it('bounds preparation while prioritizing a manual resource beyond the first inventory page', () => {
  for (let i = 0; i < 100; i++) {
    const id = `voice-${String(i).padStart(3, '0')}`
    createResource({ id, roomId: 1, kind: 'voice', title: id, metadata: { ...metadata, automatic: true, family: 'turn' } })
    completeResource(id, { filename: 'test.mp3', mime: 'audio/mpeg', checksum: id, durationMs: 1000, size: 100 })
  }
  const before = preparationClips(1)
  expect(before.length).toBeLessThanOrEqual(24)
  expect(before.some(clip => clip.id === 'voice-099')).toBe(false)
  Animation.claim(1, 'test-player')
  Animation.control(1, Animation.state(1).controlVersion, { enabled: true })
  Animation.request({ roomId: 1, userId: 1, socketId: 'test-player' }, 'manual', catalogClips(1).find(clip => clip.id === 'voice-099')!)
  expect(preparationClips(1)[0].id).toBe('voice-099')
  expect(preparationClips(1).length).toBeLessThanOrEqual(24)
})

it('prepares enabled automatic events before disabled families and optional manual effects', () => {
  for (const [id, family, kind, category] of [
    ['a-promotion', 'promotion', 'voice', ''], ['b-roll', 'celebration', 'effect', 'anticipation'],
    ['z-close', 'closing', 'voice', ''], ['z-applause', 'celebration', 'effect', 'appreciation'],
  ] as const) {
    createResource({ id, roomId: 1, kind, title: id, metadata: { ...metadata, family, category, automatic: true } })
    completeResource(id, { filename: 'test.mp3', mime: 'audio/mpeg', checksum: id, durationMs: 1000, size: 100 })
  }
  Animation.control(1, Animation.state(1).controlVersion, { enabled: true, automation: true, events: { celebration: false, promotion: false } })
  const ids = preparationClips(1).map(clip => clip.id)
  expect(ids.indexOf('z-close')).toBeLessThan(ids.indexOf('a-promotion'))
  expect(ids.indexOf('z-applause')).toBeLessThan(ids.indexOf('b-roll'))
})

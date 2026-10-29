import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { parseBuffer } from 'music-metadata'
import { clipDurationLimit, type AnimationClip, type AudioKind } from '../../shared/animation.js'
import type { AudioMetadata } from '../../shared/audioCatalog.js'
import { db } from '../lib/Database.js'
import { completeResource, createResource, editResource, getResource, isResourceDeleted, prepareResource, resourceClip, resourceRoomFilter, type StoredResource } from './Resources.js'
import getLogger from '../lib/Log.js'

let catalogDirectory = ''
let revision = 0
export const catalogVersion = () => revision
export const catalogChanged = () => {
  revision++
}
export const catalogRoot = () => catalogDirectory
export interface CatalogRecord extends Partial<AnimationClip> { id: string, filename: string, active: boolean }

export async function inspectCatalogFile (filename: string, kind: AudioKind, checksum?: string) {
  const root = await fs.realpath(catalogDirectory)
  const file = await fs.realpath(path.resolve(root, filename))
  if (!file.startsWith(root + path.sep)) throw new Error('Archivo fuera del catálogo.')
  const stat = await fs.stat(file)
  if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error('El archivo supera el tamaño permitido.')
  const mime = ({ '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' })[path.extname(file).toLowerCase()]
  if (!mime) throw new Error('Use un archivo MP3, WAV u OGG.')
  const bytes = await fs.readFile(file)
  const metadata = await parseBuffer(bytes, { mimeType: mime }, { duration: true })
  const durationMs = Math.ceil((metadata.format.duration ?? 0) * 1000)
  if (durationMs <= 0 || durationMs > clipDurationLimit(kind)) throw new Error('La duración del audio no es válida para este tipo.')
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (checksum && checksum !== hash) throw new Error('El archivo cambió desde su registro.')
  return { filename, mime, durationMs, checksum: hash, size: stat.size }
}

// The JSON manifest is imported, never rewritten. SQLite owns subsequent edits.
export async function loadCatalog (directory: string, bundledDirectory?: string) {
  catalogDirectory = directory
  await fs.mkdir(directory, { recursive: true })
  const manifest = path.join(directory, 'catalog.json')
  try {
    await fs.access(manifest)
  } catch {
    if (bundledDirectory) await fs.cp(bundledDirectory, directory, { recursive: true, force: false })
  }
  try {
    const records: CatalogRecord[] = JSON.parse(await fs.readFile(manifest, 'utf8'))
    if (!Array.isArray(records)) throw new Error('Invalid manifest')
    for (const record of records) {
      if (getResource(record.id) || isResourceDeleted(record.id)) continue
      await saveCatalogRecord(record).catch(error => getLogger('animation').warn('Catalog import: %s', error.message))
    }
  } catch (error) { getLogger('animation').warn('Catalog import: %s', (error as Error).message) }
  // Reconcile all historical jobs, not only the latest UI page.
  for (const job of db.all<{ jobId: string, roomId: number, configJSON: string, status: string, filename: string | null, checksum: string | null, createdAt: number, error: string | null }>('SELECT * FROM catalogGenerationJobs')) {
    const id = `generated-${job.jobId}`
    if (isResourceDeleted(id)) continue
    const config = JSON.parse(job.configJSON)
    const existing = getResource(id)
    if (existing) {
      const metadata: AudioMetadata = JSON.parse(existing.metadataJSON)
      if (!metadata.generationInput) db.run('UPDATE audioResources SET metadataJSON=? WHERE id=?', [JSON.stringify({ ...config, ...metadata, providerId: config.providerId ?? 'elevenlabs', model: config.model, generationInput: config }), id])
      continue
    }
    createResource({ id, roomId: job.roomId, kind: config.kind, title: config.title,
      metadata: { ...config, providerId: config.providerId ?? 'elevenlabs', language: config.kind === 'voice' ? 'es' : undefined, origin: 'generated', automatic: true, generationInput: config },
      state: ['rejected', 'cancelled'].includes(job.status) ? 'archived' : 'active', createdAt: job.createdAt })
    if (job.filename && ['published', 'publishing', 'ready_for_review', 'rejected'].includes(job.status)) {
      try {
        completeResource(id, await inspectCatalogFile(job.filename, config.kind, job.checksum ?? undefined))
        if (job.status !== 'rejected') db.run('UPDATE catalogGenerationJobs SET status=\'published\',error=NULL WHERE jobId=?', [job.jobId])
      } catch (error) { prepareResource(id, 'failed', (error as Error).message) }
    } else prepareResource(id, job.status === 'generating' ? 'uncertain' : ['queued', 'failed', 'uncertain', 'cancelled'].includes(job.status) ? job.status as 'queued' | 'failed' | 'uncertain' | 'cancelled' : 'failed', job.error)
  }
  // Interrupted uploads cannot be silently considered usable.
  db.run('UPDATE audioResources SET preparation=\'failed\',error=\'La carga se interrumpió. Vuelva a subir el archivo.\' WHERE preparation=\'preparing\' AND json_extract(metadataJSON,\'$.origin\')=\'uploaded\'')
  for (const row of db.all<StoredResource>('SELECT * FROM audioResources WHERE preparation=\'ready\' AND deletedAt IS NULL')) {
    try {
      await inspectCatalogFile(row.filename!, row.kind, row.checksum!)
    } catch (error) { prepareResource(row.id, 'failed', (error as Error).message) }
  }
  catalogChanged()
}

export const catalogClips = (roomId?: number) => db.all<StoredResource>(`SELECT * FROM audioResources WHERE state='active' AND preparation='ready' AND deletedAt IS NULL${roomId === undefined ? '' : ` AND ${resourceRoomFilter}`}`, roomId === undefined ? [] : [roomId, roomId]).map(resourceClip)
export function catalogAsset (id: string, roomId?: number) {
  const row = getResource(id, roomId)
  return row?.state === 'active' && row.preparation === 'ready' ? { clip: resourceClip(row), filename: row.filename!, mime: row.mime! } : undefined
}
export async function resourceFile (id: string, roomId: number) {
  const row = getResource(id, roomId)
  if (!row || row.preparation !== 'ready' || !row.filename) throw new Error('Este audio no está disponible.')
  const root = await fs.realpath(catalogDirectory)
  const file = await fs.realpath(path.resolve(root, row.filename))
  if (!file.startsWith(root + path.sep)) throw new Error('Archivo no válido.')
  return { row, file }
}
export async function saveCatalogRecord (record: CatalogRecord, extra: Partial<AudioMetadata> = {}) {
  const kind = record.kind ?? 'voice'
  const metadata: AudioMetadata = { text: record.displayText ?? record.title ?? '', family: record.family ?? 'manual', modes: record.modes ?? ['dinner', 'mixed', 'party'],
    origin: record.roomId === undefined ? 'included' : 'generated', automatic: record.approvedForAuto === true, validUntil: record.validUntil, source: record.source, license: record.license, ...extra }
  createResource({ id: record.id, roomId: record.roomId ?? null, kind, title: record.title ?? record.id, metadata, state: record.active ? 'active' : 'disabled' })
  try {
    completeResource(record.id, await inspectCatalogFile(record.filename, kind, record.checksum))
    catalogChanged()
  } catch (error) {
    prepareResource(record.id, 'failed', (error as Error).message)
    throw error
  }
}
export async function setCatalogActive (id: string, roomId: number, active: boolean) {
  editResource(roomId, id, { state: active ? 'active' : 'disabled' })
  catalogChanged()
}

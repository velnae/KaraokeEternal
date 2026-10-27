import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { parseBuffer } from 'music-metadata'
import { clipDurationLimit, VOICE_FAMILIES, type AnimationClip, type AudioKind } from '../../shared/animation.js'
import getLogger from '../lib/Log.js'

interface CatalogEntry { clip: AnimationClip, bytes: Buffer, mime: string }
const entries = new Map<string, CatalogEntry>()
const log = getLogger('animation')
let catalogDirectory = ''
let revision = 0
let publication = Promise.resolve()

export async function loadCatalog (directory: string, bundledDirectory?: string) {
  catalogDirectory = directory
  const next = new Map<string, CatalogEntry>()
  await fs.mkdir(directory, { recursive: true })
  const manifest = path.join(directory, 'catalog.json')
  try {
    await fs.access(manifest)
  } catch {
    if (bundledDirectory) await fs.cp(bundledDirectory, directory, { recursive: true, force: false })
  }
  try {
    const root = await fs.realpath(directory)
    const records: unknown = JSON.parse(await fs.readFile(manifest, 'utf8'))
    if (!Array.isArray(records) || records.length > 200 || records.filter(record => record?.active).length > 30) throw new Error('Invalid catalog size')
    for (const record of records) {
      try {
        if (!record.active) continue
        for (const key of ['id', 'title', 'displayText', 'filename', 'source', 'license']) {
          if (typeof record[key] !== 'string' || !record[key].trim() || record[key].length > 500) throw new Error('Invalid metadata')
        }
        if (!/^[a-z0-9-]{1,64}$/.test(record.id) || next.has(record.id)) throw new Error('Invalid clip ID')
        const file = await fs.realpath(path.resolve(root, record.filename))
        if (!file.startsWith(root + path.sep)) throw new Error('File outside catalog')
        const stat = await fs.stat(file)
        if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new Error('Invalid file size')
        const bytes = await fs.readFile(file)
        const ext = path.extname(file).toLowerCase()
        const mime = ({ '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' })[ext]
        if (!mime) throw new Error('Unsupported audio format')
        const metadata = await parseBuffer(bytes, { mimeType: mime }, { duration: true })
        const durationMs = Math.ceil((metadata.format.duration ?? 0) * 1000)
        const kind: AudioKind = ['voice', 'effect', 'ambience'].includes(record.kind) ? record.kind : 'voice'
        if (durationMs <= 0 || durationMs > clipDurationLimit(kind)) throw new Error('Invalid duration')
        const checksum = createHash('sha256').update(bytes).digest('hex')
        if (record.checksum && record.checksum !== checksum) throw new Error('Checksum mismatch')
        next.set(record.id, { bytes, mime, clip: {
          id: record.id, title: record.title, displayText: record.displayText,
          durationMs, checksum, source: record.source, license: record.license,
          kind, family: VOICE_FAMILIES.includes(record.family) ? record.family : 'manual',
          modes: Array.isArray(record.modes) ? record.modes.filter(mode => ['dinner', 'mixed', 'party'].includes(mode)) : ['dinner', 'mixed', 'party'],
          approvedForAuto: record.approvedForAuto === true,
          weight: Number.isFinite(record.weight) ? Math.max(0.1, Math.min(10, record.weight)) : 1,
          ...(Number.isInteger(record.roomId) ? { roomId: record.roomId } : {}),
          ...(Number.isFinite(record.validUntil) ? { validUntil: record.validUntil } : {}),
        } })
      } catch (error) {
        log.warn('Skipping animation clip: %s', (error as Error).message)
      }
    }
  } catch (error) {
    log.warn('Animation catalog unavailable: %s', (error as Error).message)
  }
  entries.clear()
  next.forEach((entry, id) => entries.set(id, entry))
  revision++
}

export const catalogClips = (roomId?: number) => [...entries.values()].map(entry => entry.clip).filter(clip => roomId === undefined || clip.roomId === undefined || clip.roomId === roomId)
export const catalogAsset = (id: string) => entries.get(id)
export const catalogVersion = () => revision

export interface CatalogRecord extends Partial<AnimationClip> { id: string, filename: string, active: boolean }
export function saveCatalogRecord (record: CatalogRecord) {
  const operation = publication.then(async (): Promise<void> => {
    const manifest = path.join(catalogDirectory, 'catalog.json')
    const records: CatalogRecord[] = JSON.parse(await fs.readFile(manifest, 'utf8'))
    const next = records.filter(item => item.id !== record.id).concat(record)
    if (next.filter(item => item.active).length > 30 || next.length > 200) throw new Error('El catálogo está lleno. Desactive recursos antes de publicar.')
    const temporary = manifest + '.tmp'
    await fs.writeFile(temporary, JSON.stringify(next, null, 2) + '\n')
    await fs.rename(temporary, manifest)
    await loadCatalog(catalogDirectory)
    return undefined
  })
  publication = operation.catch(() => {})
  return operation
}

export async function setCatalogActive (id: string, roomId: number, active: boolean) {
  const manifest: CatalogRecord[] = JSON.parse(await fs.readFile(path.join(catalogDirectory, 'catalog.json'), 'utf8'))
  const record = manifest.find(item => item.id === id && item.roomId === roomId)
  if (!record) throw new Error('No se encontró un recurso propio de la sala')
  await saveCatalogRecord({ ...record, active })
}

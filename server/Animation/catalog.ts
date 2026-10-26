import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { parseBuffer } from 'music-metadata'
import { ANIMATION_LIMITS, type AnimationClip } from '../../shared/animation.js'
import getLogger from '../lib/Log.js'

interface CatalogEntry { clip: AnimationClip, bytes: Buffer, mime: string }
const entries = new Map<string, CatalogEntry>()
const log = getLogger('animation')

export async function loadCatalog (directory: string, bundledDirectory?: string) {
  entries.clear()
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
    if (!Array.isArray(records) || records.length > 30) throw new Error('Invalid catalog')
    for (const record of records) {
      try {
        if (!record.active) continue
        for (const key of ['id', 'title', 'displayText', 'filename', 'source', 'license']) {
          if (typeof record[key] !== 'string' || !record[key].trim() || record[key].length > 500) throw new Error('Invalid metadata')
        }
        if (!/^[a-z0-9-]{1,64}$/.test(record.id) || entries.has(record.id)) throw new Error('Invalid clip ID')
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
        if (durationMs <= 0 || durationMs > ANIMATION_LIMITS.clipMs) throw new Error('Invalid duration')
        const checksum = createHash('sha256').update(bytes).digest('hex')
        if (record.checksum && record.checksum !== checksum) throw new Error('Checksum mismatch')
        entries.set(record.id, { bytes, mime, clip: {
          id: record.id, title: record.title, displayText: record.displayText,
          durationMs, checksum, source: record.source, license: record.license,
        } })
      } catch (error) {
        log.warn('Skipping animation clip: %s', (error as Error).message)
      }
    }
  } catch (error) {
    log.warn('Animation catalog unavailable: %s', (error as Error).message)
  }
}

export const catalogClips = () => [...entries.values()].map(entry => entry.clip)
export const catalogAsset = (id: string) => entries.get(id)

import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { db } from '../lib/Database.js'
import getLogger from '../lib/Log.js'
import { inspectLogoImage } from './inspect.js'
import { isPlayerLogoId, PLAYER_LOGO_LIMITS, type PlayerLogoImage, type PlayerLogoKind } from '../../shared/playerLogo.js'
import type { PlayerDisplaySettings } from '../../shared/playerDisplay.js'

const run = promisify(execFile)
const retentionMs = 24 * 60 * 60 * 1000
export const logoResourceError = (status: number, message: string) => Object.assign(new Error(message), { status })

export function getLogoImage (id: string): PlayerLogoImage | undefined {
  if (!isPlayerLogoId(id)) return undefined
  return db.get<PlayerLogoImage>('SELECT id,kind,width,height,frames,durationMs,bytes FROM playerLogoImages WHERE id=?', [id])
}

function references () {
  const row = db.get<{ data: string }>('SELECT data FROM prefs WHERE key=?', ['playerDisplay'])
  const settings = row ? JSON.parse(row.data) as PlayerDisplaySettings : null
  return [settings?.logo?.staticImageId, settings?.logo?.animatedImageId,
    ...(settings?.announcement?.messages ?? []).map(message => message.image)].filter(isPlayerLogoId)
}

// Resource references and preferences change together; cleanup cannot remove a newly selected image.
export function saveDisplayWithImages (settings: PlayerDisplaySettings): boolean {
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const [id, kind] of [[settings.logo.staticImageId, 'png'], [settings.logo.animatedImageId, 'gif']] as const) {
      if (id && getLogoImage(id)?.kind !== kind) throw logoResourceError(422, `La imagen ${kind.toUpperCase()} ya no está disponible. Vuelva a subirla.`)
    }
    const messageImages = settings.announcement.messages.map(message => message.image).filter(isPlayerLogoId)
    for (const id of messageImages) {
      if (getLogoImage(id)?.kind !== 'png') throw logoResourceError(422, 'La imagen del comunicado ya no está disponible. Vuelva a subir el PNG.')
    }
    const ids = new Set([...references(), settings.logo.staticImageId, settings.logo.animatedImageId, ...messageImages].filter(isPlayerLogoId))
    for (const id of ids) db.run('UPDATE playerLogoImages SET updatedAt=? WHERE id=?', [Date.now(), id])
    const result = db.run('REPLACE INTO prefs(key,data) VALUES(?,?)', ['playerDisplay', JSON.stringify(settings)])
    db.exec('COMMIT')
    return result.changes === 1
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export class PlayerLogoStore {
  readonly staging: string
  private uploading: { cancel(): void, finished: Promise<void> } | null = null
  private timer?: ReturnType<typeof setInterval>
  private cleanupWork: Promise<void> = Promise.resolve()
  private stopped = false

  constructor (readonly directory: string, private ffmpeg = process.env.KES_FFMPEG_PATH || 'ffmpeg') {
    this.staging = path.join(directory, '.staging')
  }

  async start () {
    await fs.mkdir(this.staging, { recursive: true })
    await this.cleanup()
    this.timer = setInterval(() => {
      this.cleanupWork = this.cleanupWork.then(() => this.cleanup()).catch(error => getLogger('player-logo').warn('Image cleanup failed: %s', error.message))
    }, 60 * 60 * 1000)
    this.timer.unref()
  }

  reserve (cancel: () => void) {
    if (this.stopped) throw logoResourceError(503, 'El servidor se está reiniciando. Vuelva a intentar.')
    if (this.uploading) throw logoResourceError(409, 'Hay una imagen en preparación. Espere y vuelva a intentar.')
    let release!: () => void
    const finished = new Promise<void>((resolve) => {
      release = resolve
    })
    this.uploading = { cancel, finished }
    return () => {
      this.uploading = null
      release()
    }
  }

  async prepare (source: string, kind: PlayerLogoKind, staging: string, signal: AbortSignal): Promise<PlayerLogoImage> {
    const bytes = await fs.readFile(source)
    let inspected: ReturnType<typeof inspectLogoImage>
    try {
      inspected = inspectLogoImage(bytes, kind)
    } catch (error) {
      throw logoResourceError(422, (error as Error).message)
    }
    const poster = path.join(staging, 'poster.png')
    const input = ['-protocol_whitelist', 'file,pipe', '-f', kind === 'gif' ? 'gif' : 'png_pipe', ...(kind === 'gif' ? ['-ignore_loop', '1'] : []), '-threads', '1', '-i', source]
    const options = { signal, timeout: 20000, killSignal: 'SIGKILL' as const, maxBuffer: 256 * 1024 }
    try {
      await run(this.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-xerror', '-err_detect', 'explode', '-max_alloc', String(PLAYER_LOGO_LIMITS.decodedBytes),
        ...input, '-an', '-sn', '-dn', '-f', 'null', '-'], options)
      await run(this.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...input,
        '-frames:v', '1', '-map_metadata', '-1', '-pix_fmt', 'rgba', '-threads', '1', '-update', '1', poster], options)
    } catch (error) {
      if (signal.aborted) throw error
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw logoResourceError(503, 'No se pudo preparar la imagen. Revise FFmpeg en el servidor.')
      throw logoResourceError(422, 'No se pudo decodificar la imagen. Exporte nuevamente el PNG o GIF.')
    }
    const still = await fs.readFile(poster)
    try {
      inspectLogoImage(still, 'png')
    } catch (error) {
      throw logoResourceError(422, (error as Error).message)
    }
    const id = randomUUID()
    const destination = path.join(this.directory, id)
    await fs.mkdir(destination)
    try {
      await fs.copyFile(poster, path.join(destination, 'poster.png'))
      await fs.writeFile(path.join(destination, `image.${kind}`), kind === 'gif' ? bytes : still, { flag: 'wx' })
      signal.throwIfAborted()
      const image = { id, kind, ...inspected, bytes: kind === 'gif' ? bytes.length : still.length }
      db.run('INSERT INTO playerLogoImages(id,kind,width,height,frames,durationMs,bytes,updatedAt) VALUES(?,?,?,?,?,?,?,?)',
        [id, kind, image.width, image.height, image.frames, image.durationMs, image.bytes, Date.now()])
      return image
    } catch (error) {
      await fs.rm(destination, { recursive: true, force: true })
      throw error
    }
  }

  async remove (id: string, cutoff = Infinity) {
    if (!isPlayerLogoId(id)) throw logoResourceError(404, 'No se encontró la imagen.')
    if (references().includes(id)) throw logoResourceError(409, 'La imagen está guardada en Pantalla. Quite su selección y aplique los cambios primero.')
    const removed = db.run('DELETE FROM playerLogoImages WHERE id=? AND updatedAt<=?', [id, Number.isFinite(cutoff) ? cutoff : Date.now()])
    if (removed.changes) await fs.rm(path.join(this.directory, id), { recursive: true, force: true })
  }

  async cleanup () {
    const cutoff = Date.now() - retentionMs
    for (const { id } of db.all<{ id: string }>('SELECT id FROM playerLogoImages WHERE updatedAt<?', [cutoff])) {
      if (!references().includes(id)) await this.remove(id, cutoff)
    }
    for (const parent of [this.directory, this.staging]) {
      for (const entry of await fs.readdir(parent, { withFileTypes: true })) {
        if (!entry.isDirectory() || (parent === this.directory && (!isPlayerLogoId(entry.name) || getLogoImage(entry.name)))) continue
        const directory = path.join(parent, entry.name)
        if ((await fs.stat(directory)).mtimeMs < cutoff) await fs.rm(directory, { recursive: true, force: true })
      }
    }
  }

  async stop () {
    this.stopped = true
    clearInterval(this.timer)
    const upload = this.uploading
    upload?.cancel()
    await upload?.finished
    await this.cleanupWork
  }
}

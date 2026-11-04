import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { db } from '../lib/Database.js'
import getLogger from '../lib/Log.js'
import { prepareTransitionVideo, VideoPreparationError, type VideoTools } from './Preparation.js'
import { completeTransitionVideo, createTransitionVideo, failTransitionVideo, getLatestTransitionVideo,
  getTransitionVideo, getTransitionVideoAttempt, getTransitionVideoSettings, transitionVideoDTO, type StoredTransitionVideo } from './Store.js'

const run = promisify(execFile)
const log = getLogger('transition-video')
export class VideoServiceError extends Error {
  constructor (public status: number, message: string) { super(message) }
}
export interface VideoServiceOptions extends VideoTools {
  preparationTimeoutMs?: number
  prepare?: typeof prepareTransitionVideo
}

export class TransitionVideoService {
  readonly staging: string
  private available = false
  private reason: string | null = null
  private stopped = false
  private uploading: { cancel: () => void, finished: Promise<void> } | null = null
  private work: Promise<void> | null = null
  private abort: AbortController | null = null
  private readers = new Map<string, number>()
  private cleanupWork: Promise<void> = Promise.resolve()
  private cleanupTimer?: ReturnType<typeof setTimeout>

  constructor (readonly directory: string, private options: VideoServiceOptions) {
    this.staging = path.join(directory, '.staging')
  }

  async start () {
    await fs.mkdir(this.directory, { recursive: true })
    db.run('UPDATE transitionVideos SET state=\'failed\',reason=\'La preparación se interrumpió. Vuelva a subir el archivo.\',updatedAt=? WHERE state=\'preparing\'', [Date.now()])
    await fs.rm(this.staging, { recursive: true, force: true })
    await fs.mkdir(this.staging)
    await this.cleanup()
    // Remove partially published/orphaned generated files after a crash.
    const kept = new Set(db.all<StoredTransitionVideo>('SELECT * FROM transitionVideos WHERE retiredAt IS NULL AND state=\'ready\'')
      .flatMap(row => [row.filename, row.posterFilename]))
    for (const name of await fs.readdir(this.directory)) {
      if (/^[a-f0-9-]{36}\.(mp4|jpg)$/.test(name) && !kept.has(name)) await fs.rm(path.join(this.directory, name), { force: true })
    }
    try {
      for (const tool of [this.options.ffmpeg, this.options.ffprobe]) await run(tool, ['-version'], { timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 })
      this.available = true
    } catch {
      this.reason = 'No se pueden preparar videos. Revise FFmpeg y FFprobe en el servidor.'
    }
  }

  capability () {
    return { available: this.available && !this.stopped, busy: !!this.uploading || !!this.work,
      reason: this.stopped ? 'El servidor se está reiniciando. Vuelva a intentar.' : this.reason }
  }

  overview (roomId: number) {
    const settings = getTransitionVideoSettings(roomId)
    const selected = settings.videoId ? getTransitionVideo(roomId, settings.videoId) : undefined
    const latest = getLatestTransitionVideo(roomId)
    return { settings, selected: selected ? transitionVideoDTO(selected) : null,
      candidate: latest && latest.id !== selected?.id ? transitionVideoDTO(latest) : null, capability: this.capability() }
  }

  reserveUpload (cancel: () => void) {
    const capability = this.capability()
    if (!capability.available) throw new VideoServiceError(503, capability.reason!)
    if (capability.busy) throw new VideoServiceError(409, 'Hay otro video en carga o preparación. Espere y vuelva a intentar.')
    let finish!: () => void
    const upload = { cancel, finished: new Promise<void>((resolve) => {
      finish = resolve
    }) }
    this.uploading = upload
    return () => {
      if (this.uploading === upload) this.uploading = null
      finish()
    }
  }

  async accept (roomId: number, input: { requestId: string, title: string }, source: string) {
    const existing = getTransitionVideoAttempt(roomId, input.requestId)
    if (existing) return transitionVideoDTO(existing)
    if (this.stopped || !this.uploading || this.work) throw new VideoServiceError(409, 'La carga ya no está disponible. Vuelva a intentar.')
    const row = createTransitionVideo(roomId, input)
    const directory = path.join(this.staging, row.id)
    try {
      await fs.mkdir(directory)
      await fs.rename(source, path.join(directory, 'source.mp4'))
      if (this.stopped) throw new Error('Server stopped during upload')
    } catch (error) {
      failTransitionVideo(roomId, row.id, 'No se pudo almacenar el video. Vuelva a subir el archivo.')
      await fs.rm(directory, { recursive: true, force: true })
      log.warn('Upload storage failed: %s', (error as Error).message)
      throw new VideoServiceError(503, 'No se pudo almacenar el video. Revise el espacio disponible.')
    }
    this.abort = new AbortController()
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(this.options.preparationTimeoutMs ?? 60_000)])
    this.work = this.prepare(row, directory, signal).catch(error => log.error('Preparation cleanup failed: %s', error.message)).finally(() => {
      this.work = null
      this.abort = null
    })
    void this.cleanup()
    return transitionVideoDTO(row)
  }

  private async prepare (row: StoredTransitionVideo, directory: string, signal: AbortSignal) {
    let published = false
    try {
      const media = await (this.options.prepare ?? prepareTransitionVideo)(directory, this.options, signal)
      signal.throwIfAborted()
      await fs.rename(path.join(directory, 'video.mp4'), path.join(this.directory, `${row.id}.mp4`))
      await fs.rename(path.join(directory, 'poster.jpg'), path.join(this.directory, `${row.id}.jpg`))
      signal.throwIfAborted()
      completeTransitionVideo(row.roomId, row.id, media)
      published = true
    } catch (error) {
      const reason = signal.aborted
        ? 'La preparación se interrumpió o superó el tiempo permitido. Vuelva a subir el archivo.'
        : error instanceof VideoPreparationError ? error.message : 'No se pudo preparar el video. Vuelva a subir el archivo.'
      if (getTransitionVideo(row.roomId, row.id)?.state === 'preparing') failTransitionVideo(row.roomId, row.id, reason)
      log.warn('Preparation %s failed: %s', row.id, (error as Error).message)
    } finally {
      if (!published) await Promise.all(['mp4', 'jpg'].map(ext => fs.rm(path.join(this.directory, `${row.id}.${ext}`), { force: true })))
      await fs.rm(directory, { recursive: true, force: true })
      await this.cleanup()
    }
  }

  // Acquire before any async file open. Retirement cannot race an active range.
  acquire (roomId: number, id: string) {
    const row = getTransitionVideo(roomId, id)
    if (!row || row.state !== 'ready') throw new VideoServiceError(404, 'El video no está disponible.')
    this.readers.set(id, (this.readers.get(id) ?? 0) + 1)
    let released = false
    return { row, release: () => {
      if (released) return
      released = true
      const count = this.readers.get(id)! - 1
      if (count) this.readers.set(id, count)
      else this.readers.delete(id)
      if (!this.stopped) void this.cleanup()
    } }
  }

  cleanup () {
    this.cleanupWork = this.cleanupWork.then(async () => {
      db.run('DELETE FROM transitionVideoLeases WHERE untilAt<=?', [Date.now()])
      for (const row of db.all<StoredTransitionVideo>('SELECT * FROM transitionVideos')) {
        if (this.readers.has(row.id) || row.state === 'preparing') continue
        const retired = row.retiredAt || db.run(`UPDATE transitionVideos SET retiredAt=? WHERE id=? AND retiredAt IS NULL
          AND id!=COALESCE((SELECT json_extract(data,'$.prefs.transitionVideo.videoId') FROM rooms WHERE roomId=?),'')
          AND id!=(SELECT id FROM transitionVideos WHERE roomId=? ORDER BY createdAt DESC,rowid DESC LIMIT 1)
          AND NOT EXISTS(SELECT 1 FROM transitionVideoLeases WHERE videoId=transitionVideos.id AND untilAt>?)`,
        [Date.now(), row.id, row.roomId, row.roomId, Date.now()]).changes
        if (retired) await Promise.all(['mp4', 'jpg'].map(ext => fs.rm(path.join(this.directory, `${row.id}.${ext}`), { force: true })))
      }
      clearTimeout(this.cleanupTimer)
      this.cleanupTimer = undefined
      if (!this.stopped) {
        const next = db.get<{ untilAt: number | null }>('SELECT min(untilAt) untilAt FROM transitionVideoLeases')?.untilAt
        if (next) {
          this.cleanupTimer = setTimeout(() => void this.cleanup(), Math.max(1, next - Date.now() + 1))
          this.cleanupTimer.unref()
        }
      }
      return undefined
    }).catch(error => log.warn('Video cleanup failed: %s', error.message))
    return this.cleanupWork
  }

  async stop () {
    this.stopped = true
    clearTimeout(this.cleanupTimer)
    const upload = this.uploading
    upload?.cancel()
    this.abort?.abort()
    await upload?.finished
    await this.work
    await this.cleanupWork
  }
}

let current: TransitionVideoService | undefined
export const getTransitionVideoService = () => {
  if (!current) throw new VideoServiceError(503, 'El servicio de videos se está iniciando.')
  return current
}
export async function startTransitionVideos (directory: string) {
  const service = new TransitionVideoService(directory, { ffmpeg: process.env.KES_FFMPEG_PATH || 'ffmpeg', ffprobe: process.env.KES_FFPROBE_PATH || 'ffprobe' })
  await service.start()
  current = service
  return async () => {
    await service.stop()
    if (current === service) current = undefined
  }
}

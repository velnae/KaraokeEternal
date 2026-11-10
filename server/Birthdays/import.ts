import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { db } from '../lib/Database.js'
import { prepareAudio } from '../Animation/AudioPreparation.js'
import { prepareTransitionVideo } from '../TransitionVideo/Preparation.js'
import { birthdayLimits } from '../../shared/birthdays.js'
import { assertRoom, asset, assetDTO } from './Store.js'

export interface BirthdayImport { kind: 'intro' | 'music' | 'video', title: string, checksum: string, script?: string }
const pending = new Set<string>()

// Content-derived identity survives a lost HTTP response and needs no new table.
export async function importBirthdayAsset (directory: string, roomId: number, input: BirthdayImport, bytes: Buffer) {
  assertRoom(roomId)
  if (!input || !['intro', 'music', 'video'].includes(input.kind) || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 100
    || (input.script !== undefined && (typeof input.script !== 'string' || input.script.length > 1000))
    || !bytes.length || bytes.length > (input.kind === 'video' ? 40 : 20) * 1024 * 1024
    || createHash('sha256').update(bytes).digest('hex') !== input.checksum) throw new Error('Recurso de importación inválido.')
  const id = `promoted-${createHash('sha256').update(JSON.stringify([roomId, input.kind, input.title, input.checksum, input.script ?? null])).digest('hex').slice(0, 48)}`
  const existing = asset(roomId, id)
  if (existing) {
    const stored = await fs.readFile(path.join(directory, existing.filename))
    if (createHash('sha256').update(stored).digest('hex') !== existing.checksum) throw new Error('El archivo importado ya no está disponible o cambió.')
    return assetDTO(existing)
  }
  if (pending.size >= 2 || pending.has(id)) throw Object.assign(new Error('Hay una importación en curso. Espere y reintente.'), { status: 409 })
  pending.add(id)
  let staging: string | undefined
  try {
    await fs.mkdir(directory, { recursive: true })
    staging = await fs.mkdtemp(path.join(directory, '.import-'))
    let media: { filename: string, durationMs: number, checksum: string }
    const signal = AbortSignal.timeout(120_000)
    if (input.kind === 'video') {
      await fs.writeFile(path.join(staging, 'source.mp4'), bytes)
      const prepared = await prepareTransitionVideo(staging, { ffmpeg: process.env.KES_FFMPEG_PATH || 'ffmpeg', ffprobe: process.env.KES_FFPROBE_PATH || 'ffprobe' }, signal)
      media = { ...prepared, filename: `${id}.mp4` }
      await fs.rename(path.join(staging, 'video.mp4'), path.join(directory, media.filename))
    } else {
      media = await prepareAudio(directory, id, 'voice', bytes, process.env.KES_FFMPEG_PATH || 'ffmpeg', signal, undefined,
        { durationMs: input.kind === 'intro' ? birthdayLimits.introMs : birthdayLimits.musicMs })
    }
    db.run('INSERT INTO birthdayAssets(id,roomId,kind,title,filename,durationMs,checksum,script) VALUES(?,?,?,?,?,?,?,?)',
      [id, roomId, input.kind, input.title, media.filename, media.durationMs, media.checksum, input.script ?? null])
    return assetDTO(asset(roomId, id)!)
  } finally {
    pending.delete(id)
    if (staging) await fs.rm(staging, { recursive: true, force: true })
  }
}

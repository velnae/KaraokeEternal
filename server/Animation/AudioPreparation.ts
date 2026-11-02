import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { parseBuffer } from 'music-metadata'
import { clipDurationLimit, type AudioKind, type EffectType } from '../../shared/animation.js'

const run = promisify(execFile)
export class AudioValidationError extends Error {}
export async function prepareAudio (directory: string, id: string, kind: AudioKind, bytes: Buffer, ffmpeg: string, signal?: AbortSignal, effectType?: EffectType, limits?: { durationMs: number }) {
  const durationLimit = limits?.durationMs ?? clipDurationLimit(kind, effectType)
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new AudioValidationError('Use un archivo de hasta 20 MB.')
  const metadata = await parseBuffer(bytes, undefined, { duration: true }).catch(() => null)
  if (!['wave', 'mpeg', 'ogg'].includes(metadata?.format.container?.toLowerCase() ?? '')) throw new AudioValidationError('El contenido debe ser audio MP3, WAV u OGG.')
  const duration = metadata?.format.duration
  if (!duration) throw new AudioValidationError('El archivo no contiene audio válido.')
  if (duration * 1000 > durationLimit) throw new AudioValidationError(`El audio dura ${duration.toFixed(1)} s; el máximo para este tipo es ${durationLimit / 1000} s.`)
  await fs.mkdir(path.join(directory, 'production'), { recursive: true })
  const raw = path.join(directory, 'production', `${id}.download`)
  const temporary = path.join(directory, 'production', `${id}.part`)
  const filename = `production/${id}.mp3`
  try {
    await fs.writeFile(raw, bytes)
    const analysis = await run(ffmpeg, ['-hide_banner', '-i', raw, '-af', 'volumedetect', '-vn', '-sn', '-f', 'null', '-'], { timeout: 15000, maxBuffer: 16384, signal })
    const peak = /max_volume:\s*([\d.-]+) dB/.exec(analysis.stderr)
    if (!peak || Number(peak[1]) < -75) throw new AudioValidationError('El archivo no contiene una señal de audio útil.')
    const loudness = kind === 'voice' ? -16 : kind === 'effect' ? -20 : -24
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-af', `loudnorm=I=${loudness}:TP=-1:LRA=7`, '-ar', '44100', '-ac', '2', '-b:a', '128k', '-f', 'mp3', temporary], { timeout: 45000, maxBuffer: 16384, signal })
    const output = await fs.readFile(temporary)
    const prepared = await parseBuffer(output, { mimeType: 'audio/mpeg' }, { duration: true })
    const durationMs = Math.ceil((prepared.format.duration ?? 0) * 1000)
    if (!durationMs || durationMs > durationLimit || output.length > 5 * 1024 * 1024) throw new AudioValidationError('El audio preparado supera la duración o tamaño permitido.')
    await fs.rename(temporary, path.join(directory, filename))
    return { filename, durationMs, size: output.length, mime: 'audio/mpeg', checksum: createHash('sha256').update(output).digest('hex') }
  } finally {
    await Promise.all([raw, temporary].map(file => fs.rm(file, { force: true }).catch(() => {})))
  }
}

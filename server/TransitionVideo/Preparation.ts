import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { TRANSITION_VIDEO_LIMITS as limits } from '../../shared/transitionVideo.js'
import type { PreparedTransitionVideo } from './Store.js'

const run = promisify(execFile)
export interface VideoTools { ffmpeg: string, ffprobe: string }
export class VideoPreparationError extends Error {}
const exportGuidance = 'Exporte un MP4 H.264 de 8 bits (yuv420p), hasta 1080p, 30 fps y 30 segundos.'
const inputOptions = ['-protocol_whitelist', 'file,pipe', '-f', 'mov', '-enable_drefs', '0', '-use_absolute_path', '0']
interface Probe {
  format?: { format_name?: string, duration?: string, tags?: { major_brand?: string } }
  streams?: {
    codec_type: string
    codec_name?: string
    profile?: string
    pix_fmt?: string
    level?: number
    width?: number
    height?: number
    avg_frame_rate?: string
    r_frame_rate?: string
    duration?: string
    disposition?: { attached_pic?: number }
  }[]
}

const frameRate = (value = '') => {
  const [numerator, denominator = '1'] = value.split('/')
  return Number(numerator) / Number(denominator)
}
async function probeVideo (file: string, tools: VideoTools, signal: AbortSignal): Promise<Probe> {
  const result = await run(tools.ffprobe, ['-v', 'error', ...inputOptions, '-show_format', '-show_streams', '-of', 'json', file],
    { signal, timeout: 10_000, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 })
  return JSON.parse(result.stdout)
}

function validateVideo (probe: Probe) {
  const video = probe.streams?.find(stream => stream.codec_type === 'video')
  const brand = probe.format?.tags?.major_brand?.trim()
  if (!probe.format?.format_name?.split(',').includes('mp4') || !brand || !['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'iso7', 'iso8', 'iso9', 'mp41', 'mp42', 'avc1', 'M4V'].includes(brand)
    || !video || video.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p' || video.disposition?.attached_pic
    || !['Baseline', 'Constrained Baseline', 'Main', 'High'].includes(video.profile ?? '')
    || !Number.isFinite(video.level) || video.level! <= 0 || video.level! > 41) throw new VideoPreparationError(exportGuidance)
  const duration = Math.max(Number(probe.format.duration), Number(video.duration ?? probe.format.duration))
  const fps = Math.max(frameRate(video.avg_frame_rate), frameRate(video.r_frame_rate))
  if (Number.isFinite(duration) && duration > limits.durationMs / 1000) {
    throw new VideoPreparationError(`El video dura ${duration.toFixed(3)} s; el máximo es ${limits.durationMs / 1000} s. Recorte el archivo antes de subirlo.`)
  }
  if (!Number.isFinite(duration) || duration <= 0
    || !Number.isInteger(video.width) || video.width! <= 0 || video.width! > limits.width
    || !Number.isInteger(video.height) || video.height! <= 0 || video.height! > limits.height
    || !Number.isFinite(fps) || fps <= 0 || fps > limits.frameRate) throw new VideoPreparationError(exportGuidance)
  return { durationMs: Math.ceil(duration * 1000), width: video.width!, height: video.height!, frameRate: fps }
}

// All work stays in a per-attempt staging directory. The service publishes both
// outputs before changing readiness; remuxing never silently trims or transcodes.
export async function prepareTransitionVideo (directory: string, tools: VideoTools, signal: AbortSignal): Promise<PreparedTransitionVideo> {
  const source = path.join(directory, 'source.mp4')
  const output = path.join(directory, 'video.mp4')
  const poster = path.join(directory, 'poster.jpg')
  const sourceSize = (await fs.stat(source)).size
  if (!sourceSize || sourceSize > limits.size) throw new VideoPreparationError('Seleccione un video de hasta 40 MiB.')
  try {
    validateVideo(await probeVideo(source, tools, signal))
    const options = { signal, timeout: 30_000, killSignal: 'SIGKILL' as const, maxBuffer: 256 * 1024 }
    await run(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...inputOptions, '-i', source,
      '-map', '0:v:0', '-c:v', 'copy', '-tag:v', 'avc1', '-an', '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1', '-movflags', '+faststart', output], options)
    const prepared = await probeVideo(output, tools, signal)
    const media = validateVideo(prepared)
    if (prepared.streams?.length !== 1) throw new VideoPreparationError('No se pudo retirar el sonido del video.')
    const size = (await fs.stat(output)).size
    if (!size || size > limits.size) throw new VideoPreparationError('El video preparado supera los 40 MiB.')
    // Decode the entire derivative, not just a poster frame or a truncated sample.
    const decoded = await run(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-xerror', '-err_detect', 'explode',
      ...inputOptions, '-threads', '2', '-i', output, '-map', '0:v:0', '-an', '-sn', '-dn', '-progress', 'pipe:1', '-nostats', '-f', 'null', '-'], options)
    const times = [...decoded.stdout.matchAll(/^out_time_us=(\d+)/gm)].map(match => Number(match[1]))
    if (!times.length || Math.max(...times) <= 0 || Math.max(...times) > limits.durationMs * 1000) throw new VideoPreparationError(exportGuidance)
    await run(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...inputOptions, '-threads', '2', '-i', output,
      '-frames:v', '1', '-vf', 'scale=640:360:force_original_aspect_ratio=decrease', '-threads', '2', '-q:v', '3', '-update', '1', poster], options)
    const image = await fs.readFile(poster)
    if (image.length < 4 || image.length > 2 * 1024 * 1024 || image.readUInt16BE(0) !== 0xffd8 || image.readUInt16BE(image.length - 2) !== 0xffd9) throw new VideoPreparationError('No se pudo crear la imagen de vista previa.')
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(output, { signal })) hash.update(chunk)
    return { ...media, size, checksum: hash.digest('hex') }
  } catch (error) {
    if (signal.aborted || error instanceof VideoPreparationError) throw error
    throw new VideoPreparationError(`No se pudo leer o decodificar el video. ${exportGuidance}`)
  }
}

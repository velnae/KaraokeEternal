import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { youtubeVideoId } from '../shared/youtubeSearch.ts'
import { clipDurationLimit, normalizeEffectType } from '../shared/animation.ts'
import { TRANSITION_VIDEO_LIMITS } from '../shared/transitionVideo.ts'

const exec = promisify(execFile)
export const root = path.resolve(import.meta.dirname, '../.atl/media-imports')
const hash = value => createHash('sha256').update(value).digest('hex')
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]))
  : item)
export async function checksum (file) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(file)) digest.update(chunk)
  return digest.digest('hex')
}
export const readJSON = async file => JSON.parse(await fs.readFile(file, 'utf8'))
export async function writeJSON (file, value) {
  const temporary = `${file}.tmp`
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  await fs.rename(temporary, file)
}

export async function locked (directory, operation) {
  await fs.mkdir(directory, { recursive: true })
  const lock = path.join(directory, '.lock')
  const handle = await fs.open(lock, 'wx').catch(() => {
    throw new Error(`Import is locked: ${lock}. Check the owning process before removing a stale lock.`)
  })
  try {
    await handle.writeFile(String(process.pid))
    return await operation()
  } finally {
    await handle.close()
    await fs.rm(lock, { force: true })
  }
}

export function seconds (value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (typeof value !== 'string' || !/^\d+(?::[0-5]\d){0,2}(?:\.\d+)?$/.test(value)) throw new Error('Time must be nonnegative seconds, MM:SS or HH:MM:SS.')
  return value.split(':').reduce((total, part) => total * 60 + Number(part), 0)
}

export function normalizeManifest (input) {
  const allowed = ['url', 'sourceFile', 'title', 'destination', 'format', 'start', 'end', 'kind', 'metadata', 'roomId', 'baseUrl', 'pathId', 'libraryPath', 'artist']
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) throw new Error('Invalid manifest fields.')
  const value = { ...input, start: seconds(input.start ?? 0), metadata: input.metadata ?? {} }
  if (!!input.url === !!input.sourceFile) throw new Error('Provide exactly one url or sourceFile.')
  if (input.url) {
    const id = youtubeVideoId(input.url)
    if (!id) throw new Error('Use a YouTube video URL, not a playlist or another host.')
    value.url = `https://www.youtube.com/watch?v=${id}`
  } else value.sourceFile = path.resolve(input.sourceFile)
  if (!['file', 'audio', 'background', 'library'].includes(value.destination)) throw new Error('Choose file, audio, background or library.')
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 120) throw new Error('Provide a title of up to 120 characters.')
  if (input.end !== undefined) {
    value.end = seconds(input.end)
    if (value.end <= value.start) throw new Error('End must be greater than start.')
  }
  if (!value.metadata || typeof value.metadata !== 'object' || Array.isArray(value.metadata)) throw new Error('Metadata must be an object.')
  value.format = input.format ?? (value.destination === 'audio' ? 'mp3' : 'mp4')
  if (!['mp3', 'mp4'].includes(value.format) || (value.destination === 'audio' && value.format !== 'mp3')
    || (['background', 'library'].includes(value.destination) && value.format !== 'mp4')) throw new Error('Use MP3 for audio and MP4 for backgrounds/library (standalone MP3 needs CDG in the library).')
  if (value.destination === 'audio') {
    if (!['voice', 'effect', 'ambience'].includes(value.kind)) throw new Error('Choose voice, effect or ambience.')
    normalizeEffectType(value.kind, value.metadata.effectType)
  }
  if (value.destination !== 'file') {
    if (!Number.isSafeInteger(value.roomId) || value.roomId < 1) throw new Error('Provide the expected roomId.')
    const base = new URL(input.baseUrl ?? 'https://karaoke.puyu.pe/')
    if (base.username || base.password || base.search || base.hash || (base.protocol !== 'https:'
      && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) throw new Error('Use HTTPS (HTTP is allowed only for isolated loopback tests).')
    value.baseUrl = base.href.replace(/\/?$/, '/')
  }
  if (value.destination === 'library') {
    if (!Number.isSafeInteger(value.pathId) || value.pathId < 1 || !path.isAbsolute(value.libraryPath ?? '')
      || typeof value.artist !== 'string' || !value.artist.trim()) throw new Error('Library imports require pathId, absolute libraryPath and artist; run on the application host.')
  }
  const duration = value.end === undefined ? undefined : value.end - value.start
  if (duration !== undefined && duration > durationLimit(value)) throw new Error(`This destination allows at most ${durationLimit(value)} seconds.`)
  return value
}

function durationLimit (manifest) {
  if (manifest.destination === 'audio') return clipDurationLimit(manifest.kind, manifest.metadata.effectType) / 1000
  if (manifest.destination === 'background') return TRANSITION_VIDEO_LIMITS.durationMs / 1000
  return 7200
}

async function run (program, args) {
  try {
    return await exec(program, args, { timeout: 600_000, maxBuffer: 8 * 1024 * 1024 })
  } catch (error) {
    // Avoid printing downloader URLs, browser cookies or arbitrary subprocess output.
    const diagnostic = /video is unavailable|private video|sign in|not a bot|HTTP Error 403|HTTP Error 429|No space left|No such file|Unknown encoder/i.exec(error.stderr ?? '')?.[0]
    throw new Error(`${path.basename(program)} failed (${error.code ?? 'timeout'}). ${diagnostic ? `${diagnostic}. ` : ''}Check installation, source availability and tool version.`)
  }
}

export async function probe (file) {
  const { stdout } = await run(process.env.KES_FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file])
  const info = JSON.parse(stdout)
  const duration = Number(info.format?.duration)
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Media has no valid duration.')
  return { duration, streams: info.streams, size: (await fs.stat(file)).size }
}

async function download (manifest, directory) {
  if (manifest.sourceFile) return { file: manifest.sourceFile, source: { file: manifest.sourceFile } }
  const cache = path.join(directory, 'cache', `${youtubeVideoId(manifest.url)}-${manifest.format}`)
  return locked(cache, async () => {
    const record = path.join(cache, 'source.json')
    try {
      const stored = await readJSON(record)
      if (await checksum(stored.file) === stored.checksum) return stored
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    const downloader = process.env.KES_YTDLP_PATH || 'yt-dlp'
    const common = ['--ignore-config', '--no-playlist', '--no-progress', '--socket-timeout', '30', '--retries', '2']
    const { stdout } = await run(downloader, [...common, '--skip-download', '--dump-single-json', '--', manifest.url])
    const metadata = JSON.parse(stdout)
    if (metadata.is_live || metadata.live_status === 'is_upcoming' || !Number.isFinite(metadata.duration) || metadata.duration <= 0 || metadata.duration > 7200) throw new Error('Use a finished video with a known duration of at most two hours.')
    const { stdout: filename } = await run(downloader, [...common, '--max-filesize', '2G', '-f', manifest.format === 'mp3' ? 'bestaudio/best' : 'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
      '--merge-output-format', 'mkv', '--output', path.join(cache, 'source.%(ext)s'), '--print', 'after_move:filepath', '--', manifest.url])
    const file = filename.trim()
    if (path.dirname(path.resolve(file)) !== cache) throw new Error('Downloader did not return the expected local file.')
    const stored = { file, checksum: await checksum(file), source: { url: manifest.url, title: metadata.title, channel: metadata.channel, duration: metadata.duration } }
    await writeJSON(record, stored)
    return stored
  })
}

export async function prepare (input, directory = root) {
  const manifest = normalizeManifest(input)
  const sourceChecksum = manifest.sourceFile ? await checksum(manifest.sourceFile) : null
  const id = hash(canonical({ manifest, sourceChecksum })).slice(0, 32)
  const folder = path.join(directory, id)
  const receiptPath = path.join(folder, 'receipt.json')
  return locked(folder, async () => {
    try {
      const existing = await readJSON(receiptPath)
      if (await checksum(existing.file) !== existing.checksum) throw new Error('Prepared file changed. Restore it before resuming.')
      return { ...existing, receiptPath }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    const downloaded = await download(manifest, directory)
    const original = await probe(downloaded.file)
    const duration = (manifest.end ?? original.duration) - manifest.start
    if (duration <= 0 || (manifest.end ?? 0) > original.duration + 0.05 || duration > durationLimit(manifest)) throw new Error('Requested range is outside the source or exceeds the destination duration limit.')
    const file = path.join(folder, `media.${manifest.format}`)
    const temporary = path.join(folder, `preparing.${manifest.format}`)
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', downloaded.file, '-ss', String(manifest.start), '-t', String(duration), '-map_metadata', '-1']
    if (manifest.format === 'mp3') args.push('-map', '0:a:0', '-vn', '-c:a', 'libmp3lame', '-b:a', '192k')
    else {
      args.push('-map', '0:v:0', '-vf', 'scale=w=\'min(1920,iw)\':h=\'min(1080,ih)\':force_original_aspect_ratio=decrease:force_divisible_by=2', '-r', '30', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-threads', '2')
      if (manifest.destination === 'background') args.push('-an')
      else args.push('-map', '0:a:0', '-c:a', 'aac', '-b:a', '192k')
      args.push('-movflags', '+faststart')
    }
    args.push('-metadata', `title=${manifest.title}`)
    if (manifest.artist) args.push('-metadata', `artist=${manifest.artist}`)
    args.push(temporary)
    try {
      await run(process.env.KES_FFMPEG_PATH || 'ffmpeg', args)
      const info = await probe(temporary)
      const sizeLimit = manifest.destination === 'audio' ? 20 * 1024 * 1024 : manifest.destination === 'background' ? TRANSITION_VIDEO_LIMITS.size : 2 * 1024 ** 3
      if (info.duration > durationLimit(manifest) || Math.abs(info.duration - duration) > 0.2 || info.size > sizeLimit) throw new Error('Encoded media exceeds the duration/size limit; choose a shorter range (leave room for encoder padding).')
      await fs.rename(temporary, file)
      const receipt = { version: 1, id, manifest, source: downloaded.source, file, checksum: await checksum(file), duration: info.duration, size: info.size, status: 'prepared' }
      await writeJSON(receiptPath, receipt)
      return { ...receipt, receiptPath }
    } finally { await fs.rm(temporary, { force: true }) }
  })
}

async function main () {
  const [action, file] = process.argv.slice(2)
  if (!['prepare', 'upload', 'inspect'].includes(action) || !file) throw new Error('Usage: node --import tsx config/media-import.js prepare <manifest.json> | upload <receipt.json> | inspect <receipt.json>')
  let result
  if (action === 'prepare') result = await prepare(await readJSON(file))
  else if (action === 'inspect') result = await readJSON(file)
  else {
    const { upload } = await import('./media-import-api.js')
    result = await upload(path.resolve(file))
  }
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}

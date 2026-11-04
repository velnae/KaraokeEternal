import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { prepareTransitionVideo } from './Preparation.js'
import { copyVideoFixture, videoFixture } from './fixtures.js'

let directory: string
let source: string
const tools = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }
beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'video-preparation-'))
  source = await videoFixture(directory)
})
afterAll(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

it('produces a fully decodable silent MP4, fast-start metadata, a JPEG and checksum', async () => {
  const work = path.join(directory, 'valid')
  await copyVideoFixture(source, work)
  const result = await prepareTransitionVideo(work, tools, AbortSignal.timeout(10_000))
  const bytes = await fs.readFile(path.join(work, 'video.mp4'))
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', path.join(work, 'video.mp4')], { encoding: 'utf8' }))
  expect(probe.streams).toHaveLength(1)
  expect(probe.streams[0]).toMatchObject({ codec_name: 'h264', codec_type: 'video', pix_fmt: 'yuv420p' })
  expect(result).toMatchObject({ width: 320, height: 180, frameRate: 10, durationMs: 1000, size: bytes.length, checksum: createHash('sha256').update(bytes).digest('hex') })
  expect(bytes.indexOf('moov')).toBeLessThan(bytes.indexOf('mdat'))
  const poster = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', path.join(work, 'poster.jpg')], { encoding: 'utf8' }))
  expect(poster.streams[0]).toMatchObject({ codec_name: 'mjpeg', width: 640, height: 360 })
})

it.each([
  ['long', ['-t', '31']], ['fast', ['-r', '60']], ['large', ['-vf', 'scale=1922:180']],
  ['codec', ['-c:v', 'mpeg4']], ['ten-bit', ['-pix_fmt', 'yuv420p10le']],
])('rejects incompatible real exports: %s', async (name, extra) => {
  const input = await videoFixture(directory, `${name}.mp4`, extra as string[])
  const work = path.join(directory, String(name))
  await copyVideoFixture(input, work)
  await expect(prepareTransitionVideo(work, tools, AbortSignal.timeout(10_000))).rejects.toThrow(name === 'long' ? 'el máximo es 30 s' : 'Exporte un MP4')
}, 20_000)

it('explains a one-frame duration overrun instead of suggesting a codec change', async () => {
  const input = await videoFixture(directory, 'one-frame-over.mp4', ['-an', '-vf', 'fps=30', '-t', '31', '-frames:v', '901'])
  const work = path.join(directory, 'one-frame-over')
  await copyVideoFixture(input, work)
  await expect(prepareTransitionVideo(work, tools, AbortSignal.timeout(10_000)))
    .rejects.toThrow(/El video dura 30\.03\d s; el máximo es 30 s\. Recorte/)
}, 20_000)

it('rejects a non-MP4 container even when its filename says MP4', async () => {
  const input = await videoFixture(directory, 'disguised.mp4', ['-f', 'matroska'])
  const work = path.join(directory, 'disguised')
  await copyVideoFixture(input, work)
  await expect(prepareTransitionVideo(work, tools, AbortSignal.timeout(10_000))).rejects.toThrow()
})

it('rejects corrupt video packets rather than accepting a playable first frame', async () => {
  const work = path.join(directory, 'corrupt')
  await copyVideoFixture(source, work)
  const bytes = await fs.readFile(path.join(work, 'source.mp4'))
  const mdat = bytes.indexOf('mdat')
  bytes.fill(0, mdat + Math.floor((bytes.length - mdat) / 2))
  await fs.writeFile(path.join(work, 'source.mp4'), bytes)
  await expect(prepareTransitionVideo(work, tools, AbortSignal.timeout(10_000))).rejects.toThrow()
})

it('checks size before probing and honors cancellation', async () => {
  const work = path.join(directory, 'oversized')
  await copyVideoFixture(source, work)
  await fs.truncate(path.join(work, 'source.mp4'), 40 * 1024 * 1024 + 1)
  await expect(prepareTransitionVideo(work, tools, AbortSignal.timeout(10_000))).rejects.toThrow('40 MiB')
  await fs.copyFile(source, path.join(work, 'source.mp4'))
  await expect(prepareTransitionVideo(work, tools, AbortSignal.abort())).rejects.toThrow()
})

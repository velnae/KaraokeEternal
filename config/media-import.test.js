import { afterAll, beforeAll, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { normalizeManifest, prepare, probe, seconds } from './media-import.js'

let directory, source
const manifest = extra => ({ sourceFile: source, title: 'Test clip', destination: 'audio', kind: 'effect', roomId: 1, start: 0.5, end: 1.5, ...extra })
beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'media-import-test-'))
  source = path.join(directory, 'source.mp4')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10',
    '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '3', '-c:v', 'libx264', '-threads', '2', '-c:a', 'aac', source])
})
afterAll(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

it('accepts fractional timecodes and rejects negative or reversed ranges', () => {
  expect(seconds('01:02:03.5')).toBe(3723.5)
  expect(() => seconds('-1')).toThrow()
  expect(() => seconds('01:61')).toThrow()
  expect(() => normalizeManifest(manifest({ end: 0.1 }))).toThrow('End')
})

it.each([
  { destination: 'audio', kind: 'effect', end: 6 },
  { destination: 'background', end: 31 },
  { destination: 'library', format: 'mp3' },
  { roomId: 0 },
  { baseUrl: 'http://public.example/' },
  { baseUrl: 'https://user:password@example.com/' },
  { typo: true },
])('rejects invalid destination inputs before downloading: %j', (patch) => {
  expect(() => normalizeManifest(manifest(patch))).toThrow()
})

it('canonicalizes a single YouTube video and rejects arbitrary URLs/playlists', () => {
  expect(normalizeManifest(manifest({ sourceFile: undefined, url: 'https://youtu.be/BaW_jenozKc?t=3' })).url).toBe('https://www.youtube.com/watch?v=BaW_jenozKc')
  for (const url of ['https://localhost/file', 'https://youtube.com.evil.test/watch?v=BaW_jenozKc', 'https://youtube.com/playlist?list=123']) {
    expect(() => normalizeManifest(manifest({ sourceFile: undefined, url }))).toThrow()
  }
})

it('encodes the requested audio range and reuses a receipt without rewriting bytes', async () => {
  const first = await prepare(manifest(), directory)
  const info = await probe(first.file)
  expect(info.duration).toBeCloseTo(1, 0)
  expect(info.streams.map(stream => stream.codec_type)).toEqual(['audio'])
  const before = (await fs.stat(first.file)).mtimeMs
  const second = await prepare(manifest(), directory)
  expect(second.id).toBe(first.id)
  expect((await fs.stat(second.file)).mtimeMs).toBe(before)
})

it('creates silent compatible background video but preserves library audio', async () => {
  const background = await prepare(manifest({ destination: 'background' }), directory)
  expect((await probe(background.file)).streams.map(stream => stream.codec_type)).toEqual(['video'])
  const video = await prepare(manifest({ destination: 'file', format: 'mp4' }), directory)
  expect((await probe(video.file)).streams.map(stream => stream.codec_name)).toEqual(['h264', 'aac'])
})

it('rejects out-of-source ranges and tampered prepared files', async () => {
  await expect(prepare(manifest({ start: 3.5, end: 4 }), directory)).rejects.toThrow('outside')
  const prepared = await prepare(manifest({ title: 'Tamper check' }), directory)
  await fs.appendFile(prepared.file, 'changed')
  await expect(prepare(manifest({ title: 'Tamper check' }), directory)).rejects.toThrow('changed')
})

it('reuses one source download across different cuts', async () => {
  const fake = path.join(directory, 'fake-downloader')
  const log = path.join(directory, 'download-count')
  await fs.writeFile(fake, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--dump-single-json')) {
  console.log(JSON.stringify({ title: 'Fixture', duration: 3 }));
} else {
  const output = args[args.indexOf('--output') + 1].replace('%(ext)s', 'mp4');
  fs.copyFileSync(${JSON.stringify(source)}, output);
  fs.appendFileSync(${JSON.stringify(log)}, 'download\\n');
  console.log(output);
}
`, { mode: 0o700 })
  const previous = process.env.KES_YTDLP_PATH
  process.env.KES_YTDLP_PATH = fake
  try {
    const first = await prepare(manifest({ sourceFile: undefined, url: 'https://youtu.be/BaW_jenozKc' }), directory)
    const second = await prepare(manifest({ sourceFile: undefined, url: 'https://youtu.be/BaW_jenozKc', start: 1, end: 2 }), directory)
    expect(first.id).not.toBe(second.id)
    expect(await fs.readFile(log, 'utf8')).toBe('download\n')
  } finally {
    if (previous === undefined) delete process.env.KES_YTDLP_PATH
    else process.env.KES_YTDLP_PATH = previous
  }
})

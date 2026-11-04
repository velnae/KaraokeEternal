import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
// Small real media for isolated tests; never uses the configured data directory.
export async function videoFixture (directory: string, name = 'fixture.mp4', extra: string[] = []) {
  const file = path.join(directory, name)
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10',
    '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '1', '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', ...extra, file], { timeout: 15_000 })
  return file
}
export async function copyVideoFixture (source: string, directory: string) {
  await fs.mkdir(directory, { recursive: true })
  await fs.copyFile(source, path.join(directory, 'source.mp4'))
}

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { close, db, open } from '../lib/Database.js'
import { prepareAudio } from '../Animation/AudioPreparation.js'
import { importBirthdayAsset } from './import.js'

vi.mock('../Animation/AudioPreparation.js', () => ({ prepareAudio: vi.fn() }))
let directory: string
const bytes = Buffer.from('Validated media fixture')
const input = { kind: 'intro' as const, title: 'Approved introduction', script: 'Exact approved script', checksum: createHash('sha256').update(bytes).digest('hex') }
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'birthday-import-'))
  open({ file: path.join(directory, 'db.sqlite'), ro: false })
  db.run('INSERT INTO rooms(roomId,name,status,data) VALUES(1,\'Room\',\'open\',\'{}\'),(2,\'Other\',\'open\',\'{}\')')
  vi.mocked(prepareAudio).mockReset().mockImplementation(async (directory, id) => {
    const filename = `${id}.mp3`
    await fs.writeFile(path.join(directory, filename), bytes)
    return { filename, checksum: input.checksum, durationMs: 1000, mime: 'audio/mpeg', size: bytes.length }
  })
})
afterEach(async () => {
  close()
  await fs.rm(directory, { recursive: true, force: true })
})

it('reconciles an accepted import without preparing twice and preserves the exact script', async () => {
  const first = await importBirthdayAsset(directory, 1, input, bytes)
  expect(await importBirthdayAsset(directory, 1, input, bytes)).toEqual(first)
  expect(first.script).toBe(input.script)
  expect(prepareAudio).toHaveBeenCalledTimes(1)
  expect(db.get<{ n: number }>('SELECT count(*) n FROM birthdayAssets')!.n).toBe(1)
})

it('rejects tampered bytes and non-catalog kinds before preparation or persistence', async () => {
  await expect(importBirthdayAsset(directory, 1, input, Buffer.from('changed'))).rejects.toThrow('inválido')
  await expect(importBirthdayAsset(directory, 1, { ...input, kind: 'greeting' as 'intro' }, bytes)).rejects.toThrow('inválido')
  expect(prepareAudio).not.toHaveBeenCalled()
  expect(db.get<{ n: number }>('SELECT count(*) n FROM birthdayAssets')!.n).toBe(0)
})

it('isolates resource identity by room and rejects unavailable rooms', async () => {
  const first = await importBirthdayAsset(directory, 1, input, bytes)
  const other = await importBirthdayAsset(directory, 2, input, bytes)
  expect(other.id).not.toBe(first.id)
  await expect(importBirthdayAsset(directory, 3, input, bytes)).rejects.toThrow('sala')
})

it('reports corruption instead of silently replacing an already-imported resource', async () => {
  const first = await importBirthdayAsset(directory, 1, input, bytes)
  await fs.writeFile(path.join(directory, `${first.id}.mp3`), 'corrupted')
  await expect(importBirthdayAsset(directory, 1, input, bytes)).rejects.toThrow('cambió')
  expect(prepareAudio).toHaveBeenCalledTimes(1)
})

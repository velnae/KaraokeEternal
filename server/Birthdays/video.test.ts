import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { close, db, open } from '../lib/Database.js'
import { BirthdayService } from './Service.js'
import { importBirthdayAsset } from './import.js'
import { videoFixture } from '../TransitionVideo/fixtures.js'

let directory: string
let boundary: string
let over: string
let service: BirthdayService
beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'birthday-video-'))
  open({ file: path.join(directory, 'database.sqlite'), ro: false })
  db.run('INSERT INTO rooms(roomId,name,status,data) VALUES(1,\'Room\',\'open\',\'{}\')')
  boundary = await videoFixture(directory, 'boundary.mp4', ['-an', '-t', '130'])
  over = await videoFixture(directory, 'over.mp4', ['-an', '-t', '130.1'])
  service = new BirthdayService(directory, undefined, {
    write: async () => { throw new Error('No generation expected') },
    speak: async () => { throw new Error('No generation expected') },
  })
})
afterAll(async () => {
  await service?.stop()
  close()
  await fs.rm(directory, { recursive: true, force: true })
})
it('uploads the 130-second boundary only to birthday resources', async () => {
  const resource = await service.uploadVideo(1, 'Long birthday background', boundary)
  expect(resource.durationMs).toBe(130000)
  expect(resource.kind).toBe('video')
  expect(db.all('SELECT * FROM transitionVideos')).toEqual([])
  expect(db.all('SELECT * FROM birthdays')).toEqual([])
})
it('rejects overlong uploads and removes partial output without adding a resource', async () => {
  const before = db.get('SELECT count(*) n FROM birthdayAssets')
  await expect(service.uploadVideo(1, 'Overlong', over)).rejects.toThrow('el máximo es 130 s')
  expect(db.get('SELECT count(*) n FROM birthdayAssets')).toEqual(before)
  expect((await fs.readdir(directory)).filter(name => name.startsWith('.video-'))).toEqual([])
})
it('imports the same duration limit with retry-safe resource identity', async () => {
  const bytes = await fs.readFile(boundary)
  const input = { kind: 'video' as const, title: 'Imported long birthday', checksum: createHash('sha256').update(bytes).digest('hex') }
  const resource = await importBirthdayAsset(directory, 1, input, bytes)
  expect(resource.durationMs).toBe(130000)
  expect((await importBirthdayAsset(directory, 1, input, bytes)).id).toBe(resource.id)
  const overBytes = await fs.readFile(over)
  await expect(importBirthdayAsset(directory, 1, { ...input, checksum: createHash('sha256').update(overBytes).digest('hex') }, overBytes)).rejects.toThrow('el máximo es 130 s')
})

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { open, close, db } from '../lib/Database.js'
import { readPreview, recordPreviewSample, savePreviewDraft } from './preview.js'
import { asset, assetDTO } from './Store.js'
import { birthdayPreviewKey, birthdayPreviewScript, type BirthdayPreviewDraft } from '../../shared/birthdayPreview.js'
import { defaultBirthdaySettings } from '../../shared/birthdays.js'
import { BirthdayService } from './Service.js'

let directory: string
const config = { ...defaultBirthdaySettings, defaultVoiceId: 'Orus' }
const draft: BirthdayPreviewDraft = { name: 'Carlos', script: birthdayPreviewScript('Carlos'), introId: '', videoId: '', musicId: '', bedId: '', bedVolume: 0.2, profileIndex: '' }
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'birthday-preview-'))
  open({ file: path.join(directory, 'db.sqlite'), ro: false })
  db.run(`INSERT INTO users(userId,username,password,name,roleId) VALUES(1,'one','','One',1),(2,'two','','Two',1)`)
  db.run(`INSERT INTO rooms(roomId,name,status,data) VALUES(1,'One','open','{}'),(2,'Two','open','{}')`)
  const bytes = Buffer.from('prepared audio fixture')
  await fs.writeFile(path.join(directory, 'preview.mp3'), bytes)
  db.run(`INSERT INTO birthdayAssets(id,roomId,kind,title,filename,durationMs,checksum,script) VALUES('sample',1,'greeting','Preview','preview.mp3',12000,?,?)`, [createHash('sha256').update(bytes).digest('hex'), draft.script])
})
afterEach(async () => {
  close()
  await fs.rm(directory, { recursive: true, force: true })
})

it('restores the draft and existing audio after reopening the database without synthesis', async () => {
  savePreviewDraft(1, 1, draft, 0)
  const media = assetDTO(asset(1, 'sample')!)
  recordPreviewSample(1, 1, config, draft, media, 1)
  close()
  open({ file: path.join(directory, 'db.sqlite'), ro: false })
  const providers = {
    write: vi.fn(async (): Promise<string> => {
      throw new Error('Unexpected generation')
    }),
    speak: vi.fn(async (): Promise<Buffer> => {
      throw new Error('Unexpected generation')
    }),
  }
  const service = new BirthdayService(directory, undefined, providers)
  await service.start()
  await service.stop()
  const restored = await readPreview(directory, 1, 1)
  expect(restored.draft).toEqual(draft)
  expect(restored.samples[birthdayPreviewKey(config, draft, 'Orus', config.speechStyle)]).toEqual(media)
  expect(await readPreview(directory, 2, 1)).toEqual({ revision: 0, draft: null, samples: {} })
  expect(await readPreview(directory, 1, 2)).toEqual({ revision: 0, draft: null, samples: {} })
  expect(providers.write).not.toHaveBeenCalled()
  expect(providers.speak).not.toHaveBeenCalled()
})

it('preserves incomplete edits and rejects stale writes instead of overwriting another window', () => {
  savePreviewDraft(1, 1, { ...draft, name: '', script: '' }, 0)
  expect(() => savePreviewDraft(1, 1, draft, 0)).toThrow('otra ventana')
  expect(() => savePreviewDraft(1, 1, { ...draft, bedVolume: 2 }, 1)).toThrow('Volumen')
})

it('keeps edited text when an older generation finishes but retains its reusable audio', async () => {
  savePreviewDraft(1, 1, draft, 0)
  const edited = { ...draft, script: 'Texto nuevo todavía en edición' }
  savePreviewDraft(1, 1, edited, 1)
  recordPreviewSample(1, 1, config, draft, assetDTO(asset(1, 'sample')!), 1)
  const restored = await readPreview(directory, 1, 1)
  expect(restored.draft).toEqual(edited)
  expect(Object.values(restored.samples)).toHaveLength(1)
})

it('persists regenerated text on completion even when its browser has disconnected', async () => {
  savePreviewDraft(1, 1, draft, 0)
  const script = `${draft.script} ¡Muchas felicidades!`
  db.run('UPDATE birthdayAssets SET script=? WHERE id=?', [script, 'sample'])
  recordPreviewSample(1, 1, config, draft, assetDTO(asset(1, 'sample')!), 1)
  expect((await readPreview(directory, 1, 1)).draft?.script).toBe(script)
})

it('drops missing or corrupted audio references without discarding the saved draft', async () => {
  savePreviewDraft(1, 1, draft, 0)
  recordPreviewSample(1, 1, config, draft, assetDTO(asset(1, 'sample')!))
  await fs.writeFile(path.join(directory, 'preview.mp3'), 'corrupted')
  const restored = await readPreview(directory, 1, 1)
  expect(restored.draft).toEqual(draft)
  expect(restored.samples).toEqual({})
})

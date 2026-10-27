import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { expect, it } from 'vitest'
import { DatabaseWrapper, open, close, db } from '../lib/Database.js'
import { loadCatalog, saveCatalogRecord } from './catalog.js'
import { getResource } from './Resources.js'

it('upgrades a pre-inventory database idempotently and rehearses snapshot rollback without deleting new assets', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-migration-'))
  const filename = path.join(directory, 'database.sqlite')
  const schemas = path.join(directory, 'legacy-schemas')
  await fs.mkdir(schemas)
  const source = path.join(import.meta.dirname, '../lib/schemas')
  for (const file of await fs.readdir(source)) if (Number(file.slice(0, 3)) <= 12) await fs.copyFile(path.join(source, file), path.join(schemas, file))
  const previous = new DatabaseWrapper(filename)
  try {
    previous.migrate({ migrationsPath: schemas })
    previous.run('INSERT INTO rooms(roomId,name,status,data) VALUES(1,\'Existing room\',\'open\',\'{}\')')
    previous.run('INSERT INTO animationRoomState(roomId,microphoneOccupied) VALUES(1,1)')
    previous.run('INSERT INTO catalogGenerationJobs(jobId,roomId,generationKey,configJSON,status,createdAt,createdBy,units,unitType,filename) VALUES(\'legacy\',1,\'legacy\',?,\'ready_for_review\',1,1,5,\'characters\',\'voice.wav\')', [JSON.stringify({ title: 'Legacy voice', text: 'Hola', kind: 'voice', family: 'welcome', modes: ['mixed'], style: 'warm', model: 'old-model' })])
    previous.run('VACUUM INTO ?', [path.join(directory, 'before.sqlite')])
  } finally { previous.close() }
  await fs.copyFile(path.resolve('assets/animation/welcome.wav'), path.join(directory, 'voice.wav'))
  const manifest = JSON.stringify([{ id: 'inactive', roomId: 1, title: 'Inactive', displayText: 'Text', kind: 'voice', filename: 'voice.wav', active: false, source: 'local', license: 'fixture' }])
  await fs.writeFile(path.join(directory, 'catalog.json'), manifest)
  try {
    open({ file: filename, ro: false })
    await loadCatalog(directory)
    await loadCatalog(directory)
    expect(db.get<{ n: number }>('SELECT count(*) n FROM audioResources')?.n).toBe(2)
    expect(getResource('generated-legacy')).toMatchObject({ roomId: 1, preparation: 'ready', state: 'active' })
    expect(getResource('inactive')).toMatchObject({ state: 'disabled' })
    expect(db.get<{ microphoneOccupied: number }>('SELECT microphoneOccupied FROM animationRoomState')?.microphoneOccupied).toBe(0)
    await saveCatalogRecord({ id: 'new-audio', roomId: 1, title: 'New audio', filename: 'voice.wav', active: true })
    db.run('VACUUM INTO ?', [path.join(directory, 'after.sqlite')])
    close()
    await fs.copyFile(path.join(directory, 'before.sqlite'), filename)
    const restored = new DatabaseWrapper(filename)
    const retained = new DatabaseWrapper(path.join(directory, 'after.sqlite'))
    try {
      expect(restored.get<{ id: number }>('SELECT max(id) id FROM migrations')?.id).toBe(12)
      expect(restored.get<{ status: string }>('SELECT status FROM catalogGenerationJobs WHERE jobId=\'legacy\'')?.status).toBe('ready_for_review')
      expect(retained.get('SELECT id FROM audioResources WHERE id=\'new-audio\'')).toBeTruthy()
      expect(await fs.readFile(path.join(directory, 'catalog.json'), 'utf8')).toBe(manifest)
      expect((await fs.stat(path.join(directory, 'voice.wav'))).size).toBeGreaterThan(0)
    } finally {
      restored.close()
      retained.close()
    }
  } finally {
    close()
    await fs.rm(directory, { recursive: true, force: true })
  }
})

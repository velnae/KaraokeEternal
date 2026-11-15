import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DatabaseWrapper } from '../lib/Database.js'

it('preserves existing media, scripts and events when adding the optional bed resource kind', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'birthday-bed-migration-'))
  const schemas = path.resolve(import.meta.dirname, '../lib/schemas')
  const legacy = path.join(directory, 'legacy')
  fs.mkdirSync(legacy)
  for (const file of fs.readdirSync(schemas).filter(file => /^\d+-.+\.sql$/.test(file) && Number(file.split('-')[0]) < 50)) fs.copyFileSync(path.join(schemas, file), path.join(legacy, file))
  const database = new DatabaseWrapper(path.join(directory, 'database.sqlite'))
  try {
    database.migrate({ migrationsPath: legacy })
    database.exec('PRAGMA foreign_keys=ON')
    database.run('INSERT INTO rooms(roomId,name,status,data) VALUES(1,\'Room\',\'open\',\'{}\')')
    database.run('INSERT INTO birthdayAssets(id,roomId,kind,title,filename,durationMs,checksum,script) VALUES(\'intro\',1,\'intro\',\'Intro\',\'kept.mp3\',1000,\'hash\',\'Approved text\')')
    database.run('INSERT INTO birthdays(id,roomId,requestId,name,sex,birthYear,celebrationYear,voiceId,settingsJSON,createdAt) VALUES(\'event\',1,\'request\',\'Carlos\',\'male\',2000,2026,\'voice\',\'{}\',1)')
    const resource = database.get('SELECT * FROM birthdayAssets')
    const event = database.get('SELECT * FROM birthdays')
    database.migrate({ migrationsPath: schemas })
    expect(database.get('SELECT * FROM birthdayAssets')).toEqual(resource)
    expect(database.get('SELECT * FROM birthdays')).toEqual(event)
    database.run('INSERT INTO birthdayAssets(id,roomId,kind,title,filename,durationMs,checksum) VALUES(\'bed\',1,\'bed\',\'Bed\',\'bed.mp3\',1000,\'bed-hash\')')
    expect(database.all('SELECT id FROM birthdayAssets ORDER BY id')).toEqual([{ id: 'bed' }, { id: 'intro' }])
    database.run('DELETE FROM rooms WHERE roomId=1')
    expect(database.all('SELECT * FROM birthdayAssets')).toEqual([])
  } finally {
    database.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

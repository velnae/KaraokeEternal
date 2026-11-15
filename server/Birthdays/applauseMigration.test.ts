import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DatabaseWrapper } from '../lib/Database.js'

it('adds applause without cascading away existing preview references or changing legacy snapshots', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'birthday-applause-migration-'))
  const previous = path.join(directory, 'previous')
  fs.mkdirSync(previous)
  const schemas = path.resolve('server/lib/schemas')
  for (const name of fs.readdirSync(schemas)) if (/^\d+-.*\.sql$/.test(name) && Number(name.split('-')[0]) < 53) fs.copyFileSync(path.join(schemas, name), path.join(previous, name))
  const database = new DatabaseWrapper(path.join(directory, 'test.sqlite'))
  try {
    database.exec('PRAGMA foreign_keys=ON')
    database.migrate({ migrationsPath: previous })
    database.exec(`INSERT INTO users(userId,username,password,name,roleId) VALUES(1,'test','','Test',1);
      INSERT INTO rooms(roomId,name,status,data) VALUES(1,'Room','open','{}');
      INSERT INTO birthdayAssets VALUES('voice',1,'greeting','Voice','production/voice.mp3',1000,'checksum','Saved script');
      INSERT INTO birthdayPreviewSamples VALUES(1,1,'saved-key','voice',1);`)
    database.migrate({ migrationsPath: schemas })
    expect(database.get('SELECT assetId FROM birthdayPreviewSamples')).toEqual({ assetId: 'voice' })
    expect(database.get('SELECT script FROM birthdayAssets WHERE id=\'voice\'')).toEqual({ script: 'Saved script' })
    database.exec(`INSERT INTO birthdayAssets VALUES('applause',1,'applause','Applause','production/applause.mp3',3000,'checksum',NULL)`)
    expect(database.all('PRAGMA foreign_key_check')).toEqual([])
  } finally {
    database.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

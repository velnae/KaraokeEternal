import { it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseWrapper } from '../lib/Database.js'

it('upgrades a populated pre-table database without changing rooms, users or queue order', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-table-upgrade-'))
  const legacySchemas = path.join(temp, 'schemas')
  fs.mkdirSync(legacySchemas)
  const schemas = path.join(import.meta.dirname, '../lib/schemas')
  const database = new DatabaseWrapper(path.join(temp, 'db.sqlite3'))
  try {
    for (const file of fs.readdirSync(schemas)) {
      if (Number(file.slice(0, 3)) <= 7) fs.copyFileSync(path.join(schemas, file), path.join(legacySchemas, file))
    }
    database.migrate({ migrationsPath: legacySchemas })
    database.exec(`
      INSERT INTO rooms(roomId, name, status) VALUES(1, 'Existing room', 'open');
      INSERT INTO users(userId, username, name, password, roleId) VALUES(1, 'guest', 'Singer', 'guest', 4);
      INSERT INTO queue(queueId, roomId, userId, songId, title, artistOrChannel, requestId) VALUES(1, 1, 1, 5, 'Existing song', 'Artist', 'existing-request');
    `)
    database.migrate({ migrationsPath: schemas })
    expect(database.get('SELECT roomId, name, data FROM rooms')).toEqual({ roomId: 1, name: 'Existing room', data: '{}' })
    expect(database.get('SELECT queueId, prevQueueId, requestId, tableId, tableLabelSnapshot, participantSessionId FROM queue')).toEqual({
      queueId: 1, prevQueueId: null, requestId: 'existing-request', tableId: null, tableLabelSnapshot: null, participantSessionId: null,
    })
    expect(database.all('PRAGMA foreign_key_check')).toHaveLength(0)
    database.migrate({ migrationsPath: schemas })
    const migrationCount = fs.readdirSync(schemas).filter(file => /^\d+-.*\.sql$/.test(file)).length
    expect(database.get<{ count: number }>('SELECT COUNT(*) AS count FROM migrations')?.count).toBe(migrationCount)
  } finally {
    database.close()
    fs.rmSync(temp, { recursive: true, force: true })
  }
})

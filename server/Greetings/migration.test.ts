import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { expect, it } from 'vitest'
import { DatabaseWrapper } from '../lib/Database.js'

it.each(['early', 'current'] as const)('upgrades %s migration 016 without losing requests, greetings or consumed turns', (revision) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'greeting-upgrade-'))
  const legacy = path.join(directory, 'schemas')
  const schemas = path.join(import.meta.dirname, '../lib/schemas')
  fs.mkdirSync(legacy)
  for (const file of fs.readdirSync(schemas)) {
    if (Number(file.slice(0, 3)) > 16) continue
    let content = fs.readFileSync(path.join(schemas, file), 'utf8')
    if (revision === 'early' && file.startsWith('016-')) content = content.replace('  position INTEGER NOT NULL,\n', '')
    fs.writeFileSync(path.join(legacy, file), content)
  }
  const database = new DatabaseWrapper(path.join(directory, 'db.sqlite'))
  try {
    database.migrate({ migrationsPath: legacy })
    database.exec(`PRAGMA foreign_keys=ON;
      INSERT INTO rooms(roomId,name,status,data) VALUES(1,'Existing room','open','{}');
      INSERT INTO users(userId,username,password,name,roleId) VALUES(1,'existing','','Existing',3);
      INSERT INTO queue(queueId,roomId,userId,prevQueueId,source,externalId,status,title,artistOrChannel)
        VALUES(7,1,1,NULL,'YOUTUBE','AAAAAAAAAAA','PLAYED','First','Artist'),
        (9,1,1,7,'YOUTUBE','BBBBBBBBBBB','PLAYED','Second','Artist'),
        (11,1,1,9,'YOUTUBE','CCCCCCCCCCC','APPROVED','Pending','Artist');
      INSERT INTO greetingTurns(turnKey,roomId,ownerSocketId,untilAt,finished) VALUES(9,1,'previous-screen',1,1);
      INSERT INTO greetings(queueId,roomId,userId,sender,recipient,message,status,createdAt,turnKey)
        VALUES(7,1,1,'Existing','','Delivered','DISPLAYED',1,9),
        (9,1,1,'Existing','','Interrupted','INTERRUPTED',1,9),
        (11,1,1,'Existing','','Waiting','QUEUED',1,NULL);`)
    if (revision === 'early') database.exec('INSERT INTO greetingTurnItems(queueId,turnKey) VALUES(7,9),(9,9)')
    else database.exec('INSERT INTO greetingTurnItems(queueId,turnKey,position) VALUES(7,9,1),(9,9,0)')
    const requests = database.all<Record<string, unknown>>('SELECT * FROM queue ORDER BY queueId')
    const greetings = database.all<Record<string, unknown>>('SELECT * FROM greetings ORDER BY greetingId')
    const turns = database.all('SELECT * FROM greetingTurns')
    const recorded = database.get<{ up: string }>('SELECT up FROM migrations WHERE id=16')!.up

    database.migrate({ migrationsPath: schemas })
    database.migrate({ migrationsPath: schemas })
    expect(database.get<{ count: number }>('SELECT count(*) count FROM migrations WHERE id=17')!.count).toBe(1)
    expect(database.get<{ up: string }>('SELECT up FROM migrations WHERE id=16')!.up).toBe(recorded)
    expect(database.all('SELECT * FROM queue ORDER BY queueId')).toEqual(requests.map(row => ({ ...row, requestIntent: 'UNKNOWN' })))
    expect(database.all('SELECT * FROM greetings ORDER BY greetingId')).toEqual(greetings.map(row => ({ ...row, audioJobId: null, audioReason: null })))
    expect(database.all('SELECT turnKey,roomId,ownerSocketId,untilAt,finished FROM greetingTurns')).toEqual(turns)
    expect(database.all('SELECT queueId,turnKey,position FROM greetingTurnItems ORDER BY queueId')).toEqual([
      { queueId: 7, turnKey: 9, position: revision === 'early' ? 0 : 1 },
      { queueId: 9, turnKey: 9, position: revision === 'early' ? 1 : 0 },
    ])
    expect(database.all('PRAGMA foreign_key_check')).toEqual([])
    database.exec('INSERT INTO greetingTurns(turnKey,roomId,ownerSocketId,untilAt) VALUES(11,1,\'screen\',1000)')
    expect(() => database.run('INSERT INTO greetingTurnItems(queueId,turnKey,position) VALUES(?,?,?)', [11, 11, 0])).not.toThrow()
  } finally {
    database.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { open, close, db } from '../../lib/Database.js'
import Tables from '../../Tables/Tables.js'
import GreetingVoice from '../../Greetings/GreetingVoice.js'
import CallJobs from './Jobs.js'
import CallAutomation from './Automation.js'

afterEach(() => close())

it('adds singing history fields without rewriting existing request outcomes', () => {
  open({ file: ':memory:', ro: false })
  db.exec(`INSERT INTO rooms(roomId,name,status) VALUES(1,'Venue','open');
    INSERT INTO users(userId,username,name,password,roleId) VALUES(1,'ana','Ana','test',1);
    INSERT INTO queue(queueId,roomId,userId,source,externalId,status,title,artistOrChannel) VALUES(1,1,1,'YOUTUBE','AAAAAAAAAAA','PLAYED','Song','Fixture');
    INSERT INTO karaokeCallRequests(queueId,roomId,inputKey,status,startedAt,updatedAt) VALUES(1,1,'original','ready',100,200);
    ALTER TABLE karaokeCallRequests DROP COLUMN recoveredPartId;
    ALTER TABLE karaokeCallRequests DROP COLUMN recoveryJobId;
    ALTER TABLE karaokeCallRequests DROP COLUMN playbackReason;
    DELETE FROM migrations WHERE id=46;`)
  const migrationsPath = path.join(import.meta.dirname, '../../lib/schemas')
  db.migrate({ migrationsPath })
  db.migrate({ migrationsPath })
  expect(db.get('SELECT inputKey,status,startedAt,playbackReason,recoveryJobId,recoveredPartId FROM karaokeCallRequests')).toEqual({
    inputKey: 'original', status: 'ready', startedAt: 100, playbackReason: null, recoveryJobId: null, recoveredPartId: null,
  })
  expect(db.all('PRAGMA foreign_key_check')).toEqual([])
})

it.each([true, false])('repairs an already applied migration 44 with missing recovery column=%s without rewriting its history', (missing) => {
  open({ file: ':memory:', ro: false })
  db.exec(`INSERT INTO rooms(roomId,name,status) VALUES(1,'Venue','open');
    INSERT INTO users(userId,username,name,password,roleId) VALUES(1,'ana','Ana','test',1);
    INSERT INTO queue(queueId,roomId,userId,source,externalId,status,title,artistOrChannel)
      VALUES(1,1,1,'YOUTUBE','AAAAAAAAAAA','PLAYED','Song','Fixture');
    INSERT INTO listeningPresentations(roomId,queueId,inputKey,playbackReason) VALUES(1,1,'original-input','audio-not-ready');
    DELETE FROM migrations WHERE id=45;`)
  if (missing) {
    db.exec('ALTER TABLE listeningPresentations DROP COLUMN recoveryJobId')
    db.run('UPDATE migrations SET up=? WHERE id=44', ['ALTER TABLE listeningPresentations ADD COLUMN playbackReason TEXT;'])
  }
  const history = db.get('SELECT * FROM migrations WHERE id=44')
  const migrationsPath = path.join(import.meta.dirname, '../../lib/schemas')
  db.migrate({ migrationsPath })
  db.migrate({ migrationsPath })
  expect(db.all<{ name: string }>('PRAGMA table_info(listeningPresentations)').map(row => row.name)).toContain('recoveryJobId')
  expect(db.get('SELECT inputKey,playbackReason,recoveryJobId FROM listeningPresentations WHERE queueId=1')).toEqual({
    inputKey: 'original-input', playbackReason: 'audio-not-ready', recoveryJobId: null,
  })
  expect(db.get('SELECT * FROM migrations WHERE id=44')).toEqual(history)
  expect(db.all('PRAGMA foreign_key_check')).toEqual([])
})

it.each([
  { missing: ['setupRequestId', 'setupAttempt'] },
  { missing: ['setupRequestId'] },
  { missing: ['setupAttempt'] },
  { missing: [] },
])('repairs legacy setup columns $missing without replacing existing table voices', ({ missing }) => {
  open({ file: ':memory:', ro: false })
  db.run(`INSERT INTO rooms(roomId,name,status) VALUES(1,'Venue','open')`)
  const tableId = Tables.save(1, undefined, { code: '01' })
  db.run(`INSERT INTO karaokeCallControls(roomId,revision,preparing,enabled,setupRequestId,setupAttempt)
    VALUES(1,4,0,0,'previous-receipt',2)`)
  db.run(`INSERT INTO karaokeCallParts(id,roomId,kind,variantId,title,text,profileKey,cacheKey,master,filename,checksum,masterChecksum,durationMs,createdAt)
    VALUES('existing-voice',1,'table','table-1','Mesa 01','Desde la mesa uno,','profile','cache','masters/existing.wav','production/existing.mp3','mp3','wav',1124,1)`)
  db.run(`INSERT INTO tableCallVoices(tableId,roomId,spokenText,codeSnapshot,revision,partId)
    VALUES(?,1,'Desde la mesa uno,','01',1,'existing-voice')`, [tableId])
  db.run('DELETE FROM migrations WHERE id IN (30,31)')
  for (const column of missing) db.exec(`ALTER TABLE karaokeCallControls DROP COLUMN ${column}`)

  const migrationsPath = path.join(import.meta.dirname, '../../lib/schemas')
  db.migrate({ migrationsPath })
  db.migrate({ migrationsPath })
  expect(db.get('SELECT revision,enabled,setupRequestId,setupAttempt FROM karaokeCallControls WHERE roomId=1')).toMatchObject({
    revision: 4, enabled: 0, setupRequestId: missing.includes('setupRequestId') ? null : 'previous-receipt',
    setupAttempt: missing.includes('setupAttempt') ? 0 : 2,
  })
  expect(db.get('SELECT partId,revision FROM tableCallVoices WHERE tableId=?', [tableId])).toMatchObject({ partId: 'existing-voice', revision: 1 })
  expect(db.get('SELECT durationMs,filename FROM karaokeCallParts WHERE id=?', ['existing-voice'])).toMatchObject({ durationMs: 1124, filename: 'production/existing.mp3' })

  const generate = vi.fn()
  const voice = new GreetingVoice({ configured: true, check: vi.fn(), generate })
  voice.configure({ ...voice.config(), enabled: true })
  const automatic = new CallAutomation(new CallJobs('/unused', voice), voice)
  const setup = { requestId: 'new-setup-receipt', revision: 4 }
  const result = automatic.setup(1, setup)
  expect(result).toMatchObject({ revision: 5, preparing: true, enabled: false })
  expect(automatic.setup(1, setup)).toEqual(result)
  expect(generate).not.toHaveBeenCalled()
})

it('adds disabled listening controls without deleting signed greetings or existing voices', () => {
  open({ file: ':memory:', ro: false })
  db.exec(`ALTER TABLE listeningPresentations DROP COLUMN templatePartId;
    ALTER TABLE listeningPresentations DROP COLUMN templateId;
    DROP TABLE listeningTemplates;
    DELETE FROM migrations WHERE id=43;
    DROP TABLE listeningPresentations;
    ALTER TABLE karaokeCallControls DROP COLUMN listeningEnabled;
    DELETE FROM migrations WHERE id IN (42,44);
    INSERT INTO rooms(roomId,name,status) VALUES(1,'Venue','open');
    INSERT INTO users(userId,username,name,password,roleId) VALUES(1,'ana','Ana','test',1);
    INSERT INTO queue(queueId,roomId,userId,source,externalId,status,title,artistOrChannel) VALUES(1,1,1,'YOUTUBE','AAAAAAAAAAA','APPROVED','Song','Fixture');
    INSERT INTO karaokeCallControls(roomId,revision,preparing,enabled) VALUES(1,3,1,1);
    INSERT INTO greetingAudioJobs(jobId,roomId,cacheKey,spokenText,profileJSON,status,createdAt,updatedAt)
      VALUES('legacy',1,'old-key','Hola — De Ana','{}','ready',1,1);
    INSERT INTO greetings(queueId,roomId,userId,sender,message,status,createdAt,audioJobId)
      VALUES(1,1,1,'Ana','Hola','QUEUED',1,'legacy');`)
  const migrationsPath = path.join(import.meta.dirname, '../../lib/schemas')
  db.migrate({ migrationsPath })
  db.migrate({ migrationsPath })
  expect(db.get('SELECT revision,enabled,listeningEnabled FROM karaokeCallControls')).toMatchObject({ revision: 3, enabled: 1, listeningEnabled: 0 })
  expect(db.get('SELECT message,audioJobId FROM greetings')).toMatchObject({ message: 'Hola', audioJobId: 'legacy' })
  expect(db.get('SELECT spokenText FROM greetingAudioJobs')).toMatchObject({ spokenText: 'Hola — De Ana' })
  expect(db.all('PRAGMA foreign_key_check')).toEqual([])
  expect(db.all<{ name: string }>('PRAGMA table_info(listeningPresentations)').map(row => row.name)).toEqual(expect.arrayContaining(['playbackReason', 'recoveryJobId']))
})

it('imports existing template audio and pins legacy pending assignments without regenerating it', () => {
  open({ file: ':memory:', ro: false })
  db.exec(`ALTER TABLE listeningPresentations DROP COLUMN templatePartId;
    ALTER TABLE listeningPresentations DROP COLUMN templateId;
    DROP TABLE listeningTemplates;
    DELETE FROM migrations WHERE id=43;
    INSERT INTO rooms(roomId,name,status) VALUES(1,'Venue','open');
    INSERT INTO users(userId,username,name,password,roleId) VALUES(1,'ana','Ana','test',1);
    INSERT INTO queue(queueId,roomId,userId,source,externalId,status,title,artistOrChannel) VALUES(1,1,1,'YOUTUBE','AAAAAAAAAAA','APPROVED','Song','Fixture');
    INSERT INTO karaokeCallParts(id,roomId,kind,variantId,title,text,profileKey,cacheKey,master,filename,checksum,masterChecksum,durationMs,createdAt,dependenciesJSON)
      VALUES('template-audio',1,'template','template','Template','Este pedido llega de parte de…','profile','source','masters/source.wav','production/source.mp3','mp3','wav',1000,1,'[]'),
      ('presentation',1,'composition','composition','Presentation','Template Ana','profile','composition','masters/result.wav','production/result.mp3','result','wav',2000,1,'["template-audio","name-audio"]');
    INSERT INTO listeningPresentations(roomId,queueId,inputKey,resultId) VALUES(1,1,'legacy-input','presentation');`)
  const migrationsPath = path.join(import.meta.dirname, '../../lib/schemas')
  db.migrate({ migrationsPath })
  db.migrate({ migrationsPath })
  expect(db.get('SELECT partId FROM listeningTemplates WHERE id=?', ['listening-default-1-1'])).toEqual({ partId: 'template-audio' })
  expect(db.get('SELECT templateId,templatePartId,inputKey,resultId FROM listeningPresentations')).toEqual({ templateId: 'listening-default-1-1', templatePartId: 'template-audio', inputKey: 'legacy-input', resultId: 'presentation' })
  expect(db.all('SELECT * FROM karaokeCallJobs')).toEqual([])
  expect(db.all('PRAGMA foreign_key_check')).toEqual([])
})

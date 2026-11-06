import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { open, close, db } from '../../lib/Database.js'
import Tables from '../../Tables/Tables.js'
import GreetingVoice from '../../Greetings/GreetingVoice.js'
import CallJobs from './Jobs.js'
import CallAutomation from './Automation.js'

afterEach(() => close())

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
  const voice = new GreetingVoice({ configured: false, check: vi.fn(), generate })
  const automatic = new CallAutomation(new CallJobs('/unused', voice), voice)
  const setup = { requestId: 'new-setup-receipt', revision: 4 }
  const result = automatic.setup(1, setup)
  expect(result).toMatchObject({ revision: 5, preparing: true, enabled: false })
  expect(automatic.setup(1, setup)).toEqual(result)
  expect(generate).not.toHaveBeenCalled()
})

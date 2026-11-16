import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { open, close, db } from '../../lib/Database.js'
import Animation from '../Animation.js'
import { beginKaraokeTurn, operateKaraokeTurn } from './Start.js'
import { backgroundSettings, saveBackgroundSettings } from './Backgrounds.js'
import { karaokeCuePreparation } from './Cues.js'
import type { KaraokeCueContext } from '../../../shared/karaokeStage.js'

const identity = { roomId: 1, userId: 1, socketId: 'owner' }
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(100000)
  open({ file: ':memory:', ro: false })
  db.run(`INSERT INTO rooms(roomId,name,status) VALUES(1,'One','open'),(2,'Two','open')`)
  db.run(`INSERT INTO users(userId,username,name,password,roleId) VALUES(1,'admin','Admin','test',1)`)
  db.run(`INSERT INTO roomTables(tableId,roomId,code,name,status,joinToken,dateCreated,dateUpdated) VALUES(1,1,'14','Fourteen','active','table-token',1,1)`)
  db.run(`INSERT INTO queue(queueId,roomId,userId,origin,requestIntent,status,source,externalId,title,artistOrChannel,tableId,tableLabelSnapshot)
    VALUES(1,1,1,'PARTICIPANT','SING','APPROVED','YOUTUBE','test','Test','Test',1,'Mesa 14')`)
  db.run(`INSERT INTO karaokeCallControls(roomId,enabled) VALUES(1,1)`)
  for (const [id, kind, text] of [['table', 'table', 'Desde la mesa catorce,'], ['karaoke', 'continuation', '¡Karaoke!']]) {
    db.run(`INSERT INTO karaokeCallParts(id,roomId,kind,variantId,title,text,profileKey,cacheKey,master,filename,checksum,masterChecksum,durationMs,createdAt)
      VALUES(?,1,?,?,'Fixture',?,'profile',?,'master','file',?,? ,600,1)`, [id, kind, id, text, id, id, id])
  }
  db.run(`INSERT INTO tableCallVoices(tableId,roomId,spokenText,codeSnapshot,revision,partId) VALUES(1,1,'Desde la mesa catorce,','14',1,'table')`)
  db.run(`INSERT INTO karaokeBackgroundAssets(id,roomId,requestId,kind,title,active,state,checksum,durationMs,createdAt)
    VALUES('applause',1,'applause','effect','Applause',1,'ready','applause',1000,1)`)
  saveBackgroundSettings(1, { ...backgroundSettings(1), entryEffectId: 'applause', countdownEffectId: 'applause', endedEffectId: 'applause' })
  Animation.claim(1, identity.socketId)
  Animation.ready(identity, true, ['table', 'karaoke', 'applause'])
})
afterEach(() => {
  Animation.disconnect(1, identity.socketId)
  close()
  vi.useRealTimers()
})
function waiting () {
  const turn = beginKaraokeTurn(1, 1, identity.socketId)!
  return operateKaraokeTurn(1, identity.socketId, { ...turn, operation: 'presented' })!
}
function reminder (turn: ReturnType<typeof waiting>): KaraokeCueContext {
  return { queueId: 1, kind: 'reminder', runId: turn.runId, revision: turn.revision, token: String(turn.reminderAt) }
}
function complete (grant: NonNullable<ReturnType<typeof Animation.reserveKaraokeCue>>) {
  Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'STARTED')
  Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'ENDED')
}
it('reuses the exact saved table voice, scopes it to its room and rejects a renamed table', () => {
  expect(karaokeCuePreparation(1, 1).reminder.map(clip => clip.id)).toEqual(['table', 'karaoke'])
  expect(karaokeCuePreparation(2, 1).reminder).toEqual([])
  db.run(`UPDATE roomTables SET code='15' WHERE tableId=1`)
  expect(karaokeCuePreparation(1, 1).reminder).toEqual([])
})
it('authorizes a reminder only after 10 seconds, once per slot, without requiring Animator', () => {
  const turn = waiting()
  expect(Animation.snapshot(1).prefs.enabled).toBe(false)
  expect(Animation.reserveKaraokeCue(identity, reminder(turn), {})).toBeNull()
  vi.advanceTimersByTime(9999)
  operateKaraokeTurn(1, identity.socketId, { ...turn, operation: 'heartbeat' })
  expect(Animation.reserveKaraokeCue(identity, reminder(turn), {})).toBeNull()
  vi.advanceTimersByTime(1)
  const grant = Animation.reserveKaraokeCue(identity, reminder(turn), {})!
  expect(grant).not.toBeNull()
  expect(JSON.parse(grant.sequenceJSON!).map(clip => clip.id)).toEqual(['table', 'karaoke'])
  complete(grant)
  expect(Animation.reserveKaraokeCue(identity, reminder(turn), {})).toBeNull()
  expect(Animation.snapshot(1).karaokeTurn?.reminderAt).toBe(120000)
})
it('consumes a budget-blocked reminder slot without creating a burst or a second reservation', () => {
  const turn = waiting()
  db.run(`INSERT INTO animationInterventions(interventionId,roomId,requestId,requestedByUserId,clipId,clipChecksum,displayText,durationMs,voiceDurationMs,status,requestedAt,expiresAt,startedAt)
    VALUES('spent',1,'spent',1,'voice','voice','',120000,120000,'PLAYED',100000,220000,100000)`)
  vi.advanceTimersByTime(10000)
  expect(Animation.reserveKaraokeCue(identity, reminder(turn), {})).toBeNull()
  expect(Animation.snapshot(1).karaokeTurn?.reminderAt).toBe(120000)
  expect(Animation.reserveKaraokeCue(identity, reminder(turn), {})).toBeNull()
  expect(Animation.history(1)).toHaveLength(1)
})
it('fences stale reminders at countdown and deduplicates the countdown applause', () => {
  const turn = waiting()
  const countdown = operateKaraokeTurn(1, 'operator', { ...turn, operation: 'start' })!
  expect(Animation.reserveKaraokeCue(identity, reminder(turn), {})).toBeNull()
  const cue: KaraokeCueContext = { queueId: 1, kind: 'countdown', runId: countdown.runId, revision: countdown.revision, token: String(countdown.revision) }
  const grant = Animation.reserveKaraokeCue(identity, cue, {})!
  complete(grant)
  expect(Animation.reserveKaraokeCue(identity, cue, {})).toBeNull()
  const cancelled = operateKaraokeTurn(1, 'operator', { ...countdown, operation: 'cancel' })!
  expect(Animation.reserveKaraokeCue(identity, { ...cue, token: 'stale' }, {})).toBeNull()
  expect(cancelled.phase).toBe('waiting')
})
it('keeps a complete six-second applause authorized through the three-second countdown and actual music start', () => {
  db.run(`UPDATE karaokeBackgroundAssets SET durationMs=6000 WHERE id='applause'`)
  const turn = waiting()
  const countdown = operateKaraokeTurn(1, 'operator', { ...turn, operation: 'start' })!
  vi.advanceTimersByTime(2500)
  const grant = Animation.reserveKaraokeCue(identity, { queueId: 1, kind: 'countdown', runId: countdown.runId, revision: countdown.revision, token: 'late' }, {})!
  expect(grant.durationMs).toBe(6250)
  expect(JSON.parse(grant.sequenceJSON!)[0]).toMatchObject({ durationMs: 6000, playbackDurationMs: 6000 })
  expect(karaokeCuePreparation(1, 1).assets.find(clip => clip.id === 'applause')?.durationMs).toBe(6000)
  Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'STARTED')
  vi.advanceTimersByTime(500)
  Animation.sweep()
  expect(Animation.active(1)?.stopRequestedAt).toBeNull()
  const released = operateKaraokeTurn(1, identity.socketId, { ...countdown, operation: 'consume' })!
  Animation.sweep()
  expect(Animation.active(1)?.stopRequestedAt).toBeNull()
  operateKaraokeTurn(1, identity.socketId, { ...released, operation: 'played' })
  Animation.sweep()
  expect(Animation.active(1)?.stopRequestedAt).toBeNull()
  expect(db.get('SELECT status FROM queue WHERE queueId=1')).toEqual({ status: 'PLAYING' })
  vi.advanceTimersByTime(5500)
  Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'ENDED')
  expect(Animation.history(1).find(row => row.interventionId === grant.interventionId)?.status).toBe('PLAYED')
})

it('stops a started countdown applause on cancellation instead of authorizing its tail', () => {
  const turn = waiting()
  const countdown = operateKaraokeTurn(1, 'operator', { ...turn, operation: 'start' })!
  const grant = Animation.reserveKaraokeCue(identity, { queueId: 1, kind: 'countdown', runId: countdown.runId, revision: countdown.revision, token: 'cancel' }, {})!
  Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'STARTED')
  operateKaraokeTurn(1, 'operator', { ...countdown, operation: 'cancel' })
  Animation.sweep()
  expect(Animation.active(1)?.stopRequestedAt).not.toBeNull()
})
it('rejects foreign owners, unprepared audio and birthday collisions', () => {
  const cue: KaraokeCueContext = { queueId: 1, kind: 'entry', token: 'entry' }
  expect(Animation.reserveKaraokeCue({ ...identity, socketId: 'other' }, cue, {})).toBeNull()
  Animation.ready(identity, true, [])
  expect(Animation.reserveKaraokeCue(identity, cue, {})).toBeNull()
  Animation.ready(identity, true, ['applause'])
  db.run(`INSERT INTO birthdays(id,roomId,requestId,name,sex,birthYear,celebrationYear,voiceId,settingsJSON,createdAt,playback) VALUES('birthday',1,'fixture','Guest','male',2000,2026,'voice','{}',1,'scheduled')`)
  expect(Animation.reserveKaraokeCue(identity, cue, {})).toBeNull()
})
it('permits one closing applause per playback token only for a singing song at its actual boundary', () => {
  const cue: KaraokeCueContext = { queueId: 1, kind: 'ended', token: 'playback-1' }
  expect(Animation.reserveKaraokeCue(identity, cue, { queueId: 1 })).toBeNull()
  db.run(`UPDATE queue SET status='PLAYING' WHERE queueId=1`)
  expect(Animation.reserveKaraokeCue(identity, cue, { queueId: 2 })).toBeNull()
  const grant = Animation.reserveKaraokeCue(identity, cue, { queueId: 1 })!
  complete(grant)
  expect(Animation.reserveKaraokeCue(identity, cue, { queueId: 1 })).toBeNull()
  db.run(`UPDATE queue SET requestIntent='LISTEN' WHERE queueId=1`)
  expect(Animation.reserveKaraokeCue(identity, { ...cue, token: 'other' }, { queueId: 1 })).toBeNull()
})

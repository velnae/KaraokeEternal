import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { open, close, db } from '../lib/Database.js'
import { GREETINGS } from '../../shared/greetings.js'
import handlers from './socket.js'
import Greetings from './Greetings.js'
import Rooms from '../Rooms/Rooms.js'

let directory: string
const actor = { user: { roomId: 1, userId: 1, isAdmin: false }, server: {}, id: 'client' }
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'greeting-permissions-'))
  open({ file: path.join(directory, 'db.sqlite'), ro: false })
  db.exec(`INSERT INTO rooms(roomId,name,status,data) VALUES(1,'Room','open','{}'),(2,'Other','open','{}');
    INSERT INTO users(userId,username,password,name,roleId) VALUES(1,'sender','','Sender',3),(2,'other','','Other',3);
    INSERT INTO queue(queueId,roomId,userId,source,status,origin,title,artistOrChannel,externalId) VALUES(1,1,1,'YOUTUBE','APPROVED','PARTICIPANT','Song','Artist','AAAAAAAAAAA'),(2,2,2,'YOUTUBE','APPROVED','PARTICIPANT','Song','Artist','AAAAAAAAAAA');
    INSERT INTO greetings(queueId,roomId,userId,sender,recipient,message,createdAt) VALUES(1,1,1,'Sender','','Own',1),(2,2,2,'Other','','Private',1)`)
  vi.spyOn(Rooms, 'getPlayerStatus').mockReturnValue(null)
})
afterEach(() => {
  close()
  fs.rmSync(directory, { recursive: true, force: true })
  vi.restoreAllMocks()
})
const invoke = (operation: string, payload: object = {}, socket = actor) => {
  const ack = vi.fn()
  handlers[GREETINGS](socket, { payload: { operation, expiresAt: Date.now() + 2000, ...payload } }, ack)
  return ack.mock.calls[0][0]
}

it('returns only owned greetings and rejects participant moderation/player actions', () => {
  expect(invoke('read').payload.items.map(item => item.message)).toEqual(['Own'])
  expect(invoke('remove', { greetingId: 2 }).error).toBeTruthy()
  for (const operation of ['pause', 'prepareAudio', 'playback', 'prepare', 'reserve', 'start', 'end', 'finish', 'audioStarted', 'audioEnded', 'audioFailed']) {
    expect(invoke(operation, { paused: true, enabled: true, queueId: 1, greetingId: 1, turnKey: 1 }).error).toBeTruthy()
  }
  expect(Greetings.paused(1)).toBe(false)
  expect(Greetings.audioEnabled(1)).toBe(false)
  expect(invoke('remove', { greetingId: 1 }).payload.items[0].status).toBe('CANCELLED')
})

it('requires player authority even for administrators and rejects expired commands', () => {
  const admin = { ...actor, user: { ...actor.user, isAdmin: true } }
  expect(invoke('reserve', { queueId: 1 }, admin).error).toContain('autoridad')
  expect(invoke('pause', { paused: true, expiresAt: 1 }, admin).error).toContain('venció')
  expect(invoke('pause', { paused: true }, admin).payload.paused).toBe(true)
  expect(invoke('prepareAudio', { enabled: true }, admin).payload.audioEnabled).toBe(true)
  expect(Greetings.audioEnabled(2)).toBe(false)
})

it('rejects revoked table membership before reading or changing messages', () => {
  const member = { ...actor, user: { ...actor.user, participantSessionId: 'revoked' } }
  expect(invoke('read', {}, member).error).toContain('terminó')
})

it('attaches a message to an owned request once, independently of its music receipt', () => {
  db.run('DELETE FROM greetings WHERE queueId=1')
  expect(invoke('read').payload.opportunities[1]).toMatchObject({ canAdd: true })
  const payload = { queueId: 1, message: '  ¡Feliz di\u0301a!  ' }
  const first = invoke('attach', payload)
  expect(first.error).toBeUndefined()
  expect(first.payload.items[0]).toMatchObject({ recipient: '', message: '¡Feliz día!', sender: 'Sender', status: 'QUEUED' })
  expect(invoke('attach', payload).payload.items[0].greetingId).toBe(first.payload.items[0].greetingId)
  expect(invoke('attach', { ...payload, message: 'Different message' }).error).toContain('ya tiene')
  expect(invoke('attach', { ...payload, queueId: 2 }).error).toBeTruthy()
  expect(db.all('SELECT queueId FROM queue')).toHaveLength(2)
  expect(Greetings.items(1)).toHaveLength(1)
  expect(invoke('read').payload.opportunities[1].canAdd).toBe(false)
})

it('allows pending approval but rejects closed windows and invalid messages', () => {
  db.run('DELETE FROM greetings WHERE queueId=1')
  for (const message of ['', ' ', null, '<script>', 'x'.repeat(220)]) {
    expect(invoke('attach', { queueId: 1, message }).error).toBeTruthy()
  }
  db.run(`UPDATE queue SET status='PENDING_APPROVAL' WHERE queueId=1`)
  expect(invoke('read').payload.opportunities[1].canAdd).toBe(true)
  expect(invoke('attach', { queueId: 1, message: '¡Hola!' }).error).toBeUndefined()
  expect(db.get<{ status: string }>('SELECT status FROM queue WHERE queueId=1')?.status).toBe('PENDING_APPROVAL')
  db.run('DELETE FROM greetings WHERE queueId=1')
  db.run(`UPDATE queue SET status='APPROVED' WHERE queueId=1`)
  Greetings.reserve(1, 'player', 1, {})
  expect(invoke('read').payload.opportunities[1]).toMatchObject({ canAdd: false, reason: expect.stringContaining('transición') })
  expect(invoke('attach', { queueId: 1, message: 'Too late' }).error).toContain('transición')
  expect(Greetings.items(1)).toHaveLength(0)
})

it('rejects closed rooms, cancelled requests and stale membership before attaching', () => {
  db.run('DELETE FROM greetings WHERE queueId=1')
  const payload = { queueId: 1, message: 'Hello' }
  const revoked = { ...actor, user: { ...actor.user, participantSessionId: 'revoked' } }
  expect(invoke('attach', payload, revoked).error).toContain('terminó')
  db.run(`UPDATE queue SET status='REMOVED' WHERE queueId=1`)
  expect(invoke('attach', payload).error).toBeTruthy()
  db.run(`UPDATE queue SET status='APPROVED' WHERE queueId=1`)
  db.run(`UPDATE rooms SET status='closed' WHERE roomId=1`)
  expect(invoke('attach', payload).error).toContain('cerrada')
  expect(db.all('SELECT queueId FROM queue')).toHaveLength(2)
})

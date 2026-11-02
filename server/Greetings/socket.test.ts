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
  for (const operation of ['pause', 'prepareAudio', 'reserve', 'start', 'end', 'finish']) {
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

it('rejects post-request greeting creation and keeps the musical request intact', () => {
  db.run('DELETE FROM greetings WHERE queueId=1')
  expect(invoke('inspect', { queueId: 1 }).error).toContain('al pedir')
  const payload = { queueId: 1, greeting: { recipient: '', message: 'After my order' } }
  expect(invoke('attach', payload).error).toContain('al pedir')
  expect(invoke('attach', { ...payload, queueId: 2 }).error).toBeTruthy()
  expect(db.all('SELECT queueId FROM queue')).toHaveLength(2)
  expect(Greetings.items(1)).toHaveLength(0)
})

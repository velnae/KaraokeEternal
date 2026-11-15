import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { open, close, db } from '../../lib/Database.js'
import { beginKaraokeTurn, discardKaraokeTurn, karaokeTurn, operateKaraokeTurn, recoverKaraokeTurns, resetKaraokeTurn } from './Start.js'
import { KARAOKE_TURN, karaokeCountdownSeconds } from '../../../shared/karaokeStart.js'
import actions from '../socket.js'
import playerActions from '../../Player/socket.js'
import { PLAYER_EMIT_STATUS } from '../../../shared/actionTypes.js'

let queueId: number
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(100000)
  open({ file: ':memory:', ro: false })
  db.run(`INSERT INTO rooms(roomId,name,status) VALUES(1,'One','open'),(2,'Two','open')`)
  db.run(`INSERT INTO users(userId,username,name,password,roleId) VALUES(1,'admin','Admin','test',1)`)
  queueId = add()
})
afterEach(() => {
  close()
  vi.useRealTimers()
})
function add (intent = 'SING', origin = 'PARTICIPANT') {
  return Number(db.run(`INSERT INTO queue(roomId,userId,origin,requestIntent,status,source,externalId,title,artistOrChannel) VALUES(1,1,?,?,'APPROVED','YOUTUBE','test','Test','Test')`, [origin, intent]).lastID)
}
function waiting () {
  const turn = beginKaraokeTurn(1, queueId, 'owner')!
  return operateKaraokeTurn(1, 'owner', { ...turn, operation: 'presented' })!
}
it('defaults to manual only for singing and captures the mode without replacing a presented turn', () => {
  expect(beginKaraokeTurn(1, add('LISTEN'), 'owner')).toBeNull()
  expect(beginKaraokeTurn(1, add('SING', 'HOUSE'), 'owner')).toBeNull()
  const turn = waiting()
  db.run('INSERT INTO karaokeCallControls(roomId,automaticStart) VALUES(1,1)')
  expect(beginKaraokeTurn(1, add(), 'owner')).toEqual(turn)
  expect(db.get('SELECT status FROM queue WHERE queueId=?', [queueId])).toEqual({ status: 'APPROVED' })
  discardKaraokeTurn(1)
  expect(beginKaraokeTurn(1, queueId, 'owner')).toBeNull()
})
it('requires presentation and counts down exactly once despite duplicate operator requests', () => {
  const presenting = beginKaraokeTurn(1, queueId, 'owner')!
  expect(() => operateKaraokeTurn(1, 'operator', { ...presenting, operation: 'start' })).toThrow('presentación')
  const turn = waiting()
  const started = operateKaraokeTurn(1, 'operator', { ...turn, operation: 'start' })!
  vi.advanceTimersByTime(1000)
  expect(operateKaraokeTurn(1, 'another-operator', { ...turn, operation: 'start' })).toEqual(started)
  expect(karaokeCountdownSeconds(started.endsAt!, Date.now())).toBe(4)
  expect(() => operateKaraokeTurn(1, 'owner', { ...started, operation: 'consume' })).toThrow('conteo')
  expect(() => operateKaraokeTurn(1, 'wrong-owner', { ...started, operation: 'heartbeat' })).toThrow('perdió')
})
it('cancels into the same wait and rejects an old confirmation after cancellation', () => {
  const turn = waiting()
  const started = operateKaraokeTurn(1, 'operator', { ...turn, operation: 'start' })!
  const cancelled = operateKaraokeTurn(1, 'operator', { ...started, operation: 'cancel' })!
  expect(cancelled).toMatchObject({ phase: 'waiting', presented: true, endsAt: null, runId: turn.runId })
  expect(() => operateKaraokeTurn(1, 'operator', { ...turn, operation: 'start' })).toThrow('cambió')
})
it('keeps the request approved through the wait and countdown until actual playback is confirmed', () => {
  const turn = waiting()
  const started = operateKaraokeTurn(1, 'operator', { ...turn, operation: 'start' })!
  vi.advanceTimersByTime(5000)
  const released = operateKaraokeTurn(1, 'owner', { ...started, operation: 'consume' })!
  expect(released.phase).toBe('released')
  expect(operateKaraokeTurn(1, 'owner', { ...started, operation: 'consume' })).toEqual(released)
  expect(db.get('SELECT status FROM queue WHERE queueId=?', [queueId])).toEqual({ status: 'APPROVED' })
  expect(operateKaraokeTurn(1, 'owner', { ...released, operation: 'played' })).toBeNull()
  expect(operateKaraokeTurn(1, 'owner', { ...released, operation: 'played' })).toBeNull()
  expect(db.get('SELECT status FROM queue WHERE queueId=?', [queueId])).toEqual({ status: 'PLAYING' })
})
it('preserves the presentation but invalidates countdowns on reconnect, restart and heartbeat loss', () => {
  const turn = waiting()
  operateKaraokeTurn(1, 'operator', { ...turn, operation: 'start' })
  resetKaraokeTurn(1, 'other-owner')
  expect(karaokeTurn(1)?.phase).toBe('countdown')
  resetKaraokeTurn(1, 'owner')
  expect(karaokeTurn(1)).toMatchObject({ phase: 'waiting', presented: true, playerPresent: false })
  const resumed = beginKaraokeTurn(1, queueId, 'successor')!
  expect(resumed).toMatchObject({ runId: turn.runId, phase: 'waiting', presented: true, playerPresent: true })
  operateKaraokeTurn(1, 'operator', { ...resumed, operation: 'start' })
  recoverKaraokeTurns()
  expect(karaokeTurn(1)).toMatchObject({ phase: 'waiting', endsAt: null, playerPresent: false })
  beginKaraokeTurn(1, queueId, 'successor')
  vi.advanceTimersByTime(15001)
  expect(karaokeTurn(1)?.playerPresent).toBe(false)
})
it('supports a long wait with short heartbeats and never authorizes a removed or skipped request', () => {
  let turn = waiting()
  for (let index = 0; index < 8; index++) {
    vi.advanceTimersByTime(10000)
    turn = operateKaraokeTurn(1, 'owner', { ...turn, operation: 'heartbeat' })!
  }
  expect(turn).toMatchObject({ phase: 'waiting', playerPresent: true, presented: true })
  expect(karaokeTurn(2)).toBeNull()
  discardKaraokeTurn(1, true)
  expect(karaokeTurn(1)).toBeNull()
  expect(db.get('SELECT status FROM queue WHERE queueId=?', [queueId])).toEqual({ status: 'REMOVED' })
  expect(() => operateKaraokeTurn(1, 'operator', { ...turn, operation: 'start' })).toThrow('cambió')
})
it('checks socket permissions and player authority separately from operator confirmation', () => {
  const ack = vi.fn()
  const sock = { id: 'visitor', user: { isAdmin: false, role: 'standard', roomId: 1, userId: 1 }, server: { to: () => ({ emit: vi.fn() }) } }
  const send = (operation: string, payload = {}) => actions[KARAOKE_TURN](sock, { payload: { operation, queueId, expiresAt: Date.now() + 5000, ...payload } }, ack)
  send('begin')
  expect(ack.mock.lastCall?.[0].error).toContain('autorización')
  sock.user.role = 'operator'
  send('begin')
  expect(ack.mock.lastCall?.[0].error).toContain('autoridad')
  const turn = waiting()
  send('consume', turn)
  expect(ack.mock.lastCall?.[0].error).toContain('autoridad')
  send('start', turn)
  expect(ack.mock.lastCall?.[0].payload.karaokeTurn.phase).toBe('countdown')
})

it('does not let an early player status mark a waiting or loading karaoke as playing', () => {
  const turn = waiting()
  const ack = vi.fn()
  const sockets = new Map()
  const sock = { id: 'owner', user: { isAdmin: true, role: 'admin', roomId: 1, userId: 1 }, _isPlayerAuthoritative: true,
    server: { to: () => ({ emit: vi.fn() }), of: () => ({ sockets }) } }
  sockets.set(sock.id, sock)
  const report = () => playerActions[PLAYER_EMIT_STATUS](sock, { payload: { queueId, isPlaying: true, historyJSON: '[]' } }, ack)
  report()
  expect(db.get('SELECT status FROM queue WHERE queueId=?', [queueId])).toEqual({ status: 'APPROVED' })
  const started = operateKaraokeTurn(1, 'operator', { ...turn, operation: 'start' })!
  vi.advanceTimersByTime(5000)
  const released = operateKaraokeTurn(1, 'owner', { ...started, operation: 'consume' })!
  report()
  expect(db.get('SELECT status FROM queue WHERE queueId=?', [queueId])).toEqual({ status: 'APPROVED' })
  operateKaraokeTurn(1, 'owner', { ...released, operation: 'played' })
  expect(db.get('SELECT status FROM queue WHERE queueId=?', [queueId])).toEqual({ status: 'PLAYING' })
})

it('keeps birthday priority and requires a fresh confirmation after it interrupts a countdown', () => {
  const turn = waiting()
  const started = operateKaraokeTurn(1, 'operator', { ...turn, operation: 'start' })!
  db.run(`INSERT INTO birthdays(id,roomId,requestId,name,sex,birthYear,celebrationYear,voiceId,settingsJSON,createdAt,playback) VALUES('birthday',1,'fixture','Carlos','male',2000,2026,'voice','{}',1,'scheduled')`)
  vi.advanceTimersByTime(5000)
  expect(() => operateKaraokeTurn(1, 'owner', { ...started, operation: 'consume' })).toThrow('cumpleaños')
  const paused = karaokeTurn(1)!
  expect(paused).toMatchObject({ phase: 'waiting', endsAt: null, presented: true })
  expect(() => operateKaraokeTurn(1, 'operator', { ...paused, operation: 'start' })).toThrow('cumpleaños')
  db.run(`UPDATE birthdays SET playback='completed' WHERE id='birthday'`)
  expect(operateKaraokeTurn(1, 'operator', { ...paused, operation: 'start' })).toMatchObject({ phase: 'countdown', endsAt: Date.now() + 5000 })
})

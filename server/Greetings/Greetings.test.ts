import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { open, close, db } from '../lib/Database.js'
import Queue from '../Queue/Queue.js'
import Greetings from './Greetings.js'
import { greetingDuration } from '../../shared/greetings.js'

let directory: string
const identity = { roomId: 1, userId: 1 }
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-28T12:00:00Z'))
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'greetings-'))
  open({ file: path.join(directory, 'db.sqlite'), ro: false })
  db.run('INSERT INTO rooms(roomId,name,status,data) VALUES(1,?,\'open\',?),(2,?,\'open\',?)', ['Test', JSON.stringify({ prefs: { queue: { maxSongsPerParticipantRound: 2, houseTracksBeforeParticipant: 0 } } }), 'Other', '{}'])
  db.exec('INSERT INTO users(userId,username,password,name,roleId) VALUES(1,\'ana\',\'\',\'Ana\',1),(2,\'juan\',\'\',\'Juan\',1)')
})
afterEach(() => {
  close()
  fs.rmSync(directory, { recursive: true, force: true })
  vi.useRealTimers()
})

function song (userId = 1, roomId = 1) {
  return Queue.add({ roomId, userId, song: { source: 'YOUTUBE', sourceId: 'AAAAAAAAAAA', externalId: 'AAAAAAAAAAA', localSongId: null, mediaId: null, mediaType: 'youtube', title: 'Song', artistOrChannel: 'Artist', durationSeconds: 120, thumbnailUrl: null, isPlayable: true } })
}
const attach = (queueId: number, userId = 1) => Greetings.attach({ roomId: 1, userId }, queueId, { recipient: 'Rocío', message: '¡Feliz cumpleaños!' }, {})

it('attaches to the accepted request within the submission flow and deduplicates a retry', () => {
  const queueId = song()
  expect(Greetings.opportunity(identity, queueId, {})).toEqual({ greeting: null, canAdd: true, reason: null })
  const id = attach(queueId)
  expect(attach(queueId)).toBe(id)
  expect(Greetings.items(1)).toHaveLength(1)
  expect(Greetings.opportunity(identity, queueId, {}).greeting?.greetingId).toBe(id)
  expect(() => Greetings.attach(identity, queueId, { recipient: '', message: 'Another message' }, {})).toThrow('ya tiene')
  expect(Queue.get(1).entities[queueId].status).toBe('APPROVED')
})

it('closes the post-request window at reservation even before the first song starts', () => {
  const queueId = song()
  expect(Greetings.reserve(1, 'screen', queueId, {})).toBeNull()
  expect(Greetings.opportunity(identity, queueId, {}).canAdd).toBe(false)
  expect(() => attach(queueId)).toThrow('transición')
  expect(Greetings.items(1)).toHaveLength(0)
  expect(Queue.get(1).entities[queueId].status).toBe('APPROVED')
})

it('delivers each greeting before its own song once, while retaining the canonical turn', () => {
  const first = song()
  attach(first)
  const second = song()
  attach(second)
  const grant = Greetings.reserve(1, 'screen', first, {})!
  expect(grant.items.map(item => item.queueId)).toEqual([first])
  for (const item of grant.items) {
    Greetings.event(1, 'screen', grant.turnKey, item.greetingId, 'start')
    expect(() => Greetings.event(1, 'screen', grant.turnKey, item.greetingId, 'end')).toThrow('completó')
    vi.advanceTimersByTime(greetingDuration(item))
    Greetings.event(1, 'screen', grant.turnKey, item.greetingId, 'end')
  }
  expect(Greetings.items(1).map(item => item.status)).toEqual(['DISPLAYED', 'QUEUED'])
  Greetings.finish(1, 'screen', grant.turnKey)
  expect(Greetings.reserve(1, 'replacement', first, {})).toBeNull()
  Queue.transition(1, first, 'PLAYING')
  Queue.transition(1, first, 'PLAYED')
  const next = Greetings.reserve(1, 'screen', second, { queueId: first, historyJSON: `[${first}]` })!
  expect(next.items.map(item => item.queueId)).toEqual([second])
  Greetings.event(1, 'screen', next.turnKey, next.items[0].greetingId, 'start')
  vi.advanceTimersByTime(next.displayMs)
  Greetings.event(1, 'screen', next.turnKey, next.items[0].greetingId, 'end')
  expect(Greetings.items(1).map(item => item.status)).toEqual(['DISPLAYED', 'DISPLAYED'])
  expect(Greetings.reserve(1, 'replacement', second, { queueId: first, historyJSON: `[${first}]` })).toBeNull()
})

it('retains a long-waiting greeting and moves the remaining greeting when the first song is removed', () => {
  const first = song()
  attach(first)
  const second = song()
  attach(second)
  vi.advanceTimersByTime(60 * 60 * 1000)
  Queue.remove(first, 1)
  const grant = Greetings.reserve(1, 'screen', second, {})!
  expect(grant.items.map(item => item.queueId)).toEqual([second])
  expect(Greetings.items(1)[0].status).toBe('CANCELLED')
})

it('allows a later pending song in an already-started participant turn to receive its own greeting', () => {
  const first = song()
  attach(first)
  Greetings.reserve(1, 'screen', first, {})
  const second = song()
  expect(() => attach(second)).not.toThrow()
})

it('keeps the next single-song turn open for greetings until it is reserved', () => {
  const first = song()
  const second = song()
  expect(Greetings.reserve(1, 'player', first, {})).toBeNull()
  expect(Greetings.turnFor(second)).toBeUndefined()
  expect(Greetings.opportunity(identity, first, {}).canAdd).toBe(false)
  expect(Greetings.opportunity(identity, second, {}).canAdd).toBe(true)
  attach(second)
  Queue.transition(1, first, 'PLAYING')
  Queue.transition(1, first, 'PLAYED')
  const grant = Greetings.reserve(1, 'player', second, { queueId: first, historyJSON: JSON.stringify([first]) })!
  expect(grant.items.map(item => item.queueId)).toEqual([second])
  expect(Greetings.opportunity(identity, second, {}).canAdd).toBe(false)
})

it('admits a greeting in the next real turn of the same user', () => {
  const first = song()
  attach(first)
  const second = song()
  attach(second)
  Greetings.reserve(1, 'screen', first, {})
  const third = song()
  expect(() => attach(third)).not.toThrow()
})

it('keeps separate participant turns even without table attribution', () => {
  const first = song()
  attach(first)
  const other = song(2)
  attach(other, 2)
  expect(Greetings.snapshot(identity).items).toHaveLength(1)
  expect(Greetings.snapshot({ roomId: 2, userId: 1, isAdmin: true }).items).toHaveLength(0)
  expect(Greetings.reserve(1, 'screen', first, {})!.items).toHaveLength(1)
  expect(() => Greetings.remove(identity, Greetings.items(1)[1].greetingId)).toThrow('No puedes')
})

it('allows moderation before and during display without changing music', () => {
  const first = song()
  attach(first)
  const second = song()
  attach(second)
  const grant = Greetings.reserve(1, 'screen', first, {})!
  Greetings.remove({ ...identity, isAdmin: true }, grant.items[0].greetingId)
  Greetings.finish(1, 'screen', first)
  Queue.transition(1, first, 'PLAYING')
  Queue.transition(1, first, 'PLAYED')
  const next = Greetings.reserve(1, 'screen', second, { queueId: first, historyJSON: `[${first}]` })!
  Greetings.event(1, 'screen', second, next.items[0].greetingId, 'start')
  Greetings.remove({ ...identity, isAdmin: true }, next.items[0].greetingId)
  expect(Greetings.items(1).map(item => item.status)).toEqual(['REMOVED', 'REMOVED'])
  expect(Object.values(Queue.get(1).entities).map(item => item.status)).toEqual(['PLAYED', 'APPROVED'])
})

it('skips a paused turn rather than publishing its greeting later', () => {
  const first = song()
  attach(first)
  Greetings.pause(1, true)
  expect(Greetings.reserve(1, 'screen', first, {})).toBeNull()
  Greetings.pause(1, false)
  expect(Greetings.reserve(1, 'screen', first, {})).toBeNull()
  expect(Greetings.items(1)[0].status).toBe('SKIPPED')
})

it('fences foreign screens, active music, reordered requests and expired reservations', () => {
  const first = song()
  attach(first)
  const other = song(2)
  attach(other, 2)
  expect(() => Greetings.reserve(1, 'screen', other, {})).toThrow('cambió')
  const grant = Greetings.reserve(1, 'screen', first, {})!
  expect(() => Greetings.event(1, 'other', first, grant.items[0].greetingId, 'start')).toThrow('terminó')
  vi.advanceTimersByTime(30000)
  expect(Greetings.items(1)[0].status).toBe('SKIPPED')
  Queue.transition(1, first, 'PLAYING')
  expect(() => Greetings.reserve(1, 'screen', other, { queueId: first })).toThrow('ocupa')
})

it('retains consumed turns across database reopen without replaying uncertain display', () => {
  const first = song()
  attach(first)
  const grant = Greetings.reserve(1, 'screen', first, {})!
  Greetings.event(1, 'screen', first, grant.items[0].greetingId, 'start')
  close()
  open({ file: path.join(directory, 'db.sqlite'), ro: false })
  expect(Greetings.reserve(1, 'replacement', first, {})).toBeNull()
  vi.advanceTimersByTime(30000)
  expect(Greetings.items(1)[0].status).toBe('INTERRUPTED')
})

it('uses the existing FIFO turn semantics and rejects unowned or invalid text', () => {
  db.run('UPDATE rooms SET data=? WHERE roomId=1', [JSON.stringify({ prefs: { queue: { rotationMode: 'FIFO', maxSongsPerParticipantRound: 2 } } })])
  const first = song()
  attach(first)
  const second = song()
  attach(second)
  expect(Greetings.reserve(1, 'screen', first, {})!.items).toHaveLength(1)
  const foreign = song(2)
  expect(() => attach(foreign)).toThrow('tu pedido')
  expect(() => Greetings.attach({ roomId: 1, userId: 2 }, foreign, { recipient: '', message: '<script>hi</script>' }, {})).toThrow('texto simple')
})

it('starts a new single-song turn even when only one singer remains', () => {
  const played: number[] = []
  for (let i = 0; i < 3; i++) {
    const id = song()
    Queue.transition(1, id, 'PLAYING')
    Queue.transition(1, id, 'PLAYED')
    played.push(id)
  }
  const fourth = song()
  expect(Greetings.order(1).turns[0]).toEqual({ ids: [fourth], startsNewTurn: true })
  expect(() => Greetings.attach(identity, fourth, { recipient: '', message: 'For the pending song' }, { queueId: played[2], historyJSON: JSON.stringify(played) })).not.toThrow()
})

it('preserves the musical ordering of greetings after a pre-turn reorder', () => {
  const first = song()
  attach(first)
  const second = song()
  attach(second)
  Queue.move({ roomId: 1, queueId: second, prevQueueId: null })
  const grant = Greetings.reserve(1, 'screen', second, {})!
  expect(grant.items.map(item => item.queueId)).toEqual([second])
  expect(Greetings.items(1).find(item => item.queueId === first)?.status).toBe('QUEUED')
  expect(() => Greetings.event(1, 'screen', grant.turnKey, grant.items[0].greetingId, 'start')).not.toThrow()
})

it('uses the player history merge order after reconnect rather than a different fairness history', () => {
  const first = song()
  const second = song(2)
  for (const id of [first, second]) {
    Queue.transition(1, id, 'PLAYING')
    Queue.transition(1, id, 'PLAYED')
  }
  const nextFirst = song()
  const nextSecond = song(2)
  const order = Greetings.order(1, { queueId: second, historyJSON: `[${second}]` })
  expect(order.result).toEqual([first, second, nextFirst, nextSecond])
  expect(order.turns[0]).toEqual({ ids: [nextFirst], startsNewTurn: true })
})

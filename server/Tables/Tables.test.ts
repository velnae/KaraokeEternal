import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest'
import { open, close, db } from '../lib/Database.js'
import Rooms from '../Rooms/Rooms.js'
import Tables from './Tables.js'
import { joinTable, participation, revokeParticipation, validateInvitation, PARTICIPATION_TTL_SECONDS } from './admission.js'
import Queue from '../Queue/Queue.js'
import actions from '../Queue/socket.js'
import { QUEUE_ADD } from '../../shared/actionTypes.js'
import { youtubeSongSource } from '../SongSources/YouTubeSongSource.js'
import type { ResolvedSong } from '../../shared/songSource.js'

let dir: string
const identity = { userId: 1, roomId: 1, isAdmin: false }
const song: ResolvedSong = { source: 'YOUTUBE', sourceId: 'AAAAAAAAAAA', externalId: 'AAAAAAAAAAA', localSongId: null, title: 'Test song', artistOrChannel: 'Singer', durationSeconds: 120, thumbnailUrl: null, mediaId: null, mediaType: 'youtube', isPlayable: true }
const mode = (value: string) => db.run('UPDATE rooms SET data = ? WHERE roomId = 1', [JSON.stringify({ prefs: { tables: { mode: value } } })])

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-tables-'))
  open({ file: path.join(dir, 'db.sqlite3'), ro: false })
})
afterAll(() => {
  close()
  fs.rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  vi.restoreAllMocks()
  db.exec('DELETE FROM queue; DELETE FROM participantSessions; DELETE FROM roomTables; DELETE FROM rooms; DELETE FROM users;')
  db.run('INSERT INTO users(userId, username, password, name, roleId) VALUES (1, \'guest1\', \'guest\', \'Guest\', 3)')
  db.run('INSERT INTO rooms(roomId, name, status) VALUES (1, \'One\', \'open\'), (2, \'Two\', \'open\')')
  mode('OPTIONAL')
})

describe('table admission lifecycle', () => {
  it('scopes codes and projections to the room without exposing invitation credentials', () => {
    Tables.save(1, undefined, { code: '05', name: 'Terrace' })
    expect(() => Tables.save(1, undefined, { code: '05' })).toThrow('ya existe')
    Tables.save(2, undefined, { code: '05' })
    expect(Tables.list(1)).toHaveLength(1)
    expect(JSON.stringify(Tables.list(1))).not.toContain('joinToken')
    expect(() => Tables.get(2, Tables.list(1)[0].tableId)).toThrow()
  })

  it('keeps QR stable across reopen and rejects old invitation after manual renewal without ending sessions', () => {
    const id = Tables.save(1, undefined, { code: '1' })
    const token = Tables.credential(1, id)
    const session = joinTable(identity, token)
    close()
    open({ file: path.join(dir, 'db.sqlite3'), ro: false })
    expect(Tables.credential(1, id)).toBe(token)
    expect(participation({ ...identity, ...session }).tableId).toBe(id)
    const next = Tables.credential(1, id, true)
    expect(next).not.toBe(token)
    expect(() => Tables.resolve(token)).toThrow()
    expect(participation({ ...identity, ...session }).tableId).toBe(id)
  })

  it('requires tables only in strict mode and forbids cross-room or fabricated credentials', async () => {
    mode('OFF')
    expect(validateInvitation(1)).toBeNull()
    mode('OPTIONAL')
    expect(participation(identity).tableId).toBeNull()
    await expect(Rooms.set(1, { name: 'One', status: 'open', prefs: { tables: { mode: 'REQUIRED_QR' } } })).rejects.toThrow('mesa activa')
    const tableId = Tables.save(1, undefined, { code: '1' })
    await Rooms.set(1, { name: 'One', status: 'open', prefs: { tables: { mode: 'REQUIRED_QR' } } })
    expect(() => validateInvitation(1)).toThrow('QR')
    expect(() => participation(identity)).toThrow('QR')
    expect(() => validateInvitation(2, Tables.credential(1, tableId))).toThrow('otra sala')
    expect(() => Tables.resolve('1')).toThrow()
    expect(participation({ ...identity, isAdmin: true }).tableId).toBeNull()
  })

  it('reuses a valid session but preserves request snapshots on transfer, rename and archive', () => {
    const first = Tables.save(1, undefined, { code: '1' })
    const second = Tables.save(1, undefined, { code: '2' })
    const token = Tables.credential(1, first)
    const original = joinTable(identity, token)
    expect(joinTable({ ...identity, ...original }, token)).toEqual(original)
    Queue.add({ roomId: 1, userId: 1, song, requestId: 'a'.repeat(16), tableContext: original })
    const moved = joinTable({ ...identity, ...original }, Tables.credential(1, second))
    expect(moved.tableId).toBe(second)
    expect(() => participation({ ...identity, ...original })).toThrow()
    Tables.save(1, first, { code: '1', name: 'Renamed', status: 'archived' })
    const queue = Queue.get(1)
    expect(queue.entities[queue.result[0]].tableLabelSnapshot).toBe('Mesa 1')
    expect(queue.entities[queue.result[0]].tableId).toBe(first)
  })

  it('expires and revokes participation without silently treating it as a tableless guest', () => {
    const id = Tables.save(1, undefined, { code: '1' })
    const token = Tables.credential(1, id)
    const session = joinTable(identity, token)
    expect(session.expiresAt! - Math.floor(Date.now() / 1000)).toBe(PARTICIPATION_TTL_SECONDS)
    db.run('UPDATE participantSessions SET expiresAt = 0')
    expect(() => participation({ ...identity, ...session })).toThrow('terminó')
    const renewed = joinTable({ ...identity, ...session }, token)
    expect(renewed.participantSessionId).not.toBe(session.participantSessionId)
    revokeParticipation(renewed.participantSessionId)
    expect(() => participation({ ...identity, ...renewed })).toThrow()
    expect(joinTable({ ...identity, ...renewed }).tableId).toBeNull()
  })

  it('revokes disabled tables permanently and stops a request disabled during async resolution', async () => {
    const id = Tables.save(1, undefined, { code: '1' })
    const session = joinTable(identity, Tables.credential(1, id))
    vi.spyOn(youtubeSongSource, 'resolve').mockImplementation(async () => {
      Tables.save(1, id, { code: '1', status: 'disabled' })
      return song
    })
    const socket = { user: { ...identity, ...session }, server: { to: () => ({ emit: vi.fn() }) } }
    await expect(actions[QUEUE_ADD](socket, { payload: { source: 'YOUTUBE', sourceId: song.sourceId } }, vi.fn())).rejects.toThrow('terminó')
    expect(Queue.get(1).result).toHaveLength(0)
    Tables.save(1, id, { code: '1', status: 'active' })
    expect(() => participation(socket.user)).toThrow()
  })

  it('retains original request attribution when a receipt is retried after transfer', async () => {
    const first = Tables.save(1, undefined, { code: '1' })
    const second = Tables.save(1, undefined, { code: '2' })
    const original = joinTable(identity, Tables.credential(1, first))
    const requestId = 'b'.repeat(16)
    Queue.add({ roomId: 1, userId: 1, song, requestId, tableContext: original })
    const moved = joinTable({ ...identity, ...original }, Tables.credential(1, second))
    const ack = vi.fn()
    await actions[QUEUE_ADD]({ user: { ...identity, ...moved } }, { payload: { requestId, source: 'YOUTUBE', sourceId: song.sourceId } }, ack)
    expect(ack.mock.calls[0][0].type).toContain('SUCCESS')
    expect(Queue.get(1).result).toHaveLength(1)
    expect(Queue.get(1).entities[Queue.get(1).result[0]].tableId).toBe(first)
  })

  it('supports explicit account and room deletion without orphan foreign keys', () => {
    const tableId = Tables.save(1, undefined, { code: '1' })
    joinTable(identity, Tables.credential(1, tableId))
    db.run('DELETE FROM users WHERE userId = 1')
    expect(db.all('SELECT * FROM participantSessions')).toHaveLength(0)
    db.run('DELETE FROM rooms WHERE roomId = 1')
    expect(Tables.list(2)).toHaveLength(0)
    expect(db.all('PRAGMA foreign_key_check')).toHaveLength(0)
  })
})

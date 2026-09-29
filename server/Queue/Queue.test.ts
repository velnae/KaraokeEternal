import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { close, db, open } from '../lib/Database.js'
import Queue from './Queue.js'
import type { ResolvedSong } from '../../shared/songSource.js'

const resolvedSong = (songId: number): ResolvedSong => ({
  source: 'LOCAL',
  sourceId: String(songId),
  localSongId: songId,
  externalId: null,
  mediaId: songId,
  mediaType: 'mp4',
  title: songId === 1 ? 'First' : songId === 2 ? 'Second' : 'Third',
  artistOrChannel: 'Artist',
  durationSeconds: songId === 1 ? 181 : songId === 2 ? 202 : 223,
  thumbnailUrl: null,
  isPlayable: true,
})

const resolvedYouTubeSong = (): ResolvedSong => ({
  source: 'YOUTUBE',
  sourceId: 'AAAAAAAAAAA',
  localSongId: null,
  externalId: 'AAAAAAAAAAA',
  mediaId: null,
  mediaType: 'youtube',
  title: 'External song',
  artistOrChannel: 'External channel',
  durationSeconds: 245,
  thumbnailUrl: 'https://img.youtube.com/example.jpg',
  isPlayable: true,
})

describe('Queue lifecycle persistence', () => {
  let tempDir: string

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-eternal-queue-'))
    open({ file: path.join(tempDir, 'database.sqlite3'), ro: false })
    db.run('INSERT INTO artists (artistId, name, nameNorm) VALUES (1, \'Artist\', \'artist\')')
    db.run('INSERT INTO songs (songId, artistId, title, titleNorm) VALUES (1, 1, \'First\', \'first\'), (2, 1, \'Second\', \'second\'), (3, 1, \'Third\', \'third\')')
    db.run('INSERT INTO paths (pathId, path, priority, data) VALUES (1, \'/music\', 1, \'{"prefs":{}}\')')
    db.run('INSERT INTO media (mediaId, songId, pathId, relPath, duration, isPreferred) VALUES (1, 1, 1, \'first.mp4\', 181, 1), (2, 2, 1, \'second.mp4\', 202, 1), (3, 3, 1, \'third.mp4\', 223, 1)')
    db.run('INSERT INTO rooms (roomId, name, status, data) VALUES (1, \'Room\', \'open\', \'{}\')')
    db.run('INSERT INTO users (userId, username, password, name, roleId) VALUES (1, \'singer\', \'\', \'Singer\', 3)')
    db.run('INSERT INTO rooms (roomId, name, status, data) VALUES (4, \'Origin room\', \'open\', \'{}\')')
    db.run('INSERT INTO users (userId, username, password, name, roleId) VALUES (4, \'operator\', \'\', \'Operator\', 1)')
  })

  afterAll(() => {
    close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('stores snapshots and counts only participant requests still pending', () => {
    Queue.add({ roomId: 1, song: resolvedSong(1), userId: 1 })
    Queue.add({ roomId: 1, song: resolvedSong(2), userId: 1 })
    const queue = Queue.get(1)

    expect(queue.result).toHaveLength(2)
    expect(queue.entities[queue.result[0]]).toMatchObject({
      origin: 'PARTICIPANT',
      source: 'LOCAL',
      status: 'APPROVED',
      title: 'First',
      artistOrChannel: 'Artist',
      durationSeconds: 181,
    })
    expect(Queue.countPending(1, 1)).toBe(2)

    expect(Queue.transition(1, queue.result[0], 'PLAYING')).toBe(true)
    expect(Queue.countPending(1, 1)).toBe(1)
  })

  it('counts PENDING_APPROVAL and APPROVED only, excluding every terminal status and operator items', () => {
    db.run('INSERT INTO rooms (roomId, name, status, data) VALUES (2, \'Other room\', \'open\', \'{}\')')
    db.run('INSERT INTO users (userId, username, password, name, roleId) VALUES (2, \'other\', \'\', \'Other\', 3)')
    const statuses = ['PENDING_APPROVAL', 'APPROVED', 'PLAYING', 'PLAYED', 'REJECTED', 'REMOVED', 'FAILED']

    statuses.forEach((status, index) => {
      db.run(`INSERT INTO queue (roomId, songId, userId, origin, source, status, title, artistOrChannel) VALUES (2, 1, 2, 'PARTICIPANT', 'LOCAL', ?, ?, 'Artist')`, [status, `Song ${index}`])
    })
    db.run('INSERT INTO queue (roomId, songId, userId, origin, source, status, title, artistOrChannel) VALUES (2, 1, 2, \'OPERATOR\', \'LOCAL\', \'APPROVED\', \'Operator song\', \'Artist\')')

    expect(Queue.countPending(2, 2)).toBe(2)
  })

  it.each(['HOUSE', 'OPERATOR'] as const)('persists an approved local %s item without participant quota usage', (origin) => {
    Queue.add({ roomId: 4, song: resolvedSong(1), userId: 4, origin })
    const queue = Queue.get(4)

    expect(queue.entities[queue.result[queue.result.length - 1]]).toMatchObject({
      origin,
      source: 'LOCAL',
      status: 'APPROVED',
    })
    expect(Queue.countPending(4, 4)).toBe(0)
  })

  it('persists the normalized metadata snapshot instead of rereading mutable library metadata', () => {
    const song = {
      ...resolvedSong(1),
      title: 'Resolved title snapshot',
      artistOrChannel: 'Resolved artist snapshot',
      durationSeconds: 321,
    }

    Queue.add({ roomId: 4, song, userId: 4 })
    const queue = Queue.get(4)
    const queued = queue.entities[queue.result[queue.result.length - 1]]

    expect(queued).toMatchObject({
      songId: 1,
      source: 'LOCAL',
      externalId: null,
      title: 'Resolved title snapshot',
      artistOrChannel: 'Resolved artist snapshot',
      durationSeconds: 321,
      thumbnailUrl: null,
    })
  })

  it('persists a YouTube snapshot without inserting it into the local library', () => {
    const songsBefore = db.get<{ count: number }>('SELECT COUNT(*) AS count FROM songs')?.count

    Queue.add({ roomId: 4, song: resolvedYouTubeSong(), userId: 4 })
    const queue = Queue.get(4)
    const queued = queue.entities[queue.result[queue.result.length - 1]]

    expect(queued).toMatchObject({
      songId: null,
      source: 'YOUTUBE',
      externalId: 'AAAAAAAAAAA',
      mediaId: null,
      mediaType: 'youtube',
      title: 'External song',
      artistOrChannel: 'External channel',
      durationSeconds: 245,
    })
    expect(db.get<{ count: number }>('SELECT COUNT(*) AS count FROM songs')?.count).toBe(songsBefore)
  })

  it('rejects invalid or unplayable normalized songs', () => {
    expect(() => Queue.add({
      roomId: 1,
      song: { ...resolvedSong(1), mediaId: null },
      userId: 1,
    })).toThrow('La canción local debe tener un archivo multimedia válido')

    expect(() => Queue.add({
      roomId: 1,
      song: { ...resolvedSong(1), isPlayable: false },
      userId: 1,
    })).toThrow('La canción no se puede reproducir')
  })

  it('applies valid transitions idempotently and rejects terminal transitions', () => {
    const queueId = Queue.get(1).result[0]

    expect(Queue.transition(1, queueId, 'PLAYING')).toBe(false)
    expect(Queue.transition(1, queueId, 'PLAYED')).toBe(true)
    expect(Queue.transition(1, queueId, 'PLAYED')).toBe(false)
    expect(Queue.transition(1, queueId, 'APPROVED')).toBe(false)
  })

  it('syncs reported playback and safely recovers interrupted playback', () => {
    const queue = Queue.get(1)
    const currentId = queue.result.find(queueId => queue.entities[queueId].status === 'APPROVED') as number

    expect(Queue.syncPlayerLifecycle(1, { historyJSON: '[]', queueId: currentId, isErrored: false })).toBe(true)
    expect(Queue.get(1).entities[currentId].status).toBe('PLAYING')
    expect(Queue.requeuePlaying(1)).toBe(true)
    expect(Queue.get(1).entities[currentId].status).toBe('APPROVED')
    expect(db.get<{ status: string }>('SELECT status FROM queue WHERE roomId = 1 AND status = \'PLAYED\'')?.status).toBe('PLAYED')
  })

  it('soft-removes an item and closes the linked-list gap', () => {
    Queue.add({ roomId: 1, song: resolvedSong(3), userId: 1 })
    const before = Queue.get(1)
    const removedId = before.result[before.result.length - 2]
    const childId = before.result[before.result.length - 1]
    const expectedParentId = before.entities[removedId].prevQueueId

    Queue.remove(removedId, 1)

    const after = Queue.get(1)
    expect(after.result).not.toContain(removedId)
    expect(after.entities[childId].prevQueueId).toBe(expectedParentId)
    expect(db.get<{ status: string }>('SELECT status FROM queue WHERE queueId = ?', [removedId])?.status).toBe('REMOVED')
  })

  it('approves or rejects pending items without breaking playable order', () => {
    db.run('INSERT INTO rooms (roomId, name, status, data) VALUES (3, \'Moderation room\', \'open\', \'{}\')')
    db.run('INSERT INTO users (userId, username, password, name, roleId) VALUES (3, \'moderated\', \'\', \'Moderated\', 3)')
    Queue.add({ roomId: 3, song: resolvedSong(1), userId: 3, status: 'PENDING_APPROVAL' })
    Queue.add({ roomId: 3, song: resolvedSong(2), userId: 3, status: 'PENDING_APPROVAL' })
    Queue.add({ roomId: 3, song: resolvedSong(3), userId: 3, status: 'PENDING_APPROVAL' })
    const before = Queue.get(3)
    const [approvedId, rejectedId, remainingId] = before.result

    expect(Queue.moderate(3, approvedId, 'APPROVED')).toBe(true)
    expect(Queue.moderate(3, approvedId, 'APPROVED')).toBe(false)
    expect(Queue.moderate(3, rejectedId, 'REJECTED')).toBe(true)
    expect(Queue.moderate(3, rejectedId, 'REJECTED')).toBe(false)

    const after = Queue.get(3)
    expect(after.entities[approvedId].status).toBe('APPROVED')
    expect(after.entities[rejectedId].status).toBe('REJECTED')
    expect(after.entities[remainingId].prevQueueId).toBe(approvedId)
    expect(after.result.indexOf(rejectedId)).toBeGreaterThan(after.result.indexOf(remainingId))
    expect(() => Queue.moderate(3, approvedId, 'REJECTED')).toThrow('Solo se pueden aprobar o rechazar solicitudes pendientes')
  })
})

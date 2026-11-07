import { afterEach, beforeEach, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { db, open, close } from '../lib/Database.js'
import Playlists from './Playlists.js'
import Queue from '../Queue/Queue.js'
import Prefs from '../Prefs/Prefs.js'
import type { ResolvedSong } from '../../shared/songSource.js'

let directory: string
let playlistId: number
const song = (id: number): ResolvedSong => ({ source: 'YOUTUBE', sourceId: `fixture000${id}`, externalId: `fixture000${id}`, localSongId: null, mediaId: null, mediaType: 'youtube', title: `Song ${id}`, artistOrChannel: 'Artist', thumbnailUrl: null, durationSeconds: 5, isPlayable: true })
const configure = (patch = {}) => Playlists.configure(1, 1, { playlistId, enabled: true, repeat: true, ...patch })
const pending = () => db.all<{ queueId: number, title: string, status: string }>('SELECT queueId,title,status FROM queue WHERE roomId=1 AND status=\'APPROVED\' ORDER BY queueId')
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'house-playlists-test-'))
  open({ file: path.join(directory, 'db.sqlite'), ro: false })
  db.exec('INSERT INTO rooms(roomId,name,status,data) VALUES(1,\'Room\',\'open\',\'{}\'),(2,\'Other\',\'open\',\'{}\'); INSERT INTO users(userId,username,name,password,roleId) VALUES(1,\'admin\',\'Operator\',\'test\',1)')
  playlistId = Playlists.create(1, 'Daily music')
  for (const id of [1, 2, 3]) Playlists.addResolved(1, playlistId, song(id))
})
afterEach(() => {
  close()
  fs.rmSync(directory, { recursive: true, force: true })
})

it('keeps repertoire independent from the queue and prevents duplicate saved songs', () => {
  Playlists.addResolved(1, playlistId, song(1))
  expect(Playlists.get(1, playlistId).items).toHaveLength(3)
  expect(pending()).toHaveLength(0)
  expect(() => Playlists.get(2, playlistId)).toThrow('no pertenece')
  expect(() => Playlists.rename(1, playlistId, ' ')).toThrow()
  expect(() => Playlists.reorder(1, playlistId, [1, 1, 3])).toThrow()
  const ids = Playlists.get(1, playlistId).items.map(item => item.itemId).reverse()
  Playlists.reorder(1, playlistId, ids)
  expect(Playlists.get(1, playlistId).items.map(item => item.itemId)).toEqual(ids)
})

it('prepares one full cycle and waits for its last pending song before repeating', () => {
  configure()
  Playlists.reconcile(1)
  expect(pending().map(item => item.title)).toEqual(['Song 1', 'Song 2', 'Song 3'])
  for (let index = 0; index < 5; index++) Playlists.reconcile(1)
  expect(pending()).toHaveLength(3)
  let current = pending()[0].queueId
  Queue.transition(1, current, 'PLAYING')
  Playlists.reconcile(1)
  expect(pending().map(item => item.title)).toEqual(['Song 2', 'Song 3'])
  Queue.transition(1, current, 'PLAYED')
  current = pending()[0].queueId
  Queue.transition(1, current, 'PLAYING')
  Playlists.reconcile(1)
  expect(pending().map(item => item.title)).toEqual(['Song 3'])
  Queue.transition(1, current, 'PLAYED')
  Queue.transition(1, pending()[0].queueId, 'PLAYING')
  Playlists.reconcile(1)
  expect(pending().map(item => item.title)).toEqual(['Song 1', 'Song 2', 'Song 3'])
  for (let index = 0; index < 5; index++) Playlists.reconcile(1)
  expect(pending()).toHaveLength(3)
  expect(Playlists.get(1, playlistId).items).toHaveLength(3)
})

it('skips blocked repertoire without disabling the house list or reintroducing it on repeat', () => {
  Prefs.set('musicBlocking', { rules: [{ kind: 'resource', source: 'YOUTUBE', sourceId: song(2).sourceId }] })
  configure()
  Playlists.reconcile(1)
  expect(pending().map(item => item.title)).toEqual(['Song 1', 'Song 3'])
  for (const item of pending()) {
    Queue.transition(1, item.queueId, 'PLAYING')
    Queue.transition(1, item.queueId, 'PLAYED')
  }
  Playlists.reconcile(1)
  expect(pending().map(item => item.title)).toEqual(['Song 1', 'Song 3'])
  expect(Playlists.snapshot(1).playback).toMatchObject({ enabled: true, message: expect.stringContaining('política') })
})

it('restores selection and prepared queue after reopening the database', () => {
  configure()
  Playlists.reconcile(1)
  const ids = pending().map(item => item.queueId)
  close()
  open({ file: path.join(directory, 'db.sqlite'), ro: false })
  Playlists.reconcile(1)
  expect(Playlists.snapshot(1).playback).toMatchObject({ playlistId, enabled: true, repeat: true })
  expect(pending().map(item => item.queueId)).toEqual(ids)
})

it('stops replenishing at list end when repeat is off and restarts explicitly', () => {
  configure({ repeat: false })
  for (let index = 0; index < 4; index++) {
    Playlists.reconcile(1)
    for (const row of pending()) {
      Queue.transition(1, row.queueId, 'PLAYING')
      Queue.transition(1, row.queueId, 'PLAYED')
    }
  }
  expect(pending()).toHaveLength(0)
  expect(Playlists.snapshot(1).playback.message).toContain('hasta el final')
  configure({ repeat: false, restart: true })
  Playlists.reconcile(1)
  expect(pending()[0].title).toBe('Song 1')
})

it('disabling preserves the playing song and manual requests; resuming does not skip prepared tracks', () => {
  configure()
  Playlists.reconcile(1)
  const playing = pending()[0].queueId
  Queue.transition(1, playing, 'PLAYING')
  Playlists.reconcile(1)
  Queue.add({ roomId: 1, userId: 1, song: song(4), origin: 'HOUSE' })
  configure({ enabled: false })
  expect(pending().map(item => item.title)).toEqual(['Song 4'])
  expect(db.get<{ status: string }>('SELECT status FROM queue WHERE queueId=?', [playing])?.status).toBe('PLAYING')
  configure()
  Playlists.reconcile(1)
  expect(pending().map(item => item.title)).toEqual(['Song 4', 'Song 2', 'Song 3'])
})

it('skips failed tracks without retry loops and allows explicit retry', () => {
  configure()
  for (let index = 0; index < 4; index++) {
    Playlists.reconcile(1)
    for (const row of pending()) Queue.transition(1, row.queueId, 'FAILED')
  }
  expect(pending()).toHaveLength(0)
  expect(Playlists.snapshot(1).playback.skipped).toHaveLength(3)
  expect(Playlists.snapshot(1).playback.message).toContain('Todas las canciones fallaron')
  configure({ restart: true })
  Playlists.reconcile(1)
  expect(pending()).toHaveLength(3)
})

it('deleting the selected playlist stops future music but retains current/history snapshots', () => {
  configure()
  Playlists.reconcile(1)
  const id = pending()[0].queueId
  Queue.transition(1, id, 'PLAYING')
  Playlists.remove(1, playlistId)
  expect(pending()).toHaveLength(0)
  expect(Playlists.snapshot(1).playback).toMatchObject({ enabled: false, playlistId: null })
  expect(db.get<{ title: string }>('SELECT title FROM queue WHERE queueId=?', [id])?.title).toBe('Song 1')
})

it('rolls back both queue insertion and cursor when materialization fails', () => {
  configure()
  db.exec('CREATE TRIGGER fail_house_insert BEFORE INSERT ON queue WHEN NEW.title=\'Song 2\' BEGIN SELECT RAISE(ABORT,\'fixture failure\'); END')
  expect(() => Playlists.reconcile(1)).toThrow('fixture failure')
  expect(pending()).toHaveLength(0)
  expect(db.get<{ cursor: number }>('SELECT cursor FROM housePlayback WHERE roomId=1')?.cursor).toBe(0)
})

it('switches lists without touching current music or manual house songs', () => {
  configure()
  Playlists.reconcile(1)
  const playing = pending()[0].queueId
  Queue.transition(1, playing, 'PLAYING')
  Queue.add({ roomId: 1, userId: 1, song: song(4), origin: 'HOUSE' })
  const next = Playlists.create(1, 'Second list')
  Playlists.addResolved(1, next, song(5))
  configure({ playlistId: next })
  Playlists.reconcile(1)
  expect(db.get<{ status: string }>('SELECT status FROM queue WHERE queueId=?', [playing])?.status).toBe('PLAYING')
  expect(pending().map(item => item.title)).toEqual(['Song 4', 'Song 5'])
  expect(Playlists.snapshot(2).playback.enabled).toBe(false)
})

it('discards prepared copies of a failed one-song loop instead of repeatedly playing them', () => {
  const single = Playlists.create(1, 'Single')
  Playlists.addResolved(1, single, song(1))
  configure({ playlistId: single })
  Playlists.reconcile(1)
  expect(pending()).toHaveLength(1)
  const current = pending()[0].queueId
  Queue.transition(1, current, 'PLAYING')
  Playlists.reconcile(1)
  expect(pending()).toHaveLength(1)
  Queue.transition(1, current, 'FAILED')
  Playlists.reconcile(1)
  expect(pending()).toHaveLength(0)
  for (let index = 0; index < 3; index++) Playlists.reconcile(1)
  expect(db.get<{ count: number }>('SELECT count(*) count FROM queue WHERE status=\'FAILED\'')?.count).toBe(1)
})

it.each([0, 1, 2, 10])('queues all five tracks regardless of the interleave setting %i', (interleave) => {
  db.run('UPDATE rooms SET data=json_set(data,\'$.prefs.queue.houseTracksBeforeParticipant\',?) WHERE roomId=1', [interleave])
  for (const id of [4, 5]) Playlists.addResolved(1, playlistId, song(id))
  configure()
  Playlists.reconcile(1)
  expect(pending().map(item => item.title)).toEqual(['Song 1', 'Song 2', 'Song 3', 'Song 4', 'Song 5'])
  for (let index = 0; index < 5; index++) Playlists.reconcile(1)
  expect(pending()).toHaveLength(5)
})

it('extends an already-active two-song window without resetting its run or duplicating entries', () => {
  for (const id of [4, 5]) Playlists.addResolved(1, playlistId, song(id))
  configure()
  const { runId } = db.get<{ runId: string }>('SELECT runId FROM housePlayback WHERE roomId=1')!
  const items = Playlists.get(1, playlistId).items
  for (const item of items.slice(0, 2)) Queue.add({ roomId: 1, userId: 1, song: item.song, origin: 'HOUSE', playlistItemId: item.itemId, houseRunId: runId })
  db.run('UPDATE housePlayback SET cursor=2 WHERE roomId=1')
  const originalIds = pending().map(item => item.queueId)
  Playlists.reconcile(1)
  expect(pending().map(item => item.title)).toEqual(items.map(item => item.song.title))
  expect(pending().slice(0, 2).map(item => item.queueId)).toEqual(originalIds)
  expect(db.get<{ runId: string }>('SELECT runId FROM housePlayback WHERE roomId=1')?.runId).toBe(runId)
  expect(Playlists.reconcile(1)).toBe(false)
})

it('completes a legacy window spanning two cycles without duplicating a still-pending track', () => {
  for (const id of [4, 5]) Playlists.addResolved(1, playlistId, song(id))
  configure()
  const { runId } = db.get<{ runId: string }>('SELECT runId FROM housePlayback WHERE roomId=1')!
  const items = Playlists.get(1, playlistId).items
  for (const item of [items[4], items[0]]) Queue.add({ roomId: 1, userId: 1, song: item.song, origin: 'HOUSE', playlistItemId: item.itemId, houseRunId: runId })
  db.run('UPDATE housePlayback SET cursor=1 WHERE roomId=1')
  Playlists.reconcile(1)
  expect(pending().map(item => item.title)).toEqual(['Song 5', 'Song 1', 'Song 2', 'Song 3', 'Song 4'])
  Queue.transition(1, pending()[0].queueId, 'PLAYING')
  Playlists.reconcile(1)
  expect(pending().map(item => item.title)).toEqual(['Song 1', 'Song 2', 'Song 3', 'Song 4', 'Song 5'])
})

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { db, open, close } from '../lib/Database.js'
import Queue from './Queue.js'
import { cleanupQueue, cleanupReceipt } from './cleanup.js'
import Playlists from '../Playlists/Playlists.js'
import Rooms from '../Rooms/Rooms.js'
import handlers from './socket.js'
import { youtubeSongSource } from '../SongSources/YouTubeSongSource.js'
import { QUEUE_ADD, QUEUE_CLEANUP, QUEUE_PUSH, PLAYER_CMD_STOP } from '../../shared/actionTypes.js'
import { isQueueHistoryHidden, type QueueCleanupRequest } from '../../shared/queueCleanup.js'
import type { ResolvedSong } from '../../shared/songSource.js'
import { buildRoundRobinQueue } from '../../src/routes/Queue/selectors/roundRobin.js'
import { normalizeQueuePrefs } from '../../shared/queueRules.js'

let directory: string
const song: ResolvedSong = { source: 'YOUTUBE', sourceId: 'fixture0001', externalId: 'fixture0001', localSongId: null, mediaId: null, mediaType: 'youtube', title: 'Test song', artistOrChannel: 'Artist', thumbnailUrl: null, durationSeconds: 4, isPlayable: true }
const request = (operation: QueueCleanupRequest['operation'] = 'pending'): QueueCleanupRequest => ({ operation, requestId: crypto.randomUUID(), throughQueueId: db.get<{ id: number }>('SELECT COALESCE(MAX(queueId),0) id FROM queue')!.id, expiresAt: Date.now() + 15000 })
const enqueue = (roomId = 1, origin: 'PARTICIPANT' | 'HOUSE' | 'OPERATOR' = 'PARTICIPANT', status: 'APPROVED' | 'PENDING_APPROVAL' = 'APPROVED') => {
  const requestId = crypto.randomUUID()
  Queue.add({ roomId, userId: 1, song, origin, status, requestId })
  return Queue.getRequest(roomId, 1, requestId)!.queueId
}
const status = (id: number) => db.get<{ status: string }>('SELECT status FROM queue WHERE queueId=?', [id])?.status
const socket = (roomId = 1, isAdmin = true, playerStatus: object | null = null) => {
  const emit = vi.fn()
  const sockets = new Map([['player', { user: { roomId }, _isPlayerAuthoritative: true, _lastPlayerStatus: playerStatus }]])
  return { user: { roomId, userId: 1, isAdmin }, server: { of: () => ({ sockets }), to: vi.fn(() => ({ emit })) }, emit }
}
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-cleanup-test-'))
  open({ file: path.join(directory, 'db.sqlite'), ro: false })
  db.exec('INSERT INTO rooms(roomId,name,status,data) VALUES(1,\'Room\',\'open\',\'{}\'),(2,\'Other\',\'open\',\'{}\'); INSERT INTO users(userId,username,name,password,roleId) VALUES(1,\'admin\',\'Operator\',\'test\',1)')
})
afterEach(() => {
  vi.restoreAllMocks()
  close()
  fs.rmSync(directory, { recursive: true, force: true })
})

it('clears current, pending and visible history atomically, stops house refill and preserves saved lists and another room', () => {
  const played = enqueue()
  Queue.transition(1, played, 'PLAYING')
  Queue.transition(1, played, 'PLAYED')
  const current = enqueue()
  Queue.transition(1, current, 'PLAYING')
  const pending = [enqueue(), enqueue(1, 'PARTICIPANT', 'PENDING_APPROVAL'), enqueue(1, 'HOUSE'), enqueue(1, 'OPERATOR')]
  const other = enqueue(2)
  const listId = Playlists.create(1, 'Daily')
  Playlists.addResolved(1, listId, song)
  Playlists.configure(1, 1, { playlistId: listId, enabled: true, repeat: true })
  Playlists.reconcile(1)
  const generated = db.all<{ queueId: number }>('SELECT queueId FROM queue WHERE houseRunId IS NOT NULL').map(row => row.queueId)
  const input = request()
  const result = cleanupQueue(1, 1, input, current)
  expect(result).toMatchObject({ changedCount: pending.length + generated.length + 2, houseStopped: true })
  for (const id of [...pending, ...generated]) expect(status(id)).toBe('REMOVED')
  expect(status(current)).toBe('REMOVED')
  expect(status(played)).toBe('PLAYED')
  expect(status(other)).toBe('APPROVED')
  expect(Playlists.snapshot(1).playback.enabled).toBe(false)
  expect(Playlists.get(1, listId).items).toHaveLength(1)
  expect(Playlists.reconcile(1)).toBe(false)
  const cleared = Queue.get(1)
  expect(cleared.result.filter(id => !isQueueHistoryHidden(cleared.entities[id]))).toEqual([])
  expect(Queue.countPending(1, 1)).toBe(0)
  expect(db.all('PRAGMA foreign_key_check')).toHaveLength(0)
  Queue.syncPlayerLifecycle(1, { queueId: current, historyJSON: JSON.stringify(pending) })
  expect(status(current)).toBe('REMOVED')
  expect(pending.map(status)).toEqual(pending.map(() => 'REMOVED'))
})

it.each([true, false])('clears every request present at execution and stops current playback when isPlaying=%s', (isPlaying) => {
  const current = enqueue()
  const old = enqueue()
  const input = request()
  const newer = enqueue()
  const actor = socket(1, true, { queueId: current, isAtQueueEnd: false, isPlaying, position: 42 })
  const ack = vi.fn()
  handlers[QUEUE_CLEANUP](actor, { payload: { ...input, confirmed: true, roomId: 2 } }, ack)
  expect(status(current)).toBe('REMOVED')
  expect(status(old)).toBe('REMOVED')
  expect(status(newer)).toBe('REMOVED')
  expect(ack.mock.calls[0][0].payload.result.changedCount).toBe(3)
  expect(actor.emit).toHaveBeenCalledWith('action', { type: PLAYER_CMD_STOP })
  expect(Rooms.getPlayerStatus(actor.server, 1)).toMatchObject({ queueId: -1, isAtQueueEnd: true, isPlaying: false, position: 0 })
  expect(actor.server.to).toHaveBeenCalledWith(Rooms.prefix(1))
  expect(actor.emit).toHaveBeenCalledWith('action', { type: QUEUE_PUSH, payload: Queue.get(1) })
})

it('receipt recovery never repeats STOP against a subsequent playback', () => {
  enqueue()
  const input = request()
  const actor = socket()
  const ack = vi.fn()
  handlers[QUEUE_CLEANUP](actor, { payload: { ...input, confirmed: true } }, ack)
  const later = enqueue()
  Queue.transition(1, later, 'PLAYING')
  actor.emit.mockClear()
  handlers[QUEUE_CLEANUP](actor, { payload: { ...input, confirmed: true } }, ack)
  handlers[QUEUE_CLEANUP](actor, { payload: { ...input, checkOnly: true } }, ack)
  expect(actor.emit).not.toHaveBeenCalledWith('action', { type: PLAYER_CMD_STOP })
  expect(status(later)).toBe('PLAYING')
})

it('retains receipts and fairness while hiding terminal history, including after restart and late player reports', () => {
  const played = enqueue()
  const failed = enqueue()
  const rejected = enqueue(1, 'PARTICIPANT', 'PENDING_APPROVAL')
  const current = enqueue()
  const upcoming = enqueue()
  Queue.transition(1, played, 'PLAYING')
  Queue.transition(1, played, 'PLAYED')
  Queue.transition(1, failed, 'FAILED')
  Queue.moderate(1, rejected, 'REJECTED')
  Queue.transition(1, current, 'PLAYING')
  const other = enqueue(2)
  Queue.transition(2, other, 'FAILED')
  const before = Queue.get(1)
  const order = buildRoundRobinQueue(before.result, before.entities, [played, failed], current, null, normalizeQueuePrefs({})).result
  expect(cleanupQueue(1, 1, request('history'), current).changedCount).toBe(3)
  close()
  open({ file: path.join(directory, 'db.sqlite'), ro: false })
  Queue.syncPlayerLifecycle(1, { queueId: current, historyJSON: JSON.stringify([played, failed]) })
  const after = Queue.get(1)
  expect(after.result.filter(id => !isQueueHistoryHidden(after.entities[id]))).toEqual([current, upcoming])
  expect(buildRoundRobinQueue(after.result, after.entities, [played, failed], current, null, normalizeQueuePrefs({})).result).toEqual(order)
  expect(isQueueHistoryHidden(Queue.get(2).entities[other])).toBe(false)
  expect(Queue.cleanupGeneration(1)).toBe(0)
  const stored = db.get<{ requestId: string }>('SELECT requestId FROM queue WHERE queueId=?', [played])!
  expect(Queue.getRequest(1, 1, stored.requestId)?.queueId).toBe(played)
  expect(status(failed)).toBe('FAILED')
})

it('history cleanup does not erase failed-list quarantine or restart replenishment', () => {
  const id = Playlists.create(1, 'Failing list')
  Playlists.addResolved(1, id, song)
  Playlists.configure(1, 1, { playlistId: id, enabled: true, repeat: true })
  Playlists.reconcile(1)
  for (const row of db.all<{ queueId: number }>('SELECT queueId FROM queue')) Queue.transition(1, row.queueId, 'FAILED')
  Playlists.reconcile(1)
  cleanupQueue(1, 1, request('history'))
  expect(Playlists.reconcile(1)).toBe(false)
  expect(Playlists.snapshot(1).playback.skipped).toHaveLength(1)
})

it('retries return the original receipt without clearing new songs or stopping a reactivated list', () => {
  enqueue()
  const input = request()
  const result = cleanupQueue(1, 1, input)
  const newer = enqueue()
  const list = Playlists.create(1, 'New selection')
  Playlists.addResolved(1, list, song)
  Playlists.configure(1, 1, { playlistId: list, enabled: true, repeat: true })
  expect(cleanupQueue(1, 1, { ...input, expiresAt: 0 })).toEqual(result)
  expect(cleanupReceipt(1, 1, input)).toEqual(result)
  expect(status(newer)).toBe('APPROVED')
  expect(Playlists.snapshot(1).playback.enabled).toBe(true)
  expect(Queue.cleanupGeneration(1)).toBe(1)
  expect(() => cleanupReceipt(1, 2, input)).toThrow('otra operación')
})

it('check-only requests never execute a missing operation, and non-admin or expired operations are rejected', () => {
  const id = enqueue()
  const input = request()
  const ack = vi.fn()
  handlers[QUEUE_CLEANUP](socket(), { payload: { ...input, checkOnly: true } }, ack)
  expect(ack.mock.calls[0][0].payload.found).toBe(false)
  handlers[QUEUE_CLEANUP](socket(1, false), { payload: { ...input, confirmed: true } }, ack)
  expect(ack.mock.calls.at(-1)?.[0].error).toContain('personal del local')
  handlers[QUEUE_CLEANUP](socket(), { payload: { ...input, confirmed: true, expiresAt: Date.now() - 1 } }, ack)
  expect(ack.mock.calls.at(-1)?.[0].error).toContain('venció')
  handlers[QUEUE_CLEANUP](socket(), { payload: { ...input, confirmed: false } }, ack)
  expect(ack.mock.calls.at(-1)?.[0].error).toContain('Confirma')
  expect(status(id)).toBe('APPROVED')
  expect(Queue.cleanupGeneration(1)).toBe(0)
})

it('rolls back removals, house selection, generation and receipt if any step fails', () => {
  const first = enqueue()
  const second = enqueue()
  const list = Playlists.create(1, 'Daily')
  Playlists.addResolved(1, list, song)
  Playlists.configure(1, 1, { playlistId: list, enabled: true, repeat: true })
  const input = request()
  db.exec(`CREATE TRIGGER abort_cleanup BEFORE UPDATE OF status ON queue WHEN NEW.queueId=${second} AND NEW.status='REMOVED' BEGIN SELECT RAISE(ABORT,'fixture failure'); END`)
  expect(() => cleanupQueue(1, 1, input)).toThrow('fixture failure')
  expect(status(first)).toBe('APPROVED')
  expect(status(second)).toBe('APPROVED')
  expect(Playlists.snapshot(1).playback.enabled).toBe(true)
  expect(Queue.cleanupGeneration(1)).toBe(0)
  expect(cleanupReceipt(1, 1, input)).toBeNull()
})

it('rejects asynchronous song resolutions that started before the queue was emptied', async () => {
  let finishResolution!: (song: ResolvedSong) => void
  vi.spyOn(youtubeSongSource, 'resolve').mockImplementation(() => new Promise((resolve) => {
    finishResolution = resolve
  }))
  const ack = vi.fn()
  const adding = handlers[QUEUE_ADD](socket(), { payload: { source: 'YOUTUBE', sourceId: song.sourceId, requestId: crypto.randomUUID() } }, ack)
  await vi.waitFor(() => expect(youtubeSongSource.resolve).toHaveBeenCalledOnce())
  cleanupQueue(1, 1, request())
  finishResolution(song)
  await adding
  expect(ack.mock.calls[0][0].error).toContain('La cola se vació')
  expect(Queue.get(1).result).toHaveLength(0)
})

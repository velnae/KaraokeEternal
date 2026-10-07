import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { open, close, db } from '../lib/Database.js'
import { QUEUE_ADD, QUEUE_REMOVE } from '../../shared/actionTypes.js'
import { youtubeSongSource } from '../SongSources/YouTubeSongSource.js'
import type { ResolvedSong } from '../../shared/songSource.js'
import handlers from './socket.js'
import Queue from './Queue.js'

const song: ResolvedSong = {
  source: 'YOUTUBE', sourceId: 'AAAAAAAAAAA', externalId: 'AAAAAAAAAAA', localSongId: null,
  mediaId: null, mediaType: 'youtube', title: 'Karaoke', artistOrChannel: 'Channel',
  durationSeconds: 180, thumbnailUrl: null, isPlayable: true,
}

describe('durable participant request receipts', () => {
  let dir: string
  const socket = { user: { userId: 1, roomId: 1, isAdmin: false }, server: { to: () => ({ emit: vi.fn() }) } }
  const request = (id: string, sourceId = song.sourceId) => ({ payload: { source: 'YOUTUBE', sourceId, requestId: id } })
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-receipts-'))
    open({ file: path.join(dir, 'database.sqlite3'), ro: false })
    db.run(`INSERT INTO rooms (roomId, name, status, data) VALUES (1, 'Test', 'open', '{"prefs":{"queue":{"maxPendingPerParticipant":1,"approvalMode":"MANUAL"}}}')`)
    db.run(`INSERT INTO users (userId, username, password, name, roleId) VALUES (1, 'test', '', 'Test', 3), (2, 'other', '', 'Other', 3)`)
    vi.spyOn(youtubeSongSource, 'resolve').mockResolvedValue(song)
  })
  afterEach(() => {
    close()
    fs.rmSync(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('confirms the stored status and recovers the same receipt after restart at the limit', async () => {
    const ack = vi.fn()
    await handlers[QUEUE_ADD](socket, request('request-0000000001'), ack)
    const receipt = ack.mock.calls[0][0].payload
    expect(receipt.status).toBe('PENDING_APPROVAL')
    expect(receipt.queue.result).toEqual([receipt.queueId])
    close()
    open({ file: path.join(dir, 'database.sqlite3'), ro: false })
    await handlers[QUEUE_ADD](socket, request('request-0000000001'), ack)
    expect(ack.mock.calls[1][0].payload.queueId).toBe(receipt.queueId)
    expect(youtubeSongSource.resolve).toHaveBeenCalledOnce()
    expect(Queue.countPending(1, 1)).toBe(1)
  })

  it('never recreates a cancelled request when the original acknowledgment was lost', async () => {
    await handlers[QUEUE_ADD](socket, request('request-0000000001'), vi.fn())
    Queue.remove(Queue.getRequest(1, 1, 'request-0000000001').queueId, 1)
    const ack = vi.fn()
    await handlers[QUEUE_ADD](socket, request('request-0000000001'), ack)
    expect(ack.mock.calls[0][0].payload.status).toBe('REMOVED')
    expect(Queue.get(1).result).toHaveLength(0)
  })

  it('deduplicates simultaneous retries after resolution', async () => {
    const ack = vi.fn()
    await Promise.all([1, 2].map(() => handlers[QUEUE_ADD](socket, request('request-0000000001'), ack)))
    expect(Queue.get(1).result).toHaveLength(1)
    expect(ack.mock.calls.map(([reply]) => reply.payload.queueId)).toEqual([1, 1])
  })

  it('rechecks the last available slot after concurrent video resolution', async () => {
    const ack = vi.fn()
    await Promise.all(['request-0000000001', 'request-0000000002'].map(id => handlers[QUEUE_ADD](socket, request(id), ack)))
    expect(Queue.get(1).result).toHaveLength(1)
    expect(ack.mock.calls.filter(([reply]) => !!reply.error)).toHaveLength(1)
  })

  it('scopes receipts to the participant and rejects reuse for a different video', async () => {
    await handlers[QUEUE_ADD](socket, request('request-0000000001'), vi.fn())
    const ack = vi.fn()
    await handlers[QUEUE_ADD](socket, request('request-0000000001', 'BBBBBBBBBBB'), ack)
    expect(ack.mock.calls[0][0].error).toBe('El identificador ya pertenece a otro pedido')
    await handlers[QUEUE_ADD]({ ...socket, user: { ...socket.user, userId: 2 } }, request('request-0000000001'), vi.fn())
    expect(Queue.get(1).result).toHaveLength(2)
  })

  it('does not confirm cancellation when playback has already started', async () => {
    await handlers[QUEUE_ADD](socket, request('request-0000000001'), vi.fn())
    const { queueId } = Queue.getRequest(1, 1, 'request-0000000001')
    Queue.moderate(1, queueId, 'APPROVED')
    Queue.transition(1, queueId, 'PLAYING')
    const ack = vi.fn()
    handlers[QUEUE_REMOVE](socket, { payload: { queueId, withReceipt: true } }, ack)
    expect(ack.mock.calls[0][0].error).toBeTruthy()
    expect(Queue.get(1).entities[queueId].status).toBe('PLAYING')
  })
})

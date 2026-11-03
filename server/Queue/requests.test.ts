import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { open, close, db } from '../lib/Database.js'
import { QUEUE_ADD, QUEUE_REMOVE } from '../../shared/actionTypes.js'
import { createYouTubeSongSource, youtubeSongSource } from '../SongSources/YouTubeSongSource.js'
import type { ResolvedSong } from '../../shared/songSource.js'
import handlers from './socket.js'
import Queue from './Queue.js'
import Rooms from '../Rooms/Rooms.js'
import Greetings from '../Greetings/Greetings.js'

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
    vi.spyOn(Rooms, 'getPlayerStatus').mockReturnValue(null)
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

  it('atomically stores one attributed greeting and returns it on duplicate delivery', async () => {
    const action = { payload: { ...request('request-greeting-01').payload, greeting: { recipient: 'Rocío', message: 'Feliz cumpleaños' } } }
    const ack = vi.fn()
    await Promise.all([handlers[QUEUE_ADD](socket, action, ack), handlers[QUEUE_ADD](socket, action, ack)])
    expect(ack.mock.calls.map(([reply]) => reply.payload.greetingId)).toEqual([1, 1])
    expect(Greetings.items(1)).toMatchObject([{ sender: 'Test', tableLabel: null, recipient: 'Rocío', status: 'QUEUED' }])
    expect(Queue.countPending(1, 1)).toBe(1)
  })

  it('persists explicit singing intent and returns the original intent on an idempotent retry', async () => {
    const original = { payload: { ...request('request-intent-01').payload, requestIntent: 'SING' } }
    const ack = vi.fn()
    await handlers[QUEUE_ADD](socket, original, ack)
    await handlers[QUEUE_ADD](socket, { payload: { ...original.payload, requestIntent: 'LISTEN' } }, ack)
    expect(ack.mock.calls.map(([reply]) => reply.payload.requestIntent)).toEqual(['SING', 'SING'])
    expect(Queue.get(1).entities[1]).toMatchObject({ requestIntent: 'SING', userDisplayName: 'Test' })
    expect(Queue.countPending(1, 1)).toBe(1)
  })

  it('does not infer karaoke from a video title and rejects invalid intent without inserting a request', async () => {
    await expect(handlers[QUEUE_ADD](socket, { payload: { ...request('request-intent-01').payload, requestIntent: 'AUTO_DETECT' } }, vi.fn())).rejects.toThrow('Elija')
    expect(Queue.get(1).result).toHaveLength(0)
    const ack = vi.fn()
    await handlers[QUEUE_ADD](socket, request('request-intent-01'), ack)
    expect(Queue.get(1).entities[1]).toMatchObject({ title: 'Karaoke', requestIntent: 'UNKNOWN' })
  })

  it.each([420, 421])('revalidates the duration at enqueue, even without a prior search (%i seconds)', async (duration) => {
    const source = createYouTubeSongSource({ apiKey: 'test', fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [{
      id: song.sourceId,
      snippet: { title: 'Song', channelTitle: 'Singer', categoryId: '10', liveBroadcastContent: 'none' },
      contentDetails: { duration: `PT${duration}S` },
      status: { embeddable: true, privacyStatus: 'public', uploadStatus: 'processed' },
    }] }))) })
    vi.mocked(youtubeSongSource.resolve).mockImplementation(source.resolve)
    const ack = vi.fn()
    await handlers[QUEUE_ADD](socket, { payload: { ...request('duration-request-01').payload, requestIntent: 'SING' } }, ack)
    if (duration === 420) {
      expect(ack.mock.calls[0][0].payload.requestIntent).toBe('SING')
      expect(Queue.countPending(1, 1)).toBe(1)
    } else {
      expect(ack.mock.calls[0][0].error).toContain('7 minutos')
      expect(Queue.get(1).result).toHaveLength(0)
      expect(Queue.getRequest(1, 1, 'duration-request-01')).toBeUndefined()
    }
  })

  it('rolls back an invalid greeting without leaving a partially accepted music request', async () => {
    const action = { payload: { ...request('request-greeting-01').payload, greeting: { recipient: '', message: '' } } }
    await expect(handlers[QUEUE_ADD](socket, action, vi.fn())).rejects.toThrow('mensaje')
    expect(Queue.get(1).result).toHaveLength(0)
    expect(Greetings.items(1)).toHaveLength(0)
    const ack = vi.fn()
    await handlers[QUEUE_ADD](socket, request('request-greeting-01'), ack)
    expect(ack.mock.calls[0][0].payload.status).toBe('PENDING_APPROVAL')
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

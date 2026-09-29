import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { initLogger } from '../lib/Log.js'
import Queue from '../Queue/Queue.js'
import ACTION_HANDLERS from './socket.js'
import { PLAYER_EMIT_FAILURE, QUEUE_PUSH } from '../../shared/actionTypes.js'

afterEach(() => vi.restoreAllMocks())

it('writes one safe accepted failure to the configured server file transport', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'karaoke-failure-log-'))
  try {
    const logger = initLogger('server', { console: { level: 0 }, file: { level: 3 } })
    const productionPath = logger.transports.file.getFile().path
    expect(path.basename(productionPath)).toBe('server.log')
    console.info('Configured server file path:', productionPath)
    logger.transports.file.resolvePathFn = () => path.join(dir, 'server.log')
    expect(logger.transports.file.level).toBe('info')

    vi.spyOn(Queue, 'transition').mockReturnValueOnce(true).mockReturnValueOnce(false)
    const queue = { result: [4], entities: {
      4: { source: 'YOUTUBE', externalId: 'abcdefghijk' },
    } } as unknown as ReturnType<typeof Queue.get>
    vi.spyOn(Queue, 'get').mockReturnValue(queue)
    const emit = vi.fn()
    const sock = {
      id: 'test-player',
      user: { roomId: 1, isAdmin: true },
      _isPlayerAuthoritative: true,
      server: { to: () => ({ emit }), of: () => ({ sockets: new Map() }) },
    }
    const action = { payload: {
      queueId: 4, category: 'iframe', code: 153,
      error: 'NEVER_LOG_THIS\nhttps://example.invalid/secret',
      videoId: 'forged-client-id',
    } }
    ACTION_HANDLERS[PLAYER_EMIT_FAILURE](sock, action, vi.fn())
    ACTION_HANDLERS[PLAYER_EMIT_FAILURE](sock, action, vi.fn())

    const lines = readFileSync(path.join(dir, 'server.log'), 'utf8').split('\n')
      .filter(line => line.includes('Playback failure '))
    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0].split('Playback failure ')[1])
    expect(record).toMatchObject({
      roomId: 1, queueId: 4, source: 'YOUTUBE', videoId: 'abcdefghijk',
      category: 'iframe', code: 153, message: 'YouTube playback failed',
      timestamp: expect.any(String),
    })
    expect(Number.isNaN(Date.parse(record.timestamp))).toBe(false)
    expect(lines[0]).not.toMatch(/NEVER_LOG_THIS|https:|forged-client-id/)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('action', { type: QUEUE_PUSH, payload: queue })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

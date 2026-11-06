import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ACTION_HANDLERS from './socket.js'
import Animation from '../Animation/Animation.js'
import Queue from '../Queue/Queue.js'
import { PLAYER_CMD_CLOSE, PLAYER_EMIT_LEAVE, PLAYER_LEAVE, PLAYER_REQ_CLOSE } from '../../shared/actionTypes.js'
import { PLAYER_WINDOW_REQUEST_MS } from '../../shared/playerWindow.js'

vi.mock('../Animation/Animation.js', () => ({ default: { cancel: vi.fn(), disconnect: vi.fn() } }))
vi.mock('../Queue/Queue.js', () => ({ default: { requeuePlaying: vi.fn(() => true), get: vi.fn(() => ({})) } }))
const handle = ACTION_HANDLERS[PLAYER_REQ_CLOSE]
const action = () => ({ payload: { expiresAt: Date.now() + PLAYER_WINDOW_REQUEST_MS, roomId: 99 } })

function setup () {
  const emitWithAck = vi.fn().mockResolvedValue({ status: 'closing' })
  const broadcast = vi.fn()
  const sockets = new Map()
  const server = { of: () => ({ sockets }), to: vi.fn(() => ({ emit: broadcast })) }
  const player = Object.assign(new EventEmitter(), {
    id: 'player', connected: true, user: { roomId: 1, isAdmin: true }, server,
    _isPlayerAuthoritative: true, _lastPlayerStatus: {}, timeout: vi.fn(() => ({ emitWithAck })),
  })
  // Model the socket action dispatcher: normal LEAVE performs actual cleanup.
  player.on('action', (action) => {
    if (action.type === PLAYER_EMIT_LEAVE) ACTION_HANDLERS[PLAYER_EMIT_LEAVE](player, action, vi.fn())
  })
  sockets.set('other-room', { ...player, user: { roomId: 99, isAdmin: true }, timeout: vi.fn() })
  sockets.set('standby', { ...player, _isPlayerAuthoritative: false, timeout: vi.fn() })
  sockets.set(player.id, player)
  const admin = { connected: true, user: { roomId: 1, isAdmin: true }, server }
  return { player, admin, emitWithAck, broadcast, acknowledge: vi.fn(), sockets }
}

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('remote player close', () => {
  it('waits for normal LEAVE rather than treating command acceptance as success', async () => {
    const { player, admin, emitWithAck, acknowledge, broadcast } = setup()
    const pending = handle(admin, action(), acknowledge)
    await Promise.resolve()
    expect(emitWithAck).toHaveBeenCalledWith('action', expect.objectContaining({
      type: PLAYER_CMD_CLOSE, payload: expect.objectContaining({ roomId: 1, playerSocketId: 'player' }),
    }))
    expect(acknowledge).not.toHaveBeenCalled()
    expect(Animation.cancel).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalled()
    player.emit('action', { type: PLAYER_EMIT_LEAVE })
    await pending
    expect(acknowledge).toHaveBeenCalledWith(expect.objectContaining({ payload: { status: 'closed' } }))
    expect(Queue.requeuePlaying).toHaveBeenCalledWith(1)
    expect(Animation.disconnect).toHaveBeenCalledWith(1, 'player')
    expect(broadcast).toHaveBeenCalledWith('action', { type: PLAYER_LEAVE, payload: { socketId: 'player' } })
    expect(player.listenerCount('action')).toBe(1)
    expect(player.listenerCount('disconnect')).toBe(0)
  })

  it('accepts a confirmed disconnect even if closing the window loses its ACK', async () => {
    const { player, admin, emitWithAck, acknowledge } = setup()
    emitWithAck.mockImplementationOnce(() => new Promise(() => {}))
    const pending = handle(admin, action(), acknowledge)
    player._isPlayerAuthoritative = false
    player.connected = false
    player.emit('disconnect', 'transport close')
    await pending
    expect(acknowledge).toHaveBeenCalledWith(expect.objectContaining({ payload: { status: 'closed' } }))
    expect(player.listenerCount('disconnect')).toBe(0)
  })

  it('times out and removes listeners if the player accepts but never leaves', async () => {
    vi.useFakeTimers()
    const { player, admin, acknowledge } = setup()
    const pending = handle(admin, action(), acknowledge)
    await vi.advanceTimersByTimeAsync(PLAYER_WINDOW_REQUEST_MS)
    await pending
    expect(acknowledge).toHaveBeenCalledWith(expect.objectContaining({ payload: { status: 'timeout' } }))
    expect(player._isPlayerAuthoritative).toBe(true)
    expect(player.listenerCount('action')).toBe(1)
    expect(player.listenerCount('disconnect')).toBe(0)
  })

  it('rejects a claimed close without a lifecycle departure', async () => {
    const { player, admin, emitWithAck, acknowledge } = setup()
    emitWithAck.mockResolvedValueOnce({ status: 'closed' })
    await handle(admin, action(), acknowledge)
    expect(acknowledge).toHaveBeenCalledWith(expect.objectContaining({ payload: { status: 'rejected' } }))
    expect(player._isPlayerAuthoritative).toBe(true)
    expect(player.listenerCount('disconnect')).toBe(0)
  })

  it('rejects participants and missing players without touching other rooms or standby tabs', async () => {
    const { player, admin, emitWithAck, acknowledge, sockets } = setup()
    admin.user.isAdmin = false
    await handle(admin, action(), acknowledge)
    expect(acknowledge).toHaveBeenLastCalledWith(expect.objectContaining({ error: expect.any(String) }))
    admin.user.isAdmin = true
    sockets.delete(player.id)
    await handle(admin, action(), acknowledge)
    expect(acknowledge).toHaveBeenLastCalledWith(expect.objectContaining({ payload: { status: 'no-player' } }))
    expect(emitWithAck).not.toHaveBeenCalled()
    for (const socket of sockets.values()) expect(socket.timeout).not.toHaveBeenCalled()
  })

  it('rejects expired requests and revalidates the requester after departure', async () => {
    const { player, admin, emitWithAck, acknowledge } = setup()
    await handle(admin, { payload: { expiresAt: Date.now() - 1 } }, acknowledge)
    expect(emitWithAck).not.toHaveBeenCalled()
    expect(acknowledge).toHaveBeenLastCalledWith(expect.objectContaining({ payload: { status: 'changed' } }))
    const pending = handle(admin, action(), acknowledge)
    admin.user.roomId = 2
    player.emit('action', { type: PLAYER_EMIT_LEAVE })
    await pending
    expect(acknowledge).toHaveBeenLastCalledWith(expect.objectContaining({ payload: { status: 'changed' } }))
  })
})

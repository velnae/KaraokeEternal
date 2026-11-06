import { afterEach, describe, expect, it, vi } from 'vitest'
import ACTION_HANDLERS from './socket.js'
import Animation from '../Animation/Animation.js'
import { PLAYER_CMD_FULLSCREEN, PLAYER_REQ_FULLSCREEN } from '../../shared/actionTypes.js'
import { PLAYER_WINDOW_REQUEST_MS } from '../../shared/playerWindow.js'

vi.mock('../Animation/Animation.js', () => ({ default: { cancel: vi.fn() } }))
const handle = ACTION_HANDLERS[PLAYER_REQ_FULLSCREEN]
const action = () => ({ payload: { expiresAt: Date.now() + PLAYER_WINDOW_REQUEST_MS, roomId: 99 } })

function setup () {
  const emitWithAck = vi.fn().mockResolvedValue({ status: 'entered', origin: 'https://karaoke.puyu.pe' })
  const player = {
    id: 'player-1', connected: true, user: { roomId: 1, isAdmin: true }, _isPlayerAuthoritative: true,
    timeout: vi.fn(() => ({ emitWithAck })),
  }
  const standby = { ...player, id: 'standby', _isPlayerAuthoritative: false, timeout: vi.fn() }
  const otherRoom = { ...player, id: 'other-room', user: { roomId: 99, isAdmin: true }, timeout: vi.fn() }
  const sockets = new Map([[standby.id, standby], [otherRoom.id, otherRoom], [player.id, player]])
  const server = { of: () => ({ sockets }), to: vi.fn() }
  const admin = { id: 'admin', connected: true, user: { roomId: 1, isAdmin: true }, server }
  const acknowledge = vi.fn()
  return { player, standby, otherRoom, sockets, server, admin, acknowledge, emitWithAck }
}

afterEach(() => vi.clearAllMocks())

describe('remote fullscreen authorization and confirmation', () => {
  it('targets only the authoritative player in the authenticated room', async () => {
    const fixture = setup()
    await handle(fixture.admin, action(), fixture.acknowledge)
    expect(fixture.emitWithAck).toHaveBeenCalledWith('action', expect.objectContaining({
      type: PLAYER_CMD_FULLSCREEN,
      payload: expect.objectContaining({ roomId: 1, playerSocketId: 'player-1' }),
    }))
    expect(fixture.standby.timeout).not.toHaveBeenCalled()
    expect(fixture.otherRoom.timeout).not.toHaveBeenCalled()
    expect(fixture.server.to).not.toHaveBeenCalled()
    expect(Animation.cancel).not.toHaveBeenCalled()
    expect(fixture.acknowledge).toHaveBeenCalledWith(expect.objectContaining({ payload: { status: 'entered', origin: 'https://karaoke.puyu.pe' } }))
  })

  it('rejects participants before forwarding a command', async () => {
    const { admin, acknowledge, emitWithAck } = setup()
    admin.user.isAdmin = false
    await handle(admin, action(), acknowledge)
    expect(emitWithAck).not.toHaveBeenCalled()
    expect(acknowledge).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }))
  })

  it('reports no player rather than broadcasting to admins or other rooms', async () => {
    const { admin, sockets, player, acknowledge, emitWithAck } = setup()
    sockets.delete(player.id)
    await handle(admin, action(), acknowledge)
    expect(emitWithAck).not.toHaveBeenCalled()
    expect(acknowledge).toHaveBeenCalledWith(expect.objectContaining({ payload: { status: 'no-player' } }))
  })

  it.each([undefined, 0, -1, Infinity])('rejects invalid expiration %s', async (expiresAt) => {
    const { admin, acknowledge, emitWithAck } = setup()
    await handle(admin, { payload: { expiresAt } }, acknowledge)
    expect(emitWithAck).not.toHaveBeenCalled()
    expect(acknowledge).toHaveBeenCalledWith(expect.objectContaining({ payload: { status: 'changed' } }))
  })

  it('relays permission denial and handles a missing acknowledgment', async () => {
    const { admin, acknowledge, emitWithAck } = setup()
    emitWithAck.mockResolvedValueOnce({ status: 'permission-required', origin: 'https://karaoke.puyu.pe' })
    await handle(admin, action(), acknowledge)
    expect(acknowledge).toHaveBeenLastCalledWith(expect.objectContaining({ payload: { status: 'permission-required', origin: 'https://karaoke.puyu.pe' } }))
    emitWithAck.mockRejectedValueOnce(new Error('Timed out'))
    await handle(admin, action(), acknowledge)
    expect(acknowledge).toHaveBeenLastCalledWith(expect.objectContaining({ payload: { status: 'timeout' } }))
  })

  it('does not accept success after the player or requester changes room', async () => {
    for (const change of ['player', 'admin'] as const) {
      const fixture = setup()
      fixture.emitWithAck.mockImplementation(async () => {
        fixture[change].user.roomId = 2
        return { status: 'entered' }
      })
      await handle(fixture.admin, action(), fixture.acknowledge)
      expect(fixture.acknowledge).toHaveBeenCalledWith(expect.objectContaining({ payload: { status: 'changed' } }))
    }
  })

  it('rejects malformed player replies instead of claiming success', async () => {
    const { admin, acknowledge, emitWithAck } = setup()
    emitWithAck.mockResolvedValueOnce({ ok: true, origin: 'https://example.com/private?token=secret' })
    await handle(admin, action(), acknowledge)
    expect(acknowledge).toHaveBeenCalledWith(expect.objectContaining({ payload: { status: 'rejected' } }))
  })
})

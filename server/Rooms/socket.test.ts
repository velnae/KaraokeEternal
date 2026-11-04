import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ROOM_PREFS_PUSH, ROOM_PREFS_PUSH_REQUEST } from '../../shared/actionTypes.js'
import ACTION_HANDLERS from './socket.js'
import Rooms from './Rooms.js'
import { TRANSITION_VIDEO_PREF_DEFAULTS } from '../../shared/transitionVideo.js'

const handler = ACTION_HANDLERS[ROOM_PREFS_PUSH_REQUEST]

describe('room preference socket actions', () => {
  beforeEach(() => {
    vi.spyOn(Rooms, 'get').mockReturnValue({ result: [1], entities: { 1: { prefs: {} } } })
  })
  afterEach(() => vi.restoreAllMocks())

  it('rejects non-admin preference previews without broadcasting', async () => {
    const acknowledge = vi.fn()
    const fetchSockets = vi.fn()
    const sock = {
      user: { isAdmin: false },
      server: { in: vi.fn(() => ({ fetchSockets })) },
    }

    await handler(sock, { payload: { roomId: 1, prefs: {} } }, acknowledge)

    expect(acknowledge).toHaveBeenCalledWith({
      type: ROOM_PREFS_PUSH_REQUEST + '_ERROR',
      error: 'No tiene autorización',
    })
    expect(fetchSockets).not.toHaveBeenCalled()
  })

  it('rejects invalid queue preferences', async () => {
    const acknowledge = vi.fn()
    const fetchSockets = vi.fn()
    const sock = {
      user: { isAdmin: true },
      server: { in: vi.fn(() => ({ fetchSockets })) },
    }

    await handler(sock, {
      payload: {
        roomId: 1,
        prefs: { queue: { houseTracksBeforeParticipant: 11 } },
      },
    }, acknowledge)

    expect(acknowledge).toHaveBeenCalledWith({
      type: ROOM_PREFS_PUSH_REQUEST + '_ERROR',
      error: 'El número de canciones de la casa entre turnos de participantes debe ser un número entero entre 0 y 10',
    })
    expect(fetchSockets).not.toHaveBeenCalled()
  })

  it('normalizes and broadcasts valid preferences to connected admins', async () => {
    const acknowledge = vi.fn()
    const emit = vi.fn()
    const fetchSockets = vi.fn(async () => [
      { id: 'admin-socket', user: { isAdmin: true } },
      { id: 'guest-socket', user: { isAdmin: false } },
    ])
    const sock = {
      user: { isAdmin: true },
      server: {
        in: vi.fn(() => ({ fetchSockets })),
        to: vi.fn(() => ({ emit })),
      },
    }

    await handler(sock, {
      payload: {
        roomId: 1,
        prefs: { queue: { approvalMode: 'MANUAL' } },
      },
    }, acknowledge)

    expect(sock.server.to).toHaveBeenCalledOnce()
    expect(sock.server.to).toHaveBeenCalledWith('admin-socket')
    expect(emit).toHaveBeenCalledWith('action', {
      type: ROOM_PREFS_PUSH,
      payload: {
        roomId: 1,
        prefs: {
          transitionVideo: { ...TRANSITION_VIDEO_PREF_DEFAULTS },
          queue: {
            maxPendingPerParticipant: 2,
            maxSongsPerParticipantRound: 1,
            houseTracksBeforeParticipant: 2,
            approvalMode: 'MANUAL',
            rotationMode: 'FAIR',
          },
        },
      },
    })
    expect(acknowledge).toHaveBeenCalledWith({
      type: ROOM_PREFS_PUSH_REQUEST + '_SUCCESS',
    })
  })

  it('broadcasts the saved background instead of stale or forged preview preferences', async () => {
    const saved = { videoId: 'ready-video', dimOpacity: 0.65, revision: 7 }
    const emit = vi.fn()
    const sock = {
      user: { isAdmin: true },
      server: {
        in: vi.fn(() => ({
          fetchSockets: async () => {
            // Simulate a dedicated save occurring during socket discovery.
            vi.mocked(Rooms.get).mockReturnValue({ result: [1], entities: { 1: { prefs: { transitionVideo: saved } } } })
            return [{ id: 'admin-socket', user: { isAdmin: true } }]
          },
        })),
        to: vi.fn(() => ({ emit })),
      },
    }
    for (const prefs of [{}, { transitionVideo: { videoId: 'forged', dimOpacity: 0, revision: 999 } }]) {
      await handler(sock, { payload: { roomId: 1, prefs } }, vi.fn())
      expect(emit).toHaveBeenLastCalledWith('action', {
        type: ROOM_PREFS_PUSH,
        payload: { roomId: 1, prefs: expect.objectContaining({ transitionVideo: saved }) },
      })
    }
  })

  it('does not broadcast preference updates for a missing room', async () => {
    vi.mocked(Rooms.get).mockReturnValue({ result: [], entities: {} })
    const acknowledge = vi.fn()
    const to = vi.fn()
    await handler({
      user: { isAdmin: true },
      server: { in: () => ({ fetchSockets: async () => [{ id: 'admin', user: { isAdmin: true } }] }), to },
    }, { payload: { roomId: 99, prefs: {} } }, acknowledge)
    expect(to).not.toHaveBeenCalled()
    expect(acknowledge).toHaveBeenCalledWith({ type: ROOM_PREFS_PUSH_REQUEST + '_ERROR', error: 'No se encontró la sala' })
  })
})

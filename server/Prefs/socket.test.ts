import { afterEach, describe, expect, it, vi } from 'vitest'
import { PREFS_PATH_SET_PRIORITY, PREFS_PUSH, PREFS_SET } from '../../shared/actionTypes.js'
import Library from '../Library/Library.js'
import Prefs from './Prefs.js'
import ACTION_HANDLERS from './socket.js'

const createSocket = ({ isAdmin = false } = {}) => {
  const emittedTo = new Map<string, ReturnType<typeof vi.fn>>()
  const sockets = new Map([
    ['admin-socket', { id: 'admin-socket', user: { isAdmin: true } }],
    ['participant-socket', { id: 'participant-socket', user: { isAdmin: false } }],
  ])
  const server = {
    emit: vi.fn(),
    to: vi.fn((id: string) => {
      if (!emittedTo.has(id)) emittedTo.set(id, vi.fn())
      return { emit: emittedTo.get(id) }
    }),
    sockets: { sockets },
  }

  return {
    socket: {
      user: { isAdmin, name: isAdmin ? 'Admin' : 'Participant' },
      id: isAdmin ? 'admin-socket' : 'participant-socket',
      server,
    },
    emittedTo,
    server,
  }
}

describe('preference mutation authorization', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns before changing a preference for a participant', () => {
    const set = vi.spyOn(Prefs, 'set')
    const acknowledge = vi.fn()

    ACTION_HANDLERS[PREFS_SET](
      createSocket().socket,
      { payload: { key: 'port', data: 4000 } },
      acknowledge,
    )

    expect(set).not.toHaveBeenCalled()
    expect(acknowledge).toHaveBeenCalledWith({
      type: PREFS_SET + '_ERROR',
      error: 'Unauthorized',
    })
  })

  it('returns before reordering media paths or invalidating the library', () => {
    const setPathPriority = vi.spyOn(Prefs, 'setPathPriority')
    const originalVersion = Library.cache.version
    const acknowledge = vi.fn()

    ACTION_HANDLERS[PREFS_PATH_SET_PRIORITY](
      createSocket().socket,
      { payload: [3, 2, 1] },
      acknowledge,
    )

    expect(setPathPriority).not.toHaveBeenCalled()
    expect(Library.cache.version).toBe(originalVersion)
    expect(acknowledge).toHaveBeenCalledWith({
      type: PREFS_PATH_SET_PRIORITY + '_ERROR',
      error: 'Unauthorized',
    })
  })

  it('acknowledges an admin change and pushes preferences only to admins', () => {
    const prefs = {
      paths: { result: [], entities: {} },
      roles: { result: [], entities: {} },
    }
    vi.spyOn(Prefs, 'set').mockReturnValue(true)
    vi.spyOn(Prefs, 'get').mockReturnValue(prefs)
    const acknowledge = vi.fn()
    const { socket, emittedTo, server } = createSocket({ isAdmin: true })

    ACTION_HANDLERS[PREFS_SET](
      socket,
      { payload: { key: 'port', data: 3000 } },
      acknowledge,
    )

    expect(acknowledge).toHaveBeenCalledWith({ type: PREFS_SET + '_SUCCESS' })
    expect(emittedTo.get('admin-socket')).toHaveBeenCalledWith('action', {
      type: PREFS_PUSH,
      payload: prefs,
    })
    expect(emittedTo.has('participant-socket')).toBe(false)
    expect(server.emit).not.toHaveBeenCalled()
  })
})

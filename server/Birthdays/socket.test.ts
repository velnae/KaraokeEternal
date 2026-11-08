import { beforeEach, expect, it, vi } from 'vitest'
import { BIRTHDAY_PLAYER, BIRTHDAY_SYNC } from '../../shared/birthdays.js'

const mocks = vi.hoisted(() => ({
  authority: vi.fn(() => true), status: vi.fn(() => ({ queueId: 7, isAtQueueEnd: false })), active: vi.fn(() => null),
  room: vi.fn(), events: vi.fn((): { id: string }[] => [{ id: 'birthday' }]), reserve: vi.fn(async () => ({ token: 'token' })), progress: vi.fn(), publish: vi.fn(), waiting: vi.fn(), interrupt: vi.fn(), transition: vi.fn(),
}))
vi.mock('../Rooms/Rooms.js', () => ({ default: { isAuthoritativePlayer: mocks.authority, getPlayerStatus: mocks.status } }))
vi.mock('../Animation/Animation.js', () => ({ default: { active: mocks.active } }))
vi.mock('../Queue/Queue.js', () => ({ default: { transition: mocks.transition } }))
vi.mock('./Store.js', () => ({ assertRoom: mocks.room, publicEvents: mocks.events }))
vi.mock('./Service.js', () => ({ birthdayService: () => mocks }))
import handlers from './socket.js'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authority.mockReturnValue(true)
  mocks.status.mockReturnValue({ queueId: 7, isAtQueueEnd: false })
  mocks.events.mockReturnValue([{ id: 'birthday' }])
})
const socket = { user: { isAdmin: true, roomId: 1 }, id: 'player', server: {} }
const request = (payload: Record<string, unknown>, sock = socket) => handlers[BIRTHDAY_PLAYER](sock, { payload }, vi.fn())

it('requires the authoritative administrator for playback operations', async () => {
  await expect(request({ operation: 'reserve' }, { ...socket, user: { ...socket.user, isAdmin: false } })).rejects.toThrow('autoridad')
  mocks.authority.mockReturnValue(false)
  await expect(request({ operation: 'reserve' })).rejects.toThrow('autoridad')
  expect(mocks.reserve).not.toHaveBeenCalled()
})
it('never reserves an idle event over an occupied song or an outdated ending', async () => {
  await expect(request({ operation: 'reserve', boundary: 'idle', ready: true })).rejects.toThrow('actual')
  await expect(request({ operation: 'reserve', boundary: 'ended', sourceQueueId: 8, ready: true })).rejects.toThrow('actual')
  expect(mocks.reserve).not.toHaveBeenCalled()
})
it('keeps approval pending while sound prepares and republishes the next event', async () => {
  const reply = vi.fn()
  await handlers[BIRTHDAY_PLAYER](socket, { payload: { operation: 'reserve', boundary: 'ended', sourceQueueId: 7, ready: false } }, reply)
  expect(mocks.reserve).not.toHaveBeenCalled()
  expect(mocks.waiting).toHaveBeenCalledWith(1, expect.stringContaining('Active el sonido'))
  expect(mocks.transition).toHaveBeenCalledWith(1, 7, 'PLAYED')
  expect(reply).toHaveBeenCalledWith({ payload: { waiting: true } })
})
it('reserves after the matching song and when genuinely idle', async () => {
  await request({ operation: 'reserve', boundary: 'ended', sourceQueueId: 7, ready: true })
  mocks.status.mockReturnValue({ queueId: -1, isAtQueueEnd: true })
  await request({ operation: 'reserve', boundary: 'idle', ready: true })
  expect(mocks.reserve).toHaveBeenCalledTimes(2)
  expect(mocks.reserve).toHaveBeenCalledWith(1, 'player')
})
it('public synchronization uses only the room public projection', () => {
  const reply = vi.fn()
  handlers[BIRTHDAY_SYNC](socket, {}, reply)
  expect(reply).toHaveBeenCalledWith({ payload: { roomId: 1, events: [{ id: 'birthday' }] } })
})

import { describe, expect, it, vi } from 'vitest'
import { BEGIN, COMMIT, REVERT } from 'redux-optimistic-ui'
import createSocketMiddleware from './socketMiddleware'

const setup = () => {
  const callbacks: Array<(action: object) => void> = []
  const socket = {
    on: vi.fn(),
    emit: vi.fn((_event, _action, callback) => callbacks.push(callback)),
  }
  const next = vi.fn()
  const dispatch = vi.fn()
  const invoke = createSocketMiddleware(socket as never, 'server/')({ dispatch } as never)(next)

  return { callbacks, invoke, next }
}

describe('socket optimistic transactions', () => {
  it('reverts the exact transaction when the server rejects it', () => {
    const { callbacks, invoke, next } = setup()

    invoke({ type: 'server/QUEUE_ADD', meta: { isOptimistic: true }, payload: { songId: 1 } })
    const begin = next.mock.calls[0][0].meta.optimistic
    callbacks[0]({ type: 'server/QUEUE_ADD_ERROR', error: 'Denied' })

    expect(begin.type).toBe(BEGIN)
    expect(next.mock.calls[1][0].meta.optimistic).toEqual({ type: REVERT, id: begin.id })
  })

  it('keeps transaction ids stable when callbacks arrive out of order', () => {
    const { callbacks, invoke, next } = setup()

    invoke({ type: 'server/STAR_SONG', meta: { isOptimistic: true }, payload: 1 })
    invoke({ type: 'server/STAR_SONG', meta: { isOptimistic: true }, payload: 2 })
    const first = next.mock.calls[0][0].meta.optimistic
    const second = next.mock.calls[1][0].meta.optimistic

    callbacks[1]({ type: 'server/STAR_SONG_SUCCESS' })
    callbacks[0]({ type: 'server/STAR_SONG_ERROR', error: 'Denied' })

    expect(next.mock.calls[2][0].meta.optimistic).toEqual({ type: COMMIT, id: second.id })
    expect(next.mock.calls[3][0].meta.optimistic).toEqual({ type: REVERT, id: first.id })
    expect(first.id).not.toBe(second.id)
  })
})

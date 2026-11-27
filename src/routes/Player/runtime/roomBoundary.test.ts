import { expect, it, vi } from 'vitest'
import { createRoomBoundary } from './roomBoundary'

function deferred () {
  let finish!: () => void
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  return { finish, pending }
}

it('drains a pending idle permit before birthday audio and excludes idle until the turn is released', async () => {
  const gate = createRoomBoundary()
  const idle = deferred()
  const playIdle = vi.fn(() => idle.pending)
  gate.enterIdle(playIdle)
  gate.enterIdle(playIdle)
  const run = gate.begin()
  const playBirthday = vi.fn(async () => 'finished' as const)
  const stop = vi.fn(async () => {})
  const result = run.celebrate(stop, playBirthday)
  await Promise.resolve()
  expect(stop).toHaveBeenCalledOnce()
  expect(playBirthday).not.toHaveBeenCalled()
  idle.finish()
  expect(await result).toBe('finished')
  gate.enterIdle(playIdle)
  expect(playIdle).toHaveBeenCalledOnce()
  run.close()
  gate.enterIdle(playIdle)
  expect(playIdle).toHaveBeenCalledTimes(2)
})

it('does not start a birthday after a cancelled idle handoff', async () => {
  const gate = createRoomBoundary()
  const stop = deferred()
  const play = vi.fn(async () => 'finished' as const)
  const result = gate.begin().celebrate(() => stop.pending, play)
  gate.cancel()
  stop.finish()
  expect(await result).toBe('interrupted')
  expect(play).not.toHaveBeenCalled()
})

it('a late birthday finish cannot resume or release a replacement turn', async () => {
  const gate = createRoomBoundary()
  const start = deferred()
  const finish = deferred()
  const old = gate.begin()
  const result = old.celebrate(async () => {}, async (signal) => {
    start.finish()
    await finish.pending
    expect(signal.aborted).toBe(true)
    return 'finished'
  })
  await start.pending
  const replacement = gate.begin()
  finish.finish()
  expect(await result).toBe('interrupted')
  old.close()
  expect(replacement.current()).toBe(true)
})

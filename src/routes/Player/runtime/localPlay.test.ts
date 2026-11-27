import { expect, it, vi } from 'vitest'
import { createLocalPlay } from './localPlay'

it('activates audio synchronously and coalesces gestures while a room request is pending', () => {
  let clock = 0
  const play = createLocalPlay(() => clock)
  const events: string[] = []
  play.bind({ scope: () => 'owner/turn', hasIntent: () => false, activate: () => events.push('activate'), request: () => events.push('send') })
  play.start()
  play.start()
  expect(events).toEqual(['activate', 'send', 'activate'])
  clock += 4000
  play.start()
  expect(events.slice(-2)).toEqual(['activate', 'send'])
})

it('satisfies remote intent locally and ignores stale retry clicks after cancellation', () => {
  const play = createLocalPlay()
  let intent = true
  const request = vi.fn()
  const activate = vi.fn()
  const retry = vi.fn()
  const detach = play.bind({ scope: () => 'current', hasIntent: () => intent, activate, request })
  play.start()
  expect(activate).toHaveBeenCalledOnce()
  const blocked = play.scope()
  play.bindMedia((scope) => {
    if (scope !== blocked) return false
    retry()
    return true
  })
  intent = false
  play.recover()
  play.reset()
  play.recover()
  detach()
  play.start()
  expect(retry).toHaveBeenCalledOnce()
  expect(request).not.toHaveBeenCalled()
})

it('does not activate or send from an unauthorized tab', () => {
  const play = createLocalPlay()
  const request = vi.fn()
  const activate = vi.fn()
  play.bind({ scope: () => null, hasIntent: () => false, activate, request })
  play.start()
  expect(request).not.toHaveBeenCalled()
  expect(activate).not.toHaveBeenCalled()
})

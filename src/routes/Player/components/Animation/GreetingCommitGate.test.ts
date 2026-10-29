import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import GreetingCommitGate from './GreetingCommitGate'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('requires the matching committed card, independently of animation frames', async () => {
  const gate = new GreetingCommitGate()
  const completed = vi.fn()
  const waiting = gate.wait(7).then(completed)
  gate.confirm(6)
  await Promise.resolve()
  expect(completed).not.toHaveBeenCalled()
  gate.confirm(7)
  await waiting
  expect(completed).toHaveBeenCalledExactlyOnceWith(true)
  expect(vi.getTimerCount()).toBe(0)
})

it('bounds an absent render without falsely acknowledging delivery', async () => {
  const gate = new GreetingCommitGate()
  const waiting = gate.wait(7)
  await vi.advanceTimersByTimeAsync(1500)
  await expect(waiting).resolves.toBe(false)
  gate.confirm(7)
  expect(vi.getTimerCount()).toBe(0)
})

it('cancels a pending commit immediately on navigation, control or disconnect', async () => {
  const gate = new GreetingCommitGate()
  const waiting = gate.wait(7)
  gate.cancel()
  await expect(waiting).resolves.toBe(false)
  gate.confirm(7)
  expect(vi.getTimerCount()).toBe(0)
})

it('does not let a late callback from the preceding card confirm its successor', async () => {
  const gate = new GreetingCommitGate()
  const previous = gate.wait(7)
  const completed = vi.fn()
  const next = gate.wait(8).then(completed)
  await expect(previous).resolves.toBe(false)
  gate.confirm(7)
  await Promise.resolve()
  expect(completed).not.toHaveBeenCalled()
  gate.confirm(8)
  await next
  expect(completed).toHaveBeenCalledExactlyOnceWith(true)
  expect(vi.getTimerCount()).toBe(0)
})

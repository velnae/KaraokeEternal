import { afterEach, expect, it, vi } from 'vitest'
import { beginTransitionDiagnostic, playbackTraceSnapshot, recentTransitionIncidents, tracePlayback } from './playbackTrace'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('bounds retention, reports dropped events and exports detached snapshots', () => {
  for (let index = 0; index < 305; index++) tracePlayback('audio-context', { state: 'running' })
  const snapshot = playbackTraceSnapshot()
  expect(snapshot.events).toHaveLength(300)
  expect(snapshot.droppedEvents).toBeGreaterThanOrEqual(5)
  expect(snapshot.events[snapshot.events.length - 1].sequence - snapshot.events[0].sequence).toBe(299)
  snapshot.events[0].state = 'changed'
  expect(playbackTraceSnapshot().events[0].state).toBe('running')
})

it('retains three distinct incidents in development and refreshes one capture without duplicating it', async () => {
  vi.stubEnv('NODE_ENV', 'development')
  vi.useFakeTimers()
  const storage = new Map<string, string>()
  vi.stubGlobal('window', { sessionStorage: { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) } })
  beginTransitionDiagnostic(5, 1)?.flush()
  expect(storage.size).toBe(0)
  for (let id = 6; id <= 9; id++) {
    const transition = beginTransitionDiagnostic(id, 1)!
    transition.flag('greeting-ack-timeout', { state: 'reserve' })
    await vi.runAllTimersAsync()
    transition.record('transition-incoming-playing', { queueId: id + 1 })
    transition.flush()
    await vi.runAllTimersAsync()
  }
  const captures = recentTransitionIncidents()
  expect(captures.map(item => item.events[0].sourceQueueId)).toEqual([9, 8, 7])
  expect(captures[0].events.slice(1)).toMatchObject([
    { reason: 'greeting-ack-timeout', state: 'reserve', diagnosticId: captures[0].diagnosticId },
    { event: 'transition-incoming-playing', queueId: 10, diagnosticId: captures[0].diagnosticId },
  ])
  vi.setSystemTime(Date.now() + 30 * 60 * 1000)
  expect(recentTransitionIncidents()).toEqual([])
})

it('does not create or read incident captures in production', () => {
  vi.stubEnv('NODE_ENV', 'production')
  const access = vi.fn()
  vi.stubGlobal('window', { sessionStorage: { getItem: access, setItem: access } })
  expect(beginTransitionDiagnostic(1, 1)).toBeUndefined()
  expect(recentTransitionIncidents()).toEqual([])
  expect(access).not.toHaveBeenCalled()
})

import { expect, it } from 'vitest'
import { playbackTraceSnapshot, tracePlayback } from './playbackTrace'

it('bounds retention, reports dropped events and exports detached snapshots', () => {
  for (let index = 0; index < 305; index++) tracePlayback('audio-context', { state: 'running' })
  const snapshot = playbackTraceSnapshot()
  expect(snapshot.events).toHaveLength(300)
  expect(snapshot.droppedEvents).toBeGreaterThanOrEqual(5)
  expect(snapshot.events[snapshot.events.length - 1].sequence - snapshot.events[0].sequence).toBe(299)
  snapshot.events[0].state = 'changed'
  expect(playbackTraceSnapshot().events[0].state).toBe('running')
})

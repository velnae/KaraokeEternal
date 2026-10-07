import { expect, it } from 'vitest'
import { participantPrefs } from './participantPrefs.js'

it('exposes normalized queue limits without leaking QR or operator settings', () => {
  const prefs = participantPrefs({ roles: {}, queue: { maxPendingPerParticipant: 3 } } as Parameters<typeof participantPrefs>[0])
  expect(prefs.queue.maxPendingPerParticipant).toBe(3)
  expect(prefs.queue.approvalMode).toBe('AUTO')
  expect(Object.keys(participantPrefs({ qr: { password: 'private' }, roles: {} } as Parameters<typeof participantPrefs>[0]))).toEqual(['roles', 'queue'])
})

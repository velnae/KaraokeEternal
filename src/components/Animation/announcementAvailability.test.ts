import { describe, expect, it } from 'vitest'
import { announcementBlocker } from './announcementAvailability'
import type { AnimationSnapshot } from '../../../shared/animation.js'

const snapshot: AnimationSnapshot = {
  roomId: 1, playerEpoch: 1, controlVersion: 1, microphoneOccupied: 0, blockedUntil: 0,
  prefs: { enabled: true, volume: 0.5 }, active: null, history: [], playerPresent: true,
  audioUnlocked: false, readyClips: [], serverTime: 1000,
}
const input = { snapshot, connected: true, hasClip: true, now: 1000 }

describe('announcement request availability', () => {
  it('allows a pending request before audio is unlocked or decoded', () => {
    expect(announcementBlocker(input)).toBeNull()
    expect(announcementBlocker({ ...input, snapshot: { ...snapshot, audioUnlocked: true } })).toBeNull()
  })

  it('explains connection and loading blockers', () => {
    expect(announcementBlocker({ ...input, snapshot: null })).toContain('Conectando')
    expect(announcementBlocker({ ...input, connected: false })).toContain('Sin conexión')
  })

  it('explains missing player and unavailable clip instead of silently disabling', () => {
    expect(announcementBlocker({ ...input, snapshot: { ...snapshot, playerPresent: false } })).toContain('Abra el reproductor')
    expect(announcementBlocker({ ...input, hasClip: false })).toContain('Seleccione un clip')
  })

  it('preserves the enabled, room, microphone and volume checks', () => {
    expect(announcementBlocker({ ...input, snapshot: { ...snapshot, prefs: { ...snapshot.prefs, enabled: false } } })).toContain('Active el animador')
    expect(announcementBlocker({ ...input, roomClosed: true })).toContain('sala está cerrada')
    expect(announcementBlocker({ ...input, snapshot: { ...snapshot, microphoneOccupied: 1 } })).toContain('micrófono como libre')
    expect(announcementBlocker({ ...input, snapshot: { ...snapshot, prefs: { ...snapshot.prefs, volume: 0 } } })).toContain('Suba el volumen')
  })

  it('preserves the recovery fence only until it expires', () => {
    const recovering = { ...input, snapshot: { ...snapshot, blockedUntil: 2000 } }
    expect(announcementBlocker(recovering)).toContain('intervención anterior')
    expect(announcementBlocker({ ...recovering, now: 2001 })).toBeNull()
  })
})

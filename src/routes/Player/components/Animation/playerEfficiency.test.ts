import { describe, expect, it, vi } from 'vitest'
import type { AnimationSnapshot } from '../../../../../shared/animation.js'
import { needsAnimationClock, ReadinessPublication } from './playerEfficiency'

const room = (patch: Partial<AnimationSnapshot> = {}) => ({
  prefs: { enabled: true }, active: null, ambience: null, blockedUntil: 0, ...patch,
}) as AnimationSnapshot
const playing = { connected: true, idle: false, busy: false, ambience: false }

describe('player activity clock', () => {
  it('does not tick during ordinary music playback, even with the animator enabled', () => {
    expect(needsAnimationClock(room(), playing, 1000)).toBe(false)
    expect(needsAnimationClock(undefined, playing, 1000)).toBe(false)
  })

  it('retains idle opportunities and greeting-only rooms', () => {
    expect(needsAnimationClock(room(), { ...playing, idle: true }, 1000)).toBe(true)
    expect(needsAnimationClock(room({ prefs: { enabled: false, volume: 0.5 }, greetingVoiceEnabled: true }), { ...playing, idle: true }, 1000)).toBe(true)
    expect(needsAnimationClock(room({ prefs: { enabled: false, volume: 0.5 } }), { ...playing, idle: true }, 1000)).toBe(false)
  })

  it('keeps reservation expiry and ambience renewals alive, including disabled voice during recovery', () => {
    expect(needsAnimationClock(room({ blockedUntil: 1001, prefs: { enabled: false, volume: 0.5 } }), playing, 1000)).toBe(true)
    expect(needsAnimationClock(room({ blockedUntil: 1000 }), playing, 1000)).toBe(false)
    expect(needsAnimationClock(room({ active: { status: 'PENDING' } as AnimationSnapshot['active'] }), playing, 1000)).toBe(true)
    expect(needsAnimationClock(room({ ambience: { until: 1001 } as AnimationSnapshot['ambience'] }), playing, 1000)).toBe(true)
    expect(needsAnimationClock(room(), { ...playing, ambience: true }, 1000)).toBe(true)
    expect(needsAnimationClock(room(), { ...playing, busy: true }, 1000)).toBe(true)
    expect(needsAnimationClock(room({ blockedUntil: 9999 }), { ...playing, connected: false }, 1000)).toBe(false)
  })
})

describe('readiness publication', () => {
  it('coalesces in-flight work and reuses confirmed readiness', async () => {
    const publication = new ReadinessPublication()
    let complete!: () => void
    const send = vi.fn(() => new Promise<void>((resolve) => {
      complete = resolve
    }))
    const first = publication.publish('owner:ready:assets', send)
    expect(publication.publish('owner:ready:assets', send)).toBe(first)
    complete()
    await first
    await publication.publish('owner:ready:assets', send)
    expect(send).toHaveBeenCalledOnce()
    await publication.publish('new-owner:ready:assets', async () => {})
  })

  it('retries failed requests and republishes after audio availability changes', async () => {
    const publication = new ReadinessPublication()
    const send = vi.fn().mockRejectedValueOnce(new Error('Disconnected')).mockResolvedValue(undefined)
    await expect(publication.publish('same', send)).rejects.toThrow('Disconnected')
    await publication.publish('same', send)
    publication.invalidate()
    await publication.publish('same', send)
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('cannot let a late acknowledgement restore invalidated readiness', async () => {
    const publication = new ReadinessPublication()
    let complete!: () => void
    const old = publication.publish('same', () => new Promise<void>((resolve) => {
      complete = resolve
    }))
    publication.invalidate()
    complete()
    await old
    const send = vi.fn(async () => {})
    await publication.publish('same', send)
    expect(send).toHaveBeenCalledOnce()
  })

  it('does not overwrite a newer asset set when older acknowledgements arrive out of order', async () => {
    const publication = new ReadinessPublication()
    let complete!: () => void
    const old = publication.publish('old-assets', () => new Promise<void>((resolve) => {
      complete = resolve
    }))
    const send = vi.fn(async () => {})
    await publication.publish('new-assets', send)
    complete()
    await old
    await publication.publish('new-assets', send)
    expect(send).toHaveBeenCalledOnce()
  })
})

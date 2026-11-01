import { describe, expect, it } from 'vitest'
import { selectAnnouncement, voiceBudget } from './selection.js'
import { businessDate } from './sessions.js'
import type { AnimationClip, Intervention, VoiceFamily } from '../../shared/animation.js'

const now = 1793000000000
const clip = (id: string, family: VoiceFamily = 'turn'): AnimationClip => ({
  id, title: id, displayText: `Texto ${id}`, checksum: id, durationMs: 5000, source: 'test', license: 'test',
  kind: 'voice', family, approvedForAuto: true, modes: ['dinner', 'mixed', 'party'],
})
const played = (asset: AnimationClip, ago: number, sessionId = 'current'): Intervention => ({
  interventionId: asset.id, clipId: asset.id, displayText: asset.displayText, family: asset.family, durationMs: asset.durationMs,
  startedAt: now - ago, status: 'PLAYED', sessionId,
} as Intervention)
const choose = (clips: AnimationClip[], history: Intervention[] = [], family: VoiceFamily = 'turn') => selectAnnouncement({
  clips, history, family, profile: 'mixed', sessionId: 'current', recentSessions: ['previous'], ready: clips.map(clip => clip.checksum), now, random: () => 0,
})

describe('persistent announcement selection', () => {
  it('prefers unused variants and recovers a single variant after its cooldown', () => {
    const clips = [clip('a'), clip('b'), clip('c')]
    expect(choose(clips, [played(clips[0], 1000)]).clip?.id).toBe('b')
    expect(choose([clips[0]], [played(clips[0], 1000)]).clip).toBeUndefined()
    expect(choose([clips[0]], [played(clips[0], 60001)]).clip?.id).toBe('a')
  })
  it('treats the same phrase with another style as the same spoken content', () => {
    const first = clip('a')
    expect(choose([{ ...clip('b'), displayText: first.displayText }], [played(first, 1000)]).clip).toBeUndefined()
    expect(choose([{ ...clip('b'), displayText: `[excited] ${first.displayText} [laughs]` }], [played(first, 1000)]).clip).toBeUndefined()
  })
  it('reuses environmental phrases in the same session after the interval', () => {
    const first = clip('a', 'invitation')
    expect(choose([first], [played(first, 3600000)], 'invitation').clip?.id).toBe('a')
  })
  it('favours environmental variants not heard in recent sessions', () => {
    const clips = [clip('a', 'invitation'), clip('b', 'invitation')]
    expect(choose(clips, [played(clips[0], 86400000, 'previous')], 'invitation').clip?.id).toBe('b')
  })
  it('enforces environmental intervals and room profiles', () => {
    const clips = [clip('a', 'invitation'), clip('b', 'invitation')]
    expect(choose(clips, [played(clips[0], 60000)], 'invitation').reason).toContain('intervalo')
    expect(choose([{ ...clip('a'), modes: ['dinner'] }]).clip).toBeUndefined()
  })
  it('counts interrupted and uncertain audio conservatively against the rolling budget', () => {
    const history = Array.from({ length: 24 }, (_, index) => ({ ...played(clip(String(index)), 1000 + index), status: 'INTERRUPTED' as const }))
    expect(voiceBudget(history, now)).toBe(0)
    expect(choose([clip('new')], history).clip).toBeUndefined()
    expect(voiceBudget([{ ...played(clip('a'), 0), status: 'UNCERTAIN', startedAt: null, startBefore: now }], now)).toBe(115000)
    expect(voiceBudget(history, now + 600001)).toBe(120000)
  })
  it('rejects unapproved and unprepared assets', () => {
    expect(choose([{ ...clip('a'), approvedForAuto: false }]).clip).toBeUndefined()
    expect(selectAnnouncement({ clips: [clip('a')], history: [], family: 'turn', profile: 'mixed', sessionId: 'current', recentSessions: [], ready: [], now }).clip).toBeUndefined()
  })
  it('uses Lima business cutoff without resetting at midnight', () => {
    expect(businessDate(Date.parse('2026-10-27T07:00:00Z'), 4)).toBe('2026-10-26')
    expect(businessDate(Date.parse('2026-10-27T10:00:00Z'), 4)).toBe('2026-10-27')
  })
  it('requires explicitly configured, unexpired promotions', () => {
    const promotion = clip('promo', 'promotion')
    expect(choose([promotion], [], 'promotion').clip).toBeUndefined()
    expect(choose([{ ...promotion, validUntil: now - 1 }], [], 'promotion').clip).toBeUndefined()
    expect(choose([{ ...promotion, validUntil: now + 3600000 }], [], 'promotion').clip?.id).toBe('promo')
  })

  it('chooses the older phrase when equally used variants are available', () => {
    const first = clip('a')
    const older = clip('b')
    const last = clip('other', 'closing')
    expect(choose([first, older], [played(first, 3600000), played(older, 7200000), played(last, 1000)]).clip?.id).toBe('b')
  })

  it('keeps booth messages off in dinner and recurring hourly in other profiles', () => {
    const clips = [clip('a', 'booth'), clip('b', 'booth'), clip('c', 'booth')]
    const select = (profile: 'dinner' | 'mixed' | 'party', history: Intervention[]) => selectAnnouncement({
      clips, history, family: 'booth', profile, sessionId: 'current', recentSessions: [], ready: clips.map(item => item.checksum), now, random: () => 0,
    })
    expect(select('dinner', []).clip).toBeUndefined()
    expect(select('mixed', [played(clips[0], 3600001)]).clip?.id).toBe('b')
    expect(select('party', [played(clips[0], 3599999)]).clip).toBeUndefined()
    expect(select('party', [played(clips[0], 3600001)]).clip?.id).toBe('b')
    expect(select('party', [played(clips[0], 7200000), played(clips[1], 3600001)]).clip?.id).toBe('c')
  })

  it('keeps promotions at least one hour apart even after their environmental interval', () => {
    const next = { ...clip('new-promotion', 'promotion'), validUntil: now + 86400000 }
    const previous = clip('previous-promotion', 'promotion')
    expect(choose([next], [played(previous, 1800000)], 'promotion').reason).toContain('una hora')
    expect(choose([next], [played(previous, 3600001)], 'promotion').clip?.id).toBe(next.id)
  })
})

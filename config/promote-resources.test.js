import { describe, expect, it } from 'vitest'
import { birthdayDependencies, digest, mappedSettings, normalizeRequest } from './promote-resources.js'

const manifest = { source: { baseUrl: 'https://dev-karaoke.puyu.pe', roomId: 1 }, target: { baseUrl: 'https://karaoke.puyu.pe', roomId: 2 }, audio: ['voice-1'] }
describe('promotion boundaries', () => {
  it('requires explicit endpoints, room and selection', () => {
    expect(normalizeRequest(manifest).target.baseUrl).toBe('https://karaoke.puyu.pe/')
    expect(() => normalizeRequest({ ...manifest, target: manifest.source })).toThrow('must differ')
    expect(() => normalizeRequest({ ...manifest, target: { ...manifest.target, baseUrl: 'http://example.com' } })).toThrow('HTTPS')
    expect(() => normalizeRequest({ ...manifest, target: { ...manifest.target, baseUrl: 'https://user:secret@example.com' } })).toThrow('HTTPS')
    expect(() => normalizeRequest({ ...manifest, target: { ...manifest.target, roomId: 0 } })).toThrow('roomId')
    expect(() => normalizeRequest({ ...manifest, audio: [] })).toThrow('Select')
    expect(() => normalizeRequest({ ...manifest, audio: ['../asset'] })).toThrow('IDs')
    expect(() => normalizeRequest({ ...manifest, queue: true })).toThrow('Unknown')
  })
  it('fingerprints nested values independently of key order but detects changed scope', () => {
    expect(digest(manifest)).toBe(digest({ audio: manifest.audio, target: manifest.target, source: manifest.source }))
    expect(digest(manifest)).not.toBe(digest({ ...manifest, birthdays: true }))
  })
  it('includes bank and profile dependencies and refuses dangling settings', () => {
    const settings = { introId: 'intro', introIds: ['intro', 'bank'], musicId: 'music', videoId: 'video', bedId: 'bed', bedVolume: 0.2, applauseId: 'applause', rules: [{ videoId: 'profile' }, {}],
      videoBackgrounds: { female: { videoId: 'female', ranges: [{ id: 'young', minAge: 0, maxAge: 12, videoId: 'young' }, { id: 'inherit', minAge: 13, maxAge: 24, videoId: null }] } } }
    expect(birthdayDependencies(settings)).toEqual(['intro', 'music', 'video', 'bed', 'applause', 'bank', 'profile', 'female', 'young'])
    const items = birthdayDependencies(settings).map(sourceId => ({ type: 'birthday', sourceId, key: sourceId, targetId: `prod-${sourceId}` }))
    const result = mappedSettings('birthday', settings, items, { resources: { intro: { id: 'receipt-intro' } } })
    expect(result.introId).toBe('receipt-intro')
    expect(result.introIds).toEqual(['receipt-intro', 'prod-bank'])
    expect(result.rules[0].videoId).toBe('prod-profile')
    expect(result.bedId).toBe('prod-bed')
    expect(result.applauseId).toBe('prod-applause')
    expect(result.bedVolume).toBe(0.2)
    expect(result.videoBackgrounds.female.videoId).toBe('prod-female')
    expect(result.videoBackgrounds.female.ranges.map(range => range.videoId)).toEqual(['prod-young', null])
    expect(settings.introId).toBe('intro')
    expect(() => mappedSettings('birthday', settings, [], { resources: {} })).toThrow('dependency')
  })
})

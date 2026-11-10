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
    const settings = { introId: 'intro', introIds: ['intro', 'bank'], musicId: 'music', videoId: 'video', rules: [{ videoId: 'profile' }, {}] }
    expect(birthdayDependencies(settings)).toEqual(['intro', 'music', 'video', 'bank', 'profile'])
    const items = birthdayDependencies(settings).map(sourceId => ({ type: 'birthday', sourceId, key: sourceId, targetId: `prod-${sourceId}` }))
    const result = mappedSettings('birthday', settings, items, { resources: { intro: { id: 'receipt-intro' } } })
    expect(result.introId).toBe('receipt-intro')
    expect(result.introIds).toEqual(['receipt-intro', 'prod-bank'])
    expect(result.rules[0].videoId).toBe('prod-profile')
    expect(settings.introId).toBe('intro')
    expect(() => mappedSettings('birthday', settings, [], { resources: {} })).toThrow('dependency')
  })
})

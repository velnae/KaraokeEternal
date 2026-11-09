import { describe, expect, it } from 'vitest'
import { announcementAtTurn, defaultPlayerDisplay, displayLimits, pickAnnouncementPhrase, resetDisplayAppearance, validatePlayerDisplay } from './playerDisplay.js'
import { resolvePlayerLogo } from './playerLogo.js'

describe('player display contract', () => {
  it('defaults image size and preserves independent sizes when saving and resetting appearance', () => {
    const settings = validatePlayerDisplay({ announcement: { messages: [
      { title: 'First', text: '', image: 'qr', imageScale: 200 },
      { title: 'Second', text: '', imageScale: 75 },
      { title: 'Legacy', text: '' },
    ] } })
    expect(settings.announcement.messages.map(message => message.imageScale)).toEqual([200, 75, 100])
    expect(validatePlayerDisplay(settings).announcement.messages).toEqual(settings.announcement.messages)
    expect(resetDisplayAppearance(settings).announcement.messages).toEqual(settings.announcement.messages)
  })

  it.each([24, 2001, NaN, Infinity, null, '100'])('rejects invalid per-message image scale %s', (imageScale) => {
    expect(() => validatePlayerDisplay({ announcement: { messages: [{ title: 'Message', text: '', imageScale }] } })).toThrow('Tamaño de imagen del comunicado 1')
  })

  it.each([500, 1000, 2000])('preserves oversized image scale %s through validation', (imageScale) => {
    const settings = validatePlayerDisplay({ announcement: { messages: [{ title: 'Message', text: '', image: 'qr', imageScale }] } })
    expect(validatePlayerDisplay(settings).announcement.messages[0].imageScale).toBe(imageScale)
  })

  it('migrates the legacy image to the first announcement without inspecting its text', () => {
    const messages = [{ title: 'Primer comunicado', text: '' }, { title: 'Escanea el QR', text: '' }]
    const migrated = validatePlayerDisplay({ announcement: { messages, showIcon: true } })
    expect(migrated.announcement.messages.map(message => message.image)).toEqual(['qr', null])
    expect(validatePlayerDisplay({ announcement: { messages, showIcon: false } }).announcement.messages.map(message => message.image)).toEqual([null, null])
    expect(validatePlayerDisplay({ announcement: { messages } }).announcement.messages.map(message => message.image)).toEqual([null, null])
    expect(validatePlayerDisplay({ announcement: { messages: [{ ...messages[0], image: null }] } }).announcement.messages[0].image).toBeNull()
    expect(validatePlayerDisplay({}).announcement.messages[0].image).toBe('qr')
    expect(resetDisplayAppearance(migrated).announcement.messages).toEqual(migrated.announcement.messages)
    migrated.announcement.messages[0].title = 'Título editado'
    expect(validatePlayerDisplay(migrated).announcement.messages[0].image).toBe('qr')
    migrated.announcement.messages[0].image = null
    expect(validatePlayerDisplay(migrated).announcement.messages[0].image).toBeNull()
  })

  it.each(['https://example.com/image.png', '../../image.png', 'custom', 123])('rejects invalid announcement image %s', (image) => {
    expect(() => validatePlayerDisplay({ announcement: { messages: [{ title: 'Message', text: '', image }] } })).toThrow()
  })

  it('defaults the phrase bank off for existing settings and preserves it when resetting appearance', () => {
    expect(validatePlayerDisplay({}).announcement).toMatchObject({ phrases: [], showPhraseAfterMessages: false })
    const settings = validatePlayerDisplay({ announcement: { phrases: [' Primera ', '', '  ', 'Segunda'], showPhraseAfterMessages: true } })
    expect(settings.announcement.phrases).toEqual(['Primera', 'Segunda'])
    const reset = resetDisplayAppearance(settings)
    expect(reset.announcement).toMatchObject({ phrases: ['Primera', 'Segunda'], showPhraseAfterMessages: true })
    reset.announcement.phrases[0] = 'Edited'
    expect(settings.announcement.phrases[0]).toBe('Primera')
  })

  it.each([null, 'text', [42], ['x'.repeat(101)], ['first\nsecond'], Array(501).fill('Phrase')])('rejects invalid phrase banks', (phrases) => {
    expect(() => validatePlayerDisplay({ announcement: { phrases } })).toThrow()
  })

  it('identifies the original line of an overlong phrase', () => {
    expect(() => validatePlayerDisplay({ announcement: { phrases: ['', 'Valid', 'x'.repeat(101)] } })).toThrow('Línea 3')
  })

  it('randomly selects phrases without immediately repeating the same text', () => {
    expect(pickAnnouncementPhrase(['A', 'B', 'C'], null, () => 0.99)).toBe('C')
    expect(pickAnnouncementPhrase(['A', 'A', 'B', 'C'], 'A', () => 0)).toBe('B')
    expect(pickAnnouncementPhrase(['A', 'B', 'C'], 'A', () => 0.99)).toBe('C')
    expect(pickAnnouncementPhrase(['A', 'A'], 'A')).toBe('A')
    expect(pickAnnouncementPhrase(['', ' '], null)).toBeNull()
  })

  it('shows every announcement before the selected phrase and keeps that selection stable', () => {
    const { announcement } = validatePlayerDisplay({ announcement: {
      messages: [{ title: 'A', text: '' }, { title: 'B', text: '' }],
      phrases: ['First', 'Second'], showPhraseAfterMessages: true,
    } })
    const displayed = Array.from({ length: 9 }, (_, turn) => {
      const { position, phrase } = announcementAtTurn(announcement, turn, 'Second')
      return announcement.messages[position]?.title ?? phrase
    })
    expect(displayed).toEqual(['A', 'B', 'Second', 'A', 'B', 'Second', 'A', 'B', 'Second'])
    for (const settings of [{ ...announcement, phrases: [] }, { ...announcement, showPhraseAfterMessages: false }]) {
      expect(Array.from({ length: 4 }, (_, turn) => announcementAtTurn(settings, turn).position)).toEqual([0, 1, 0, 1])
      expect(announcementAtTurn(settings, 2).phrase).toBeNull()
    }
  })

  it.each([1.01, 3.25, 6.75, 29.99])('preserves fractional animated duration %s', (animatedSeconds) => {
    const settings = validatePlayerDisplay({ logo: { animatedSeconds } })
    expect(settings.logo.animatedSeconds).toBe(animatedSeconds)
    expect(resetDisplayAppearance(settings).logo.animatedSeconds).toBe(animatedSeconds)
  })

  it('keeps legacy brand source and supports independent PNG, GIF-only and alternating resources', () => {
    const png = '11111111-1111-1111-1111-111111111111'
    const gif = '22222222-2222-2222-2222-222222222222'
    expect(validatePlayerDisplay({ logo: { enabled: true } }).logo.source).toBe('brand')
    const custom = validatePlayerDisplay({ logo: { enabled: true, source: 'custom', mode: 'alternating', staticImageId: png, animatedImageId: gif, staticSeconds: 12, animatedSeconds: 3 } })
    expect(resolvePlayerLogo(custom.logo, 'brand.png')).toEqual({
      still: `api/player-logo-images/${png}/image`, fallback: `api/player-logo-images/${gif}/poster`, animated: `api/player-logo-images/${gif}/image`,
    })
    expect(resetDisplayAppearance(custom).logo).toMatchObject({ source: 'custom', mode: 'alternating', staticImageId: png, animatedImageId: gif, staticSeconds: 12, animatedSeconds: 3 })
    const gifOnly = validatePlayerDisplay({ logo: { ...custom.logo, staticImageId: null } })
    expect(resolvePlayerLogo(gifOnly.logo, '').still).toBe(`api/player-logo-images/${gif}/poster`)
    expect(resolvePlayerLogo({ ...custom.logo, source: 'brand' }, 'brand.png')).toEqual({ still: 'brand.png', fallback: '', animated: '' })
  })

  it.each([
    { source: 'remote' }, { mode: 'random' }, { staticImageId: '../../etc/passwd' }, { animatedImageId: 'data:image/gif;base64,x' },
    { enabled: true, source: 'custom' },
    { enabled: true, source: 'custom', mode: 'animated', staticImageId: '11111111-1111-1111-1111-111111111111' },
  ])('rejects invalid logo choices: %j', logo => expect(() => validatePlayerDisplay({ logo })).toThrow())

  it('fills nested defaults and normalizes only allowed fields', () => {
    expect(validatePlayerDisplay({})).toEqual(defaultPlayerDisplay)
    const display = validatePlayerDisplay({ logo: { enabled: true, junk: 1 }, announcement: { backgroundColor: '#6B5143', messages: [{ title: ' Hola ', text: ' Mesa ', html: '<b/>' }] } })
    expect(display.logo).toEqual({ ...defaultPlayerDisplay.logo, enabled: true })
    expect(display.announcement.backgroundColor).toBe('#6b5143')
    expect(display.announcement.messages).toEqual([{ title: 'Hola', text: 'Mesa', image: null, imageScale: 100 }])
  })

  for (const group of ['logo', 'announcement'] as const) {
    for (const [key, [min, max]] of Object.entries(displayLimits[group])) {
      it(`bounds ${group}.${key} and rejects non-finite/non-numeric values`, () => {
        for (const value of [NaN, Infinity, min - 1, max + 1, '20', null]) {
          expect(() => validatePlayerDisplay({ [group]: { [key]: value } })).toThrow()
        }
        for (const value of [min, max]) expect(() => validatePlayerDisplay({ [group]: { [key]: value } })).not.toThrow()
      })
    }
  }

  it.each([null, [], { logo: null }, { logo: { enabled: 1, position: 'middle' } },
    { announcement: { alignment: 'justify' } }, { announcement: { textColor: 'red' } },
    { announcement: { backgroundColor: '#abc' } }, { announcement: { borderColor: 'url(x)' } },
    { announcement: { showIcon: 'true' } }, { announcement: { messages: [] } },
    { announcement: { messages: Array(6).fill({ title: 'Hi', text: '' }) } },
    ...[{ title: ' ' }, { title: 'x'.repeat(61), text: '' }, { title: 'Hi', text: 'x'.repeat(101) }, null]
      .map(message => ({ announcement: { messages: [message] } })),
  ])('rejects invalid settings %j', value => expect(() => validatePlayerDisplay(value)).toThrow())

  it('resets appearance without changing activation, messages or interval', () => {
    const display = validatePlayerDisplay({ logo: { enabled: true, scale: 250 }, announcement: { enabled: true, textScale: 160, intervalSeconds: 30, messages: [{ title: 'Saved', text: 'Message' }] } })
    const reset = resetDisplayAppearance(display)
    expect(reset.logo).toEqual({ ...defaultPlayerDisplay.logo, enabled: true })
    expect(reset.announcement).toEqual({ ...defaultPlayerDisplay.announcement, enabled: true, intervalSeconds: 30, messages: display.announcement.messages })
    reset.announcement.messages[0].title = 'Draft'
    expect(display.announcement.messages[0].title).toBe('Saved')
  })
})

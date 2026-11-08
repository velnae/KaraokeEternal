import { describe, expect, it } from 'vitest'
import { defaultPlayerDisplay, displayLimits, resetDisplayAppearance, validatePlayerDisplay } from './playerDisplay.js'
import { resolvePlayerLogo } from './playerLogo.js'

describe('player display contract', () => {
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
    expect(display.announcement.messages).toEqual([{ title: 'Hola', text: 'Mesa' }])
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

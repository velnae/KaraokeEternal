import { describe, expect, it } from 'vitest'
import { defaultPlayerDisplay, displayLimits, resetDisplayAppearance, validatePlayerDisplay } from './playerDisplay.js'

describe('player display contract', () => {
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

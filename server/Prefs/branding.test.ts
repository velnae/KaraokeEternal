import { describe, expect, it } from 'vitest'
import { validateBranding } from './branding.js'
import { defaultClientBranding, defaultPlayerBranding, MAX_BRANDING_LOGO_BYTES } from '../../shared/branding.js'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='

describe('client branding validation', () => {
  it('accepts normalized public fields and discards unexpected keys', () => {
    expect(validateBranding({ name: '  Venue  ', logoSrc: png, supportUrl: ' https://example.com/help ', isAdmin: true }))
      .toEqual({ ...defaultClientBranding, name: 'Venue', logoSrc: png, supportUrl: 'https://example.com/help' })
    expect(validateBranding(defaultClientBranding)).toEqual(defaultClientBranding)
  })

  it.each([
    [' HTTPS://EXAMPLE.COM/help ', 'https://example.com/help'],
    ['https:example.com', 'https://example.com/'],
    ['https://example.com/ayuda local', 'https://example.com/ayuda%20local'],
    ['   ', ''],
  ])('normalizes the support link %s', (input, expected) => {
    expect(validateBranding({ ...defaultClientBranding, supportUrl: input }).supportUrl).toBe(expected)
  })

  it.each([null, [], {}, { ...defaultClientBranding, name: 5 }, { ...defaultClientBranding, name: 'x'.repeat(101) }])(
    'rejects malformed fields: %j', value => expect(() => validateBranding(value)).toThrow(),
  )

  it.each(['javascript:alert(1)', 'data:text/html,test', '/support', 'http://example.com', 'https://user:pass@example.com'])(
    'rejects an unsafe support URL: %s', (supportUrl) => {
      expect(() => validateBranding({ ...defaultClientBranding, supportUrl })).toThrow('HTTPS')
    },
  )

  it('rejects SVG, disguised content and oversized raster images', () => {
    for (const logoSrc of [
      'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64'),
      'data:image/png;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64'),
      'https://example.com/logo.png',
      'data:image/png;base64,' + Buffer.alloc(MAX_BRANDING_LOGO_BYTES + 1).toString('base64'),
    ]) {
      expect(() => validateBranding({ ...defaultClientBranding, logoSrc })).toThrow()
    }
  })

  it('rejects excessive declared pixel dimensions', () => {
    const image = Buffer.from(png.split(',')[1], 'base64')
    image.writeUInt32BE(100000, 16)
    expect(() => validateBranding({ ...defaultClientBranding, logoSrc: `data:image/png;base64,${image.toString('base64')}` }))
      .toThrow('dimensiones')
  })

  it('rejects a truncated PNG even when its header and dimensions are valid', () => {
    const image = Buffer.from(png.split(',')[1], 'base64').subarray(0, -12)
    expect(() => validateBranding({ ...defaultClientBranding, logoSrc: `data:image/png;base64,${image.toString('base64')}` }))
      .toThrow('PNG')
  })

  it('normalizes player messages and keeps the two visibility settings independent', () => {
    const player = { showLogo: false, showAnnouncements: true, messages: [{ title: '  Bienvenidos  ', text: '  El escenario es suyo.  ', html: '<script/>' }] }
    expect(validateBranding({ ...defaultClientBranding, player }).player).toEqual({
      ...defaultPlayerBranding, showLogo: false, showAnnouncements: true, messages: [{ title: 'Bienvenidos', text: 'El escenario es suyo.' }],
    })
    expect(validateBranding({ ...defaultClientBranding, player: { ...player, showLogo: true, showAnnouncements: false } }).player)
      .toMatchObject({ showLogo: true, showAnnouncements: false })
  })

  it('preserves legacy appearance and normalizes configurable background colors', () => {
    const legacy = { showLogo: true, showAnnouncements: true, messages: [{ title: 'Aviso', text: '' }] }
    expect(validateBranding({ ...defaultClientBranding, player: legacy }).player)
      .toEqual({ ...defaultPlayerBranding, ...legacy })
    expect(validateBranding({ ...defaultClientBranding, player: { ...legacy, alignment: 'center', backgroundColor: '#6B5143' } }).player)
      .toMatchObject({ alignment: 'center', backgroundColor: '#6b5143' })
  })

  it.each([
    { alignment: 'justify' }, { alignment: null }, { backgroundColor: 'brown' },
    { backgroundColor: '#fff' }, { backgroundColor: '#12345678' }, { backgroundColor: '#zzzzzz' },
    { backgroundColor: 'url(https://example.com)' }, { backgroundColor: null },
  ])('rejects invalid appearance: %j', (appearance) => {
    expect(() => validateBranding({ ...defaultClientBranding, player: { ...defaultPlayerBranding, ...appearance } })).toThrow()
  })

  it.each([
    null, [], { ...defaultPlayerBranding, showLogo: 'true' }, { ...defaultPlayerBranding, showAnnouncements: 1 },
    { ...defaultPlayerBranding, messages: [] }, { ...defaultPlayerBranding, messages: Array(6).fill({ title: 'Aviso', text: '' }) },
    ...[null, 'Aviso', { title: ' ', text: '' }, { title: 'x'.repeat(61), text: '' }, { title: 'Aviso', text: 'x'.repeat(101) }, { title: 'Aviso', text: 42 }]
      .map(message => ({ ...defaultPlayerBranding, messages: [message] })),
  ])('rejects invalid player configuration: %j', (player) => {
    expect(() => validateBranding({ ...defaultClientBranding, player })).toThrow()
  })
})

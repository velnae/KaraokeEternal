import { describe, expect, it } from 'vitest'
import { validateBranding } from './branding.js'
import { defaultClientBranding, MAX_BRANDING_LOGO_BYTES } from '../../shared/branding.js'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='

describe('client branding validation', () => {
  it('accepts normalized public fields and discards unexpected keys', () => {
    expect(validateBranding({ name: '  Venue  ', logoSrc: png, supportUrl: ' https://example.com/help ', isAdmin: true }))
      .toEqual({ name: 'Venue', logoSrc: png, supportUrl: 'https://example.com/help' })
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
})

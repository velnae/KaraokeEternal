import { describe, expect, it } from 'vitest'
import { guestNameError, publicGuestName, validateGuestName } from './guestName.js'

describe('guest display names', () => {
  it.each(['José Pérez', 'María-José', 'O’Connor', 'D\'Angelo', 'Concha', 'Ana', 'Ñusta', 'Á'.repeat(24)])('accepts %s', (name) => {
    expect(validateGuestName(name)).toBe(name)
  })
  it('normalizes repeated spaces and composed accents', () => {
    expect(validateGuestName('  Jose\u0301   Pérez  ')).toBe('José Pérez')
  })
  it.each(['', 'A', 'a'.repeat(25), 'Ana María Pérez', 'Ana123', 'Ana😀', 'Ana.com', '-Ana', 'Ana-', 'Ana\u200b', 'Ana\n', 'Ana\tMaría', 'Ana\u202e'])('rejects malformed %j', (name) => {
    expect(() => validateGuestName(name)).toThrow()
  })
  it.each(['PUTA', 'Cójudo', 'Huevón', 'Ana-Puta', 'Sexo Oral', 'Conchatumadre', 'Pendeja', 'P-u-t-a', 'Concha Madre'])('rejects offensive %s', (name) => {
    expect(guestNameError(name)).toBe('Ese nombre no está permitido. Elige otro.')
  })
  it('does not match substrings inside legitimate names', () => {
    expect(guestNameError('Imaculada')).toBeNull()
  })
  it.each([null, {}, 123, ['Ana']])('rejects non-string input %j', (value) => {
    expect(() => validateGuestName(value)).toThrow()
  })
  it('masks invalid legacy names without exposing the original', () => {
    expect(publicGuestName('Nombre Antiguo Largo')).toBe('Invitado')
    expect(publicGuestName('Puta')).toBe('Invitado')
    expect(publicGuestName(' José ')).toBe('José')
  })
})

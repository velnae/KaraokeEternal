import { hasInvisibleCharacters, hasOffensiveText } from './textModeration.js'
const namePattern = new RegExp('^\\p{L}[\\p{L}\\p{M}]*(?:[-\'’][\\p{L}\\p{M}]+)*(?: \\p{L}[\\p{L}\\p{M}]*(?:[-\'’][\\p{L}\\p{M}]+)*)?$', 'u')

export const GUEST_NAME_HELP = 'Usa hasta dos palabras y entre 2 y 24 caracteres.'
export const GUEST_NAME_MAX_LENGTH = 24

export function normalizeGuestName (value: string): string {
  return value.normalize('NFC').trim().replace(/ +/g, ' ')
}

export function guestNameError (value: unknown, terms?: readonly string[]): string | null {
  if (typeof value !== 'string') return GUEST_NAME_HELP
  if (hasInvisibleCharacters(value)) return 'Usa un nombre sin caracteres invisibles ni saltos de línea.'
  const name = normalizeGuestName(value)
  if ([...name].length < 2 || [...name].length > GUEST_NAME_MAX_LENGTH) return 'El nombre debe tener entre 2 y 24 caracteres.'
  if (name.split(' ').length > 2) return 'Escribe solo una o dos palabras.'
  if (!namePattern.test(name)) {
    return 'Usa solo letras; puedes incluir tildes, ñ, guion o apóstrofo dentro del nombre.'
  }
  if (hasOffensiveText(name, terms)) {
    return 'Ese nombre no está permitido. Elige otro.'
  }
  return null
}

export function validateGuestName (value: unknown): string {
  const error = guestNameError(value)
  if (error) throw new Error(error)
  return normalizeGuestName(value as string)
}

export function publicGuestName (name: string): string {
  return guestNameError(name) ? 'Invitado' : normalizeGuestName(name)
}

/** Speech suitability is deliberately separate from permission to use an account. */
export function spokenGuestName (value: string): string {
  if (guestNameError(value)) return 'un invitado'
  const name = normalizeGuestName(value).toLocaleLowerCase('es')
  const words = name.split(/[-'’ ]/)
  if (words.some(word => new RegExp('^(.)\\1+$', 'u').test(word)
    || (/^[a-zñ]+$/.test(word) && word.length >= 3 && !/[aeiouy]/.test(word)))) return 'un invitado'
  return name.replace(new RegExp('(^|[-\'’ ])\\p{L}', 'gu'), letter => letter.toLocaleUpperCase('es'))
}

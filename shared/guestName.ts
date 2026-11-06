// Adapted from LDNOOBW's Spanish list, © 2012–2020 Shutterstock, Inc.
// https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/blob/master/es
// CC BY 4.0: https://creativecommons.org/licenses/by/4.0/
// Curated to omit ambiguous words and legitimate names; extended with Peruvian slang.
const blockedTerms = new Set(`bastardo bollera cabron caca chupada chupapollas
  chupeton coño coprofagia culo esperma follador follar gilipichis gilipollas
  hijaputa hijoputa idiota imbecil jilipollas kapullo lameculos macizorra
  mamada marica maricon mariconazo mierda nazi pedo pendejo pervertido
  pezon pinche prostituta puta racista ramera sadico semen sexo soplagaitas
  soplapollas verga vulva carajo cojudo cojuda conchatumadre conchesumadre
  ctm huevon huevona huevonazo weon webon reconchatumadre puto putas putos
  cabrones cojudos cojudas pendeja pendejos pendejas`.split(/\s+/))
const blockedPhrases = ['sexo oral', 'tetas grandes', 'tia buena', 'concha madre']
const invisibleCharacters = new RegExp('[\\p{C}\\p{Zl}\\p{Zp}]', 'u')
const namePattern = new RegExp('^\\p{L}[\\p{L}\\p{M}]*(?:[-\'’][\\p{L}\\p{M}]+)*(?: \\p{L}[\\p{L}\\p{M}]*(?:[-\'’][\\p{L}\\p{M}]+)*)?$', 'u')
const accentMarks = new RegExp('\\p{M}', 'gu')

export const GUEST_NAME_HELP = 'Usa hasta dos palabras y entre 2 y 24 caracteres.'
export const GUEST_NAME_MAX_LENGTH = 24

export function normalizeGuestName (value: string): string {
  return value.normalize('NFC').trim().replace(/ +/g, ' ')
}

export function guestNameError (value: unknown): string | null {
  if (typeof value !== 'string') return GUEST_NAME_HELP
  if (invisibleCharacters.test(value)) return 'Usa un nombre sin caracteres invisibles ni saltos de línea.'
  const name = normalizeGuestName(value)
  if ([...name].length < 2 || [...name].length > GUEST_NAME_MAX_LENGTH) return 'El nombre debe tener entre 2 y 24 caracteres.'
  if (name.split(' ').length > 2) return 'Escribe solo una o dos palabras.'
  if (!namePattern.test(name)) {
    return 'Usa solo letras; puedes incluir tildes, ñ, guion o apóstrofo dentro del nombre.'
  }
  // Keep ñ distinct while folding accents for moderation only.
  const folded = name.toLowerCase().split('ñ').map(part => part.normalize('NFD').replace(accentMarks, '')).join('ñ')
  const words = [...folded.split(/[ '\-’]+/), ...folded.split(' ').map(word => word.replace(/[-'’]/g, ''))]
  if (words.some(word => blockedTerms.has(word)) || blockedPhrases.includes(folded)) {
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

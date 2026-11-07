// Adapted from LDNOOBW's Spanish list, © 2012–2020 Shutterstock, Inc.
// https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/blob/master/es
// CC BY 4.0: https://creativecommons.org/licenses/by/4.0/
// Curated to omit ambiguous words and legitimate names; extended with Peruvian slang.
const blockedTerms = `bastardo bollera cabron caca chupada chupapollas
  chupeton coño coprofagia culo esperma follador follar gilipichis gilipollas
  hijaputa hijoputa idiota imbecil jilipollas kapullo lameculos macizorra
  mamada marica maricon mariconazo mierda nazi pedo pendejo pervertido
  pezon pinche prostituta puta racista ramera sadico semen sexo soplagaitas
  soplapollas verga vulva carajo cojudo cojuda conchatumadre conchesumadre
  ctm huevon huevona huevonazo weon webon reconchatumadre puto putas putos
  cabrones cojudos cojudas pendeja pendejos pendejas`.split(/\s+/)
const blockedPhrases = ['sexo oral', 'tetas grandes', 'tia buena', 'concha madre', 'concha de tu madre', 'hijo de puta', 'hija de puta']
const invisibleCharacters = new RegExp('[\\p{C}\\p{Zl}\\p{Zp}]', 'u')
const accentMarks = new RegExp('\\p{M}', 'gu')
const wordSeparators = new RegExp('[^\\p{L}\\p{N}]+', 'u')
const substitutions: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' }
const termPattern = new RegExp('^[\\p{L}\\p{N}]+(?: [\\p{L}\\p{N}]+)*$', 'u')

export interface ModerationSettings { terms: string[] }
export const MODERATION_MAX_TERMS = 500
export const MODERATION_MAX_TERM_LENGTH = 80
export const defaultModeration: ModerationSettings = { terms: [...blockedTerms, ...blockedPhrases].sort() }
let activeTerms: readonly string[] = defaultModeration.terms

// The server installs its persisted dictionary when opening the database and after saving.
// UI callers pass their Redux snapshot explicitly so updates trigger rendering.
export function setModerationTerms (terms: readonly string[]) {
  activeTerms = [...terms]
}

export const hasInvisibleCharacters = (value: string) => invisibleCharacters.test(value)

function normalizedText (value: string): string {
  // Normalize only the comparison key, never the user's displayed text. Keep ñ distinct.
  return value.normalize('NFKC').toLowerCase().split('ñ')
    .map(part => part.normalize('NFD').replace(accentMarks, '')).join('ñ')
}

const comparisonText = (value: string) => normalizedText(value).replace(/[013457@$]/g, char => substitutions[char])

export function normalizeModerationTerm (value: unknown): string {
  if (typeof value !== 'string' || value.length > 160 || hasInvisibleCharacters(value)) throw new Error('Escribe una palabra o frase válida.')
  const term = normalizedText(value).trim().replace(/ +/g, ' ')
  if (term.length < 2 || [...term].length > MODERATION_MAX_TERM_LENGTH || !termPattern.test(term)) {
    throw new Error('Usa entre 2 y 80 caracteres: letras, números y espacios.')
  }
  return term
}

export function validateModeration (value: unknown): ModerationSettings {
  const terms = (value as Partial<ModerationSettings> | null)?.terms
  if (!Array.isArray(terms) || terms.length > MODERATION_MAX_TERMS) throw new Error('El diccionario admite hasta 500 palabras o frases.')
  return { terms: [...new Set(terms.map(normalizeModerationTerm))].sort() }
}

export function findBlockedTerm (value: string, terms: readonly string[] = activeTerms): string | null {
  const folded = comparisonText(value)
  const words = folded.split(wordSeparators).filter(Boolean)
  const joined = folded.replace(/[.\-'’_*]/g, '').split(wordSeparators)
  const tokens = new Set([...words, ...joined])
  const phrase = ` ${words.join(' ')} `
  return terms.find((term) => {
    const key = comparisonText(term)
    return key.includes(' ') ? phrase.includes(` ${key} `) : tokens.has(key)
  }) ?? null
}

export const hasOffensiveText = (value: string, terms?: readonly string[]): boolean => findBlockedTerm(value, terms) !== null

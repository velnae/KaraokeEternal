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
const blockedPhrases = ['sexo oral', 'tetas grandes', 'tia buena', 'concha madre', 'concha de tu madre', 'hijo de puta', 'hija de puta']
const invisibleCharacters = new RegExp('[\\p{C}\\p{Zl}\\p{Zp}]', 'u')
const accentMarks = new RegExp('\\p{M}', 'gu')
const wordSeparators = new RegExp('[^\\p{L}\\p{N}]+', 'u')
const substitutions: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' }

export const hasInvisibleCharacters = (value: string) => invisibleCharacters.test(value)

export function hasOffensiveText (value: string): boolean {
  // Normalize only the comparison key, never the user's displayed text. Keep ñ distinct.
  const folded = value.normalize('NFKC').toLowerCase().split('ñ')
    .map(part => part.normalize('NFD').replace(accentMarks, '')).join('ñ')
    .replace(/[013457@$]/g, char => substitutions[char])
  const words = folded.split(wordSeparators).filter(Boolean)
  const joined = folded.replace(/[.\-'’_*]/g, '').split(wordSeparators)
  return [...words, ...joined].some(word => blockedTerms.has(word))
    || blockedPhrases.some(phrase => ` ${words.join(' ')} `.includes(` ${phrase} `))
}

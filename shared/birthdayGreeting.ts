import { validateBirthdayScript } from './birthdays.js'

export const birthdayGreetingWords = 45
export const birthdayBrandClosing = 'La pizzería Il Gatto se suma con alegría.'
const normalize = (text: string) => text.normalize('NFC').trim().replace(/\s+/g, ' ')
export const birthdayClosing = (name: string) => `¡feliz cumpleaños, ${normalize(name)}!`
export const birthdayGreetingStart = (name: string) => `${normalize(name)}…`
export const birthdayWordCount = (text: string) => normalize(text).split(' ').filter(Boolean).length

export function validateBirthdayNameBudget (name: string) {
  // The complete name occurs twice; even the shortest venue mention needs two words.
  if (birthdayWordCount(name) * 2 + 4 > birthdayGreetingWords) throw new Error('El nombre completo no deja espacio para el saludo de 45 palabras. Use un nombre más corto para el saludo.')
}

export function birthdayOpening (text: string, name: string) {
  const escaped = normalize(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const body = normalize(text).replace(new RegExp(`^(?:${escaped}|\\[nombre\\])(?:…|\\.{3}|[,.:!?])\\s*`, 'u'), '')
  return body.split(/[.!?…]/)[0].trim()
}

export function validateBirthdayGreeting (value: unknown, name: string, dedication = '', requireOpening = true) {
  const text = typeof value === 'string' ? normalize(value) : ''
  const tables = new Set([...dedication.matchAll(/\bmesa\s+(\d{1,3})\b/gi)].map(match => match[1]))
  const checked = text.replace(/\bmesa\s+(\d{1,3})\b/gi, (phrase, number: string) => tables.has(number) ? 'mesa' : phrase)
  validateBirthdayScript(checked, name)
  if (requireOpening) {
    validateBirthdayNameBudget(name)
    if (!text.startsWith(`${birthdayGreetingStart(name)} `) && !text.startsWith(`${normalize(name)}... `)) throw new Error(`El saludo debe empezar con «${birthdayGreetingStart(name)}» y continuar después de una pausa.`)
  }
  if (birthdayWordCount(text) > birthdayGreetingWords) throw new Error('El saludo completo debe tener como máximo 45 palabras, incluida la dedicatoria y el cierre.')
  if (!text.endsWith(birthdayClosing(name))) throw new Error(`El saludo debe terminar exactamente con «${birthdayClosing(name)}».`)
  if (!/\bIl Gatto\b/.test(text.slice(0, -birthdayClosing(name).length))) throw new Error('Incluya a la pizzería Il Gatto antes del cierre.')
  return text
}

export function replaceBirthdayPreviewName (script: string, previous: string, next: string) {
  const escaped = normalize(previous).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (!escaped) return script
  return script.replace(new RegExp(`(?<![\\p{L}\\p{M}])${escaped}(?![\\p{L}\\p{M}])`, 'gu'), () => normalize(next))
}

import { expect, it } from 'vitest'
import { GREETING_LIMIT, greetingMessageLength, greetingMessageLimit, greetingText, normalizeGreetingMessage, validateGreeting } from './greetings.js'

it('reserves the automatic sender in the single-message allowance', () => {
  const sender = 'Ana María'
  const max = greetingMessageLimit(sender)
  const draft = { message: 'x'.repeat(max) }
  expect([...greetingText(draft, sender)]).toHaveLength(GREETING_LIMIT)
  expect(() => validateGreeting(draft, sender)).not.toThrow()
  expect(() => validateGreeting({ ...draft, message: draft.message + 'x' }, sender)).toThrow('220')
})

it('uses the same Unicode normalization for the counter and saved message', () => {
  const text = 'di\u0301a 🦙'
  expect(greetingMessageLength(text)).toBe(5)
  expect(normalizeGreetingMessage(` ${text} `)).toBe('día 🦙')
  expect(() => normalizeGreetingMessage(null)).toThrow()
})

it('normalizes spacing and returns only the message contract', () => {
  expect(validateGreeting({ message: '  ¡Feliz\n cumpleaños,\tMaría!  ', recipient: 'Ignored legacy field' }, 'Ana'))
    .toEqual({ message: '¡Feliz cumpleaños, María!' })
})

it.each(['¡Eres un COJUDO!', 'Qué p3nd3jo', 'p.u.t.a', 'Una concha de tu madre aquí', 'Hola\u200b', 'Hola\u202e'])('rejects unsafe greeting %s', (message) => {
  expect(() => validateGreeting({ message }, 'Ana')).toThrow()
})

it.each(['¡Feliz cumpleaños, María!', 'Cumples 21 años. ¡A celebrar!', 'Concha, te queremos.', 'Un saludo para Imaculada', '¡Gracias, equipo! 🦙'])('accepts ordinary phrases %s', (message) => {
  expect(validateGreeting({ message }, 'José')).toEqual({ message })
})

it.each(['Puta', 'Nombre De Tres', 'Ana123', 'A'.repeat(25)])('rejects an invalid sender %s', (sender) => {
  expect(() => validateGreeting({ message: 'Feliz día' }, sender)).toThrow('Mi cuenta')
})

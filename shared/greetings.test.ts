import { expect, it } from 'vitest'
import { GREETING_LIMIT, greetingMessageLength, greetingMessageLimit, greetingText, normalizeGreetingMessage, validateGreeting } from './greetings.js'

it('reserves the automatic sender in the single-message allowance', () => {
  const sender = 'Ana 🦙'
  const max = greetingMessageLimit(sender)
  const draft = { recipient: '', message: 'x'.repeat(max) }
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

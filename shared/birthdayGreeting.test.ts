import { expect, it } from 'vitest'
import { birthdayBrandClosing, birthdayClosing, birthdayOpening, birthdayWordCount, replaceBirthdayPreviewName, validateBirthdayGreeting, validateBirthdayNameBudget } from './birthdayGreeting.js'
import { birthdayPreviewScript } from './birthdayPreview.js'

it('accepts exactly45 words and rejects46 before speech generation', () => {
  const exact = `María… ${'Cariño '.repeat(33)}${birthdayBrandClosing} ${birthdayClosing('María')}`
  expect(birthdayWordCount(exact)).toBe(45)
  expect(validateBirthdayGreeting(exact, 'María')).toBe(exact)
  expect(() => validateBirthdayGreeting(exact.replace('María… ', 'María… Hoy '), 'María')).toThrow('45 palabras')
})

it('requires the exact final name sentence and the venue before it', () => {
  const valid = birthdayPreviewScript('María')
  expect(validateBirthdayGreeting(valid, 'María')).toBe(valid)
  expect(() => validateBirthdayGreeting(`${valid} Un abrazo.`, 'María')).toThrow('terminar exactamente')
  expect(() => validateBirthdayGreeting(valid.replace('¡feliz cumpleaños, María!', '¡Feliz cumpleaños, María!'), 'María')).toThrow('terminar exactamente')
  expect(() => validateBirthdayGreeting(`María… ${birthdayClosing('María')}`, 'María')).toThrow('Il Gatto')
})

it('counts the complete multiword name and supports the longest valid preview name', () => {
  for (const name of ['María Alejandra de los Ángeles', 'M'.repeat(60), Array(17).fill('A').join(' ')]) {
    const script = birthdayPreviewScript(name)
    expect(birthdayWordCount(script)).toBeLessThanOrEqual(45)
    expect(validateBirthdayGreeting(script, name)).toBe(script)
  }
})

it('allows only the table numbers supplied in the optional dedication', () => {
  const text = `María… Con cariño, de tus amigos de la mesa 05. ${birthdayBrandClosing} ${birthdayClosing('María')}`
  expect(validateBirthdayGreeting(text, 'María', 'De tus amigos de la mesa 05')).toBe(text)
  expect(() => validateBirthdayGreeting(text, 'María')).toThrow('privacidad')
  expect(() => validateBirthdayGreeting(text.replace('mesa 05', 'mesa 06'), 'María', 'mesa 05')).toThrow('privacidad')
})

it('requires the complete name first, followed by an ellipsis and greeting', () => {
  const text = birthdayPreviewScript('María José')
  expect(text.startsWith('María José… ')).toBe(true)
  expect(validateBirthdayGreeting(text.replace('María José…', 'María José...'), 'María José')).toContain('María José...')
  expect(() => validateBirthdayGreeting(`Hola, ${text}`, 'María José')).toThrow('debe empezar')
  expect(() => validateBirthdayGreeting(text.replace('María José…', 'María…'), 'María José')).toThrow('debe empezar')
})

it('extracts the greeting body after a name instead of treating that mandatory prefix as a repeated opening', () => {
  expect(birthdayOpening('Ana. Que esta noche sea inolvidable. Il Gatto celebra.', 'Ana')).toBe('Que esta noche sea inolvidable')
  expect(birthdayOpening('María… Hoy celebramos contigo. Il Gatto celebra.', 'María')).toBe('Hoy celebramos contigo')
  expect(birthdayOpening('[nombre], Hoy celebramos contigo.', 'María')).toBe('Hoy celebramos contigo')
})

it('rejects impossible repeated-name word budgets without truncating the name', () => {
  const name = Array(21).fill('A').join(' ')
  expect(() => validateBirthdayNameBudget(name)).toThrow('nombre completo')
  expect(birthdayPreviewScript(name)).toContain(`${name}…`)
})

it('replaces complete names without expanding a partial name inside another word', () => {
  expect(replaceBirthdayPreviewName('Sandra, un abrazo. ¡feliz cumpleaños, Sandra!', 'Sandr', 'Sandra')).toBe('Sandra, un abrazo. ¡feliz cumpleaños, Sandra!')
  expect(replaceBirthdayPreviewName('Ana, celebramos con Anabel. ¡feliz cumpleaños, Ana!', 'Ana', 'María')).toBe('María, celebramos con Anabel. ¡feliz cumpleaños, María!')
  expect(replaceBirthdayPreviewName(birthdayClosing('Ana M.'), 'Ana M.', 'Lucía')).toBe(birthdayClosing('Lucía'))
})

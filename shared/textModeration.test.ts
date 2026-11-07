import { expect, it } from 'vitest'
import { defaultModeration, findBlockedTerm, hasOffensiveText, normalizeModerationTerm, validateModeration } from './textModeration.js'

it.each(['PUTA', 'pútá', 'ｐｕｔａ', 'p.u.t.a', 'p-u-t-a', 'p_ut_a', 'p3nd3jo', 'm13rd4', 'put@', 'Eres un huevón.', 'Una tía buena aquí'])('filters variants of %s', (text) => {
  expect(hasOffensiveText(text)).toBe(true)
})
it.each(['Concha', 'Imaculada', 'computadora', 'Disfruta tu día', '¡Feliz cumpleaños número 25!', 'Ñusta'])('does not match innocent fragments in %s', (text) => {
  expect(hasOffensiveText(text)).toBe(false)
})

it('normalizes and deduplicates dictionary entries while preserving ñ and digits', () => {
  expect(validateModeration({ terms: ['  ÁRBOL ', 'arbol', ' FIESTA   21 ', 'Ñusta'] }))
    .toEqual({ terms: ['arbol', 'fiesta 21', 'ñusta'] })
  expect(validateModeration(defaultModeration)).toEqual(defaultModeration)
})

it.each([null, {}, { terms: 'bad' }, { terms: [4] }, { terms: ['a'] }, { terms: ['Hola\u200b'] }, { terms: ['x'.repeat(81)] }, { terms: Array(501).fill('bad') }])('rejects invalid dictionary %j', (value) => {
  expect(() => validateModeration(value)).toThrow()
})

it('matches custom words and phrases with the same rules and identifies the term', () => {
  const { terms } = validateModeration({ terms: ['Maravilla', 'fiesta privada'] })
  expect(findBlockedTerm('¡Es una MARAVÍLLA!', terms)).toBe('maravilla')
  expect(findBlockedTerm('Una fiesta, privada aquí', terms)).toBe('fiesta privada')
  expect(findBlockedTerm('maravillado', terms)).toBeNull()
  expect(hasOffensiveText('Puta', terms)).toBe(false)
  expect(hasOffensiveText('Puta', [])).toBe(false)
  expect(normalizeModerationTerm('FIESTA 21')).toBe('fiesta 21')
})

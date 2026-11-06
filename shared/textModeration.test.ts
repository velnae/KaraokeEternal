import { expect, it } from 'vitest'
import { hasOffensiveText } from './textModeration.js'

it.each(['PUTA', 'pútá', 'ｐｕｔａ', 'p.u.t.a', 'p-u-t-a', 'p_ut_a', 'p3nd3jo', 'm13rd4', 'put@', 'Eres un huevón.', 'Una tía buena aquí'])('filters variants of %s', (text) => {
  expect(hasOffensiveText(text)).toBe(true)
})
it.each(['Concha', 'Imaculada', 'computadora', 'Disfruta tu día', '¡Feliz cumpleaños número 25!', 'Ñusta'])('does not match innocent fragments in %s', (text) => {
  expect(hasOffensiveText(text)).toBe(false)
})

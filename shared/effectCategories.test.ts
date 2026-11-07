import { expect, it } from 'vitest'
import { isMusicalCurtain } from './effectCategories.js'

it.each([
  [{ kind: 'effect', effectType: 'transition' }, true],
  [{ kind: 'effect', effectType: 'short', category: 'transition' }, true],
  [{ kind: 'effect', category: 'Separador musical' }, true],
  [{ kind: 'effect', category: 'Transición musical' }, true],
  [{ kind: 'effect', effectType: 'short', category: 'celebration' }, false],
  [{ kind: 'effect', category: 'appreciation' }, false],
  [{ kind: 'voice', category: 'transition' }, false],
  [{ kind: 'ambience', category: 'transition' }, false],
] as const)('classifies musical curtains without treating other audio as curtains: %j', (clip, expected) => {
  expect(isMusicalCurtain(clip)).toBe(expected)
})

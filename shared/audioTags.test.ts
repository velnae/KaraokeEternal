import { expect, it } from 'vitest'
import { normalizeTaggedText, validAudioTagSyntax, withoutAudioTags } from './audioTags.js'

it('accepts descriptive tags, retains paragraph structure and removes directions from displayed speech', () => {
  const text = '[excited] ¡Hola!\r\n[con voz débil] Bienvenidos. [low, gravelly voice] Gracias.'
  expect(validAudioTagSyntax(text)).toBe(true)
  expect(normalizeTaggedText(text)).toContain('¡Hola!\n')
  expect(withoutAudioTags(text)).toBe('¡Hola! Bienvenidos. Gracias.')
  expect(validAudioTagSyntax('[] Hola')).toBe(false)
  expect(validAudioTagSyntax('[excited Hola')).toBe(false)
  expect(validAudioTagSyntax('[[laughs]]')).toBe(false)
})

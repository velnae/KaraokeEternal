import { describe, expect, it } from 'vitest'
import { celebrationYear, publicBirthday, selectBirthdayVoice, validateBirthdayInput, validateBirthdayScript, validateBirthdaySettings, defaultBirthdaySettings } from './birthdays.js'
import { birthdayWaitSeconds, playbackSequence } from './playbackSequence.js'

describe('birthday private context and presets', () => {
  it('uses the local celebration year, including the UTC new-year boundary', () => {
    expect(celebrationYear(new Date('2027-01-01T03:00:00Z'))).toBe(2026)
    expect(celebrationYear(new Date('2027-01-01T05:00:00Z'))).toBe(2027)
    expect(validateBirthdayInput({ name: '  María  José ', sex: 'female', birthYear: 2000 }, 2026)).toEqual({ name: 'María José', sex: 'female', birthYear: 2000 })
  })
  it.each([2027, 1800, 2000.5, '2000', null])('rejects invalid birth year %s', (birthYear) => {
    expect(() => validateBirthdayInput({ name: 'María', sex: 'female', birthYear }, 2026)).toThrow('año')
  })
  it('selects saved voices by age and sex, with an explicit default', () => {
    const config = validateBirthdaySettings({ ...defaultBirthdaySettings, textModel: 'text-model', defaultVoiceId: 'default', rules: [
      { sex: 'female', minAge: 18, maxAge: 30, voiceId: 'special' },
    ] })
    expect(selectBirthdayVoice(config, { name: 'María', sex: 'female', birthYear: 2000 }, 2026)).toBe('special')
    expect(selectBirthdayVoice(config, { name: 'María', sex: 'female', birthYear: 1990 }, 2026)).toBe('default')
    expect(() => validateBirthdaySettings({ ...config, rules: [...config.rules, { sex: 'female', minAge: 30, maxAge: 40, voiceId: 'other' }] })).toThrow('superponerse')
  })
  it.each(['María, cumples 26 años.', 'María, tus veintiséis años son especiales.', 'María, una gran mujer.', 'María, naciste en el año dos mil.', 'María, tu juventud nos inspira.', 'María, tenemos un cóctel para ti.', 'María, tu sexo es femenino.', 'María, felices treinta.'])('rejects demographic or specific-gift disclosure: %s', (script) => {
    expect(() => validateBirthdayScript(script, 'María')).toThrow('privacidad')
  })
  it('accepts a genuinely longer public greeting', () => {
    const script = 'María, celebramos contigo una noche llena de alegría. Que cada canción te regale una sonrisa y que este encuentro se convierta en uno de esos recuerdos que siempre dan ganas de volver a vivir. Gracias por compartir tu cumpleaños con nosotros. ¡Que la música acompañe tus sueños y que nunca falten motivos para celebrar!'
    expect(script.length).toBeGreaterThan(220)
    expect(validateBirthdayScript(script, 'María')).toBe(script)
  })
})

it('publishes only explicit public fields and inserts the event without changing song order', () => {
  const event = publicBirthday({ id: 'event', name: 'María', playback: 'scheduled', preparation: 'ready', phase: null, durationMs: 90000, startedAt: null,
    sex: 'female', birthYear: 2000, script: 'private', voiceId: 'private' } as Parameters<typeof publicBirthday>[0])
  expect(Object.keys(event)).toEqual(['id', 'name', 'playback', 'preparation', 'phase', 'durationMs', 'startedAt'])
  expect(playbackSequence([1, 2, 3], [event], 1)).toEqual([{ kind: 'song', queueId: 1 }, { kind: 'birthday', event }, { kind: 'song', queueId: 2 }, { kind: 'song', queueId: 3 }])
  expect(playbackSequence([], [event], -1)).toEqual([{ kind: 'birthday', event }])
  expect(birthdayWaitSeconds([event])).toBe(90)
  expect(birthdayWaitSeconds([{ ...event, playback: 'playing', startedAt: 1000 }], 11000)).toBe(80)
})

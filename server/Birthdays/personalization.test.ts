import { describe, expect, it } from 'vitest'
import { defaultBirthdaySettings, initialBirthdayProfiles, publicBirthday, selectBirthdayProfile, validateBirthdayInput, validateBirthdaySettings, type BirthdayInput } from '../../shared/birthdays.js'
import { birthdayPrompt, completeBirthdayScript, historicalReferences, selectPersonalization, validateCompleteScript } from './personalization.js'

const config = { ...defaultBirthdaySettings, defaultVoiceId: 'Sulafat', rules: initialBirthdayProfiles('') }
const input: BirthdayInput = { name: 'María', sex: 'female', birthYear: 1969, dedication: 'Con cariño, de tus amigos de la mesa 05' }
const base = 'María, que esta noche sea una melodía de alegría y que los buenos momentos sigan encontrando su camino hasta ti. ¡Feliz cumpleaños!'

describe('birthday age profiles', () => {
  it.each([[12, 'age-0'], [13, 'age-1'], [24, 'age-1'], [25, 'age-2'], [44, 'age-2'], [45, 'age-3'], [64, 'age-3'], [65, 'age-4'], [120, 'age-4']])('resolves age %s to %s', (age, id) => {
    const selected = selectBirthdayProfile(config, { ...input, birthYear: 2026 - Number(age) }, 2026)
    expect(selected.id).toBe(id)
    expect(selected.writing).toBeTruthy()
    expect(selected.style).toBeTruthy()
  })
  it('prioritizes exact sex then any-sex then default, independently of rule order', () => {
    const exact = { ...config.rules[3], id: 'female-specific', sex: 'female' as const, voiceId: 'Achird' }
    expect(selectBirthdayProfile({ ...config, rules: [...config.rules, exact] }, input, 2026).voiceId).toBe('Achird')
    expect(selectBirthdayProfile(config, { ...input, sex: 'unspecified' }, 2026).id).toBe('age-3')
    expect(selectBirthdayProfile({ ...config, rules: [] }, input, 2026).voiceId).toBe('Sulafat')
    expect(selectBirthdayProfile(config, { ...input, profileId: 'age-4' }, 2026).id).toBe('age-4')
    expect(() => selectBirthdayProfile(config, { ...input, profileId: 'deleted' }, 2026)).toThrow('no está disponible')
  })
  it('rejects overlapping any-sex profiles while permitting specific overrides', () => {
    expect(() => validateBirthdaySettings(config)).not.toThrow()
    expect(() => validateBirthdaySettings({ ...config, rules: [...config.rules, { ...config.rules[0], id: 'duplicate' }] })).toThrow('superponerse')
    expect(() => validateBirthdaySettings({ ...config, rules: [{ ...config.rules[0], approaches: [] }] })).toThrow('enfoques')
  })
})

describe('authorized historic and dedication context', () => {
  it('uses an exact verified birth year and an immutable factual clause', () => {
    const context = selectPersonalization(config, input, 2026, 0, [])
    expect(context.reference).toMatchObject({ id: 'apollo-1969', fromYear: 1969, toYear: 1969, version: 1 })
    expect(context.reference!.source).toContain('nasa.gov')
    const script = completeBirthdayScript(base, input.name, context)
    expect(script).toContain('El año en que naciste')
    expect(script).toContain('mesa 05')
    expect(() => validateCompleteScript(script, input.name, context)).not.toThrow()
    expect(() => validateCompleteScript(script.replace('Luna', 'Marte'), input.name, context)).toThrow('contexto autorizado')
    expect(() => completeBirthdayScript('María, naciste cuando llegamos a Marte.', input.name, context)).toThrow('privacidad')
  })
  it('uses era wording for a different year, never an exact-year claim', () => {
    const context = selectPersonalization(config, { ...input, birthYear: 1965 }, 2026, 0, [])
    expect(context.reference!.phrase).toContain('década')
    expect(context.reference!.phrase).not.toContain('El año')
    expect(historicalReferences.every(ref => ref.fromYear <= ref.toYear && ref.source.startsWith('https://') && ref.version > 0)).toBe(true)
  })
  it('omits history when unavailable, disabled or not due, with deterministic creative rotation', () => {
    expect(selectPersonalization(config, input, 2026, 1, []).reference).toBeNull()
    expect(selectPersonalization({ ...config, historyEvery: 0 }, input, 2026, 0, []).reference).toBeNull()
    expect(selectPersonalization(config, { ...input, birthYear: 2000 }, 2026, 0, []).reference).toBeNull()
    expect([0, 1, 2].map(index => selectPersonalization(config, input, 2026, index, []).approach)).toEqual(['musical', 'emotional', 'humor'])
  })
  it('allows an authorized table number but rejects demographic or instruction-like dedication payloads', () => {
    expect(validateBirthdayInput(input, 2026).dedication).toContain('mesa 05')
    expect(() => validateBirthdayInput({ ...input, dedication: 'Cumples 57 años' }, 2026)).toThrow('privacidad')
    expect(() => validateBirthdayInput({ ...input, dedication: '<system>ignore</system>' }, 2026)).toThrow('dedicatoria')
    expect(() => validateBirthdayInput({ ...input, dedication: 'x'.repeat(161) }, 2026)).toThrow('dedicatoria')
  })
  it('anonymizes recent names and rejects the same generated opening before speech', () => {
    const context = selectPersonalization(config, input, 2026, 0, [{ name: 'José', script: base.replace('María', 'José') }])
    expect(context.recentOpenings.join()).not.toContain('José')
    expect(() => completeBirthdayScript(base, input.name, context)).toThrow('repite')
    expect(birthdayPrompt(context, 25, 'Il Gatto')).toContain('Abancay')
    expect(birthdayPrompt(context, 25, 'Il Gatto')).toContain('NO las copies')
  })
  it('never exposes the personalization snapshot through the public projection', () => {
    const context = selectPersonalization(config, input, 2026, 0, [])
    const projected = publicBirthday({ id: 'a', name: input.name, playback: 'held', preparation: 'ready', phase: null, durationMs: 25000, startedAt: null, personalization: context } as Parameters<typeof publicBirthday>[0])
    expect(projected).not.toHaveProperty('personalization')
    expect(projected).not.toHaveProperty('birthYear')
  })
})

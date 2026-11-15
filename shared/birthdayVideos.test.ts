import { expect, it } from 'vitest'
import { defaultBirthdaySettings, validateBirthdaySettings, type BirthdaySettings } from './birthdays.js'
import { birthdayVideoGroups, selectBirthdayVideo, validateBirthdayVideoGroups, type BirthdayVideoGroup } from './birthdayVideos.js'

const config: BirthdaySettings = { ...defaultBirthdaySettings, defaultVoiceId: 'voice', videoId: 'default', videoBackgrounds: {
  female: { videoId: 'female', ranges: [{ id: 'young', minAge: 0, maxAge: 12, videoId: 'young' }, { id: 'inherit', minAge: 13, maxAge: 24, videoId: null }] },
  male: { videoId: null, ranges: [{ id: 'older', minAge: 65, maxAge: 120, videoId: 'older' }] },
} }
it.each([
  ['female', 0, 'young', 'age'], ['female', 12, 'young', 'age'], ['female', 13, 'female', 'sex'],
  ['female', 24, 'female', 'sex'], ['female', 25, 'female', 'sex'], ['male', 64, 'default', 'default'],
  ['male', 65, 'older', 'age'], ['male', 120, 'older', 'age'], ['unspecified', 12, 'default', 'default'],
] as const)('resolves %s age %i to %s (%s)', (sex, age, videoId, level) => {
  expect(selectBirthdayVideo(config, { sex, birthYear: 2026 - age }, 2026)).toMatchObject({ videoId, level })
})

it('materializes legacy precedence including exact-sex profiles that inherit the general background', () => {
  const legacy: BirthdaySettings = { ...config, videoBackgrounds: undefined, rules: [
    { sex: 'any', minAge: 0, maxAge: 120, voiceId: 'voice', videoId: 'common' },
    { sex: 'female', minAge: 20, maxAge: 29, voiceId: 'voice' },
    { sex: 'male', minAge: 0, maxAge: 19, voiceId: 'voice', videoId: 'specific' },
  ] }
  const migrated = validateBirthdaySettings(legacy)
  expect(selectBirthdayVideo(migrated, { sex: 'female', birthYear: 2000 }, 2026).videoId).toBe('default')
  expect(selectBirthdayVideo(migrated, { sex: 'female', birthYear: 1990 }, 2026).videoId).toBe('common')
  expect(selectBirthdayVideo(migrated, { sex: 'male', birthYear: 2010 }, 2026).videoId).toBe('specific')
  expect(selectBirthdayVideo(migrated, { sex: 'unspecified', birthYear: 2010 }, 2026).videoId).toBe('common')
  expect(legacy.videoBackgrounds).toBeUndefined()
  expect(birthdayVideoGroups({ ...migrated, rules: [] })).toEqual(migrated.videoBackgrounds)
  expect(selectBirthdayVideo({ ...migrated, videoBackgrounds: {} }, { sex: 'male', birthYear: 2010 }, 2026).videoId).toBe('default')
})

it.each([
  null, [], { any: { videoId: null, ranges: [] } }, { female: { videoId: '../foreign', ranges: [] } },
  { female: { videoId: null, ranges: [{ id: 'invalid', minAge: 20, maxAge: 19, videoId: null }] } },
  { female: { videoId: null, ranges: [{ id: 'invalid', minAge: 0.5, maxAge: 12, videoId: null }] } },
  { female: { videoId: null, ranges: [{ id: 'invalid', minAge: 0, maxAge: 121, videoId: null }] } },
  { female: { videoId: null, ranges: [{ id: 'first', minAge: 0, maxAge: 12, videoId: null }, { id: 'next', minAge: 12, maxAge: 18, videoId: null }] } },
])('rejects invalid or ambiguous hierarchy %#', (input) => {
  expect(() => validateBirthdayVideoGroups(input)).toThrow()
})

it('allows gaps and the same ages in different sexes, preserving explicit inheritance', () => {
  const group: BirthdayVideoGroup = { videoId: null, ranges: [{ id: 'range', minAge: 20, maxAge: 30, videoId: null }] }
  expect(validateBirthdayVideoGroups({ female: group, male: group })).toEqual({ female: group, male: group })
})

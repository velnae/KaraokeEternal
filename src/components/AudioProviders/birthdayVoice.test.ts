import { expect, it } from 'vitest'
import { defaultBirthdaySettings } from '../../../shared/birthdays.js'
import { changeBirthdayProvider } from './birthdayVoice'

it('requires new provider voices while preserving birthday profile definitions, resources and revisions', () => {
  const original = { ...defaultBirthdaySettings, revision: 7, introId: 'intro', musicId: 'music', videoId: 'background', defaultVoiceId: 'Sulafat',
    rules: [{ id: 'warm', title: 'Warm', sex: 'any' as const, minAge: 0, maxAge: 120, voiceId: 'Sulafat', style: 'Calm', writing: 'Celebrate warmly', videoId: 'profile-video' }] }
  const next = changeBirthdayProvider(original, 'elevenlabs')
  expect(next.speechModel).toBe('eleven_v4')
  expect(next.defaultVoiceId).toBe('')
  expect(next.rules).toEqual([{ ...original.rules[0], voiceId: '' }])
  expect(next).toMatchObject({ revision: 7, introId: 'intro', musicId: 'music', videoId: 'background' })
  expect(original.rules[0].voiceId).toBe('Sulafat')
})

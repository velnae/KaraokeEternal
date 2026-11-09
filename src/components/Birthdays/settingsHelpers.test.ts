import { expect, it } from 'vitest'
import { defaultBirthdaySettings } from '../../../shared/birthdays.js'
import { birthdayProfileTitle, birthdaySampleKey, birthdayVoiceName } from './settingsHelpers'

it('reuses a fixed-text audition across unrelated edits but invalidates every speech identity change', () => {
  const config = { ...defaultBirthdaySettings, defaultVoiceId: 'es-419-commercial-1' }
  const identity = birthdaySampleKey(config)
  expect(birthdaySampleKey({ ...config, targetSeconds: 30, historyEvery: 5, textModel: 'another-writer', revision: 7, musicId: 'new-music' })).toBe(identity)
  for (const patch of [{ defaultVoiceId: 'another-voice' }, { speechProvider: 'elevenlabs' as const }, { speechModel: 'gemini-3.8-flash-lite-tts' }, { speechStyle: 'Another delivery' }]) {
    expect(birthdaySampleKey({ ...config, ...patch })).not.toBe(identity)
  }
  expect(birthdaySampleKey(config, 'other-voice')).not.toBe(identity)
  expect(birthdaySampleKey(config, config.defaultVoiceId, 'New profile style')).not.toBe(identity)
})

it('uses catalogue labels when available and does not claim an unverified regional accent', () => {
  expect(birthdayVoiceName('es-419-commercial-1', [])).toBe('Voz comercial 1 · Español latinoamericano')
  expect(birthdayVoiceName('es-419-commercial-1', [{ voiceId: 'es-419-commercial-1', name: 'Commercial Voiceover 1 · Mexico Spanish' }])).toBe('Voz comercial 1 · Español de México')
  expect(birthdayVoiceName('unknown', [])).toBe('unknown')
})

it('only removes a redundant age suffix from the profile summary', () => {
  const profile = { sex: 'any' as const, minAge: 25, maxAge: 44, voiceId: 'voice', title: 'Cercano y festivo · 25–44 años' }
  expect(birthdayProfileTitle(profile, 0)).toBe('Cercano y festivo')
  expect(birthdayProfileTitle({ ...profile, title: 'Cercano · Música' }, 0)).toBe('Cercano · Música')
  expect(profile.title).toBe('Cercano y festivo · 25–44 años')
})

import { afterEach, beforeEach, expect, it } from 'vitest'
import { open, close, db } from '../../lib/Database.js'
import Prefs from '../../Prefs/Prefs.js'
import { nameVoiceStyleLimit } from '../../../shared/nameVoices.js'
import { callSpeechProfile, type GreetingVoiceProfile } from '../../Greetings/voiceProfile.js'
import { getNameVoiceStyle, saveNameVoiceStyle } from './nameStyle.js'

const profile: GreetingVoiceProfile = { provider: 'gemini', model: 'gemini-3.8-flash-lite-tts', voice: 'Puck', style: 'Speak clearly in Spanish.', processingRevision: 1 }
beforeEach(() => open({ file: ':memory:', ro: false }))
afterEach(() => close())

it('starts with the exact existing name style and persists an independent global override', () => {
  const initial = getNameVoiceStyle(profile)
  expect(initial).toEqual({ style: callSpeechProfile(profile, 'name').style, defaultStyle: callSpeechProfile(profile, 'name').style, model: profile.model, revision: 0 })
  const saved = saveNameVoiceStyle({ style: '  Project this name clearly.\nUse a supported voice.  ', revision: 0 }, profile)
  expect(saved).toMatchObject({ style: 'Project this name clearly.\nUse a supported voice.', revision: 1 })
  expect(getNameVoiceStyle({ ...profile, style: 'A different greeting direction.' }).style).toBe(saved.style)
  expect(saveNameVoiceStyle({ style: saved.style, revision: 1 }, profile).revision).toBe(1)
  expect(db.all('SELECT * FROM karaokeCallJobs')).toEqual([])
  expect(db.all('SELECT * FROM greetingVoiceRequests')).toEqual([])
})

it.each([
  { style: '   ', revision: 0 },
  { style: 'a'.repeat(nameVoiceStyleLimit + 1), revision: 0 },
  { style: 'Name\u0000style', revision: 0 },
  { style: 'Valid', revision: -1 },
  { style: 'Valid', revision: 0.5 },
  { style: 'Valid', revision: 0, model: 'unexpected' },
])('rejects invalid settings without replacing the saved prompt %#', (input) => {
  const saved = saveNameVoiceStyle({ style: 'Existing valid direction.', revision: 0 }, profile)
  expect(() => saveNameVoiceStyle(input, profile)).toThrow()
  expect(getNameVoiceStyle(profile)).toEqual(saved)
})

it('rejects stale editors and validates direct preference persistence too', () => {
  const saved = saveNameVoiceStyle({ style: 'First administrator.', revision: 0 }, profile)
  expect(() => saveNameVoiceStyle({ style: 'Stale administrator.', revision: 0 }, profile)).toThrow('otra sesión')
  expect(() => Prefs.set('nameVoiceStyle', { style: '', revision: 1 })).toThrow()
  expect(getNameVoiceStyle(profile)).toEqual(saved)
})

it('loads legacy style settings and saves an independent name model with revision protection', () => {
  Prefs.set('nameVoiceStyle', { style: 'Legacy direction.', revision: 2 })
  expect(getNameVoiceStyle(profile)).toMatchObject({ style: 'Legacy direction.', model: profile.model, revision: 2 })
  const saved = saveNameVoiceStyle({ style: 'Legacy direction.', model: 'gemini-3.8-flash-tts', revision: 2 }, profile)
  expect(saved).toMatchObject({ model: 'gemini-3.8-flash-tts', revision: 3 })
  expect(getNameVoiceStyle(profile).model).toBe('gemini-3.8-flash-tts')
  expect(saveNameVoiceStyle({ style: saved.style, revision: 3 }, profile).model).toBe(saved.model)
  expect(() => saveNameVoiceStyle({ style: saved.style, model: profile.model, revision: 2 }, profile)).toThrow('otra sesión')
  expect(db.all('SELECT * FROM karaokeCallJobs')).toEqual([])
  expect(db.all('SELECT * FROM greetingVoiceRequests')).toEqual([])
})

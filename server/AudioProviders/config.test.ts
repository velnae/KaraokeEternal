import { expect, it } from 'vitest'
import { elevenLabsConfig, geminiConfig } from './config.js'
import { createElevenLabs } from './index.js'
import { DEFAULT_ANIMATOR_VOICE_ID } from '../../shared/audioTags.js'

it('uses application credentials only, even when standalone Gemini aliases are present', () => {
  expect(geminiConfig({ GEMINI_API_KEY: 'cli-key', GOOGLE_API_KEY: 'other-cli-key', KES_GEMINI_API_KEY: '' })).toEqual({ key: '', baseUrl: undefined })
  expect(geminiConfig({ KES_GEMINI_API_KEY: 'app-key', KES_GEMINI_BASE_URL: 'https://fixture.test' })).toEqual({ key: 'app-key', baseUrl: 'https://fixture.test' })
})

it('preserves ElevenLabs defaults and passes explicit overrides to the client', () => {
  expect(elevenLabsConfig({})).toEqual({ key: '', baseUrl: undefined, model: 'eleven_v4', voiceId: DEFAULT_ANIMATOR_VOICE_ID })
  const config = elevenLabsConfig({ KES_ELEVENLABS_API_KEY: 'app-key', KES_ELEVENLABS_BASE_URL: 'https://fixture.test', KES_ELEVENLABS_MODEL: 'custom-model', KES_ELEVENLABS_VOICE_ID: 'custom-voice' })
  const provider = createElevenLabs(config)
  expect(provider.capabilities).toMatchObject({ configured: true, models: { voice: 'custom-model' }, defaultVoiceId: 'custom-voice' })
})

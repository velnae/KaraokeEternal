import type { BirthdaySettings } from 'shared/birthdays'

export function changeBirthdayProvider (config: BirthdaySettings, provider: 'gemini' | 'elevenlabs'): BirthdaySettings {
  return { ...config, speechProvider: provider, speechModel: provider === 'gemini' ? 'gemini-3.8-flash-tts' : 'eleven_v4',
    defaultVoiceId: '', rules: config.rules.map(rule => ({ ...rule, voiceId: '' })) }
}

import { DEFAULT_ANIMATOR_VOICE_ID } from '../../shared/audioTags.js'

export interface ElevenLabsConfig { key: string, baseUrl?: string, model: string, voiceId: string }
export interface GeminiConfig { key: string, baseUrl?: string }

export const elevenLabsConfig = (env = process.env): ElevenLabsConfig => ({
  key: env.KES_ELEVENLABS_API_KEY ?? '',
  baseUrl: env.KES_ELEVENLABS_BASE_URL,
  model: env.KES_ELEVENLABS_MODEL ?? 'eleven_v4',
  voiceId: env.KES_ELEVENLABS_VOICE_ID || DEFAULT_ANIMATOR_VOICE_ID,
})

export const geminiConfig = (env = process.env): GeminiConfig => ({
  key: env.KES_GEMINI_API_KEY || '',
  baseUrl: env.KES_GEMINI_BASE_URL || undefined,
})

import { ElevenLabs } from './ElevenLabs.js'
import Gemini from './Gemini.js'
import { elevenLabsConfig, geminiConfig, type ElevenLabsConfig, type GeminiConfig } from './config.js'

export const createElevenLabs = (config: ElevenLabsConfig = elevenLabsConfig()) =>
  new ElevenLabs(config.key, config.baseUrl, config.model, config.voiceId)

export const createGemini = (config: GeminiConfig = geminiConfig(), request: typeof fetch = fetch, timeoutMs = 60000) =>
  new Gemini(config.key, request, timeoutMs, config.baseUrl)

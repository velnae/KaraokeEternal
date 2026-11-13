import type { ProviderCapabilities } from '../../shared/audioCatalog.js'
import type { AudioKind } from '../../shared/animation.js'

export interface AudioGenerationInput {
  kind: AudioKind
  model: string
  text: string
  spokenText: string
  voiceId?: string
  settings: { stability: number, similarity_boost: number }
  durationSeconds?: number
  loop?: boolean
}

export interface AudioProvider {
  capabilities: ProviderCapabilities
  check(model: string, kind?: AudioKind): Promise<{ voiceId: string, name: string }[]>
  generate(input: AudioGenerationInput, signal?: AbortSignal): Promise<{ bytes: Buffer, requestId: string | null }>
}

export interface SpeechProfile {
  model: string
  voice: string
  style: string
}

export interface SpeechProvider {
  readonly configured: boolean
  check(model: string): Promise<void>
  generate(text: string, profile: SpeechProfile, signal: AbortSignal): Promise<Buffer>
}

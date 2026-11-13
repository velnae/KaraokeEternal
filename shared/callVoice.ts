import { greetingVoiceModels } from './greetingVoice.js'

export interface CallVoiceConfig {
  model: typeof greetingVoiceModels[number]
  voice: string
  style: string
  revision: number
}

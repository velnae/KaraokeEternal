import type { CallJob, CallPart } from './karaokeCalls.js'
import { greetingVoiceModels } from './greetingVoice.js'

export const nameVoiceModels = greetingVoiceModels
export type NameVoiceModel = typeof nameVoiceModels[number]
export const nameVoiceStyleLimit = 2000
export interface NameVoiceStyleConfig { style: string, revision: number, model?: NameVoiceModel }
export interface NameVoiceStyleSettings extends NameVoiceStyleConfig { defaultStyle: string, model: NameVoiceModel }
export function validateNameVoiceStyle (value: unknown): NameVoiceStyleConfig {
  const input = value as NameVoiceStyleConfig | null
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['style', 'revision', 'model'].includes(key))
    || typeof input.style !== 'string' || !input.style.trim() || input.style.length > nameVoiceStyleLimit
    || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.style) // eslint-disable-line no-control-regex
    || !Number.isSafeInteger(input.revision) || input.revision < 0) throw new Error(`Ingrese un estilo de hasta ${nameVoiceStyleLimit} caracteres, sin caracteres de control.`)
  if (input.model !== undefined && !nameVoiceModels.includes(input.model)) throw new Error('Seleccione Gemini 3.8 Flash TTS normal o Lite.')
  return { style: input.style.trim(), revision: input.revision, ...(input.model === undefined ? {} : { model: input.model }) }
}

export interface NameVoiceVersion {
  part: CallPart
  selected: boolean
  compatible: boolean
  available: boolean
  voice: string | null
  model: string | null
  style: string | null
  recipeRevision: number | null
  legacy: boolean
  uses: number
  lastUsedAt: number | null
}
export interface NamePronunciation {
  id: string
  spokenText: string
  aliases: string[]
  archived: boolean
  revision: number
  createdAt: number
  updatedAt: number
  active: NameVoiceVersion | null
  latest: NameVoiceVersion | null
  uses: number
  lastUsedAt: number | null
  legacyHistory: boolean
  job: CallJob | null
}
export interface NameVoiceDetail extends NamePronunciation { versions: NameVoiceVersion[] }
export interface NameVoiceSnapshot {
  promptStyle: NameVoiceStyleSettings
  items: NamePronunciation[]
  total: number
  offset: number
  limit: number
  generation: { configured: boolean, enabled: boolean, allowed: boolean, message: string }
}

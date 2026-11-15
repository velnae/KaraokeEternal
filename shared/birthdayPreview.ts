import { birthdayLimits, celebrationYear, validateBirthdayInput, validateBirthdayScript } from './birthdays.js'
import type { BirthdayAsset, BirthdaySettings } from './birthdays.js'
import { birthdayBrandClosing, birthdayClosing, birthdayGreetingStart, birthdayWordCount, validateBirthdayGreeting, validateBirthdayNameBudget } from './birthdayGreeting.js'

export interface BirthdayPreviewDraft {
  name: string
  script: string
  introId: string
  videoId: string
  musicId: string
  bedId: string
  bedVolume: number
  profileIndex: string
  applauseId?: string
}
export interface BirthdayPreviewState {
  revision: number
  draft: BirthdayPreviewDraft | null
  samples: Record<string, BirthdayAsset>
}
export type BirthdayPreviewAsset = BirthdayAsset & { previewRevision?: number }

export function birthdayPreviewKey (config: BirthdaySettings, draft: Pick<BirthdayPreviewDraft, 'name' | 'script'>, voiceId: string, style?: string) {
  // Keep existing prepared samples addressable; new synthesis uses the strict contract.
  const { name } = validateBirthdayInput({ name: draft.name, sex: 'unspecified', birthYear: celebrationYear() - 30 })
  const sample = { name, script: validateBirthdayScript(draft.script, name) }
  const provider = config.speechProvider ?? 'elevenlabs'
  return JSON.stringify([sample.name, sample.script, provider, config.speechModel ?? (provider === 'gemini' ? 'gemini-3.8-flash-tts' : 'eleven_v4'), voiceId, style ?? '', 1])
}

// Drafts may be incomplete while being edited; synthesis validates the finished text.
export function validateBirthdayPreviewDraft (value: unknown): BirthdayPreviewDraft {
  const draft = value as BirthdayPreviewDraft | null
  if (!draft || typeof draft.name !== 'string' || draft.name.length > 60 || typeof draft.script !== 'string' || draft.script.length > birthdayLimits.script) throw new Error('Borrador de cumpleaños inválido.')
  for (const key of ['introId', 'videoId', 'musicId', 'bedId', 'profileIndex'] as const) {
    if (typeof draft[key] !== 'string' || draft[key].length > 100) throw new Error('Selección de previsualización inválida.')
  }
  if (!Number.isFinite(draft.bedVolume) || draft.bedVolume < 0 || draft.bedVolume > 1) throw new Error('Volumen de previsualización inválido.')
  if (draft.applauseId !== undefined && (typeof draft.applauseId !== 'string' || draft.applauseId.length > 100)) throw new Error('Aplauso de previsualización inválido.')
  return { name: draft.name, script: draft.script, introId: draft.introId, videoId: draft.videoId, musicId: draft.musicId, bedId: draft.bedId, bedVolume: draft.bedVolume, profileIndex: draft.profileIndex, ...(draft.applauseId !== undefined ? { applauseId: draft.applauseId } : {}) }
}

export const birthdayPreviewName = 'Carlos'
export const birthdayPreviewScript = (name: string) => {
  const endings = `${birthdayBrandClosing} ${birthdayClosing(name)}`
  const start = birthdayGreetingStart(name)
  const openings = ['Hoy celebramos tu día con cariño y alegría. Que este nuevo año te regale salud, sueños cumplidos y momentos inolvidables junto a quienes te quieren. Recibe nuestros mejores deseos.', 'Que esta noche esté llena de cariño y alegría.', 'Con mucho cariño.', '']
  const opening = openings.find(text => birthdayWordCount(`${start} ${text} ${endings}`) <= 45) ?? ''
  return [start, opening, endings].filter(Boolean).join(' ')
}

export function validateBirthdaySample (value: unknown) {
  const input = value as { name?: unknown, script?: unknown, regenerate?: unknown, profileId?: unknown } | null
  const year = celebrationYear()
  const { name } = validateBirthdayInput({ name: input?.name, sex: 'unspecified', birthYear: year - 30 }, year)
  validateBirthdayNameBudget(name)
  if (input?.regenerate !== undefined && typeof input.regenerate !== 'boolean') throw new Error('Indique si desea generar otro saludo.')
  if (input?.profileId !== undefined && (typeof input.profileId !== 'string' || !/^[\w-]{1,80}$/.test(input.profileId))) throw new Error('Seleccione un perfil de redacción válido.')
  return { name, regenerate: input?.regenerate === true, script: input?.regenerate === true ? '' : validateBirthdayGreeting(input?.script, name), ...(input?.profileId ? { profileId: input.profileId as string } : {}) }
}

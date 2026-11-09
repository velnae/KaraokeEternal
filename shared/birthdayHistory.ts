import type { BirthdayEvent, BirthdaySettings, PublicBirthday } from './birthdays.js'

export const birthdayOutcomes = ['pending', 'playing', 'completed', 'cancelled', 'interrupted', 'failed'] as const
export type BirthdayOutcome = typeof birthdayOutcomes[number]
export const birthdayOutcomeLabels: Record<BirthdayOutcome, string> = {
  pending: 'Pendiente', playing: 'En reproducción', completed: 'Completado', cancelled: 'Cancelado', interrupted: 'Interrumpido', failed: 'Preparación fallida',
}
export interface BirthdayHistoryItem {
  id: string
  name: string
  createdAt: number
  outcome: BirthdayOutcome
  voiceId: string
  greetingDurationMs: number | null
  greetingId: string | null
}
export interface BirthdayHistoryPage { items: BirthdayHistoryItem[], page: number, pageSize: number, total: number }
export interface BirthdayHistoryDetail extends BirthdayEvent {
  createdAt: number
  generationRevision: number
  greetingId: string | null
  generationSettings: Pick<BirthdaySettings, 'textModel' | 'targetSeconds' | 'maxVoiceSeconds'>
}
export function birthdayOutcome (event: Pick<PublicBirthday, 'playback' | 'preparation'>): BirthdayOutcome {
  if (event.playback !== 'held' && event.playback !== 'scheduled') return event.playback
  return event.preparation === 'failed' ? 'failed' : 'pending'
}

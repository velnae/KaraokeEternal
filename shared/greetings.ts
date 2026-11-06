import type { AnimationClip, Intervention } from './animation.js'
import type { RequestIntent } from './requestIntent.js'
import type { TransitionVideoBackground } from './transitionVideo.js'
import { guestNameError } from './guestName.js'
import { hasInvisibleCharacters, hasOffensiveText } from './textModeration.js'

export const GREETINGS = 'server/GREETINGS'
export const GREETING_LIMIT = 220
// Greetings validate the visible card before starting audio: allow two network
// round trips inside the existing 25-second transition, not extra playback time.
export const GREETING_START_MS = 3000
export interface GreetingDraft { message: string }
export interface GreetingOpportunity { canAdd: boolean, reason: string | null, maxMessageLength: number }
export type GreetingStatus = 'QUEUED' | 'RESERVED' | 'DISPLAYING' | 'DISPLAYED' | 'CANCELLED' | 'REMOVED' | 'SKIPPED' | 'INTERRUPTED'
export type GreetingAudioStatus = 'queued' | 'generating' | 'preparing' | 'ready' | 'uncertain' | 'failed' | 'cancelled' | 'unavailable'
export interface GreetingAudio { status: GreetingAudioStatus, reason: string | null, durationMs: number | null }
export interface GreetingPlaybackPrefs { enabled: boolean, introClipId: string | null, ambienceEnabled: boolean }
export const defaultGreetingPlayback: GreetingPlaybackPrefs = { enabled: false, introClipId: null, ambienceEnabled: true }
export type GreetingVoiceStatus = 'SCREEN' | 'SCHEDULED' | 'PLAYING' | 'PLAYED' | 'FAILED' | 'INTERRUPTED'
export const greetingVoiceLabels: Record<GreetingVoiceStatus, string> = {
  SCREEN: 'Solo pantalla', SCHEDULED: 'Lectura programada', PLAYING: 'Leyendo saludo', PLAYED: 'Voz reproducida', FAILED: 'Voz no completada', INTERRUPTED: 'Voz interrumpida',
}
export interface GreetingAsset extends AnimationClip { role: 'greeting' | 'intro' | 'bed', url: string }
export interface GreetingPerformer { name: string, tableLabel: string | null, requestIntent: RequestIntent, title: string }
export interface GreetingPreparation { queueId: number, greetingId: number, assets: GreetingAsset[], playbackVersion: number, performer: GreetingPerformer }
export interface GreetingTransition { assets: GreetingAsset[], durationMs: number, voiceMs: number, displayMs: number }
export const greetingAudioLabels: Record<GreetingAudioStatus, string> = {
  queued: 'Voz en espera', generating: 'Generando voz', preparing: 'Preparando audio', ready: 'Audio preparado',
  uncertain: 'Solo pantalla', failed: 'Solo pantalla', cancelled: 'Solo pantalla', unavailable: 'Solo pantalla',
}
export interface Greeting extends GreetingDraft {
  greetingId: number
  queueId: number
  userId: number
  roomId: number
  sender: string
  tableLabel: string | null
  status: GreetingStatus
  reason: string | null
  createdAt: number
  turnKey: number | null
  title: string
  audio?: GreetingAudio
  playback?: { status: GreetingVoiceStatus, reason: string | null }
}
export interface GreetingSnapshot {
  items: Greeting[]
  opportunities: Record<number, GreetingOpportunity>
  paused: boolean
  audioEnabled: boolean
  playback: GreetingPlaybackPrefs
  playbackVersion: number
  turns: { key: number, queueIds: number[], userId: number }[]
}
export interface GreetingGrant {
  background?: TransitionVideoBackground | null
  turnKey: number
  items: Greeting[]
  until: number
  displayMs: number
  performer: GreetingPerformer
  transition?: GreetingTransition & { intervention: Intervention }
}
export const greetingLabels: Record<GreetingStatus, string> = {
  QUEUED: 'Esperando tu turno', RESERVED: 'Preparando el turno', DISPLAYING: 'En pantalla', DISPLAYED: 'Mostrado',
  CANCELLED: 'Cancelado', REMOVED: 'Retirado', SKIPPED: 'No mostrado', INTERRUPTED: 'Interrumpido',
}
export const greetingText = (draft: GreetingDraft, sender: string) =>
  `${draft.message.trim()} — De ${sender}`
export const greetingMessageLength = (message: string) => [...message.normalize('NFC')].length
export const greetingMessageLimit = (sender: string) => Math.max(0, GREETING_LIMIT - [...greetingText({ message: '' }, sender.normalize('NFC'))].length)
export function normalizeGreetingMessage (value: unknown): string {
  if (typeof value !== 'string') throw new Error('El mensaje del saludo no es válido.')
  return value.normalize('NFC').replace(/[ \t\r\n]+/g, ' ').trim()
}
export function validateGreeting (value: unknown, sender: string): GreetingDraft {
  if (!value || typeof value !== 'object') throw new Error('El saludo no es válido')
  const draft = value as GreetingDraft
  if (typeof draft.message !== 'string') throw new Error('El saludo no es válido')
  const message = normalizeGreetingMessage(draft.message)
  if (!message) throw new Error('Escribe un mensaje para incluir el saludo.')
  if (guestNameError(sender)) throw new Error('Corrige tu nombre en Mi cuenta antes de enviar un saludo.')
  if ([...greetingText({ message }, sender.normalize('NFC'))].length > GREETING_LIMIT) throw new Error(`El saludo supera los ${GREETING_LIMIT} caracteres.`)
  if (/[<>]/.test(message) || hasInvisibleCharacters(message)) throw new Error('Usa texto simple en el saludo, sin etiquetas ni caracteres de control.')
  if (hasOffensiveText(message)) throw new Error('El mensaje contiene expresiones no permitidas. Revisa el texto para enviarlo.')
  return { message }
}
export function isGreetingAllowed (greeting: GreetingDraft & { sender: string }): boolean {
  try {
    validateGreeting(greeting, greeting.sender)
    return true
  } catch { return false }
}
export const greetingDuration = (item: Greeting) => Math.min(15000, Math.max(10000, [...greetingText(item, item.sender)].length * 65))

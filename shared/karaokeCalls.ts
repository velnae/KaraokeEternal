import type { GreetingVoiceSnapshot } from './greetingVoice.js'
import type { AnimationClip } from './animation.js'

export type CallPurpose = 'intro' | 'table' | 'continuation' | 'reference' | 'name' | 'template' | 'signature'
export type CallOperation = 'intro' | 'table' | 'hybrid' | 'reference' | 'fallback' | 'source' | 'compose'
export type CallJobPurpose = 'preview' | 'setup' | 'automatic'
export type CallStatus = 'queued' | 'generating' | 'preparing' | 'ready' | 'failed' | 'uncertain' | 'cancelled'
export interface CallPart {
  id: string
  kind: CallPurpose | 'composition'
  title: string
  text: string
  durationMs: number
  profileKey: string
  createdAt: number
  variantId: string
}
export interface CallJob {
  id: string
  tableId?: number
  operation: CallOperation
  text: string
  status: CallStatus
  error: string | null
  createdAt: number
  providerMs: number
  preparationMs: number
  result: CallPart | null
  outdated: boolean
}
export interface TableCallVoice {
  tableId: number
  code: string
  spokenText: string
  revision: number
  part: CallPart | null
  outdated: boolean
}
export interface CallSnapshot {
  automation?: CallAutomationSnapshot
  intros: CallPart[]
  jobs: CallJob[]
  tables: TableCallVoice[]
  profileKey: string
  voice: GreetingVoiceSnapshot
  error: string | null
}
export const callStatusLabels: Record<CallStatus, string> = {
  queued: 'En espera', generating: 'Generando voz', preparing: 'Preparando audio', ready: 'Disponible',
  failed: 'Error', uncertain: 'Sin confirmación', cancelled: 'Cancelado',
}
export interface CallControls {
  revision: number
  preparing: boolean
  enabled: boolean
  listeningEnabled?: boolean
  introIds: string[]
}
export interface CallRequestState {
  queueId: number
  inputKey: string
  title: string
  performer: string
  tableLabel: string | null
  status: 'waiting' | 'preparing' | 'ready' | 'fallback' | 'cancelled'
  reason: string | null
  result: CallPart | null
  startedAt: number | null
}
export interface CallAutomationSnapshot {
  listeningTemplates?: ListeningTemplate[]
  listeningRequests?: CallRequestState[]
  controls: CallControls
  tablesReady: number
  tablesTotal: number
  fallbackReady: boolean
  message: string | null
  requests: CallRequestState[]
}
export interface ListeningTemplate {
  id: string
  text: string
  enabled: boolean
  revision: number
  audio: CallPart | null
  status: 'waiting' | CallStatus
  error: string | null
}
export interface CallContext {
  kind?: 'listening' | 'signature'
  queueId: number
  inputKey: string
  revision: number
  partId: string
}
export interface CallAsset extends AnimationClip { role: 'call' | 'signature', url: string, partId: string, identifiesSender?: boolean }
export interface CallPreparation {
  kind?: 'listening' | 'signature'
  signatureKey?: string
  queueId: number
  inputKey: string
  revision: number
  assets: CallAsset[]
  reason: string | null
}
export const callTextLimit = 220
export function callText (value: unknown, max = callTextLimit): string {
  if (typeof value !== 'string') throw new Error('Ingrese el texto que se leerá.')
  const text = value.normalize('NFC').trim().replace(/\s+/g, ' ')
  const unsafe = [...value].some(char => '<>[]'.includes(char) || (char.charCodeAt(0) < 32 && !'\t\n\r'.includes(char)) || char.charCodeAt(0) === 127)
  if (!text || [...text].length > max || unsafe) throw new Error(`Use texto simple, sin etiquetas y hasta ${max} caracteres.`)
  return text
}
export const callContinuation = (performer: unknown, song: unknown) =>
  callText(`recibamos a ${callText(performer, 60)} con ${callText(song, 140)}. ¡Un aplauso!`)
const numbers = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce']
export function defaultTableCallText (code: string) {
  const spoken = /^\d+$/.test(code) && Number(code) < numbers.length ? numbers[Number(code)] : code
  return `Desde la mesa ${spoken},`
}

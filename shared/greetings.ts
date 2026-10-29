export const GREETINGS = 'server/GREETINGS'
export const GREETING_LIMIT = 220
export interface GreetingDraft { recipient: string, message: string }
export type GreetingStatus = 'QUEUED' | 'RESERVED' | 'DISPLAYING' | 'DISPLAYED' | 'CANCELLED' | 'REMOVED' | 'SKIPPED' | 'INTERRUPTED'
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
}
export interface GreetingSnapshot {
  items: Greeting[]
  paused: boolean
  turns: { key: number, queueIds: number[], userId: number }[]
}
export interface GreetingGrant { turnKey: number, items: Greeting[], until: number }
export const greetingLabels: Record<GreetingStatus, string> = {
  QUEUED: 'Esperando tu turno', RESERVED: 'Preparando el turno', DISPLAYING: 'En pantalla', DISPLAYED: 'Mostrado',
  CANCELLED: 'Cancelado', REMOVED: 'Retirado', SKIPPED: 'No mostrado', INTERRUPTED: 'Interrumpido',
}
export const greetingText = (draft: GreetingDraft, sender: string) =>
  `${draft.recipient.trim() ? `Para ${draft.recipient.trim()}: ` : ''}${draft.message.trim()} — De ${sender}`
export function validateGreeting (value: unknown, sender: string): GreetingDraft {
  if (!value || typeof value !== 'object') throw new Error('El saludo no es válido')
  const draft = value as GreetingDraft
  if (typeof draft.recipient !== 'string' || typeof draft.message !== 'string') throw new Error('El saludo no es válido')
  if (!draft.message.trim()) throw new Error('Escribe un mensaje para incluir el saludo.')
  if (draft.recipient.length > 50 || [...greetingText(draft, sender)].length > GREETING_LIMIT) throw new Error(`El saludo supera los ${GREETING_LIMIT} caracteres.`)
  const unsafe = [...draft.recipient, ...draft.message].some((char) => {
    const code = char.charCodeAt(0)
    return char === '<' || char === '>' || code < 9 || (code > 10 && code < 32) || code === 127
  })
  if (unsafe) throw new Error('Usa texto simple en el saludo, sin etiquetas ni caracteres de control.')
  return { recipient: draft.recipient.trim(), message: draft.message.trim() }
}
export const greetingDuration = (item: Greeting) => Math.min(15000, Math.max(10000, [...greetingText(item, item.sender)].length * 65))

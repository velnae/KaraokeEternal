export const REQUEST_INTENTS = ['UNKNOWN', 'SING', 'LISTEN'] as const
export type RequestIntent = typeof REQUEST_INTENTS[number]
export const requestIntentLabels: Record<RequestIntent, string> = { UNKNOWN: 'Pedido musical', SING: 'Karaoke', LISTEN: 'Para escuchar' }

export function requestIntent (value: unknown): RequestIntent {
  if (value === undefined) return 'UNKNOWN'
  if (typeof value !== 'string' || !REQUEST_INTENTS.includes(value as RequestIntent)) throw new Error('Elija cantar karaoke o escuchar música.')
  return value as RequestIntent
}

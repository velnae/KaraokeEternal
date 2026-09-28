export type PlaybackOutcome = 'ENDED' | 'FAILED'

export interface PlaybackSettlementState {
  token: string | null
  outcome: PlaybackOutcome | null
}

export const playbackToken = (queueId: number, replayKey: number): string => `${queueId}:${replayKey}`

export const claimPlaybackSettlement = (
  state: PlaybackSettlementState,
  token: string,
  outcome: PlaybackOutcome,
): boolean => {
  if (state.token === token) return false
  state.token = token
  state.outcome = outcome
  return true
}

export const settlePlayback = (
  state: PlaybackSettlementState,
  token: string,
  outcome: PlaybackOutcome,
  handlers: {
    onAdvance(includeCurrentInHistory: boolean): void
    onFailure?(): void
  },
): boolean => {
  if (!claimPlaybackSettlement(state, token, outcome)) return false
  if (outcome === 'FAILED') handlers.onFailure?.()
  handlers.onAdvance(outcome === 'ENDED')
  return true
}

export const appendCompletedToHistory = (historyJSON: string, queueId?: number): string => {
  let history: number[] = []

  try {
    const parsed = JSON.parse(historyJSON)
    if (Array.isArray(parsed)) history = parsed.filter(value => Number.isInteger(value))
  } catch {
    // Recover with a valid transient history; persisted lifecycle remains authoritative.
  }

  if (typeof queueId === 'number' && !history.includes(queueId)) history.push(queueId)
  return JSON.stringify(history)
}

export const KARAOKE_TURN = 'server/KARAOKE_TURN'
export const KARAOKE_COUNTDOWN_MS = 5000
export interface KaraokeTurn {
  queueId: number
  runId: string
  revision: number
  phase: 'presenting' | 'waiting' | 'countdown' | 'released'
  presented: boolean
  endsAt: number | null
  playerPresent: boolean
}
export const karaokeCountdownSeconds = (endsAt: number, now: number) => Math.max(0, Math.ceil((endsAt - now) / 1000))

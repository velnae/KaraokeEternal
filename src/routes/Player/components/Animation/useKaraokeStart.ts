import { useCallback, useEffect } from 'react'
import store from 'store/store'
import { animationRequest, animationTime } from 'lib/animationApi'
import { KARAOKE_TURN, type KaraokeTurn } from 'shared/karaokeStart'
import { tracePlayback } from 'lib/playbackTrace'

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
export default function useKaraokeStart () {
  useEffect(() => {
    const timer = setInterval(() => {
      const state = store.getState()
      const turn = state.animation.snapshot?.karaokeTurn
      if (turn?.phase === 'presenting' && state.player._authority === 'GRANTED') {
        void animationRequest(KARAOKE_TURN, { operation: 'heartbeat', queueId: turn.queueId, runId: turn.runId }, 5000).catch(() => {})
      }
    }, 2000)
    return () => clearInterval(timer)
  }, [])
  const begin = useCallback(async (queueId: number) => {
    const response = await animationRequest(KARAOKE_TURN, { operation: 'begin', queueId }, 5000)
    return response.payload?.karaokeTurn ?? null
  }, [])
  const wait = useCallback(async (turn: KaraokeTurn, valid: () => boolean, keepBackground: () => Promise<void>, onTick?: (turn: KaraokeTurn) => Promise<void>) => {
    const command = (operation: string) => animationRequest(KARAOKE_TURN, { operation, queueId: turn.queueId, runId: turn.runId }, 5000)
    if (!turn.presented) await command('presented')
    let heartbeatAt = 0
    // Audio cues can span a renewal window. Keep the existing bed's finite
    // lease alive independently, without starting concurrent cue reservations.
    let renewing: Promise<void> | null = null
    const backgroundTimer = setInterval(() => {
      if (!renewing && valid()) renewing = keepBackground().catch(() => {}).finally(() => {
        renewing = null
      })
    }, 1000)
    try {
      while (valid()) {
        const current = store.getState().animation.snapshot?.karaokeTurn
        if (!current || current.runId !== turn.runId) return false
        if (current.phase === 'released') return valid()
        if (Date.now() - heartbeatAt >= 2000) {
          tracePlayback('karaoke-wait', { queueId: turn.queueId, state: current.phase, remainingMs: current.reminderAt ? current.reminderAt - animationTime() : -1 })
          await command('heartbeat')
          heartbeatAt = Date.now()
          if (!valid()) break
        }
        if (current.phase === 'countdown' && current.endsAt !== null && animationTime() >= current.endsAt) {
          const response = await command('consume')
          return valid() && response.payload?.karaokeTurn?.phase === 'released'
        }
        await onTick?.(current)
        await sleep(100)
      }
    } finally {
      clearInterval(backgroundTimer)
      await renewing
    }
    const current = store.getState().animation.snapshot?.karaokeTurn
    if (current?.runId === turn.runId && current.phase === 'countdown') {
      await animationRequest(KARAOKE_TURN, { ...current, operation: 'cancel' }).catch(() => {})
    }
    return false
  }, [])
  const played = useCallback((turn: KaraokeTurn) => animationRequest(KARAOKE_TURN, { operation: 'played', queueId: turn.queueId, runId: turn.runId }, 5000), [])
  return { begin, wait, played }
}

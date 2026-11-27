import { createTurnDirector } from './turnDirector'
import type { planNormalTurn } from './turnPlan'
import { TRANSITION_INTRO_MS } from 'shared/animation'

export function developmentExecutor () {
  if (process.env.NODE_ENV !== 'development') return 'legacy'
  try {
    const mode = sessionStorage.getItem('karaoke:player-executor')
    return mode === 'v2' || mode === 'legacy' ? mode : 'observe'
  } catch { return 'observe' }
}

interface Adapters {
  serverNow: () => number
  backdrop: (signal: AbortSignal) => Promise<void>
  bed: (signal: AbortSignal) => Promise<void>
  announcement: (signal: AbortSignal) => Promise<void>
  presentation: (signal: AbortSignal) => Promise<boolean>
  entry: (signal: AbortSignal) => Promise<void>
  operatorRelease: (signal: AbortSignal) => Promise<{ runId: string, queueId: number } | null>
  exit: () => void
  released: (reason: string) => void
}

export function beginBrowserTurn (plan: ReturnType<typeof planNormalTurn>, budgetMs: number, adapters: Adapters) {
  let ready!: (advance: boolean) => void
  const handoff = new Promise<boolean>((resolve) => {
    ready = resolve
  })
  let bed: Promise<void> | undefined
  const director = createTurnDirector({ now: () => performance.now(), serverNow: adapters.serverNow,
    schedule: (ms, callback) => {
      const timer = setTimeout(callback, ms)
      return () => clearTimeout(timer)
    },
    execute: (command, run) => {
      switch (command.type) {
        case 'prepare-backdrop': void adapters.backdrop(run.signal).catch(() => {})
          break
        case 'start-bed': bed = adapters.bed(run.signal).catch(() => {})
          break
        case 'intro': void Promise.resolve(bed).then(async (): Promise<void> => {
          if (run.signal.aborted) return undefined
          if (plan.kind === 'karaoke') {
            if (plan.steps.includes('karaoke-entry')) await adapters.entry(run.signal)
            run.report({ type: 'intro-ended' })
            return
          }
          const timer = setTimeout(() => run.report({ type: 'intro-ended' }), TRANSITION_INTRO_MS)
          run.signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
          return undefined
        }).catch(() => run.report({ type: 'cancel', reason: 'adapter-error' }))
          break
        case 'present-request': void adapters.presentation(run.signal).then(handled => run.report({ type: 'presentation', handled }), () => run.report({ type: 'cancel', reason: 'adapter-error' }))
          break
        case 'reserve': void adapters.announcement(run.signal).then(() => run.report({ type: 'sequence-settled' }), () => run.report({ type: 'cancel', reason: 'adapter-error' }))
          break
        case 'wait-for-release': void adapters.operatorRelease(run.signal).then(release => run.report(release
          ? { type: 'released', runId: release.runId, queueId: release.queueId }
          : { type: 'cancel', reason: 'replaced' }), () => run.report({ type: 'cancel', reason: 'adapter-error' }))
          break
        case 'start-song': ready(true)
          break
        case 'exit-on-playing': adapters.exit()
          break
        default: throw new Error(`Unexpected standalone animator command: ${command.type}`)
      }
    },
    release: (_, reason) => {
      ready(false)
      adapters.released(reason)
    },
  })
  const run = director.begin(plan, budgetMs)
  run.report({ type: 'ended' })
  return { handoff, cancel: director.cancel, report: run.report, destination: plan.destination, signal: run.signal }
}

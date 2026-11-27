import type { planNormalTurn } from './turnPlan'

type Plan = ReturnType<typeof planNormalTurn>
type Phase = 'prepared' | 'intro' | 'presenting' | 'reserving' | 'recovering' | 'voice' | 'curtain' | 'waiting' | 'handoff' | 'exit' | 'finished' | 'cancelled'
type CancelReason = 'pause' | 'stop' | 'skip' | 'remote-close' | 'unmount' | 'disconnect' | 'authority-lost' | 'replaced' | 'deadline' | 'uncertain-start' | 'adapter-error'
type Event = { type: 'ended' | 'intro-ended' | 'unanswered' | 'omitted' | 'voice-ended' | 'curtain-ended' | 'sequence-settled' | 'playing' | 'exited' }
  | { type: 'permit', identity: string, id: string, startBefore: number, start: 'unused' | 'uncertain' }
  | { type: 'cancel', reason: CancelReason }
  | { type: 'presentation', handled: boolean }
  | { type: 'released', runId: string, queueId: number }
type Command = { type: 'prepare-backdrop' | 'start-bed' | 'intro' | 'present-request' | 'reserve' | 'lookup' | 'finish-curtain' | 'wait-for-release' | 'start-song' | 'exit-on-playing' }
  | { type: 'play-voice', permitId: string }
type Decision = { phase: Phase, commands: Command[], reason?: CancelReason }
const move = (phase: Phase, ...commands: Command[]): Decision => ({ phase, commands })

/** Callback scope and permit validity are independent: a current callback can carry an expired grant. */
export function reduceTurn (plan: Plan, phase: Phase, event: Event, serverNow: number): Decision {
  const handoff = () => plan.karaokeRunId ? move('waiting', { type: 'wait-for-release' }) : move('handoff', { type: 'start-song' })
  const reserve = () => plan.steps.includes('attempt-voice') ? move('reserving', { type: 'reserve' }) : handoff()
  const present = () => plan.steps.includes('present-request') ? move('presenting', { type: 'present-request' }) : reserve()
  if (phase === 'finished' || phase === 'cancelled') return move(phase)
  if (event.type === 'cancel') return { ...move('cancelled'), reason: event.reason }
  if (phase === 'prepared' && event.type === 'ended') {
    if (!plan.scene) return present()
    const result = move('intro', { type: 'intro' })
    if (plan.steps.includes('start-eligible-bed')) result.commands.unshift({ type: 'start-bed' })
    return result
  }
  if (phase === 'intro' && event.type === 'intro-ended') return present()
  if (phase === 'presenting' && event.type === 'presentation') return event.handled ? handoff() : reserve()
  if (phase === 'reserving' && event.type === 'unanswered') return move('recovering', { type: 'lookup' })
  if (phase === 'reserving' || phase === 'recovering') {
    // The existing animator adapter owns one server-authorized voice/effect sequence.
    if (phase === 'reserving' && event.type === 'sequence-settled') return handoff()
    if (event.type === 'omitted') return handoff()
    if (event.type === 'permit' && event.identity === plan.identity) {
      if (event.start === 'uncertain') return { ...move('cancelled'), reason: 'uncertain-start' }
      if (!(event.startBefore > serverNow)) return handoff()
      return move('voice', { type: 'play-voice', permitId: event.id })
    }
  }
  if (phase === 'voice' && event.type === 'voice-ended') return move('curtain', { type: 'finish-curtain' })
  if (phase === 'curtain' && event.type === 'curtain-ended') return handoff()
  if (phase === 'waiting' && event.type === 'released' && event.runId === plan.karaokeRunId && event.queueId === plan.destination) return move('handoff', { type: 'start-song' })
  if (phase === 'handoff' && event.type === 'playing') return plan.scene ? move('exit', { type: 'exit-on-playing' }) : move('finished')
  if (phase === 'exit' && event.type === 'exited') return move('finished')
  return move(phase)
}

interface TurnRun {
  plan: Plan
  signal: AbortSignal
  report: (event: Event) => void
}
interface Ports {
  now: () => number // monotonic elapsed time
  serverNow: () => number // estimated server time; only used for permits
  schedule: (delayMs: number, callback: () => void) => () => void
  execute: (command: Command, run: TurnRun) => void
  release: (plan: Plan, reason: CancelReason | 'finished') => void
}

export function createTurnDirector (ports: Ports) {
  let active: TurnRun | undefined
  const cancel = (reason: CancelReason) => active?.report({ type: 'cancel', reason })
  const begin = (plan: Plan, budgetMs: number) => {
    if (!['normal', 'listening', 'karaoke'].includes(plan.kind) || !Number.isFinite(budgetMs) || budgetMs <= 0) throw new Error('Expected a bounded music turn')
    if (active?.plan.identity === plan.identity) return active
    cancel('replaced')
    const controller = new AbortController()
    let phase: Phase = 'prepared'
    let deadline = Infinity
    let disarm: (() => void) | undefined
    const run: TurnRun = { plan, signal: controller.signal, report }
    active = run
    function execute (command: Command) {
      try {
        ports.execute(command, run)
      } catch {
        report({ type: 'cancel', reason: 'adapter-error' })
      }
    }
    function report (event: Event) {
      if (active !== run) return
      const previous = phase
      if (event.type !== 'cancel' && ports.now() >= deadline) event = { type: 'cancel', reason: 'deadline' }
      const decision = reduceTurn(plan, phase, event, ports.serverNow())
      phase = decision.phase
      if (phase === 'finished' || phase === 'cancelled') {
        active = undefined // Invalidate before abort listeners or cleanup can report back.
        disarm?.()
        controller.abort()
        ports.release(plan, decision.reason ?? 'finished')
        return
      }
      if (phase === 'waiting' && previous !== phase) {
        disarm?.()
        deadline = Infinity // Operator wait is bounded by the server's renewable authority, not presentation time.
      } else if ((previous === 'prepared' && event.type === 'ended') || (previous === 'waiting' && phase === 'handoff')) {
        const ms = previous === 'waiting' ? 10000 : budgetMs
        deadline = ports.now() + ms
        disarm = ports.schedule(ms, () => {
          if (ports.now() >= deadline) report({ type: 'cancel', reason: 'deadline' })
        })
      }
      for (const command of decision.commands) if (active === run && phase === decision.phase) execute(command)
    }
    if (plan.steps.includes('prepare-backdrop')) execute({ type: 'prepare-backdrop' })
    return run
  }
  return { begin, cancel }
}

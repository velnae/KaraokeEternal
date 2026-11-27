import type { planNormalTurn } from './turnPlan'

type Plan = ReturnType<typeof planNormalTurn>
type Phase = 'prepared' | 'intro' | 'reserving' | 'recovering' | 'voice' | 'curtain' | 'handoff' | 'exit' | 'finished' | 'cancelled'
type CancelReason = 'pause' | 'stop' | 'skip' | 'remote-close' | 'unmount' | 'disconnect' | 'authority-lost' | 'replaced' | 'deadline' | 'uncertain-start' | 'adapter-error'
type Event = { type: 'ended' | 'intro-ended' | 'unanswered' | 'omitted' | 'voice-ended' | 'curtain-ended' | 'playing' | 'exited' }
  | { type: 'permit', identity: string, id: string, startBefore: number, start: 'unused' | 'uncertain' }
  | { type: 'cancel', reason: CancelReason }
type Command = { type: 'prepare-backdrop' | 'start-bed' | 'intro' | 'reserve' | 'lookup' | 'finish-curtain' | 'start-song' | 'exit-on-playing' }
  | { type: 'play-voice', permitId: string }
type Decision = { phase: Phase, commands: Command[], reason?: CancelReason }
const move = (phase: Phase, ...commands: Command[]): Decision => ({ phase, commands })

/** Callback scope and permit validity are independent: a current callback can carry an expired grant. */
export function reduceTurn (plan: Plan, phase: Phase, event: Event, serverNow: number): Decision {
  const handoff = () => move('handoff', { type: 'start-song' })
  const reserve = () => plan.steps.includes('attempt-voice') ? move('reserving', { type: 'reserve' }) : handoff()
  if (phase === 'finished' || phase === 'cancelled') return move(phase)
  if (event.type === 'cancel') return { ...move('cancelled'), reason: event.reason }
  if (phase === 'prepared' && event.type === 'ended') {
    if (!plan.scene) return reserve()
    const result = move('intro', { type: 'intro' })
    if (plan.steps.includes('start-eligible-bed')) result.commands.unshift({ type: 'start-bed' })
    return result
  }
  if (phase === 'intro' && event.type === 'intro-ended') return reserve()
  if (phase === 'reserving' && event.type === 'unanswered') return move('recovering', { type: 'lookup' })
  if (phase === 'reserving' || phase === 'recovering') {
    if (event.type === 'omitted') return handoff()
    if (event.type === 'permit' && event.identity === plan.identity) {
      if (event.start === 'uncertain') return { ...move('cancelled'), reason: 'uncertain-start' }
      if (!(event.startBefore > serverNow)) return handoff()
      return move('voice', { type: 'play-voice', permitId: event.id })
    }
  }
  if (phase === 'voice' && event.type === 'voice-ended') return move('curtain', { type: 'finish-curtain' })
  if (phase === 'curtain' && event.type === 'curtain-ended') return handoff()
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
    if (plan.kind !== 'normal' || !Number.isFinite(budgetMs) || budgetMs <= 0) throw new Error('Expected a bounded normal turn')
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
      if (previous === 'prepared' && event.type === 'ended') {
        deadline = ports.now() + budgetMs
        disarm = ports.schedule(budgetMs, () => report({ type: 'cancel', reason: 'deadline' }))
      }
      for (const command of decision.commands) if (active === run && phase === decision.phase) execute(command)
    }
    if (plan.steps.includes('prepare-backdrop')) execute({ type: 'prepare-backdrop' })
    return run
  }
  return { begin, cancel }
}

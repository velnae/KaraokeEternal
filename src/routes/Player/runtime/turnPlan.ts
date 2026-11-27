import { playbackToken } from '../components/PlayerController/playbackSettlement'

type Track = { queueId: number, status?: string, origin?: string, requestIntent?: string }
export interface TurnInputs {
  roomId: number
  epoch: number | null
  source: number
  replayKey: number
  boundary: 'ended' | 'start' | 'idle'
  queue: { result: readonly number[], entities: Readonly<Record<number, Track | undefined>> }
  held: Track | null
  announce: boolean
  backdrop: boolean
  animator: boolean
  greetings: boolean
  listeningPresentations?: boolean
  karaokeCalls?: boolean
  manualKaraoke?: { runId: string, presented: boolean } | null
  ambience: boolean
}

export const turnIdentity = (roomId: number, epoch: number | null, source: number, replayKey: number, destination: number | null) =>
  `${roomId}/${epoch}/${playbackToken(source, replayKey)}/${destination}`

/** Describes eligible work, not granted assets. No socket, store, clocks or media handles. */
export function planNormalTurn (input: TurnInputs) {
  const { queue, source } = input
  const next = input.held?.status === 'APPROVED'
    ? input.held
    : queue.result.slice(queue.result.indexOf(source) + 1).map(id => queue.entities[id]).find(item => item?.status === 'APPROVED')
  const destination = next?.queueId ?? null
  const token = playbackToken(source, input.replayKey)
  const identity = turnIdentity(input.roomId, input.epoch, source, input.replayKey, destination)
  const listening = next?.origin === 'PARTICIPANT' && next.requestIntent === 'LISTEN'
  const karaoke = !!next && next.origin !== 'HOUSE' && next.requestIntent === 'SING'
  const manual = karaoke ? input.manualKaraoke : null
  const kind = !next ? 'empty' : karaoke ? 'karaoke' : listening ? 'listening' : next.origin === 'HOUSE' ? 'normal' : 'special'
  const call = (listening && !!input.listeningPresentations) || (karaoke && !!input.karaokeCalls)
  const scene = (kind === 'normal' || listening || karaoke) && input.boundary !== 'idle' && (input.announce || call || !!manual) && (input.backdrop || input.animator || input.greetings || call || !!manual)
  const steps: string[] = []
  if (kind === 'normal' || listening || karaoke) {
    if (scene) steps.push('prepare-backdrop')
    if (scene && karaoke && !manual?.presented && !call) steps.push('karaoke-entry')
    if (scene && (input.ambience || (karaoke && (call || manual)))) steps.push('start-eligible-bed')
    if (listening || (karaoke && !manual?.presented)) steps.push('present-request')
    if (input.announce && input.animator && !manual?.presented) steps.push('attempt-voice', 'finish-eligible-curtain')
    if (manual) steps.push('wait-for-release')
    steps.push('start-song')
    if (scene) steps.push('exit-on-playing')
  }
  return { identity, token, destination, kind, scene, steps, karaokeRunId: manual?.runId }
}

export function compareTurnSelection (plan: ReturnType<typeof planNormalTurn>, destination: number | null, scene: boolean) {
  if (plan.destination !== destination) return 'destination-mismatch'
  if (!['normal', 'listening', 'karaoke'].includes(plan.kind)) return 'selection-only'
  return plan.scene === scene ? 'match' : 'scene-eligibility-mismatch'
}

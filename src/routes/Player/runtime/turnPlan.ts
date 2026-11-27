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
  const kind = !next ? 'empty' : listening ? 'listening' : next.origin === 'HOUSE' ? 'normal' : 'special'
  const call = listening && !!input.listeningPresentations
  const scene = (kind === 'normal' || listening) && input.boundary !== 'idle' && (input.announce || call) && (input.backdrop || input.animator || input.greetings || call)
  const steps: string[] = []
  if (kind === 'normal' || listening) {
    if (scene) steps.push('prepare-backdrop')
    if (scene && input.ambience) steps.push('start-eligible-bed')
    if (listening) steps.push('present-request')
    if (input.announce && input.animator) steps.push('attempt-voice', 'finish-eligible-curtain')
    steps.push('start-song')
    if (scene) steps.push('exit-on-playing')
  }
  return { identity, token, destination, kind, scene, steps }
}

export function compareTurnSelection (plan: ReturnType<typeof planNormalTurn>, destination: number | null, scene: boolean) {
  if (plan.destination !== destination) return 'destination-mismatch'
  if (plan.kind !== 'normal' && plan.kind !== 'listening') return 'selection-only'
  return plan.scene === scene ? 'match' : 'scene-eligibility-mismatch'
}

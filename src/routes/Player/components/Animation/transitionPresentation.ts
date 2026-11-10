import type { OptimisticQueueItem, QueueItem } from 'shared/types'
import { createSelector } from '@reduxjs/toolkit'
import { buildRoundRobinQueue } from '../../../../../shared/roundRobin.js'
import { buildPlayerHistory } from '../../../../../shared/playerHistory.js'
import { normalizeQueuePrefs } from '../../../../../shared/queueRules.js'

type Queue = { result: number[], entities: Record<number, QueueItem | OptimisticQueueItem> }
type PlayerPosition = { queueId: number, historyJSON: string, nextUserId: number | null, queueDecisionAt?: number }
interface TransitionContext { queue: Queue, player: PlayerPosition, preferences: unknown, loading: boolean }
export type TransitionTrackKind = 'sing' | 'listen' | 'house' | 'request'

export const createTransitionPresentationSelector = () => createSelector(
  [
    (context: TransitionContext) => context.queue,
    (context: TransitionContext) => context.player.queueId,
    (context: TransitionContext) => context.player.historyJSON,
    (context: TransitionContext) => context.player.nextUserId,
    (context: TransitionContext) => context.preferences,
    (context: TransitionContext) => context.loading,
    (context: TransitionContext) => context.player.queueDecisionAt,
  ],
  (queue, queueId, historyJSON, nextUserId, preferences, loading, queueDecisionAt) => transitionTracks(queue, { queueId, historyJSON, nextUserId, queueDecisionAt }, preferences, loading),
)

export function transitionTracks (queue: Queue, player: PlayerPosition, preferences: unknown, loading = false) {
  const prefs = normalizeQueuePrefs(preferences)
  const history = buildPlayerHistory(player.historyJSON, queue.result, queue.entities)
  const nowSeconds = player.queueDecisionAt || Math.floor(Date.now() / 1000)
  const order = buildRoundRobinQueue(queue.result, queue.entities, history, player.queueId, player.nextUserId, prefs, nowSeconds)
  const index = order.result.indexOf(player.queueId)
  // During media loading the player has already advanced its queueId, but the
  // incoming song still owns the visible transition until the music starts.
  const incoming = order.result.slice(index < 0 ? 0 : index + (loading ? 0 : 1))
    .map(id => queue.entities[id])
    .find((item): item is QueueItem => !!item && item.isOptimistic !== true
      && (item.status === 'APPROVED' || (loading && item.queueId === player.queueId && item.status === 'PLAYING')))
  if (!incoming) return { incoming: undefined, following: undefined }
  // The scheduler holds unused house tracks outside its current result. Ask the
  // same scheduler for the next boundary instead of inventing a display order.
  const projectedHistory = order.result.slice(0, order.result.indexOf(incoming.queueId) + 1)
  const firstParticipant = order.turns[0]?.ids[0]
  const nextUserId = incoming.origin === 'PARTICIPANT' ? null : firstParticipant === undefined ? null : order.entities[firstParticipant].userId
  const after = buildRoundRobinQueue(queue.result, queue.entities, projectedHistory, incoming.queueId, nextUserId, prefs, nowSeconds + (incoming.durationSeconds ?? 180))
  const following = after.result.slice(after.result.indexOf(incoming.queueId) + 1)
    .map(id => after.entities[id]).find(item => item.status === 'APPROVED')
  return { incoming, following }
}

const emojiPart = '[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\p{Emoji_Presentation}][\\uFE0E\\uFE0F\\p{Emoji_Modifier}\\u{E0020}-\\u{E007F}]*'
const titleEmoji = new RegExp(`[#*0-9]\\uFE0F?\\u20E3|${emojiPart}(?:\\u200D${emojiPart})*`, 'gu')
const titleControls = new RegExp('[\\p{Cc}\\p{Cf}]', 'gu')

export function normalizeTransitionTitle (title: string): string {
  return title.normalize('NFKC')
    .replace(titleEmoji, ' ')
    .replace(titleControls, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function transitionTrack (item: QueueItem) {
  const kind: TransitionTrackKind = item.origin === 'HOUSE'
    ? 'house'
    : item.requestIntent === 'SING'
      ? 'sing'
      : item.requestIntent === 'LISTEN' ? 'listen' : 'request'
  const label = { sing: 'Karaoke', listen: 'Para escuchar', house: 'De la casa', request: 'Próxima canción' }[kind]
  const showPerson = kind !== 'house' && (item.origin === 'PARTICIPANT' || kind === 'sing')
  return {
    kind,
    label,
    title: normalizeTransitionTitle(item.title) || 'Próxima canción',
    person: showPerson ? item.userDisplayName.trim() : '',
    table: showPerson ? item.tableLabelSnapshot?.trim() ?? '' : '',
    // A YouTube channel is not necessarily the performing artist.
    artist: item.source === 'LOCAL' ? item.artistOrChannel.trim() : '',
  }
}

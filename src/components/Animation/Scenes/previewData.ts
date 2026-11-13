import type { QueueItem } from 'shared/types'
import type { SceneEvent } from 'shared/eventScenes'
import type { Greeting } from 'shared/greetings'

export function previewQueueItem (event: SceneEvent, values: Record<string, string>): QueueItem {
  return { queueId: 1, songId: null, userId: 1, prevQueueId: null, mediaId: null, rgTrackGain: null, rgTrackPeak: null,
    userDateUpdated: 0, userDisplayName: values.name ?? '', tableLabelSnapshot: values.table ?? '', mediaType: 'youtube', isVideoKeyingEnabled: false,
    origin: event === 'transition' ? 'OPERATOR' : 'PARTICIPANT', requestIntent: event === 'karaoke' ? 'SING' : 'LISTEN', source: 'YOUTUBE', status: 'APPROVED', externalId: null,
    title: values.song ?? '', artistOrChannel: '', durationSeconds: null, thumbnailUrl: null, dateCreated: 0, dateUpdated: 0 }
}
export function previewGreeting (values: Record<string, string>): Greeting | null {
  return values.message ? { greetingId: 1, queueId: 1, userId: 1, roomId: 1, sender: values.sender ?? '', tableLabel: values.table ?? null, message: values.message, status: 'QUEUED', reason: null, createdAt: 0, turnKey: null, title: values.song ?? '' } : null
}

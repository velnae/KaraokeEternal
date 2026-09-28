import type { MediaType } from 'shared/types'
import type { SongSource } from 'shared/queueLifecycle'

export type PlayerKind = 'cdg' | 'mp4' | 'mp4-alpha' | 'youtube'

export const selectPlayerKind = (
  source: SongSource | undefined,
  mediaType: MediaType | null | undefined,
  isVideoKeyingEnabled: boolean,
): PlayerKind | null => {
  if (source === 'YOUTUBE') return mediaType === 'youtube' ? 'youtube' : null
  if (source !== 'LOCAL') return null
  if (mediaType === 'cdg') return 'cdg'
  if (mediaType === 'mp4') return isVideoKeyingEnabled ? 'mp4-alpha' : 'mp4'
  return null
}

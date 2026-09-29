import type { SongSource } from '../../shared/queueLifecycle.js'
import type { SongSourceAdapter } from '../../shared/songSource.js'
import { localSongSource } from './LocalSongSource.js'
import { youtubeSongSource } from './YouTubeSongSource.js'

const sources: Partial<Record<SongSource, SongSourceAdapter>> = {
  LOCAL: localSongSource,
  YOUTUBE: youtubeSongSource,
}

export const getSongSource = (source: SongSource): SongSourceAdapter => {
  const adapter = sources[source]
  if (!adapter) throw new Error(`La fuente de canciones no está configurada: ${source}`)
  return adapter
}

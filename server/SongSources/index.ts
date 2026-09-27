import type { SongSource } from '../../shared/queueLifecycle.js'
import type { SongSourceAdapter } from '../../shared/songSource.js'
import { localSongSource } from './LocalSongSource.js'

const sources: Partial<Record<SongSource, SongSourceAdapter>> = {
  LOCAL: localSongSource,
}

export const getSongSource = (source: SongSource): SongSourceAdapter => {
  const adapter = sources[source]
  if (!adapter) throw new Error(`Song source is not configured: ${source}`)
  return adapter
}

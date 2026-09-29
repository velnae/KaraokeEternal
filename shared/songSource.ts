import type { MediaType } from './types.js'
import type { SongSource } from './queueLifecycle.js'

export interface SongSourceContext {
  roomId: number
}

export interface SongSearchResult {
  source: SongSource
  sourceId: string
  title: string
  artistOrChannel: string
  durationSeconds: number | null
  thumbnailUrl: string | null
  isPlayable: boolean
}

export interface ResolvedSong extends SongSearchResult {
  localSongId: number | null
  externalId: string | null
  mediaId: number | null
  mediaType: Exclude<MediaType, ''> | null
}

export interface SongSourceAdapter {
  readonly source: SongSource
  search(query: string, context: SongSourceContext): Promise<SongSearchResult[]>
  resolve(sourceId: string, context: SongSourceContext): Promise<ResolvedSong | null>
}

export const getResolvedSongValidationError = (song: ResolvedSong): string | null => {
  if (!song.sourceId.trim() || !song.title.trim() || !song.artistOrChannel.trim()) {
    return 'Faltan datos de la canción'
  }

  if (song.durationSeconds !== null
    && (!Number.isInteger(song.durationSeconds) || song.durationSeconds < 0)
  ) {
    return 'La duración de la canción no es válida'
  }

  if (song.source === 'LOCAL') {
    if (!Number.isInteger(song.localSongId) || (song.localSongId ?? 0) <= 0) {
      return 'La canción local debe tener un identificador válido'
    }
    if (!Number.isInteger(song.mediaId) || (song.mediaId ?? 0) <= 0) {
      return 'La canción local debe tener un archivo multimedia válido'
    }
    if (song.externalId !== null || (song.mediaType !== 'cdg' && song.mediaType !== 'mp4')) {
      return 'Los datos o el formato de la canción local no son válidos'
    }
  } else if (song.source === 'YOUTUBE') {
    if (!song.externalId || song.localSongId !== null || song.mediaId !== null || song.mediaType !== 'youtube') {
      return 'Los datos o el formato de la canción de YouTube no son válidos'
    }
  }

  return null
}

import path from 'node:path'
import Library from '../Library/Library.js'
import Media from '../Media/Media.js'
import type {
  ResolvedSong,
  SongSearchResult,
  SongSourceAdapter,
  SongSourceContext,
} from '../../shared/songSource.js'

const normalizeSearchText = (value: string): string => value.trim().toLocaleLowerCase()

export const localSongSource: SongSourceAdapter = {
  source: 'LOCAL',

  async search (query: string, context: SongSourceContext): Promise<SongSearchResult[]> {
    void context
    const filter = normalizeSearchText(query)
    const library = Library.get()

    if (!library.songs || !library.artists) return []

    return library.songs.result
      .map((songId) => {
        const song = library.songs?.entities[songId]
        const artist = song && library.artists?.entities[song.artistId]
        if (!song || !artist) return null

        return {
          source: 'LOCAL' as const,
          sourceId: String(song.songId),
          title: song.title,
          artistOrChannel: artist.name,
          durationSeconds: song.duration,
          thumbnailUrl: null,
          isPlayable: true,
        }
      })
      .filter((song): song is NonNullable<typeof song> => song !== null)
      .filter(song => !filter
        || normalizeSearchText(song.title).includes(filter)
        || normalizeSearchText(song.artistOrChannel).includes(filter),
      )
  },

  async resolve (sourceId: string, context: SongSourceContext): Promise<ResolvedSong | null> {
    void context
    const songId = Number(sourceId)
    if (!Number.isInteger(songId) || songId <= 0 || String(songId) !== sourceId.trim()) return null

    const mediaResult = Media.search({ songId })
    if (!mediaResult.result.length) return null

    let media = mediaResult.entities[mediaResult.result[0]]
    for (const mediaId of mediaResult.result) {
      if (mediaResult.entities[mediaId].isPreferred) media = mediaResult.entities[mediaId]
    }

    return {
      source: 'LOCAL',
      sourceId: String(songId),
      localSongId: songId,
      externalId: null,
      mediaId: media.mediaId,
      mediaType: path.extname(media.relPath).toLocaleLowerCase() === '.mp4' ? 'mp4' : 'cdg',
      title: media.title,
      artistOrChannel: media.artist,
      durationSeconds: media.duration,
      thumbnailUrl: null,
      isPlayable: true,
    }
  },
}

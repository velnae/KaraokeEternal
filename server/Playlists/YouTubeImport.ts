import { randomUUID } from 'node:crypto'
import { youtubePlaylistId, type YouTubePlaylistPreview } from '../../shared/youtubePlaylists.js'
import { youtubeSongSource, type YouTubeSongSourceAdapter } from '../SongSources/YouTubeSongSource.js'
import Playlists from './Playlists.js'

interface PreviewRecord {
  roomId: number
  userId: number
  preview: YouTubePlaylistPreview
  createdPlaylistId?: number
}

export function createYouTubePlaylistImporter (source: Pick<YouTubeSongSourceAdapter, 'inspectPlaylist'> = youtubeSongSource) {
  const previews = new Map<string, PreviewRecord>()
  const prune = () => {
    for (const [id, record] of previews) if (record.preview.expiresAt <= Date.now()) previews.delete(id)
  }
  return {
    async preview (roomId: number, userId: number, url: unknown): Promise<YouTubePlaylistPreview> {
      Playlists.room(roomId)
      const playlistId = youtubePlaylistId(url)
      if (!playlistId) throw new Error('Pega un enlace de una lista de YouTube que incluya «list=».')
      prune()
      if (previews.size >= 100) throw new Error('Hay varias listas en revisión. Espera unos minutos y vuelve a intentarlo.')
      const contents = await source.inspectPlaylist(playlistId)
      prune()
      if (previews.size >= 100) throw new Error('Hay varias listas en revisión. Espera unos minutos y vuelve a intentarlo.')
      const preview = { ...contents, previewId: randomUUID(), suggestedName: contents.title.trim().slice(0, 80), expiresAt: Date.now() + 10 * 60 * 1000 }
      previews.set(preview.previewId, { roomId, userId, preview })
      return structuredClone(preview)
    },
    confirm (roomId: number, userId: number, previewId: unknown, name: unknown): number {
      prune()
      const record = typeof previewId === 'string' ? previews.get(previewId) : undefined
      if (!record || record.roomId !== roomId || record.userId !== userId) {
        throw Object.assign(new Error('La revisión venció. Si ya intentaste crear la lista, comprueba tus listas guardadas; de lo contrario, vuelve a revisar el enlace.'), { status: 410 })
      }
      if (record.createdPlaylistId !== undefined) {
        Playlists.get(roomId, record.createdPlaylistId)
        return record.createdPlaylistId
      }
      const playlistId = Playlists.createFromSongs(roomId, name, record.preview.songs)
      record.createdPlaylistId = playlistId
      return playlistId
    },
  }
}

export default createYouTubePlaylistImporter()

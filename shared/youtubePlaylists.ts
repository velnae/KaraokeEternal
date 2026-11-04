import type { ResolvedSong } from './songSource.js'

export const YOUTUBE_PLAYLIST_MAX_ITEMS = 200

export const playlistOmissionReasons = {
  DUPLICATE: 'Repetida en la lista',
  UNAVAILABLE: 'Video privado, eliminado o no disponible',
  METADATA: 'No se pudieron verificar los datos del video',
  EMBEDDING: 'El video no permite reproducción fuera de YouTube',
  AGE: 'Video con restricción de edad',
  REGION: 'Video no disponible en la región configurada',
  CATEGORY: 'El video no pertenece a la categoría Música',
  LIVE: 'Emisión en directo o estreno pendiente',
  DURATION: 'Duración no válida: debe ser de hasta 7 minutos',
} as const
export type PlaylistOmissionReason = keyof typeof playlistOmissionReasons
export interface PlaylistOmission { position: number, title: string, reason: PlaylistOmissionReason }
export interface YouTubePlaylistContents { title: string, songs: ResolvedSong[], omissions: PlaylistOmission[] }
export interface YouTubePlaylistPreview extends YouTubePlaylistContents {
  previewId: string
  suggestedName: string
  expiresAt: number
}

export function youtubePlaylistId (input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 2048) return null
  try {
    const url = new URL(input.trim())
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const youtube = ['youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)
    if (!(youtube && ['/playlist', '/watch'].includes(url.pathname)) && !(host === 'youtu.be' && /^\/[\w-]{11}$/.test(url.pathname))) return null
    const id = url.searchParams.get('list')
    return id && /^[A-Za-z0-9_-]{10,128}$/.test(id) ? id : null
  } catch { return null }
}

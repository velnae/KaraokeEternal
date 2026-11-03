export const YOUTUBE_MAX_DURATION_SECONDS = 7 * 60
export const youtubeVideoRequirements = `Elige un video de la categoría Música, de hasta ${YOUTUBE_MAX_DURATION_SECONDS / 60} minutos y sin emisiones en directo.`

export const youtubeSearchModes = [
  { value: 'karaoke', label: 'Karaoke' },
  { value: 'lyrics', label: 'Con letras' },
  { value: 'music-video', label: 'Videoclip' },
  { value: 'all', label: 'Todos' },
] as const

export type YouTubeSearchMode = typeof youtubeSearchModes[number]['value']

export function youtubeVideoId (query: string): string | null {
  try {
    const url = new URL(query.trim())
    if (!['https:', 'http:'].includes(url.protocol)) return null
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    let id: string | null = null
    if (host === 'youtu.be') id = url.pathname.split('/')[1]
    else if (['youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
      id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(shorts|embed|live)\//.test(url.pathname) ? url.pathname.split('/')[2] : null
    }
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null
  } catch { return null }
}

export function youtubeSearchError (code: string | null, admin = false): string {
  if (code === 'YOUTUBE_VIDEO_UNSUPPORTED') return youtubeVideoRequirements
  if (code === 'YOUTUBE_SEARCH_QUOTA') return 'Se agotó el límite diario de búsquedas de YouTube. Puedes pegar el enlace de un video en este buscador.'
    + (admin ? ' La búsqueda por texto vuelve al restablecerse la cuota; revisa el límite de search.list en Google Cloud.' : '')
  if (code === 'YOUTUBE_QUOTA') return admin ? 'Se agotó la cuota de YouTube. Puedes usar Archivos locales y revisar la cuota en Google Cloud.' : 'Se agotó la cuota de YouTube. Consulta al organizador.'
  if (code === 'YOUTUBE_RATE_LIMIT') return 'YouTube está limitando las consultas. Espera un minuto antes de volver a buscar.'
  if (code === 'YOUTUBE_UNCONFIGURED') return admin ? 'La búsqueda en YouTube no está configurada. Configura el servicio en el servidor.' : 'Búsqueda no disponible. Consulta al organizador.'
  if (code === 'CONNECTION') return 'Sin conexión o sin respuesta de la sala. Espera a reconectar y vuelve a buscar.'
  return 'No se pudo buscar en YouTube. Intenta nuevamente.'
}

export const youtubeSearchCanRetry = (code: string | null) => !['YOUTUBE_SEARCH_QUOTA', 'YOUTUBE_QUOTA', 'YOUTUBE_UNCONFIGURED', 'YOUTUBE_VIDEO_UNSUPPORTED'].includes(code ?? '')

// These are search intents, not verified classifications of a video's content.
export function youtubeQuery (query: string, mode: YouTubeSearchMode) {
  const trimmed = query.trim()
  if (!trimmed) return ''
  if (youtubeVideoId(trimmed)) return trimmed
  if (mode === 'karaoke' && !/\bkaraoke\b/i.test(trimmed)) return `${trimmed} karaoke`
  if (mode === 'lyrics' && !/\b(letras?|lyrics?)\b/i.test(trimmed)) return `${trimmed} letra lyrics`
  if (mode === 'music-video' && !/\b(videoclip|video oficial|official (music )?video)\b/i.test(trimmed)) return `${trimmed} official music video`
  return trimmed
}

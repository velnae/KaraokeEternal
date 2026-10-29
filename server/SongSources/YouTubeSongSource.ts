import type {
  ResolvedSong,
  SongSearchResult,
  SongSourceAdapter,
  SongSourceContext,
} from '../../shared/songSource.js'
import { youtubeVideoId } from '../../shared/youtubeSearch.js'

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'
const configuredMaxResults = Number.parseInt(process.env.KES_YOUTUBE_MAX_RESULTS ?? '', 10)
const defaultMaxResults = Number.isInteger(configuredMaxResults) && configuredMaxResults > 0
  ? configuredMaxResults
  : 10

interface YouTubeThumbnail {
  url?: string
}

interface YouTubeVideo {
  id?: string
  snippet?: {
    title?: string
    channelTitle?: string
    thumbnails?: Record<string, YouTubeThumbnail>
  }
  contentDetails?: {
    duration?: string
    contentRating?: { ytRating?: string }
    regionRestriction?: {
      allowed?: string[]
      blocked?: string[]
    }
  }
  status?: {
    embeddable?: boolean
    privacyStatus?: string
    uploadStatus?: string
  }
}

interface YouTubeApiResponse<T> {
  items?: T[]
  error?: {
    message?: string
    errors?: Array<{ reason?: string }>
    details?: Array<{ reason?: string, metadata?: { quota_metric?: string, quota_unit?: string, quota_limit?: string } }>
  }
}

interface YouTubeSearchItem {
  id?: { videoId?: string }
}

export class YouTubeApiError extends Error {
  code: 'YOUTUBE_API' | 'YOUTUBE_QUOTA' | 'YOUTUBE_SEARCH_QUOTA' | 'YOUTUBE_RATE_LIMIT' | 'YOUTUBE_UNCONFIGURED'

  constructor (message: string, code: YouTubeApiError['code']) {
    super(message)
    this.name = 'YouTubeApiError'
    this.code = code
  }
}

export interface YouTubeSongSourceOptions {
  apiKey?: string
  fetchImpl?: typeof fetch
  maxResults?: number
  regionCode?: string
}

export const createYouTubeSongSource = ({
  apiKey = process.env.KES_YOUTUBE_API_KEY?.trim(),
  fetchImpl = fetch,
  maxResults = defaultMaxResults,
  regionCode = process.env.KES_YOUTUBE_REGION?.trim().toUpperCase() || 'PE',
}: YouTubeSongSourceOptions = {}): SongSourceAdapter => {
  const cache = new Map<string, { expiresAt: number, results: SongSearchResult[] }>()
  const pending = new Map<string, Promise<SongSearchResult[]>>()
  const blocked = new Map<string, { until: number, error: YouTubeApiError }>()
  const request = async <T>(resource: string, params: Record<string, string>, timeoutMs = 5000): Promise<YouTubeApiResponse<T>> => {
    if (!apiKey) {
      throw new YouTubeApiError('La búsqueda en YouTube no está configurada', 'YOUTUBE_UNCONFIGURED')
    }

    const cooldown = blocked.get(resource)
    if (cooldown && cooldown.until > Date.now()) throw cooldown.error
    const url = new URL(`${YOUTUBE_API_BASE}/${resource}`)
    Object.entries({ ...params, key: apiKey }).forEach(([key, value]) => url.searchParams.set(key, value))

    let response: Response
    try {
      response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
    } catch {
      throw new YouTubeApiError('YouTube no está disponible temporalmente', 'YOUTUBE_API')
    }

    let data: YouTubeApiResponse<T>
    try {
      data = await response.json() as YouTubeApiResponse<T>
    } catch {
      throw new YouTubeApiError('YouTube devolvió una respuesta no válida. Intenta nuevamente.', 'YOUTUBE_API')
    }
    if (!response.ok) {
      const reason = data.error?.errors?.[0]?.reason
      const isQuota = reason === 'quotaExceeded' || reason === 'dailyLimitExceeded'
      const dailySearch = data.error?.details?.some(detail => detail.metadata?.quota_metric === 'youtube.googleapis.com/search_list'
        && (detail.metadata.quota_unit?.includes('/d/') || detail.metadata.quota_limit?.includes('PerDay')))
      const rateLimited = response.status === 429 || ['rateLimitExceeded', 'userRateLimitExceeded'].includes(reason ?? '')
      const error = new YouTubeApiError(
        dailySearch ? 'Se agotó el límite diario de búsquedas de YouTube' : isQuota ? 'Se agotó la cuota de búsqueda de YouTube' : rateLimited ? 'YouTube está limitando las consultas. Espera un minuto.' : 'No se pudo consultar YouTube',
        dailySearch ? 'YOUTUBE_SEARCH_QUOTA' : isQuota ? 'YOUTUBE_QUOTA' : rateLimited ? 'YOUTUBE_RATE_LIMIT' : 'YOUTUBE_API',
      )
      // Fail fast during provider throttling; never automatically retry searches.
      if (dailySearch || isQuota || rateLimited) blocked.set(resource, { until: Date.now() + 60000, error })
      throw error
    }

    return data
  }

  const fetchVideos = async (videoIds: string[], timeoutMs = 20000): Promise<YouTubeVideo[]> => {
    if (!videoIds.length) return []
    const response = await request<YouTubeVideo>('videos', {
      part: 'snippet,contentDetails,status',
      id: videoIds.join(','),
    }, timeoutMs)
    return response.items ?? []
  }

  const normalizeVideo = (video: YouTubeVideo): ResolvedSong | null => {
    if (!video.id || !video.snippet?.title || !video.snippet.channelTitle) return null

    const restriction = video.contentDetails?.regionRestriction
    const isRegionAllowed = !restriction?.allowed || restriction.allowed.includes(regionCode)
    const isRegionBlocked = restriction?.blocked?.includes(regionCode) ?? false
    const isPlayable = video.status?.embeddable === true
      && video.status.privacyStatus === 'public'
      && video.status.uploadStatus === 'processed'
      && video.contentDetails?.contentRating?.ytRating !== 'ytAgeRestricted'
      && isRegionAllowed
      && !isRegionBlocked

    return {
      source: 'YOUTUBE',
      sourceId: video.id,
      localSongId: null,
      externalId: video.id,
      mediaId: null,
      mediaType: 'youtube',
      title: decodeHtml(video.snippet.title),
      artistOrChannel: decodeHtml(video.snippet.channelTitle),
      durationSeconds: parseIsoDuration(video.contentDetails?.duration),
      thumbnailUrl: selectThumbnail(video.snippet.thumbnails),
      isPlayable,
    }
  }

  return {
    source: 'YOUTUBE',

    async search (query: string, context: SongSourceContext): Promise<SongSearchResult[]> {
      void context
      const normalizedQuery = query.trim()
      if (!normalizedQuery) return []

      const videoId = youtubeVideoId(normalizedQuery)
      const key = videoId ? `video:${videoId}` : `query:${normalizedQuery.replace(/\s+/g, ' ').toLowerCase()}`
      const cached = cache.get(key)
      if (cached && cached.expiresAt > Date.now()) {
        cache.delete(key)
        cache.set(key, cached)
        return cached.results.map(result => ({ ...result }))
      }
      const existing = pending.get(key)
      if (existing) return (await existing).map(result => ({ ...result }))
      const load = async (): Promise<SongSearchResult[]> => {
        const search = videoId
          ? null
          : await request<YouTubeSearchItem>('search', {
              part: 'snippet', type: 'video', q: normalizedQuery,
              maxResults: String(Math.min(Math.max(maxResults, 1), 50)), regionCode,
              safeSearch: 'moderate', videoEmbeddable: 'true', videoSyndicated: 'true',
            })
        const ids = videoId ? [videoId] : (search?.items ?? []).flatMap(item => item.id?.videoId ? [item.id.videoId] : [])
        const videos = await fetchVideos(ids, 5000)
        const byId = new Map(videos.map(video => [video.id, video]))
        return ids.map(id => byId.get(id)).map(video => video ? normalizeVideo(video) : null)
          .filter((song): song is ResolvedSong => song !== null && song.isPlayable)
      }
      const task = load()
      pending.set(key, task)
      try {
        const results = await task
        cache.delete(key)
        cache.set(key, { results, expiresAt: Date.now() + 10 * 60 * 1000 })
        while (cache.size > 200) cache.delete(cache.keys().next().value!)
        return results.map(result => ({ ...result }))
      } finally { pending.delete(key) }
    },

    async resolve (sourceId: string, context: SongSourceContext): Promise<ResolvedSong | null> {
      void context
      const videoId = sourceId.trim()
      if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null
      const video = (await fetchVideos([videoId]))[0]
      return video ? normalizeVideo(video) : null
    },
  }
}

export const youtubeSongSource = createYouTubeSongSource()

export const parseIsoDuration = (value?: string): number | null => {
  if (!value) return null
  const match = value.match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/)
  if (!match) return null
  const [, days = '0', hours = '0', minutes = '0', seconds = '0'] = match
  return Number(days) * 86400 + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)
}

const selectThumbnail = (thumbnails?: Record<string, YouTubeThumbnail>): string | null => {
  return thumbnails?.high?.url ?? thumbnails?.medium?.url ?? thumbnails?.default?.url ?? null
}

const decodeHtml = (value: string): string => value.replace(
  /&(#\d+|#x[\da-f]+|amp|quot|apos|lt|gt);/gi,
  (entity, code: string) => {
    if (code[0] === '#') {
      const radix = code[1]?.toLowerCase() === 'x' ? 16 : 10
      const number = parseInt(code.slice(radix === 16 ? 2 : 1), radix)
      return Number.isFinite(number) ? String.fromCodePoint(number) : entity
    }
    return ({ amp: '&', quot: '"', apos: '\'', lt: '<', gt: '>' } as Record<string, string>)[code.toLowerCase()] ?? entity
  },
)

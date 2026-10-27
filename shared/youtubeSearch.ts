export const youtubeSearchModes = [
  { value: 'karaoke', label: 'Karaoke' },
  { value: 'lyrics', label: 'Con letras' },
  { value: 'music-video', label: 'Videoclip' },
  { value: 'all', label: 'Todos' },
] as const

export type YouTubeSearchMode = typeof youtubeSearchModes[number]['value']

// These are search intents, not verified classifications of a video's content.
export function youtubeQuery (query: string, mode: YouTubeSearchMode) {
  const trimmed = query.trim()
  if (!trimmed) return ''
  if (mode === 'karaoke' && !/\bkaraoke\b/i.test(trimmed)) return `${trimmed} karaoke`
  if (mode === 'lyrics' && !/\b(letras?|lyrics?)\b/i.test(trimmed)) return `${trimmed} letra lyrics`
  if (mode === 'music-video' && !/\b(videoclip|video oficial|official (music )?video)\b/i.test(trimmed)) return `${trimmed} official music video`
  return trimmed
}

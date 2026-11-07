import type { SongSource } from './queueLifecycle.js'

export type MusicBlockRule
  = { kind: 'artist', artist: string, aliases: string[] }
    | { kind: 'song', artist: string, title: string }
    | { kind: 'resource', source: SongSource, sourceId: string }

export interface MusicBlocking { rules: MusicBlockRule[] }
export const defaultMusicBlocking: MusicBlocking = {
  rules: [{ kind: 'artist', artist: 'Faraón Love Shady', aliases: ['Faraón'] }],
}
export const musicBlockedMessage = 'Esta canción no está disponible por la política de contenido del local. Elige otra canción.'
export const musicBlockedStatus = 'No disponible por política del local'
export const musicFilteredMessage = 'Algunos resultados no están disponibles por la política de contenido del local.'
export const musicAllBlockedMessage = 'Estas canciones no están disponibles en este local. Busca otra canción o artista.'

const accentMarks = new RegExp('\\p{M}', 'gu')
const separators = new RegExp('[^\\p{L}\\p{N}]+', 'gu')
export const normalizeMusicText = (value: string): string => value.normalize('NFKD').replace(accentMarks, '').toLowerCase().replace(separators, ' ').trim().replace(/\s+/g, ' ')
const phrase = (text: string, value: string) => ` ${text} `.includes(` ${value} `)

export function validateMusicBlocking (value: unknown): MusicBlocking {
  const rules = (value as MusicBlocking)?.rules
  if (!Array.isArray(rules) || rules.length > 500) throw new Error('Ingrese hasta 500 reglas de bloqueo.')
  const text = (value: unknown): string => {
    if (typeof value !== 'string' || !normalizeMusicText(value) || value.length > 200) throw new Error('Ingrese un nombre o título válido de hasta 200 caracteres.')
    return value.trim()
  }
  const normalized = rules.map((rule): MusicBlockRule => {
    if (rule?.kind === 'artist') {
      if (!Array.isArray(rule.aliases) || rule.aliases.length > 20) throw new Error('Ingrese hasta 20 alias por artista.')
      return { kind: 'artist', artist: text(rule.artist), aliases: [...new Set(rule.aliases.map(text))] }
    }
    if (rule?.kind === 'song') return { kind: 'song', artist: text(rule.artist), title: text(rule.title) }
    if (rule?.kind === 'resource') {
      if ((rule.source !== 'LOCAL' && rule.source !== 'YOUTUBE') || typeof rule.sourceId !== 'string'
        || !(rule.source === 'YOUTUBE' ? /^[\w-]{11}$/ : /^[1-9]\d*$/).test(rule.sourceId)) throw new Error('Ingrese un identificador de canción local o video de YouTube válido.')
      return { kind: 'resource', source: rule.source, sourceId: rule.sourceId }
    }
    throw new Error('El tipo de bloqueo no es válido.')
  })
  return { rules: normalized.filter((rule, index) => normalized.findIndex(other => musicRuleKey(other) === musicRuleKey(rule)) === index) }
}

export const musicRuleKey = (rule: MusicBlockRule): string => rule.kind === 'resource'
  ? `${rule.kind}:${rule.source}:${rule.sourceId}`
  : `${rule.kind}:${normalizeMusicText(rule.artist)}:${rule.kind === 'song' ? normalizeMusicText(rule.title) : ''}`

export const musicRuleLabel = (rule: MusicBlockRule): string => rule.kind === 'resource'
  ? `${rule.source === 'YOUTUBE' ? 'YouTube' : 'Archivo local'}: ${rule.sourceId}`
  : rule.kind === 'song' ? `${rule.artist} — ${rule.title}` : rule.artist

export function findMusicBlock (song: { source: SongSource, sourceId: string, title: string, artistOrChannel: string }, settings: MusicBlocking): MusicBlockRule | undefined {
  const title = normalizeMusicText(song.title)
  const artist = normalizeMusicText(song.artistOrChannel).replace(/ (official|oficial|topic)( channel)?$/, '')
  const matchesArtist = (name: string) => {
    const normalized = normalizeMusicText(name)
    // A single-word alias must identify the artist/channel, not an unrelated song title.
    return artist === normalized || (normalized.includes(' ') && (phrase(artist, normalized) || (song.source === 'YOUTUBE' && phrase(title, normalized))))
  }
  return settings.rules.find(rule => rule.kind === 'resource'
    ? rule.source === song.source && rule.sourceId === song.sourceId
    : rule.kind === 'artist'
      ? [rule.artist, ...rule.aliases].some(matchesArtist)
      : matchesArtist(rule.artist) && (title === normalizeMusicText(rule.title) || (song.source === 'YOUTUBE' && phrase(title, normalizeMusicText(rule.title)))))
}

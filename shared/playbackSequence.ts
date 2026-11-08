import type { PublicBirthday } from './birthdays.js'

export type PlaybackEntry = { kind: 'song', queueId: number } | { kind: 'birthday', event: PublicBirthday }
export const nextBirthday = (events: PublicBirthday[]) => events.find(event => event.playback === 'playing' || event.playback === 'scheduled')
export function playbackSequence (songIds: number[], events: PublicBirthday[], currentQueueId: number): PlaybackEntry[] {
  const entries: PlaybackEntry[] = songIds.map(queueId => ({ kind: 'song', queueId }))
  const event = nextBirthday(events)
  if (event) entries.splice(Math.max(0, songIds.indexOf(currentQueueId) + 1), 0, { kind: 'birthday', event })
  return entries
}
export function birthdayWaitSeconds (events: PublicBirthday[], now = Date.now()) {
  const event = nextBirthday(events)
  if (!event) return 0
  return Math.max(0, Math.ceil((event.durationMs - (event.startedAt === null ? 0 : now - event.startedAt)) / 1000))
}

import type { AnimationClip, Intervention, RoomProfile, VoiceFamily } from '../../shared/animation.js'

export const profileIntervals: Record<RoomProfile, number> = { dinner: 20 * 60000, mixed: 12 * 60000, party: 8 * 60000 }
const semanticText = (text: string) => text.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es')
export const heardAt = (row: Intervention) => row.startedAt ?? (row.status === 'UNCERTAIN' && row.startBefore ? row.startBefore - 1000 : 0)
export const voiceBudget = (history: Intervention[], now: number) => Math.max(0, 120000 - history
  .filter(row => heardAt(row) > now - 600000 && heardAt(row) <= now)
  .reduce((total, row) => total + row.durationMs, 0))

export function selectAnnouncement ({ clips, family, profile, history, sessionId, recentSessions, ready, now, random = Math.random }: {
  clips: AnimationClip[]
  family: VoiceFamily
  profile: RoomProfile
  history: Intervention[]
  sessionId: string
  recentSessions: string[]
  ready: string[]
  now: number
  random?: () => number
}): { clip?: AnimationClip, reason: string } {
  let eligible = clips.filter(clip => clip.kind === 'voice' && clip.family === family && clip.approvedForAuto && clip.modes?.includes(profile))
  eligible = eligible.filter(clip => (!clip.validUntil || clip.validUntil > now) && (family !== 'promotion' || !!clip.validUntil))
  if (!eligible.length) return { reason: 'No hay variantes aprobadas para este evento y perfil.' }
  eligible = eligible.filter(clip => ready.includes(clip.checksum))
  if (!eligible.length) return { reason: 'El audio del catálogo todavía no está preparado.' }
  const heard = history.filter(row => heardAt(row)).sort((a, b) => heardAt(b) - heardAt(a))
  const environmental = ['invitation', 'booth', 'promotion'].includes(family)
  if (environmental) {
    const last = heard.find(row => ['invitation', 'booth', 'promotion'].includes(row.family ?? ''))
    if (last && now - heardAt(last) < profileIntervals[profile]) return { reason: 'Esperando el intervalo del perfil de sala.' }
    eligible = eligible.filter(clip => !heard.some(row => row.sessionId === sessionId && semanticText(row.displayText) === semanticText(clip.displayText)))
    const fresh = eligible.filter(clip => !heard.some(row => recentSessions.includes(row.sessionId ?? '') && semanticText(row.displayText) === semanticText(clip.displayText)))
    if (fresh.length) eligible = fresh
  }
  if (family === 'booth') {
    const previous = heard.filter(row => row.family === 'booth' && row.sessionId === sessionId)
    const cap = profile === 'dinner' ? 0 : profile === 'mixed' ? 1 : 2
    if (previous.length >= cap || (previous[0] && now - heardAt(previous[0]) < 3600000)) return { reason: 'Límite de guiños de cabina alcanzado.' }
  }
  if (family === 'promotion' && heard.some(row => row.family === family && now - heardAt(row) < 3600000)) return { reason: 'Las promociones se separan al menos una hora.' }
  if (heard[0]) eligible = eligible.filter(clip => semanticText(clip.displayText) !== semanticText(heard[0].displayText))
  eligible = eligible.filter(clip => clip.durationMs <= voiceBudget(history, now))
  if (!eligible.length) return { reason: 'Variantes o presupuesto de voz agotados; continúa la música.' }
  const useCount = (clip: AnimationClip) => heard.filter(row => semanticText(row.displayText) === semanticText(clip.displayText)).length
  const least = Math.min(...eligible.map(useCount))
  eligible = eligible.filter(clip => useCount(clip) === least)
  const lastUse = (clip: AnimationClip) => {
    const row = heard.find(row => semanticText(row.displayText) === semanticText(clip.displayText))
    return row ? heardAt(row) : 0
  }
  const oldest = Math.min(...eligible.map(lastUse))
  eligible = eligible.filter(clip => lastUse(clip) === oldest)
  let choice = Math.max(0, Math.min(0.999999, random())) * eligible.reduce((sum, clip) => sum + (clip.weight ?? 1), 0)
  const clip = eligible.find((candidate) => {
    choice -= candidate.weight ?? 1
    return choice < 0
  }) ?? eligible[0]
  return { clip, reason: '' }
}

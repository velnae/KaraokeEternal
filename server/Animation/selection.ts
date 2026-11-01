import type { AnimationClip, Intervention, RoomProfile, VoiceFamily } from '../../shared/animation.js'
import { withoutAudioTags } from '../../shared/audioTags.js'
import { effectCategoryValue } from '../../shared/effectCategories.js'
import { interventionAssets } from '../../shared/animation.js'

export const profileIntervals: Record<RoomProfile, number> = { dinner: 20 * 60000, mixed: 12 * 60000, party: 8 * 60000 }
export const repeatIntervals: Record<RoomProfile, number> = { dinner: 120000, mixed: 60000, party: 30000 }
const semanticText = (text: string) => withoutAudioTags(text).normalize('NFC').toLocaleLowerCase('es')
export const heardAt = (row: Intervention) => row.startedAt ?? (row.status === 'UNCERTAIN' && row.startBefore ? row.startBefore - 1000 : 0)
export const voiceBudget = (history: Intervention[], now: number) => Math.max(0, 120000 - history
  .filter(row => heardAt(row) > now - 600000 && heardAt(row) <= now)
  .reduce((total, row) => total + row.durationMs, 0))

export function supportingEffects (clips: AnimationClip[], family: VoiceFamily, profile: RoomProfile, ready: string[], history: Intervention[], now: number, lastClosingEffectAt = 0) {
  if (profile === 'dinner' || !['closing', 'celebration'].includes(family)) return []
  if (family === 'closing' && ((lastClosingEffectAt > 0 && lastClosingEffectAt > now - 600000) || history.some(row => row.family === 'closing' && row.status === 'UNCERTAIN' && heardAt(row) > now - 600000 && interventionAssets(row).some(asset => asset.kind === 'effect')))) return []
  const category = family === 'closing' ? 'appreciation' : 'celebration'
  return categoryEffects(clips, category, profile, ready, now)
}

export function categoryEffects (clips: AnimationClip[], category: string, profile: RoomProfile, ready: string[], now: number) {
  if (profile === 'dinner') return []
  return clips.filter(asset => asset.kind === 'effect' && effectCategoryValue(asset.category) === category
    && asset.approvedForAuto && asset.modes?.includes(profile) && ready.includes(asset.checksum) && (!asset.validUntil || asset.validUntil > now))
}

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
    if (heard[0] && now - heardAt(heard[0]) < 10000) return { reason: 'Esperando una pausa entre anuncios.' }
    const fresh = eligible.filter(clip => !heard.some(row => recentSessions.includes(row.sessionId ?? '') && semanticText(row.displayText) === semanticText(clip.displayText)))
    if (fresh.length) eligible = fresh
  }
  if (family === 'booth') {
    const previous = heard.find(row => row.family === 'booth')
    if (profile === 'dinner' || (previous && now - heardAt(previous) < 3600000)) return { reason: 'Los guiños de cabina se separan al menos una hora y no se usan en Cena.' }
  }
  if (family === 'promotion' && heard.some(row => row.family === family && now - heardAt(row) < 3600000)) return { reason: 'Las promociones se separan al menos una hora.' }
  const repeatAfter = environmental ? profileIntervals[profile] : ['welcome', 'goodbye'].includes(family) ? 0 : repeatIntervals[profile]
  eligible = eligible.filter(clip => !heard.some(row => semanticText(row.displayText) === semanticText(clip.displayText) && now - heardAt(row) < repeatAfter))
  if (heard[0]) {
    const alternatives = eligible.filter(clip => semanticText(clip.displayText) !== semanticText(heard[0].displayText))
    if (alternatives.length) eligible = alternatives
  }
  eligible = eligible.filter(clip => clip.durationMs <= voiceBudget(history, now))
  if (!eligible.length) return { reason: 'Variantes o presupuesto de voz agotados; continúa la música.' }
  const useCount = (clip: AnimationClip) => heard.filter(row => row.sessionId === sessionId && semanticText(row.displayText) === semanticText(clip.displayText)).length
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

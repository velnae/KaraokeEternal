import Animation from './Animation.js'
import { catalogClips } from './catalog.js'
import { animationPrefs, interventionAssets, type AnimationClip } from '../../shared/animation.js'
import { audioUsage } from './usage.js'
import { effectCategoryValue } from '../../shared/effectCategories.js'

// Balance kinds/event families and rotate toward least-recently used resources.
// This is a preparation window, not the complete management inventory.
export function preparationClips (roomId: number) {
  const prefs = animationPrefs(Animation.room(roomId).prefs.animation)
  const clips = catalogClips(roomId).filter(clip => (!clip.validUntil || clip.validUntil > Date.now()) && (clip.modes?.includes(prefs.profile) || clip.family === 'manual'))
  const usage = audioUsage(roomId, clips.map(clip => clip.id))
  clips.sort((a, b) => (usage[a.id].lastStartedAt ?? 0) - (usage[b.id].lastStartedAt ?? 0) || a.id.localeCompare(b.id))
  const automatic = (clip: AnimationClip) => {
    if (!prefs.automation) return false
    if (clip.kind === 'ambience') return prefs.ambienceEnabled
    if (clip.kind === 'voice') return clip.approvedForAuto && clip.family !== 'manual' && !!clip.family && prefs.events[clip.family] && (clip.family !== 'promotion' || (clip.validUntil ?? 0) > Date.now())
    const category = effectCategoryValue(clip.category)
    return clip.approvedForAuto && prefs.profile !== 'dinner' && ((category === 'appreciation' && prefs.events.closing)
      || (['celebration', 'anticipation'].includes(category) && prefs.events.celebration)
      || (category === 'transition' && prefs.events.turn)
      || (category === 'notification' && (prefs.events.invitation || prefs.events.promotion)))
  }
  const result: AnimationClip[] = []
  const selected = new Set<string>()
  const add = (clip: AnimationClip) => {
    if (!selected.has(clip.checksum) && result.length < 24) {
      result.push(clip)
      selected.add(clip.checksum)
    }
  }
  const active = Animation.active(roomId)
  if (active) for (const clip of interventionAssets(active)) add(clip)
  const ambient = Animation.ambience(roomId)
  if (ambient) add(ambient.clip)
  if (prefs.automation && prefs.ambienceEnabled) {
    let remaining = ambient ? 1 : 2
    for (const clip of clips.filter(clip => clip.kind === 'ambience' && clip.approvedForAuto)) {
      if (selected.has(clip.checksum)) continue
      add(clip)
      if (--remaining === 0) break
    }
  }
  // Spend the bounded decode window on enabled automatic events before optional demos.
  for (const pool of [clips.filter(automatic), clips.filter(clip => !automatic(clip))]) {
    const groups = new Map<string, AnimationClip[]>()
    for (const clip of pool) {
      const key = `${clip.kind}:${clip.family}`
      groups.set(key, [...(groups.get(key) ?? []), clip])
    }
    for (let index = 0; result.length < 24; index++) {
      let found = false
      for (const group of groups.values()) if (group[index]) {
        found = true
        add(group[index])
      }
      if (!found) break
    }
  }
  return result
}

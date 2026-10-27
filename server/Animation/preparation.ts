import Animation from './Animation.js'
import { catalogClips } from './catalog.js'
import { animationPrefs, interventionAssets, type AnimationClip } from '../../shared/animation.js'

// Balance kinds/event families and rotate toward least-recently used resources.
// This is a preparation window, not the complete management inventory.
export function preparationClips (roomId: number) {
  const prefs = animationPrefs(Animation.room(roomId).prefs.animation)
  const clips = catalogClips(roomId).filter(clip => (!clip.validUntil || clip.validUntil > Date.now()) && (clip.modes?.includes(prefs.profile) || clip.family === 'manual'))
  const history = Animation.selectionHistory(roomId)
  const lastUsed = new Map<string, number>()
  for (const row of history) if (row.startedAt) for (const asset of interventionAssets(row)) lastUsed.set(asset.id, Math.max(lastUsed.get(asset.id) ?? 0, row.startedAt))
  clips.sort((a, b) => (lastUsed.get(a.id) ?? 0) - (lastUsed.get(b.id) ?? 0) || a.id.localeCompare(b.id))
  const groups = new Map<string, AnimationClip[]>()
  for (const clip of clips) {
    const key = `${clip.kind}:${clip.family}`
    groups.set(key, [...(groups.get(key) ?? []), clip])
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
  for (let index = 0; result.length < 24; index++) {
    let found = false
    for (const group of groups.values()) if (group[index]) {
      found = true
      add(group[index])
    }
    if (!found) break
  }
  return result
}

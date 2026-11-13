import { resolveEventScene, sceneCueEnabled, sceneVoiceCue, type EventScene, type SceneResources } from './eventScenes.js'

export interface SceneAudioTiming { sceneDelayMs?: number, sceneVolume?: number, sceneFadeMs?: number, sceneCueId?: string, sceneStartMs?: number }
/** Independent resource cues join the same finite authorized foreground sequence. */
export function sceneAudioPlan<T extends { durationMs: number, role?: string, sceneCueId?: string }> (scene: EventScene | null, assets: T[], fixed: Record<string, T> = {}): Array<T & SceneAudioTiming> {
  if (!scene) return assets
  const groups = new Map<string, T[]>()
  for (const asset of assets) {
    const cue = sceneVoiceCue(scene, asset.role ?? 'announcement', asset.sceneCueId)
    if (cue) groups.set(cue.id, [...(groups.get(cue.id) ?? []), asset])
  }
  const result: Array<T & SceneAudioTiming> = []
  const resources: SceneResources = {}
  for (const cue of scene.cues.filter(cue => cue.lane === 'voice' && sceneCueEnabled(cue))) {
    const group = cue.binding === 'resource' ? fixed[cue.id] ? [fixed[cue.id]] : [] : groups.get(cue.id) ?? []
    if (group.length) resources[cue.id] = { id: cue.id, durationMs: group.reduce((sum, asset) => sum + asset.durationMs, 0) }
  }
  const schedule = resolveEventScene(scene, resources).filter(cue => cue.lane === 'voice').sort((a, b) => a.startMs - b.startMs)
  let end = 0
  for (const cue of schedule) {
    const group = cue.binding === 'resource' ? fixed[cue.id] ? [fixed[cue.id]] : [] : groups.get(cue.id) ?? []
    if (!group.length) continue
    let start = cue.startMs
    if (start < end) throw new Error(`Los audios de la coreografía no pueden superponerse: ${cue.label ?? cue.slot}.`)
    for (const asset of group) {
      result.push({ ...asset, sceneCueId: cue.id, sceneStartMs: start, sceneDelayMs: result.length ? start - end : 0, sceneVolume: cue.volume, sceneFadeMs: cue.fadeMs })
      end = start + asset.durationMs
      start = end
    }
  }
  return result
}

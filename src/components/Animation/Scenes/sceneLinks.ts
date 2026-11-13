import { scenePreviousCue, type EventScene, type ResolvedSceneCue, type SceneCue } from 'shared/eventScenes'

export interface SceneLink { source: SceneCue, target: SceneCue, edge: 'start' | 'end', offsetMs: number, resolved: boolean }

/** Dependency direction is independent of chronological order (negative offsets). */
export function sceneLinks (scene: EventScene, resolved: ResolvedSceneCue[], selectedId: string | null): SceneLink[] {
  const ids = new Set(resolved.map(cue => cue.id))
  const resources = Object.fromEntries(resolved.filter(cue => cue.resource).map(cue => [cue.id, cue.resource]))
  return scene.cues.flatMap((target): SceneLink[] => {
    const source = target.anchor === 'block'
      ? scene.cues.find(cue => cue.id === target.referenceId)
      : target.anchor === 'previous' ? scenePreviousCue(scene, target, resolved.some(cue => cue.lane === 'voice') ? resources : undefined) : undefined
    if (!source || (target.id !== selectedId && source.id !== selectedId)) return []
    return [{ source, target, edge: target.anchor === 'block' ? target.referenceEdge ?? 'start' : 'end', offsetMs: target.offsetMs, resolved: ids.has(source.id) && ids.has(target.id) }]
  })
}

export const sceneOffsetLabel = (milliseconds: number) => `${milliseconds > 0 ? '+' : milliseconds < 0 ? '−' : ''}${new Intl.NumberFormat('es', { maximumFractionDigits: 3 }).format(Math.abs(milliseconds) / 1000)} s`

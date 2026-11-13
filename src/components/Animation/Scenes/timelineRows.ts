import type { SceneCue, ResolvedSceneCue } from 'shared/eventScenes'

/** Overlapping elements remain individually selectable within their lane. */
export function timelineRows (items: SceneCue[], resolved: ResolvedSceneCue[]) {
  const entries = items.map(cue => ({ cue, timing: resolved.find(item => item.id === cue.id) })).sort((a, b) => (a.timing?.startMs ?? 0) - (b.timing?.startMs ?? 0))
  const ends: number[] = []
  const positions: Record<string, number> = {}
  for (const { cue, timing } of entries) {
    const start = timing?.startMs ?? 0
    let row = ends.findIndex(end => end <= start)
    if (row === -1) row = ends.length
    positions[cue.id] = row
    ends[row] = timing?.endMs ?? start + 500
  }
  return { positions, count: Math.max(1, ends.length) }
}

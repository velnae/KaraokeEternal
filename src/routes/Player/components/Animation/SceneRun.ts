import { resolveEventScene, sceneHasReferences, scenePreviousCue, sceneVoiceCue, type EventScene, type SceneCue, type SceneResources, type SceneTiming } from 'shared/eventScenes'

/** One local run owns waits and cancellation; media end is never synthesized. */
export default class SceneRun {
  readonly controller = new AbortController()
  startedAt: number
  endedAt: number | null = null
  readonly resources: SceneResources = {}
  readonly timing: SceneTiming = { starts: Object.create(null), ends: Object.create(null) }
  private predictedEndMs: number
  private audioPrepared = false
  private ended!: () => void
  private readonly mediaEnd = new Promise<void>((resolve) => { this.ended = resolve })
  constructor (readonly scene: EventScene, readonly sourceQueueId: number, readonly nextQueueId: number | null, readonly replayKey: number, public awaitingAudio = false) {
    this.startedAt = performance.now() + Math.max(0, scene.startOffsetMs)
    this.predictedEndMs = Math.max(0, -scene.startOffsetMs)
  }

  estimateMediaEnd (milliseconds: number) { if (Number.isFinite(milliseconds)) this.predictedEndMs = performance.now() - this.startedAt + Math.max(0, milliseconds) }
  mediaEndMs () { return this.endedAt === null ? this.predictedEndMs : this.endedAt - this.startedAt }

  installAudio<T extends { id: string, durationMs: number, role?: string, sceneCueId?: string }> (assets: T[], duration: (asset: T) => number = asset => asset.durationMs) {
    if (this.controller.signal.aborted) return
    const totals: Record<string, number> = {}
    for (const asset of assets) {
      const cue = sceneVoiceCue(this.scene, asset.role ?? 'announcement', asset.sceneCueId)
      if (cue) totals[cue.id] = (totals[cue.id] ?? 0) + duration(asset)
    }
    for (const [id, durationMs] of Object.entries(totals)) this.resources[id] = { id, durationMs }
    this.audioPrepared = true
    if (this.awaitingAudio) {
      // Preparation/authorization is not elapsed choreography. Tail runs keep
      // their live media clock instead of opting into this deferred start.
      this.startedAt = Math.max(this.startedAt, performance.now())
      if (this.endedAt !== null) this.endedAt = this.startedAt
      this.awaitingAudio = false
    }
  }

  startCue (id: string, durationMs?: number) {
    if (this.timing.starts![id] === undefined) this.timing.starts![id] = performance.now() - this.startedAt
    if (durationMs !== undefined) this.resources[id] = { ...this.resources[id], id, durationMs }
  }

  endCue (id: string) {
    this.timing.ends![id] = performance.now() - this.startedAt
    const start = this.timing.starts![id]
    if (start !== undefined) this.resources[id] = { ...this.resources[id], id, durationMs: this.timing.ends![id] - start }
  }

  startAudio<T extends { id: string, durationMs: number, role?: string, sceneCueId?: string }> (asset: T, assets: T[], duration: (asset: T) => number = asset => asset.durationMs) {
    const cue = sceneVoiceCue(this.scene, asset.role ?? 'announcement', asset.sceneCueId)
    if (!cue) return
    this.startCue(cue.id)
    const elapsed = performance.now() - this.startedAt - this.timing.starts![cue.id]
    const remaining = assets.slice(assets.indexOf(asset)).filter(item => sceneVoiceCue(this.scene, item.role ?? 'announcement', item.sceneCueId)?.id === cue.id).reduce((sum, item) => sum + duration(item), 0)
    this.resources[cue.id] = { id: cue.id, durationMs: elapsed + remaining }
  }

  endAudio<T extends { id: string, durationMs: number, role?: string, sceneCueId?: string }> (asset: T, assets: T[]) {
    const cue = sceneVoiceCue(this.scene, asset.role ?? 'announcement', asset.sceneCueId)
    if (cue && !assets.slice(assets.indexOf(asset) + 1).some(item => sceneVoiceCue(this.scene, item.role ?? 'announcement', item.sceneCueId)?.id === cue.id)) this.endCue(cue.id)
  }

  private needsMediaEnd (cue: SceneCue, seen = new Set<string>()): boolean {
    if (seen.has(cue.id) || this.timing.starts![cue.id] !== undefined) return false
    seen.add(cue.id)
    if (cue.anchor === 'mediaEnd') return true
    const target = cue.anchor === 'block' ? this.scene.cues.find(item => item.id === cue.referenceId) : cue.anchor === 'previous' ? scenePreviousCue(this.scene, cue, this.resources) : undefined
    return !!target && this.timing.starts![target.id] === undefined && this.timing.ends![target.id] === undefined && this.needsMediaEnd(target, seen)
  }

  end () {
    if (this.endedAt === null) {
      this.endedAt = performance.now()
      this.ended()
    }
  }

  cancel () {
    this.controller.abort()
    this.ended()
  }

  async until (target: number, valid: () => boolean = () => true) {
    while (performance.now() < target) {
      if (this.controller.signal.aborted || !valid()) throw new Error('La coreografía fue cancelada.')
      await new Promise(resolve => setTimeout(resolve, Math.min(40, target - performance.now())))
    }
    if (this.controller.signal.aborted || !valid()) throw new Error('La coreografía fue cancelada.')
  }

  async wait (cue: SceneCue | undefined, previousAt = this.startedAt, valid?: () => boolean) {
    if (!cue) return true
    if (sceneHasReferences(this.scene)) {
      for (;;) {
        if (this.controller.signal.aborted || !(valid?.() ?? true)) throw new Error('La coreografía fue cancelada.')
        if (this.awaitingAudio) {
          await new Promise(resolve => setTimeout(resolve, 40))
          continue
        }
        const resolved = resolveEventScene(this.scene, this.resources, this.mediaEndMs(), this.timing, false).find(item => item.id === cue.id)
        if (!resolved && this.audioPrepared) return false
        const waitingForEnd = this.endedAt === null && this.needsMediaEnd(cue) && (!resolved || resolved.startMs >= this.predictedEndMs)
        if (resolved && !waitingForEnd && performance.now() >= this.startedAt + resolved.startMs) return true
        await Promise.race([new Promise(resolve => setTimeout(resolve, 40)), ...(waitingForEnd ? [this.mediaEnd] : [])])
      }
    }
    if (cue.anchor === 'mediaEnd') {
      while (this.endedAt === null && !this.controller.signal.aborted && (valid?.() ?? true)) {
        await Promise.race([this.mediaEnd, new Promise(resolve => setTimeout(resolve, 40))])
      }
    }
    const anchor = cue.anchor === 'previous' ? previousAt : cue.anchor === 'mediaEnd' ? this.endedAt! : this.startedAt
    await this.until(anchor + cue.offsetMs, valid)
    return true
  }
}

import type { AnimationSnapshot } from '../../../../../shared/animation.js'

export function needsAnimationClock (snapshot: AnimationSnapshot | null | undefined, activity: {
  connected: boolean
  idle: boolean
  busy: boolean
  ambience: boolean
}, now: number) {
  if (!activity.connected) return false
  return activity.busy || activity.ambience || !!(snapshot && (
    snapshot.active || snapshot.blockedUntil > now || (snapshot.ambience?.until ?? 0) > now
    || (activity.idle && (snapshot.prefs.enabled || snapshot.greetingVoiceEnabled))
  ))
}

/** Coalesce unchanged readiness, but never cache failures or an obsolete owner. */
export class ReadinessPublication {
  private revision = 0
  private confirmed = ''
  private pending: { key: string, promise: Promise<void> } | null = null

  invalidate () {
    this.revision++
    this.confirmed = ''
    this.pending = null
  }

  publish (identity: string, send: () => Promise<void>): Promise<void> {
    const revision = this.revision
    const key = `${revision}:${identity}`
    if (this.confirmed === key) return Promise.resolve()
    if (this.pending?.key === key) return this.pending.promise
    const promise: Promise<void> = send().then((): void => {
      if (this.revision === revision && this.pending?.key === key) this.confirmed = key
      return undefined
    }).finally(() => {
      if (this.pending?.promise === promise) this.pending = null
    })
    this.pending = { key, promise }
    return promise
  }
}

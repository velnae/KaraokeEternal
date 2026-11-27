import type { AnimationClip } from './animation.js'

export const KARAOKE_CUE = 'server/KARAOKE_CUE'
export const KARAOKE_REMINDER_MS = 10000
export const KARAOKE_ENTRY_ATTACK_MS = 1500
export const KARAOKE_FADE_MS = 1200
export const karaokeCueKinds = ['entry', 'reminder', 'countdown', 'ended'] as const
export type KaraokeCueKind = typeof karaokeCueKinds[number]
export interface KaraokeCueContext {
  queueId: number
  kind: KaraokeCueKind
  token: string
  runId?: string
  revision?: number
}
export interface KaraokeCuePreparation { assets: AnimationClip[], reminder: AnimationClip[] }
export interface KaraokeCueClip extends AnimationClip { playbackDurationMs?: number }

export const karaokeCueDuration = (clip: KaraokeCueClip) => clip.playbackDurationMs ?? clip.durationMs
export function karaokeCueClip (clip: AnimationClip, kind: KaraokeCueKind): KaraokeCueClip {
  return kind === 'countdown' || kind === 'ended' ? { ...clip, playbackDurationMs: clip.durationMs } : clip
}
export function karaokeCueSegment (clip: KaraokeCueClip) {
  return clip.playbackDurationMs === undefined ? undefined : { offsetMs: 0, durationMs: clip.playbackDurationMs, fadeOutMs: 300 }
}

/** Only the same confirmed countdown may keep its finite tail over music. */
export function karaokeCountdownTail (cue: KaraokeCueContext, turn: { queueId: number, runId: string, revision: number, phase: string } | null | undefined) {
  return cue.kind === 'countdown' && turn?.queueId === cue.queueId && turn.runId === cue.runId
    && turn.revision === (cue.revision ?? -2) + 1 && (turn.phase === 'released' || turn.phase === 'played')
}

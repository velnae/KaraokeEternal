import type { AnimationClip } from './animation.js'
import type { TransitionVideo, TransitionVideoBackground } from './transitionVideo.js'

export const KARAOKE_BACKGROUND_VIDEO_MS = 130_000
export const KARAOKE_BACKGROUND_AUDIO_MS = 130_000
export const KARAOKE_EFFECT_AUDIO_MS = 6000

export type KaraokeBackgroundKind = 'video' | 'bed' | 'effect'
export type KaraokeBackgroundMode = 'none' | 'single' | 'all'
export interface KaraokeBackgroundSettings {
  revision: number
  videoMode: KaraokeBackgroundMode
  videoId: string | null
  bedMode: KaraokeBackgroundMode
  bedId: string | null
  bedVolume: number
  dimOpacity: number
  mascotImageId?: string | null
  entryEffectId?: string | null
  countdownEffectId?: string | null
  endedEffectId?: string | null
  reminderEffectId?: string | null
  effectVolume?: number
}
export interface KaraokeBackgroundAsset {
  id: string
  roomId: number
  kind: KaraokeBackgroundKind
  title: string
  active: boolean
  state: 'preparing' | 'ready' | 'failed'
  error: string | null
  checksum: string | null
  durationMs: number | null
  width: number | null
  height: number | null
  size: number | null
  createdAt: number
  url: string
}
export interface KaraokeBackgroundOverview {
  settings: KaraokeBackgroundSettings
  assets: KaraokeBackgroundAsset[]
}
export interface KaraokeSceneMedia {
  background: TransitionVideoBackground | null
  bed: AnimationClip | null
  volume: number
}
export const defaultKaraokeBackgrounds: KaraokeBackgroundSettings = {
  revision: 0, videoMode: 'none', videoId: null, bedMode: 'none', bedId: null, bedVolume: 0.2, dimOpacity: 0,
  mascotImageId: null, entryEffectId: null, countdownEffectId: null, endedEffectId: null, reminderEffectId: null, effectVolume: 0.5,
}
export const karaokeEffectFields = ['entryEffectId', 'countdownEffectId', 'endedEffectId', 'reminderEffectId'] as const
export function karaokeEffect (asset: KaraokeBackgroundAsset): AnimationClip {
  return { id: asset.id, title: asset.title, displayText: '', kind: 'effect', effectType: 'short', checksum: asset.checksum!, durationMs: asset.durationMs!,
    url: asset.url, roomId: asset.roomId, source: 'Karaoke', license: 'Uploaded by the operator.' }
}
export function karaokeVideo (asset: KaraokeBackgroundAsset): TransitionVideo {
  return { ...asset, requestId: asset.id, reason: asset.error, frameRate: null, videoUrl: asset.url, posterUrl: null, updatedAt: asset.createdAt }
}
export function karaokeBed (asset: KaraokeBackgroundAsset): AnimationClip {
  return { id: asset.id, title: asset.title, displayText: '', kind: 'ambience', checksum: asset.checksum!, durationMs: asset.durationMs!,
    url: asset.url, roomId: asset.roomId, source: 'Karaoke', license: 'Uploaded by the operator.', loop: true }
}
export function isKaraokeBedClip (clip: AnimationClip) {
  return clip.kind === 'ambience' && clip.source === 'Karaoke' && clip.url === `api/rooms/${clip.roomId}/karaoke-calls/backgrounds/assets/${clip.id}`
}
export function isKaraokeEffectClip (clip: AnimationClip) {
  return clip.kind === 'effect' && clip.source === 'Karaoke' && clip.url === `api/rooms/${clip.roomId}/karaoke-calls/backgrounds/assets/${clip.id}`
}
export function validateKaraokeBackgrounds (value: unknown): KaraokeBackgroundSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Revise la configuración de fondos.')
  const input = { ...defaultKaraokeBackgrounds, ...value } as KaraokeBackgroundSettings
  if (!Number.isSafeInteger(input.revision) || input.revision < 0 || input.revision >= Number.MAX_SAFE_INTEGER
    || !['none', 'single', 'all'].includes(input.videoMode) || !['none', 'single', 'all'].includes(input.bedMode)
    || ![input.videoId, input.bedId].every(id => id === null || (typeof id === 'string' && /^[\w-]{1,100}$/.test(id)))
    || !Number.isFinite(input.bedVolume) || input.bedVolume < 0 || input.bedVolume > 1
    || ![input.mascotImageId, ...karaokeEffectFields.map(key => input[key])].every(id => id === null || (typeof id === 'string' && /^[\w-]{1,100}$/.test(id)))
    || !Number.isFinite(input.effectVolume) || input.effectVolume! < 0 || input.effectVolume! > 1
    || !Number.isFinite(input.dimOpacity) || input.dimOpacity < 0 || input.dimOpacity > 0.85) throw new Error('Revise los modos, recursos y volúmenes de los fondos.')
  return { revision: input.revision, videoMode: input.videoMode, videoId: input.videoId, bedMode: input.bedMode, bedId: input.bedId, bedVolume: input.bedVolume, dimOpacity: input.dimOpacity,
    mascotImageId: input.mascotImageId, entryEffectId: input.entryEffectId, countdownEffectId: input.countdownEffectId, endedEffectId: input.endedEffectId,
    reminderEffectId: input.reminderEffectId, effectVolume: input.effectVolume }
}

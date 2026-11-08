import type { PlayerDisplaySettings } from './playerDisplay.js'

export type PlayerLogoKind = 'png' | 'gif'
export interface PlayerLogoImage {
  id: string
  kind: PlayerLogoKind
  width: number
  height: number
  frames: number
  durationMs: number
  bytes: number
}
export const PLAYER_LOGO_LIMITS = {
  pngBytes: 5 * 1024 * 1024, gifBytes: 8 * 1024 * 1024,
  pngDimension: 2048, gifDimension: 1024, gifFrames: 300, gifDurationMs: 30000,
  decodedBytes: 64 * 1024 * 1024,
} as const
export const isPlayerLogoId = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/.test(value)
export const playerLogoImagePath = (id: string, poster = false) => `api/player-logo-images/${id}/${poster ? 'poster' : 'image'}`

export function resolvePlayerLogo (logo: PlayerDisplaySettings['logo'], brandLogo: string) {
  if (logo.source === 'brand') return { still: brandLogo, fallback: '', animated: '' }
  const poster = logo.animatedImageId ? playerLogoImagePath(logo.animatedImageId, true) : ''
  return {
    still: logo.staticImageId ? playerLogoImagePath(logo.staticImageId) : poster,
    fallback: logo.staticImageId ? poster : '',
    animated: logo.animatedImageId ? playerLogoImagePath(logo.animatedImageId) : '',
  }
}

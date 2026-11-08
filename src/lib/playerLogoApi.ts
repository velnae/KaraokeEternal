import HttpApi from './HttpApi'
import type { PlayerLogoImage, PlayerLogoKind } from 'shared/playerLogo'

const api = new HttpApi('player-logo-images')
export async function uploadPlayerLogo (file: File, kind: PlayerLogoKind, signal: AbortSignal) {
  const body = new FormData()
  body.append('file', file)
  return api.post<PlayerLogoImage>(`/${kind}`, { body, signal })
}
export const discardPlayerLogo = (id: string) => api.delete(`/${id}`, { keepalive: true })

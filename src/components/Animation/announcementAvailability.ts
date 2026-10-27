import type { AnimationSnapshot } from '../../../shared/animation.js'

export function announcementBlocker ({ snapshot, connected, hasClip, roomClosed = false, expired = false, now }: {
  snapshot: AnimationSnapshot | null
  connected: boolean
  hasClip: boolean
  roomClosed?: boolean
  expired?: boolean
  now: number
}): string | null {
  if (!snapshot) return 'Conectando los controles de la sala…'
  if (!connected) return 'Sin conexión. Espere a que se restablezcan los controles.'
  if (roomClosed) return 'La sala está cerrada. Ábrala antes de solicitar un anuncio.'
  if (!snapshot.prefs.enabled) return 'Active el animador para solicitar un anuncio.'
  if (!snapshot.playerPresent) return 'Abra el reproductor de la sala para enviar el anuncio.'
  if (!hasClip) return 'Seleccione un clip disponible en el catálogo.'
  if (expired) return 'El recurso ya venció. Seleccione otro anuncio.'
  if (snapshot.prefs.volume === 0) return 'Suba el volumen de voz para solicitar un anuncio.'
  if (snapshot.active) return 'Ya hay una solicitud. Espere a que termine o cancélela.'
  if (snapshot.blockedUntil > now) return 'Esperando el cierre de la intervención anterior.'
  // Unlocking/decoding gates public playback, not a valid pending request.
  return null
}

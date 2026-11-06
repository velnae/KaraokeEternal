export const FULLSCREEN_REQUEST_MS = 5000

export const fullscreenMessages = {
  'entered': 'El reproductor confirmó la pantalla completa.',
  'permission-required': 'Chrome del reproductor requiere autorizar la pantalla completa automática. Abre «Ver pasos».',
  'unsupported': 'El reproductor necesita Chrome 128 o posterior, HTTPS y pantalla completa habilitada.',
  'rejected': 'El reproductor no pudo activar la pantalla completa. Revisa su navegador y vuelve a intentar.',
  'no-player': 'Abre el reproductor de esta sala para continuar.',
  'changed': 'La solicitud venció o cambió el reproductor. Vuelve a intentar.',
  'timeout': 'No llegó la confirmación. Revisa o actualiza el reproductor antes de reintentar.',
  'forbidden': 'Solo los administradores pueden controlar el reproductor.',
  'disconnected': 'No hay conexión con el servidor. Espera a que se restablezca.',
} as const

export interface FullscreenResult {
  status: keyof typeof fullscreenMessages
  origin?: string
}

export interface FullscreenCommand {
  roomId: number
  playerSocketId: string
  expiresAt: number
}

export function fullscreenResult (value: unknown): FullscreenResult | null {
  if (!value || typeof value !== 'object') return null
  const { status, origin } = value as Partial<FullscreenResult>
  if (typeof status !== 'string' || !Object.prototype.hasOwnProperty.call(fullscreenMessages, status)) return null
  if (origin !== undefined) {
    if (typeof origin !== 'string' || origin.length > 512) return null
    try {
      const parsed = new URL(origin)
      if (!['https:', 'http:'].includes(parsed.protocol) || parsed.origin !== origin) return null
    } catch { return null }
  }
  return { status, ...(origin ? { origin } : {}) }
}

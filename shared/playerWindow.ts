export const PLAYER_WINDOW_REQUEST_MS = 5000

export const playerWindowMessages = {
  'entered': 'El reproductor confirmó la pantalla completa.',
  'closed': 'El reproductor se cerró. La cola se conserva.',
  'permission-required': 'Chrome del reproductor requiere autorizar la pantalla completa automática. Abre «Ver pasos».',
  'unsupported': 'El reproductor necesita Chrome 128 o posterior, HTTPS y pantalla completa habilitada.',
  'rejected': 'El reproductor no pudo completar la solicitud. Revisa su navegador y vuelve a intentar.',
  'no-player': 'Abre el reproductor de esta sala para continuar.',
  'changed': 'La solicitud venció o cambió el reproductor. Vuelve a intentar.',
  'timeout': 'No llegó la confirmación. Revisa o actualiza el reproductor antes de reintentar.',
  'forbidden': 'Solo los administradores pueden controlar el reproductor.',
  'disconnected': 'No hay conexión con el servidor. Espera a que se restablezca.',
} as const

export interface PlayerWindowResult {
  status: keyof typeof playerWindowMessages
  origin?: string
}

export interface PlayerWindowCommand {
  roomId: number
  playerSocketId: string
  expiresAt: number
}

export function playerWindowResult (value: unknown): PlayerWindowResult | null {
  if (!value || typeof value !== 'object') return null
  const { status, origin } = value as Partial<PlayerWindowResult>
  if (typeof status !== 'string' || !Object.prototype.hasOwnProperty.call(playerWindowMessages, status)) return null
  if (origin !== undefined) {
    if (typeof origin !== 'string' || origin.length > 512) return null
    try {
      const parsed = new URL(origin)
      if (!['https:', 'http:'].includes(parsed.protocol) || parsed.origin !== origin) return null
    } catch { return null }
  }
  return { status, ...(origin ? { origin } : {}) }
}

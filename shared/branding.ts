export interface ClientBranding {
  name: string
  logoSrc: string
  supportUrl: string
  player?: PlayerBrandingSettings
}

export interface PlayerBrandingSettings {
  showLogo: boolean
  showAnnouncements: boolean
  alignment: 'left' | 'center'
  backgroundColor: string
  messages: { title: string, text: string }[]
}

export const MAX_BRANDING_MESSAGES = 5
export const MAX_BRANDING_TITLE_LENGTH = 60
export const MAX_BRANDING_TEXT_LENGTH = 100
export const BRANDING_MESSAGE_INTERVAL_MS = 15000
export const SOFT_BROWN_BRANDING_COLOR = '#6b5143'

export const isBrandingBackgroundColor = (value: unknown): value is string => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)

export const defaultPlayerBranding: PlayerBrandingSettings = {
  showLogo: false,
  showAnnouncements: false,
  alignment: 'left',
  backgroundColor: '#030509',
  messages: [{ title: 'Escanea el QR de tu mesa', text: 'Pide tu música o anímate a cantar.' }],
}

// Older stored brands and clients do not have player preferences yet.
export function getPlayerBranding (settings?: Partial<PlayerBrandingSettings>): PlayerBrandingSettings {
  return { ...defaultPlayerBranding, ...settings }
}

export function validatePlayerBranding (input: unknown): PlayerBrandingSettings {
  if (input === undefined) return { ...defaultPlayerBranding, messages: defaultPlayerBranding.messages.map(message => ({ ...message })) }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Revise la configuración de marca del reproductor.')
  const { showLogo, showAnnouncements, messages, alignment = defaultPlayerBranding.alignment, backgroundColor = defaultPlayerBranding.backgroundColor } = input as Record<string, unknown>
  if (typeof showLogo !== 'boolean' || typeof showAnnouncements !== 'boolean') throw new Error('Revise las opciones de visibilidad del reproductor.')
  if (alignment !== 'left' && alignment !== 'center') throw new Error('Elija alineación izquierda o centrada para el comunicado.')
  if (!isBrandingBackgroundColor(backgroundColor)) throw new Error('Use un color de fondo hexadecimal de seis dígitos, por ejemplo #6B5143.')
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_BRANDING_MESSAGES) throw new Error(`Agregue entre 1 y ${MAX_BRANDING_MESSAGES} comunicados.`)
  return {
    showLogo,
    showAnnouncements,
    alignment,
    backgroundColor: backgroundColor.toLowerCase(),
    messages: messages.map((message) => {
      if (!message || typeof message !== 'object' || Array.isArray(message)
        || typeof message.title !== 'string' || !message.title.trim() || message.title.trim().length > MAX_BRANDING_TITLE_LENGTH
        || typeof message.text !== 'string' || message.text.trim().length > MAX_BRANDING_TEXT_LENGTH) {
        throw new Error(`Cada comunicado necesita un título de hasta ${MAX_BRANDING_TITLE_LENGTH} caracteres y un texto de hasta ${MAX_BRANDING_TEXT_LENGTH}.`)
      }
      return { title: message.title.trim(), text: message.text.trim() }
    }),
  }
}

export const defaultClientBranding: ClientBranding = {
  name: '',
  logoSrc: '',
  supportUrl: '',
  player: defaultPlayerBranding,
}

export const MAX_BRANDING_LOGO_BYTES = 256 * 1024

// Keep the editor, preview and API on the same public-link contract.
export function normalizeBrandingSupportUrl (value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.length > 2048) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 2048) return null
    return url.href
  } catch {
    return null
  }
}

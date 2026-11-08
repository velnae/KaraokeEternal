import { isPlayerLogoId } from './playerLogo.js'

export const DISPLAY_REFERENCE = { width: 1920, height: 1080 } as const
export const DISPLAY_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const
export const DISPLAY_ANCHORS = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'] as const
export type DisplayCorner = typeof DISPLAY_CORNERS[number]
export type DisplayAnchor = typeof DISPLAY_ANCHORS[number]
export const MAX_DISPLAY_MESSAGES = 5
export const MAX_DISPLAY_TITLE = 60
export const MAX_DISPLAY_TEXT = 100
export const SOFT_BROWN_DISPLAY_COLOR = '#6b5143'
export const isDisplayColor = (value: unknown): value is string => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)

export interface PlayerDisplaySettings {
  logo: {
    source: 'brand' | 'custom'
    mode: 'static' | 'animated' | 'alternating'
    staticImageId: string | null
    animatedImageId: string | null
    staticSeconds: number
    animatedSeconds: number
    enabled: boolean
    scale: number
    position: DisplayCorner
    marginX: number
    marginY: number
    opacity: number
  }
  announcement: {
    enabled: boolean
    width: number
    position: DisplayAnchor
    offsetX: number
    marginY: number
    padding: number
    textScale: number
    alignment: 'left' | 'center'
    textColor: string | null
    showIcon: boolean
    backgroundColor: string
    backgroundOpacity: number
    borderWidth: number
    borderColor: string
    borderRadius: number
    shadow: boolean
    intervalSeconds: number
    messages: { title: string, text: string }[]
  }
}

// Values in pixels are measured on the FHD reference; offsets/widths are percentages.
export const displayLimits = {
  logo: { scale: [25, 300, 5], marginX: [0, 20, 0.5], marginY: [0, 20, 0.5], opacity: [10, 100, 5], staticSeconds: [5, 300, 1], animatedSeconds: [1, 30, 0.01] },
  announcement: {
    width: [20, 96, 0.1], offsetX: [-20, 20, 0.5], marginY: [0, 20, 0.5], padding: [0, 60, 1],
    textScale: [60, 180, 5], backgroundOpacity: [20, 100, 5], borderWidth: [0, 8, 0.5],
    borderRadius: [0, 48, 1], intervalSeconds: [5, 120, 1],
  },
} as const

export const defaultPlayerDisplay: PlayerDisplaySettings = {
  logo: { enabled: false, scale: 100, position: 'top-right', marginX: 2.5, marginY: 3, opacity: 100,
    source: 'brand', mode: 'static', staticImageId: null, animatedImageId: null, staticSeconds: 60, animatedSeconds: 6 },
  announcement: {
    enabled: false, width: 39.6, position: 'bottom-center', offsetX: 0, marginY: 4, padding: 20,
    textScale: 100, alignment: 'left', textColor: null, showIcon: true, backgroundColor: '#030509',
    backgroundOpacity: 88, borderWidth: 1, borderColor: '#283447', borderRadius: 14, shadow: true,
    intervalSeconds: 15, messages: [{ title: 'Escanea el QR de tu mesa', text: 'Pide tu música o anímate a cantar.' }],
  },
}

const object = (value: unknown): Record<string, unknown> => {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Revise la configuración de pantalla.')
  return value as Record<string, unknown>
}
const boolean = (value: unknown, fallback: boolean): boolean => {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new Error('Revise las opciones de pantalla.')
  return value
}
const number = (value: unknown, fallback: number, range: readonly number[], label: string): number => {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < range[0] || value > range[1]) throw new Error(`${label}: use un valor entre ${range[0]} y ${range[1]}.`)
  return value
}
const color = (value: unknown, fallback: string): string => {
  if (value === undefined) return fallback
  if (!isDisplayColor(value)) throw new Error('Use un color hexadecimal de seis dígitos, por ejemplo #6B5143.')
  return value.toLowerCase()
}
const choice = <T extends string>(value: unknown, fallback: T, choices: readonly T[]): T => {
  if (value === undefined) return fallback
  if (!choices.includes(value as T)) throw new Error('Elija una posición o alineación válida.')
  return value as T
}

const imageId = (value: unknown): string | null => {
  if (value === undefined || value === null) return null
  if (!isPlayerLogoId(value)) throw Object.assign(new Error('Seleccione una imagen de pantalla válida.'), { field: 'logo' })
  return value
}

export function validatePlayerDisplay (input: unknown): PlayerDisplaySettings {
  const settings = object(input)
  const logo = object(settings.logo)
  const announcement = object(settings.announcement)
  const l = defaultPlayerDisplay.logo
  const a = defaultPlayerDisplay.announcement
  const messages = announcement.messages === undefined ? a.messages : announcement.messages
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_DISPLAY_MESSAGES) throw new Error('Agregue entre 1 y 5 comunicados.')
  const result: PlayerDisplaySettings = {
    logo: {
      source: choice(logo.source, l.source, ['brand', 'custom']),
      mode: choice(logo.mode, l.mode, ['static', 'animated', 'alternating']),
      staticImageId: imageId(logo.staticImageId), animatedImageId: imageId(logo.animatedImageId),
      staticSeconds: number(logo.staticSeconds, l.staticSeconds, displayLimits.logo.staticSeconds, 'Tiempo estático'),
      animatedSeconds: number(logo.animatedSeconds, l.animatedSeconds, displayLimits.logo.animatedSeconds, 'Tiempo animado'),
      enabled: boolean(logo.enabled, l.enabled), position: choice(logo.position, l.position, DISPLAY_CORNERS),
      scale: number(logo.scale, l.scale, displayLimits.logo.scale, 'Tamaño del logo'),
      marginX: number(logo.marginX, l.marginX, displayLimits.logo.marginX, 'Margen lateral del logo'),
      marginY: number(logo.marginY, l.marginY, displayLimits.logo.marginY, 'Margen vertical del logo'),
      opacity: number(logo.opacity, l.opacity, displayLimits.logo.opacity, 'Opacidad del logo'),
    },
    announcement: {
      enabled: boolean(announcement.enabled, a.enabled), position: choice(announcement.position, a.position, DISPLAY_ANCHORS),
      width: number(announcement.width, a.width, displayLimits.announcement.width, 'Ancho del comunicado'),
      offsetX: number(announcement.offsetX, a.offsetX, displayLimits.announcement.offsetX, 'Desplazamiento horizontal'),
      marginY: number(announcement.marginY, a.marginY, displayLimits.announcement.marginY, 'Margen vertical del comunicado'),
      padding: number(announcement.padding, a.padding, displayLimits.announcement.padding, 'Espacio interior'),
      textScale: number(announcement.textScale, a.textScale, displayLimits.announcement.textScale, 'Tamaño del texto'),
      alignment: choice(announcement.alignment, a.alignment, ['left', 'center']),
      textColor: announcement.textColor === undefined || announcement.textColor === null ? null : color(announcement.textColor, '#f4f7ff'),
      showIcon: boolean(announcement.showIcon, a.showIcon),
      backgroundColor: color(announcement.backgroundColor, a.backgroundColor),
      backgroundOpacity: number(announcement.backgroundOpacity, a.backgroundOpacity, displayLimits.announcement.backgroundOpacity, 'Opacidad del fondo'),
      borderWidth: number(announcement.borderWidth, a.borderWidth, displayLimits.announcement.borderWidth, 'Grosor del borde'),
      borderColor: color(announcement.borderColor, a.borderColor),
      borderRadius: number(announcement.borderRadius, a.borderRadius, displayLimits.announcement.borderRadius, 'Redondeado'),
      shadow: boolean(announcement.shadow, a.shadow),
      intervalSeconds: number(announcement.intervalSeconds, a.intervalSeconds, displayLimits.announcement.intervalSeconds, 'Intervalo'),
      messages: messages.map((message) => {
        const item = object(message)
        if (typeof item.title !== 'string' || !item.title.trim() || item.title.trim().length > MAX_DISPLAY_TITLE
          || typeof item.text !== 'string' || item.text.trim().length > MAX_DISPLAY_TEXT) throw new Error('Cada comunicado necesita un título de hasta 60 caracteres y un texto de hasta 100.')
        return { title: item.title.trim(), text: item.text.trim() }
      }),
    },
  }
  if (result.logo.source === 'custom' && result.logo.enabled) {
    if (!result.logo.staticImageId && !result.logo.animatedImageId) throw Object.assign(new Error('Suba una imagen PNG o GIF para el logo personalizado.'), { field: 'logo' })
    if (result.logo.mode !== 'static' && !result.logo.animatedImageId) throw Object.assign(new Error('Suba un GIF para usar el modo animado o intermitente.'), { field: 'logo' })
  }
  return result
}

export function resetDisplayAppearance (settings: PlayerDisplaySettings): PlayerDisplaySettings {
  return {
    logo: { ...defaultPlayerDisplay.logo, enabled: settings.logo.enabled,
      source: settings.logo.source, mode: settings.logo.mode, staticImageId: settings.logo.staticImageId,
      animatedImageId: settings.logo.animatedImageId, staticSeconds: settings.logo.staticSeconds, animatedSeconds: settings.logo.animatedSeconds },
    announcement: { ...defaultPlayerDisplay.announcement, enabled: settings.announcement.enabled,
      messages: settings.announcement.messages.map(message => ({ ...message })), intervalSeconds: settings.announcement.intervalSeconds },
  }
}

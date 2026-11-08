import { DISPLAY_REFERENCE, type DisplayCorner, type PlayerDisplaySettings } from '../../../shared/playerDisplay'

export interface DisplayViewport { width: number, height: number }
const bounded = (value: number, min: number, max: number) => Math.min(Math.max(Number.isFinite(value) ? value : min, min), Math.max(min, max))
const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback

export function displayLayout (settings: PlayerDisplaySettings, viewport: DisplayViewport) {
  const w = Math.max(1, viewport.width)
  const h = Math.max(1, viewport.height)
  const scale = Math.min(w / DISPLAY_REFERENCE.width, h / DISPLAY_REFERENCE.height)
  const safe = Math.min(16, w / 10, h / 10)
  const logo = settings.logo
  const logoWidth = bounded(192 * scale * logo.scale / 100, Math.min(64, w - safe * 2), w - safe * 2)
  const logoHeight = bounded(108 * scale * logo.scale / 100, Math.min(44, h - safe * 2), h - safe * 2)
  const x = bounded(w * logo.marginX / 100, safe, w - logoWidth - safe)
  const y = bounded(h * logo.marginY / 100, safe, h - logoHeight - safe)
  const a = settings.announcement
  const width = bounded(w * a.width / 100, Math.min(320, w - safe * 2), w - safe * 2)
  const anchorX = a.position.endsWith('left') ? safe : a.position.endsWith('right') ? w - width - safe : (w - width) / 2
  return {
    scale, safe,
    logo: { left: logo.position.endsWith('right') ? w - logoWidth - x : x, top: logo.position.startsWith('bottom') ? h - logoHeight - y : y, width: logoWidth, height: logoHeight },
    announcement: {
      width, left: bounded(anchorX + w * a.offsetX / 100, safe, w - width - safe),
      inset: bounded(h * a.marginY / 100, safe, h / 3),
      padding: a.padding === 0 ? 0 : Math.max(6, finite(a.padding, 20) * scale),
      titleSize: Math.max(14, 26 * scale * finite(a.textScale, 100) / 100),
      textSize: Math.max(12, 20 * scale * finite(a.textScale, 100) / 100),
      iconSize: Math.max(20, 36 * scale), gap: Math.max(8, 20 * scale),
    },
  }
}

export function turnPlacement (settings: PlayerDisplaySettings, viewport: DisplayViewport, logoVisible: boolean, announcementVisible: boolean) {
  const layout = displayLayout(settings, viewport)
  const band = announcementVisible && settings.announcement.position.startsWith('top') ? 'bottom' : 'top'
  const logoInBand = logoVisible && settings.logo.position.startsWith(band)
  const side = logoInBand && settings.logo.position.endsWith('right') ? 'left' : 'right'
  const available = !logoInBand
    ? viewport.width - 32
    : side === 'left' ? layout.logo.left - 32 : viewport.width - layout.logo.left - layout.logo.width - 32
  return { position: `${band}-${side}` as DisplayCorner, maxWidth: Math.max(64, Math.min(520, available)) }
}

export function displayForeground (background: string) {
  const channels = [1, 3, 5].map(offset => parseInt(background.slice(offset, offset + 2), 16) / 255)
  const luminance = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, channel) => sum + value * [0.2126, 0.7152, 0.0722][channel], 0)
  return luminance > 0.179 ? '#030509' : '#f4f7ff'
}

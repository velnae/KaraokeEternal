import type { ClientBranding } from '../../shared/branding.js'
import { validatePlayerDisplay, type PlayerDisplaySettings } from '../../shared/playerDisplay.js'
import { validateBranding } from './branding.js'

function allowedFields (value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('Revise los datos de personalización.'), { status: 422 })
  if (Object.keys(value).some(key => !keys.includes(key))) throw Object.assign(new Error('Este ajuste requiere un administrador.'), { status: 403 })
  return value as Record<string, unknown>
}

export function personalizeBranding (current: ClientBranding, input: unknown) {
  return validateBranding({ ...current, ...allowedFields(input, ['name', 'logoSrc']) })
}

export function personalizeDisplay (current: PlayerDisplaySettings, input: unknown) {
  const patch = allowedFields(input, ['logo'])
  const logo = allowedFields(patch.logo, ['enabled', 'position', 'scale', 'opacity'])
  return validatePlayerDisplay({ ...current, logo: { ...current.logo, ...logo } })
}

export interface ClientBranding {
  name: string
  logoSrc: string
  supportUrl: string
}

export const defaultClientBranding: ClientBranding = {
  name: '',
  logoSrc: '',
  supportUrl: '',
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

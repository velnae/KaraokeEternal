const restrictions: Record<number, string> = {
  2: 'Este video no es válido. Elige otra versión.',
  100: 'Este video no está disponible. Elige otra versión.',
  101: 'YouTube bloquea esta versión aquí. Elige otra versión.',
  150: 'YouTube bloquea esta versión aquí. Elige otra versión.',
}

export const previewRestrictionMessage = (code: number | null) => code === null ? null : restrictions[code] ?? null

// A customer's preview is evidence for this session, not a room-wide blacklist.
const remembered = new Map<string, number>()
const listeners = new Set<() => void>()
export const subscribePreviewRestrictions = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getPreviewRestriction (key: string): number | null {
  if (!key) return null
  if (remembered.has(key)) return remembered.get(key)!
  try {
    const code = Number(window.sessionStorage.getItem(`karaoke-preview:${key}`))
    if (previewRestrictionMessage(code)) {
      remembered.set(key, code)
      return code
    }
  } catch { /* Keep the preview usable when session storage is unavailable. */ }
  return null
}

export function rememberPreviewRestriction (key: string, code: number) {
  if (!key || !previewRestrictionMessage(code)) return
  remembered.set(key, code)
  try {
    window.sessionStorage.setItem(`karaoke-preview:${key}`, String(code))
  } catch { /* The in-memory result still survives searches. */ }
  listeners.forEach(listener => listener())
}

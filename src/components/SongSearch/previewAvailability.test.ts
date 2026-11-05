import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('customer preview restrictions', () => {
  const values = new Map<string, string>()
  beforeEach(() => {
    vi.resetModules()
    values.clear()
    vi.stubGlobal('window', { sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('retains a restriction across remounts/reloads without blocking other customers or rooms', async () => {
    const store = await import('./previewAvailability')
    const changed = vi.fn()
    const unsubscribe = store.subscribePreviewRestrictions(changed)
    store.rememberPreviewRestriction('1:10:video', 150)
    expect(changed).toHaveBeenCalledOnce()
    expect(store.getPreviewRestriction('1:10:video')).toBe(150)
    expect(store.getPreviewRestriction('1:11:video')).toBeNull()
    expect(store.getPreviewRestriction('2:10:video')).toBeNull()
    unsubscribe()
    vi.resetModules()
    const reloaded = await import('./previewAvailability')
    expect(reloaded.getPreviewRestriction('1:10:video')).toBe(150)
  })

  it('does not persist temporary HTML5 errors or client configuration errors as video restrictions', async () => {
    const store = await import('./previewAvailability')
    for (const code of [5, 153, 0, 999]) {
      store.rememberPreviewRestriction('1:10:video', code)
      expect(store.getPreviewRestriction('1:10:video')).toBeNull()
      expect(store.previewRestrictionMessage(code)).toBeNull()
    }
    expect(values.size).toBe(0)
  })

  it('keeps session feedback available when browser storage is denied', async () => {
    vi.stubGlobal('window', { get sessionStorage () {
      throw new Error('denied')
    } })
    const store = await import('./previewAvailability')
    expect(store.getPreviewRestriction('1:10:video')).toBeNull()
    store.rememberPreviewRestriction('1:10:video', 100)
    expect(store.getPreviewRestriction('1:10:video')).toBe(100)
    expect(store.previewRestrictionMessage(100)).toContain('no está disponible')
  })
})

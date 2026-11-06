import { afterEach, describe, expect, it, vi } from 'vitest'
import { isPlayerFullscreenShortcut, PLAYER_FULLSCREEN_ID, requestPlayerFullscreen } from './playerFullscreen'

const fullscreen = vi.hoisted(() => ({ isEnabled: true, element: undefined as unknown, request: vi.fn((element: unknown) => Promise.resolve(void element)) }))
vi.mock('screenfull', () => ({ default: fullscreen }))
afterEach(() => {
  vi.unstubAllGlobals()
  fullscreen.isEnabled = true
  fullscreen.element = undefined
  fullscreen.request.mockClear()
})

const event = (patch: Partial<KeyboardEvent> = {}) => ({
  key: 'k', ctrlKey: true, altKey: true, shiftKey: false, metaKey: false,
  defaultPrevented: false, repeat: false, isComposing: false,
  getModifierState: () => false, target: null, ...patch,
}) as KeyboardEvent

describe('karaoke fullscreen shortcut', () => {
  it('uses Ctrl+Alt+K and leaves browser/YouTube keys alone', () => {
    expect(isPlayerFullscreenShortcut(event())).toBe(true)
    expect(isPlayerFullscreenShortcut(event({ key: 'K' }))).toBe(true)
    for (const key of ['f', 'F11', 'Escape', 'Enter', ' ']) expect(isPlayerFullscreenShortcut(event({ key }))).toBe(false)
    expect(isPlayerFullscreenShortcut(event({ altKey: false }))).toBe(false)
    expect(isPlayerFullscreenShortcut(event({ ctrlKey: false }))).toBe(false)
    expect(isPlayerFullscreenShortcut(event({ shiftKey: true }))).toBe(false)
    expect(isPlayerFullscreenShortcut(event({ metaKey: true }))).toBe(false)
  })

  it('ignores typing, AltGr, composition, handled events and repeated keys', () => {
    for (const patch of [{ repeat: true }, { isComposing: true }, { defaultPrevented: true }, { getModifierState: () => true }]) {
      expect(isPlayerFullscreenShortcut(event(patch))).toBe(false)
    }
    expect(isPlayerFullscreenShortcut(event({ target: { isContentEditable: true } as unknown as EventTarget }))).toBe(false)
    expect(isPlayerFullscreenShortcut(event({ target: { closest: () => ({}) } as unknown as EventTarget }))).toBe(false)
  })

  it('requests only the karaoke container synchronously with the keyboard gesture', async () => {
    const container = { id: PLAYER_FULLSCREEN_ID }
    const getElementById = vi.fn(() => container)
    vi.stubGlobal('document', { getElementById })
    const result = requestPlayerFullscreen()
    expect(fullscreen.request).toHaveBeenCalledWith(container)
    expect(getElementById).toHaveBeenCalledWith(PLAYER_FULLSCREEN_ID)
    await result
  })

  it('does not substitute an iframe or the whole document, and does not request twice', async () => {
    const container = { id: PLAYER_FULLSCREEN_ID }
    const getElementById = vi.fn(() => null as unknown)
    vi.stubGlobal('document', { getElementById })
    await requestPlayerFullscreen()
    expect(fullscreen.request).not.toHaveBeenCalled()
    getElementById.mockReturnValue(container)
    fullscreen.element = container
    await requestPlayerFullscreen()
    fullscreen.element = undefined
    fullscreen.isEnabled = false
    await requestPlayerFullscreen()
    expect(fullscreen.request).not.toHaveBeenCalled()
  })

  it('returns failures to the caller so the existing error UI can explain them', async () => {
    vi.stubGlobal('document', { getElementById: () => ({ id: PLAYER_FULLSCREEN_ID }) })
    fullscreen.request.mockRejectedValueOnce(new Error('Not allowed'))
    await expect(requestPlayerFullscreen()).rejects.toThrow('Not allowed')
  })
})

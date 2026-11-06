import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLAYER_FULLSCREEN_ID, requestAutomaticPlayerFullscreen } from './playerFullscreen'

const fullscreen = vi.hoisted(() => ({
  isEnabled: true, isFullscreen: false, element: undefined as unknown,
  request: vi.fn((element: unknown) => Promise.resolve(void element)),
  exit: vi.fn(async () => {}),
}))
vi.mock('screenfull', () => ({ default: fullscreen }))
const target = { id: PLAYER_FULLSCREEN_ID }
let permission: ReturnType<typeof vi.fn>

beforeEach(() => {
  fullscreen.isEnabled = true
  fullscreen.isFullscreen = false
  fullscreen.element = undefined
  fullscreen.request.mockReset().mockImplementation(async (element) => {
    fullscreen.element = element
    fullscreen.isFullscreen = true
  })
  fullscreen.exit.mockReset().mockImplementation(async () => {
    fullscreen.element = undefined
    fullscreen.isFullscreen = false
  })
  permission = vi.fn().mockResolvedValue({ state: 'granted' })
  vi.stubGlobal('navigator', { permissions: { query: permission } })
  vi.stubGlobal('window', { location: { origin: 'https://karaoke.puyu.pe' } })
  vi.stubGlobal('document', { getElementById: () => target })
})
afterEach(() => vi.unstubAllGlobals())

describe('automatic fullscreen in the player window', () => {
  it('requires the automatic permission, independently of a previous Play', async () => {
    permission.mockResolvedValue({ state: 'denied' })
    await expect(requestAutomaticPlayerFullscreen(() => true)).resolves.toEqual({ status: 'permission-required', origin: 'https://karaoke.puyu.pe' })
    expect(permission).toHaveBeenCalledWith({ name: 'fullscreen', allowWithoutGesture: true })
    expect(fullscreen.request).not.toHaveBeenCalled()
  })

  it('confirms the karaoke element after permission is granted', async () => {
    await expect(requestAutomaticPlayerFullscreen(() => true)).resolves.toMatchObject({ status: 'entered' })
    expect(fullscreen.request).toHaveBeenCalledWith(target)
  })

  it('does not trust a resolved native request without the expected element', async () => {
    fullscreen.request.mockImplementation(async () => {})
    await expect(requestAutomaticPlayerFullscreen(() => true)).resolves.toMatchObject({ status: 'rejected' })
  })

  it('returns browser failures and unsupported permission queries', async () => {
    permission.mockRejectedValueOnce(new TypeError('Unknown permission'))
    await expect(requestAutomaticPlayerFullscreen(() => true)).resolves.toMatchObject({ status: 'unsupported' })
    fullscreen.request.mockRejectedValueOnce(new Error('Permissions check failed'))
    await expect(requestAutomaticPlayerFullscreen(() => true)).resolves.toMatchObject({ status: 'rejected' })
  })

  it('is idempotent when the karaoke container is already fullscreen', async () => {
    fullscreen.element = target
    fullscreen.isFullscreen = true
    await expect(requestAutomaticPlayerFullscreen(() => true)).resolves.toMatchObject({ status: 'entered' })
    expect(permission).not.toHaveBeenCalled()
    expect(fullscreen.request).not.toHaveBeenCalled()
  })

  it('exits a different fullscreen element before requesting the karaoke container', async () => {
    fullscreen.element = { tagName: 'IFRAME' }
    fullscreen.isFullscreen = true
    await expect(requestAutomaticPlayerFullscreen(() => true)).resolves.toMatchObject({ status: 'entered' })
    expect(fullscreen.exit).toHaveBeenCalledOnce()
    expect(fullscreen.request).toHaveBeenCalledWith(target)
  })

  it('does not act after ownership changes while waiting for permission', async () => {
    let valid = true
    permission.mockImplementation(async () => {
      valid = false
      return { state: 'granted' }
    })
    await expect(requestAutomaticPlayerFullscreen(() => valid)).resolves.toMatchObject({ status: 'changed' })
    expect(fullscreen.request).not.toHaveBeenCalled()
  })

  it('rejects expired commands, unavailable fullscreen and missing containers', async () => {
    await expect(requestAutomaticPlayerFullscreen(() => false)).resolves.toMatchObject({ status: 'changed' })
    fullscreen.isEnabled = false
    await expect(requestAutomaticPlayerFullscreen(() => true)).resolves.toMatchObject({ status: 'unsupported' })
    fullscreen.isEnabled = true
    vi.stubGlobal('document', { getElementById: (): HTMLElement | null => null })
    await expect(requestAutomaticPlayerFullscreen(() => true)).resolves.toMatchObject({ status: 'changed' })
    expect(fullscreen.request).not.toHaveBeenCalled()
  })
})

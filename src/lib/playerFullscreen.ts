import screenfull from 'screenfull'
import type { PlayerWindowResult } from '../../shared/playerWindow'

export const PLAYER_FULLSCREEN_ID = 'player-fs-container'
export const PLAYER_FULLSCREEN_SHORTCUT = 'Ctrl+Alt+K'

export function isPlayerFullscreenShortcut (event: KeyboardEvent) {
  if (event.defaultPrevented || event.repeat || event.isComposing || event.getModifierState('AltGraph')) return false
  if (!event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey || event.key.toLowerCase() !== 'k') return false
  const target = event.target as HTMLElement | null
  return !target?.isContentEditable && !target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')
}

export async function requestPlayerFullscreen () {
  const element = document.getElementById(PLAYER_FULLSCREEN_ID)
  if (!screenfull.isEnabled || !element || screenfull.element === element) return
  // Invoke inside the click/keydown, before awaiting any other work. Never fall
  // back to the document or an iframe when the karaoke container is absent.
  await screenfull.request(element)
}

export async function requestAutomaticPlayerFullscreen (isCurrent: () => boolean): Promise<PlayerWindowResult> {
  const origin = window.location.origin
  const result = (status: PlayerWindowResult['status']): PlayerWindowResult => ({ status, origin })
  if (!isCurrent()) return result('changed')
  const element = document.getElementById(PLAYER_FULLSCREEN_ID)
  if (!element) return result('changed')
  if (!screenfull.isEnabled) return result('unsupported')
  if (screenfull.element === element) return result('entered')
  try {
    // Chrome's automatic-fullscreen descriptor is not yet in lib.dom's union.
    const permission = await navigator.permissions.query({ name: 'fullscreen', allowWithoutGesture: true } as unknown as PermissionDescriptor)
    if (!isCurrent()) return result('changed')
    if (permission.state !== 'granted') return result('permission-required')
  } catch { return result('unsupported') }
  try {
    if (screenfull.isFullscreen && screenfull.element !== element) await screenfull.exit()
    if (!isCurrent()) return result('changed')
    await requestPlayerFullscreen()
    if (!isCurrent()) return result('changed')
    return result(screenfull.element === element ? 'entered' : 'rejected')
  } catch { return result('rejected') }
}

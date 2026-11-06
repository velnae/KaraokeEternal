import screenfull from 'screenfull'

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

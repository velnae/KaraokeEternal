import { normalizeQueuePrefs } from '../../shared/queueRules.js'
import type { IRoomPrefs } from '../../shared/types.js'

// Whitelist only the room rules participants need, never operator/QR preferences.
export const participantPrefs = (prefs: Partial<IRoomPrefs> = {}) => ({
  roles: prefs.roles,
  queue: normalizeQueuePrefs(prefs.queue),
})

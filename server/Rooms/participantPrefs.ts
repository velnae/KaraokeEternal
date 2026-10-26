import { normalizeQueuePrefs } from '../../shared/queueRules.js'
import type { IRoomPrefs } from '../../shared/types.js'
import { tableMode } from '../../shared/tableAccess.js'

// Whitelist only the room rules participants need, never operator/QR preferences.
export const participantPrefs = (prefs: Partial<IRoomPrefs> = {}) => ({
  roles: prefs.roles,
  tables: { mode: tableMode(prefs) },
  queue: normalizeQueuePrefs(prefs.queue),
})

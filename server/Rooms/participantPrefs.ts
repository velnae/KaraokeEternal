import { normalizeQueuePrefs } from '../../shared/queueRules.js'
import type { IRoomPrefs } from '../../shared/types.js'
import { tableMode } from '../../shared/tableAccess.js'
import { canOperate, type AccessIdentity } from '../../shared/permissions.js'

// Whitelist only the room rules participants need, never operator/QR preferences.
export const participantPrefs = (prefs: Partial<IRoomPrefs> = {}) => ({
  roles: prefs.roles,
  tables: { mode: tableMode(prefs) },
  queue: normalizeQueuePrefs(prefs.queue),
})

export const visibleRoomPrefs = (identity: AccessIdentity, prefs: Partial<IRoomPrefs> = {}) => identity.isAdmin
  ? prefs
  : {
      ...participantPrefs(prefs),
      ...(canOperate(identity) ? { qr: prefs.qr, animation: prefs.animation, transitionVideo: prefs.transitionVideo } : {}),
    }

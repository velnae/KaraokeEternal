import { canOperate, type AccessIdentity } from '../../shared/permissions.js'
import Prefs from './Prefs.js'
import type { Prefs as PrefsType } from '../../shared/types.js'

export function visiblePrefs (identity: AccessIdentity) {
  const prefs = Prefs.get() as unknown as PrefsType
  if (identity.isAdmin || prefs.isFirstRun) return prefs
  const { roles, branding, playerDisplay, moderation, musicBlocking } = prefs
  return { roles, branding, playerDisplay, moderation, musicBlocking,
    ...(canOperate(identity) ? { isReplayGainEnabled: prefs.isReplayGainEnabled } : {}) }
}

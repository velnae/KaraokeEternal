import getLogger from '../lib/Log.js'
import Library from '../Library/Library.js'
import Prefs from './Prefs.js'
import { LIBRARY_PUSH, PREFS_PATH_SET_PRIORITY, PREFS_PUSH, PREFS_SET, _ERROR } from '../../shared/actionTypes.js'
const log = getLogger(`server[${process.pid}]`)

const ACTION_HANDLERS = {
  [PREFS_SET]: (sock, { payload }, acknowledge) => {
    if (!sock.user.isAdmin) {
      return acknowledge({
        type: PREFS_SET + _ERROR,
        error: 'No tiene autorización',
      })
    }

    // Branding has a validated HTTP update route with public change broadcasts.
    if (payload.key === 'branding') {
      return acknowledge({
        type: PREFS_SET + _ERROR,
        error: 'Use los ajustes de marca del cliente para guardar los cambios.',
      })
    }
    Prefs.set(payload.key, payload.data)
    log.info('%s (%s) set pref %s = %s', sock.user.name, sock.id, payload.key, payload.data)

    acknowledge({ type: PREFS_SET + '_SUCCESS' })
    pushPrefs(sock)
  },
  [PREFS_PATH_SET_PRIORITY]: (sock, { payload }, acknowledge) => {
    if (!sock.user.isAdmin) {
      return acknowledge({
        type: PREFS_PATH_SET_PRIORITY + _ERROR,
        error: 'No tiene autorización',
      })
    }

    Prefs.setPathPriority(payload)
    log.info('%s re-prioritized media folders; pushing library to all', sock.user.name)

    acknowledge({ type: PREFS_PATH_SET_PRIORITY + '_SUCCESS' })
    pushPrefs(sock)

    // invalidate cache
    Library.cache.version = null

    sock.server.emit('action', {
      type: LIBRARY_PUSH,
      payload: Library.get(),
    })
  },
}

// helper to push prefs to admins
const pushPrefs = (sock) => {
  const prefs = Prefs.get()

  for (const s of sock.server.sockets.sockets.values()) {
    if (s.user && s.user.isAdmin) {
      sock.server.to(s.id).emit('action', {
        type: PREFS_PUSH,
        payload: prefs,
      })
    }
  }
}

export default ACTION_HANDLERS

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

    // These settings have validated HTTP update routes and dedicated lifecycle handling.
    if (payload.key === 'nameVoiceStyle') {
      return acknowledge({ type: PREFS_SET + _ERROR, error: 'Use Animador → Nombres para guardar el estilo de pronunciación.' })
    }
    if (payload.key === 'playerDisplay') {
      return acknowledge({ type: PREFS_SET + _ERROR, error: 'Use Ajustes → Pantalla para guardar los cambios.' })
    }
    if (payload.key === 'musicBlocking') {
      return acknowledge({ type: PREFS_SET + _ERROR, error: 'Use Ajustes → Música bloqueada para guardar las reglas.' })
    }
    if (payload.key === 'moderation') {
      return acknowledge({ type: PREFS_SET + _ERROR, error: 'Use Ajustes → Moderación para guardar el diccionario.' })
    }
    if (payload.key === 'branding' || payload.key === 'greetingVoice' || payload.key === 'callVoice') {
      return acknowledge({
        type: PREFS_SET + _ERROR,
        error: payload.key === 'branding' ? 'Use los ajustes de marca del cliente para guardar los cambios.' : 'Use los ajustes de proveedores de audio para guardar los cambios.',
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

import path from 'path'
import { canPersonalize } from '../../shared/permissions.js'
import { visiblePrefs } from './visiblePrefs.js'
import { personalizeBranding, personalizeDisplay } from './personalization.js'
import getLogger from '../lib/Log.js'
import KoaRouter from '@koa/router'
import getFolders from '../lib/getFolders.js'
import getWindowsDrives from '../lib/getWindowsDrives.js'
import Prefs from './Prefs.js'
import Media from '../Media/Media.js'
import pushQueuesAndLibrary from '../lib/pushQueuesAndLibrary.js'
import Rooms from '../Rooms/Rooms.js'
import Queue from '../Queue/Queue.js'
import { PREFS_PATHS_CHANGED, PREFS_PUSH, QUEUE_PUSH } from '../../shared/actionTypes.js'
import { validateBranding } from './branding.js'
import { validatePlayerDisplay, type PlayerDisplaySettings } from '../../shared/playerDisplay.js'
import type { ClientBranding } from '../../shared/branding.js'
import type { Prefs as PrefsType } from '../../shared/types.js'
import { validateModeration } from '../../shared/textModeration.js'
import Greetings from '../Greetings/Greetings.js'
import { validateMusicBlocking } from '../../shared/musicBlocking.js'
import { db } from '../lib/Database.js'

interface RequestWithBody {
  body: Record<string, unknown>
}

const log = getLogger('Prefs')
const router = new KoaRouter({ prefix: '/api/prefs' })

// get all prefs (including media paths)
router.get('/', (ctx) => {
  ctx.set('Cache-Control', 'no-store')
  ctx.body = visiblePrefs(ctx.user)
})

router.put('/branding', (ctx) => {
  if (!canPersonalize(ctx.user)) ctx.throw(403, 'No tiene autorización')

  let branding: ClientBranding
  try {
    const body = (ctx.request as unknown as RequestWithBody).body
    branding = ctx.user.isAdmin ? validateBranding(body) : personalizeBranding(Prefs.get().branding, body)
  } catch (error) {
    ctx.throw((error as { status?: number }).status ?? 422, (error as Error).message)
  }
  if (!Prefs.set('branding', branding)) ctx.throw(500, 'No se pudo guardar la marca del cliente.')

  ctx.set('Cache-Control', 'no-store')
  ctx.body = { branding }
  ctx.io.emit('action', { type: PREFS_PUSH, payload: { branding } })
})

router.put('/player-display', (ctx) => {
  if (!canPersonalize(ctx.user)) ctx.throw(403, 'No tiene autorización')
  let playerDisplay: PlayerDisplaySettings
  try {
    const body = (ctx.request as unknown as RequestWithBody).body
    if (!body || typeof body !== 'object' || Array.isArray(body)) ctx.throw(422, 'Revise la configuración de pantalla.')
    playerDisplay = ctx.user.isAdmin ? validatePlayerDisplay(body) : personalizeDisplay(Prefs.get().playerDisplay, body)
  } catch (error) {
    ctx.throw((error as { status?: number }).status ?? 422, (error as Error).message)
  }
  try {
    if (!Prefs.set('playerDisplay', playerDisplay)) ctx.throw(500, 'No se pudo guardar la configuración de pantalla.')
  } catch (error) {
    ctx.throw((error as { status?: number }).status ?? 500, (error as Error).message)
  }
  ctx.set('Cache-Control', 'no-store')
  ctx.body = { playerDisplay }
  ctx.io.emit('action', { type: PREFS_PUSH, payload: { playerDisplay } })
})

router.put('/music-blocking', (ctx) => {
  if (!ctx.user.isAdmin) return ctx.throw(403, 'No tiene autorización')
  let musicBlocking
  try {
    musicBlocking = validateMusicBlocking((ctx.request as unknown as RequestWithBody).body)
  } catch (error) { return ctx.throw(422, (error as Error).message) }
  const rooms = db.all<{ roomId: number }>('SELECT roomId FROM rooms')
  db.exec('BEGIN IMMEDIATE')
  try {
    if (!Prefs.set('musicBlocking', musicBlocking)) throw new Error('No se pudo guardar el bloqueo.')
    for (const { roomId } of rooms) {
      const player = Rooms.getPlayerStatus(ctx.io, roomId)
      Queue.rejectBlocked(roomId, musicBlocking, player?.isAtQueueEnd ? undefined : player?.queueId)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  ctx.set('Cache-Control', 'no-store')
  ctx.body = { musicBlocking }
  ctx.io.emit('action', { type: PREFS_PUSH, payload: { musicBlocking } })
  for (const { roomId } of rooms) {
    Greetings.reconcile(roomId)
    ctx.io.to(Rooms.prefix(roomId)).emit('action', { type: QUEUE_PUSH, payload: Queue.get(roomId) })
  }
})

router.put('/moderation', (ctx) => {
  if (!ctx.user.isAdmin) return ctx.throw(403, 'No tiene autorización')
  let moderation
  try {
    moderation = validateModeration((ctx.request as unknown as RequestWithBody).body)
  } catch (error) {
    return ctx.throw(422, (error as Error).message)
  }
  if (!Prefs.set('moderation', moderation)) return ctx.throw(500, 'No se pudo guardar el diccionario.')
  ctx.set('Cache-Control', 'no-store')
  ctx.body = { moderation }
  ctx.io.emit('action', { type: PREFS_PUSH, payload: { moderation } })
  for (const { room, roomId } of Rooms.getActive(ctx.io)) {
    Greetings.reconcile(roomId)
    ctx.io.to(room).emit('action', { type: QUEUE_PUSH, payload: Queue.get(roomId) })
  }
})

// add a media path
router.post('/path', (ctx) => {
  const dir = decodeURIComponent(ctx.query.dir as string)

  if (!ctx.user.isAdmin) {
    ctx.throw(401)
  }

  // required
  if (!dir) {
    ctx.throw(422, 'La ruta de la carpeta no es válida')
  }

  const pathId = Prefs.addPath(dir, {
    prefs: (ctx.request as unknown as RequestWithBody).body,
  })

  // respond with updated prefs
  const prefs = Prefs.get() as unknown as PrefsType
  ctx.body = prefs

  // (re)start watcher
  process.emit(PREFS_PATHS_CHANGED, prefs.paths)

  ctx.startScanner(pathId)
})

// set media path preferences
router.put('/path/:pathId', (ctx) => {
  if (!ctx.user.isAdmin) {
    ctx.throw(401)
  }

  const pathId = parseInt(ctx.params.pathId, 10)

  if (isNaN(pathId)) {
    ctx.throw(422, 'El identificador de la carpeta no es válido')
  }

  Prefs.setPathData(pathId, 'prefs.', (ctx.request as unknown as RequestWithBody).body)

  // respond with updated prefs
  const prefs = Prefs.get() as unknown as PrefsType
  ctx.body = prefs

  // (re)start watcher?
  if ('isWatchingEnabled' in (ctx.request as unknown as RequestWithBody).body) {
    process.emit(PREFS_PATHS_CHANGED, prefs.paths)
  }

  // need to push updated queue items?
  if ('isVideoKeyingEnabled' in (ctx.request as unknown as RequestWithBody).body) {
    for (const { room, roomId } of Rooms.getActive(ctx.io)) {
      ctx.io.to(room).emit('action', {
        type: QUEUE_PUSH,
        payload: Queue.get(roomId),
      })
    }
  }
})

// remove a media path
router.delete('/path/:pathId', (ctx) => {
  if (!ctx.user.isAdmin) {
    ctx.throw(401)
  }

  const pathId = parseInt(ctx.params.pathId, 10)

  if (isNaN(pathId)) {
    ctx.throw(422, 'El identificador de la carpeta no es válido')
  }

  ctx.stopScanner()

  Prefs.removePath(pathId)

  // respond with updated prefs
  const prefs = Prefs.get() as unknown as PrefsType
  ctx.body = prefs

  // (re)start watcher
  process.emit(PREFS_PATHS_CHANGED, prefs.paths)

  Media.cleanup()

  pushQueuesAndLibrary(ctx.io)
})

// scan a media path
router.get('/path/:pathId/scan', async (ctx) => {
  if (!ctx.user.isAdmin) {
    ctx.throw(401)
  }

  const pathId = parseInt(ctx.params.pathId, 10)

  if (isNaN(pathId)) {
    ctx.throw(422, 'El identificador de la carpeta no es válido')
  }

  ctx.status = 200
  ctx.startScanner(pathId)
})

// scan all media paths
router.get('/paths/scan', async (ctx) => {
  if (!ctx.user.isAdmin) {
    ctx.throw(401)
  }

  ctx.status = 200
  ctx.startScanner(true)
})

// stop scanning
router.get('/paths/scan/stop', async (ctx) => {
  if (!ctx.user.isAdmin) {
    ctx.throw(401)
  }

  ctx.status = 200
  ctx.stopScanner()
})

// get folder listing for path browser
router.get('/path/ls', async (ctx) => {
  if (!ctx.user.isAdmin) {
    ctx.throw(401)
  }

  const dir = decodeURIComponent(ctx.query.dir as string)

  // windows is a special snowflake and gets an
  // extra top level of available drive letters
  if (dir === '' && process.platform === 'win32') {
    const drives = getWindowsDrives()

    ctx.body = {
      current: '',
      parent: false,
      children: drives,
    }
  } else {
    const current = path.resolve(dir)
    const parent = path.resolve(dir, '../')

    const list = await getFolders(dir)
    log.verbose('%s listed path: %s', ctx.user.name, current)

    ctx.body = {
      current,
      // if at root, windows gets a special top level
      parent: parent === current ? (process.platform === 'win32' ? '' : false) : parent,
      children: list.map(p => ({
        path: p,
        label: p.replace(current + path.sep, ''),
      })).filter(c => !(c.label.startsWith('.') || c.label.startsWith('/.'))),
    }
  }
})

export default router

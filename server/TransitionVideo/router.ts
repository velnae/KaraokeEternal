import Router from '@koa/router'
import { koaBody } from 'koa-body'
import type { Middleware } from 'koa'
import Rooms, { STATUSES } from '../Rooms/Rooms.js'
import { ValidationError } from '../lib/Errors.js'
import { ROOM_PREFS_PUSH } from '../../shared/actionTypes.js'
import { getTransitionVideo, getTransitionVideoSettings, saveTransitionVideoSettings, transitionVideoDTO } from './Store.js'
import { getTransitionVideoService, type TransitionVideoService } from './Service.js'
import { streamTransitionVideo } from './stream.js'
import { uploadTransitionVideo } from './upload.js'

export const TRANSITION_VIDEO_API_PATH = '/api/animation/background'
export const isTransitionVideoPath = (pathname: string, urlPath: string) => {
  // Match the router's case-insensitive paths so aliases cannot reach the global
  // multipart parser before this router authenticates the request.
  const prefix = (urlPath.replace(/\/$/, '') + TRANSITION_VIDEO_API_PATH).toLowerCase()
  const candidate = pathname.toLowerCase()
  return candidate === prefix || candidate.startsWith(`${prefix}/`)
}

export function createTransitionVideoRouter (getService: () => TransitionVideoService = getTransitionVideoService) {
  const router = new Router({ prefix: TRANSITION_VIDEO_API_PATH })
  // Bind authorization to each route layer: prefix-only router.use matching can
  // differ from the router's case-insensitive endpoint matching.
  const authorize: Middleware = async (ctx, next) => {
    ctx.set('Cache-Control', 'private, no-store')
    if (!ctx.user?.isAdmin || !Number.isSafeInteger(ctx.user.roomId) || ctx.user.roomId <= 0) ctx.throw(403)
    if (!Rooms.get(ctx.user.roomId, { status: STATUSES }).entities[ctx.user.roomId]) ctx.throw(403)
    try {
      await next()
    } catch (error) {
      if (error instanceof ValidationError) ctx.throw(422, error.message)
      throw error
    }
  }
  router.get('/', authorize, (ctx) => {
    ctx.body = getService().overview(ctx.user.roomId)
  })
  router.post('/upload', authorize, async (ctx) => {
    await uploadTransitionVideo(ctx, getService())
  })
  router.get('/videos/:id', authorize, (ctx) => {
    const row = getTransitionVideo(ctx.user.roomId, ctx.params.id)
    if (!row) ctx.throw(404, 'No se encontró el video.')
    ctx.body = transitionVideoDTO(row)
  })
  router.get('/videos/:id/video', authorize, async (ctx) => {
    await streamTransitionVideo(ctx, getService(), false)
  })
  router.get('/videos/:id/poster', authorize, async (ctx) => {
    await streamTransitionVideo(ctx, getService(), true)
  })
  router.put('/', authorize, koaBody({ multipart: false, jsonLimit: '16kb', urlencoded: false, text: false }), async (ctx) => {
    const settings = saveTransitionVideoSettings(ctx.user.roomId, ctx.request.body)
    // Only administrators consume this field. Existing participant filtering is
    // retained by not broadcasting private settings to participant sockets.
    const sockets = await ctx.io?.in(Rooms.prefix(ctx.user.roomId)).fetchSockets() ?? []
    const prefs = Rooms.get(ctx.user.roomId, { status: STATUSES }).entities[ctx.user.roomId]?.prefs
    for (const socket of sockets) {
      if (socket.user?.isAdmin) ctx.io.to(socket.id).emit('action', { type: ROOM_PREFS_PUSH, payload: { roomId: ctx.user.roomId, prefs } })
    }
    void getService().cleanup()
    ctx.body = { ...getService().overview(ctx.user.roomId), settings: getTransitionVideoSettings(ctx.user.roomId), savedRevision: settings.revision }
  })
  return router
}

export default createTransitionVideoRouter()

import Router from '@koa/router'
import { canOperate } from '../../../shared/permissions.js'
import { ROOM_PREFS_PUSH } from '../../../shared/actionTypes.js'
import Rooms from '../../Rooms/Rooms.js'
import { visibleRoomPrefs } from '../../Rooms/participantPrefs.js'
import { getEventScenes, saveEventScenes } from './Store.js'
import { catalogClips } from '../catalog.js'
import { listTransitionVideos, transitionVideoDTO, getTransitionVideoSettings } from '../../TransitionVideo/Store.js'
import { sceneExample, sceneExamples } from './examples.js'
import { db } from '../../lib/Database.js'
import type { AnimationClip } from '../../../shared/animation.js'
import { animationPrefs, eligibleAmbience } from '../../../shared/animation.js'
import { leastUsedAudio } from '../usage.js'
import type { SceneResources } from '../../../shared/eventScenes.js'

const router = new Router({ prefix: '/api/animation/scenes' })
router.use(async (ctx, next) => {
  ctx.set('Cache-Control', 'private, no-store')
  if (!canOperate(ctx.user) || !Number.isSafeInteger(ctx.user.roomId)) ctx.throw(403)
  if (!ctx.user.isAdmin && !['GET', 'HEAD'].includes(ctx.method)) ctx.throw(403)
  await next()
})
router.get('/', (ctx) => {
  const audio = catalogClips(ctx.user.roomId)
  const videos = listTransitionVideos(ctx.user.roomId).filter(video => video.state === 'ready' && video.active)
  const background = getTransitionVideoSettings(ctx.user.roomId)
  const nextVideo = background.mode === 'all' ? [...videos].sort((a, b) => a.selectionOrder - b.selectionOrder || a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0] : videos.find(video => video.id === background.videoId)
  const prefs = animationPrefs(Rooms.get(ctx.user.roomId).entities[ctx.user.roomId]?.prefs?.animation)
  const ambience = prefs.ambienceEnabled ? leastUsedAudio(ctx.user.roomId, eligibleAmbience(audio, prefs)) : null
  const defaultResources: SceneResources = {}
  if (nextVideo) {
    const video = transitionVideoDTO(nextVideo)
    defaultResources.background = { id: video.id, durationMs: video.durationMs!, url: video.videoUrl!, posterUrl: video.posterUrl ?? undefined, dimOpacity: background.dimOpacity }
  }
  if (ambience) defaultResources.ambience = { id: ambience.id, durationMs: ambience.durationMs, url: `api/animation/assets/${encodeURIComponent(ambience.id)}`, checksum: ambience.checksum }
  const birthdayAudio = db.all<{ id: string, title: string, durationMs: number, checksum: string }>('SELECT id,title,durationMs,checksum FROM birthdayAssets WHERE roomId=? AND kind IN (\'intro\',\'music\') ORDER BY rowid DESC LIMIT 100', [ctx.user.roomId])
    .map((asset): AnimationClip => ({ ...asset, kind: 'voice', displayText: '', source: 'birthday', license: 'Room birthday resource' }))
  ctx.body = { settings: getEventScenes(ctx.user.roomId), audio: [...audio, ...birthdayAudio], videos: videos.map(transitionVideoDTO), defaultResources }
})
router.get('/examples', (ctx) => {
  ctx.body = sceneExamples(ctx.user.roomId)
})
router.get('/examples/:id', async (ctx) => {
  try {
    ctx.body = await sceneExample(ctx.user.roomId, ctx.params.id)
  } catch (error) { ctx.throw(422, (error as Error).message) }
})
router.put('/', async (ctx) => {
  try {
    const settings = saveEventScenes(ctx.user.roomId, ctx.request.body)
    const prefs = Rooms.get(ctx.user.roomId).entities[ctx.user.roomId]?.prefs
    const sockets = await ctx.io?.in(Rooms.prefix(ctx.user.roomId)).fetchSockets() ?? []
    for (const socket of sockets) {
      if (canOperate(socket.user)) ctx.io.to(socket.id).emit('action', { type: ROOM_PREFS_PUSH, payload: { roomId: ctx.user.roomId, prefs: visibleRoomPrefs(socket.user, prefs) } })
    }
    ctx.body = settings
  } catch (error) { ctx.throw((error as { status?: number }).status ?? 422, (error as Error).message) }
})
export default router

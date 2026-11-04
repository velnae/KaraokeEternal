import Router from '@koa/router'
import Playlists, { publishHouseQueue } from './Playlists.js'
import youtubeImport from './YouTubeImport.js'

const router = new Router({ prefix: '/api' })
const body = (ctx): Record<string, unknown> => ctx.request.body || {}
router.use('/rooms/:roomId/playlists', async (ctx, next) => {
  if (!ctx.user?.isAdmin) ctx.throw(403)
  ctx.set('Cache-Control', 'no-store')
  try {
    Playlists.room(Number(ctx.params.roomId))
    await next()
  } catch (error) {
    ctx.throw((error as { status?: number }).status ?? 422, (error as Error).message)
  }
})
router.get('/rooms/:roomId/playlists', (ctx) => {
  ctx.body = Playlists.snapshot(Number(ctx.params.roomId))
})
router.post('/rooms/:roomId/playlists', (ctx) => {
  const roomId = Number(ctx.params.roomId)
  const playlistId = Playlists.create(roomId, body(ctx).name)
  ctx.body = { ...Playlists.snapshot(roomId), createdPlaylistId: playlistId }
})
router.post('/rooms/:roomId/playlists/import/youtube/preview', async (ctx) => {
  ctx.body = await youtubeImport.preview(Number(ctx.params.roomId), ctx.user.userId, body(ctx).url)
})
router.post('/rooms/:roomId/playlists/import/youtube', (ctx) => {
  const roomId = Number(ctx.params.roomId)
  const playlistId = youtubeImport.confirm(roomId, ctx.user.userId, body(ctx).previewId, body(ctx).name)
  ctx.body = { ...Playlists.snapshot(roomId), createdPlaylistId: playlistId }
})
router.put('/rooms/:roomId/playlists/playback', (ctx) => {
  const roomId = Number(ctx.params.roomId)
  Playlists.configure(roomId, ctx.user.userId, body(ctx))
  publishHouseQueue(ctx.io, roomId)
  ctx.body = Playlists.snapshot(roomId)
})
router.put('/rooms/:roomId/playlists/:playlistId', (ctx) => {
  const roomId = Number(ctx.params.roomId)
  Playlists.rename(roomId, Number(ctx.params.playlistId), body(ctx).name)
  ctx.body = Playlists.snapshot(roomId)
})
router.delete('/rooms/:roomId/playlists/:playlistId', (ctx) => {
  const roomId = Number(ctx.params.roomId)
  Playlists.remove(roomId, Number(ctx.params.playlistId))
  publishHouseQueue(ctx.io, roomId)
  ctx.body = Playlists.snapshot(roomId)
})
router.post('/rooms/:roomId/playlists/:playlistId/items', async (ctx) => {
  const roomId = Number(ctx.params.roomId)
  await Playlists.add(roomId, Number(ctx.params.playlistId), body(ctx).source, body(ctx).sourceId)
  publishHouseQueue(ctx.io, roomId)
  ctx.body = Playlists.snapshot(roomId)
})
router.put('/rooms/:roomId/playlists/:playlistId/order', (ctx) => {
  const roomId = Number(ctx.params.roomId)
  Playlists.reorder(roomId, Number(ctx.params.playlistId), body(ctx).order)
  ctx.body = Playlists.snapshot(roomId)
})
router.delete('/rooms/:roomId/playlists/:playlistId/items/:itemId', (ctx) => {
  const roomId = Number(ctx.params.roomId)
  Playlists.removeItem(roomId, Number(ctx.params.playlistId), Number(ctx.params.itemId))
  publishHouseQueue(ctx.io, roomId)
  ctx.body = Playlists.snapshot(roomId)
})
export default router

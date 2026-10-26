import Router from '@koa/router'
import Animation from './Animation.js'
import { catalogAsset, catalogClips } from './catalog.js'

const router = new Router({ prefix: '/api/animation' })
router.use(async (ctx, next) => {
  if (!ctx.user?.isAdmin || !Number.isInteger(ctx.user.roomId)) ctx.throw(403)
  Animation.room(ctx.user.roomId)
  ctx.set('Cache-Control', 'private, no-store')
  await next()
})
router.get('/catalog', (ctx) => {
  ctx.body = catalogClips()
})
router.get('/history', (ctx) => {
  ctx.body = Animation.history(ctx.user.roomId)
})
router.get('/assets/:clipId', (ctx) => {
  const asset = catalogAsset(ctx.params.clipId)
  if (!asset) ctx.throw(404)
  ctx.type = asset.mime
  ctx.body = asset.bytes
})
export default router

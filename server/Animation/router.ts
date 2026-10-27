import Router from '@koa/router'
import Animation from './Animation.js'
import { catalogAsset, catalogClips, setCatalogActive } from './catalog.js'
import { getProduction } from './Production.js'
import type { ProductionInput } from '../../shared/catalogProduction.js'

const router = new Router({ prefix: '/api/animation' })
router.use(async (ctx, next) => {
  if (!ctx.user?.isAdmin || !Number.isInteger(ctx.user.roomId)) ctx.throw(403)
  Animation.room(ctx.user.roomId)
  ctx.set('Cache-Control', 'private, no-store')
  await next()
})
router.get('/catalog', (ctx) => {
  ctx.body = catalogClips(ctx.user.roomId)
})
router.get('/history', (ctx) => {
  ctx.body = Animation.history(ctx.user.roomId)
})
router.get('/assets/:clipId', (ctx) => {
  const asset = catalogAsset(ctx.params.clipId)
  if (!asset || (asset.clip.roomId !== undefined && asset.clip.roomId !== ctx.user.roomId)) ctx.throw(404)
  ctx.type = asset.mime
  ctx.body = asset.bytes
})
router.get('/production', (ctx) => {
  const include = typeof ctx.query.include === 'string' ? ctx.query.include.split(',').filter(Boolean) : []
  if (include.length > 9 || include.some(id => !/^[a-zA-Z0-9-]{1,64}$/.test(id))) ctx.throw(422, 'Identificadores de generación no válidos.')
  ctx.body = { settings: getProduction().status(), jobs: getProduction().list(ctx.user.roomId, include) }
})
router.post('/production/check', async (ctx) => {
  try {
    ctx.body = { voices: await getProduction().check() }
  } catch (error) { ctx.throw(422, (error as Error).message) }
})
router.post('/production/jobs', (ctx) => {
  const body = (ctx.request as unknown as { body: { inputs?: ProductionInput[] } }).body
  try {
    ctx.body = getProduction().enqueue(ctx.user.roomId, ctx.user.userId, body?.inputs ?? [])
  } catch (error) { ctx.throw(422, (error as Error).message) }
})
router.get('/production/:jobId/audio', async (ctx) => {
  try {
    ctx.body = await getProduction().audio(ctx.user.roomId, ctx.params.jobId)
    ctx.type = 'audio/mpeg'
  } catch (error) { ctx.throw(404, (error as Error).message) }
})
router.post('/production/:jobId/cancel', (ctx) => {
  try {
    getProduction().cancel(ctx.user.roomId, ctx.params.jobId)
    ctx.body = getProduction().list(ctx.user.roomId)
  } catch (error) { ctx.throw(422, (error as Error).message) }
})
router.post('/production/:jobId/review', async (ctx) => {
  const body = (ctx.request as unknown as { body: { approve?: boolean, monitoringConfirmed?: boolean } }).body
  if (typeof body?.approve !== 'boolean' || (body.approve && body.monitoringConfirmed !== true)) ctx.throw(422, 'Confirme la revisión en una salida de monitoreo.')
  try {
    await getProduction().review(ctx.user.roomId, ctx.user.userId, ctx.params.jobId, body.approve)
    ctx.body = getProduction().list(ctx.user.roomId)
  } catch (error) { ctx.throw(422, (error as Error).message) }
})
router.patch('/catalog/:clipId', async (ctx) => {
  const body = (ctx.request as unknown as { body: { active?: boolean } }).body
  if (typeof body?.active !== 'boolean') ctx.throw(422, 'Estado no válido')
  try {
    await setCatalogActive(ctx.params.clipId, ctx.user.roomId, body.active)
    const active = Animation.active(ctx.user.roomId)
    if (!body.active && active?.clipId === ctx.params.clipId) Animation.cancel(ctx.user.roomId, 'Recurso desactivado', active.interventionId)
    Animation.publish(ctx.user.roomId)
    ctx.body = catalogClips(ctx.user.roomId)
  } catch (error) { ctx.throw(422, (error as Error).message) }
})
export default router

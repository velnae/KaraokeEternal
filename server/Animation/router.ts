import Router from '@koa/router'
import fs from 'node:fs/promises'
import Animation from './Animation.js'
import { catalogAsset, catalogClips, catalogChanged, resourceFile, setCatalogActive } from './catalog.js'
import { getProduction } from './Production.js'
import type { ProductionInput } from '../../shared/catalogProduction.js'
import { getResource, listResources, editResource, resourceDTO } from './Resources.js'
import { interventionAssets } from '../../shared/animation.js'
import { db } from '../lib/Database.js'
import { preparationClips } from './preparation.js'

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
router.get('/preparation', (ctx) => {
  ctx.body = preparationClips(ctx.user.roomId)
})
router.get('/history', (ctx) => {
  ctx.body = Animation.history(ctx.user.roomId)
})
router.get('/assets/:clipId', async (ctx) => {
  const asset = catalogAsset(ctx.params.clipId)
  if (!asset || (asset.clip.roomId !== undefined && asset.clip.roomId !== ctx.user.roomId)) ctx.throw(404)
  ctx.type = asset.mime
  const { file } = await resourceFile(ctx.params.clipId, ctx.user.roomId)
  ctx.body = await fs.readFile(file)
})
router.get('/providers', (ctx) => {
  ctx.body = getProduction().capabilities()
})
router.get('/resources', (ctx) => {
  try {
    ctx.body = listResources(ctx.user.roomId, ctx.query)
  } catch (error) { ctx.throw(422, (error as Error).message) }
})
router.get('/resources/:id', (ctx) => {
  const resource = getResource(ctx.params.id, ctx.user.roomId)
  if (!resource) ctx.throw(404, 'No se encontró el audio.')
  ctx.body = resourceDTO(resource)
})
router.get('/resources/:id/audio', async (ctx) => {
  try {
    const { file, row } = await resourceFile(ctx.params.id, ctx.user.roomId)
    ctx.type = row.mime!
    if (ctx.query.download === 'true') ctx.attachment(`${row.title.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 80) || 'audio'}.${row.mime === 'audio/mpeg' ? 'mp3' : row.mime === 'audio/ogg' ? 'ogg' : 'wav'}`)
    ctx.body = await fs.readFile(file)
  } catch { ctx.throw(404, 'El archivo no está disponible.') }
})
router.patch('/resources/:id', async (ctx) => {
  const body = (ctx.request as unknown as { body: Parameters<typeof editResource>[2] }).body
  if (!body || typeof body !== 'object' || Array.isArray(body)) ctx.throw(422)
  try {
    ctx.body = editResource(ctx.user.roomId, ctx.params.id, body)
    catalogChanged()
    if (body.state && body.state !== 'active') {
      const active = Animation.active(ctx.user.roomId)
      if (active && interventionAssets(active).some(asset => asset.id === ctx.params.id)) Animation.cancel(ctx.user.roomId, 'Audio desactivado', active.interventionId)
      if (Animation.ambience(ctx.user.roomId)?.clip.id === ctx.params.id) db.run('UPDATE animationRoomState SET ambienceJSON=NULL WHERE roomId=?', [ctx.user.roomId])
    }
    Animation.publish(ctx.user.roomId)
  } catch (error) { ctx.throw(422, (error as Error).message) }
})
router.post('/resources/upload', async (ctx) => {
  const request = ctx.request as unknown as { body: Record<string, string>, files?: Record<string, { filepath: string, originalFilename: string, size: number } | { filepath: string, originalFilename: string, size: number }[]> }
  const files = Object.values(request.files ?? {}).flat()
  try {
    if (files.length !== 1 || files[0].size > 20 * 1024 * 1024) ctx.throw(422, 'Seleccione un archivo de hasta 20 MB.')
    const body = request.body
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(body.requestId ?? '')) ctx.throw(422, 'Solicitud no válida.')
    ctx.body = await getProduction().upload(ctx.user.roomId, `uploaded-${body.requestId}`, body.kind as 'voice' | 'effect' | 'ambience', body.title,
      JSON.parse(body.metadata ?? '{}'), await fs.readFile(files[0].filepath), files[0].originalFilename)
  } catch (error) { ctx.throw(422, (error as Error).message) } finally {
    await Promise.all(files.map(file => fs.rm(file.filepath, { force: true })))
  }
})
router.get('/production', (ctx) => {
  const include = typeof ctx.query.include === 'string' ? ctx.query.include.split(',').filter(Boolean) : []
  if (include.length > 9 || include.some(id => !/^[a-zA-Z0-9-]{1,64}$/.test(id))) ctx.throw(422, 'Identificadores de generación no válidos.')
  ctx.body = { settings: getProduction().status(), jobs: getProduction().list(ctx.user.roomId, include) }
})
router.post('/production/check', async (ctx) => {
  try {
    const body = (ctx.request as unknown as { body?: { providerId?: string, kind?: 'voice' | 'effect' | 'ambience' } }).body
    ctx.body = { voices: await getProduction().check(body?.providerId, body?.kind) }
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
router.post('/production/:jobId/register', async (ctx) => {
  try {
    await getProduction().register(ctx.user.roomId, ctx.params.jobId)
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

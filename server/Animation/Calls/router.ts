import Router from '@koa/router'
import { canOperate } from '../../../shared/permissions.js'
import { getCallVoice } from './CallVoice.js'
import Tables from '../../Tables/Tables.js'
import { job, jobDTO, tableVoice } from './Store.js'
import CallJobs, { CallError } from './Jobs.js'
import CallAutomation, { getCallAutomation } from './Automation.js'
import Animation from '../Animation.js'
import createNameVoiceRouter from './nameRouter.js'
import { db } from '../../lib/Database.js'
import { createCallPromotionRouter } from './promotionRouter.js'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { koaBody } from 'koa-body'
import { activateBackground, backgroundFile, backgroundOverview, saveBackgroundSettings, startKaraokeBackgrounds, uploadBackground } from './Backgrounds.js'
import { recoverKaraokeTurns } from './Start.js'
import { prepareKaraokePreview, readKaraokePreview, saveKaraokePreview } from './Preview.js'

let worker: CallJobs | undefined
export const callPromotionRouter = createCallPromotionRouter(() => worker)
export const nameVoiceRouter = createNameVoiceRouter(() => worker, getCallVoice, () => {
  getCallAutomation()?.reconcile()
  for (const { roomId } of db.all<{ roomId: number }>('SELECT roomId FROM rooms')) Animation.publish(roomId)
})
export async function startCallJobs (directory: string) {
  recoverKaraokeTurns()
  const stopBackgrounds = await startKaraokeBackgrounds(path.join(directory, 'backgrounds'))
  const instance = new CallJobs(directory, getCallVoice(), process.env.KES_FFMPEG_PATH || 'ffmpeg')
  await instance.start()
  worker = instance
  const automatic = new CallAutomation(instance, getCallVoice())
  automatic.start()
  return async () => {
    stopBackgrounds()
    automatic.stop()
    await instance.stop()
    if (worker === instance) worker = undefined
  }
}
export function createCallRouter (getWorker = () => worker, getAutomation = getCallAutomation) {
  const router = new Router({ prefix: '/api/rooms/:roomId' })
  const callPaths = /^\/(karaoke-calls(?:\/|$)|tables\/[^/]+\/voice(?:\/|$))/
  router.use(async (ctx, next) => {
    // This router shares the rooms prefix with existing table routes.
    const suffix = ctx.path.slice(ctx.path.indexOf(`/rooms/${ctx.params.roomId}`) + `/rooms/${ctx.params.roomId}`.length)
    if (!callPaths.test(suffix)) return next()
    if (!ctx.user?.isAdmin && !(canOperate(ctx.user) && ['GET', 'HEAD'].includes(ctx.method) && Number(ctx.params.roomId) === ctx.user.roomId && /\/(?:audio|backgrounds\/assets)\/[\w-]+$/.test(ctx.path))) ctx.throw(403)
    ctx.set('Cache-Control', 'private, no-store')
    try {
      if (!Number.isSafeInteger(Number(ctx.params.roomId)) || Number(ctx.params.roomId) < 1) throw new CallError('Sala no válida.')
      Tables.room(Number(ctx.params.roomId))
      if (!getWorker()) throw new CallError('El servicio de llamados todavía no está disponible.', 503)
      await next()
    } catch (error) { ctx.throw((error as { status?: number }).status ?? 422, (error as Error).message) }
  })
  const body = (ctx): Record<string, unknown> => ctx.request.body || {}
  router.get('/karaoke-calls/preview', async (ctx) => {
    ctx.body = await readKaraokePreview(getWorker()!, ctx.user.userId, Number(ctx.params.roomId))
  })
  router.put('/karaoke-calls/preview', (ctx) => {
    ctx.body = saveKaraokePreview(getWorker()!, ctx.user.userId, Number(ctx.params.roomId), body(ctx).draft, body(ctx).revision)
  })
  router.post('/karaoke-calls/preview', async (ctx) => {
    ctx.body = await prepareKaraokePreview(getWorker()!, ctx.user.userId, Number(ctx.params.roomId), body(ctx))
    ctx.status = 202
  })
  router.get('/karaoke-calls/backgrounds', (ctx) => {
    ctx.body = backgroundOverview(Number(ctx.params.roomId))
  })
  router.put('/karaoke-calls/backgrounds', (ctx) => {
    ctx.body = saveBackgroundSettings(Number(ctx.params.roomId), body(ctx))
    Animation.publish(Number(ctx.params.roomId))
  })
  router.patch('/karaoke-calls/backgrounds/assets/:id', (ctx) => {
    ctx.body = activateBackground(Number(ctx.params.roomId), ctx.params.id, body(ctx).active)
    Animation.publish(Number(ctx.params.roomId))
  })
  router.post('/karaoke-calls/backgrounds/upload', koaBody({ multipart: true, formidable: { maxFileSize: 40 * 1024 * 1024, maxTotalFileSize: 40 * 1024 * 1024, maxFiles: 1, maxFields: 3, maxFieldsSize: 4096 } }), async (ctx) => {
    const request = ctx.request as unknown as { body: { kind?: string, requestId?: string }, files?: Record<string, { filepath: string, originalFilename: string, size: number } | { filepath: string, originalFilename: string, size: number }[]> }
    const files = Object.values(request.files ?? {}).flat()
    try {
      const { kind, requestId } = request.body
      if (!['video', 'bed'].includes(kind ?? '') || typeof requestId !== 'string' || !/^[\w-]{8,100}$/.test(requestId) || files.length !== 1) ctx.throw(422, 'Seleccione un video MP4 o un audio MP3, WAV u OGG.')
      if (files[0].size > (kind === 'video' ? 40 : 20) * 1024 * 1024) ctx.throw(422, 'El archivo supera el tamaño permitido.')
      ctx.body = await uploadBackground(Number(ctx.params.roomId), kind as 'video' | 'bed', files[0].originalFilename || 'Fondo de karaoke', files[0].filepath, requestId!)
      ctx.status = 202
    } finally { await Promise.all(files.map(file => fs.rm(file.filepath, { force: true }))) }
  })
  router.get('/karaoke-calls/backgrounds/assets/:id', async (ctx) => {
    const { asset, file } = backgroundFile(Number(ctx.params.roomId), ctx.params.id)
    ctx.length = (await fs.stat(file)).size
    ctx.type = asset.kind === 'video' ? 'video/mp4' : 'audio/mpeg'
    ctx.body = createReadStream(file)
  })
  router.get('/karaoke-calls', (ctx) => {
    const roomId = Number(ctx.params.roomId)
    ctx.body = { ...getWorker()!.snapshot(roomId), automation: getAutomation()?.snapshot(roomId) }
  })
  const automatic = () => {
    const service = getAutomation()
    if (!service) throw new CallError('El servicio automático todavía no está disponible.', 503)
    return service
  }
  const changed = (roomId: number) => {
    const active = Animation.active(roomId)
    if (active?.callJSON && !active.startedAt) Animation.cancel(roomId, 'Cambió la configuración de llamados.')
    Animation.publish(roomId)
  }
  router.put('/karaoke-calls/automation', (ctx) => {
    const roomId = Number(ctx.params.roomId)
    ctx.body = automatic().configure(roomId, body(ctx))
    changed(roomId)
  })
  router.post('/karaoke-calls/setup', (ctx) => {
    const roomId = Number(ctx.params.roomId)
    if (typeof body(ctx).quote !== 'string') throw new CallError('Actualice la página y revise el lote antes de generar plantillas.', 409)
    ctx.body = automatic().setup(roomId, body(ctx))
    changed(roomId)
    ctx.status = 202
  })
  const queueId = (ctx) => {
    const id = Number(ctx.params.queueId)
    if (!Number.isSafeInteger(id) || id < 1) throw new CallError('Pedido no válido.')
    return id
  }
  router.get('/karaoke-calls/requests/:queueId', (ctx) => {
    ctx.body = automatic().snapshot(Number(ctx.params.roomId), queueId(ctx)).requests[0]
    if (!ctx.body) ctx.throw(404)
  })
  router.post('/karaoke-calls/requests/:queueId/retry', (ctx) => {
    const roomId = Number(ctx.params.roomId)
    automatic().retry(roomId, queueId(ctx), body(ctx).inputKey)
    ctx.body = automatic().snapshot(roomId)
    ctx.status = 202
  })
  router.post('/karaoke-calls/requests/:queueId/recover', async (ctx) => {
    ctx.body = await automatic().recover(Number(ctx.params.roomId), queueId(ctx), body(ctx))
    ctx.status = 202
  })
  router.get('/karaoke-calls/requests/:queueId/audio/:id', async (ctx) => {
    ctx.body = await automatic().audio(Number(ctx.params.roomId), queueId(ctx), ctx.params.id)
    ctx.type = 'audio/mpeg'
  })
  router.post('/karaoke-calls/intros', (ctx) => {
    ctx.body = getWorker()!.submit(Number(ctx.params.roomId), 'intro', body(ctx))
    ctx.status = 202
  })
  router.post('/karaoke-calls/listening-intros', (ctx) => {
    ctx.body = automatic().listening.templates.save(Number(ctx.params.roomId), undefined, body(ctx))
    ctx.status = 202
  })
  router.put('/karaoke-calls/listening-intros/:id', (ctx) => {
    const roomId = Number(ctx.params.roomId)
    const input = body(ctx)
    ctx.body = input.text !== undefined
      ? automatic().listening.templates.save(roomId, ctx.params.id, input)
      : automatic().listening.templates.configure(roomId, ctx.params.id, input)
    automatic().reconcile()
    Animation.publish(roomId)
  })
  router.post('/karaoke-calls/listening-intros/:id/retry', (ctx) => {
    const roomId = Number(ctx.params.roomId)
    const current = automatic().listening.templates.list(roomId).find(row => row.id === ctx.params.id)
    if (!current) ctx.throw(404)
    ctx.body = automatic().listening.templates.save(roomId, current.id, { ...body(ctx), text: current.text })
    ctx.status = 202
  })
  router.get('/tables/:tableId/voice', (ctx) => {
    ctx.body = tableVoice(Number(ctx.params.roomId), Number(ctx.params.tableId), getCallVoice().profile())
  })
  router.post('/tables/:tableId/voice/generate', (ctx) => {
    ctx.body = getWorker()!.submit(Number(ctx.params.roomId), 'table', body(ctx), Number(ctx.params.tableId))
    ctx.status = 202
  })
  router.post('/karaoke-calls/previews', (ctx) => {
    const input = body(ctx)
    if (input.mode !== undefined && !['hybrid', 'reference'].includes(String(input.mode))) throw new CallError('Modo de prueba no válido.')
    ctx.body = getWorker()!.submit(Number(ctx.params.roomId), input.mode === 'reference' ? 'reference' : 'hybrid', input)
    ctx.status = 202
  })
  router.get('/karaoke-calls/jobs/:id', (ctx) => {
    const row = job(Number(ctx.params.roomId), ctx.params.id)
    if (!row) ctx.throw(404)
    ctx.body = jobDTO(row, getCallVoice().profile())
  })
  router.post('/karaoke-calls/jobs/:id/cancel', (ctx) => {
    ctx.body = getWorker()!.cancel(Number(ctx.params.roomId), ctx.params.id)
  })
  router.get('/karaoke-calls/audio/:id', async (ctx) => {
    if (!ctx.user.isAdmin && db.get(`SELECT 1 FROM karaokeCallParts WHERE id=? AND kind='name' AND roomId IS NULL`, [ctx.params.id])) ctx.throw(403)
    ctx.body = await getWorker()!.bytes(Number(ctx.params.roomId), ctx.params.id)
    ctx.type = 'audio/mpeg'
  })
  return router
}
export default createCallRouter()

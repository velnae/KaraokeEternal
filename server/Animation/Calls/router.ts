import Router from '@koa/router'
import { getGreetingVoice } from '../../Greetings/GreetingVoice.js'
import Tables from '../../Tables/Tables.js'
import { job, jobDTO, tableVoice } from './Store.js'
import CallJobs, { CallError } from './Jobs.js'

let worker: CallJobs | undefined
export async function startCallJobs (directory: string) {
  const instance = new CallJobs(directory, getGreetingVoice(), process.env.KES_FFMPEG_PATH || 'ffmpeg')
  await instance.start()
  worker = instance
  return async () => {
    await instance.stop()
    if (worker === instance) worker = undefined
  }
}
export function createCallRouter (getWorker = () => worker) {
  const router = new Router({ prefix: '/api/rooms/:roomId' })
  const callPaths = /^\/(karaoke-calls(?:\/|$)|tables\/[^/]+\/voice(?:\/|$))/
  router.use(async (ctx, next) => {
    // This router shares the rooms prefix with existing table routes.
    const suffix = ctx.path.slice(ctx.path.indexOf(`/rooms/${ctx.params.roomId}`) + `/rooms/${ctx.params.roomId}`.length)
    if (!callPaths.test(suffix)) return next()
    if (!ctx.user?.isAdmin) ctx.throw(403)
    ctx.set('Cache-Control', 'private, no-store')
    try {
      if (!Number.isSafeInteger(Number(ctx.params.roomId)) || Number(ctx.params.roomId) < 1) throw new CallError('Sala no válida.')
      Tables.room(Number(ctx.params.roomId))
      if (!getWorker()) throw new CallError('El servicio de llamados todavía no está disponible.', 503)
      await next()
    } catch (error) { ctx.throw((error as { status?: number }).status ?? 422, (error as Error).message) }
  })
  const body = (ctx): Record<string, unknown> => ctx.request.body || {}
  router.get('/karaoke-calls', (ctx) => {
    ctx.body = getWorker()!.snapshot(Number(ctx.params.roomId))
  })
  router.post('/karaoke-calls/intros', (ctx) => {
    ctx.body = getWorker()!.submit(Number(ctx.params.roomId), 'intro', body(ctx))
    ctx.status = 202
  })
  router.get('/tables/:tableId/voice', (ctx) => {
    ctx.body = tableVoice(Number(ctx.params.roomId), Number(ctx.params.tableId), getGreetingVoice().profile())
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
    ctx.body = jobDTO(row, getGreetingVoice().profile())
  })
  router.post('/karaoke-calls/jobs/:id/cancel', (ctx) => {
    ctx.body = getWorker()!.cancel(Number(ctx.params.roomId), ctx.params.id)
  })
  router.get('/karaoke-calls/audio/:id', async (ctx) => {
    ctx.body = await getWorker()!.bytes(Number(ctx.params.roomId), ctx.params.id)
    ctx.type = 'audio/mpeg'
  })
  return router
}
export default createCallRouter()

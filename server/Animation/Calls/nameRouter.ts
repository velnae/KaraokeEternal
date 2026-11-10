import Router from '@koa/router'
import { db } from '../../lib/Database.js'
import type GreetingVoice from '../../Greetings/GreetingVoice.js'
import type CallJobs from './Jobs.js'
import NameBank, { NameVoiceError } from './NameBank.js'
import { key, jobDTO, type PartRow } from './Store.js'
import { getNameVoiceStyle, saveNameVoiceStyle } from './nameStyle.js'

export default function createNameVoiceRouter (getWorker: () => CallJobs | undefined, getVoice: () => Pick<GreetingVoice, 'profile' | 'snapshot'>, changed = () => {}) {
  const router = new Router({ prefix: '/api/name-voices' })
  router.use(async (ctx, next) => {
    if (!ctx.user?.isAdmin) ctx.throw(403)
    ctx.set('Cache-Control', 'private, no-store')
    try {
      await next()
    } catch (error) {
      ctx.status = (error as { status?: number }).status ?? 422
      ctx.body = { error: (error as Error).message, ...(error instanceof NameVoiceError && error.conflicts.length ? { conflicts: error.conflicts } : {}) }
    }
  })
  const worker = () => {
    const instance = getWorker()
    if (!instance) throw new NameVoiceError('El servicio de voz todavía no está disponible.', 503)
    return instance
  }
  const body = (ctx): Record<string, unknown> => ctx.request.body ?? {}
  router.get('/', (ctx) => {
    const voice = getVoice()
    const snapshot = voice.snapshot()
    ctx.body = { ...NameBank.list(voice.profile(), ctx.query), promptStyle: getNameVoiceStyle(voice.profile()), generation: { configured: snapshot.configured, enabled: snapshot.config.enabled,
      allowed: snapshot.configured && !['limited', 'error', 'checking', 'generating'].includes(snapshot.state), message: snapshot.message } }
  })
  router.get('/style', (ctx) => {
    ctx.body = getNameVoiceStyle(getVoice().profile())
  })
  router.put('/style', (ctx) => {
    ctx.body = saveNameVoiceStyle(body(ctx), getVoice().profile())
  })
  router.post('/', (ctx) => {
    const input = body(ctx)
    if (typeof input.spokenText !== 'string') throw new NameVoiceError('Ingrese la pronunciación.')
    const group = NameBank.ensure(input.spokenText)
    ctx.body = NameBank.detail(group.id, getVoice().profile())
    ctx.status = 201
  })
  router.get('/:id', (ctx) => {
    ctx.body = NameBank.detail(ctx.params.id, getVoice().profile())
  })
  router.put('/:id', (ctx) => {
    NameBank.update(ctx.params.id, body(ctx))
    changed()
    ctx.body = NameBank.detail(ctx.params.id, getVoice().profile())
  })
  router.post('/:id/generate', (ctx) => {
    const input = body(ctx)
    const group = NameBank.get(ctx.params.id)
    if (typeof input.requestId !== 'string' || !/^[\w-]{8,100}$/.test(input.requestId)) throw new NameVoiceError('La solicitud necesita un identificador válido.')
    const profile = getVoice().profile()
    const existing = NameBank.latestJob(group.id, profile)
    if (existing && ['queued', 'generating', 'preparing'].includes(existing.status)) {
      ctx.body = jobDTO(existing, profile)
    } else {
      const roomId = db.get<{ roomId: number }>('SELECT roomId FROM rooms WHERE roomId=?', [ctx.user.roomId ?? null])?.roomId
        ?? db.get<{ roomId: number }>('SELECT roomId FROM rooms ORDER BY roomId LIMIT 1')?.roomId
      if (!roomId) throw new NameVoiceError('Cree una sala antes de preparar una voz.')
      ctx.body = worker().submit(roomId, 'source', { sourceKind: 'name', nameId: group.id, text: group.spokenText, regenerate: true,
        requestId: `name-${key([group.id, input.requestId, input.reprocessPartId])}`, ...(input.reprocessPartId === undefined ? {} : { reprocessPartId: input.reprocessPartId }) })
    }
    ctx.status = 202
  })
  router.post('/:id/select', async (ctx) => {
    const input = body(ctx)
    if (typeof input.partId !== 'string') throw new NameVoiceError('Seleccione una versión.')
    const version = db.get<PartRow>(`SELECT * FROM karaokeCallParts WHERE id=? AND nameId=? AND kind='name'`, [input.partId, ctx.params.id])
    if (!version) throw new NameVoiceError('No se encontró la versión.', 404)
    await worker().bytes(0, version.id, true)
    await worker().bytes(0, version.id)
    NameBank.choose(ctx.params.id, version.id, input.revision)
    changed()
    ctx.body = NameBank.detail(ctx.params.id, getVoice().profile())
  })
  router.get('/:id/audio/:partId', async (ctx) => {
    NameBank.get(ctx.params.id)
    if (!db.get(`SELECT 1 FROM karaokeCallParts WHERE id=? AND nameId=? AND kind='name'`, [ctx.params.partId, ctx.params.id])) throw new NameVoiceError('No se encontró el audio.', 404)
    ctx.body = await worker().bytes(0, ctx.params.partId)
    ctx.type = 'audio/mpeg'
  })
  return router
}

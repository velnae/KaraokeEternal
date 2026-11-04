import Router from '@koa/router'
import { getGreetingVoice, GreetingVoiceSettingsError } from './GreetingVoice.js'
import { GreetingVoiceError } from './GeminiGreetingTts.js'
import { AudioValidationError } from '../Animation/AudioPreparation.js'
import { previewGreetingAudio } from './audioRouter.js'

const router = new Router({ prefix: '/api/prefs/greeting-voice' })
router.use(async (ctx, next) => {
  if (!ctx.user?.isAdmin) ctx.throw(403, 'Solo los administradores pueden configurar la voz de saludos.')
  ctx.set('Cache-Control', 'private, no-store')
  try {
    await next()
  } catch (error) {
    if (error instanceof GreetingVoiceSettingsError) ctx.throw(error.status, error.message)
    if (error instanceof AudioValidationError) ctx.throw(422, error.message)
    if (error instanceof GreetingVoiceError) {
      const status = error.kind === 'busy' ? 409 : ['rate', 'quota'].includes(error.kind) ? 429 : error.kind === 'auth' ? 503 : error.kind === 'uncertain' ? 502 : 422
      if (error.retryAt > Date.now()) ctx.set('Retry-After', String(Math.ceil((error.retryAt - Date.now()) / 1000)))
      ctx.throw(status, error.message)
    }
    throw error
  }
})
router.get('/', (ctx) => {
  ctx.body = getGreetingVoice().snapshot()
})
router.put('/', (ctx) => {
  ctx.body = getGreetingVoice().configure((ctx.request as unknown as { body: unknown }).body)
})
router.post('/check', async (ctx) => {
  ctx.body = await getGreetingVoice().check()
})
router.post('/preview', async (ctx) => {
  const controller = new AbortController()
  const abort = () => {
    if (!ctx.res.writableEnded) controller.abort()
  }
  ctx.res.once('close', abort)
  try {
    const preview = await previewGreetingAudio(controller.signal)
    if (!preview) ctx.throw(503, 'La preparación de saludos todavía no está disponible.')
    ctx.body = preview
    ctx.type = 'audio/mpeg'
  } finally { ctx.res.removeListener('close', abort) }
})
export default router

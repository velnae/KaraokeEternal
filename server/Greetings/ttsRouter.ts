import Router from '@koa/router'
import Prefs from '../Prefs/Prefs.js'
import LocalTts, { TtsSettingsError } from './LocalTts.js'
import type { LocalTtsConfig } from '../../shared/localTts.js'

let service: LocalTts | undefined
export function getLocalTts () {
  service ??= new LocalTts((Prefs.get() as { localTts?: LocalTtsConfig }).localTts, (config) => {
    if (!Prefs.set('localTts', config)) throw new Error('Could not save local TTS settings')
  })
  return service
}
export function startLocalTts () {
  const instance = getLocalTts()
  instance.initialize()
  return async () => {
    await instance.close()
    if (service === instance) service = undefined
  }
}

const router = new Router({ prefix: '/api/prefs/local-tts' })
router.use(async (ctx, next) => {
  if (!ctx.user?.isAdmin) ctx.throw(403, 'Solo los administradores pueden configurar la voz local.')
  ctx.set('Cache-Control', 'private, no-store')
  await next()
})
router.get('/', (ctx) => {
  ctx.body = getLocalTts().snapshot()
})
router.put('/', async (ctx) => {
  try {
    ctx.body = await getLocalTts().configure((ctx.request as unknown as { body: unknown }).body)
  } catch (error) {
    if (error instanceof TtsSettingsError) ctx.throw(error.status, error.message)
    throw error
  }
})
router.post('/check', (ctx) => {
  getLocalTts().check()
  ctx.body = getLocalTts().snapshot()
})
router.post('/start', (ctx) => {
  const instance = getLocalTts()
  if (!instance.snapshot().config.installationPath) ctx.throw(422, 'Guarde primero la ruta de Chatterbox.')
  instance.check(true)
  ctx.body = instance.snapshot()
})
export default router

import Router from '@koa/router'
import GreetingAudioJobs from './AudioJobs.js'
import { getLocalTts } from './ttsRouter.js'
import getLogger from '../lib/Log.js'

let jobs: GreetingAudioJobs | undefined
export const getGreetingAudioAsset = (roomId: number, greetingId: number) => jobs?.asset(roomId, greetingId) ?? Promise.resolve(null)
export function startGreetingAudio (directory: string) {
  const worker = new GreetingAudioJobs(directory, getLocalTts(), process.env.KES_FFMPEG_PATH || 'ffmpeg')
  jobs = worker
  const startup = worker.start().catch(() => {
    getLogger('greeting-audio').error('Could not initialize private greeting audio storage; visual greetings remain available.')
  })
  return async () => {
    await startup
    await worker.stop()
    if (jobs === worker) jobs = undefined
  }
}

const router = new Router({ prefix: '/api/greetings' })
router.get('/:greetingId/audio', async (ctx) => {
  if (!ctx.user?.isAdmin || !Number.isSafeInteger(ctx.user.roomId)) ctx.throw(403)
  ctx.set('Cache-Control', 'private, no-store')
  const id = Number(ctx.params.greetingId)
  if (!Number.isSafeInteger(id) || id < 1) ctx.throw(404)
  const bytes = await jobs?.audio(ctx.user.roomId, id)
  if (!bytes) ctx.throw(404, 'El audio de este saludo no está disponible.')
  ctx.type = 'audio/mpeg'
  ctx.body = bytes
})
export default router

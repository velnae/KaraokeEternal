import Router from '@koa/router'
import GreetingAudioJobs from './AudioJobs.js'
import { getGreetingVoice } from './GreetingVoice.js'
import getLogger from '../lib/Log.js'

let jobs: GreetingAudioJobs | undefined
let startup: Promise<void> | undefined
export const getGreetingAudioAsset = (roomId: number, greetingId: number) => jobs?.asset(roomId, greetingId) ?? Promise.resolve(null)
export async function previewGreetingAudio (signal: AbortSignal) {
  const worker = jobs
  if (!worker) return null
  await startup
  return worker.preview(signal)
}
export function startGreetingAudio (directory: string) {
  const worker = new GreetingAudioJobs(directory, getGreetingVoice(), process.env.KES_FFMPEG_PATH || 'ffmpeg')
  jobs = worker
  const ready = worker.start().catch(() => {
    getLogger('greeting-audio').error('Could not initialize private greeting audio storage; visual greetings remain available.')
  })
  startup = ready
  return async () => {
    await ready
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

import Router from '@koa/router'
import fs from 'node:fs/promises'
import path from 'node:path'
import { koaBody } from 'koa-body'
import type { Middleware } from 'koa'
import type CallJobs from './Jobs.js'
import { getCallVoice } from './CallVoice.js'
import { callPromotionSnapshot, importCallResource } from './Promotion.js'

const prefix = '/api/resource-promotion/calls'
export const isCallPromotionPath = (pathname: string, urlPath: string) => {
  const base = `${urlPath.replace(/\/$/, '')}${prefix}`.toLowerCase()
  return pathname.toLowerCase() === base || pathname.toLowerCase().startsWith(`${base}/`)
}
export function createCallPromotionRouter (getWorker: () => CallJobs | undefined) {
  const router = new Router({ prefix })
  const authorize: Middleware = async (ctx, next) => {
    if (!ctx.user?.isAdmin || !Number.isSafeInteger(ctx.user.roomId) || ctx.user.roomId < 1) ctx.throw(403)
    if (!getWorker()) ctx.throw(503)
    ctx.set('Cache-Control', 'private, no-store')
    try {
      await next()
    } catch (error) { ctx.throw((error as { status?: number }).status ?? 422, (error as Error).message) }
  }
  const snapshot = roomId => callPromotionSnapshot(roomId, getCallVoice().profile())
  router.get('/', authorize, (ctx) => {
    ctx.body = snapshot(ctx.user.roomId)
  })
  router.get('/parts/:id/:format', authorize, async (ctx) => {
    if (!['master', 'audio'].includes(ctx.params.format)) ctx.throw(404)
    const all = snapshot(ctx.user.roomId)
    if (![...all.names, ...all.listening].some(item => item.part?.id === ctx.params.id)) ctx.throw(404)
    ctx.body = await getWorker()!.bytes(ctx.user.roomId, ctx.params.id, ctx.params.format === 'master')
    ctx.type = ctx.params.format === 'master' ? 'audio/wav' : 'audio/mpeg'
  })
  router.post('/import', authorize, async (ctx) => {
    const staging = await fs.mkdtemp(path.join(getWorker()!.directory, '.promotion-upload-'))
    try {
      const parse = koaBody({ multipart: true, json: false, urlencoded: false, text: false,
        formidable: { uploadDir: staging, maxFiles: 2, maxFileSize: 20 * 1024 * 1024, maxTotalFileSize: 25 * 1024 * 1024, maxFields: 1, maxFieldsSize: 24 * 1024 } })
      await parse(ctx, async () => {})
      const request = ctx.request as unknown as { body: { metadata?: string }, files?: Record<string, { filepath: string } | { filepath: string }[]> }
      const files = request.files ?? {}
      const master = files.master, audio = files.audio
      if (!master || Array.isArray(master) || !audio || Array.isArray(audio) || Object.keys(files).length !== 2) return ctx.throw(422, 'Envíe el WAV original y el MP3 preparado.')
      const input = JSON.parse(request.body?.metadata ?? 'null')
      if (!input || input.roomId !== ctx.user.roomId) ctx.throw(422, 'La sala de destino no coincide.')
      ctx.body = await importCallResource(getWorker()!, ctx.user.roomId, getCallVoice().profile(), input.source, input.expectedTag,
        await fs.readFile(master.filepath), await fs.readFile(audio.filepath))
    } finally {
      await fs.rm(staging, { recursive: true, force: true })
    }
  })
  return router
}

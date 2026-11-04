import fs from 'node:fs/promises'
import { createWriteStream, type WriteStream } from 'node:fs'
import path from 'node:path'
import { koaBody } from 'koa-body'
import type { Context } from 'koa'
import getLogger from '../lib/Log.js'
import { ValidationError } from '../lib/Errors.js'
import { TRANSITION_VIDEO_LIMITS } from '../../shared/transitionVideo.js'
import { getTransitionVideoAttempt, transitionVideoDTO } from './Store.js'
import { type TransitionVideoService, VideoServiceError } from './Service.js'

const validRequestId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(value)

export async function uploadTransitionVideo (ctx: Context, service: TransitionVideoService) {
  // The optional header lets retries recover an accepted attempt before reading
  // another file, including while the single preparation slot is busy.
  const headerId = ctx.get('X-Upload-Request-Id')
  if (headerId && !validRequestId(headerId)) ctx.throw(422, 'La solicitud de video no es válida.')
  if (headerId) {
    const existing = getTransitionVideoAttempt(ctx.user.roomId, headerId)
    if (existing) {
      ctx.set('Connection', 'close')
      ctx.body = transitionVideoDTO(existing)
      ctx.status = existing.state === 'preparing' ? 202 : 200
      return
    }
  }
  if (!ctx.is('multipart')) ctx.throw(415, 'Envíe un archivo MP4 mediante un formulario multipart.')
  const totalLimit = TRANSITION_VIDEO_LIMITS.size + 64 * 1024
  if (ctx.request.length > totalLimit) ctx.throw(413, 'Seleccione un solo video de hasta 40 MiB.')
  const release = service.reserveUpload(() => ctx.req.destroy())
  const streams: WriteStream[] = []
  let directory: string | undefined
  let onAborted: (() => void) | undefined
  const timeout = setTimeout(() => ctx.req.destroy(), 120_000)
  timeout.unref()
  try {
    directory = await fs.mkdtemp(path.join(service.staging, 'upload-'))
    if (ctx.req.destroyed || ctx.req.aborted) ctx.throw(400, 'La carga se interrumpió.')
    const parse = koaBody({ multipart: true, json: false, urlencoded: false, text: false,
      formidable: { uploadDir: directory, maxFiles: 1, maxFileSize: TRANSITION_VIDEO_LIMITS.size,
        maxTotalFileSize: TRANSITION_VIDEO_LIMITS.size, maxFields: 2, maxFieldsSize: 16 * 1024,
        fileWriteStreamHandler: (file) => {
          // Formidable supplies this path to VolatileFile, but its typings omit it.
          const stream = createWriteStream((file as unknown as { filepath: string }).filepath, { flags: 'wx' })
          streams.push(stream)
          return stream
        } },
      onError: (error) => {
        const code = (error as Error & { httpCode?: number }).httpCode
        ctx.throw(code === 413 ? 413 : 422, code === 413 ? 'Seleccione un solo video de hasta 40 MiB.' : 'La carga está incompleta o no es válida. Vuelva a intentar.')
      },
    })
    const aborted = new Promise<never>((_resolve, reject) => {
      onAborted = () => reject(new VideoServiceError(400, 'La carga se interrumpió.'))
      ctx.req.once('aborted', onAborted)
    })
    await Promise.race([parse(ctx, async () => {}), aborted])
    if (ctx.req.aborted) ctx.throw(400, 'La carga se interrumpió.')
    const request = ctx.request as typeof ctx.request & {
      body: { requestId?: unknown, title?: unknown }
      files?: Record<string, { filepath: string, originalFilename?: string, size: number } | { filepath: string, originalFilename?: string, size: number }[]>
    }
    const files = Object.values(request.files ?? {}).flat()
    const requestId = headerId || request.body?.requestId
    if (!validRequestId(requestId) || (headerId && request.body?.requestId !== undefined && headerId !== request.body.requestId)) ctx.throw(422, 'La solicitud de video no es válida.')
    if (files.length !== 1 || !files[0].size || files[0].size > TRANSITION_VIDEO_LIMITS.size) ctx.throw(422, 'Seleccione un solo video de hasta 40 MiB.')
    const title = request.body?.title ?? path.basename(files[0].originalFilename || 'Video').slice(0, 120)
    if (typeof title !== 'string') ctx.throw(422, 'Indique un nombre para el video.')
    const existing = getTransitionVideoAttempt(ctx.user.roomId, requestId)
    const resource = existing ? transitionVideoDTO(existing) : await service.accept(ctx.user.roomId, { requestId, title }, files[0].filepath)
    ctx.body = resource
    ctx.status = resource.state === 'preparing' ? 202 : 200
  } catch (error) {
    ctx.set('Connection', 'close')
    if (error instanceof ValidationError || (error as { status?: number }).status) throw error
    getLogger('transition-video').warn('Upload failed: %s', (error as Error).message)
    throw new VideoServiceError(503, 'No se pudo almacenar el video. Revise el espacio disponible.')
  } finally {
    clearTimeout(timeout)
    if (onAborted) ctx.req.off('aborted', onAborted)
    // Await every writer close, including files not present in request.files when
    // Formidable rejects size/count limits or the client disconnects mid-upload.
    await Promise.all(streams.map(stream => new Promise<void>((resolve) => {
      if (stream.closed) return resolve()
      stream.once('close', resolve)
      stream.destroy()
    })))
    try {
      if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(error => getLogger('transition-video').warn('Upload cleanup failed: %s', error.message))
    } finally { release() }
  }
}

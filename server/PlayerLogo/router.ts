import fs from 'node:fs/promises'
import { createReadStream, createWriteStream, type WriteStream } from 'node:fs'
import path from 'node:path'
import Router from '@koa/router'
import { koaBody } from 'koa-body'
import { PLAYER_LOGO_LIMITS as limits } from '../../shared/playerLogo.js'
import { getLogoImage, PlayerLogoStore } from './Store.js'
import getLogger from '../lib/Log.js'

export const isPlayerLogoPath = (pathname: string, base: string) => pathname.startsWith(`${base}api/player-logo-images/`)

export function createPlayerLogoRouter (store: PlayerLogoStore) {
  const router = new Router({ prefix: '/api/player-logo-images' })
  router.post('/:kind', async (ctx) => {
    if (!ctx.user?.isAdmin) ctx.throw(403, 'No tiene autorización')
    const kind = ctx.params.kind
    if (kind !== 'png' && kind !== 'gif') return ctx.throw(422, 'Seleccione una imagen PNG o GIF.')
    const max = kind === 'png' ? limits.pngBytes : limits.gifBytes
    if (!ctx.is('multipart')) ctx.throw(415, 'Envíe una imagen mediante un formulario multipart.')
    if (ctx.request.length > max + 64 * 1024) ctx.throw(413, 'La imagen supera el tamaño permitido.')
    const controller = new AbortController()
    const cancel = () => {
      controller.abort()
      ctx.req.destroy()
    }
    const release = store.reserve(cancel)
    const streams: WriteStream[] = []
    let directory: string | undefined
    const timer = setTimeout(cancel, 120000)
    timer.unref()
    ctx.req.once('aborted', cancel)
    try {
      directory = await fs.mkdtemp(path.join(store.staging, 'upload-'))
      const parse = koaBody({ multipart: true, json: false, urlencoded: false, text: false,
        formidable: { uploadDir: directory, maxFiles: 1, maxFileSize: max, maxTotalFileSize: max, maxFields: 0, maxFieldsSize: 1024,
          fileWriteStreamHandler: (file) => {
            const stream = createWriteStream((file as unknown as { filepath: string }).filepath, { flags: 'wx' })
            streams.push(stream)
            return stream
          } },
        onError: error => ctx.throw((error as { httpCode?: number }).httpCode === 413 ? 413 : 422, 'La carga está incompleta o supera el tamaño permitido.'),
      })
      await parse(ctx, async () => {})
      controller.signal.throwIfAborted()
      const files = Object.values((ctx.request as typeof ctx.request & { files?: Record<string, { filepath: string } | { filepath: string }[]> }).files ?? {}).flat()
      if (files.length !== 1) ctx.throw(422, 'Seleccione una sola imagen.')
      ctx.body = await store.prepare(files[0].filepath, kind, directory, controller.signal)
      ctx.status = 201
    } catch (error) {
      if ((error as { status?: number }).status) throw error
      if (controller.signal.aborted) ctx.throw(400, 'La carga se interrumpió. Vuelva a intentar.')
      getLogger('player-logo').warn('Image upload failed: %s', (error as Error).message)
      ctx.throw(503, 'No se pudo guardar la imagen. Revise el espacio disponible y vuelva a intentar.')
    } finally {
      clearTimeout(timer)
      ctx.req.off('aborted', cancel)
      await Promise.all(streams.map(stream => new Promise<void>((resolve) => {
        if (stream.closed) return resolve()
        stream.once('close', resolve)
        stream.destroy()
      })))
      try {
        if (directory) await fs.rm(directory, { recursive: true, force: true })
      } finally { release() }
    }
  })
  router.get('/:id/:variant', async (ctx) => {
    const image = getLogoImage(ctx.params.id)
    if (!image || !['image', 'poster'].includes(ctx.params.variant)) ctx.throw(404, 'No se encontró la imagen.')
    const poster = ctx.params.variant === 'poster'
    const file = path.join(store.directory, image.id, poster ? 'poster.png' : `image.${image.kind}`)
    const stat = await fs.stat(file).catch(() => null)
    if (!stat) ctx.throw(404, 'La imagen ya no está disponible.')
    ctx.set('X-Content-Type-Options', 'nosniff')
    ctx.set('Cache-Control', 'public, max-age=31536000, immutable')
    ctx.type = poster || image.kind === 'png' ? 'image/png' : 'image/gif'
    ctx.length = stat.size
    ctx.body = createReadStream(file)
  })
  router.delete('/:id', async (ctx) => {
    if (!ctx.user?.isAdmin) ctx.throw(403, 'No tiene autorización')
    await store.remove(ctx.params.id)
    ctx.body = { removed: true }
  })
  return router
}

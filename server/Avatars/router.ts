import { execFile } from 'node:child_process'
import Router from '@koa/router'
import { koaBody } from 'koa-body'
import { AVATAR_UPLOAD_MAX, defaultAvatar } from '../../shared/avatars.js'
import { db } from '../lib/Database.js'
import { listAvatars } from './catalog.js'

const router = new Router({ prefix: '/api/avatars' })
const parse = koaBody({ jsonLimit: '3mb', multipart: false, text: false, urlencoded: false })
let processing = false

async function normalize (image: Buffer, decoder: string) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = execFile(process.env.KES_FFMPEG_PATH || 'ffmpeg', [
      '-v', 'error', '-threads', '1', '-max_pixels', '16000000', '-f', 'image2pipe', '-c:v', decoder, '-i', 'pipe:0',
      '-filter_threads', '1', '-vf', 'scale=152:152:force_original_aspect_ratio=decrease,format=rgba,pad=160:160:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1',
      '-frames:v', '1', '-c:v', 'libwebp', '-quality', '82', '-f', 'webp', 'pipe:1',
    ], { encoding: 'buffer', timeout: 10000, maxBuffer: 128 * 1024 }, (error, output) => {
      if (error || !output.length) reject(error ?? new Error('Empty image'))
      else resolve(output)
    })
    child.stdin?.on('error', () => {})
    child.stdin?.end(image)
  })
}

router.use(async (ctx, next) => {
  if (ctx.method !== 'GET' && ctx.method !== 'HEAD' && !ctx.user?.isAdmin) ctx.throw(403)
  await next()
})

router.get('/', (ctx) => {
  ctx.set('Cache-Control', 'no-store')
  ctx.body = listAvatars(ctx.user?.isAdmin && ctx.query.all === '1')
})

router.get('/image', (ctx) => {
  const { id, v } = ctx.query
  if (typeof id !== 'string') return ctx.throw(404)
  const row = db.get<{ revision: number, image: Uint8Array }>('SELECT revision, image FROM guestAvatars WHERE id = ?', [id])
  if (!row?.image) return ctx.throw(404)
  ctx.set('Cache-Control', String(row.revision) === v ? 'public, max-age=31536000, immutable' : 'no-store')
  ctx.set('X-Content-Type-Options', 'nosniff')
  ctx.type = 'image/webp'
  ctx.body = Buffer.from(row.image)
})

router.post('/image', parse, async (ctx) => {
  const { id, category, image } = (ctx.request as typeof ctx.request & { body?: Record<string, unknown> }).body ?? {}
  if (id !== undefined && (typeof id !== 'string' || !db.get('SELECT 1 FROM guestAvatars WHERE id = ?', [id]))) return ctx.throw(404)
  if (id === undefined && category !== 'varon' && category !== 'mujer') return ctx.throw(422, 'Seleccione una categoría.')
  if (typeof image !== 'string' || image.length > Math.ceil(AVATAR_UPLOAD_MAX / 3) * 4) return ctx.throw(413, 'Seleccione una imagen de hasta 2 MB.')
  const bytes = Buffer.from(image, 'base64')
  if (bytes.length > AVATAR_UPLOAD_MAX) return ctx.throw(413)
  let decoder: string | undefined
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) decoder = 'png'
  else if (bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) decoder = 'mjpeg'
  else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') decoder = 'webp'
  if (!decoder) return ctx.throw(422, 'Seleccione una imagen PNG, JPEG o WebP.')
  if (processing) return ctx.throw(409, 'Hay una imagen en proceso. Vuelva a intentar.')
  processing = true
  try {
    const output = await normalize(bytes, decoder).catch(() => ctx.throw(422, 'No se pudo procesar la imagen. Pruebe con otra.'))
    if (typeof id === 'string') db.run('UPDATE guestAvatars SET image = ?, revision = revision + 1 WHERE id = ?', [output, id])
    else {
      const { count } = db.get<{ count: number }>('SELECT COUNT(*) AS count FROM guestAvatars WHERE category = ?', [category as string])!
      const newId = `${category}/${String(count + 1).padStart(2, '0')}`
      db.run('INSERT INTO guestAvatars (id, category, image, revision) VALUES (?, ?, ?, 1)', [newId, category as string, output])
    }
    ctx.body = listAvatars(true)
  } finally {
    processing = false
  }
})

router.patch('/visibility', parse, (ctx) => {
  const { id, active } = (ctx.request as typeof ctx.request & { body?: Record<string, unknown> }).body ?? {}
  if (typeof id !== 'string' || id === defaultAvatar || typeof active !== 'boolean') return ctx.throw(422)
  if (!db.run('UPDATE guestAvatars SET active = ? WHERE id = ?', [Number(active), id]).changes) return ctx.throw(404)
  ctx.body = listAvatars(true)
})

export default router

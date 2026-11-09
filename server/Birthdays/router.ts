import Router from '@koa/router'
import { canOperate } from '../../shared/permissions.js'
import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { db } from '../lib/Database.js'
import { getProduction } from '../Animation/Production.js'
import { validateBirthdaySettings, type BirthdayInput, type BirthdaySettings } from '../../shared/birthdays.js'
import { listBirthdayVoices } from './gemini.js'
import { speechProfile } from './personalization.js'
import { birthdayService } from './Service.js'
import { assertRoom, asset, assetDTO, changeBirthday, createBirthday, eventDTO, rows, saveSettings, settings, type AssetRow } from './Store.js'

const router = new Router({ prefix: '/api/birthdays' })
router.use(async (ctx, next) => {
  if (!canOperate(ctx.user) || !Number.isInteger(ctx.user.roomId)) ctx.throw(403)
  if (!ctx.user.isAdmin && (!['GET', 'HEAD'].includes(ctx.method) || !/\/assets\/[\w-]+\/?$/.test(ctx.path))) ctx.throw(403)
  ctx.set('Cache-Control', 'private, no-store')
  try {
    await next()
  } catch (error) {
    ctx.throw((error as { status?: number }).status ?? 422, (error as Error).message)
  }
})
router.get('/', (ctx) => {
  ctx.body = { settings: settings(ctx.user.roomId), events: rows(ctx.user.roomId).map(eventDTO),
    assets: db.all<AssetRow>('SELECT * FROM birthdayAssets WHERE roomId=? AND kind!=\'greeting\'', [ctx.user.roomId]).map(assetDTO),
    configured: { text: !!process.env.KES_GEMINI_API_KEY, voice: settings(ctx.user.roomId).speechProvider === 'gemini' ? !!process.env.KES_GEMINI_API_KEY : !!process.env.KES_ELEVENLABS_API_KEY } }
})
router.put('/settings', (ctx) => {
  ctx.body = saveSettings(ctx.user.roomId, ctx.request.body)
})
router.post('/voices', async (ctx) => {
  const input = ctx.request.body as { provider?: string, model?: string, language?: string }
  const config = settings(ctx.user.roomId)
  const provider = input?.provider ?? config.speechProvider
  if (provider !== 'gemini' && provider !== 'elevenlabs') ctx.throw(422, 'Seleccione un proveedor de voz válido.')
  const model = input?.model ?? config.speechModel ?? 'gemini-3.8-flash-tts'
  if (!/^[\w.-]{1,100}$/.test(model)) ctx.throw(422, 'Modelo inválido.')
  ctx.body = provider === 'gemini' ? await listBirthdayVoices(model, input?.language) : await getProduction().check('elevenlabs', 'voice')
})
router.post('/audition', async (ctx) => {
  assertRoom(ctx.user.roomId)
  const input = ctx.request.body as unknown as { config: BirthdaySettings, voiceId?: string, style?: string }
  const config = validateBirthdaySettings(input?.config)
  const selected = { ...config, defaultVoiceId: input.voiceId ?? config.defaultVoiceId, speechStyle: input.style ?? config.speechStyle }
  validateBirthdaySettings(selected)
  ctx.body = assetDTO(await birthdayService().audition(ctx.user.roomId, speechProfile(selected)))
})
router.post('/events', (ctx) => {
  const input = ctx.request.body as unknown as BirthdayInput & { requestId: string }
  ctx.body = eventDTO(createBirthday(ctx.user.roomId, input?.requestId, input))
  void birthdayService().drain()
})
router.post('/events/:id', (ctx) => {
  const input = ctx.request.body as unknown as { revision: number, operation: string, input?: BirthdayInput }
  ctx.body = eventDTO(changeBirthday(ctx.user.roomId, ctx.params.id, input?.revision, input?.operation, input?.input))
  birthdayService().publish(ctx.user.roomId)
  void birthdayService().drain()
})
router.post('/intro', async (ctx) => {
  assertRoom(ctx.user.roomId)
  const voiceId = settings(ctx.user.roomId).defaultVoiceId
  if (!voiceId) ctx.throw(422, 'Guarde primero la voz predeterminada.')
  ctx.body = assetDTO(await birthdayService().intro(ctx.user.roomId, voiceId))
})
router.post('/video', async (ctx) => {
  assertRoom(ctx.user.roomId)
  const input = ctx.request.body as { id?: string }
  if (typeof input?.id !== 'string') ctx.throw(422, 'Seleccione un video.')
  ctx.body = assetDTO(await birthdayService().copyVideo(ctx.user.roomId, input.id))
})
router.post('/upload', async (ctx) => {
  const request = ctx.request as unknown as { body: { kind: string }, files?: Record<string, { filepath: string, originalFilename: string, size: number } | { filepath: string, originalFilename: string, size: number }[]> }
  const files = Object.values(request.files ?? {}).flat()
  try {
    assertRoom(ctx.user.roomId)
    if (!['intro', 'music'].includes(request.body?.kind) || files.length !== 1 || files[0].size > 20 * 1024 * 1024) ctx.throw(422, 'Seleccione un audio de hasta 20 MB.')
    ctx.body = assetDTO(await birthdayService().upload(ctx.user.roomId, request.body.kind as 'intro' | 'music', files[0].originalFilename || 'Audio de cumpleaños', await fs.readFile(files[0].filepath)))
  } finally { await Promise.all(files.map(file => fs.rm(file.filepath, { force: true }))) }
})
router.get('/assets/:id', async (ctx) => {
  const row = asset(ctx.user.roomId, ctx.params.id)
  if (!row) ctx.throw(404)
  const file = path.join(birthdayService().directory, row.filename)
  const info = await fs.stat(file)
  ctx.type = row.kind === 'video' ? 'video/mp4' : 'audio/mpeg'
  ctx.length = info.size
  ctx.body = createReadStream(file)
})
export default router

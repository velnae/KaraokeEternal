import Router from '@koa/router'
import { canOperate } from '../../shared/permissions.js'
import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { db } from '../lib/Database.js'
import { createElevenLabs, createGemini } from '../AudioProviders/index.js'
import { elevenLabsConfig } from '../AudioProviders/config.js'
import { validateBirthdaySettings, type BirthdayInput, type BirthdaySettings, type BirthdaySceneInput } from '../../shared/birthdays.js'
import { changeScene } from './scenes.js'
import { listBirthdayVoices } from './gemini.js'
import { readPersonalization, speechProfile } from './personalization.js'
import { readPreview, recordPreviewSample, savePreviewDraft } from './preview.js'
import { validateBirthdaySample } from '../../shared/birthdayPreview.js'
import { birthdayHistory, birthdayHistoryDetail } from './history.js'
import { birthdayService } from './Service.js'
import { importBirthdayAsset, type BirthdayImport } from './import.js'
import { assertRoom, asset, assetDTO, changeBirthday, createBirthday, eventDTO, getBirthday, queueEventDTO, rows, saveSettings, settings, type AssetRow, type BirthdayRow } from './Store.js'

const router = new Router({ prefix: '/api/birthdays' })
router.use(async (ctx, next) => {
  if (!canOperate(ctx.user) || !Number.isInteger(ctx.user.roomId)) ctx.throw(403)
  ctx.set('Cache-Control', 'private, no-store')
  try {
    await next()
  } catch (error) {
    ctx.throw((error as { status?: number }).status ?? 422, (error as Error).message)
  }
})
router.get('/queue', (ctx) => {
  const events = db.all<BirthdayRow>(`SELECT * FROM birthdays WHERE roomId=? AND playback IN ('held','interrupted','scheduled','playing') ORDER BY createdAt DESC,id`, [ctx.user.roomId])
  ctx.body = { events: events.map(queueEventDTO) }
})
router.post('/events', (ctx) => {
  const input = ctx.request.body as unknown as BirthdayInput & { requestId: string }
  if (!ctx.user.isAdmin && (input?.profileId || (input?.approach && input.approach !== 'auto'))) ctx.throw(403)
  const row = createBirthday(ctx.user.roomId, input?.requestId, input)
  ctx.body = ctx.user.isAdmin ? eventDTO(row) : queueEventDTO(row)
  void birthdayService().drain()
})
router.post('/events/:id', (ctx) => {
  const input = ctx.request.body as unknown as { revision: number, operation: string, input?: BirthdayInput }
  let changes = input?.input
  if (!ctx.user.isAdmin) {
    if (!['edit', 'schedule', 'unschedule', 'retry'].includes(input?.operation)) ctx.throw(403)
    const current = getBirthday(ctx.user.roomId, ctx.params.id)
    if (input.operation === 'retry' && current.preparation !== 'failed') ctx.throw(409, 'Solo se pueden reintentar preparaciones fallidas.')
    if (input.operation === 'schedule' && current.preparation !== 'ready') ctx.throw(409, 'Espere a que termine la preparación.')
    if (input.operation === 'edit') {
      if (!changes) ctx.throw(422, 'Ingrese los datos del cumpleaños.')
      if (changes.profileId || (changes.approach && changes.approach !== 'auto')) ctx.throw(403)
      const previous = readPersonalization(current)
      changes = { ...changes, approach: previous?.approachOverride ?? 'auto', profileId: previous?.profileOverride ?? '' }
    } else if (changes !== undefined) ctx.throw(422, 'Operación de cumpleaños no válida.')
  }
  const row = changeBirthday(ctx.user.roomId, ctx.params.id, input?.revision, input?.operation, changes)
  ctx.body = ctx.user.isAdmin ? eventDTO(row) : queueEventDTO(row)
  birthdayService().publish(ctx.user.roomId)
  void birthdayService().drain()
})
router.use(async (ctx, next) => {
  if (!ctx.user.isAdmin && (!['GET', 'HEAD'].includes(ctx.method) || !/\/assets\/[\w-]+\/?$/.test(ctx.path))) ctx.throw(403)
  await next()
})
router.get('/', (ctx) => {
  ctx.body = { settings: settings(ctx.user.roomId), events: rows(ctx.user.roomId).map(eventDTO),
    assets: db.all<AssetRow>('SELECT * FROM birthdayAssets WHERE roomId=? AND kind!=\'greeting\'', [ctx.user.roomId]).map(assetDTO),
    configured: { text: createGemini().configured, voice: settings(ctx.user.roomId).speechProvider === 'gemini' ? createGemini().configured : createElevenLabs().capabilities.configured } }
})
async function resolveBirthdayVoices (config: BirthdaySettings) {
  if (config.speechProvider !== 'gemini') return config
  const provider = createGemini()
  const voices = new Map<string, string>()
  for (const name of new Set([config.defaultVoiceId, ...config.rules.map(rule => rule.voiceId)])) voices.set(name, (await provider.resolveVoice(name)).voiceId)
  return { ...config, defaultVoiceId: voices.get(config.defaultVoiceId)!, rules: config.rules.map(rule => ({ ...rule, voiceId: voices.get(rule.voiceId)! })) }
}
router.put('/settings', async (ctx) => {
  const config = validateBirthdaySettings(ctx.request.body)
  ctx.body = saveSettings(ctx.user.roomId, await resolveBirthdayVoices(config))
})
router.get('/history', (ctx) => {
  ctx.body = birthdayHistory(ctx.user.roomId, ctx.query)
})
router.get('/history/:id', (ctx) => {
  ctx.body = birthdayHistoryDetail(ctx.user.roomId, ctx.params.id)
})
router.post('/voices', async (ctx) => {
  const input = ctx.request.body as { provider?: string, model?: string, language?: string }
  const config = settings(ctx.user.roomId)
  const provider = input?.provider ?? config.speechProvider
  if (provider !== 'gemini' && provider !== 'elevenlabs') ctx.throw(422, 'Seleccione un proveedor de voz válido.')
  const model = input?.model ?? config.speechModel ?? 'gemini-3.8-flash-tts'
  if (!/^[\w.-]{1,100}$/.test(model)) ctx.throw(422, 'Modelo inválido.')
  ctx.body = provider === 'gemini' ? await listBirthdayVoices(model, input?.language) : await createElevenLabs().check(elevenLabsConfig().model, 'voice')
})
router.post('/audition', async (ctx) => {
  assertRoom(ctx.user.roomId)
  const input = ctx.request.body as unknown as { config: BirthdaySettings, voiceId?: string, style?: string, sample?: unknown, previewRevision?: number, previewScript?: string, previewRoomId?: number }
  if (input.previewRoomId !== undefined && input.previewRoomId !== ctx.user.roomId) ctx.throw(409, 'La sala cambió. Vuelva a abrir la previsualización.')
  const preview = input.previewRevision === undefined ? undefined : db.get<{ revision: number, draftJSON: string }>('SELECT revision,draftJSON FROM birthdayPreviewDrafts WHERE userId=? AND roomId=?', [ctx.user.userId, ctx.user.roomId])
  if (input.previewRevision !== undefined && preview?.revision !== input.previewRevision) ctx.throw(409, 'La previsualización cambió. Recargue antes de generar.')
  const config = validateBirthdaySettings(input?.config)
  const selected = { ...config, defaultVoiceId: input.voiceId ?? config.defaultVoiceId, speechStyle: input.style ?? config.speechStyle }
  validateBirthdaySettings(selected)
  const resolved = await resolveBirthdayVoices(selected)
  const media = assetDTO(await birthdayService().audition(ctx.user.roomId, speechProfile(resolved), input.sample, resolved))
  ctx.body = input.sample === undefined
    ? media
    : recordPreviewSample(ctx.user.userId, ctx.user.roomId, selected, {
        ...validateBirthdaySample(input.sample), script: input.previewScript ?? (input.sample as { script?: string }).script ?? '',
      }, media, input.previewRevision, preview && JSON.parse(preview.draftJSON))
})
router.get('/preview/:roomId', async (ctx) => {
  if (Number(ctx.params.roomId) !== ctx.user.roomId) ctx.throw(409, 'La sala cambió. Vuelva a abrir la previsualización.')
  ctx.body = await readPreview(birthdayService().directory, ctx.user.userId, ctx.user.roomId)
})
router.put('/preview/:roomId', (ctx) => {
  if (Number(ctx.params.roomId) !== ctx.user.roomId) ctx.throw(409, 'La sala cambió. Vuelva a abrir la previsualización.')
  const input = ctx.request.body as { draft?: unknown, revision?: number }
  ctx.body = savePreviewDraft(ctx.user.userId, ctx.user.roomId, input?.draft, input?.revision as number)
})
router.put('/events/:id/scene', (ctx) => {
  assertRoom(ctx.user.roomId)
  changeScene(getBirthday(ctx.user.roomId, ctx.params.id), ctx.request.body as unknown as BirthdaySceneInput)
  ctx.body = eventDTO(getBirthday(ctx.user.roomId, ctx.params.id))
  birthdayService().publish(ctx.user.roomId)
})
router.post('/intro', async (ctx) => {
  assertRoom(ctx.user.roomId)
  const voiceId = settings(ctx.user.roomId).defaultVoiceId
  if (!voiceId) ctx.throw(422, 'Guarde primero la voz predeterminada.')
  const input = ctx.request.body as { text?: string, title?: string } | undefined
  ctx.body = assetDTO(await birthdayService().intro(ctx.user.roomId, voiceId, input?.text, input?.title))
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
    if (!['intro', 'music', 'bed', 'applause'].includes(request.body?.kind) || files.length !== 1 || files[0].size > 20 * 1024 * 1024) ctx.throw(422, 'Seleccione un audio de hasta 20 MB.')
    ctx.body = assetDTO(await birthdayService().upload(ctx.user.roomId, request.body.kind as 'intro' | 'music' | 'bed' | 'applause', files[0].originalFilename || 'Audio de cumpleaños', await fs.readFile(files[0].filepath)))
  } finally { await Promise.all(files.map(file => fs.rm(file.filepath, { force: true }))) }
})
router.post('/video/upload', async (ctx) => {
  const request = ctx.request as unknown as { files?: Record<string, { filepath: string, originalFilename: string, size: number } | { filepath: string, originalFilename: string, size: number }[]> }
  const files = Object.values(request.files ?? {}).flat()
  try {
    assertRoom(ctx.user.roomId)
    if (files.length !== 1 || files[0].size > 40 * 1024 * 1024) ctx.throw(422, 'Seleccione un video MP4 de hasta 40 MiB y 2 min 10 s.')
    ctx.body = assetDTO(await birthdayService().uploadVideo(ctx.user.roomId, files[0].originalFilename || 'Fondo de cumpleaños', files[0].filepath))
  } finally { await Promise.all(files.map(file => fs.rm(file.filepath, { force: true }))) }
})
router.post('/import', async (ctx) => {
  const request = ctx.request as unknown as { body: { metadata?: string }, files?: Record<string, { filepath: string } | { filepath: string }[]> }
  const files = Object.values(request.files ?? {}).flat()
  try {
    if (files.length !== 1) ctx.throw(422, 'Seleccione un recurso para importar.')
    const metadata = JSON.parse(request.body?.metadata ?? 'null') as BirthdayImport
    ctx.body = await importBirthdayAsset(birthdayService().directory, ctx.user.roomId, metadata, await fs.readFile(files[0].filepath))
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

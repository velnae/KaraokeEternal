import Router from '@koa/router'
import { createElevenLabs, createGemini } from './index.js'
import { getProduction } from '../Animation/Production.js'
import { getGreetingVoice } from '../Greetings/GreetingVoice.js'
import { getNameVoiceStyle } from '../Animation/Calls/nameStyle.js'
import { settings } from '../Birthdays/Store.js'
import { listBirthdayVoices } from '../Birthdays/gemini.js'
import { speechProfile } from '../Birthdays/personalization.js'
import type { ManagedAudioProvider, ProviderUse } from '../../shared/audioProviders.js'
import type { AudioKind } from '../../shared/animation.js'
import { getCallVoice } from '../Animation/Calls/CallVoice.js'

const router = new Router({ prefix: '/api/audio-providers' })
router.use(async (ctx, next) => {
  if (!ctx.user?.isAdmin) ctx.throw(403)
  ctx.set('Cache-Control', 'private, no-store')
  try {
    await next()
  } catch (error) { ctx.throw((error as { status?: number }).status ?? 422, (error as Error).message) }
})

const models = (roomId: number | null) => {
  const voice = getGreetingVoice()
  const birthday = Number.isInteger(roomId) ? settings(roomId!) : null
  return {
    'catalog': getProduction().capabilities().providers.find(provider => provider.id === 'elevenlabs')?.models.voice ?? '',
    'greetings': voice.config().model,
    'calls': getCallVoice().config().model,
    'names': getNameVoiceStyle(getCallVoice().profile()).model,
    'birthdays': birthday ? speechProfile(birthday).model : '',
    'birthday-text': birthday?.textModel ?? '',
  }
}

router.get('/', (ctx) => {
  const current = models(ctx.user.roomId)
  const eleven = createElevenLabs().capabilities
  const birthdayProvider = Number.isInteger(ctx.user.roomId) ? speechProfile(settings(ctx.user.roomId)).provider : null
  const providers: ManagedAudioProvider[] = [
    { id: 'elevenlabs', name: 'ElevenLabs', configured: eleven.configured,
      checks: [{ use: 'catalog', model: current.catalog }, ...(birthdayProvider === 'elevenlabs' ? [{ use: 'birthdays' as const, model: current.birthdays }] : [])],
      catalog: { voiceId: eleven.defaultVoiceId, models: eleven.models } },
    { id: 'gemini', name: 'Gemini', configured: createGemini().configured,
      checks: [{ use: 'greetings', model: current.greetings }, { use: 'calls', model: current.calls }, { use: 'names', model: current.names },
        ...(birthdayProvider === 'gemini' ? [{ use: 'birthdays' as const, model: current.birthdays }] : []),
        ...(current['birthday-text'] ? [{ use: 'birthday-text' as const, model: current['birthday-text'] }] : [])] },
  ]
  ctx.body = { providers }
})

router.get('/call-voice', (ctx) => {
  ctx.body = getCallVoice().config()
})
router.put('/call-voice', (ctx) => {
  ctx.body = getCallVoice().configure(ctx.request.body)
})

function selection (ctx, value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) ctx.throw(422, 'Consulta no válida.')
  const input = value as { use?: string, model?: string, kind?: string }
  const provider = ctx.params.providerId
  if (!['gemini', 'elevenlabs'].includes(provider)) ctx.throw(422, 'Proveedor no válido.')
  const use = input.use as ProviderUse
  if (!(provider === 'elevenlabs' ? ['catalog', 'birthdays'] : ['greetings', 'calls', 'names', 'birthdays', 'birthday-text']).includes(use)) ctx.throw(422, 'Uso no compatible con el proveedor.')
  if (['catalog', 'birthdays', 'birthday-text'].includes(use) && !Number.isInteger(ctx.user.roomId)) ctx.throw(422, 'Ingrese a una sala para gestionar esta configuración.')
  const kind = input.kind ?? 'voice'
  if (!['voice', 'effect', 'ambience'].includes(kind) || (use !== 'catalog' && kind !== 'voice')) ctx.throw(422, 'Tipo de audio no compatible.')
  const configuredModel = use === 'catalog'
    ? getProduction().capabilities().providers.find(provider => provider.id === 'elevenlabs')?.models[kind]
    : models(ctx.user.roomId)[use]
  if (use === 'catalog' && input.model !== undefined && input.model !== configuredModel) ctx.throw(422, 'El modelo del catálogo cambió. Recargue los ajustes.')
  const model = use === 'catalog' ? configuredModel : input.model ?? configuredModel
  if (typeof model !== 'string' || !/^[\w.-]{1,100}$/.test(model)) ctx.throw(422, 'Modelo no válido.')
  return { provider, use, model, kind: kind as AudioKind }
}

router.post('/:providerId/check', async (ctx) => {
  const selected = selection(ctx, ctx.request.body ?? {})
  if (selected.use === 'catalog') {
    await getProduction().check(selected.provider, selected.kind)
  } else if (selected.use === 'greetings' && selected.model === getGreetingVoice().config().model) {
    await getGreetingVoice().check()
  } else if (selected.provider === 'gemini') await createGemini().check(selected.model)
  else await createElevenLabs().check(selected.model)
  ctx.body = { use: selected.use, model: selected.model }
})

router.get('/:providerId/voices', async (ctx) => {
  const selected = selection(ctx, ctx.query)
  if (selected.use === 'birthday-text') ctx.throw(422, 'El modelo de texto no tiene voces.')
  const language = ctx.query.language
  const search = ctx.query.search
  if ((language !== undefined && (typeof language !== 'string' || !['', 'es', 'es-PE', 'es-419'].includes(language)))
    || (search !== undefined && (typeof search !== 'string' || search.length > 100))) ctx.throw(422, 'Consulta de voces no válida.')
  const voices = selected.use === 'catalog'
    ? await getProduction().check(selected.provider, selected.kind)
    : selected.provider === 'elevenlabs'
      ? await createElevenLabs().check(selected.model)
      : selected.use === 'birthdays'
        ? await listBirthdayVoices(selected.model, language as string | undefined, search as string | undefined)
        : await createGemini().listVoices(selected.model, language as string | undefined, search as string | undefined)
  ctx.body = { voices }
})
export default router

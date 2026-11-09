import GeminiGreetingTts, { GreetingVoiceError } from '../Greetings/GeminiGreetingTts.js'
import type { BirthdaySpeech } from '../../shared/birthdays.js'

const base = () => process.env.KES_GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com'
// Inject the existing transport's fetch seam, preserving bounded WAV handling.
const request: typeof fetch = (url, options) => fetch(String(url).replace('https://generativelanguage.googleapis.com', base()), options)
export const geminiBirthdayTts = () => new GeminiGreetingTts(process.env.KES_GEMINI_API_KEY || '', request)

export async function listBirthdayVoices (model: string, language = 'es-419', search?: string) {
  if (!['es-PE', 'es-419', 'es', ''].includes(language)) throw new Error('Seleccione español de Perú o latinoamericano.')
  await geminiBirthdayTts().check(model)
  const voices: { voiceId: string, name: string }[] = []
  let page = ''
  for (let i = 0; i < 5; i++) {
    const query = new URLSearchParams({ ...(language ? { language_code: language } : {}), ...(search ? { search } : {}), page_size: '100', ...(page ? { page_token: page } : {}) })
    const response = await fetch(`${base()}/v1beta/voices?${query}`, { headers: { 'x-goog-api-key': process.env.KES_GEMINI_API_KEY || '' }, signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error('No se pudieron consultar las voces Gemini. Revise permisos e idioma.')
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Gemini no devolvió el catálogo de voces.')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.length
        if (size > 256000) throw new Error('El catálogo de voces supera el tamaño permitido.')
        chunks.push(part.value)
      }
    } finally { await reader.cancel().catch(() => {}) }
    const body = JSON.parse(Buffer.concat(chunks).toString())
    for (const voice of body.voices ?? []) if (typeof voice.id === 'string' && typeof voice.display_name === 'string') voices.push({ voiceId: voice.id, name: `${voice.display_name}${voice.accent ? ` · ${voice.accent}` : ''}` })
    page = body.next_page_token
    if (!page) break
  }
  return voices
}
export async function speakGeminiBirthday (text: string, profile: BirthdaySpeech, signal: AbortSignal) {
  const provider = geminiBirthdayTts()
  try {
    // A bounded world-wide listing can omit valid Spanish voices. Scope by the
    // regional ID or search a named voice instead of scanning the whole library.
    const region = /^es-(419|PE)-/i.exec(profile.voice)
    const language = region ? `es-${region[1].toUpperCase()}` : ''
    const voices = await listBirthdayVoices(profile.model, language, region ? undefined : profile.voice)
    const selected = voices.find(voice => voice.voiceId.toLowerCase() === profile.voice.toLowerCase())
    if (!selected) throw new Error('La voz seleccionada no está disponible en el catálogo Gemini. Consulte las voces antes de generar.')
    return await provider.generate(text, { ...profile, voice: selected.voiceId, provider: 'gemini' }, signal)
  } catch (error) {
    if (error instanceof GreetingVoiceError) throw new Error(`No se pudo preparar la voz del cumpleaños (${error.kind}). Revise Gemini y reintente explícitamente.`)
    throw error
  }
}

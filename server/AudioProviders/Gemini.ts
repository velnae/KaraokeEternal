import type { SpeechProfile, SpeechProvider } from './types.js'
import { VoiceError as GreetingVoiceError } from './errors.js'

async function boundedJSON (response: Response, limit: number) {
  const reader = response.body?.getReader()
  if (!reader) throw new GreetingVoiceError('Gemini no devolvió audio.', 'uncertain')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > limit) throw new GreetingVoiceError('La respuesta de Gemini supera el tamaño permitido.', 'invalid')
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally { await reader.cancel().catch(() => {}) }
}

async function rejection (response: Response): Promise<GreetingVoiceError> {
  // Provider responses can echo credentials or private text. Only classify known
  // codes and quota metadata; never expose the original message to clients/logs.
  const body = await boundedJSON(response, 16384).catch(() => null)
  if ([401, 403].includes(response.status)) return new GreetingVoiceError('Revise la clave y los permisos de Gemini en el servidor.', 'auth')
  if (response.status === 402) return new GreetingVoiceError('El proyecto de Gemini no tiene saldo. Revise su facturación.', 'auth')
  if (response.status === 429) {
    const detail = JSON.stringify(body?.error?.details ?? []).toLowerCase()
    const code = String(body?.error?.code ?? body?.error?.status ?? '').toLowerCase()
    if (/per.?day|daily|quota_exceeded/.test(`${detail} ${code}`)) return new GreetingVoiceError('Se agotó la cuota diaria de Gemini. El saludo continúa en pantalla.', 'quota')
    const hint = response.headers.get('retry-after')
    const retrySeconds = (body?.error?.details ?? []).find((item: { retryDelay?: string }) => typeof item.retryDelay === 'string')?.retryDelay
    const delay = hint ? (/^\d+(\.\d+)?$/.test(hint) ? Number(hint) * 1000 : Date.parse(hint) - Date.now()) : Number.parseFloat(retrySeconds) * 1000
    const wait = Number.isFinite(delay) ? Math.max(1000, Math.min(delay, 86400000)) : 60000
    return new GreetingVoiceError('Gemini limitó las solicitudes. La preparación esperará antes de reintentar.', 'rate', Date.now() + wait)
  }
  if (response.status >= 500) return new GreetingVoiceError('Gemini no confirmó la generación. No se repetirá automáticamente.', 'uncertain')
  return new GreetingVoiceError('Gemini rechazó el saludo. Revise el modelo, la voz y el texto.', 'invalid')
}

export default class Gemini implements SpeechProvider {
  constructor (private key: string, private request: typeof fetch = fetch, private timeoutMs = 60000, private base = 'https://generativelanguage.googleapis.com') {}
  get configured () { return !!this.key }

  async check (model: string) {
    if (!this.configured) throw new GreetingVoiceError('Configure KES_GEMINI_API_KEY en el servidor.', 'auth', 0, false)
    try {
      const response = await this.request(`${this.base}/v1beta/models/${encodeURIComponent(model)}`, {
        headers: { 'x-goog-api-key': this.key }, signal: AbortSignal.timeout(10000),
      })
      if (!response.ok) throw await rejection(response)
      const body = await boundedJSON(response, 65536)
      if (body?.name !== `models/${model}` || !body.supportedGenerationMethods?.includes('generateContent')) {
        throw new GreetingVoiceError('El modelo no está disponible para generar saludos.', 'invalid', 0, false)
      }
    } catch (error) {
      if (error instanceof GreetingVoiceError) throw error
      throw new GreetingVoiceError('No se pudo comprobar Gemini. Revise la conexión del servidor.', 'invalid', 0, false)
    }
  }

  async generate (text: string, profile: SpeechProfile, signal: AbortSignal) {
    if (!this.configured) throw new GreetingVoiceError('Configure KES_GEMINI_API_KEY en el servidor.', 'auth', 0, false)
    signal.throwIfAborted()
    try {
      const response = await this.generateContent(profile.model, {
        contents: [{ role: 'user', parts: [{ text, speech_metadata: { style: profile.style } }] }],
        generationConfig: { responseModalities: ['AUDIO'], responseFormat: { audio: { mimeType: 'AUDIO_WAV', sampleRate: 24000 } },
          speechConfig: { voiceConfig: { voice: profile.voice } } },
      }, signal)
      if (!response.ok) throw await rejection(response)
      const body = await boundedJSON(response, 28 * 1024 * 1024)
      const data = body?.candidates?.[0]?.content?.parts?.find((part: { inlineData?: { data?: string } }) => part.inlineData?.data)?.inlineData.data
      if (typeof data !== 'string') throw new GreetingVoiceError('Gemini no entregó audio para este saludo. Se mostrará en pantalla.', 'invalid')
      const bytes = Buffer.from(data, 'base64')
      if (bytes.length <= 44 || bytes.length > 20 * 1024 * 1024 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
        throw new GreetingVoiceError('Gemini devolvió un audio inválido. El saludo continúa en pantalla.', 'invalid')
      }
      return bytes
    } catch (error) {
      if (error instanceof GreetingVoiceError) throw error
      throw new GreetingVoiceError('No se pudo confirmar la generación de Gemini. El saludo continúa en pantalla.', 'uncertain')
    }
  }

  async listVoices (model: string, language = '', search?: string) {
    await this.check(model)
    const voices: { voiceId: string, name: string }[] = []
    let page = ''
    for (let i = 0; i < 5; i++) {
      const query = new URLSearchParams({ ...(language ? { language_code: language } : {}), ...(search ? { search } : {}), page_size: '100', ...(page ? { page_token: page } : {}) })
      const response = await this.request(`${this.base}/v1beta/voices?${query}`, { headers: { 'x-goog-api-key': this.key }, signal: AbortSignal.timeout(10000) })
      if (!response.ok) throw new GreetingVoiceError('No se pudieron consultar las voces Gemini. Revise permisos e idioma.', 'invalid', 0, false)
      const body = await boundedJSON(response, 256000)
      for (const voice of body.voices ?? []) if (typeof voice.id === 'string' && typeof voice.display_name === 'string') voices.push({ voiceId: voice.id, name: `${voice.display_name}${voice.accent ? ` · ${voice.accent}` : ''}` })
      page = body.next_page_token
      if (!page) break
    }
    return voices
  }

  async generateText (model: string, input: Record<string, unknown>, signal: AbortSignal) {
    if (!this.configured) throw new GreetingVoiceError('Configure Gemini en el servidor para crear el saludo.', 'auth', 0, false)
    signal.throwIfAborted()
    try {
      const response = await this.generateContent(model, input, signal)
      if (!response.ok) throw await rejection(response)
      const body = await boundedJSON(response, 65536)
      return body.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? '').join('') ?? ''
    } catch (error) {
      if (error instanceof GreetingVoiceError) throw error
      throw new GreetingVoiceError('No se pudo confirmar la generación del texto. Revise Gemini y reintente explícitamente.', 'uncertain')
    }
  }

  private generateContent (model: string, input: Record<string, unknown>, signal: AbortSignal) {
    return this.request(`${this.base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.key },
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]), body: JSON.stringify(input),
    })
  }
}

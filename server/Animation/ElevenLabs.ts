import type { ProductionConfig } from '../../shared/catalogProduction.js'
import type { AudioProvider } from './AudioProvider.js'
import type { AudioKind } from '../../shared/animation.js'

export class ProviderError extends Error {
  constructor (message: string, public uncertain: boolean) { super(message) }
}

const rejectionMessages: Record<string, string> = {
  invalid_api_key: 'La clave de ElevenLabs no es válida. Revise la configuración del servidor.',
  missing_permissions: 'La clave no tiene los permisos necesarios para esta operación en ElevenLabs.',
  quota_exceeded: 'La cuenta de ElevenLabs no tiene saldo o cuota suficiente.',
  rate_limit_exceeded: 'ElevenLabs limitó las solicitudes. Espere antes de generar otra revisión.',
  too_many_concurrent_requests: 'La cuenta tiene demasiadas generaciones simultáneas.',
  voice_not_found: 'La voz seleccionada ya no está disponible. Verifique la conexión y elija otra voz.',
  model_not_found: 'El modelo configurado no está disponible para esta cuenta.',
  invalid_model_id: 'ElevenLabs no reconoce el modelo configurado.',
  invalid_stability: 'El modelo rechazó el ajuste de estabilidad del perfil de voz.',
  model_can_not_do_text_to_speech: 'El modelo configurado no admite este método de generación de voz.',
}

async function rejectionDetail (response: Response): Promise<string | undefined> {
  // Only surface known error codes, never provider messages that might echo
  // credentials or submitted content. Bound even unsuccessful response bodies.
  const reader = response.body?.getReader()
  if (!reader) return undefined
  try {
    const chunks: Uint8Array[] = []
    let remaining = 8192
    while (remaining > 0) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value.subarray(0, remaining))
      remaining -= value.length
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { detail?: { status?: string } }
    const code = body.detail?.status
    return typeof code === 'string' && Object.hasOwn(rejectionMessages, code) ? `${rejectionMessages[code]} (${code})` : undefined
  } catch {
    return undefined
  } finally {
    await reader.cancel().catch(() => {})
  }
}

export class ElevenLabs implements AudioProvider {
  constructor (private key: string, private base = 'https://api.elevenlabs.io', private voiceModel = 'eleven_v4') {}

  get capabilities () {
    return { id: 'elevenlabs', name: 'ElevenLabs', configured: !!this.key, kinds: ['voice', 'effect', 'ambience'] as AudioKind[], models: { voice: this.voiceModel, effect: 'eleven_text_to_sound_v2', ambience: 'eleven_text_to_sound_v2' }, styles: ['warm', 'cheerful', 'celebration'], languages: ['es'], loop: true }
  }

  async check (model: string, kind: AudioKind = 'voice') {
    const headers = { 'xi-api-key': this.key }
    if (kind !== 'voice') {
      const response = await fetch(`${this.base}/v1/models`, { headers, signal: AbortSignal.timeout(10000) })
      if (!response.ok) throw new ProviderError('No se pudo verificar la conexión con ElevenLabs.', false)
      return []
    }
    const responses = await Promise.all(['models', 'voices'].map(resource => fetch(`${this.base}/v1/${resource}`, { headers, signal: AbortSignal.timeout(10000) })))
    if (responses.some(response => !response.ok)) throw new ProviderError('No se pudo verificar la cuenta o sus permisos de ElevenLabs.', false)
    const models = await responses[0].json() as { model_id: string }[]
    const voices = await responses[1].json() as { voices: { voice_id: string, name: string }[] }
    if (!models.some(item => item.model_id === model)) throw new ProviderError('El modelo configurado no está disponible en esta cuenta.', false)
    return voices.voices.map(voice => ({ voiceId: voice.voice_id, name: voice.name }))
  }

  async generate (config: ProductionConfig, signal?: AbortSignal) {
    const voice = config.kind === 'voice'
    const endpoint = voice ? `text-to-speech/${encodeURIComponent(config.voiceId!)}` : 'sound-generation'
    const body = voice
      ? { text: config.spokenText, model_id: config.model, voice_settings: config.settings, language_code: 'es' }
      : { text: config.text, model_id: 'eleven_text_to_sound_v2', duration_seconds: config.durationSeconds, loop: config.kind === 'ambience' && config.loop !== false, prompt_influence: 0.3 }
    try {
      const response = await fetch(`${this.base}/v1/${endpoint}?output_format=mp3_44100_128`, {
        method: 'POST', headers: { 'xi-api-key': this.key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
      })
      if (!response.ok) {
        const detail = await rejectionDetail(response)
        const message = detail ?? (response.status === 429
          ? 'ElevenLabs no tiene cuota o capacidad disponible.'
          : [401, 403].includes(response.status)
              ? 'Revise la clave y los permisos de ElevenLabs.'
              : `ElevenLabs rechazó la generación (HTTP ${response.status}).`)
        throw new ProviderError(message, response.status >= 500)
      }
      if (!response.body) throw new ProviderError('ElevenLabs no devolvió audio.', true)
      const chunks: Uint8Array[] = []
      let size = 0
      for await (const chunk of response.body) {
        size += chunk.length
        if (size > 5 * 1024 * 1024) {
          throw new ProviderError('El archivo generado supera el límite permitido.', true)
        }
        chunks.push(chunk)
      }
      return { bytes: Buffer.concat(chunks), requestId: response.headers.get('request-id') }
    } catch (error) {
      if (error instanceof ProviderError) throw error
      throw new ProviderError('No se pudo confirmar la generación. No se repetirá automáticamente.', true)
    }
  }
}

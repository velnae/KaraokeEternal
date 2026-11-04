import { randomUUID } from 'node:crypto'
import { db } from '../lib/Database.js'
import Prefs from '../Prefs/Prefs.js'
import { defaultGreetingVoiceConfig, greetingVoiceModels, type GreetingVoiceConfig, type GreetingVoiceSnapshot } from '../../shared/greetingVoice.js'
import GeminiGreetingTts, { GreetingVoiceError, type GreetingVoiceProvider } from './GeminiGreetingTts.js'
import { greetingAudioKey, loadGreetingVoiceProfile, type GreetingVoiceProfile } from './voiceProfile.js'

export class GreetingVoiceSettingsError extends Error {
  constructor (message: string, readonly status = 422) { super(message) }
}

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' })
export function voiceQuotaDay (time: number) {
  const parts = Object.fromEntries(dayFormat.formatToParts(time).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
export function voiceQuotaReset (time: number) {
  const day = voiceQuotaDay(time)
  const winter = Date.parse(`${day}T08:00:00Z`) + 86400000
  return voiceQuotaDay(winter - 3600000) !== day ? winter - 3600000 : winter
}

/** One shared budget for every room and private preview on this server. */
export default class GreetingVoice {
  private working = false
  private checking = false
  private checkedAt: number | null = null
  constructor (private provider: GreetingVoiceProvider = new GeminiGreetingTts(), private now = Date.now) {}

  config (): GreetingVoiceConfig {
    return { ...defaultGreetingVoiceConfig, ...(Prefs.get() as { greetingVoice?: GreetingVoiceConfig }).greetingVoice }
  }

  profile () { return loadGreetingVoiceProfile(this.config()) }

  snapshot (): GreetingVoiceSnapshot {
    const config = this.config()
    const now = this.now()
    const minute = db.get<{ n: number, first: number }>('SELECT count(*) n,min(requestedAt) first FROM greetingVoiceRequests WHERE requestedAt>?', [now - 60000])!
    const day = db.get<{ n: number }>('SELECT count(*) n FROM greetingVoiceRequests WHERE day=?', [voiceQuotaDay(now)])!.n
    const block = db.get<{ blockedUntil: number, code: string, reason: string }>('SELECT * FROM greetingVoiceState WHERE id=1')!
    const resetsAt = voiceQuotaReset(now)
    const nextAt = Math.max(block.blockedUntil, minute.n >= config.requestsPerMinute ? minute.first + 60000 : 0, day >= config.requestsPerDay ? resetsAt : 0)
    let state: GreetingVoiceSnapshot['state'] = 'available'
    let message = 'La clave está configurada. Comprobar conexión no genera audio.'
    if (!this.provider.configured) {
      state = 'unconfigured'
      message = 'Configure KES_GEMINI_API_KEY en el servidor y reinícielo.'
    } else if (block.code === 'auth') {
      state = 'error'
      message = block.reason
    } else if (nextAt > now) {
      state = 'limited'
      message = block.blockedUntil > now ? block.reason : day >= config.requestsPerDay ? 'Se alcanzó el límite diario de esta instalación. Los nuevos saludos continúan en pantalla.' : 'Esperando el límite por minuto antes de generar otro saludo.'
    } else if (!config.enabled) {
      state = 'disabled'
      message = 'Puede probar la voz en privado. Active la generación para preparar nuevos saludos.'
    }
    if (this.checking) {
      state = 'checking'
      message = 'Comprobando la clave y el modelo, sin generar audio.'
    }
    if (this.working) {
      state = 'generating'
      message = 'Preparando una voz. La música y los saludos en pantalla continúan.'
    }
    return { config, configured: this.provider.configured, state, message, checkedAt: this.checkedAt, usage: { minute: minute.n, day, resetsAt, nextAt } }
  }

  configure (input: unknown) {
    const value = input as GreetingVoiceConfig | null
    const current = this.config()
    if (!value || Object.keys(value).some(key => !(key in defaultGreetingVoiceConfig))
      || typeof value.enabled !== 'boolean' || !greetingVoiceModels.includes(value.model)
      || typeof value.voice !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{1,63}$/.test(value.voice)
      || typeof value.style !== 'string' || !value.style.trim() || value.style.length > 800
      || !Number.isSafeInteger(value.requestsPerMinute) || value.requestsPerMinute < 1 || value.requestsPerMinute > 1000
      || !Number.isSafeInteger(value.requestsPerDay) || value.requestsPerDay < 1 || value.requestsPerDay > 100000
      || !Number.isSafeInteger(value.revision)) throw new GreetingVoiceSettingsError('Revise el modelo, la voz, el estilo y los límites de generación.')
    if (value.revision !== current.revision) throw new GreetingVoiceSettingsError('Los ajustes cambiaron en otra sesión. Recargue antes de guardar.', 409)
    const config: GreetingVoiceConfig = { enabled: value.enabled, model: value.model, voice: value.voice, style: value.style.trim(),
      requestsPerMinute: value.requestsPerMinute, requestsPerDay: value.requestsPerDay, revision: current.revision + 1 }
    if (!Prefs.set('greetingVoice', config)) throw new Error('Could not persist greeting voice settings')
    return this.snapshot()
  }

  async check () {
    if (this.checking) throw new GreetingVoiceSettingsError('La comprobación ya está en curso.', 409)
    this.checking = true
    const model = this.config().model
    try {
      await this.provider.check(model)
      this.checkedAt = this.now()
      // A metadata check proves access, not that a generation quota has reset.
      if (model === this.config().model) db.run(`UPDATE greetingVoiceState SET code='',reason='',blockedUntil=0 WHERE id=1 AND code='auth'`)
    } finally { this.checking = false }
    return this.snapshot()
  }

  async generate (text: string, profile: GreetingVoiceProfile, signal: AbortSignal, preview = false) {
    signal.throwIfAborted()
    const state = this.snapshot()
    const now = this.now()
    if ((!state.config.enabled && !preview) || !state.configured) throw new GreetingVoiceError(state.message, 'disabled', 0, false)
    const block = db.get<{ code: string, reason: string }>('SELECT code,reason FROM greetingVoiceState WHERE id=1')!
    if (block.code === 'auth') throw new GreetingVoiceError(block.reason, 'auth', 0, false)
    if (this.working) throw new GreetingVoiceError('Hay otra generación en curso.', 'busy', now + 500, false)
    if (state.usage.nextAt > now) throw new GreetingVoiceError(state.message, state.usage.nextAt >= state.usage.resetsAt ? 'quota' : 'rate', state.usage.nextAt, false)
    if (greetingAudioKey(0, text, profile) !== greetingAudioKey(0, text, this.profile())) throw new GreetingVoiceError('El perfil de voz cambió.', 'disabled', 0, false)
    this.working = true
    try {
      // Reserve before sending. Interrupted/failed requests conservatively consume
      // this installation's budget; these counters are not Google's quota balance.
      db.run('INSERT INTO greetingVoiceRequests(requestId,requestedAt,day) VALUES(?,?,?)', [randomUUID(), now, voiceQuotaDay(now)])
      db.run('DELETE FROM greetingVoiceRequests WHERE requestedAt<?', [now - 32 * 86400000])
      return await this.provider.generate(text, profile, signal)
    } catch (error) {
      if (error instanceof GreetingVoiceError && ['auth', 'quota', 'rate'].includes(error.kind)) {
        const until = error.kind === 'quota' ? voiceQuotaReset(this.now()) : error.retryAt
        db.run('UPDATE greetingVoiceState SET blockedUntil=?,code=?,reason=? WHERE id=1', [until, error.kind, error.message])
      }
      throw error
    } finally { this.working = false }
  }
}

let instance: GreetingVoice | undefined
export const getGreetingVoice = () => (instance ??= new GreetingVoice())

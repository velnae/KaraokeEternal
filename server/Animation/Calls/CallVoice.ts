import Prefs from '../../Prefs/Prefs.js'
import { db } from '../../lib/Database.js'
import { getGreetingVoice, GreetingVoiceSettingsError } from '../../Greetings/GreetingVoice.js'
import type GreetingVoice from '../../Greetings/GreetingVoice.js'
import { loadGreetingVoiceProfile } from '../../Greetings/voiceProfile.js'
import { greetingVoiceModels } from '../../../shared/greetingVoice.js'
import type { CallVoiceConfig } from '../../../shared/callVoice.js'

export class CallVoice {
  constructor (private voice: GreetingVoice = getGreetingVoice()) { this.config() }

  config (): CallVoiceConfig {
    const saved = db.get<{ data: string }>('SELECT data FROM prefs WHERE key=?', ['callVoice'])
    if (saved) return JSON.parse(saved.data)
    const current = this.voice.config()
    const config: CallVoiceConfig = { model: current.model, voice: current.voice, style: current.style, revision: 0 }
    if (!Prefs.set('callVoice', config)) throw new Error('Could not initialize call voice settings')
    return config
  }

  profile () { return loadGreetingVoiceProfile({ ...this.voice.config(), ...this.config() }) }
  snapshot () {
    const snapshot = this.voice.snapshot()
    return { ...snapshot, config: { ...snapshot.config, ...this.config() } }
  }

  configure (input: unknown) {
    const value = input as CallVoiceConfig | null
    if (!value || Object.keys(value).some(key => !['model', 'voice', 'style', 'revision'].includes(key))
      || !greetingVoiceModels.includes(value.model) || typeof value.voice !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{1,63}$/.test(value.voice)
      || typeof value.style !== 'string' || !value.style.trim() || value.style.length > 800 || !Number.isSafeInteger(value.revision)) throw new GreetingVoiceSettingsError('Revise el modelo, la voz y el estilo de llamados.')
    if (value.revision !== this.config().revision) throw new GreetingVoiceSettingsError('Los ajustes cambiaron en otra sesión. Recargue antes de guardar.', 409)
    const config = { ...value, style: value.style.trim(), revision: value.revision + 1 }
    if (!Prefs.set('callVoice', config)) throw new Error('Could not persist call voice settings')
    return config
  }

  generate (...args: Parameters<GreetingVoice['generate']>) {
    // Call jobs have already captured a trusted server-side profile. Defaults
    // may change while they wait; the shared gate still accounts every attempt.
    const [text, profile, signal, preview, purpose, nameStyle, nameModel] = args
    return this.voice.generate(text, profile, signal, preview, purpose, nameStyle, nameModel, 'calls')
  }
}

let instance: CallVoice | undefined
export const getCallVoice = () => (instance ??= new CallVoice())

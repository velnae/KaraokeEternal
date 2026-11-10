import { db } from '../../lib/Database.js'
import Prefs from '../../Prefs/Prefs.js'
import { nameVoiceModels, validateNameVoiceStyle, type NameVoiceStyleSettings } from '../../../shared/nameVoices.js'
import { callSpeechProfile, type GreetingVoiceProfile } from '../../Greetings/voiceProfile.js'
import { NameVoiceError } from './NameBank.js'

export function getNameVoiceStyle (profile: GreetingVoiceProfile): NameVoiceStyleSettings {
  const defaultStyle = callSpeechProfile(profile, 'name').style
  const saved = db.get<{ data: string }>('SELECT data FROM prefs WHERE key=?', ['nameVoiceStyle'])
  const config = saved ? validateNameVoiceStyle(JSON.parse(saved.data)) : { style: defaultStyle, revision: 0 }
  const model = config.model ?? nameVoiceModels.find(model => model === profile.model) ?? nameVoiceModels[0]
  return { ...config, model, defaultStyle }
}

export function saveNameVoiceStyle (input: unknown, profile: GreetingVoiceProfile): NameVoiceStyleSettings {
  const value = validateNameVoiceStyle(input)
  const current = getNameVoiceStyle(profile)
  if (value.revision !== current.revision) throw new NameVoiceError('La configuración cambió en otra sesión. Recargue sus datos antes de guardar.', 409)
  const model = value.model ?? current.model
  if (current.revision > 0 && value.style === current.style && model === current.model) return current
  if (!Prefs.set('nameVoiceStyle', { style: value.style, model, revision: current.revision + 1 })) throw new NameVoiceError('No se pudo guardar el estilo. Vuelva a intentarlo.', 500)
  return getNameVoiceStyle(profile)
}

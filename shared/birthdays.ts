import { hasInvisibleCharacters, hasOffensiveText } from './textModeration.js'

export const BIRTHDAY_SYNC = 'server/BIRTHDAY_SYNC'
export const BIRTHDAY_PLAYER = 'server/BIRTHDAY_PLAYER'
export const BIRTHDAY_STATE = 'birthday/STATE'
export const birthdayIntroText = 'Hoy celebramos un cumpleaños muy especial. Gracias por compartir este momento con nosotros. Tenemos un presente para ti de parte de la casa; esperamos que te guste. Y ahora, un saludo preparado especialmente para ti.'
export const birthdayLimits = { script: 1500, voiceMs: 60000, introMs: 60000, musicMs: 300000 }
export type BirthdaySex = 'female' | 'male' | 'unspecified'
export type BirthdayApproach = 'musical' | 'emotional' | 'humor'
export const birthdayApproaches: BirthdayApproach[] = ['musical', 'emotional', 'humor']
export const approachLabels = { musical: 'Musical', emotional: 'Emotivo', humor: 'Humor ligero' }
export interface BirthdayInput { name: string, sex: BirthdaySex, birthYear: number, dedication?: string, approach?: BirthdayApproach | 'auto', profileId?: string }
export interface BirthdayVoiceRule {
  sex: BirthdaySex | 'any'
  minAge: number
  maxAge: number
  voiceId: string
  id?: string
  title?: string
  writing?: string
  style?: string
  approaches?: BirthdayApproach[]
  history?: boolean
  videoId?: string | null
}
export interface BirthdaySpeech { provider: 'gemini' | 'elevenlabs', model: string, voice: string, style: string, processingRevision: number }
export interface BirthdayReference { id: string, fromYear: number, toYear: number, phrase: string, source: string, version: number }
export interface BirthdayPersonalization {
  version: number
  dedication: string
  approach: BirthdayApproach
  profile: BirthdayVoiceRule
  profileOverride: string
  approachOverride: BirthdayApproach | 'auto'
  reference: BirthdayReference | null
  recentOpenings: string[]
  speech: BirthdaySpeech
}
export interface BirthdaySettings {
  revision: number
  textModel: string
  targetSeconds: number
  maxVoiceSeconds: number
  defaultVoiceId: string
  rules: BirthdayVoiceRule[]
  introId: string | null
  musicId: string | null
  videoId: string | null
  speechProvider?: 'gemini' | 'elevenlabs'
  speechModel?: string
  speechStyle?: string
  historyEvery?: number
  introIds?: string[]
}
export const defaultBirthdaySettings: BirthdaySettings = {
  revision: 0, textModel: 'gemini-3.8-flash', targetSeconds: 25, maxVoiceSeconds: 60, defaultVoiceId: '', rules: [], introId: null, musicId: null, videoId: null,
  speechProvider: 'gemini', speechModel: 'gemini-3.8-flash-tts', speechStyle: 'Voz cálida y alegre, ritmo moderado, pronunciación clara, sin gritar.', historyEvery: 4,
}
export type BirthdayPreparation = 'queued' | 'writing' | 'voicing' | 'preparing' | 'ready' | 'failed'
export type BirthdayPlayback = 'held' | 'scheduled' | 'playing' | 'completed' | 'cancelled' | 'interrupted'
export type BirthdayPhase = 'intro' | 'greeting' | 'music'
export interface BirthdayAsset { id: string, kind: 'intro' | 'music' | 'greeting' | 'video', title: string, durationMs: number, url: string, checksum: string, script?: string | null }
export interface BirthdaySceneSelection {
  dayKey: string
  automaticIntroId: string
  automaticVideoId: string
  defaultVideoId?: string | null
  introMode: 'auto' | 'manual'
  videoMode: 'auto' | 'manual'
}
export interface BirthdaySceneInput { revision: number, introId?: string, videoId?: string, automatic?: boolean }
export const birthdayPhases: BirthdayPhase[] = ['intro', 'greeting', 'music']
export function birthdaySequence (assets: BirthdayAsset[]): BirthdayAsset[] {
  return birthdayPhases.map((phase) => {
    const asset = assets.find(item => item.kind === phase)
    if (!asset) throw new Error('Falta un audio de la celebración.')
    return asset
  })
}
export interface PublicBirthday {
  id: string
  name: string
  playback: BirthdayPlayback
  preparation: BirthdayPreparation
  phase: BirthdayPhase | null
  durationMs: number
  startedAt: number | null
}
export interface BirthdayEvent extends PublicBirthday, BirthdayInput {
  revision: number
  celebrationYear: number
  script: string | null
  voiceId: string
  error: string | null
  assets: BirthdayAsset[]
  personalization?: BirthdayPersonalization | null
  scene?: BirthdaySceneSelection | null
}
export interface BirthdaySnapshot { roomId: number, events: PublicBirthday[] }
export interface BirthdayOverview { settings: BirthdaySettings, events: BirthdayEvent[], assets: BirthdayAsset[], configured: { text: boolean, voice: boolean } }
export interface BirthdayGrant { event: PublicBirthday, assets: BirthdayAsset[], token: string, remainingMs: number }

export const celebrationYear = (now = new Date()) => Number(new Intl.DateTimeFormat('en', { timeZone: 'America/Lima', year: 'numeric' }).format(now))
export function validateBirthdayInput (value: unknown, year = celebrationYear()): BirthdayInput {
  const input = value as BirthdayInput | null
  const name = typeof input?.name === 'string' ? input.name.normalize('NFC').trim().replace(/ +/g, ' ') : ''
  if (!name || [...name].length > 60 || !new RegExp('^[\\p{L}\\p{M} \'’.-]+$', 'u').test(name) || hasInvisibleCharacters(name) || hasOffensiveText(name)) throw new Error('Ingrese un nombre válido de hasta 60 caracteres.')
  if (!input || !['female', 'male', 'unspecified'].includes(input.sex)) throw new Error('Seleccione el sexo.')
  if (!Number.isInteger(input.birthYear) || input.birthYear > year || input.birthYear < year - 120) throw new Error(`Ingrese un año de nacimiento entre ${year - 120} y ${year}.`)
  const dedication = typeof input.dedication === 'string' ? input.dedication.normalize('NFC').trim().replace(/\s+/g, ' ') : ''
  if (dedication.length > 160 || /[<>[\]]/.test(dedication) || hasInvisibleCharacters(dedication) || hasOffensiveText(dedication)) throw new Error('Use una dedicatoria de hasta 160 caracteres, sin instrucciones ni etiquetas.')
  // A dedication is public text, not a bypass for private demographic data.
  if (dedication) validateBirthdayScript(`${name}. ${dedication.replace(/\bmesa\s+\d{1,3}\b/gi, 'mesa')}`, name)
  if (input.approach !== undefined && input.approach !== 'auto' && !birthdayApproaches.includes(input.approach)) throw new Error('Seleccione un enfoque válido.')
  if (input.profileId !== undefined && (typeof input.profileId !== 'string' || !/^[\w-]{0,80}$/.test(input.profileId))) throw new Error('Seleccione un perfil válido.')
  return { name, sex: input.sex, birthYear: input.birthYear, ...(dedication ? { dedication } : {}), ...(input.approach ? { approach: input.approach } : {}), ...(input.profileId ? { profileId: input.profileId } : {}) }
}
export function validateBirthdaySettings (value: unknown): BirthdaySettings {
  const input = value as BirthdaySettings
  const voice = (id: unknown) => typeof id === 'string' && /^[\w-]{1,120}$/.test(id)
  if (!input || !Number.isInteger(input.revision) || typeof input.textModel !== 'string' || !/^[\w.-]{1,100}$/.test(input.textModel)
    || !voice(input.defaultVoiceId) || !Array.isArray(input.rules) || input.rules.length > 30) throw new Error('Configure el modelo de texto y una voz predeterminada válida.')
  for (const rule of input.rules) {
    if (!rule || !['female', 'male', 'unspecified', 'any'].includes(rule.sex) || !Number.isInteger(rule.minAge) || !Number.isInteger(rule.maxAge)
      || rule.minAge < 0 || rule.maxAge > 120 || rule.maxAge < rule.minAge || !voice(rule.voiceId)) throw new Error('Revise los rangos de edad y las voces.')
    if ((rule.id !== undefined && (typeof rule.id !== 'string' || !/^[\w-]{1,80}$/.test(rule.id)))
      || (rule.title !== undefined && (typeof rule.title !== 'string' || rule.title.length > 80))
      || (rule.writing !== undefined && (typeof rule.writing !== 'string' || rule.writing.length > 500))
      || (rule.style !== undefined && (typeof rule.style !== 'string' || rule.style.length > 400))
      || (rule.approaches !== undefined && (!Array.isArray(rule.approaches) || !rule.approaches.length || rule.approaches.some(value => !birthdayApproaches.includes(value))))
      || (rule.history !== undefined && typeof rule.history !== 'boolean')) throw new Error('Revise el nombre, las instrucciones y los enfoques del perfil.')
    if (rule.videoId !== undefined && rule.videoId !== null && !voice(rule.videoId)) throw new Error('Seleccione un video válido para el perfil.')
  }
  const ids = input.rules.flatMap(rule => rule.id ? [rule.id] : [])
  if (new Set(ids).size !== ids.length) throw new Error('Los identificadores de perfil deben ser únicos.')
  const speechProvider = input.speechProvider ?? 'elevenlabs'
  const speechModel = input.speechModel ?? (speechProvider === 'gemini' ? 'gemini-3.8-flash-tts' : 'eleven_v4')
  const speechStyle = input.speechStyle ?? defaultBirthdaySettings.speechStyle!
  const historyEvery = input.historyEvery ?? 4
  if (!['gemini', 'elevenlabs'].includes(speechProvider) || !/^[\w.-]{1,100}$/.test(speechModel) || typeof speechStyle !== 'string' || !speechStyle.trim() || speechStyle.length > 400
    || !Number.isInteger(historyEvery) || historyEvery < 0 || historyEvery > 20) throw new Error('Revise el proveedor, modelo, interpretación y frecuencia histórica.')
  if (input.rules.some((a, i) => input.rules.slice(i + 1).some(b => a.sex === b.sex && a.minAge <= b.maxAge && b.minAge <= a.maxAge))) throw new Error('Los rangos de voz del mismo sexo no pueden superponerse.')
  const targetSeconds = input.targetSeconds ?? 40
  const maxVoiceSeconds = input.maxVoiceSeconds ?? 60
  if (!Number.isInteger(targetSeconds) || !Number.isInteger(maxVoiceSeconds) || targetSeconds < 15 || targetSeconds > maxVoiceSeconds || maxVoiceSeconds > 60) throw new Error('Use una duración objetivo de al menos 15 segundos y un máximo de hasta 60 segundos.')
  for (const id of [input.introId, input.musicId, input.videoId]) if (id !== null && !voice(id)) throw new Error('Seleccione recursos válidos.')
  if (input.introIds !== undefined && (!Array.isArray(input.introIds) || input.introIds.length > 30 || input.introIds.some(id => !voice(id)) || new Set(input.introIds).size !== input.introIds.length)) throw new Error('Seleccione hasta 30 introducciones diferentes.')
  return { revision: input.revision, textModel: input.textModel, targetSeconds, maxVoiceSeconds, defaultVoiceId: input.defaultVoiceId,
    speechProvider, speechModel, speechStyle, historyEvery,
    ...(input.introIds !== undefined ? { introIds: [...input.introIds] } : {}),
    rules: input.rules.map(({ sex, minAge, maxAge, voiceId, id, title, writing, style, approaches, history, videoId }) => ({ sex, minAge, maxAge, voiceId, id, title, writing, style, approaches, history, videoId })), introId: input.introId, musicId: input.musicId, videoId: input.videoId }
}
export function selectBirthdayProfile (settings: BirthdaySettings, input: BirthdayInput, year: number): BirthdayVoiceRule {
  if (input.profileId) {
    const override = settings.rules.find(rule => rule.id === input.profileId)
    if (!override) throw new Error('El perfil seleccionado ya no está disponible.')
    return override
  }
  const candidates = settings.rules.filter(rule => year - input.birthYear >= rule.minAge && year - input.birthYear <= rule.maxAge)
  return candidates.find(rule => rule.sex === input.sex) ?? candidates.find(rule => rule.sex === 'any') ?? {
    id: 'default', title: 'Predeterminado', sex: 'any', minAge: 0, maxAge: 120, voiceId: settings.defaultVoiceId,
    writing: 'Mensaje cercano, alegre y apropiado para la edad, sin estereotipos.', style: settings.speechStyle,
  }
}
export const selectBirthdayVoice = (settings: BirthdaySettings, input: BirthdayInput, year: number) => selectBirthdayProfile(settings, input, year).voiceId

export function initialBirthdayProfiles (voiceId: string): BirthdayVoiceRule[] {
  return [
    [0, 12, 'Juego musical', 'Lenguaje sencillo, imaginación y juego musical.', 'Alegre y afectuosa, sin exagerar.', 'Puck'],
    [13, 24, 'Celebración dinámica', 'Espontáneo y dinámico, sin jerga forzada.', 'Energía festiva y natural, sin gritar.', 'Laomedeia'],
    [25, 44, 'Cercano y festivo', 'Cercanía y humor ligero, sin bromas personales.', 'Festiva, cercana y natural.', 'Achird'],
    [45, 64, 'Reconocimiento cálido', 'Reconocimiento cálido y deseos significativos.', 'Expresiva y cercana, con ritmo moderado.', 'Sulafat'],
    [65, 120, 'Homenaje alegre', 'Homenaje afectuoso y alegre; nunca infantilizar.', 'Clara, cálida y respetuosa.', 'Gacrux'],
  ].map(([minAge, maxAge, title, writing, style, candidate], index) => ({ id: `age-${index}`, sex: 'any', minAge: Number(minAge), maxAge: Number(maxAge), title: String(title), writing: String(writing), style: String(style), voiceId: voiceId || String(candidate), approaches: [...birthdayApproaches], history: true }))
}

// Demographics inform tone, never the public narrative. Reject both numeric and
// common verbal age references before any paid speech synthesis.
export function validateBirthdayScript (value: unknown, name: string): string {
  const text = typeof value === 'string' ? value.normalize('NFC').trim().replace(/\s+/g, ' ') : ''
  if (!text || text.length > birthdayLimits.script || !text.includes(name)
    || /[\d<>[\]]/.test(text) || hasInvisibleCharacters(text) || hasOffensiveText(text)
    || /\b(edad|sexo|género|genero|femenin[oa]|masculin[oa]|var[oó]n|naciste|nacimiento|nacid[oa]|mujer|hombre|niñ[oa]|pequeñ[oa]|joven|adolescente|juvenil|juventud|adult[oa]|abuel[oa]|señor[ai]?|décadas?|primaveras?|añitos|vejez|envejec|cóctel|coctel|cerveza|vino|regalamos)\b/i.test(text)
    || /\b(tus|cumples|cumpliendo|felices)\s+(veinti\w*|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien)\b/i.test(text)
    || /\b(uno|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieci\w*|veint\w*|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien\w*)\b[^.!?]{0,35}\baños\b/i.test(text)) {
    throw new Error('El saludo no cumple las reglas de privacidad o contenido. Genere otra versión.')
  }
  return text
}
export const publicBirthday = (event: PublicBirthday): PublicBirthday => ({
  id: event.id, name: event.name, playback: event.playback, preparation: event.preparation,
  phase: event.phase, durationMs: event.durationMs, startedAt: event.startedAt,
})
export const birthdayLabels: Record<BirthdayPreparation | BirthdayPlayback | BirthdayPhase, string> = {
  queued: 'Preparando', writing: 'Creando saludo', voicing: 'Generando voz', preparing: 'Preparando audio', ready: 'Listo', failed: 'Error de preparación',
  held: 'En espera', scheduled: 'Programado: siguiente en la cola', playing: 'En reproducción', completed: 'Completado', cancelled: 'Cancelado', interrupted: 'Interrumpido',
  intro: 'Introducción', greeting: 'Saludo', music: 'Canción de cumpleaños',
}

import { hasInvisibleCharacters, hasOffensiveText } from './textModeration.js'

export const BIRTHDAY_SYNC = 'server/BIRTHDAY_SYNC'
export const BIRTHDAY_PLAYER = 'server/BIRTHDAY_PLAYER'
export const BIRTHDAY_STATE = 'birthday/STATE'
export const birthdayIntroText = 'Hoy celebramos un cumpleaños muy especial. Gracias por compartir este momento con nosotros. Tenemos un presente para ti de parte de la casa; esperamos que te guste. Y ahora, un saludo preparado especialmente para ti.'
export const birthdayLimits = { script: 1500, voiceMs: 60000, introMs: 60000, musicMs: 300000 }
export type BirthdaySex = 'female' | 'male' | 'unspecified'
export interface BirthdayInput { name: string, sex: BirthdaySex, birthYear: number }
export interface BirthdayVoiceRule { sex: BirthdaySex, minAge: number, maxAge: number, voiceId: string }
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
}
export const defaultBirthdaySettings: BirthdaySettings = {
  revision: 0, textModel: '', targetSeconds: 40, maxVoiceSeconds: 60, defaultVoiceId: '', rules: [], introId: null, musicId: null, videoId: null,
}
export type BirthdayPreparation = 'queued' | 'writing' | 'voicing' | 'preparing' | 'ready' | 'failed'
export type BirthdayPlayback = 'held' | 'scheduled' | 'playing' | 'completed' | 'cancelled' | 'interrupted'
export type BirthdayPhase = 'intro' | 'greeting' | 'music'
export interface BirthdayAsset { id: string, kind: 'intro' | 'music' | 'greeting' | 'video', title: string, durationMs: number, url: string, checksum: string }
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
  return { name, sex: input.sex, birthYear: input.birthYear }
}
export function validateBirthdaySettings (value: unknown): BirthdaySettings {
  const input = value as BirthdaySettings
  const voice = (id: unknown) => typeof id === 'string' && /^[\w-]{1,120}$/.test(id)
  if (!input || !Number.isInteger(input.revision) || typeof input.textModel !== 'string' || !/^[\w.-]{1,100}$/.test(input.textModel)
    || !voice(input.defaultVoiceId) || !Array.isArray(input.rules) || input.rules.length > 30) throw new Error('Configure el modelo de texto y una voz predeterminada válida.')
  for (const rule of input.rules) {
    if (!rule || !['female', 'male', 'unspecified'].includes(rule.sex) || !Number.isInteger(rule.minAge) || !Number.isInteger(rule.maxAge)
      || rule.minAge < 0 || rule.maxAge > 120 || rule.maxAge < rule.minAge || !voice(rule.voiceId)) throw new Error('Revise los rangos de edad y las voces.')
  }
  if (input.rules.some((a, i) => input.rules.slice(i + 1).some(b => a.sex === b.sex && a.minAge <= b.maxAge && b.minAge <= a.maxAge))) throw new Error('Los rangos de voz del mismo sexo no pueden superponerse.')
  const targetSeconds = input.targetSeconds ?? 40
  const maxVoiceSeconds = input.maxVoiceSeconds ?? 60
  if (!Number.isInteger(targetSeconds) || !Number.isInteger(maxVoiceSeconds) || targetSeconds < 15 || targetSeconds > maxVoiceSeconds || maxVoiceSeconds > 60) throw new Error('Use una duración objetivo de al menos 15 segundos y un máximo de hasta 60 segundos.')
  for (const id of [input.introId, input.musicId, input.videoId]) if (id !== null && !voice(id)) throw new Error('Seleccione recursos válidos.')
  return { revision: input.revision, textModel: input.textModel, targetSeconds, maxVoiceSeconds, defaultVoiceId: input.defaultVoiceId,
    rules: input.rules.map(({ sex, minAge, maxAge, voiceId }) => ({ sex, minAge, maxAge, voiceId })), introId: input.introId, musicId: input.musicId, videoId: input.videoId }
}
export const selectBirthdayVoice = (settings: BirthdaySettings, input: BirthdayInput, year: number) =>
  settings.rules.find(rule => rule.sex === input.sex && year - input.birthYear >= rule.minAge && year - input.birthYear <= rule.maxAge)?.voiceId ?? settings.defaultVoiceId

// Demographics inform tone, never the public narrative. Reject both numeric and
// common verbal age references before any paid speech synthesis.
export function validateBirthdayScript (value: unknown, name: string): string {
  const text = typeof value === 'string' ? value.normalize('NFC').trim().replace(/\s+/g, ' ') : ''
  if (!text || text.length > birthdayLimits.script || !text.toLocaleLowerCase('es').includes(name.toLocaleLowerCase('es'))
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

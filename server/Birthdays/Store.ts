import { randomUUID } from 'node:crypto'
import { db } from '../lib/Database.js'
import {
  celebrationYear, defaultBirthdaySettings, publicBirthday, validateBirthdayInput, validateBirthdaySettings,
  type BirthdayAsset, type BirthdayEvent, type BirthdayInput, type BirthdaySettings, type PublicBirthday,
} from '../../shared/birthdays.js'
import { contextInput, historicalReferences, inputIdentity, readPersonalization, selectPersonalization, speechProfile } from './personalization.js'

export interface AssetRow extends Omit<BirthdayAsset, 'url'> { roomId: number, filename: string }
export interface BirthdayRow extends Omit<BirthdayEvent, 'assets'> {
  generationRevision: number
  roomId: number
  requestId: string
  settingsJSON: string
  greetingId: string | null
  createdAt: number
  phaseStartedAt: number | null
  ownerSocketId: string | null
  token: string | null
  leaseUntil: number | null
  personalizationJSON: string | null
}
export function assertRoom (roomId: number) {
  if (!db.get('SELECT 1 FROM rooms WHERE roomId=? AND status=?', [roomId, 'open'])) throw new Error('Abra la sala para gestionar cumpleaños.')
}
export const settings = (roomId: number): BirthdaySettings => {
  const row = db.get<{ data: string }>('SELECT data FROM birthdaySettings WHERE roomId=?', [roomId])
  // Old IDs belong to ElevenLabs, even when new installations default to Gemini.
  return row ? { ...defaultBirthdaySettings, speechProvider: 'elevenlabs', speechModel: 'eleven_v4', ...JSON.parse(row.data) } : { ...defaultBirthdaySettings, rules: [] }
}
export const asset = (roomId: number, id: string) => db.get<AssetRow>('SELECT * FROM birthdayAssets WHERE roomId=? AND id=?', [roomId, id])
export const assetDTO = (row: AssetRow): BirthdayAsset => ({ id: row.id, kind: row.kind, title: row.title, checksum: row.checksum, durationMs: row.durationMs, url: `api/birthdays/assets/${row.id}` })
export const getBirthday = (roomId: number, id: string) => {
  const row = db.get<BirthdayRow>('SELECT * FROM birthdays WHERE roomId=? AND id=?', [roomId, id])
  if (!row) throw new Error('No se encontró el cumpleaños de esta sala.')
  return row
}
export const rows = (roomId: number) => db.all<BirthdayRow>('SELECT * FROM birthdays WHERE roomId=? ORDER BY createdAt DESC,id', [roomId])
export const publicEvents = (roomId: number): PublicBirthday[] => rows(roomId).filter(row => ['scheduled', 'playing'].includes(row.playback)).map(publicBirthday)
export const birthdayOwnsAudio = (roomId: number) => !!db.get('SELECT 1 FROM birthdays WHERE roomId=? AND playback=\'playing\'', [roomId])
export function eventAssets (row: BirthdayRow): AssetRow[] {
  const config: BirthdaySettings = JSON.parse(row.settingsJSON)
  return [config.introId, row.greetingId, config.musicId, config.videoId].flatMap((id) => {
    const value = id ? asset(row.roomId, id) : undefined
    return value ? [value] : []
  })
}
export function eventDTO (row: BirthdayRow): BirthdayEvent {
  return { ...publicBirthday(row), sex: row.sex, birthYear: row.birthYear, celebrationYear: row.celebrationYear,
    revision: row.revision, script: row.script, voiceId: row.voiceId, error: row.error, assets: eventAssets(row).map(assetDTO),
    personalization: readPersonalization(row) }
}
export function saveSettings (roomId: number, value: unknown) {
  assertRoom(roomId)
  const next = validateBirthdaySettings(value)
  if (next.revision !== settings(roomId).revision) throw new Error('Los ajustes cambiaron. Recargue antes de guardar.')
  for (const [kind, id] of [['intro', next.introId], ['music', next.musicId], ['video', next.videoId]]) {
    if (id && asset(roomId, id)?.kind !== kind) throw new Error('Seleccione recursos de cumpleaños de esta sala.')
  }
  next.revision++
  db.run('INSERT INTO birthdaySettings(roomId,data) VALUES(?,?) ON CONFLICT(roomId) DO UPDATE SET data=excluded.data', [roomId, JSON.stringify(next)])
  return next
}
export function createBirthday (roomId: number, requestId: string, value: unknown) {
  assertRoom(roomId)
  if (typeof requestId !== 'string' || !/^[\w-]{8,80}$/.test(requestId)) throw new Error('Identificador de solicitud inválido.')
  const year = celebrationYear()
  const input = validateBirthdayInput(value, year)
  const existing = db.get<BirthdayRow>('SELECT * FROM birthdays WHERE roomId=? AND requestId=?', [roomId, requestId])
  if (existing) {
    if (inputIdentity(contextInput(existing, readPersonalization(existing))) !== inputIdentity(input)) throw new Error('Esta solicitud ya contiene otros datos.')
    return existing
  }
  const config = validateBirthdaySettings(settings(roomId))
  if (!config.introId || !config.musicId || !config.videoId) throw new Error('Configure la introducción, la música y el video en Ajustes → Cumpleaños.')
  const id = randomUUID()
  const duration = [config.introId, config.musicId].reduce((sum, assetId) => sum + (asset(roomId, assetId)?.durationMs ?? 0), config.targetSeconds * 1000)
  const personalization = resolvePersonalization(roomId, config, input, year)
  db.run(`INSERT INTO birthdays(id,roomId,requestId,name,sex,birthYear,celebrationYear,voiceId,settingsJSON,createdAt,durationMs,personalizationJSON) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, roomId, requestId, input.name, input.sex, input.birthYear, year, personalization.speech.voice, JSON.stringify(config), Date.now(), duration, JSON.stringify(personalization)])
  return getBirthday(roomId, id)
}
export function changeBirthday (roomId: number, id: string, revision: number, operation: string, input?: BirthdayInput) {
  assertRoom(roomId)
  const row = getBirthday(roomId, id)
  // Retried approvals/withdrawals are receipts, not a second transition.
  if ((operation === 'schedule' && row.playback === 'scheduled') || (operation === 'unschedule' && row.playback === 'held')) return row
  if (row.revision !== revision) throw new Error('El cumpleaños cambió. Revise su estado antes de continuar.')
  if (operation === 'schedule') {
    if (!['held', 'interrupted'].includes(row.playback) || row.preparation === 'failed') throw new Error('Corrija la preparación antes de programar el cumpleaños.')
    if (publicEvents(roomId).length) throw new Error('Ya hay un cumpleaños programado. Retírelo o espere a que termine.')
    db.run('UPDATE birthdays SET playback=\'scheduled\',error=NULL,revision=revision+1 WHERE id=?', [id])
  } else if (operation === 'unschedule' && row.playback === 'scheduled') {
    db.run('UPDATE birthdays SET playback=\'held\',error=NULL,revision=revision+1 WHERE id=?', [id])
  } else if (operation === 'cancel' && row.playback !== 'playing' && row.playback !== 'completed') {
    db.run('UPDATE birthdays SET playback=\'cancelled\',revision=revision+1 WHERE id=?', [id])
  } else if (['retry', 'regenerate', 'edit', 'revoice', 'lite'].includes(operation) && ['held', 'interrupted'].includes(row.playback)) {
    if (!['ready', 'failed'].includes(row.preparation)) throw new Error('Espere a que termine la preparación.')
    const previous = readPersonalization(row)
    const next = input ? validateBirthdayInput(input, row.celebrationYear) : contextInput(row, previous)
    const retry = operation === 'retry'
    const config: BirthdaySettings = retry ? JSON.parse(row.settingsJSON) : settings(roomId)
    const oldInput = contextInput(row, previous)
    // Selecting another voice profile does not itself rewrite the approved text.
    const sameContent = inputIdentity({ ...oldInput, profileId: '' }) === inputIdentity({ ...next, profileId: '' })
    const regenerate = operation === 'regenerate' || (operation === 'edit' && !sameContent)
    let personalization = previous
    if (regenerate || !previous) personalization = resolvePersonalization(roomId, config, next, row.celebrationYear)
    else if (!retry) {
      const selected = selectPersonalization(config, next, row.celebrationYear, 0, [])
      personalization = { ...previous, profile: selected.profile, profileOverride: next.profileId ?? '', speech: selected.speech }
    }
    // A legacy retry keeps its original identity and media. A new speech action
    // intentionally upgrades it; Lite is never a silent provider fallback.
    if (retry && !previous) personalization = null
    else if (!regenerate && !previous && personalization) {
      // Upgrading a legacy voice never retroactively adds a historical sentence
      // to an already prepared transcript.
      personalization.reference = null
    }
    if (operation === 'lite') {
      if (personalization?.speech.provider !== 'gemini') throw new Error('Seleccione Gemini en los ajustes para utilizar Flash-Lite.')
      personalization.speech = { ...personalization.speech, model: 'gemini-3.8-flash-lite-tts' }
    }
    const oldSpeech = previous?.speech ?? speechProfile({ ...JSON.parse(row.settingsJSON), speechProvider: 'elevenlabs' }, row.voiceId)
    const newSpeech = personalization?.speech ?? oldSpeech
    const changedSpeech = JSON.stringify(oldSpeech) !== JSON.stringify(newSpeech)
    const clearAudio = regenerate || changedSpeech || operation === 'revoice' || operation === 'lite'
    db.run(`UPDATE birthdays SET name=?,sex=?,birthYear=?,voiceId=?,settingsJSON=?,personalizationJSON=?,script=?,greetingId=?,preparation='queued',playback='held',error=NULL,revision=revision+1,generationRevision=generationRevision+1 WHERE id=?`,
      [next.name, next.sex, next.birthYear, newSpeech.voice, JSON.stringify(config), personalization ? JSON.stringify(personalization) : null, regenerate ? null : row.script, clearAudio ? null : row.greetingId, id])
  } else throw new Error('Esta acción no está disponible para el cumpleaños.')
  return getBirthday(roomId, id)
}

function resolvePersonalization (roomId: number, config: BirthdaySettings, input: BirthdayInput, year: number) {
  const recent = rows(roomId)
  const sequence = recent.reduce((sum, row) => sum + 1 + row.generationRevision, 0)
  const context = selectPersonalization(config, input, year, sequence, recent.map((row) => {
    const previous = readPersonalization(row)
    const suffix = [previous?.reference?.phrase, previous?.dedication].filter(Boolean).join(' ')
    return { name: row.name, script: suffix && row.script?.endsWith(suffix) ? row.script.slice(0, -(suffix.length + 1)) : row.script }
  }))
  const eligible = recent.filter(row => historicalReferences.some(ref => row.birthYear >= ref.fromYear && row.birthYear <= ref.toYear)).length
  context.reference = selectPersonalization(config, input, year, eligible, []).reference
  return context
}

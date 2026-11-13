import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Server } from 'socket.io'
import { db } from '../lib/Database.js'
import Rooms from '../Rooms/Rooms.js'
import { createElevenLabs, createGemini } from '../AudioProviders/index.js'
import { elevenLabsConfig } from '../AudioProviders/config.js'
import { prepareAudio } from '../Animation/AudioPreparation.js'
import { getTransitionVideoService } from '../TransitionVideo/Service.js'
import Prefs from '../Prefs/Prefs.js'
import { birthdayPrompt, completeBirthdayScript, readPersonalization, speechProfile, validateCompleteScript } from './personalization.js'
import { speakGeminiBirthday } from './gemini.js'
import { recordBirthdayIntro } from './scenes.js'
import {
  BIRTHDAY_STATE, birthdayIntroText, birthdayLimits, birthdayPhases, publicBirthday,
  type BirthdayGrant, type BirthdaySettings, type BirthdayPhase, type BirthdaySpeech,
} from '../../shared/birthdays.js'
import { asset, assetDTO, eventAssets, getBirthday, publicEvents, settings, type BirthdayRow } from './Store.js'
import { getEventScenes, sceneFixedAudio, sceneVisualResources, sceneAudioUrl } from '../Animation/Scenes/Store.js'
import { resolveEventScene, selectedEventScene, type EventScene, type SceneResources } from '../../shared/eventScenes.js'
import type { BirthdayAsset } from '../../shared/birthdays.js'
import { catalogClips } from '../Animation/catalog.js'
import { getTransitionVideo, transitionVideoDTO } from '../TransitionVideo/Store.js'
import { captureTransitionBackground } from '../TransitionVideo/Playback.js'

function playbackScene (row: BirthdayRow): EventScene | null {
  return JSON.parse(row.settingsJSON)._playbackScene ?? null
}
function playbackAssets (row: BirthdayRow, scene: EventScene | null): BirthdayAsset[] {
  const snapshot = JSON.parse(row.settingsJSON)._playbackAssets
  if (['playing', 'completed', 'interrupted'].includes(row.playback) && Array.isArray(snapshot)) return snapshot
  return eventAssets(row).map(assetDTO).map((original) => {
    const cue = scene?.cues.find(cue => cue.binding !== 'resource' && cue.slot === (original.kind === 'video' ? 'background' : original.kind) && cue.enabled !== false)
    if (!cue?.resourceId) return original
    const stored = asset(row.roomId, cue.resourceId)
    if (stored && stored.kind === original.kind) return assetDTO(stored)
    if (original.kind === 'video') {
      const video = getTransitionVideo(row.roomId, cue.resourceId)
      if (video?.state === 'ready' && video.active) return { id: video.id, kind: 'video', title: video.title, durationMs: video.durationMs!, checksum: video.checksum!, url: transitionVideoDTO(video).videoUrl! }
    } else {
      const clip = catalogClips(row.roomId).find(clip => clip.id === cue.resourceId && clip.kind !== 'ambience')
      if (clip) return { id: clip.id, kind: original.kind, title: clip.title, durationMs: clip.durationMs, checksum: clip.checksum, url: `api/animation/assets/${encodeURIComponent(clip.id)}` }
    }
    throw new Error('Un recurso de la coreografía ya no está disponible. Revise la plantilla.')
  })
}
function playbackAmbience (row: BirthdayRow, scene: EventScene | null): BirthdayAsset | null {
  const snapshot = JSON.parse(row.settingsJSON)._playbackAmbience
  if (['playing', 'completed', 'interrupted'].includes(row.playback) && snapshot !== undefined) return snapshot
  const id = scene?.cues.find(cue => cue.lane === 'ambience' && cue.enabled !== false)?.resourceId
  const clip = id ? catalogClips(row.roomId).find(clip => clip.id === id && clip.kind === 'ambience') : null
  return clip ? { id: clip.id, kind: 'music', title: clip.title, durationMs: clip.durationMs, checksum: clip.checksum, url: `api/animation/assets/${encodeURIComponent(clip.id)}` } : null
}

function playbackExtra (row: BirthdayRow, scene: EventScene | null): NonNullable<BirthdayGrant['extraAudio']> {
  const snapshot = JSON.parse(row.settingsJSON)._playbackExtra
  if (['playing', 'completed', 'interrupted'].includes(row.playback) && Array.isArray(snapshot)) return snapshot
  return Object.entries(sceneFixedAudio(row.roomId, scene)).map(([cueId, clip]) => ({ cueId, asset: { id: clip.id, kind: 'music', title: clip.title, durationMs: clip.durationMs, checksum: clip.checksum, url: sceneAudioUrl(clip) } }))
}
function playbackResources (row: BirthdayRow, scene: EventScene | null, assets: BirthdayAsset[], extra: NonNullable<BirthdayGrant['extraAudio']>, lease = false): SceneResources {
  const snapshot = JSON.parse(row.settingsJSON)._playbackResources
  if (['playing', 'completed', 'interrupted'].includes(row.playback) && snapshot) return snapshot
  const result: SceneResources = Object.fromEntries(assets.map(asset => [asset.kind === 'video' ? 'background' : asset.kind, { ...asset, dimOpacity: 0 }]))
  for (const item of extra) result[item.cueId] = item.asset
  Object.assign(result, sceneVisualResources(row.roomId, scene, undefined, lease ? { key: `birthday-scene:${row.id}`, until: Date.now() + 60000 } : undefined))
  return result
}

export interface BirthdayProviders {
  write(row: BirthdayRow, config: BirthdaySettings, signal: AbortSignal): Promise<string>
  speak(text: string, voiceId: string, signal: AbortSignal, profile?: BirthdaySpeech): Promise<Buffer>
}
export function birthdayProviders (): BirthdayProviders {
  const options = elevenLabsConfig()
  const voice = createElevenLabs(options)
  return {
    async write (row, config, signal) {
      const context = readPersonalization(row)
      const text = await createGemini().generateText(config.textModel, {
        systemInstruction: { parts: [{ text: birthdayPrompt(context, config.targetSeconds ?? 25, Prefs.get().branding.name || 'Il Gatto') }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify({ name: row.name, age: row.celebrationYear - row.birthYear, targetSeconds: config.targetSeconds ?? 25,
          dedication: context?.dedication, reference: context?.reference, recentOpenings: context?.recentOpenings }) }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { script: { type: 'STRING' } }, required: ['script'] } },
      }, signal)
      return JSON.parse(text || '{}').script
    },
    async speak (text, voiceId, signal, profile) {
      if (profile?.provider === 'gemini') return speakGeminiBirthday(text, profile, signal)
      if (!options.key) throw new Error('Configure ElevenLabs en el servidor para generar la voz.')
      const voices = await voice.check(profile?.model ?? options.model)
      if (!voices.some(item => item.voiceId === voiceId)) throw new Error('La voz configurada no está disponible. Revise Ajustes → Cumpleaños.')
      const result = await voice.generate({ text, spokenText: text, kind: 'voice', voiceId,
        model: profile?.model ?? options.model,
        settings: { stability: 0.5, similarity_boost: 0.75 } }, signal)
      return result.bytes
    },
  }
}

export class BirthdayService {
  private timer?: ReturnType<typeof setInterval>
  private work: Promise<void> | null = null
  private abort = new AbortController()
  constructor (readonly directory: string, private io?: Server, private providers = birthdayProviders()) {}

  async start () {
    await fs.mkdir(this.directory, { recursive: true })
    db.run('UPDATE birthdays SET preparation=\'failed\',playback=CASE WHEN playback=\'scheduled\' THEN \'held\' ELSE playback END,error=\'La preparación se interrumpió. Revise y reintente; la generación no se repetirá automáticamente.\' WHERE preparation IN (\'writing\',\'voicing\',\'preparing\')')
    db.run('UPDATE birthdays SET playback=\'interrupted\',error=\'El servidor se reinició durante la celebración.\',ownerSocketId=NULL,token=NULL,leaseUntil=NULL WHERE playback=\'playing\'')
    this.timer = setInterval(() => {
      this.sweep()
      void this.drain()
    }, 1000)
    this.timer.unref()
    void this.drain()
  }

  async stop () {
    clearInterval(this.timer)
    this.abort.abort()
    await this.work
  }

  publish (roomId: number) {
    this.io?.to(Rooms.prefix(roomId)).emit('action', { type: BIRTHDAY_STATE, payload: { roomId, events: publicEvents(roomId) } })
  }

  waiting (roomId: number, reason: string) {
    db.run('UPDATE birthdays SET error=? WHERE roomId=? AND playback=\'scheduled\' AND error IS NOT ?', [reason, roomId, reason])
    this.publish(roomId)
  }

  sweep () {
    const expired = db.all<BirthdayRow>('SELECT * FROM birthdays WHERE playback=\'playing\' AND leaseUntil<=?', [Date.now()])
    for (const row of expired) this.interrupt(row.roomId, 'La pantalla no confirmó la continuidad del evento.', row.ownerSocketId!)
  }

  drain () {
    if (this.work || this.abort.signal.aborted) return this.work ?? Promise.resolve()
    this.work = this.process().finally(() => {
      this.work = null
    })
    return this.work
  }

  private async process () {
    let row: BirthdayRow | undefined
    while (!this.abort.signal.aborted && (row = db.get<BirthdayRow>('SELECT * FROM birthdays WHERE preparation=\'queued\' AND playback!=\'cancelled\' ORDER BY createdAt LIMIT 1'))) {
      const current = row
      const update = (sql: string, params: unknown[] = []) => db.run(`UPDATE birthdays SET ${sql} WHERE id=? AND generationRevision=? AND playback!='cancelled'`, [...params, current.id, current.generationRevision]).changes === 1
      const valid = () => {
        const fresh = getBirthday(current.roomId, current.id)
        return fresh.generationRevision === current.generationRevision && fresh.playback !== 'cancelled' && !this.abort.signal.aborted
      }
      try {
        const config: BirthdaySettings = JSON.parse(current.settingsJSON)
        const context = readPersonalization(current)
        let script = current.script
        if (!script) {
          update('preparation=\'writing\'')
          this.publish(current.roomId)
          script = completeBirthdayScript(await this.providers.write(current, config, this.abort.signal), current.name, context)
          if (!update('script=?', [script])) continue
        }
        validateCompleteScript(script, current.name, context)
        let greeting = current.greetingId && asset(current.roomId, current.greetingId)
        if (!greeting) {
          update('preparation=\'voicing\'')
          this.publish(current.roomId)
          const profile = context?.speech ?? speechProfile({ ...config, speechProvider: 'elevenlabs' }, current.voiceId)
          const bytes = await this.providers.speak(script, current.voiceId, this.abort.signal, profile)
          if (!valid()) continue
          update('preparation=\'preparing\'')
          this.publish(current.roomId)
          greeting = await this.upload(current.roomId, 'greeting', `Saludo de ${current.name}`, bytes, (config.maxVoiceSeconds ?? 60) * 1000)
          if (!update('greetingId=?', [greeting.id])) continue
        }
        const assets = eventAssets(getBirthday(current.roomId, current.id))
        if (assets.length !== 4) throw new Error('Complete los recursos en Ajustes → Cumpleaños y reintente.')
        if (greeting.durationMs > (config.maxVoiceSeconds ?? 60) * 1000) throw new Error('El saludo supera la duración configurada. Genere otra versión.')
        await Promise.all(assets.map(item => fs.access(path.join(this.directory, item.filename))))
        update('preparation=\'ready\',durationMs=?,error=NULL', [assets.filter(item => item.kind !== 'video').reduce((sum, item) => sum + item.durationMs, 0)])
      } catch (error) {
        const message = error instanceof Error && !['SyntaxError', 'TypeError', 'AbortError'].includes(error.name) ? error.message : 'No se pudo confirmar la preparación. Revise y reintente.'
        update('preparation=\'failed\',playback=CASE WHEN playback=\'scheduled\' THEN \'held\' ELSE playback END,error=?', [message])
      }
      this.publish(current.roomId)
    }
  }

  async upload (roomId: number, kind: 'intro' | 'music' | 'greeting', title: string, bytes: Buffer, greetingLimit = birthdayLimits.voiceMs) {
    const id = randomUUID()
    const media = await prepareAudio(this.directory, id, 'voice', bytes,
      process.env.KES_FFMPEG_PATH || 'ffmpeg', this.abort.signal, undefined,
      { durationMs: kind === 'music' ? birthdayLimits.musicMs : kind === 'intro' ? birthdayLimits.introMs : Math.min(greetingLimit, birthdayLimits.voiceMs) })
    this.abort.signal.throwIfAborted()
    db.run('INSERT INTO birthdayAssets(id,roomId,kind,title,filename,durationMs,checksum) VALUES(?,?,?,?,?,?,?)', [id, roomId, kind, title.slice(0, 100), media.filename, media.durationMs, media.checksum])
    return asset(roomId, id)!
  }

  async intro (roomId: number, voiceId: string, text = birthdayIntroText, title = 'Presentación y presente de la casa') {
    if (typeof text !== 'string' || text.trim().length < 20 || text.length > 1000 || /[<>[\]]/.test(text) || !/\b(presente|obsequio)\b/i.test(text) || !/\bcasa\b/i.test(text) || !/cumpleaños/i.test(text)) throw new Error('Use una introducción de 20 a 1000 caracteres que celebre el cumpleaños e incluya un presente de la casa, sin etiquetas.')
    if (typeof title !== 'string' || !title.trim() || title.length > 100) throw new Error('Indique un nombre de hasta 100 caracteres.')
    const resource = await this.upload(roomId, 'intro', title.trim(), await this.providers.speak(text.trim(), voiceId, this.abort.signal, speechProfile(settings(roomId), voiceId)))
    db.run('UPDATE birthdayAssets SET script=? WHERE id=?', [text.trim(), resource.id])
    return asset(roomId, resource.id)!
  }

  async audition (roomId: number, profile: BirthdaySpeech) {
    const text = '¡Feliz cumpleaños! Que esta noche en Il Gatto esté llena de música, sonrisas y momentos para recordar.'
    return this.upload(roomId, 'greeting', 'Prueba de voz', await this.providers.speak(text, profile.voice, this.abort.signal, profile))
  }

  async copyVideo (roomId: number, id: string) {
    const service = getTransitionVideoService()
    const lease = service.acquire(roomId, id)
    try {
      const copyId = randomUUID()
      const filename = `${copyId}.mp4`
      await fs.copyFile(path.join(service.directory, lease.row.filename!), path.join(this.directory, filename))
      this.abort.signal.throwIfAborted()
      db.run('INSERT INTO birthdayAssets(id,roomId,kind,title,filename,durationMs,checksum) VALUES(?,?,?,?,?,?,?)', [copyId, roomId, 'video', lease.row.title, filename, lease.row.durationMs, lease.row.checksum])
      return asset(roomId, copyId)!
    } finally { lease.release() }
  }

  async reserve (roomId: number, ownerSocketId: string, mediaEndMs = 0): Promise<BirthdayGrant | { waiting: true } | null> {
    const row = db.get<BirthdayRow>('SELECT * FROM birthdays WHERE roomId=? AND playback IN (\'scheduled\',\'playing\')', [roomId])
    if (!row) return null
    if (row.playback === 'playing') {
      if (row.ownerSocketId !== ownerSocketId) throw new Error('Otro reproductor tiene el cumpleaños reservado.')
      const scene = playbackScene(row)
      const assets = playbackAssets(row, scene)
      const extraAudio = playbackExtra(row, scene)
      return { event: publicBirthday(row), assets, token: row.token!, remainingMs: Math.max(0, row.leaseUntil! - Date.now()), scene, ambience: playbackAmbience(row, scene), extraAudio, resources: playbackResources(row, scene, assets, extraAudio) }
    }
    if (row.preparation !== 'ready') return { waiting: true }
    const assets = eventAssets(row)
    try {
      if (assets.length !== 4) throw new Error('Missing assets')
      await Promise.all(assets.map(item => fs.access(path.join(this.directory, item.filename))))
    } catch {
      db.run('UPDATE birthdays SET playback=\'held\',preparation=\'failed\',error=\'Falta un archivo de la celebración. Revise los ajustes y reintente.\' WHERE id=? AND playback=\'scheduled\'', [row.id])
      this.publish(roomId)
      return null
    }
    const token = randomUUID()
    const now = Date.now()
    const scene = selectedEventScene(getEventScenes(roomId), 'birthday')
    const selected = playbackAssets(row, scene)
    const ambience = playbackAmbience(row, scene)
    const extraAudio = playbackExtra(row, scene)
    const resources = playbackResources(row, scene, selected, extraAudio, true)
    const resolved = scene ? resolveEventScene(scene, resources, mediaEndMs) : []
    const voices = resolved.filter(cue => cue.lane === 'voice').sort((a, b) => a.startMs - b.startMs)
    const durationMs = voices.length ? Math.max(...voices.map(cue => cue.endMs)) + Math.max(0, scene!.startOffsetMs) : row.durationMs
    const firstPhase = voices.find(cue => cue.binding !== 'resource')?.slot ?? 'intro'
    const changed = db.run('UPDATE birthdays SET playback=\'playing\',phase=?,startedAt=?,phaseStartedAt=?,token=?,ownerSocketId=?,leaseUntil=?,durationMs=?,settingsJSON=json_set(settingsJSON,\'$._playbackScene\',json(?),\'$._playbackAssets\',json(?),\'$._playbackAmbience\',json(?),\'$._playbackExtra\',json(?),\'$._playbackResources\',json(?),\'$._sceneMediaEndMs\',?),error=NULL,revision=revision+1 WHERE id=? AND playback=\'scheduled\' AND revision=?',
      [firstPhase, now, now, token, ownerSocketId, now + 15000, durationMs, JSON.stringify(scene), JSON.stringify(selected), JSON.stringify(ambience), JSON.stringify(extraAudio), JSON.stringify(resources), mediaEndMs, row.id, row.revision]).changes
    if (!changed) return null
    const videoId = scene?.cues.find(cue => cue.lane === 'background')?.resourceId
    if (videoId && getTransitionVideo(roomId, videoId)) captureTransitionBackground(roomId, `birthday:${row.id}`, now + 60000, false, videoId)
    this.publish(roomId)
    return { event: publicBirthday(getBirthday(roomId, row.id)), assets: selected, token, remainingMs: Math.max(0, now + 15000 - Date.now()), scene, ambience, extraAudio, resources }
  }

  preparePlayback (roomId: number) {
    const row = db.get<BirthdayRow>('SELECT * FROM birthdays WHERE roomId=? AND playback=\'scheduled\' AND preparation=\'ready\'', [roomId])
    if (!row) return null
    const scene = selectedEventScene(getEventScenes(roomId), 'birthday')
    const assets = playbackAssets(row, scene)
    const extraAudio = playbackExtra(row, scene)
    return { id: row.id, assets, scene, ambience: playbackAmbience(row, scene), extraAudio, resources: playbackResources(row, scene, assets, extraAudio) }
  }

  progress (roomId: number, owner: string, id: string, token: string, operation: 'heartbeat' | 'phase' | 'finish' | 'interrupt' | 'introStarted', phase?: BirthdayPhase) {
    const row = getBirthday(roomId, id)
    if (row.token !== token || row.ownerSocketId !== owner) throw new Error('La reserva del cumpleaños ya no es válida.')
    if (operation === 'introStarted') {
      if (!row.startedAt || !['playing', 'completed', 'interrupted'].includes(row.playback)) throw new Error('La introducción no tiene una reproducción autorizada.')
      if (playbackAssets(row, playbackScene(row)).find(asset => asset.kind === 'intro')?.id === eventAssets(row).find(asset => asset.kind === 'intro')?.id) recordBirthdayIntro(row)
      return
    }
    if (['completed', 'interrupted'].includes(row.playback)) return
    if (row.playback !== 'playing' || (row.leaseUntil ?? 0) <= Date.now()) throw new Error('La reserva del cumpleaños venció.')
    if (operation === 'interrupt') return this.interrupt(roomId, 'La celebración se interrumpió. Puede volver a programarla.', owner)
    if (operation === 'heartbeat') {
      db.run('UPDATE birthdays SET leaseUntil=? WHERE id=?', [Math.min(Date.now() + 15000, row.startedAt! + row.durationMs + 60000), id])
      const videoId = playbackScene(row)?.cues.find(cue => cue.lane === 'background')?.resourceId
      if (videoId) captureTransitionBackground(roomId, `birthday:${id}`, Date.now() + 60000, false, videoId)
      const frozen = playbackScene(row)
      for (const cue of frozen?.cues ?? []) if (cue.lane === 'background' && cue.enabled !== false && cue.resourceId) captureTransitionBackground(roomId, `birthday-scene:${id}:${cue.id}`, Date.now() + 60000, false, cue.resourceId)
      return
    }
    if (operation === 'phase' && phase === row.phase) return
    const scene = playbackScene(row)
    const timeline = scene ? resolveEventScene(scene, playbackResources(row, scene, playbackAssets(row, scene), playbackExtra(row, scene)), JSON.parse(row.settingsJSON)._sceneMediaEndMs ?? 0) : []
    const order = scene ? timeline.filter(cue => cue.lane === 'voice' && cue.binding !== 'resource').sort((a, b) => a.startMs - b.startMs).map(cue => cue.slot as BirthdayPhase) : birthdayPhases
    if (scene && (operation === 'phase' || operation === 'finish')) {
      const target = operation === 'finish' ? Math.max(...timeline.filter(cue => cue.lane === 'voice').map(cue => cue.endMs)) : timeline.find(cue => cue.slot === phase && cue.binding !== 'resource')!.startMs
      if (Date.now() < row.startedAt! + Math.max(0, scene.startOffsetMs) + target - 500) throw new Error('El bloque todavía no alcanzó su momento de ejecución.')
    }
    const duration = playbackAssets(row, scene).find(item => item.kind === row.phase)?.durationMs ?? 0
    if (Date.now() - row.phaseStartedAt! < duration - 500) throw new Error('El audio de esta etapa todavía no terminó.')
    if (operation === 'finish' && row.phase === order[order.length - 1]) db.run('UPDATE birthdays SET playback=\'completed\',phase=NULL,leaseUntil=NULL,revision=revision+1 WHERE id=?', [id])
    else if (operation === 'phase' && phase === order[order.indexOf(row.phase!) + 1]) db.run('UPDATE birthdays SET phase=?,phaseStartedAt=? WHERE id=?', [phase, Date.now(), id])
    else throw new Error('La secuencia del cumpleaños no es válida.')
    this.publish(roomId)
  }

  interrupt (roomId: number, message: string, owner?: string) {
    db.run(`UPDATE birthdays SET playback='interrupted',error=?,leaseUntil=NULL,revision=revision+1 WHERE roomId=? AND playback='playing'${owner ? ' AND ownerSocketId=?' : ''}`, [message, roomId, ...(owner ? [owner] : [])])
    this.publish(roomId)
  }
}
let current: BirthdayService | undefined
export function birthdayService () {
  if (!current) throw new Error('El servicio de cumpleaños todavía no está disponible.')
  return current
}
export async function startBirthdays (directory: string, io: Server) {
  current = new BirthdayService(directory, io)
  await current.start()
  return () => current!.stop()
}

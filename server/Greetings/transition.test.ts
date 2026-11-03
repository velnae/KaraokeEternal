import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { open, close, db } from '../lib/Database.js'
import Queue from '../Queue/Queue.js'
import Animation from '../Animation/Animation.js'
import { assertResourceUnused } from '../Animation/Resources.js'
import Greetings from './Greetings.js'
import { planGreetingTransition } from './transition.js'
import { GREETING_START_MS, type Greeting, type GreetingAsset, type GreetingPreparation } from '../../shared/greetings.js'
import { heardAt, voiceBudget } from '../Animation/selection.js'
import * as catalog from '../Animation/catalog.js'

let directory: string
let socketId: string
const asset = (role: GreetingAsset['role'], durationMs: number): GreetingAsset => ({
  id: role, role, durationMs, checksum: role[0].repeat(64), kind: role === 'bed' ? 'ambience' : 'voice',
  title: role, displayText: role, source: 'fixture', license: 'fixture', url: `api/fixture/${role}`, loop: true,
})
const text = { recipient: 'Rocío', message: '¡Feliz cumpleaños!' }
const ready = ['g', 'i', 'b'].map(value => value.repeat(64))
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-02T12:00:00Z'))
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'greet-transition-'))
  open({ file: path.join(directory, 'db.sqlite'), ro: false })
  db.exec(`INSERT INTO rooms(roomId,name,status,data) VALUES(1,'Main','open','{"prefs":{"queue":{"maxSongsPerParticipantRound":2},"animation":{"enabled":false,"volume":0.5}}}');
    INSERT INTO users(userId,username,password,name,roleId) VALUES(1,'ana','','Ana',1);`)
  socketId = randomUUID()
  Animation.claim(1, socketId)
  Animation.ready({ roomId: 1, userId: 1, socketId }, true, [])
  Greetings.configurePlayback(1, { enabled: true, introClipId: null, ambienceEnabled: true }, 0)
})
afterEach(() => {
  close()
  fs.rmSync(directory, { recursive: true, force: true })
  vi.useRealTimers()
  vi.restoreAllMocks()
})
function request (intent: 'SING' | 'LISTEN' = 'SING') {
  const queueId = Queue.add({ roomId: 1, userId: 1, requestIntent: intent, song: { source: 'YOUTUBE', sourceId: 'AAAAAAAAAAA', externalId: 'AAAAAAAAAAA', localSongId: null, mediaId: null, mediaType: 'youtube', title: 'Song', artistOrChannel: 'Artist', durationSeconds: 120, thumbnailUrl: null, isPlayable: true } })
  const greetingId = Greetings.attach({ roomId: 1, userId: 1 }, queueId, text, {})
  const item = Greetings.items(1).find(item => item.greetingId === greetingId)!
  return { queueId, item }
}
const prepared = (item: Greeting, greetingMs = 3000, introMs = 2000): GreetingPreparation => ({
  queueId: item.queueId, greetingId: item.greetingId, playbackVersion: 1,
  assets: [asset('greeting', greetingMs), asset('intro', introMs), asset('bed', 35000)],
  performer: { name: 'Ana', tableLabel: 'Mesa 4', requestIntent: 'SING', title: 'Song' },
})

it('keeps one introduction, complete greeting and optional bed inside the transition ceiling', () => {
  const { item } = request()
  const plan = planGreetingTransition(item, prepared(item, 19000, 8000), ready, 120000)!
  expect(plan.assets.map(item => item.role)).toEqual(['greeting', 'bed'])
  expect(plan.voiceMs).toBe(19000)
  expect(plan.durationMs + GREETING_START_MS).toBeLessThanOrEqual(25000)
  expect(plan.assets.find(item => item.role === 'bed')!.durationMs).toBe(35000)
  const short = planGreetingTransition(item, prepared(item), ready, 120000)!
  expect(short.assets.map(item => item.role)).toEqual(['intro', 'greeting', 'bed'])
  expect(short.voiceMs).toBe(5000)
  expect(short.durationMs).toBe(5250)
  expect(planGreetingTransition(item, prepared(item, 19000, 3000), ready, 120000, 22500)?.assets.map(item => item.role)).toEqual(['greeting', 'bed'])
  expect(planGreetingTransition(item, prepared(item, 19000, 3000), ready, 120000, 18000)).toBeNull()
})

it('prioritizes the full greeting over the intro for the shared voice budget', () => {
  const { item } = request()
  expect(planGreetingTransition(item, prepared(item), ready, 3500)?.assets.map(item => item.role)).toEqual(['greeting', 'bed'])
  expect(planGreetingTransition(item, prepared(item), ready, 2500)).toBeNull()
  expect(planGreetingTransition(item, prepared(item), ready.slice(1), 120000)).toBeNull()
  expect(planGreetingTransition(item, prepared(item, 21000), ready, 120000)).toBeNull()
})

it('uses the existing authority, protects catalog resources and counts speech rather than visual waiting', () => {
  const { item, queueId } = request()
  const grant = Greetings.reserve(1, socketId, queueId, {}, undefined, prepared(item), ready, 1)!
  const intervention = grant.transition!.intervention
  expect(intervention.origin).toBe('GREETING')
  expect(intervention.voiceDurationMs).toBe(5000)
  expect(grant.until - Date.now()).toBe(25000)
  expect(Animation.snapshot(1).prefs.enabled).toBe(false)
  expect(Animation.snapshot(1).blockedUntil).toBe(grant.until)
  expect(() => assertResourceUnused(1, 'intro')).toThrow('en uso')
  expect(() => assertResourceUnused(1, 'bed')).toThrow('en uso')
  Animation.event({ roomId: 1, userId: 1, socketId }, intervention.interventionId, intervention.playerEpoch!, 'STARTED')
  expect(voiceBudget(Animation.selectionHistory(1), Date.now())).toBe(115000)
  Greetings.event(1, socketId, grant.turnKey, item.greetingId, 'start')
  Greetings.voiceEvent(1, socketId, grant.turnKey, item.greetingId, 'audioStarted')
  vi.advanceTimersByTime(3000)
  Greetings.voiceEvent(1, socketId, grant.turnKey, item.greetingId, 'audioEnded')
  expect(Greetings.items(1)[0].playback?.status).toBe('PLAYED')
  expect(Greetings.items(1)[0].status).toBe('DISPLAYING')
  vi.advanceTimersByTime(grant.displayMs)
  Greetings.event(1, socketId, grant.turnKey, item.greetingId, 'end')
  Animation.event({ roomId: 1, userId: 1, socketId }, intervention.interventionId, intervention.playerEpoch!, 'ENDED')
  Greetings.finish(1, socketId, grant.turnKey)
  expect(Animation.snapshot(1).blockedUntil).toBe(0)
  expect(Greetings.reserve(1, socketId, queueId, {}, undefined, prepared(item), ready, 1)).toBeNull()
})

it('preserves a disconnected player fence and never replays its greeting on a successor', () => {
  const { item, queueId } = request()
  const first = Greetings.reserve(1, socketId, queueId, {}, undefined, prepared(item), ready, 1)!
  Animation.event({ roomId: 1, userId: 1, socketId }, first.transition!.intervention.interventionId, first.transition!.intervention.playerEpoch!, 'STARTED')
  Animation.disconnect(1, socketId)
  Greetings.interrupt(1, 'Disconnected', socketId)
  const successor = randomUUID()
  Animation.claim(1, successor)
  Animation.ready({ roomId: 1, userId: 1, socketId: successor }, true, [])
  expect(Animation.snapshot(1).blockedUntil).toBe(first.until)
  expect(Animation.reserveGreeting({ roomId: 1, userId: 1, socketId: successor }, queueId, [asset('greeting', 3000)], 10000, 3000, 'Hello')).toBeNull()
  expect(Greetings.reserve(1, successor, queueId, {})).toBeNull()
  vi.advanceTimersByTime(25001)
  expect(Animation.snapshot(1).blockedUntil).toBeLessThan(Date.now())
})

it('allows the greeting card handshake over a remote connection within the same 25-second fence', () => {
  const { item, queueId } = request()
  const preparation = prepared(item)
  preparation.assets = preparation.assets.filter(asset => asset.role !== 'intro')
  const grant = Greetings.reserve(1, socketId, queueId, {}, undefined, preparation, ready, 1)!
  const intervention = grant.transition!.intervention
  vi.advanceTimersByTime(600)
  Greetings.event(1, socketId, grant.turnKey, item.greetingId, 'start')
  vi.advanceTimersByTime(600)
  Animation.event({ roomId: 1, userId: 1, socketId }, intervention.interventionId, intervention.playerEpoch!, 'STARTED')
  Greetings.voiceEvent(1, socketId, grant.turnKey, item.greetingId, 'audioStarted')
  expect(Greetings.items(1)[0].playback?.status).toBe('PLAYING')
  expect(intervention.leaseUntil! - intervention.requestedAt).toBe(25000)
})

it('rejects late starts and retains a bounded diagnostic without replaying the greeting', () => {
  const { item, queueId } = request()
  const grant = Greetings.reserve(1, socketId, queueId, {}, undefined, prepared(item), ready, 1)!
  const intervention = grant.transition!.intervention
  Greetings.event(1, socketId, grant.turnKey, item.greetingId, 'start')
  vi.advanceTimersByTime(GREETING_START_MS + 1)
  expect(() => Animation.event({ roomId: 1, userId: 1, socketId }, intervention.interventionId, intervention.playerEpoch!, 'STARTED')).toThrow('El permiso de inicio venció')
  const reason = 'El permiso de inicio venció'
  Greetings.voiceEvent(1, socketId, grant.turnKey, item.greetingId, 'audioFailed', reason)
  expect(Greetings.items(1)[0].playback).toEqual({ status: 'FAILED', reason: `La voz no pudo completarse (${reason}). Se conservó la entrega en pantalla.` })
  Greetings.voiceEvent(1, socketId, grant.turnKey, item.greetingId, 'audioFailed', 'x'.repeat(1000))
  expect(Greetings.items(1)[0].playback?.reason?.length).toBeLessThan(350)
  expect(Greetings.items(1)[0].status).toBe('DISPLAYING')
  Animation.event({ roomId: 1, userId: 1, socketId }, intervention.interventionId, intervention.playerEpoch!, 'STOPPED')
  expect(heardAt(Animation.history(1)[0])).toBe(intervention.requestedAt)
  expect(Greetings.reserve(1, socketId, queueId, {}, undefined, prepared(item), ready, 1)).toBeNull()
})

it('keeps visual delivery available when voice is unprepared and does not count it as speech', () => {
  const { item, queueId } = request('LISTEN')
  const grant = Greetings.reserve(1, socketId, queueId, {}, undefined, prepared(item), [], 1)!
  expect(grant.transition).toBeUndefined()
  expect(grant.performer.requestIntent).toBe('LISTEN')
  expect(Animation.active(1)).toBeNull()
  expect(Greetings.items(1)[0].playback?.status).toBe('SCREEN')
  expect(voiceBudget(Animation.selectionHistory(1), Date.now())).toBe(120000)
})

it('disables public reading independently and rejects stale settings or unavailable introductions', () => {
  expect(() => Greetings.configurePlayback(1, { enabled: true, introClipId: 'missing', ambienceEnabled: true }, 1)).toThrow('disponible')
  expect(() => Greetings.configurePlayback(1, { enabled: false, introClipId: null, ambienceEnabled: true }, 0)).toThrow('cambiaron')
  Greetings.configurePlayback(1, { enabled: false, introClipId: null, ambienceEnabled: true }, 1)
  expect(Greetings.audioEnabled(1)).toBe(true)
  expect(Animation.snapshot(1).greetingVoiceEnabled).toBe(false)
})

it('reserves the chosen greeting introduction for greetings instead of announcing it without a greeting', () => {
  const { queueId } = request()
  const clip = { ...asset('intro', 1000), family: 'turn' as const, approvedForAuto: true, modes: ['mixed' as const] }
  vi.spyOn(catalog, 'catalogClips').mockReturnValue([clip])
  Greetings.configurePlayback(1, { enabled: true, introClipId: clip.id, ambienceEnabled: false }, 1)
  Animation.control(1, 0, { enabled: true, automation: true })
  Animation.session(1, 1, 'open')
  Animation.ready({ roomId: 1, userId: 1, socketId }, true, [clip.checksum])
  const snapshot = Animation.snapshot(1)
  expect(Animation.automaticPlan({ roomId: 1, userId: 1, socketId }, {
    interventionId: '', playerEpoch: snapshot.playerEpoch, controlVersion: snapshot.controlVersion, contextKey: '', transitionId: 'fixture',
    sourceQueueId: null, expectedNextQueueId: queueId, boundary: 'start',
  })).toBeNull()
})

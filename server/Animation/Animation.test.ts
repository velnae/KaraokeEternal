import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { Server } from 'socket.io'
import { open, close, db } from '../lib/Database.js'
import Animation, { type Reservation } from './Animation.js'
import Queue from '../Queue/Queue.js'
import Rooms from '../Rooms/Rooms.js'
import handlers from './socket.js'
import { loadCatalog, catalogClips, saveCatalogRecord } from './catalog.js'
import { audioUsage, backfillAudioUsage } from './usage.js'
import { animationContext, ANIMATION_CONTROL, ANIMATION_SYNC, interventionPlayback, type AnimationClip } from '../../shared/animation.js'

const identity = { roomId: 1, userId: 1, socketId: 'player-a' }
const clip: AnimationClip = { id: 'welcome', title: 'Welcome', displayText: 'Hello', checksum: 'abc', durationMs: 4000, source: 'test', license: 'test' }
let directory: string
let cleanup: () => void
const server = { of: () => ({ sockets: new Map() }) } as unknown as Server

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-26T12:00:00Z'))
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'animation-test-'))
  open({ file: path.join(directory, 'db.sqlite'), ro: false })
  db.run('INSERT INTO rooms(roomId,name,status,data) VALUES(1,\'Room\',\'open\',\'{}\'),(2,\'Other\',\'open\',\'{}\')')
  db.run('INSERT INTO users(userId,username,password,name,roleId) VALUES(1,\'operator\',\'\',\'Operator\',1)')
  cleanup = Animation.initialize(server)
  Animation.claim(1, identity.socketId)
  Animation.ready(identity, true, [clip.checksum])
  Animation.control(1, 0, { enabled: true })
})
afterEach(() => {
  cleanup()
  close()
  fs.rmSync(directory, { recursive: true, force: true })
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function reserve (overrides: Partial<Reservation> = {}, status = { queueId: -1 }) {
  const row = Animation.active(1) ?? Animation.request(identity, 'request-1', clip)
  return Animation.reserve(identity, {
    interventionId: row.interventionId, playerEpoch: Animation.state(1).playerEpoch,
    controlVersion: Animation.state(1).controlVersion, contextKey: animationContext(Queue.get(1), {}),
    sourceQueueId: null, expectedNextQueueId: null, boundary: 'idle', transitionId: 'transition-1', ...overrides,
  }, status)
}

async function automaticCatalog () {
  fs.copyFileSync(path.resolve('assets/animation/welcome.wav'), path.join(directory, 'voice.wav'))
  const records = ['welcome', 'turn', 'closing', 'goodbye', 'invitation', 'celebration'].flatMap(family => [1, 2, 3].map(index => ({
    id: `${family}-${index}`, family, kind: 'voice', title: family, displayText: `${family} variante ${index}`, filename: 'voice.wav', source: 'test', license: 'test', approvedForAuto: true, active: true,
  })))
  records.push({ id: 'ambience', family: 'manual', kind: 'ambience', title: 'ambient', displayText: 'ambient', filename: 'voice.wav', source: 'test', license: 'test', approvedForAuto: true, active: true })
  fs.writeFileSync(path.join(directory, 'catalog.json'), JSON.stringify(records))
  await loadCatalog(directory)
  Animation.ready(identity, true, catalogClips(1).map(clip => clip.checksum))
  Animation.control(1, Animation.state(1).controlVersion, { automation: true, ambienceEnabled: true })
  Animation.session(1, 1, 'open')
}

function autoInput (overrides: Partial<Reservation> = {}): Reservation {
  return { interventionId: 'auto', playerEpoch: Animation.state(1).playerEpoch, controlVersion: Animation.state(1).controlVersion,
    transitionId: 'boundary', contextKey: animationContext(Queue.get(1), {}), boundary: 'idle', sourceQueueId: null, expectedNextQueueId: null, ...overrides }
}

describe('automatic sessions and ambient authority', () => {
  it('keeps a bounded transition bed through the matching announcement without adding another bed', async () => {
    await automaticCatalog()
    Animation.ready(identity, true, catalogClips(1).map(asset => asset.checksum), true)
    const epoch = Animation.state(1).playerEpoch
    const bed = Animation.reserveTransitionAmbience(identity, epoch, { queueId: -1 }, { sourceQueueId: null, expectedNextQueueId: null })!
    expect(bed.until - Date.now()).toBe(40000)
    expect(Animation.renewAmbience(identity, epoch, bed.id, { queueId: -1 })).toBeNull()
    Animation.ambienceStarted(identity, bed.id, bed.id)
    vi.advanceTimersByTime(2000)
    const voice = Animation.automatic(identity, autoInput(), { queueId: -1 })!
    expect(voice).toBeTruthy()
    expect(interventionPlayback(voice).bed).toBeUndefined()
    Animation.event(identity, voice.interventionId, epoch, 'STARTED')
    Animation.event(identity, voice.interventionId, epoch, 'ENDED')
    expect(Animation.ambience(1)?.id).toBe(bed.id)
    expect(audioUsage(1, [bed.clip.id])[bed.clip.id].total).toBe(1)
    Animation.stopAmbience(identity, bed.id)
    expect(Animation.ambience(1)).toBeNull()
  })

  it('rejects transition beds for stale boundaries and preserves their fence across takeover', async () => {
    await automaticCatalog()
    Animation.ready(identity, true, catalogClips(1).map(asset => asset.checksum), true)
    const epoch = Animation.state(1).playerEpoch
    expect(() => Animation.reserveTransitionAmbience(identity, epoch, { queueId: 1 }, { sourceQueueId: null, expectedNextQueueId: null })).toThrow('ocupa')
    expect(() => Animation.reserveTransitionAmbience(identity, epoch, { queueId: -1 }, { sourceQueueId: null, expectedNextQueueId: 999 })).toThrow('turno')
    const bed = Animation.reserveTransitionAmbience(identity, epoch, { queueId: -1 }, { sourceQueueId: null, expectedNextQueueId: null })!
    expect(Animation.transitionAmbience(identity, 999)).toBeNull()
    expect(Animation.transitionAmbience(identity, null, 999)).toBeNull()
    const successor = { ...identity, socketId: 'successor' }
    Animation.claim(1, successor.socketId)
    Animation.ready(successor, true, catalogClips(1).map(asset => asset.checksum), true)
    expect(Animation.transitionAmbience(successor, null)).toBeNull()
    expect(Animation.reserveTransitionAmbience(successor, Animation.state(1).playerEpoch, { queueId: -1 }, { sourceQueueId: null, expectedNextQueueId: null })).toBeNull()
    Animation.stopAmbience(successor, bed.id)
    expect(Animation.ambience(1)?.id).toBe(bed.id)
    vi.advanceTimersByTime(40001)
    expect(Animation.reserveTransitionAmbience(successor, Animation.state(1).playerEpoch, { queueId: -1 }, { sourceQueueId: null, expectedNextQueueId: null })).toBeTruthy()
  })

  it('persists a fixed ambience per room and rejects stale or foreign selections', async () => {
    await automaticCatalog()
    await saveCatalogRecord({ id: 'foreign-bed', roomId: 2, filename: 'voice.wav', active: true, kind: 'ambience', approvedForAuto: true })
    const version = Animation.state(1).controlVersion
    Animation.control(1, version, { ambienceClipId: 'ambience' })
    expect(Animation.room(1).prefs.animation.ambienceClipId).toBe('ambience')
    expect(Animation.snapshot(2).prefs.ambienceClipId).toBeNull()
    expect(() => Animation.control(1, version, { ambienceClipId: null })).toThrow('cambiaron')
    for (const id of ['foreign-bed', 'welcome-1', 'missing']) {
      expect(() => Animation.control(1, version + 1, { ambienceClipId: id })).toThrow('ambiente')
    }
    cleanup()
    cleanup = Animation.initialize(server)
    expect(Animation.snapshot(1).prefs.ambienceClipId).toBe('ambience')
    Animation.control(1, version + 1, { ambienceClipId: null })
    expect(Animation.snapshot(1).prefs.ambienceClipId).toBeNull()
  })

  it('restricts idle playback and renewals to the fixed sound, then restores rotation', async () => {
    await automaticCatalog()
    fs.copyFileSync(path.resolve('assets/animation/thanks.wav'), path.join(directory, 'other.wav'))
    await saveCatalogRecord({ id: 'other-bed', roomId: 1, filename: 'other.wav', active: true, kind: 'ambience', approvedForAuto: true })
    Animation.ready(identity, true, catalogClips(1).map(asset => asset.checksum), true)
    Animation.control(1, Animation.state(1).controlVersion, { ambienceClipId: 'other-bed' })
    const epoch = Animation.state(1).playerEpoch
    const fixed = Animation.reserveAmbience(identity, epoch, { queueId: -1 }, 'ambience', 500)!
    expect(fixed).toMatchObject({ clip: { id: 'other-bed' }, rotate: false, offsetMs: 0 })
    expect(Animation.renewAmbience(identity, epoch, fixed.id, { queueId: -1 })?.rotate).toBe(false)
    Animation.control(1, Animation.state(1).controlVersion, { ambienceClipId: 'ambience' })
    expect(Animation.renewAmbience(identity, epoch, fixed.id, { queueId: -1 })).toBeNull()
    expect(Animation.snapshot(1).ambience?.id).toBe(fixed.id)
    Animation.stopAmbience(identity, fixed.id)
    const selected = Animation.reserveAmbience(identity, epoch, { queueId: -1 })!
    expect(selected.clip.id).toBe('ambience')
    Animation.control(1, Animation.state(1).controlVersion, { ambienceClipId: null })
    expect(Animation.renewAmbience(identity, epoch, selected.id, { queueId: -1 })?.rotate).toBe(true)
    Animation.stopAmbience(identity, selected.id)
    expect(Animation.reserveAmbience(identity, epoch, { queueId: -1 }, selected.clip.id, selected.clip.durationMs)?.clip.id).toBe('other-bed')
  })

  it.each(['disabled', 'expired', 'profile', 'unapproved'])('does not replace a fixed ambience that becomes %s', async (unavailable) => {
    await automaticCatalog()
    await saveCatalogRecord({ id: 'selected-bed', roomId: 1, filename: 'voice.wav', active: true, kind: 'ambience', approvedForAuto: true })
    Animation.control(1, Animation.state(1).controlVersion, { ambienceClipId: 'selected-bed' })
    const epoch = Animation.state(1).playerEpoch
    const grant = Animation.reserveAmbience(identity, epoch, { queueId: -1 })!
    if (unavailable === 'disabled') db.run('UPDATE audioResources SET state=\'disabled\' WHERE id=\'selected-bed\'')
    else if (unavailable === 'expired') db.run('UPDATE audioResources SET metadataJSON=json_set(metadataJSON,\'$.validUntil\',?) WHERE id=\'selected-bed\'', [Date.now() - 1])
    else if (unavailable === 'profile') db.run('UPDATE audioResources SET metadataJSON=json_set(metadataJSON,\'$.modes\',json(\'["party"]\')) WHERE id=\'selected-bed\'')
    else db.run('UPDATE audioResources SET metadataJSON=json_set(metadataJSON,\'$.automatic\',json(\'false\')) WHERE id=\'selected-bed\'')
    expect(Animation.renewAmbience(identity, epoch, grant.id, { queueId: -1 })).toBeNull()
    Animation.stopAmbience(identity, grant.id)
    expect(Animation.reserveAmbience(identity, epoch, { queueId: -1 })).toBeNull()
    Animation.ready(identity, true, catalogClips(1).map(asset => asset.checksum), true)
    const announcement = Animation.automatic(identity, autoInput(), { queueId: -1 })!
    expect(announcement).toBeTruthy()
    expect(interventionPlayback(announcement).bed).toBeUndefined()
  })

  it('grants a prepared concurrent bed without increasing the announcement duration', async () => {
    await automaticCatalog()
    await saveCatalogRecord({ id: 'chosen-bed', roomId: 1, filename: 'voice.wav', active: true, kind: 'ambience', approvedForAuto: true })
    Animation.control(1, Animation.state(1).controlVersion, { ambienceClipId: 'chosen-bed' })
    Animation.ready(identity, true, catalogClips(1).map(asset => asset.checksum), true)
    const grant = Animation.automatic(identity, autoInput(), { queueId: -1 })!
    const { sequence, bed } = interventionPlayback(grant)
    expect(bed?.kind).toBe('ambience')
    expect(bed?.id).toBe('chosen-bed')
    expect(sequence.every(asset => asset.kind !== 'ambience')).toBe(true)
    expect(grant.durationMs).toBe(sequence.reduce((sum, asset) => sum + asset.durationMs, 0))
    Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'STARTED')
    Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'ASSET_STARTED', bed!.id)
    Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'ASSET_STARTED', bed!.id)
    expect(audioUsage(1, [bed!.id])[bed!.id].total).toBe(1)
  })

  it('does not append a bed for older players that would play it sequentially', async () => {
    await automaticCatalog()
    const grant = Animation.automatic(identity, autoInput(), { queueId: -1 })!
    expect(interventionPlayback(grant).bed).toBeUndefined()
  })

  it('keeps a ready voice eligible when the optional ambience is not decoded', async () => {
    await automaticCatalog()
    fs.copyFileSync(path.resolve('assets/animation/thanks.wav'), path.join(directory, 'bed.wav'))
    db.run('UPDATE audioResources SET state=\'disabled\' WHERE id=\'ambience\'')
    await saveCatalogRecord({ id: 'unprepared-bed', roomId: 1, filename: 'bed.wav', active: true, kind: 'ambience', family: 'manual', modes: ['mixed'], approvedForAuto: true })
    Animation.control(1, Animation.state(1).controlVersion, { ambienceClipId: 'unprepared-bed' })
    const voices = catalogClips(1).filter(asset => asset.kind === 'voice')
    Animation.ready(identity, true, voices.map(asset => asset.checksum), true)
    const grant = Animation.automatic(identity, autoInput(), { queueId: -1 })!
    expect(grant).toBeTruthy()
    expect(interventionPlayback(grant).bed).toBeUndefined()
    expect(interventionPlayback(grant).sequence[0].kind).toBe('voice')
  })

  it('does not treat a transition separator or bed as closing applause for the cooldown', async () => {
    await automaticCatalog()
    Animation.control(1, Animation.state(1).controlVersion, { events: { turn: false, celebration: false, welcome: false } })
    db.run('UPDATE animationRoomState SET pendingEventJSON=NULL WHERE roomId=1')
    for (let id = 1; id <= 3; id++) db.run('INSERT INTO queue(queueId,roomId,userId,source,externalId,title,artistOrChannel,status,prevQueueId) VALUES(?,1,1,\'YOUTUBE\',\'abcdefghijk\',\'Song\',\'Artist\',\'APPROVED\',?)', [id, id === 1 ? null : id - 1])
    await saveCatalogRecord({ id: 'separator', roomId: 1, filename: 'voice.wav', active: true, kind: 'effect', effectType: 'transition', category: 'transition', family: 'manual', modes: ['mixed'], approvedForAuto: true })
    Animation.ready(identity, true, catalogClips(1).map(asset => asset.checksum), true)
    Queue.transition(1, 1, 'PLAYING')
    const first = Animation.automatic(identity, autoInput({ boundary: 'ended', sourceQueueId: 1, expectedNextQueueId: 2 }), { queueId: 1 })!
    expect(interventionPlayback(first).sequence.some(asset => asset.id === 'separator')).toBe(true)
    Animation.event(identity, first.interventionId, first.playerEpoch!, 'STARTED')
    Animation.event(identity, first.interventionId, first.playerEpoch!, 'ASSET_STARTED', 'separator')
    Animation.event(identity, first.interventionId, first.playerEpoch!, 'ASSET_STARTED', 'ambience')
    Animation.event(identity, first.interventionId, first.playerEpoch!, 'ENDED')
    await saveCatalogRecord({ id: 'applause', roomId: 1, filename: 'voice.wav', active: true, kind: 'effect', category: 'appreciation', family: 'manual', modes: ['mixed'], approvedForAuto: true })
    Animation.ready(identity, true, catalogClips(1).map(asset => asset.checksum), true)
    Queue.transition(1, 2, 'PLAYING')
    const second = Animation.automatic(identity, autoInput({ boundary: 'ended', sourceQueueId: 2, expectedNextQueueId: 3 }), { queueId: 2 })!
    expect(interventionPlayback(second).sequence.some(asset => asset.id === 'applause')).toBe(true)
  })

  it('runs repeated natural song boundaries with one clip per family and contextual effects', async () => {
    await automaticCatalog()
    db.run('UPDATE animationRoomState SET pendingEventJSON=NULL WHERE roomId=1')
    db.run('UPDATE audioResources SET state=\'disabled\' WHERE kind=\'voice\' AND id NOT IN (\'turn-1\',\'closing-1\',\'celebration-1\')')
    db.run('UPDATE audioResources SET metadataJSON=json_set(metadataJSON,\'$.celebrationMode\',\'song_end\') WHERE id=\'celebration-1\'')
    for (const category of ['appreciation', 'celebration', 'anticipation', 'transition']) {
      await saveCatalogRecord({ id: `fx-${category}`, roomId: 1, filename: 'voice.wav', active: true, kind: 'effect', category,
        effectType: category === 'transition' ? 'transition' : 'short', family: 'manual', modes: ['mixed'], approvedForAuto: true })
    }
    await saveCatalogRecord({ id: 'birthday', roomId: 1, filename: 'voice.wav', active: true, kind: 'voice', displayText: 'Feliz cumpleaños', family: 'celebration', modes: ['mixed'], approvedForAuto: true })
    Animation.ready(identity, true, catalogClips(1).map(clip => clip.checksum))
    for (let id = 1; id <= 10; id++) db.run('INSERT INTO queue(queueId,roomId,userId,source,externalId,title,artistOrChannel,status,prevQueueId) VALUES(?,1,1,\'YOUTUBE\',\'abcdefghijk\',\'Song\',\'Artist\',\'APPROVED\',?)', [id, id === 1 ? null : id - 1])
    const finish = (grant: NonNullable<ReturnType<typeof Animation.automatic>>) => {
      expect(grant.clipId).not.toBe('birthday')
      Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'STARTED')
      for (const asset of JSON.parse(grant.sequenceJSON!).slice(1)) Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'ASSET_STARTED', asset.id)
      Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'ENDED')
    }
    finish(Animation.automatic(identity, autoInput({ boundary: 'start', expectedNextQueueId: 1 }), { queueId: -1 })!)
    for (let id = 1; id <= 9; id++) {
      vi.advanceTimersByTime(65000)
      Queue.transition(1, id, 'PLAYING')
      const input = autoInput({ boundary: 'ended', sourceQueueId: id, expectedNextQueueId: id + 1 })
      const grant = Animation.automatic(identity, input, { queueId: id })!
      expect(grant).toBeTruthy()
      finish(grant)
      expect(Animation.automatic(identity, input, { queueId: id })).toBeNull()
    }
    const history = Animation.selectionHistory(1)
    for (const family of ['turn', 'closing', 'celebration']) expect(history.filter(row => row.family === family).length).toBeGreaterThanOrEqual(3)
    const uses = audioUsage(1, ['fx-appreciation', 'fx-celebration', 'fx-anticipation', 'fx-transition'])
    expect(uses['fx-appreciation'].total).toBe(1)
    for (const id of ['fx-celebration', 'fx-anticipation', 'fx-transition']) expect(uses[id].total).toBeGreaterThanOrEqual(3)
  })

  it('rotates environmental families and reuses them without exhausting the jornada', async () => {
    await automaticCatalog()
    db.run('UPDATE animationRoomState SET pendingEventJSON=NULL WHERE roomId=1')
    for (const family of ['booth', 'promotion'] as const) await saveCatalogRecord({ id: family, roomId: 1, filename: 'voice.wav', active: true, kind: 'voice', family, displayText: family, modes: ['mixed'], approvedForAuto: true, validUntil: Date.now() + 86400000 })
    Animation.control(1, Animation.state(1).controlVersion, { events: { booth: true, promotion: true } })
    Animation.ready(identity, true, catalogClips(1).map(clip => clip.checksum))
    for (const family of ['invitation', 'booth', 'promotion', 'invitation']) {
      vi.advanceTimersByTime(13 * 60000)
      const grant = Animation.automatic(identity, autoInput(), { queueId: -1 })!
      expect(grant.family).toBe(family)
      Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'STARTED')
      Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'ENDED')
    }
    vi.advanceTimersByTime(61 * 60000)
    expect(Animation.automaticPlan(identity, autoInput())?.family).toBe('booth')
  })

  it('moves to the next ambience after a full file, including a non-looping resource', async () => {
    await automaticCatalog()
    fs.copyFileSync(path.resolve('assets/animation/thanks.wav'), path.join(directory, 'next.wav'))
    await saveCatalogRecord({ id: 'next-ambience', roomId: 1, filename: 'next.wav', active: true, kind: 'ambience', family: 'manual', modes: ['mixed'], loop: false, approvedForAuto: true })
    Animation.ready(identity, true, catalogClips(1).map(clip => clip.checksum))
    const epoch = Animation.state(1).playerEpoch
    const first = Animation.reserveAmbience(identity, epoch, { queueId: -1 })!
    expect(first.rotate).toBe(true)
    Animation.ambienceStarted(identity, first.id, 'first')
    Animation.stopAmbience(identity, first.id)
    const second = Animation.reserveAmbience(identity, epoch, { queueId: -1 }, first.clip.id, first.clip.durationMs)!
    expect(second.clip.id).not.toBe(first.clip.id)
    Animation.ambienceStarted(identity, second.id, 'second')
    Animation.stopAmbience(identity, second.id)
    expect(Animation.reserveAmbience(identity, epoch, { queueId: -1 }, second.clip.id, second.clip.durationMs)?.clip.id).toBe(first.clip.id)
  })

  it('does not report a voice as heard when only its leading effect started', () => {
    const pending = Animation.request(identity, 'prefixed', clip)
    const effect = { ...clip, id: 'intro-fx', kind: 'effect', checksum: 'fx', durationMs: 1000 }
    db.run('UPDATE animationInterventions SET sequenceJSON=?,durationMs=5000 WHERE interventionId=?', [JSON.stringify([effect, clip]), pending.interventionId])
    Animation.ready(identity, true, [clip.checksum, 'fx'])
    const grant = reserve()
    Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'STARTED')
    Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'STOPPED')
    backfillAudioUsage()
    expect(audioUsage(1, [effect.id, clip.id])).toMatchObject({ 'intro-fx': { total: 1 }, [clip.id]: { total: 0 } })
  })

  it('probes idle announcements without consuming events or stopping ambience', async () => {
    await automaticCatalog()
    const ambient = Animation.reserveAmbience(identity, Animation.state(1).playerEpoch, { queueId: -1 })!
    expect(Animation.automaticPlan(identity, autoInput())?.family).toBe('welcome')
    expect(Animation.active(1)).toBeNull()
    expect(Animation.history(1)).toHaveLength(0)
    expect(Animation.ambience(1)?.id).toBe(ambient.id)
    expect(Animation.state(1).pendingEventJSON).not.toBeNull()
    expect(Animation.automatic(identity, autoInput(), { queueId: -1 })).toBeNull()
  })

  it('renews the same ambient permit only while authority and an idle room remain valid', async () => {
    await automaticCatalog()
    const epoch = Animation.state(1).playerEpoch
    const ambient = Animation.reserveAmbience(identity, epoch, { queueId: -1 })!
    vi.advanceTimersByTime(2000)
    const renewed = Animation.renewAmbience(identity, epoch, ambient.id, { queueId: -1 })!
    expect(renewed.id).toBe(ambient.id)
    expect(renewed.until).toBeGreaterThan(ambient.until)
    expect(Animation.renewAmbience(identity, epoch, ambient.id, { queueId: 1 })).toBeNull()
    expect(() => Animation.renewAmbience({ ...identity, socketId: 'other' }, epoch, ambient.id, { queueId: -1 })).toThrow('autoridad')
    Animation.request(identity, 'manual', catalogClips(1).find(clip => clip.kind === 'voice')!)
    expect(Animation.renewAmbience(identity, epoch, ambient.id, { queueId: -1 })).toBeNull()
    Animation.cancel(1)
    vi.advanceTimersByTime(11000)
    expect(Animation.renewAmbience(identity, epoch, ambient.id, { queueId: -1 })).toBeNull()
  })

  it('routes appreciation to closing and celebration to celebration, with persistent closing applause cooldown', async () => {
    await automaticCatalog()
    for (const category of ['appreciation', 'celebration', 'anticipation']) {
      await saveCatalogRecord({ id: category, roomId: 1, filename: 'voice.wav', active: true, kind: 'effect', category, family: 'celebration', modes: ['mixed', 'party', 'dinner'], approvedForAuto: true })
    }
    Animation.ready(identity, true, catalogClips(1).map(clip => clip.checksum))
    db.run('UPDATE animationRoomState SET pendingEventJSON=NULL WHERE roomId=1')
    const finish = (grant: NonNullable<ReturnType<typeof Animation.automatic>>, effect = true) => {
      Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'STARTED')
      if (effect) for (const asset of JSON.parse(grant.sequenceJSON!).slice(1)) Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'ASSET_STARTED', asset.id)
      Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'ENDED')
    }
    const closeSong = (id: number) => {
      db.run(`INSERT INTO queue(queueId,roomId,userId,source,externalId,title,artistOrChannel,status) VALUES(?,1,1,'YOUTUBE','abcdefghijk','Song','Artist','PLAYING')`, [id])
      return Animation.automatic(identity, autoInput({ boundary: 'ended', sourceQueueId: id }), { queueId: id })!
    }
    const first = closeSong(1)
    expect(JSON.parse(first.sequenceJSON!)[1].id).toBe('appreciation')
    finish(first)
    Animation.session(1, 1, 'celebrate')
    const celebration = Animation.automatic(identity, autoInput(), { queueId: -1 })!
    expect(JSON.parse(celebration.sequenceJSON!).map((asset: AnimationClip) => asset.kind === 'voice' ? 'voice' : asset.id)).toEqual(['anticipation', 'voice', 'celebration'])
    finish(celebration)
    expect(JSON.parse(closeSong(2).sequenceJSON!)).toHaveLength(1)
    Animation.cancel(1)
    vi.advanceTimersByTime(601000)
    const later = closeSong(3)
    expect(JSON.parse(later.sequenceJSON!)[1].id).toBe('appreciation')
    finish(later)
    Animation.control(1, Animation.state(1).controlVersion, { profile: 'dinner' })
    Animation.session(1, 1, 'celebrate')
    expect(JSON.parse(Animation.automatic(identity, autoInput(), { queueId: -1 })!.sequenceJSON!)).toHaveLength(1)
  })

  it('uses other enabled families between songs instead of starving them behind presentations', async () => {
    await automaticCatalog()
    db.run('UPDATE animationRoomState SET pendingEventJSON=NULL WHERE roomId=1')
    db.run(`INSERT INTO queue(queueId,roomId,userId,source,externalId,title,artistOrChannel,status,prevQueueId)
      VALUES(1,1,1,'YOUTUBE','abcdefghijk','First','Artist','PLAYING',NULL),(2,1,1,'YOUTUBE','bcdefghijkl','Next','Artist','APPROVED',1)`)
    const input = autoInput({ boundary: 'ended', sourceQueueId: 1, expectedNextQueueId: 2 })
    expect(Animation.automaticPlan(identity, input)?.family).toBe('closing')
    Animation.control(1, Animation.state(1).controlVersion, { events: { turn: false, closing: false } })
    expect(Animation.automaticPlan(identity, input)).toBeNull()
  })

  it('counts ambience once across permit renewals and rejects stale or foreign acknowledgements', async () => {
    await automaticCatalog()
    const epoch = Animation.state(1).playerEpoch
    const first = Animation.reserveAmbience(identity, epoch, { queueId: -1 })!
    expect(audioUsage(1, [first.clip.id])[first.clip.id].total).toBe(0)
    Animation.ambienceStarted(identity, first.id, 'run-one')
    Animation.ambienceStarted(identity, first.id, 'run-one')
    Animation.stopAmbience(identity, first.id)
    const next = Animation.reserveAmbience(identity, epoch, { queueId: -1 })!
    Animation.ambienceStarted(identity, next.id, 'run-one')
    expect(audioUsage(1, [first.clip.id])[first.clip.id].total).toBe(1)
    expect(() => Animation.ambienceStarted({ ...identity, socketId: 'other' }, next.id, 'forged')).toThrow('Permiso')
    expect(() => Animation.ambienceStarted(identity, first.id, 'stale')).toThrow('Permiso')
    Animation.stopAmbience(identity, next.id)
    const restarted = Animation.reserveAmbience(identity, epoch, { queueId: -1 })!
    Animation.ambienceStarted(identity, restarted.id, 'run-two')
    expect(audioUsage(1, [first.clip.id])[first.clip.id].total).toBe(2)
  })

  it('records an effect only after its own confirmed start, without counting duplicate acknowledgements', () => {
    const pending = Animation.request(identity, 'sequence', clip)
    const effect = { ...clip, id: 'effect', kind: 'effect', checksum: 'fx', durationMs: 1000 }
    db.run('UPDATE animationInterventions SET sequenceJSON=?,durationMs=5000 WHERE interventionId=?', [JSON.stringify([clip, effect]), pending.interventionId])
    Animation.ready(identity, true, [clip.checksum, 'fx'])
    const grant = reserve()
    expect(() => Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'ASSET_STARTED', effect.id)).toThrow('activa')
    Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'STARTED')
    expect(audioUsage(1, [clip.id, effect.id])).toMatchObject({ [clip.id]: { total: 1 }, effect: { total: 0 } })
    Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'ASSET_STARTED', effect.id)
    Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'ASSET_STARTED', effect.id)
    expect(audioUsage(1, [effect.id]).effect.total).toBe(1)
    expect(() => Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'ASSET_STARTED', 'another')).toThrow('activa')
  })
  it('opens a real session once and does not repeat its welcome after restart', async () => {
    await automaticCatalog()
    const sessionId = Animation.snapshot(1).session!.sessionId
    Animation.session(1, 1, 'open')
    expect(Animation.snapshot(1).session?.sessionId).toBe(sessionId)
    const grant = Animation.automatic(identity, autoInput(), { queueId: -1 })!
    expect(grant.family).toBe('welcome')
    Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'STARTED')
    Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'ENDED')
    cleanup()
    cleanup = Animation.initialize(server)
    Animation.claim(1, identity.socketId)
    Animation.ready(identity, true, catalogClips(1).map(clip => clip.checksum))
    expect(Animation.snapshot(1).session?.sessionId).toBe(sessionId)
    expect(Animation.automatic(identity, autoInput(), { queueId: -1 })).toBeNull()
    expect(Animation.history(1)).toHaveLength(1)
  })

  it('deduplicates a confirmed next turn independently of player epoch', async () => {
    await automaticCatalog()
    db.run(`INSERT INTO queue(queueId,roomId,songId,userId,source,externalId,title,artistOrChannel,status,prevQueueId)
      VALUES(1,1,NULL,1,'YOUTUBE','abcdefghijk','First','Artist','PLAYING',NULL),(2,1,NULL,1,'YOUTUBE','bcdefghijkl','Second','Artist','APPROVED',1)`)
    const input = () => autoInput({ boundary: 'ended', sourceQueueId: 1, expectedNextQueueId: 2 })
    const grant = Animation.automatic(identity, input(), { queueId: 1 })!
    Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'STARTED')
    Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'ENDED')
    Animation.disconnect(1, identity.socketId)
    Animation.claim(1, identity.socketId)
    Animation.ready(identity, true, catalogClips(1).map(clip => clip.checksum))
    expect(Animation.automatic(identity, input(), { queueId: 1 })).toBeNull()
    expect(Animation.history(1)).toHaveLength(1)
    expect(Animation.automatic(identity, { ...input(), replay: true }, { queueId: 1 })).toBeNull()
  })

  it('prioritizes a manual request and rejects a stale automatic context', async () => {
    await automaticCatalog()
    const manual = Animation.request(identity, 'manual', catalogClips(1).find(clip => clip.kind === 'voice')!)
    expect(Animation.automatic(identity, autoInput(), { queueId: -1 })).toBeNull()
    expect(Animation.active(1)?.interventionId).toBe(manual.interventionId)
    Animation.cancel(1)
    expect(() => Animation.automatic(identity, autoInput({ contextKey: 'obsolete' }), { queueId: -1 })).toThrow('contexto')
    expect(Animation.active(1)).toBeNull()
  })

  it('does not append a waiting welcome after a manual announcement claimed the same pause', async () => {
    await automaticCatalog()
    Animation.request(identity, 'manual-priority', catalogClips(1).find(clip => clip.kind === 'voice')!)
    const grant = reserve()
    Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'STARTED')
    Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'ENDED')
    expect(Animation.automatic(identity, autoInput(), { queueId: -1 })).toBeNull()
    expect(Animation.history(1)).toHaveLength(1)
    expect(Animation.state(1).lastOmission).toContain('anuncio prioritario')
  })

  it('finishes closing sessions after the deadline without holding music', async () => {
    await automaticCatalog()
    Animation.session(1, 1, 'close')
    expect(Animation.snapshot(1).session?.status).toBe('CLOSING')
    vi.advanceTimersByTime(60001)
    expect(Animation.snapshot(1).session).toBeNull()
    expect(Animation.history(1)).toHaveLength(0)
    expect(Animation.state(1).blockedUntil).toBe(0)
  })

  it('does not grant ambience during a loaded/paused song and releases it before voice', async () => {
    await automaticCatalog()
    const epoch = Animation.state(1).playerEpoch
    expect(Animation.reserveAmbience(identity, epoch, { queueId: 1 })).toBeNull()
    const grant = Animation.reserveAmbience(identity, epoch, { queueId: -1 })!
    expect(grant.durationMs).toBeLessThanOrEqual(10000)
    Animation.request(identity, 'manual', catalogClips(1).find(clip => clip.kind === 'voice')!)
    expect(() => reserve()).toThrow('sala no permite')
    Animation.stopAmbience(identity, grant.id)
    expect(reserve().status).toBe('RESERVED')
  })

  it('fences ambient takeover until the old finite permit expires', async () => {
    await automaticCatalog()
    const grant = Animation.reserveAmbience(identity, Animation.state(1).playerEpoch, { queueId: -1 })!
    Animation.disconnect(1, identity.socketId)
    const successor = { ...identity, socketId: 'player-b' }
    Animation.claim(1, successor.socketId)
    Animation.ready(successor, true, catalogClips(1).map(clip => clip.checksum))
    expect(Animation.reserveAmbience(successor, Animation.state(1).playerEpoch, { queueId: -1 })).toBeNull()
    vi.advanceTimersByTime(grant.until - Date.now() + 1)
    expect(Animation.reserveAmbience(successor, Animation.state(1).playerEpoch, { queueId: -1 })).not.toBeNull()
  })

  it('retains a valid manual request when the rolling budget is exhausted', () => {
    for (let index = 0; index < 30; index++) {
      Animation.request(identity, `budget-${index}`, clip)
      const grant = reserve()
      Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'STARTED')
      Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'ENDED')
    }
    expect(Animation.snapshot(1).voiceBudgetRemainingMs).toBe(0)
    Animation.request(identity, 'waiting-budget', clip)
    expect(() => reserve()).toThrow('Presupuesto')
    expect(Animation.active(1)?.status).toBe('PENDING')
  })
})

describe('manual animation lifecycle', () => {
  it('accepts a pending request before unlock but forbids public playback until ready', () => {
    Animation.ready(identity, false, [])
    const request = Animation.request(identity, 'before-unlock', clip)
    expect(request.status).toBe('PENDING')
    expect(() => reserve()).toThrow('audio no está preparado')
    expect(Animation.active(1)?.startedAt).toBeNull()
    Animation.ready(identity, true, [clip.checksum])
    const grant = reserve()
    expect(grant.interventionId).toBe(request.interventionId)
    Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'STARTED')
    Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'ENDED')
    expect(Animation.history(1)[0].status).toBe('PLAYED')
  })

  it('deduplicates submissions without changing their terminal result', () => {
    const row = Animation.request(identity, 'same', clip)
    expect(Animation.request(identity, 'same', clip).interventionId).toBe(row.interventionId)
    Animation.cancel(1)
    expect(Animation.request(identity, 'same', clip).status).toBe('CANCELLED')
    expect(Animation.history(1)).toHaveLength(1)
  })

  it('allows only one active request and isolates rooms', () => {
    Animation.request(identity, 'first', clip)
    expect(() => Animation.request({ ...identity, userId: 2 }, 'second', clip)).toThrow('intervención')
    expect(Animation.snapshot(2).active).toBeNull()
    expect(Animation.history(2)).toHaveLength(0)
  })

  it('reserves, records actual start and ends exactly once without reviving terminal state', () => {
    const grant = reserve()
    expect(grant.status).toBe('RESERVED')
    expect(grant.startedAt).toBeNull()
    Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'STARTED')
    vi.advanceTimersByTime(200)
    Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'STARTED')
    expect(Animation.active(1)?.startedAt).toBe(grant.startBefore! - 1000)
    Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'ENDED')
    Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'ENDED')
    Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'STARTED')
    expect(Animation.history(1)[0].status).toBe('PLAYED')
    expect(Animation.state(1).blockedUntil).toBe(0)
  })

  it('does not treat an end without a known start as delivered', () => {
    const grant = reserve()
    Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'ENDED')
    expect(Animation.history(1)[0].status).toBe('UNCERTAIN')
  })

  it('keeps the fence until a requested stop is confirmed', () => {
    const grant = reserve()
    Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'STARTED')
    Animation.cancel(1)
    expect(Animation.active(1)?.status).toBe('PLAYING')
    expect(Animation.state(1).blockedUntil).toBe(grant.leaseUntil)
    Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'STOPPED')
    expect(Animation.history(1)[0].status).toBe('INTERRUPTED')
    expect(Animation.state(1).blockedUntil).toBe(0)
  })

  it('records a cancelled grant as not started only on player confirmation', () => {
    const grant = reserve()
    Animation.cancel(1)
    expect(Animation.active(1)?.status).toBe('RESERVED')
    expect(() => Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'STARTED')).toThrow('venció')
    Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'NOT_STARTED')
    expect(Animation.history(1)[0].status).toBe('CANCELLED')
  })

  it('expires pending work, but treats missing playback acknowledgements as uncertain', () => {
    Animation.request(identity, 'old', clip)
    vi.advanceTimersByTime(600001)
    expect(Animation.history(1)[0].status).toBe('EXPIRED')
    const grant = reserve()
    vi.advanceTimersByTime(6000)
    expect(Animation.history(1)[0].status).toBe('UNCERTAIN')
    Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'STARTED')
    expect(Animation.active(1)).toBeNull()
  })

  it('rejects idle reservations while a song is paused or loading', () => {
    expect(() => reserve({}, { queueId: 1 })).toThrow('ocupa')
  })

  it('rejects stale scheduling context and a changed next item', () => {
    expect(() => reserve({ contextKey: 'stale' })).toThrow('contexto')
    expect(() => reserve({ expectedNextQueueId: 999 })).toThrow('turno')
  })

  it('rejects stale microphone controls while preserving the volume guard', () => {
    Animation.request(identity, 'first', clip)
    expect(() => Animation.control(1, 1, { microphoneOccupied: true })).toThrow('ya no existe')
    expect(Animation.history(1)[0].status).toBe('PENDING')
    Animation.control(1, 1, { volume: 0 })
    expect(() => Animation.request(identity, 'second', clip)).toThrow('volumen')
  })

  it('rejects stale operator versions and preserves unrelated room settings', () => {
    db.run('UPDATE rooms SET data = json_set(data, \'$.prefs.tables.mode\', \'REQUIRED_QR\') WHERE roomId = 1')
    expect(() => Animation.control(1, 0, { enabled: false })).toThrow('cambiaron')
    Animation.control(1, 1, { volume: 0.3 })
    expect(Animation.room(1).prefs.tables.mode).toBe('REQUIRED_QR')
    expect(Animation.snapshot(1).prefs.volume).toBe(0.3)
  })

  it('does not let an old room-editor snapshot overwrite live animation settings', async () => {
    await Rooms.set(1, { name: 'Room', status: 'open', prefs: { animation: { enabled: false, volume: 0.1 } } })
    expect(Animation.snapshot(1).prefs).toMatchObject({ enabled: true, volume: 0.5, automation: false, ambienceEnabled: false })
  })

  it('fences takeover and preserves uncertain results across restart', () => {
    const grant = reserve()
    Animation.disconnect(1, identity.socketId)
    Animation.claim(1, 'player-b')
    expect(Animation.state(1).playerEpoch).toBe(grant.playerEpoch! + 1)
    expect(Animation.state(1).blockedUntil).toBe(grant.leaseUntil)
    expect(() => Animation.request({ ...identity, socketId: 'player-b' }, 'new', clip)).toThrow('recuperación')
    cleanup()
    cleanup = Animation.initialize(server)
    expect(Animation.history(1)[0].status).toBe('UNCERTAIN')
    expect(Animation.state(1).blockedUntil).toBe(grant.leaseUntil)
  })

  it('clears legacy microphone state across restart', () => {
    db.run('UPDATE animationRoomState SET microphoneOccupied=1 WHERE roomId=1')
    cleanup()
    cleanup = Animation.initialize(server)
    expect(Animation.state(1).microphoneOccupied).toBe(0)
  })

  it('rejects another socket or epoch reporting a playback outcome', () => {
    const grant = reserve()
    expect(() => Animation.event({ ...identity, socketId: 'intruder' }, grant.interventionId, grant.playerEpoch!, 'STARTED')).toThrow('permiso')
    expect(() => Animation.event(identity, grant.interventionId, grant.playerEpoch! + 1, 'STARTED')).toThrow('permiso')
  })

  it('revalidates room context when accepting the actual start', () => {
    const grant = reserve()
    db.run('UPDATE rooms SET data = json_set(data, \'$.prefs.queue.rotationMode\', \'FIFO\') WHERE roomId = 1')
    expect(() => Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'STARTED')).toThrow('contexto')
    expect(Animation.active(1)?.stopRequestedAt).not.toBeNull()
    expect(Animation.active(1)?.startedAt).toBeNull()
  })

  it('rejects an expired start window while retaining the uncertainty fence', () => {
    const grant = reserve()
    vi.advanceTimersByTime(1001)
    expect(() => Animation.event(identity, grant.interventionId, grant.playerEpoch!, 'STARTED')).toThrow('venció')
    expect(Animation.state(1).blockedUntil).toBe(grant.leaseUntil)
  })

  it('does not crash when a player disconnects after its room was deleted', () => {
    Animation.request(identity, 'request', clip)
    db.run('DELETE FROM rooms WHERE roomId=1')
    expect(() => Animation.disconnect(1, identity.socketId)).not.toThrow()
    expect(Animation.history(1)).toHaveLength(0)
  })

  it('settles a natural end without marking the upcoming song PLAYING', () => {
    db.run(`INSERT INTO queue(queueId,roomId,songId,userId,source,externalId,title,artistOrChannel,status,prevQueueId)
      VALUES(1,1,NULL,1,'YOUTUBE','abcdefghijk','First','Artist','PLAYING',NULL),(2,1,NULL,1,'YOUTUBE','bcdefghijkl','Second','Artist','APPROVED',1)`)
    reserve({ boundary: 'ended', sourceQueueId: 1, expectedNextQueueId: 2, contextKey: animationContext(Queue.get(1), {}) }, { queueId: 1 })
    expect(db.get<{ status: string }>('SELECT status FROM queue WHERE queueId=1')?.status).toBe('PLAYED')
    expect(db.get<{ status: string }>('SELECT status FROM queue WHERE queueId=2')?.status).toBe('APPROVED')
  })
})

describe('animation command boundary', () => {
  const socket = (isAdmin: boolean) => ({ id: 'operator', user: { roomId: 1, userId: 1, isAdmin } })
  it('rejects participant control and snapshot access', () => {
    const ack = vi.fn()
    handlers[ANIMATION_SYNC](socket(false), {}, ack)
    expect(ack.mock.calls[0][0].error).toContain('autorización')
  })
  it('rejects expired commands instead of replaying them on reconnect', () => {
    const ack = vi.fn()
    handlers[ANIMATION_CONTROL](socket(true), { payload: { enabled: false, controlVersion: 1, expiresAt: Date.now() - 1 } }, ack)
    expect(ack.mock.calls[0][0].error).toContain('venció')
    expect(Animation.snapshot(1).prefs.enabled).toBe(true)
  })
  it('validates volume and boolean payloads', () => {
    for (const patch of [{ volume: -1 }, { volume: NaN }, { enabled: 'yes' }, { ambienceClipId: 1 }, { ambienceClipId: '' }, { ambienceClipId: [] }]) {
      const ack = vi.fn()
      handlers[ANIMATION_CONTROL](socket(true), { payload: { ...patch, controlVersion: 1, expiresAt: Date.now() + 1000 } }, ack)
      expect(ack.mock.calls[0][0].error).toBeTruthy()
    }
  })
})

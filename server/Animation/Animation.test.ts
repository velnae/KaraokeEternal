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
import { loadCatalog, catalogClips } from './catalog.js'
import { animationContext, ANIMATION_CONTROL, ANIMATION_SYNC, type AnimationClip } from '../../shared/animation.js'

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
  const records = ['welcome', 'turn', 'closing', 'goodbye', 'invitation'].flatMap(family => [1, 2, 3].map(index => ({
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
    for (const patch of [{ volume: -1 }, { volume: NaN }, { enabled: 'yes' }]) {
      const ack = vi.fn()
      handlers[ANIMATION_CONTROL](socket(true), { payload: { ...patch, controlVersion: 1, expiresAt: Date.now() + 1000 } }, ack)
      expect(ack.mock.calls[0][0].error).toBeTruthy()
    }
  })
})

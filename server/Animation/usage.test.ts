import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { open, close, db } from '../lib/Database.js'
import { audioUsage, backfillAudioUsage, leastUsedAudio, recordAudioUsage } from './usage.js'
import type { AnimationClip } from '../../shared/animation.js'

let directory: string
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-27T10:00:00Z'))
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-usage-'))
  open({ file: path.join(directory, 'db.sqlite'), ro: false })
  db.exec('INSERT INTO rooms(roomId,name,status,data) VALUES(1,\'One\',\'open\',\'{}\'),(2,\'Two\',\'open\',\'{}\')')
})
afterEach(() => {
  close()
  fs.rmSync(directory, { recursive: true, force: true })
  vi.useRealTimers()
})

it('counts confirmed starts idempotently per room and commercial day without resetting history', () => {
  const yesterday = Date.parse('2026-10-27T07:00:00Z')
  recordAudioUsage(1, 'old', 'voice', 'intervention', yesterday)
  recordAudioUsage(1, 'new', 'voice', 'intervention', Date.now())
  recordAudioUsage(1, 'new', 'voice', 'intervention', Date.now())
  recordAudioUsage(2, 'private', 'voice', 'intervention', Date.now())
  expect(audioUsage(1, ['voice']).voice).toMatchObject({ total: 2, currentDay: 1, businessDate: '2026-10-27', lastStartedAt: Date.now() })
  vi.setSystemTime(new Date('2026-10-28T10:00:00Z'))
  expect(audioUsage(1, ['voice']).voice).toMatchObject({ total: 2, currentDay: 0 })
  expect(audioUsage(2, ['voice']).voice.total).toBe(1)
})

it('backfills only historical confirmed first-asset starts, not reservations or assumed effects', () => {
  db.run(`INSERT INTO animationInterventions(interventionId,roomId,requestId,requestedByUserId,clipId,clipChecksum,displayText,durationMs,status,requestedAt,expiresAt,startedAt,sequenceJSON)
    VALUES('old',1,'old',1,'voice','hash','Hola',2000,'INTERRUPTED',?,?,?,?)`, [Date.now(), Date.now(), Date.now(), JSON.stringify([{ id: 'voice' }, { id: 'effect' }])])
  db.run(`INSERT INTO animationInterventions(interventionId,roomId,requestId,requestedByUserId,clipId,clipChecksum,displayText,durationMs,status,requestedAt,expiresAt)
    VALUES('pending',1,'pending',1,'voice','hash','Hola',2000,'CANCELLED',?,?)`, [Date.now(), Date.now()])
  backfillAudioUsage()
  backfillAudioUsage()
  expect(audioUsage(1, ['voice', 'effect'])).toMatchObject({ voice: { total: 1 }, effect: { total: 0 } })
})

it('uses the persisted record to favour unused effects/ambience on subsequent days', () => {
  const clips = [{ id: 'a' }, { id: 'b' }] as AnimationClip[]
  recordAudioUsage(1, 'yesterday', 'a', 'ambience', Date.now() - 86400000)
  expect(leastUsedAudio(1, clips)?.id).toBe('b')
  recordAudioUsage(1, 'today', 'b', 'ambience', Date.now())
  expect(leastUsedAudio(1, clips)?.id).toBe('a')
})

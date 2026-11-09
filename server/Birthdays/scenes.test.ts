import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { close, db, open } from '../lib/Database.js'
import { changeBirthday, createBirthday, eventDTO, getBirthday, saveSettings, settings } from './Store.js'
import { birthdayDayKey, changeScene, recordBirthdayIntro, readScene } from './scenes.js'
import { operateSession } from '../Animation/sessions.js'

let directory: string
const input = { name: 'María', sex: 'female' as const, birthYear: 2000 }
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'birthday-scene-'))
  open({ file: path.join(directory, 'database.sqlite'), ro: false })
  db.run('INSERT INTO rooms(roomId,name,status,data) VALUES(1,\'Room\',\'open\',\'{}\'),(2,\'Other\',\'open\',\'{}\')')
  for (const [id, kind] of [['intro-a', 'intro'], ['intro-b', 'intro'], ['video', 'video'], ['profile-video', 'video'], ['music', 'music']]) {
    db.run('INSERT INTO birthdayAssets(id,roomId,kind,title,filename,durationMs,checksum) VALUES(?,1,?,?,?,1000,?)', [id, kind, id, id, id])
  }
  saveSettings(1, { ...settings(1), defaultVoiceId: 'voice', introId: 'intro-a', introIds: ['intro-a', 'intro-b'], videoId: 'video', musicId: 'music',
    rules: [{ id: 'specific', sex: 'female', minAge: 0, maxAge: 120, voiceId: 'voice', videoId: 'profile-video' }, { id: 'general', sex: 'any', minAge: 0, maxAge: 120, voiceId: 'voice' }] })
})
afterEach(async () => {
  close()
  await fs.rm(directory, { recursive: true, force: true })
})
const create = (key: string) => createBirthday(1, key, input)
const intro = (id: string) => eventDTO(getBirthday(1, id)).assets.find(asset => asset.kind === 'intro')!.id

it('rotates held reservations, releases cancellations and preserves retried requests', () => {
  const first = create('scene-first')
  const second = create('scene-second')
  expect(intro(first.id)).toBe('intro-a')
  expect(intro(second.id)).toBe('intro-b')
  expect(create('scene-first').settingsJSON).toBe(first.settingsJSON)
  changeBirthday(1, second.id, second.revision, 'cancel')
  expect(intro(create('scene-third').id)).toBe('intro-b')
})

it('freezes profile video and restores the automatic proposal without touching greeting generation', () => {
  const row = create('scene-manual')
  expect(eventDTO(row).assets.find(asset => asset.kind === 'video')!.id).toBe('profile-video')
  db.run('UPDATE birthdays SET preparation=\'ready\',script=\'Saved script\',greetingId=\'saved-greeting\' WHERE id=?', [row.id])
  changeScene(getBirthday(1, row.id), { revision: row.revision, introId: 'intro-b', videoId: 'video' })
  let next = getBirthday(1, row.id)
  expect(next.generationRevision).toBe(row.generationRevision)
  expect(next.script).toBe('Saved script')
  expect(next.greetingId).toBe('saved-greeting')
  expect(readScene(next)).toMatchObject({ introMode: 'manual', videoMode: 'manual' })
  expect(() => changeScene(next, { revision: row.revision, automatic: true })).toThrow(expect.objectContaining({ status: 409 }))
  changeScene(next, { revision: next.revision, automatic: true })
  next = getBirthday(1, row.id)
  expect(intro(row.id)).toBe('intro-a')
  expect(eventDTO(next).assets.find(asset => asset.kind === 'video')!.id).toBe('profile-video')
  expect(readScene(next)).toMatchObject({ introMode: 'auto', videoMode: 'auto' })
  changeBirthday(1, row.id, next.revision, 'schedule')
  expect(() => changeScene(getBirthday(1, row.id), { revision: next.revision + 1, videoId: 'video' })).toThrow('programación')
})

it('falls back to the frozen general video when switching to a profile without its own video', () => {
  const row = create('scene-profile')
  db.run('UPDATE birthdays SET preparation=\'ready\' WHERE id=?', [row.id])
  const next = changeBirthday(1, row.id, row.revision, 'edit', { ...input, profileId: 'general' })
  expect(eventDTO(next).assets.find(asset => asset.kind === 'video')!.id).toBe('video')
})

it('keeps the event background frozen when voice settings change or the greeting is regenerated', () => {
  const row = create('scene-frozen')
  saveSettings(1, { ...settings(1), rules: settings(1).rules.map(rule => ({ ...rule, videoId: 'video' })) })
  for (const operation of ['revoice', 'regenerate']) {
    db.run('UPDATE birthdays SET preparation=\'ready\' WHERE id=?', [row.id])
    const current = getBirthday(1, row.id)
    const next = changeBirthday(1, row.id, current.revision, operation)
    expect(eventDTO(next).assets.find(asset => asset.kind === 'video')!.id).toBe('profile-video')
  }
})

it('counts public starts once per run and attributes delayed receipts to the actual jornada', () => {
  const session = operateSession(1, 0, 'open', 4)!
  const row = create('scene-public')
  expect(readScene(row)?.dayKey).toBe(`session:${session.sessionId}`)
  expect(db.all('SELECT * FROM birthdayIntroUses')).toEqual([])
  const startedAt = Date.now()
  db.run('UPDATE birthdays SET playback=\'completed\',token=\'run-first\',startedAt=? WHERE id=?', [startedAt, row.id])
  db.run('UPDATE animationSessions SET status=\'CLOSED\',closedAt=? WHERE sessionId=?', [startedAt + 1, session.sessionId])
  recordBirthdayIntro(getBirthday(1, row.id))
  recordBirthdayIntro(getBirthday(1, row.id))
  expect(db.all('SELECT dayKey,introId FROM birthdayIntroUses')).toEqual([{ dayKey: `session:${session.sessionId}`, introId: 'intro-a' }])
  expect(birthdayDayKey(2, Date.parse('2026-11-09T08:00:00Z'))).toBe('day:2026-11-08')
  expect(birthdayDayKey(2, Date.parse('2026-11-09T09:00:00Z'))).toBe('day:2026-11-09')
})

it('uses persisted public history after reopening the database and resets rotation for a new jornada', () => {
  operateSession(1, 0, 'open', 4)
  const first = create('scene-history')
  db.run('UPDATE birthdays SET playback=\'completed\',token=\'run-history\',startedAt=? WHERE id=?', [Date.now(), first.id])
  recordBirthdayIntro(getBirthday(1, first.id))
  close()
  open({ file: path.join(directory, 'database.sqlite'), ro: false })
  const second = create('scene-reopened')
  expect(intro(second.id)).toBe('intro-b')
  changeBirthday(1, second.id, second.revision, 'cancel')
  operateSession(1, 0, 'finish', 4)
  operateSession(1, 0, 'open', 4)
  expect(intro(create('scene-new-jornada').id)).toBe('intro-a')
})

it('rejects duplicate audio and foreign resources, while a missing pending intro does not block creation', () => {
  db.run('INSERT INTO birthdayAssets(id,roomId,kind,title,filename,durationMs,checksum) VALUES(\'copy\',1,\'intro\',\'copy\',\'copy\',1000,\'intro-a\')')
  expect(() => saveSettings(1, { ...settings(1), introIds: ['intro-a', 'copy'] })).toThrow('copias')
  const row = create('scene-missing')
  db.run('UPDATE birthdays SET settingsJSON=json_set(settingsJSON,\'$.introId\',\'missing\') WHERE id=?', [row.id])
  expect(() => create('scene-recovery')).not.toThrow()
  db.run('INSERT INTO birthdayAssets(id,roomId,kind,title,filename,durationMs,checksum) VALUES(\'foreign\',2,\'video\',\'foreign\',\'foreign\',1000,\'foreign\')')
  expect(() => changeScene(getBirthday(1, row.id), { revision: row.revision, videoId: 'foreign' })).toThrow('sala')
})

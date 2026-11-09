import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { open, close, db } from '../lib/Database.js'
import { birthdayHistory, birthdayHistoryDetail } from './history.js'

let directory: string
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'birthday-history-'))
  open({ file: path.join(directory, 'test.sqlite'), ro: false })
  db.run('INSERT INTO rooms(roomId,name,status,data) VALUES(1,\'Room\',\'open\',\'{}\'),(2,\'Other\',\'closed\',\'{}\')')
  for (let i = 0; i < 26; i++) {
    db.run(`INSERT INTO birthdays(id,roomId,requestId,name,sex,birthYear,celebrationYear,voiceId,settingsJSON,createdAt,preparation,playback,script)
      VALUES(?,1,?,?,'unspecified',1990,2026,'voice','{"textModel":"saved-model","targetSeconds":25,"maxVoiceSeconds":60}',?,'ready',?,?)`,
    [`event-${String(i).padStart(2, '0')}`, `request-${i}`, i === 0 ? 'María' : `Persona ${i}`, Date.parse('2026-11-09T05:00:00Z') + i * 1000, i === 1 ? 'interrupted' : 'completed', 'Saludo guardado.'])
  }
  db.run(`INSERT INTO birthdays(id,roomId,requestId,name,sex,birthYear,celebrationYear,voiceId,settingsJSON,createdAt,preparation,playback)
    VALUES('other',2,'other','Otra sala','unspecified',1990,2026,'voice','{"textModel":"other-model"}',1,'ready','completed')`)
})
afterEach(async () => {
  close()
  await fs.rm(directory, { recursive: true, force: true })
})

it('paginates all room events with stable newest-first ordering and clamped pages', () => {
  const first = birthdayHistory(1, {})
  expect(first.total).toBe(26)
  expect(first.items).toHaveLength(20)
  expect(first.items[0].id).toBe('event-25')
  expect(birthdayHistory(1, { page: '2' }).items).toHaveLength(6)
  expect(birthdayHistory(1, { page: '99' }).page).toBe(2)
  expect(first.items.some(row => row.id === 'other')).toBe(false)
})
it('filters name literally, effective result and Lima date boundaries', () => {
  expect(birthdayHistory(1, { search: 'María' }).items[0].id).toBe('event-00')
  expect(birthdayHistory(1, { search: 'MARÍA' }).items[0].id).toBe('event-00')
  expect(birthdayHistory(1, { search: 'maria' }).items[0].id).toBe('event-00')
  expect(birthdayHistory(1, { search: '%' }).total).toBe(0)
  expect(birthdayHistory(1, { search: '_' }).total).toBe(0)
  expect(birthdayHistory(1, { outcome: 'interrupted' }).total).toBe(1)
  expect(birthdayHistory(1, { from: '2026-11-09', to: '2026-11-09' }).total).toBe(26)
  expect(birthdayHistory(1, { to: '2026-11-08' }).total).toBe(0)
  db.run('UPDATE birthdays SET playback=\'held\',preparation=\'failed\' WHERE id=\'event-00\'')
  expect(birthdayHistory(1, { outcome: 'failed' }).items[0].id).toBe('event-00')
  db.run('UPDATE birthdays SET playback=\'cancelled\' WHERE id=\'event-00\'')
  expect(birthdayHistory(1, { outcome: 'failed' }).total).toBe(0)
})
it.each([{ from: '2026-02-31' }, { from: '2026-11-10', to: '2026-11-09' }, { page: '-1' }, { page: ['1'] }, { outcome: 'invented' }])('rejects invalid filter contracts %j', (query) => {
  expect(() => birthdayHistory(1, query)).toThrow()
})
it('provides explicit admin detail without exposing playback authority tokens', () => {
  const detail = birthdayHistoryDetail(1, 'event-00')
  expect(detail.createdAt).toBe(Date.parse('2026-11-09T05:00:00Z'))
  expect(detail.generationSettings.textModel).toBe('saved-model')
  expect(detail.script).toBe('Saludo guardado.')
  for (const field of ['token', 'ownerSocketId', 'leaseUntil', 'requestId', 'settingsJSON']) expect(detail).not.toHaveProperty(field)
  expect(() => birthdayHistoryDetail(2, 'event-00')).toThrow('esta sala')
  expect(birthdayHistoryDetail(2, 'other').name).toBe('Otra sala')
})
it('keeps history read-only and omits subjective review data', () => {
  const before = db.get('SELECT revision,generationRevision,playback FROM birthdays WHERE id=?', ['event-00'])
  const detail = birthdayHistoryDetail(1, 'event-00')
  const history = birthdayHistory(1, { rating: 'improve' })
  expect(history.total).toBe(26)
  expect(history.items[0]).not.toHaveProperty('rating')
  expect(detail).not.toHaveProperty('reviews')
  expect(db.get('SELECT revision,generationRevision,playback FROM birthdays WHERE id=?', ['event-00'])).toEqual(before)
})

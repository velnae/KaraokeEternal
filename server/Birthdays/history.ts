import { db } from '../lib/Database.js'
import { birthdayOutcome, birthdayOutcomes, type BirthdayHistoryDetail, type BirthdayHistoryPage } from '../../shared/birthdayHistory.js'
import type { BirthdaySettings } from '../../shared/birthdays.js'
import { eventDTO, type BirthdayRow } from './Store.js'

const outcomeSQL = `CASE WHEN b.playback IN ('playing','completed','cancelled','interrupted') THEN b.playback WHEN b.preparation='failed' THEN 'failed' ELSE 'pending' END`
const normalizeName = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es')
const nameSQL = [...'áéíóúüñÁÉÍÓÚÜÑ'].reduce((sql, letter) => `replace(${sql},'${letter}','${normalizeName(letter)}')`, 'lower(b.name)')
const fail = (message: string, status = 422): never => {
  throw Object.assign(new Error(message), { status })
}
function historyRow (roomId: number, id: string) {
  return db.get<BirthdayRow>('SELECT * FROM birthdays WHERE roomId=? AND id=?', [roomId, id]) ?? fail('No se encontró el cumpleaños de esta sala.', 404)
}
function dateBoundary (value: unknown): number | null {
  if (value === undefined || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fail('Use fechas válidas para filtrar el historial.')
  const timestamp = Date.parse(`${value}T00:00:00-05:00`)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) return fail('Use fechas válidas para filtrar el historial.')
  return timestamp
}
export function birthdayHistory (roomId: number, query: Record<string, unknown>): BirthdayHistoryPage {
  const search = query.search ?? ''
  const outcome = query.outcome ?? ''
  const pageNumber = query.page ?? '1'
  if (typeof search !== 'string' || search.length > 100 || typeof outcome !== 'string' || (outcome && !birthdayOutcomes.includes(outcome as typeof birthdayOutcomes[number]))
    || typeof pageNumber !== 'string' || !/^[1-9]\d{0,5}$/.test(pageNumber)) return fail('Revise los filtros del historial.')
  const from = dateBoundary(query.from)
  const to = dateBoundary(query.to)
  if (from !== null && to !== null && from > to) return fail('La fecha inicial debe ser anterior a la fecha final.')
  const conditions = ['b.roomId=?']
  const params: unknown[] = [roomId]
  if (search.trim()) {
    conditions.push(`${nameSQL} LIKE ? ESCAPE '\\'`)
    params.push(`%${normalizeName(search.trim()).replace(/[\\%_]/g, '\\$&')}%`)
  }
  if (outcome) {
    conditions.push(`${outcomeSQL}=?`)
    params.push(outcome)
  }
  if (from !== null) {
    conditions.push('b.createdAt>=?')
    params.push(from)
  }
  if (to !== null) {
    conditions.push('b.createdAt<?')
    params.push(to + 86400000)
  }
  const source = `FROM birthdays b WHERE ${conditions.join(' AND ')}`
  const total = db.get<{ count: number }>(`SELECT count(*) count ${source}`, params)!.count
  const pageSize = 20
  const page = Math.min(Number(pageNumber), Math.max(1, Math.ceil(total / pageSize)))
  const result = db.all<BirthdayRow & { greetingDurationMs: number | null }>(
    `SELECT b.id,b.name,b.createdAt,b.playback,b.preparation,b.voiceId,b.greetingId,
     (SELECT durationMs FROM birthdayAssets a WHERE a.id=b.greetingId AND a.roomId=b.roomId) greetingDurationMs
     ${source} ORDER BY b.createdAt DESC,b.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize])
  return { total, page, pageSize, items: result.map(row => ({ id: row.id, name: row.name, createdAt: row.createdAt, outcome: birthdayOutcome(row), voiceId: row.voiceId,
    greetingId: row.greetingId, greetingDurationMs: row.greetingDurationMs })) }
}
export function birthdayHistoryDetail (roomId: number, id: string): BirthdayHistoryDetail {
  const row = historyRow(roomId, id)
  const config: BirthdaySettings = JSON.parse(row.settingsJSON)
  return { ...eventDTO(row), createdAt: row.createdAt, generationRevision: row.generationRevision, greetingId: row.greetingId,
    generationSettings: { textModel: config.textModel, targetSeconds: config.targetSeconds ?? 40, maxVoiceSeconds: config.maxVoiceSeconds ?? 60 } }
}

import { randomBytes } from 'node:crypto'
import { db } from '../lib/Database.js'
import { tableMode, type RoomTable, type TableInvitation } from '../../shared/tableAccess.js'

const now = () => Math.floor(Date.now() / 1000)
export const newToken = () => randomBytes(32).toString('base64url')
export const tableLabel = (table: Pick<RoomTable, 'code' | 'name'>) => `Mesa ${table.code}${table.name ? ` · ${table.name}` : ''}`

export default class Tables {
  static room (roomId: number) {
    const room = db.get<{ roomId: number, name: string, status: string, password: string | null, data: string }>('SELECT * FROM rooms WHERE roomId = ?', [roomId])
    if (!room) throw new Error('No se encontró la sala')
    return { ...room, prefs: JSON.parse(room.data).prefs ?? {} }
  }

  static get (roomId: number, tableId: number) {
    const table = db.get<RoomTable>('SELECT tableId, roomId, code, name, status FROM roomTables WHERE roomId = ? AND tableId = ?', [roomId, tableId])
    if (!table) throw new Error('No se encontró la mesa')
    return table
  }

  static list (roomId: number) {
    this.room(roomId)
    return db.all<RoomTable>(`SELECT t.tableId, t.roomId, t.code, t.name, t.status,
      (SELECT COUNT(*) FROM participantSessions s WHERE s.tableId = t.tableId AND s.revokedAt IS NULL AND s.expiresAt > ?) AS participants,
      (SELECT COUNT(*) FROM queue q WHERE q.tableId = t.tableId AND q.status IN ('PENDING_APPROVAL', 'APPROVED')) AS pending
      FROM roomTables t WHERE t.roomId = ? ORDER BY t.code COLLATE NOCASE`, [now(), roomId])
  }

  static save (roomId: number, tableId: number | undefined, input: Record<string, unknown>) {
    this.room(roomId)
    const code = typeof input.code === 'string' ? input.code.trim() : ''
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    const status = input.status ?? 'active'
    if (!code || code.length > 20 || name.length > 50) throw new Error('Use un código de 1 a 20 caracteres y un nombre de hasta 50')
    if (!['active', 'disabled', 'archived'].includes(String(status))) throw new Error('El estado de la mesa no es válido')
    if (db.get('SELECT tableId FROM roomTables WHERE roomId = ? AND code = ? AND tableId != ?', [roomId, code, tableId ?? -1])) throw new Error('El código de mesa ya existe en esta sala')
    if (tableId !== undefined) {
      const existing = this.get(roomId, tableId)
      if (existing.status === 'archived') throw new Error('La mesa está archivada')
      db.run('UPDATE roomTables SET code = ?, name = ?, status = ?, dateUpdated = ? WHERE tableId = ?', [code, name, status, now(), tableId])
      if (status !== 'active') db.run('UPDATE participantSessions SET revokedAt = ? WHERE tableId = ? AND revokedAt IS NULL', [now(), tableId])
      return tableId
    }
    return Number(db.run('INSERT INTO roomTables(roomId, code, name, status, joinToken, dateCreated, dateUpdated) VALUES (?, ?, ?, ?, ?, ?, ?)', [roomId, code, name, status, newToken(), now(), now()]).lastID)
  }

  static credential (roomId: number, tableId: number, renew = false) {
    const table = this.get(roomId, tableId)
    if (table.status !== 'active') throw new Error('La mesa no está activa')
    if (renew) db.run('UPDATE roomTables SET joinToken = ?, dateUpdated = ? WHERE tableId = ?', [newToken(), now(), tableId])
    return db.get<{ joinToken: string }>('SELECT joinToken FROM roomTables WHERE tableId = ?', [tableId])!.joinToken
  }

  static resolve (token: unknown): TableInvitation {
    if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token)) throw new Error('El QR no es válido. Escanee el QR de su mesa.')
    const table = db.get<RoomTable>('SELECT tableId, roomId, code, name, status FROM roomTables WHERE joinToken = ?', [token])
    if (!table || table.status !== 'active') throw new Error('El QR ya no está disponible. Solicite el QR actual de su mesa.')
    const room = this.room(table.roomId)
    if (room.status !== 'open') throw new Error('La sala está cerrada')
    if (tableMode(room.prefs) === 'OFF') throw new Error('El ingreso por mesas está desactivado')
    return { roomId: table.roomId, roomName: room.name, tableId: table.tableId, tableLabel: tableLabel(table), hasPassword: !!room.password }
  }
}

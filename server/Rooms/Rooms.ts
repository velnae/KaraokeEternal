import crypto from '../lib/crypto.js'
import sql from 'sqlate'
import { db } from '../lib/Database.js'
import { ValidationError } from '../lib/Errors.js'
import { getQueuePrefsValidationError, normalizeQueuePrefs } from '../../shared/queueRules.js'

const NAME_MIN_LENGTH = 1
const NAME_MAX_LENGTH = 50
const PASSWORD_MIN_LENGTH = 5

export const STATUSES = ['open', 'closed']

// Remember which users have been seen in each room
const roomUsers: Map<number, Set<number>> = new Map()

class Rooms {
  /**
   * Get all rooms
   */
  static get (
    roomId: number | null | undefined = undefined,
    { status = ['open'], includePassword = false }: { status?: string[], includePassword?: boolean } = {},
  ): { result: number[], entities: Record<number, any> } {
    const result = []
    const entities = {}
    const whereConditions = []
    let whereClause = sql``

    if (typeof roomId === 'number') {
      whereConditions.push(sql`roomId = ${roomId}`)
    }

    if (status && status.length > 0) {
      whereConditions.push(sql`status IN ${sql.tuple(status)}`)
    }

    if (whereConditions.length > 0) {
      whereClause = sql`WHERE ${whereConditions.reduce((acc, curr, index) => {
        if (index > 0) return sql`${acc} AND ${curr}`
        return curr
      })}`
    }

    const query = sql`
      SELECT *
      FROM rooms
      ${whereClause}
      ORDER BY dateCreated DESC
    `
    const res = db.all<{
      roomId: number
      name: string // assuming name exists
      status: string // assuming status exists
      data: string
      password?: string | null
      dateCreated: string | number
      prefs?: any
      hasPassword?: boolean
    }>(String(query), query.parameters)

    res.forEach((row) => {
      const data = JSON.parse(row.data)
      const prefs = data.prefs && typeof data.prefs === 'object' && !Array.isArray(data.prefs)
        ? data.prefs
        : {}
      row.prefs = {
        ...prefs,
        queue: normalizeQueuePrefs(prefs.queue),
      }
      delete row.data

      row.hasPassword = !!row.password
      if (!includePassword) delete row.password

      row.dateCreated = parseInt(String(row.dateCreated), 10) // v1.0 schema used 'text' column

      result.push(row.roomId)
      entities[row.roomId] = row
    })

    return { result, entities }
  }

  static async set (roomId, room) {
    const { name, password, status, prefs } = room
    let query

    if (typeof prefs !== 'undefined' && (typeof prefs !== 'object' || prefs === null || Array.isArray(prefs))) {
      throw new ValidationError('Las preferencias de la sala deben ser un objeto')
    }

    const queuePrefsError = getQueuePrefsValidationError(prefs?.queue)
    if (queuePrefsError) throw new ValidationError(queuePrefsError)

    const normalizedPrefs = {
      ...(prefs ?? {}),
      queue: normalizeQueuePrefs(prefs?.queue),
    }

    if (!name || !name.trim() || name.length < NAME_MIN_LENGTH || name.length > NAME_MAX_LENGTH) {
      throw new ValidationError(`El nombre de la sala debe tener entre ${NAME_MIN_LENGTH} y ${NAME_MAX_LENGTH} caracteres`)
    }

    if (password && password.length < PASSWORD_MIN_LENGTH) {
      throw new ValidationError(`La contraseña de la sala debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`)
    }

    if (!status || !STATUSES.includes(status)) {
      throw new ValidationError('El estado de la sala no es válido')
    }

    if (typeof roomId === 'number') {
      const passwordSql = typeof password === 'undefined'
        // leave unchanged
        ? sql``
        // empty string unsets password
        : sql`password = ${password === '' ? null : await crypto.hash(password)},`

      query = sql`
        UPDATE rooms
        SET name = ${name},
            ${passwordSql}
            status = ${status},
            data = json_set(data, '$.prefs', json(${JSON.stringify(normalizedPrefs)}))
        WHERE roomId = ${roomId}
      `
    } else {
      query = sql`
        INSERT INTO rooms (name, password, status, dateCreated, data)
        VALUES (
          ${name},
          ${typeof password === 'undefined' ? null : await crypto.hash(password)},
          ${status},
          ${Math.floor(Date.now() / 1000)},
          json_set('{}', '$.prefs', json(${JSON.stringify(normalizedPrefs)}))
        )
      `
    }

    return db.run(String(query), query.parameters)
  }

  /**
   * Validate a room against optional criteria
   */
  static async validate (
    roomId: number,
    password: string | undefined,
    {
      isOpen = true,
      validatePassword = true,
      role,
    }: {
      isOpen?: boolean
      validatePassword?: boolean
      role?: any
    } = {},
  ): Promise<boolean> {
    const res = Rooms.get(roomId, { includePassword: true })
    const room = res.entities[roomId]

    if (!room) {
      throw new Error('No se encontró la sala')
    }

    if (isOpen && room.status !== 'open') {
      throw new Error('La sala ya no está abierta')
    }

    if (validatePassword && room.password) {
      if (!password) {
        throw new Error('La contraseña de la sala es obligatoria')
      }

      if (!(await crypto.compare(password, room.password))) {
        throw new Error('La contraseña de la sala es incorrecta')
      }

      if (crypto.isLegacy(room.password)) {
        const newHash = await crypto.hash(password)
        const query = sql`
          UPDATE rooms
          SET password = ${newHash}
          WHERE roomId = ${roomId}
        `
        db.run(String(query), query.parameters)
      }
    }

    if (role) {
      const query = sql`SELECT roleId FROM roles WHERE name = ${role}`
      const row = db.get<{ roleId: number }>(String(query), query.parameters)
      const roleId = row?.roleId

      if (!roleId) {
        throw new Error('No se encontró el rol')
      }

      if (!room.prefs?.roles?.[roleId]?.allowNew) {
        throw new Error(`No se permiten nuevas cuentas de ${role === 'guest' ? 'invitado' : role === 'standard' ? 'usuario' : role} en esta sala`)
      }
    }

    return true
  }

  static prefix (roomId: string | number = '') {
    return `ROOM_ID_${roomId}`
  }

  /**
   * Utility method to list active rooms on a socket.io instance
   */
  static getActive (io: any): { room: string, roomId: number }[] {
    const rooms = []

    for (const room of io.sockets.adapter.rooms.keys()) {
      // ignore auto-generated per-user rooms
      if (room.startsWith(Rooms.prefix())) {
        const roomId = parseInt(room.substring(Rooms.prefix().length), 10)
        rooms.push({ room, roomId })
      }
    }

    return rooms
  }

  /**
   * Get the last player status reported for a room.
   */
  static getPlayerStatus (io, roomId: number) {
    for (const sock of io.of('/').sockets.values()) {
      if (sock.user && sock.user.roomId === roomId && sock._isPlayerAuthoritative && sock._lastPlayerStatus) {
        return sock._lastPlayerStatus
      }
    }

    return null
  }

  /**
   * Utility method to determine if a player is in a room
   */
  static isPlayerPresent (io: any, roomId: number): boolean {
    return Rooms.getPlayerStatus(io, roomId) !== null
  }

  /**
   * Claim the single authoritative player slot for a room.
   */
  static claimPlayer (io, sock, roomId: number): boolean {
    for (const candidate of io.of('/').sockets.values()) {
      if (candidate.id !== sock.id
        && candidate.user?.roomId === roomId
        && candidate._isPlayerAuthoritative) {
        return false
      }
    }

    sock._isPlayerAuthoritative = true
    return true
  }

  static isAuthoritativePlayer (sock): boolean {
    return sock._isPlayerAuthoritative === true
  }

  /**
   * Remember that a user has been in a room
   */
  static trackUser (roomId: number, userId: number) {
    if (!roomUsers.has(roomId)) {
      roomUsers.set(roomId, new Set())
    }

    roomUsers.get(roomId)!.add(userId)
  }

  /**
   * Check if a user has been in a room (since server start)
   */
  static hasUserBeenInRoom (roomId: number, userId: number): boolean {
    return roomUsers.get(roomId)?.has(userId) ?? false
  }
}

export default Rooms

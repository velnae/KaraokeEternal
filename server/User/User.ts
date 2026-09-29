import { db } from '../lib/Database.js'
import sql from 'sqlate'
import crypto from '../lib/crypto.js'
import Queue from '../Queue/Queue.js'
import { randomChars } from '../lib/util.js'
import { User as UserType } from '../../shared/types.js'

export type ServerUser = UserType & {
  role: string
  password?: string // only populated if requesting creds
  image?: string
  rooms?: number[] // populated in router
}

export const IMG_MAX_LENGTH = 51200 // 50KB
export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 128
export const PASSWORD_MIN_LENGTH = 6
export const NAME_MIN_LENGTH = 2
export const NAME_MAX_LENGTH = 50

class User {
  /**
   * Get user by userId
   *
   * @param creds Whether to include username and password in result
   */
  static getById (userId: number, creds: boolean = false): ServerUser | false {
    if (typeof userId !== 'number') {
      throw new Error('userId must be a number')
    }

    return User._get({ userId, username: undefined }, creds)
  }

  /**
   * Get user by username
   *
   * @param creds Whether to include username and password in result
   */
  static getByUsername (username: string, creds: boolean = false): ServerUser | false {
    if (typeof username !== 'string') {
      throw new Error('username must be a string')
    }

    return User._get({ userId: undefined, username }, creds)
  }

  /**
   * Gets all users
   *
   * @returns normalized list of users
   */
  static get (): { result: number[], entities: Record<number, ServerUser> } {
    const result = []
    const entities = {}

    const query = sql`
      SELECT users.userId, users.username, users.name, users.dateCreated, users.dateUpdated, roles.name AS role
      FROM users
        INNER JOIN roles USING (roleId)
      ORDER BY dateCreated DESC
    `
    const res = db.all<UserType & { role: string }>(String(query), query.parameters)

    res.forEach((row) => {
      result.push(row.userId)
      entities[row.userId] = row
    })

    return { result, entities }
  }

  static async create ({
    username,
    newPassword,
    newPasswordConfirm,
    name,
    image,
  }, role = 'standard') {
    username = username?.trim()
    name = name?.trim()

    const fields = new Map()

    if (role !== 'guest') {
      if (!username) {
        throw new Error('El nombre de usuario o correo electrónico es obligatorio')
      }

      if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
        throw new Error(`El nombre de usuario o correo electrónico debe tener entre ${USERNAME_MIN_LENGTH} y ${USERNAME_MAX_LENGTH} caracteres`)
      }

      if (!newPassword) {
        throw new Error('La contraseña es obligatoria')
      }

      if (newPassword.length < PASSWORD_MIN_LENGTH) {
        throw new Error(`La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`)
      }

      if (!newPasswordConfirm) {
        throw new Error('Debe confirmar la contraseña')
      }

      if (newPassword !== newPasswordConfirm) {
        throw new Error('Las contraseñas nuevas no coinciden')
      }

      if (User.getByUsername(username)) {
        throw new Error('El nombre de usuario o correo electrónico no está disponible')
      }

      fields.set('username', username)
      fields.set('password', await crypto.hash(newPassword))
    } else {
      let res: { count?: number } = {}

      // ensure unique guest username
      do {
        fields.set('username', `guest-${randomChars(5)}`)

        const query = sql`
        SELECT COUNT(*) AS count
        FROM users
        WHERE username = ${fields.get('username')}
        `
        res = db.get(String(query), query.parameters) as { count: number }
      } while (res.count > 0)

      fields.set('password', 'guest')
    }

    if (!name) {
      throw new Error('El nombre para mostrar es obligatorio')
    }

    if (name.length < NAME_MIN_LENGTH || name.length > NAME_MAX_LENGTH) {
      throw new Error(`El nombre para mostrar debe tener entre ${NAME_MIN_LENGTH} y ${NAME_MAX_LENGTH} caracteres`)
    }

    fields.set('name', name)
    fields.set('dateCreated', Math.floor(Date.now() / 1000))
    fields.set('roleId', sql`(SELECT roleId FROM roles WHERE name = ${role})`)

    // user image?
    if (image) {
      if (image.length > IMG_MAX_LENGTH) {
        throw new Error('La imagen no es válida')
      }

      fields.set('image', image)
    }

    const query = sql`
    INSERT INTO users ${sql.tuple(Array.from(fields.keys()).map(sql.column))}
    VALUES ${sql.tuple(Array.from(fields.values()))}
  `
    const res = db.run(String(query), query.parameters)

    if (typeof res.lastID !== 'number') {
      throw new Error('No se pudo crear el usuario')
    }

    return res.lastID
  }

  static async validate ({ username, password }) {
    if (!username || !password) {
      throw new Error('El nombre de usuario o correo electrónico y la contraseña son obligatorios')
    }

    const user = User.getByUsername(username, true) as ServerUser

    if (!user || !(await crypto.compare(password, user.password))) {
      throw new Error('El nombre de usuario, correo electrónico o contraseña es incorrecto')
    }

    return user
  }

  /**
   * Remove a user
   */
  static remove (userId: number): void {
    if (typeof userId !== 'number') {
      throw new Error('userId must be a number')
    }

    // remove user's queue items
    const queueQuery = sql`
      SELECT queueId
      FROM queue
      WHERE userId = ${userId}
    `
    const queueRows = db.all<{ queueId: number }>(String(queueQuery), queueQuery.parameters)

    for (const row of queueRows) {
      Queue.remove(row.queueId)
    }

    Queue.purgeByUser(userId)

    // remove user's song stars
    const songStarsQuery = sql`
      DELETE FROM songStars
      WHERE userId = ${userId}
    `
    db.run(String(songStarsQuery), songStarsQuery.parameters)

    // remove user's artist stars
    const artistStarsQuery = sql`
      DELETE FROM artistStars
      WHERE userId = ${userId}
    `
    db.run(String(artistStarsQuery), artistStarsQuery.parameters)

    // remove the user
    const usersQuery = sql`
      DELETE FROM users
      WHERE userId = ${userId}
    `
    const usersQueryRes = db.run(String(usersQuery), usersQuery.parameters)

    if (!usersQueryRes.changes) {
      throw new Error(`unable to remove userId: ${userId}`)
    }
  }

  /**
   * (private) runs the query
   * @param id with fields 'username' or 'userId'
   * @param creds whether to include username and password in result
   * @returns user object
   */
  static _get ({ userId, username }: { userId?: number, username?: string }, creds: boolean = false): ServerUser | false {
    const query = sql`
      SELECT users.*, roles.name AS role
      FROM users
        INNER JOIN roles USING (roleId)
      WHERE ${typeof userId === 'number' ? sql`userId = ${userId}` : sql`LOWER(username) = ${username.toLowerCase()}`}
    `

    const user = db.get<ServerUser>(String(query), query.parameters)
    if (!user) return false

    if (!creds) {
      delete user.username
      delete user.password
    }

    return user
  }
}

export default User

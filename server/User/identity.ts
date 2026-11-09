import { db } from '../lib/Database.js'

// Tokens identify the account; privileges always come from the current database.
export function refreshIdentity<T extends { userId?: number, role?: string | null, isAdmin?: boolean, isGuest?: boolean }> (claims: T): T & { role: string, isAdmin: boolean, isGuest: boolean } {
  if (!Number.isSafeInteger(claims?.userId)) throw new Error('Sesión no válida')
  const user = db.get<{ role: string, name: string, username: string, dateUpdated: number }>(`
    SELECT roles.name AS role, users.name, users.username, users.dateUpdated
    FROM users JOIN roles USING(roleId) WHERE userId = ?`, [claims.userId])
  if (!user) throw new Error('La cuenta ya no está disponible')
  return { ...claims, ...user, isAdmin: user.role === 'admin', isGuest: user.role === 'guest' }
}
